import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

// N-237: 決めごとのCSVがブラウザ生成で権限・監査を通らない。
// 実 route＋実SQLiteで確かめる。許可scope内の決めごとだけをサーバー側でCSV化し、
// 既存の監査契約へ記録する。

const { scoring } = await import('./scoring.js');

const TENANT_B = 'tenant-B';

function app(testDb: SqliteD1, staff: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: testDb.db } as never;
    c.set('staff', staff);
    await next();
  });
  instance.route('/', scoring);
  return instance;
}

const owner = (tenantId: string): AuthenticatedStaff => ({
  id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false, tenantId,
} as AuthenticatedStaff);

function draftJson(name: string): string {
  return JSON.stringify({
    name, eventType: 'friend_added', source: null, amount: 10,
    initialStatus: 'available', validFrom: null, validUntil: null,
    expiresAfterDays: null, cancellationEventTypes: [], targetConditions: null, sortOrder: 0,
  });
}

function seed(testDb: SqliteD1): void {
  testDb.raw.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, '既定統括'), (?, '支社')`)
    .run(DEFAULT_TENANT_ID, TENANT_B);
  for (const [id, tenant] of [['acc-1', DEFAULT_TENANT_ID], ['acc-b', TENANT_B]] as const) {
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
    ).run(id, `channel-${id}`, id, tenant);
  }
  testDb.raw.prepare(`INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
    VALUES ('prog-1', 'default', '通常', '2026-09-01', '2026-09-01')`).run();
  const rule = (id: string, account: string) => {
    testDb.raw.prepare(`INSERT INTO mileage_rules (id, program_id, name, event_type, amount, line_account_id, created_at, updated_at)
      VALUES (?, 'prog-1', ?, 'friend_added', 10, ?, '2026-09-01', '2026-09-01')`)
      .run(id, `決めごと-${id}`, account);
    testDb.raw.prepare(`INSERT INTO mileage_earning_rule_drafts (rule_id, line_account_id, version, draft_json)
      VALUES (?, ?, 1, ?)`)
      .run(id, account, draftJson(`決めごと-${id}`));
  };
  rule('rule-1', 'acc-1');
  rule('rule-b', 'acc-b');
}

describe('N-237 決めごとCSVのサーバー化', () => {
  it('許可scope内の決めごとだけをCSVにする', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await app(testDb, owner(DEFAULT_TENANT_ID))
      .request('/api/mileage/rules/export?accountId=acc-1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text).toContain('決めごと-rule-1');
    expect(text).not.toContain('rule-b');
    expect(text.split('\r\n')[0]).toContain('決めごと');
  });

  it('範囲外のaccount指定は404にする', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await app(testDb, owner(DEFAULT_TENANT_ID))
      .request('/api/mileage/rules/export?accountId=acc-b');
    expect(res.status).toBe(404);
  });

  it('書き出しを監査へ記録する', async () => {
    const testDb = createTestD1();
    seed(testDb);
    await app(testDb, owner(DEFAULT_TENANT_ID)).request('/api/mileage/rules/export?accountId=acc-1');
    const row = testDb.raw.prepare(
      `SELECT action, target_kind FROM audit_events WHERE action = 'mileage.rule.export'`,
    ).get() as { action: string; target_kind: string } | undefined;
    expect(row?.action).toBe('mileage.rule.export');
  });
});
