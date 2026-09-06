import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friendAddRules } from './friend-add-rules.js';

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};
const staff: AuthenticatedStaff = {
  ...owner, id: 'staff-1', name: '担当者', role: 'staff', permissionKeys: ['/friend-add-settings'],
};

function app(db: D1Database, actor: AuthenticatedStaff = owner) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', actor);
    await next();
  });
  instance.route('/', friendAddRules);
  return instance;
}

function json(method: string, body: unknown, idempotencyKey?: string) {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  };
}

function ensureMigration(testDb: SqliteD1): void {
  const exists = testDb.raw.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'friend_add_rule_folders'",
  ).get();
  if (!exists) {
    testDb.raw.exec(readFileSync(join(
      import.meta.dirname,
      '../../../../packages/db/migrations/308_friend_add_rule_data_contract.sql',
    ), 'utf8'));
  }
}

function seedRuleAndRun(testDb: SqliteD1): void {
  const definition = JSON.stringify({
    routeIds: ['route-1'], scenarioId: 'scenario-1', messageType: 'text',
    messageText: '友だち追加ありがとうございます', timing: 'immediate', actions: [
      { type: 'add_tag', label: '見込み客タグ', targetId: 'tag-1' },
    ], friendCondition: '購入回数が1回以上', activeFrom: null, activeUntil: null,
    weekdays: [1, 2, 3], timeWindows: [{ start: '09:00', end: '18:00' }],
    resendSuppressionHours: 24,
    deliveryChoices: { sendWelcomeMessage: true, startScenario: true, runActions: true },
    unknownRouteAction: { sendCommonGuidance: true, notifyStaff: true },
  });
  testDb.raw.prepare(
    `INSERT INTO entry_routes (id, name, ref_code, is_active, line_account_id)
     VALUES ('route-1', '紹介QR', 'REF001', 1, 'account-1')`,
  ).run();
  testDb.raw.prepare(
    `INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
     VALUES ('scenario-1', '初回案内', 'friend_add', 1, 'account-1')`,
  ).run();
  testDb.raw.prepare("INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '見込み客', 'account-1')").run();
  testDb.raw.prepare(
    `INSERT INTO friend_add_rules
      (id, line_account_id, friend_kind, name, priority, status, current_version_id, created_at, updated_at)
     VALUES ('rule-1', 'account-1', 'first_time', '紹介QR', 1, 'published', 'version-1',
             '2026-09-07T09:00:00.000', '2026-09-07T09:00:00.000'),
            ('rule-2', 'account-1', 'first_time', '紹介キャンペーン', 1, 'published', 'version-2',
             '2026-09-07T09:01:00.000', '2026-09-07T09:01:00.000')`,
  ).run();
  testDb.raw.prepare(
    `INSERT INTO friend_add_rule_versions
      (id, rule_id, version_number, definition_snapshot, status, published_at)
     VALUES ('version-1', 'rule-1', 3, ?, 'published', '2026-09-07T09:00:00.000'),
            ('version-2', 'rule-2', 1, ?, 'published', '2026-09-07T09:01:00.000')`,
  ).run(definition, definition);
  insertFriend(testDb.raw, 'friend-1', { line_account_id: 'account-1', display_name: '山田 太郎' });
  testDb.raw.prepare(
    `INSERT INTO friend_scenarios
      (id, friend_id, scenario_id, status, started_at, updated_at)
     VALUES ('enrollment-1', 'friend-1', 'scenario-1', 'active',
             '2026-09-07T10:00:01.000', '2026-09-07T10:00:01.000')`,
  ).run();
  testDb.raw.prepare(
    `INSERT INTO friend_add_events
      (id, line_account_id, friend_id, webhook_event_id, friend_kind, attribution_status,
       ref_code, entry_route_id, routing_rule_id, routing_status, occurred_at, processed_at,
       winning_rule_version_id, scenario_enrollment_id, delivery_count, first_delivery_sent_at)
     VALUES ('run-1', 'account-1', 'friend-1', 'webhook-1', 'first_time', 'captured',
             'REF001', 'route-1', 'rule-1', 'completed',
             '2026-09-07T10:00:00.000', '2026-09-07T10:00:02.000', 'version-1',
             'enrollment-1', 1, '2026-09-07T10:00:02.000')`,
  ).run();
  testDb.raw.prepare(
    `INSERT INTO friend_add_action_runs
      (id, event_id, action_stable_id, idempotency_key, status, attempt_count, created_at, updated_at)
     VALUES ('action-run-1', 'run-1', 'action-1', 'run-1:action-1', 'completed', 1,
             '2026-09-07T10:00:01.000', '2026-09-07T10:00:02.000')`,
  ).run();
}

