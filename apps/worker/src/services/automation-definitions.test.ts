import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  listAutomationDefinitions,
  previewAutomationAudience,
  runAutomationTest,
} from './automation-definitions';
import { automationRevisionToken } from './automation-drafts';

function addAccount(raw: Database.Database, id: string): void {
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, timezone)
     VALUES (?, ?, ?, '', '', 1, 'Asia/Tokyo')`,
  ).run(id, `channel-${id}`, id);
}

function addFriend(raw: Database.Database, id: string, accountId: string): void {
  raw.prepare(
    `INSERT INTO friends
       (id, line_user_id, display_name, line_account_id, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, '{}', datetime('now'), datetime('now'))`,
  ).run(id, `U-${id}`, id, accountId);
}

function addDefinition(
  raw: Database.Database,
  input: {
    id: string;
    accountId?: string;
    status: 'draft' | 'active' | 'stopped' | 'archived';
    condition?: Record<string, unknown>;
    actions?: unknown[];
  },
): string {
  const accountId = input.accountId ?? 'account-1';
  const versionId = `${input.id}-v1`;
  const versionStatus = input.status === 'draft' ? 'draft' : 'published';
  raw.prepare(
    `INSERT INTO automation_definitions
       (id, line_account_id, name, status, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, 10, datetime('now'), datetime('now'))`,
  ).run(input.id, accountId, input.id, input.status);
  raw.prepare(
    `INSERT INTO automation_versions
       (id, automation_id, version_number, status, trigger_type, trigger_config,
        condition_config, action_config, created_at, published_at)
     VALUES (?, ?, 1, ?, 'message_received', '{}', ?, ?, datetime('now'), ?)`,
  ).run(
    versionId,
    input.id,
    versionStatus,
    JSON.stringify(input.condition ?? {}),
    JSON.stringify(input.actions ?? [{ id: 'tag', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' }]),
    versionStatus === 'published' ? new Date().toISOString() : null,
  );
  raw.prepare(
    `UPDATE automation_definitions
        SET current_draft_version_id = ?, current_published_version_id = ?
      WHERE id = ?`,
  ).run(
    versionStatus === 'draft' ? versionId : null,
    versionStatus === 'published' ? versionId : null,
    input.id,
  );
  return versionId;
}

/**
 * 版の札（`<行のid>.<中身の指紋>`）。
 *
 * 1人テストは取り消せないので、Worker は**指紋の付いた札しか受け取らない**。
 * 試験も画面と同じ札を渡す。
 */
async function revisionOf(raw: Database.Database, versionId: string): Promise<string> {
  const row = raw.prepare(
    `SELECT trigger_type, trigger_config, condition_config, action_config
       FROM automation_versions WHERE id = ?`,
  ).get(versionId) as {
    trigger_type: string; trigger_config: string; condition_config: string; action_config: string;
  };
  return automationRevisionToken(versionId, row);
}

function addRun(
  raw: Database.Database,
  input: { id: string; automationId: string; status: string; isTest?: boolean },
): void {
  raw.prepare(
    `INSERT INTO automation_runs
       (id, line_account_id, automation_id, automation_version_id, source_event_id,
        idempotency_key, status, input_event_json, is_test, created_at)
     VALUES (?, 'account-1', ?, ?, ?, ?, ?, '{}', ?, datetime('now'))`,
  ).run(
    input.id,
    input.automationId,
    `${input.automationId}-v1`,
    `event-${input.id}`,
    `key-${input.id}`,
    input.status,
    input.isTest ? 1 : 0,
  );
}

describe('V6オートメーションの一覧・対象見込み・1人テスト', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
    addAccount(testDb.raw, 'account-2');
    addFriend(testDb.raw, 'friend-1', 'account-1');
    addFriend(testDb.raw, 'friend-2', 'account-1');
    addFriend(testDb.raw, 'outside', 'account-2');
    testDb.raw.prepare(
      `INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '会員', 'account-1')`,
    ).run();
  });

  it('動作中・停止中・下書きをV6定義から返し、30日集計でテスト実行を除く', async () => {
    addDefinition(testDb.raw, { id: 'active', status: 'active' });
    addDefinition(testDb.raw, { id: 'stopped', status: 'stopped' });
    addDefinition(testDb.raw, { id: 'draft', status: 'draft' });
    addDefinition(testDb.raw, { id: 'archived', status: 'archived' });
    addDefinition(testDb.raw, { id: 'other', accountId: 'account-2', status: 'active' });
    addRun(testDb.raw, { id: 'success', automationId: 'active', status: 'success' });
    addRun(testDb.raw, { id: 'failed', automationId: 'active', status: 'failed' });
    addRun(testDb.raw, { id: 'test', automationId: 'active', status: 'failed', isTest: true });

    const result = await listAutomationDefinitions(testDb.db, ['account-1']);

    expect(result.items.map((item) => item.id).sort()).toEqual(['active', 'draft', 'stopped']);
    expect(result.items.find((item) => item.id === 'active')).toMatchObject({
      version: 1,
      executionCount30d: 2,
      failureCount30d: 1,
    });
    expect(result.summary).toEqual({ active: 1, stopped: 1, executionCount30d: 2, failureCount30d: 1 });
    expect(result.freshness).toBe('available');
  });

  it('対象条件を同じアカウントだけに適用し、版が変わったら409相当の競合にする', async () => {
    const versionId = addDefinition(testDb.raw, {
      id: 'preview',
      status: 'draft',
      condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] },
    });
    testDb.raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES ('friend-1', 'tag-1')`).run();

    await expect(previewAutomationAudience(testDb.db, {
      automationId: 'preview', versionId, lineAccountId: 'account-1',
    })).resolves.toMatchObject({ matched: 1, total: 2, freshness: 'available' });
    await expect(previewAutomationAudience(testDb.db, {
      automationId: 'preview', versionId: 'old-version', lineAccountId: 'account-1',
    })).rejects.toMatchObject({ code: 'version_conflict' });
  });

  it.each([
    ['success', {}, [{ id: 'tag', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' }], 'success'],
    ['skipped', { operator: 'AND', rules: [{ type: 'tag_exists', value: 'missing' }] }, [{ id: 'tag', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' }], 'skipped_condition'],
    ['waiting', {}, [{ id: 'wait', type: 'wait', params: { durationMinutes: 5 }, onFailure: 'stop' }], 'waiting'],
    ['failed', {}, [{ id: 'unknown', type: 'not_connected', params: {}, onFailure: 'stop' }], 'failed'],
  ])('1人テストで%s状態を本番実行と分けて記録する', async (_case, condition, actions, expected) => {
    const versionId = addDefinition(testDb.raw, {
      id: `test-${_case}`,
      status: 'draft',
      condition: condition as Record<string, unknown>,
      actions,
    });
    const result = await runAutomationTest(testDb.db, {
      automationId: `test-${_case}`,
      versionId: await revisionOf(testDb.raw, versionId),
      friendId: 'friend-1',
      lineAccountId: 'account-1',
    });
    expect(result.status).toBe(expected);
    expect(testDb.raw.prepare(
      `SELECT is_test, automation_version_id FROM automation_runs WHERE id = ?`,
    ).get(result.runId)).toEqual({ is_test: 1, automation_version_id: versionId });
  });

  /*
   * ここから3件は「確認した中身しか送らない」ことを見る（#679・司令塔 09-09 03:46）。
   *
   * `runAutomationTest` は `startAutomationRun` の中でもう一度 `action_config` を
   * 読み、`execution_plan_json` に焼き付けてから送る。**画面側の突き合わせだけでは、
   * その読み取りの直前に割り込まれた中身を止められない。**
   */

  it('確認した中身が別接続で書き換わっていたら、送らずに409で返し実行行も残さない', async () => {
    const versionId = addDefinition(testDb.raw, {
      id: 'toctou',
      status: 'draft',
      actions: [{ id: 'message', type: 'send_message', params: { messageType: 'text', content: '確認したときの文面です。' }, onFailure: 'stop' }],
    });
    // 画面が確認に使った札（このときの中身の指紋が入っている）。
    const confirmed = await revisionOf(testDb.raw, versionId);

    // 2回目の getDraft が返ったあと、/test が確定する前に別接続が commit する。
    testDb.raw.prepare(
      `UPDATE automation_versions SET action_config = ? WHERE id = ?`,
    ).run(
      JSON.stringify([{ id: 'message', type: 'send_message', params: { messageType: 'text', content: '割り込みが差し替えた文面です。' }, onFailure: 'stop' }]),
      versionId,
    );

    await expect(runAutomationTest(testDb.db, {
      automationId: 'toctou',
      versionId: confirmed,
      friendId: 'friend-1',
      lineAccountId: 'account-1',
    })).rejects.toMatchObject({ code: 'version_conflict' });

    // 送っていないだけでなく、痕跡も残さない。
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM automation_runs').get())
      .toEqual({ count: 0 });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM automation_run_steps').get())
      .toEqual({ count: 0 });
  });

  it('入口を通った直後に別タブが保存しても、実行行を1つも作らずに409で止まる', async () => {
    const versionId = addDefinition(testDb.raw, {
      id: 'toctou-late',
      status: 'draft',
      actions: [{ id: 'tag', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' }],
    });
    const confirmed = await revisionOf(testDb.raw, versionId);

    /*
     * 入口の突き合わせが終わったあと、`startAutomationRun` が中身を読む前に
     * 別タブの保存が commit する場面を作る。`automation_definitions` を読む
     * 文を合図にして、その直前に**本物の保存の手順**（新しい版を作って
     * 現在の下書きを差し替える）を流し込む。
     */
    let interrupted = false;
    const racingDb = new Proxy(testDb.db, {
      get(target, key: string, receiver: unknown) {
        if (key !== 'prepare') return Reflect.get(target, key, receiver) as unknown;
        return (sql: string) => {
          if (interrupted || !sql.includes('FROM automation_definitions d')) return target.prepare(sql);
          interrupted = true;
          const nextVersionId = 'toctou-late-v2';
          testDb.raw.prepare(
            `INSERT INTO automation_versions
               (id, automation_id, version_number, status, trigger_type, trigger_config,
                condition_config, action_config, created_at)
             VALUES (?, 'toctou-late', 2, 'draft', 'message_received', '{}', '{}', ?, datetime('now'))`,
          ).run(
            nextVersionId,
            JSON.stringify([{ id: 'tag', type: 'add_tag', params: { tagId: 'tag-9' }, onFailure: 'stop' }]),
          );
          testDb.raw.prepare(
            `UPDATE automation_definitions SET current_draft_version_id = ? WHERE id = 'toctou-late'`,
          ).run(nextVersionId);
          return target.prepare(sql);
        };
      },
    }) as D1Database;

    await expect(runAutomationTest(racingDb, {
      automationId: 'toctou-late',
      versionId: confirmed,
      friendId: 'friend-1',
      lineAccountId: 'account-1',
    })).rejects.toMatchObject({ code: 'version_conflict' });

    expect(interrupted).toBe(true);
    // 実行記録も、その手順も、1行も残っていない。
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM automation_runs').get())
      .toEqual({ count: 0 });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM automation_run_steps').get())
      .toEqual({ count: 0 });
    // 友だちにタグも付いていない。
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM friend_tags').get())
      .toEqual({ count: 0 });
  });

  it('実行計画を固めたあとに中身が入れ替わっていたら、送らずに取消として閉じる', async () => {
    const versionId = addDefinition(testDb.raw, {
      id: 'toctou-raw',
      status: 'draft',
      actions: [{ id: 'tag', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' }],
    });
    const confirmed = await revisionOf(testDb.raw, versionId);

    /*
     * アプリを通さずDBを直接書き換える場面（司令塔の C1 の道具立てと同じ）。
     * 入口の突き合わせが済んだあと、`startAutomationRun` が中身を読む直前に
     * 同じ行を書き換えるので、**版の行のidは現在の下書きのまま**である。
     * 入口の指紋も、実行側の `v.id IN (...)` も当たらない。最後の見張りだけが頼り。
     */
    let interrupted = false;
    const racingDb = new Proxy(testDb.db, {
      get(target, key: string, receiver: unknown) {
        if (key !== 'prepare') return Reflect.get(target, key, receiver) as unknown;
        return (sql: string) => {
          if (!interrupted && sql.includes('FROM automation_definitions d')) {
            interrupted = true;
            testDb.raw.prepare(
              `UPDATE automation_versions SET action_config = ? WHERE id = ?`,
            ).run(
              JSON.stringify([{ id: 'tag', type: 'add_tag', params: { tagId: 'tag-9' }, onFailure: 'stop' }]),
              versionId,
            );
          }
          return target.prepare(sql);
        };
      },
    }) as D1Database;

    await expect(runAutomationTest(racingDb, {
      automationId: 'toctou-raw',
      versionId: confirmed,
      friendId: 'friend-1',
      lineAccountId: 'account-1',
    })).rejects.toMatchObject({ code: 'version_conflict' });

    expect(interrupted).toBe(true);
    // 送っていない。手順も走っていないし、タグも付いていない。
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM friend_tags').get())
      .toEqual({ count: 0 });
    // 手順は積まれただけで、1つも動かしていない（`queued` のまま）。
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS count FROM automation_run_steps WHERE status <> 'queued'",
    ).get()).toEqual({ count: 0 });
    /*
     * 実行記録だけは残る。`packages/db/bootstrap.sql` の
     * `trg_automation_runs_no_delete` が削除を禁じているためで、消さずに
     * **取消として閉じる**。送った跡ではないことが状態から分かる。
     */
    expect(testDb.raw.prepare('SELECT status, is_test FROM automation_runs').get())
      .toEqual({ status: 'cancelled', is_test: 1 });
  });

  it('中身の指紋が付いていない古い形の版指定は、1人テストでは受け取らない', async () => {
    const versionId = addDefinition(testDb.raw, { id: 'bare', status: 'draft' });
    await expect(runAutomationTest(testDb.db, {
      automationId: 'bare',
      versionId,
      friendId: 'friend-1',
      lineAccountId: 'account-1',
    })).rejects.toMatchObject({ code: 'version_conflict' });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM automation_runs').get())
      .toEqual({ count: 0 });
  });

  it('別アカウントの友だちを1人テストへ渡しても実行行を作らない', async () => {
    const versionId = addDefinition(testDb.raw, { id: 'scoped-test', status: 'draft' });
    await expect(runAutomationTest(testDb.db, {
      automationId: 'scoped-test',
      versionId: await revisionOf(testDb.raw, versionId),
      friendId: 'outside',
      lineAccountId: 'account-1',
    })).rejects.toMatchObject({ code: 'not_found' });
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM automation_runs`).get())
      .toEqual({ count: 0 });
  });
});
