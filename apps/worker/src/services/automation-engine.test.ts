import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  AutomationActionError,
  cancelAutomationRun,
  processAutomationRun,
  processDueAutomationRuns,
  retryAutomationRun,
  startAutomationRun,
  type ActionDefinition,
} from './automation-engine';

const T0 = '2026-08-26T01:00:00.000Z';

function action(
  id: string,
  type = 'record',
  params: Record<string, unknown> = {},
  onFailure: 'stop' | 'continue' = 'stop',
): ActionDefinition {
  return { id, type, params, onFailure };
}

function addPublishedAutomation(
  raw: Database.Database,
  input: {
    automationId?: string;
    versionId?: string;
    lineAccountId?: string;
    actions: ActionDefinition[];
  },
): { automationId: string; versionId: string; lineAccountId: string } {
  const automationId = input.automationId ?? crypto.randomUUID();
  const versionId = input.versionId ?? crypto.randomUUID();
  const lineAccountId = input.lineAccountId ?? 'account-1';
  raw.prepare(
    `INSERT INTO automation_definitions
       (id, line_account_id, name, status, current_published_version_id)
     VALUES (?, ?, ?, 'active', NULL)`,
  ).run(automationId, lineAccountId, automationId);
  raw.prepare(
    `INSERT INTO automation_versions
       (id, automation_id, version_number, status, trigger_type, action_config, published_at)
     VALUES (?, ?, 1, 'published', 'friend_add', ?, ?)`,
  ).run(versionId, automationId, JSON.stringify(input.actions), T0);
  raw.prepare(
    `UPDATE automation_definitions SET current_published_version_id = ? WHERE id = ?`,
  ).run(versionId, automationId);
  return { automationId, versionId, lineAccountId };
}

async function start(
  db: D1Database,
  setup: { automationId: string; lineAccountId: string },
  overrides: Partial<Parameters<typeof startAutomationRun>[1]> = {},
) {
  return startAutomationRun(db, {
    lineAccountId: setup.lineAccountId,
    automationId: setup.automationId,
    sourceEventId: 'event-1',
    idempotencyKey: 'event-1',
    friendId: 'friend-1',
    inputEvent: { kind: 'friend_add' },
    conditionMatched: true,
    now: T0,
    ...overrides,
  });
}

