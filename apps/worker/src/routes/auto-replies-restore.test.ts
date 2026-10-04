import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { autoReplies } from './auto-replies.js';

const admin: AuthenticatedStaff = {
  id: 'admin-1',
  name: '管理者',
  role: 'admin',
  readOnly: false,
  tenantId: 'tenant-1',
};

function app(db: D1Database, currentStaff: AuthenticatedStaff = admin) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', currentStaff);
    await next();
  });
  instance.route('/', autoReplies);
  return { instance, bindings: { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings'] };
}

function insertRule(raw: SqliteD1['raw'], id: string, keyword: string) {
  raw.prepare(
    `INSERT INTO auto_replies
       (id, keyword, match_type, response_content, line_account_id, is_active,
        priority, lifecycle_status, name, created_at)
     VALUES (?, ?, 'contains', '返信', 'account-1', 1, 1, 'published', ?, '2026-09-01T00:00:00.000')`,
  ).run(id, keyword, `${keyword}受付`);
}

describe('B 元に戻す: 削除した自動応答の復活', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
    testDb.raw.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES ('account-1', 'channel-1', '店舗1', '', '', 1, 'tenant-1')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO staff_members
         (id, name, role, api_key, permission_keys, tenant_id, account_scope)
       VALUES ('admin-1', '管理者', 'admin', 'admin-key', '[]', 'tenant-1', 'all')`,
    ).run();
    insertRule(testDb.raw, 'rule-1', '予約');
  });

  const remove = (target: ReturnType<typeof app>, id: string) =>
    target.instance.request(`/api/auto-replies/${id}`, { method: 'DELETE' }, target.bindings);

  const restore = (target: ReturnType<typeof app>, id: string) =>
    target.instance.request(`/api/auto-replies/${id}/restore`, { method: 'POST' }, target.bindings);

  it('削除→復活で一覧に戻り、戻した直後は停止のまま', async () => {
    const target = app(testDb.db);
    expect((await remove(target, 'rule-1')).status).toBe(200);

    const response = await restore(target, 'rule-1');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { id: string; isActive: boolean } };
    expect(body.data.id).toBe('rule-1');
    // 戻した瞬間に送り出さない。停止のまま返す。
    expect(body.data.isActive).toBe(false);

    const row = testDb.raw.prepare(
      `SELECT deleted_at, deleted_by_staff_id, is_active FROM auto_replies WHERE id = 'rule-1'`,
    ).get() as { deleted_at: string | null; deleted_by_staff_id: string | null; is_active: number };
    expect(row.deleted_at).toBeNull();
    expect(row.deleted_by_staff_id).toBeNull();
    expect(row.is_active).toBe(0);

    // 一覧に再び出る。
    const list = await target.instance.request('/api/auto-replies', {}, target.bindings);
    const listBody = await list.json() as { data: Array<{ id: string }> };
    expect(listBody.data.some((item) => item.id === 'rule-1')).toBe(true);
  });

  it('消していない行・無い行の復活は404', async () => {
    const target = app(testDb.db);
    expect((await restore(target, 'rule-1')).status).toBe(404);
    expect((await restore(target, 'no-such-rule')).status).toBe(404);
    // 二重の復活も404（deleted_at が空の行は対象外）。
    expect((await remove(target, 'rule-1')).status).toBe(200);
    expect((await restore(target, 'rule-1')).status).toBe(200);
    expect((await restore(target, 'rule-1')).status).toBe(404);
  });
});