describe('V6 friend-add rule data contracts', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    ensureMigration(testDb);
    testDb.raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1'), ('tenant-2', '統括2')").run();
    testDb.raw.prepare(
      `INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1'),
              ('account-2', 'channel-2', '店舗2', 'token-2', 'secret-2', 1, 'tenant-2')`,
    ).run();
  });

  afterEach(() => testDb.raw.close());

  it('通常: ルールの総件数・競合根拠・実行集計・版とアクション詳細を返す', async () => {
    seedRuleAndRun(testDb);
    const list = await app(testDb.db).request('/api/friend-add-rules?account_id=account-1&kind=first_time&limit=1');
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      data: { total: 3, items: [{ id: 'rule-1', version: 1 }], nextCursor: expect.any(String) },
    });

    const conflicts = await app(testDb.db).request('/api/friend-add-rules/conflicts?account_id=account-1&kind=first_time');
    expect(conflicts.status).toBe(200);
    await expect(conflicts.json()).resolves.toMatchObject({
      data: {
        conflicts: expect.arrayContaining([
          expect.objectContaining({ code: 'same_priority', ruleIds: ['rule-1', 'rule-2'] }),
          expect.objectContaining({ code: 'overlapping_weekday', ruleIds: ['rule-1', 'rule-2'] }),
          expect.objectContaining({ code: 'overlapping_time', ruleIds: ['rule-1', 'rule-2'] }),
          expect.objectContaining({ code: 'same_friend_condition', ruleIds: ['rule-1', 'rule-2'] }),
        ]),
      },
    });

    const runs = await app(testDb.db).request('/api/friend-add-runs?account_id=account-1');
    expect(runs.status).toBe(200);
    await expect(runs.json()).resolves.toMatchObject({
      data: {
        items: [{ id: 'run-1', rule: { versionNumber: 3 }, scenario: { started: true }, actions: { total: 1 } }],
        summary: { cumulativeDeliveries: 1, scenarioStarts: 1, averageSendTimeMs: 2000 },
      },
    });

    const detail = await app(testDb.db).request('/api/friend-add-runs/run-1?account_id=account-1');
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      data: { id: 'run-1', rule: { id: 'rule-1', versionId: 'version-1' }, actionRuns: [{ stableId: 'action-1' }] },
    });
  });

  it('空: 実行結果が無いときも0件と未取得を区別して返す', async () => {
    const response = await app(testDb.db).request('/api/friend-add-runs?account_id=account-1');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [], total: 0, summary: { cumulativeDeliveries: 0, scenarioStarts: 0, averageSendTimeMs: null } },
    });
  });

  it('権限不足と別アカウントは存在を隠し、staffはフォルダを作れない', async () => {
    const hidden = await app(testDb.db).request('/api/friend-add-runs?account_id=account-2');
    expect(hidden.status).toBe(404);
    const forbidden = await app(testDb.db, staff).request('/api/friend-add-rules/folders', json(
      'POST', { accountId: 'account-1', name: '紹介' }, 'friend-add-folder-0001',
    ));
    expect(forbidden.status).toBe(403);
  });

  it('DB失敗は500として返す', async () => {
    const failingDb = {
      prepare: () => ({ bind: () => ({ all: async () => { throw new Error('db unavailable'); } }) }),
    } as unknown as D1Database;
    const response = await app(failingDb).request('/api/friend-add-runs?account_id=account-1');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: '実行結果を取得できませんでした' });
  });

  it('フォルダ作成を冪等にし、下書き保存と停止の古い版を409にする', async () => {
    seedRuleAndRun(testDb);
    const folderRequest = json('POST', { accountId: 'account-1', name: '紹介' }, 'friend-add-folder-0001');
    const created = await app(testDb.db).request('/api/friend-add-rules/folders', folderRequest);
    expect(created.status).toBe(201);
    const replay = await app(testDb.db).request('/api/friend-add-rules/folders', folderRequest);
    expect(replay.status).toBe(200);
    expect((await created.json() as { data: { id: string } }).data.id)
      .toBe((await replay.json() as { data: { id: string } }).data.id);

    const definition = JSON.parse(testDb.raw.prepare(
      "SELECT definition_snapshot FROM friend_add_rule_versions WHERE id = 'version-1'",
    ).pluck().get() as string);
    const save = await app(testDb.db).request('/api/friend-add-rules/rule-1/draft', json(
      'PUT', {
        accountId: 'account-1', friendKind: 'first_time', name: '紹介QR', priority: 1,
        version: 0, definition,
      },
      'friend-add-save-000001',
    ));
    expect(save.status).toBe(409);

    const stop = await app(testDb.db).request('/api/friend-add-rules/rule-1/stop?account_id=account-1', json(
      'POST', { version: 0 }, 'friend-add-stop-000001',
    ));
    expect(stop.status).toBe(409);
  });
});
