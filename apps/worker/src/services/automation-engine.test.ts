import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  AutomationActionError,
  processAutomationRun,
  processDueAutomationRuns,
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
       VALUES ('common-v1', 'common-1', 1, 'published', '[]', ?),
              ('common-v2', 'common-1', 2, 'published', '[]', ?)`,
    ).run(T0, T0);
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
    const pinned: Array<string | null> = [];
    expect(await processAutomationRun(testDb.db, created.runId!, {
      now: T0,
      executors: {
        common_action: async ({ commonActionVersionId }) => {
          pinned.push(commonActionVersionId);
        },
      },
    })).toBe('success');

    expect(pinned).toEqual(['common-v1']);
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