describe('V6オートメーション実行エンジン', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
  });

  it('開始時の公開版を固定し、公開先が変わっても実行内容を変えない', async () => {
    const setup = addPublishedAutomation(testDb.raw, { actions: [action('v1-step')] });
    const created = await start(testDb.db, setup);

    const version2 = crypto.randomUUID();
    testDb.raw.prepare(
      `INSERT INTO automation_versions
         (id, automation_id, version_number, status, trigger_type, action_config, published_at)
       VALUES (?, ?, 2, 'published', 'friend_add', ?, ?)`,
    ).run(version2, setup.automationId, JSON.stringify([action('v2-step')]), T0);
    testDb.raw.prepare(
      `UPDATE automation_definitions SET current_published_version_id = ? WHERE id = ?`,
    ).run(version2, setup.automationId);

    const seen: string[] = [];
    const status = await processAutomationRun(testDb.db, created.runId!, {
      now: T0,
      executors: { record: async ({ action: current }) => { seen.push(current.id); } },
    });

    expect(status).toBe('success');
    expect(seen).toEqual(['v1-step']);
    expect(created.automationVersionId).toBe(setup.versionId);
  });

  it('同じイベントの実行を二重に作らない', async () => {
    const setup = addPublishedAutomation(testDb.raw, { actions: [action('once')] });
    const first = await start(testDb.db, setup);
    const second = await start(testDb.db, setup, { sourceEventId: 'event-replayed' });

    expect(first.kind).toBe('created');
    expect(second).toMatchObject({ kind: 'existing', runId: first.runId });
    expect(testDb.raw.prepare(
      `SELECT COUNT(*) AS count FROM automation_runs WHERE automation_id = ?`,
    ).get(setup.automationId)).toEqual({ count: 1 });
  });

  it('別のLINE公式アカウントから実行を開始できない', async () => {
    const setup = addPublishedAutomation(testDb.raw, { actions: [action('private')] });

    expect(await start(testDb.db, setup, { lineAccountId: 'account-2' })).toEqual({
      kind: 'not_active',
      runId: null,
      status: null,
      automationVersionId: null,
    });
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM automation_runs`).get())
      .toEqual({ count: 0 });
  });

  it('条件外を実行せず、条件外として履歴に残す', async () => {
    const setup = addPublishedAutomation(testDb.raw, { actions: [action('must-not-run')] });
    const created = await start(testDb.db, setup, { conditionMatched: false });
    const executor = vi.fn();

    const status = await processAutomationRun(testDb.db, created.runId!, {
      now: T0,
      executors: { record: executor },
    });

    expect(created.status).toBe('skipped_condition');
    expect(status).toBe('skipped_condition');
    expect(executor).not.toHaveBeenCalled();
  });

  it('条件分岐は一致した側だけを動かし、選ばなかった側を履歴へ残す', async () => {
    insertFriend(testDb.raw, 'friend-1', { line_account_id: 'account-1' });
    testDb.raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('vip', 'VIP', 'account-1')`).run();
    testDb.raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES ('friend-1', 'vip')`).run();
    const setup = addPublishedAutomation(testDb.raw, {
      actions: [{
        id: 'branch', type: 'branch', onFailure: 'stop',
        params: {
          condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'vip' }] },
          then: [action('yes')],
          else: [action('no')],
        },
      }],
    });
    const created = await start(testDb.db, setup);
    const seen: string[] = [];
    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: T0,
      executors: { record: async ({ action: current }) => { seen.push(current.id); } },
    })).toBe('success');
    expect(seen).toEqual(['branch/then/yes']);
    expect(testDb.raw.prepare(
      `SELECT step_key, status FROM automation_run_steps
        WHERE automation_run_id = ? ORDER BY step_key`,
    ).all(created.runId)).toEqual([
      { step_key: 'branch', status: 'success' },
      { step_key: 'branch/else/no', status: 'skipped' },
      { step_key: 'branch/then/yes', status: 'success' },
    ]);
  });

  it('5分単位で待機し、期限後に同じ版の次の処理から再開する', async () => {
    const setup = addPublishedAutomation(testDb.raw, {
      actions: [action('pause', 'wait', { durationMinutes: 5 }), action('after-wait')],
    });
    const created = await start(testDb.db, setup);
    const executor = vi.fn(async () => ({ output: { recorded: true } }));

    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: T0,
      executors: { record: executor },
    })).toBe('waiting');
    expect(testDb.raw.prepare(
      `SELECT status, resume_at FROM automation_runs WHERE id = ?`,
    ).get(created.runId)).toEqual({ status: 'waiting', resume_at: '2026-08-26T01:05:00.000Z' });

    expect((await processDueAutomationRuns(testDb.db, {
      now: '2026-08-26T01:04:59.000Z',
      executors: { record: executor },
    })).processed).toBe(0);
    expect((await processDueAutomationRuns(testDb.db, {
      now: '2026-08-26T01:05:00.000Z',
      executors: { record: executor },
    })).results).toEqual([{ runId: created.runId, status: 'success' }]);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('1分・5分・30分で最大3回再試行し、同じ冪等キーを使う', async () => {
    const setup = addPublishedAutomation(testDb.raw, { actions: [action('retry')] });
    const created = await start(testDb.db, setup);
    const calls: Array<{ attempt: number; key: string }> = [];
    const executor = vi.fn(async ({ attemptNumber, idempotencyKey }) => {
      calls.push({ attempt: attemptNumber, key: idempotencyKey });
      if (attemptNumber < 4) throw new AutomationActionError('temporary', '一時失敗', true);
      return { output: { ok: true } };
    });

    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: T0,
      executors: { record: executor },
    })).toBe('waiting');
    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: '2026-08-26T01:01:00.000Z',
      executors: { record: executor },
    })).toBe('waiting');
    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: '2026-08-26T01:06:00.000Z',
      executors: { record: executor },
    })).toBe('waiting');
    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: '2026-08-26T01:36:00.000Z',
      executors: { record: executor },
    })).toBe('success');

    expect(calls.map((item) => item.attempt)).toEqual([1, 2, 3, 4]);
    expect(new Set(calls.map((item) => item.key)).size).toBe(1);
  });

  it('再試行を3回使い切ったら失敗で止まり、5回目は実行しない', async () => {
    const setup = addPublishedAutomation(testDb.raw, { actions: [action('always-fails')] });
    const created = await start(testDb.db, setup);
    const executor = vi.fn(async () => {
      throw new AutomationActionError('temporary', '一時失敗', true);
    });
    const times = [
      T0,
      '2026-08-26T01:01:00.000Z',
      '2026-08-26T01:06:00.000Z',
      '2026-08-26T01:36:00.000Z',
    ];
    const statuses: string[] = [];
    for (const now of times) {
      statuses.push(await processAutomationRun(testDb.db, created.runId!, {
        now,
        executors: { record: executor },
      }));
    }
    statuses.push(await processAutomationRun(testDb.db, created.runId!, {
      now: '2026-08-26T02:36:00.000Z',
      executors: { record: executor },
    }));

    expect(statuses).toEqual(['waiting', 'waiting', 'waiting', 'failed', 'failed']);
    expect(executor).toHaveBeenCalledTimes(4);
    expect(testDb.raw.prepare(
      `SELECT attempt_number, status FROM automation_run_steps
        WHERE automation_run_id = ? AND step_key = 'always-fails'`,
    ).get(created.runId)).toEqual({ attempt_number: 4, status: 'failed' });
  });

  it('未知の処理を成功扱いせず、続行指定なら全体を一部成功にする', async () => {
    const setup = addPublishedAutomation(testDb.raw, {
      actions: [action('known'), action('unknown', 'not-connected', {}, 'continue')],
    });
    const created = await start(testDb.db, setup);

    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: T0,
      executors: { record: async () => undefined },
    })).toBe('partial');
    expect(testDb.raw.prepare(
      `SELECT status, error_code FROM automation_run_steps
        WHERE automation_run_id = ? AND step_key = 'unknown'`,
    ).get(created.runId)).toEqual({ status: 'failed', error_code: 'unsupported_action_type' });
  });

  it('手動再実行は失敗した処理だけを新しい試行として動かす', async () => {
    const setup = addPublishedAutomation(testDb.raw, {
      actions: [action('already-done'), action('failed-once')],
    });
    const created = await start(testDb.db, setup);
    const firstCalls: string[] = [];
    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: T0,
      executors: {
        record: async ({ action: current }) => {
          firstCalls.push(current.id);
          if (current.id === 'failed-once') {
            throw new AutomationActionError('permanent', '入力を直してください', false);
          }
        },
      },
    })).toBe('failed');
    expect(firstCalls).toEqual(['already-done', 'failed-once']);

    expect(await retryAutomationRun(testDb.db, {
      runId: created.runId!,
      allowedAccountIds: [setup.lineAccountId],
      now: '2026-08-26T02:00:00.000Z',
    })).toMatchObject({ retryStepCount: 1, status: 'waiting' });
    const retryCalls: string[] = [];
    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: '2026-08-26T02:00:00.000Z',
      executors: { record: async ({ action: current }) => { retryCalls.push(current.id); } },
    })).toBe('success');
    expect(retryCalls).toEqual(['failed-once']);
    expect(testDb.raw.prepare(
      `SELECT step_key, attempt_number, status FROM automation_run_steps
        WHERE automation_run_id = ? ORDER BY step_key`,
    ).all(created.runId)).toEqual([
      { step_key: 'already-done', attempt_number: 1, status: 'success' },
      { step_key: 'failed-once', attempt_number: 2, status: 'success' },
    ]);
  });

  // #736: 実行中の押し直しは通さず、副作用は1回だけにする。時刻の主張はしない。
  // 1回目の retry が waiting へ変えた後なので、2回目の結果は待ち合わせに依らない。
  it('実行中の再送は通さず副作用を1回にする', async () => {
    const setup = addPublishedAutomation(testDb.raw, {
      actions: [action('slow')],
    });
    const created = await start(testDb.db, setup);
    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: T0,
      executors: {
        record: async () => {
          throw new AutomationActionError('permanent', '入力を直してください', false);
        },
      },
    })).toBe('failed');

    expect(await retryAutomationRun(testDb.db, {
      runId: created.runId!,
      allowedAccountIds: [setup.lineAccountId],
      now: T0,
    })).toMatchObject({ status: 'waiting' });

    const calls: string[] = [];
    const processing = processAutomationRun(testDb.db, created.runId!, {
      now: T0,
      executors: {
        record: async ({ action: current }) => {
          calls.push(current.id);
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
      },
    });
    const second = await retryAutomationRun(testDb.db, {
      runId: created.runId!,
      allowedAccountIds: [setup.lineAccountId],
      now: T0,
    }).then(
      () => 'unexpected-success',
      (error: unknown) => (error as { code?: string }).code ?? 'unknown',
    );
    expect(second).toBe('not_retryable');
    await expect(processing).resolves.toBe('success');
    expect(calls).toEqual(['slow']);
  });

  it('実行開始時に共通アクション版を固定する', async () => {
    const setup = addPublishedAutomation(testDb.raw, {
      actions: [action('shared', 'common_action', { commonActionId: 'common-1' })],
    });
    testDb.raw.prepare(
      `INSERT INTO common_actions (id, line_account_id, name, status)
       VALUES ('common-1', ?, '共通処理', 'published')`,
    ).run(setup.lineAccountId);
    testDb.raw.prepare(
      `INSERT INTO common_action_versions
         (id, common_action_id, version_number, status, action_config, published_at)
       VALUES ('common-v1', 'common-1', 1, 'published', ?, ?),
              ('common-v2', 'common-1', 2, 'published', ?, ?)`,
    ).run(
      JSON.stringify([action('inside-v1')]), T0,
      JSON.stringify([action('inside-v2')]), T0,
    );
    testDb.raw.prepare(
      `INSERT INTO common_action_bindings
         (id, line_account_id, common_action_id, common_action_version_id,
          consumer_type, consumer_id, consumer_path)
       VALUES ('binding-1', ?, 'common-1', 'common-v1', 'automation', ?, 'shared')`,
    ).run(setup.lineAccountId, setup.automationId);

    const created = await start(testDb.db, setup);
    testDb.raw.prepare(
      `UPDATE common_action_bindings SET common_action_version_id = 'common-v2' WHERE id = 'binding-1'`,
    ).run();
    const seen: string[] = [];
    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: T0,
      executors: {
        record: async ({ action: current }) => { seen.push(current.id); },
      },
    })).toBe('success');

    expect(seen).toEqual(['shared/inside-v1']);
    expect(testDb.raw.prepare(
      `SELECT step_key, action_type, common_action_version_id
         FROM automation_run_steps WHERE automation_run_id = ? ORDER BY rowid`,
    ).all(created.runId)).toEqual([
      { step_key: 'shared', action_type: 'common_action_marker', common_action_version_id: 'common-v1' },
      { step_key: 'shared/inside-v1', action_type: 'record', common_action_version_id: null },
    ]);
  });

  it('共通アクション内の待機後も固定した計画の続きから再開する', async () => {
    const setup = addPublishedAutomation(testDb.raw, {
      actions: [action('shared', 'common_action', { commonActionId: 'common-wait' })],
    });
    testDb.raw.prepare(
      `INSERT INTO common_actions (id, line_account_id, name, status)
       VALUES ('common-wait', ?, '待機を含む共通処理', 'published')`,
    ).run(setup.lineAccountId);
    testDb.raw.prepare(
      `INSERT INTO common_action_versions
         (id, common_action_id, version_number, status, action_config, published_at)
       VALUES ('common-wait-v1', 'common-wait', 1, 'published', ?, ?)`,
    ).run(JSON.stringify([
      action('pause', 'wait', { durationMinutes: 5 }),
      action('after-wait'),
    ]), T0);
    testDb.raw.prepare(
      `INSERT INTO common_action_bindings
         (id, line_account_id, common_action_id, common_action_version_id,
          consumer_type, consumer_id, consumer_path)
       VALUES ('binding-wait', ?, 'common-wait', 'common-wait-v1', 'automation', ?, 'shared')`,
    ).run(setup.lineAccountId, setup.automationId);

    const created = await start(testDb.db, setup);
    const seen: string[] = [];
    const executors = { record: async ({ action: current }: { action: ActionDefinition }) => { seen.push(current.id); } };
    expect(await processAutomationRun(testDb.db, created.runId!, { now: T0, executors })).toBe('waiting');
    expect(seen).toEqual([]);
    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: '2026-08-26T01:05:00.000Z', executors,
    })).toBe('success');
    expect(seen).toEqual(['shared/after-wait']);
  });

  it('途中終了した処理を同じ実行IDで再取得する', async () => {
    const setup = addPublishedAutomation(testDb.raw, { actions: [action('recover')] });
    const created = await start(testDb.db, setup);
    const original = testDb.raw.prepare(
      `SELECT id FROM automation_run_steps WHERE automation_run_id = ? AND step_key = 'recover'`,
    ).get(created.runId) as { id: string };
    testDb.raw.prepare(
      `UPDATE automation_runs SET status = 'running', started_at = ?, lease_expires_at = ? WHERE id = ?`,
    ).run(T0, '2026-08-26T01:05:00.000Z', created.runId);
    testDb.raw.prepare(
      `UPDATE automation_run_steps
          SET status = 'running', started_at = ?, lease_expires_at = ? WHERE id = ?`,
    ).run(T0, '2026-08-26T01:05:00.000Z', original.id);

    const seen: Array<{ id: string; attempt: number }> = [];
    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: '2026-08-26T01:05:00.000Z',
      executors: {
        record: async ({ stepExecutionId, attemptNumber }) => {
          seen.push({ id: stepExecutionId, attempt: attemptNumber });
        },
      },
    })).toBe('success');
    expect(seen).toEqual([{ id: original.id, attempt: 2 }]);
  });
});

/*
 * #942 N-353: 実行の取りやめ。実行記録は消せないため、取りやめは
 * cancelled への状態遷移。終わっていない step だけ閉じ、確定した
 * step は結果として残す。
 */
describe('実行の取りやめ（#942 N-353）', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
  });

  it('待機中の実行と、まだ終わっていない処理を取消で閉じる', async () => {
    const setup = addPublishedAutomation(testDb.raw, {
      actions: [action('first'), action('second')],
    });
    const created = await start(testDb.db, setup);

    const result = await cancelAutomationRun(testDb.db, {
      runId: created.runId!,
      allowedAccountIds: ['account-1'],
      now: T0,
    });

    expect(result).toEqual({
      runId: created.runId, status: 'cancelled',
      alreadyCancelled: false, cancelledStepCount: 2,
    });
    expect(testDb.raw.prepare(
      `SELECT status, completed_at FROM automation_runs WHERE id = ?`,
    ).get(created.runId)).toEqual({ status: 'cancelled', completed_at: T0 });
    // 実行記録は消えない（状態遷移だけ）。
    expect(testDb.raw.prepare(
      `SELECT step_key, status FROM automation_run_steps
        WHERE automation_run_id = ? ORDER BY rowid`,
    ).all(created.runId)).toEqual([
      { step_key: 'first', status: 'cancelled' },
      { step_key: 'second', status: 'cancelled' },
    ]);
  });

  it('確定した処理は残し、まだの処理だけを取り消す', async () => {
    const setup = addPublishedAutomation(testDb.raw, {
      actions: [action('done'), action('pending')],
    });
    const created = await start(testDb.db, setup);
    testDb.raw.prepare(
      `UPDATE automation_run_steps SET status = 'success', completed_at = ?
        WHERE automation_run_id = ? AND step_key = 'done'`,
    ).run(T0, created.runId);
    testDb.raw.prepare(
      `UPDATE automation_runs SET status = 'running', started_at = ? WHERE id = ?`,
    ).run(T0, created.runId);

    const result = await cancelAutomationRun(testDb.db, {
      runId: created.runId!,
      allowedAccountIds: ['account-1'],
      now: T0,
    });

    expect(result).toMatchObject({ status: 'cancelled', cancelledStepCount: 1 });
    expect(testDb.raw.prepare(
      `SELECT step_key, status FROM automation_run_steps
        WHERE automation_run_id = ? ORDER BY rowid`,
    ).all(created.runId)).toEqual([
      { step_key: 'done', status: 'success' },
      { step_key: 'pending', status: 'cancelled' },
    ]);
  });

  it('終わった実行は取りやめられない', async () => {
    const setup = addPublishedAutomation(testDb.raw, { actions: [action('only')] });
    const created = await start(testDb.db, setup);
    for (const status of ['success', 'partial', 'failed', 'skipped_condition']) {
      testDb.raw.prepare(
        `UPDATE automation_runs SET status = ? WHERE id = ?`,
      ).run(status, created.runId);
      await expect(cancelAutomationRun(testDb.db, {
        runId: created.runId!,
        allowedAccountIds: ['account-1'],
      })).rejects.toMatchObject({ code: 'not_cancellable' });
    }
  });

  it('取消済みへの再取消はそのまま成功で返す', async () => {
    const setup = addPublishedAutomation(testDb.raw, { actions: [action('only')] });
    const created = await start(testDb.db, setup);
    await cancelAutomationRun(testDb.db, {
      runId: created.runId!, allowedAccountIds: ['account-1'],
    });

    const again = await cancelAutomationRun(testDb.db, {
      runId: created.runId!, allowedAccountIds: ['account-1'],
    });
    expect(again).toEqual({
      runId: created.runId, status: 'cancelled',
      alreadyCancelled: true, cancelledStepCount: 0,
    });
  });

  it('見えないアカウント・無い実行は not_found', async () => {
    const setup = addPublishedAutomation(testDb.raw, { actions: [action('only')] });
    const created = await start(testDb.db, setup);

    await expect(cancelAutomationRun(testDb.db, {
      runId: created.runId!, allowedAccountIds: [],
    })).rejects.toMatchObject({ code: 'not_found' });
    await expect(cancelAutomationRun(testDb.db, {
      runId: created.runId!, allowedAccountIds: ['account-2'],
    })).rejects.toMatchObject({ code: 'not_found' });
    await expect(cancelAutomationRun(testDb.db, {
      runId: 'no-such-run', allowedAccountIds: ['account-1'],
    })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('確認と更新の間に終わった実行は取りやめない', async () => {
    /*
     * 状態を読んでから閉じるまでに別接続が終わらせた競合。
     * 呼び出しが最初の読み取りで止まる隙に、同じ行を success へ書き換える。
     */
    const setup = addPublishedAutomation(testDb.raw, { actions: [action('only')] });
    const created = await start(testDb.db, setup);

    const pending = cancelAutomationRun(testDb.db, {
      runId: created.runId!, allowedAccountIds: ['account-1'],
    });
    testDb.raw.prepare(
      `UPDATE automation_runs SET status = 'success', completed_at = ? WHERE id = ?`,
    ).run(T0, created.runId);
    await expect(pending).rejects.toMatchObject({ code: 'not_cancellable' });
    // 先に閉じた側の結果は壊さない。
    expect(testDb.raw.prepare(
      `SELECT status FROM automation_runs WHERE id = ?`,
    ).get(created.runId)).toEqual({ status: 'success' });
  });

  it('走り途中で取りやめると、次の処理へ進まずに止まる', async () => {
    const setup = addPublishedAutomation(testDb.raw, {
      actions: [action('first'), action('second')],
    });
    const created = await start(testDb.db, setup);

    const seen: string[] = [];
    const status = await processAutomationRun(testDb.db, created.runId!, {
      now: T0,
      executors: {
        record: async ({ action: current }) => {
          seen.push(current.id);
          // 1つ目の処理のあとで取消が入る。2つ目へ進んではいけない。
          await cancelAutomationRun(testDb.db, {
            runId: created.runId!, allowedAccountIds: ['account-1'],
          });
        },
      },
    });

    expect(status).toBe('cancelled');
    expect(seen).toEqual(['first']);
    expect(testDb.raw.prepare(
      `SELECT status FROM automation_runs WHERE id = ?`,
    ).get(created.runId)).toEqual({ status: 'cancelled' });
  });

  it('取りやめた実行は回収対象に出さない', async () => {
    const setup = addPublishedAutomation(testDb.raw, { actions: [action('only')] });
    const created = await start(testDb.db, setup);
    await cancelAutomationRun(testDb.db, {
      runId: created.runId!, allowedAccountIds: ['account-1'],
    });

    const seen: string[] = [];
    const result = await processDueAutomationRuns(testDb.db, {
      now: T0,
      executors: { record: async ({ action: current }) => { seen.push(current.id); } },
    });
    expect(result.results.some((entry) => entry.runId === created.runId)).toBe(false);
    expect(seen).toEqual([]);
  });
});
