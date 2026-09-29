import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { listAutomationDefinitions } from './automation-definitions';

// #554 点検#519中1・中9: 一覧に limit/offset を足し、集計はページ送りに
// 依らず対象アカウント全体で数える。SQL そのものが仕様なので実 SQLite に当てる。

describe('listAutomationDefinitions のページ送り', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    const raw = testDb.raw;
    raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
    raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES ('account-1', 'channel-1', '店舗1', '', '', 1, 'tenant-1')`,
    ).run();
    const definition = (
      id: string, status: string, priority: number, versionId: string, published: boolean,
    ) => {
      raw.prepare(
        `INSERT INTO automation_definitions
           (id, line_account_id, name, status, priority,
            current_draft_version_id, current_published_version_id, created_at, updated_at)
         VALUES (?, 'account-1', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).run(
        id, `ルール${id}`, status, priority,
        published ? null : versionId, published ? versionId : null,
      );
      raw.prepare(
        `INSERT INTO automation_versions
           (id, automation_id, version_number, status, trigger_type, trigger_config, condition_config, action_config)
         VALUES (?, ?, 1, ?, 'message_received', '{}', '{}', '[]')`,
      ).run(versionId, id, published ? 'published' : 'draft');
    };
    definition('d1', 'active', 10, 'v1', true);
    definition('d2', 'stopped', 5, 'v2', true);
    definition('d3', 'draft', 30, 'v3', false);
    definition('d4', 'archived', 99, 'v4', true);
    const run = (
      id: string, automationId: string, status: string, createdAt: string | null, isTest: number,
    ) => {
      raw.prepare(
        `INSERT INTO automation_runs
           (id, line_account_id, automation_id, automation_version_id,
            source_event_id, idempotency_key, status, is_test, created_at)
         VALUES (?, 'account-1', ?, 'v1', ?, ?, ?, ?, ${createdAt === null ? "datetime('now')" : '?'})`,
      ).run(id, automationId, `event-${id}`, `key-${id}`, status, isTest, ...(createdAt === null ? [] : [createdAt]));
    };
    run('r1', 'd1', 'success', null, 0);
    run('r2', 'd1', 'success', null, 0);
    run('r3', 'd1', 'failed', null, 0);
    run('r4', 'd2', 'partial', null, 0);
    run('r5', 'd1', 'success', null, 1);
    run('r6', 'd1', 'success', '2020-01-01 00:00:00', 0);
  });

  it('ページ指定なしは全件返し、集計は保管を除く', async () => {
    const result = await listAutomationDefinitions(testDb.db, ['account-1']);
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    // 優先度順（d3:30, d1:10, d2:5）。保管 d4 は出ない。
    expect(result.items.map((item) => item.id)).toEqual(['d3', 'd1', 'd2']);
    expect(result.summary).toMatchObject({
      active: 1, stopped: 1, executionCount30d: 4, failureCount30d: 2,
    });
    expect(result.freshness).toBe('available');
  });

  it('limit/offset で切り出し、集計と総件数は全体のまま', async () => {
    const first = await listAutomationDefinitions(testDb.db, ['account-1'], { limit: 2, offset: 0 });
    expect(first.items.map((item) => item.id)).toEqual(['d3', 'd1']);
    expect(first.total).toBe(3);
    expect(first.summary).toMatchObject({
      active: 1, stopped: 1, executionCount30d: 4, failureCount30d: 2,
    });
    const second = await listAutomationDefinitions(testDb.db, ['account-1'], { limit: 2, offset: 2 });
    expect(second.items.map((item) => item.id)).toEqual(['d2']);
    expect(second.total).toBe(3);
  });

  it('対象アカウントなしは空を返す', async () => {
    const result = await listAutomationDefinitions(testDb.db, []);
    expect(result).toMatchObject({ items: [], total: 0 });
    expect(result.summary).toMatchObject({
      active: 0, stopped: 0, executionCount30d: 0, failureCount30d: 0,
    });
  });
});
