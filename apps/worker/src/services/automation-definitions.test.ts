import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  listAutomationDefinitions,
  previewAutomationAudience,
  runAutomationTest,
} from './automation-definitions';

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
      versionId,
      friendId: 'friend-1',
      lineAccountId: 'account-1',
    });
    expect(result.status).toBe(expected);
    expect(testDb.raw.prepare(
      `SELECT is_test, automation_version_id FROM automation_runs WHERE id = ?`,
    ).get(result.runId)).toEqual({ is_test: 1, automation_version_id: versionId });
  });

  it('別アカウントの友だちを1人テストへ渡しても実行行を作らない', async () => {
    const versionId = addDefinition(testDb.raw, { id: 'scoped-test', status: 'draft' });
    await expect(runAutomationTest(testDb.db, {
      automationId: 'scoped-test', versionId, friendId: 'outside', lineAccountId: 'account-1',
    })).rejects.toMatchObject({ code: 'not_found' });
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM automation_runs`).get())
      .toEqual({ count: 0 });
  });
});

