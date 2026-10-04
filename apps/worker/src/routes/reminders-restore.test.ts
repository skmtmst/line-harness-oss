import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { reminders } from './reminders.js';

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
  instance.route('/', reminders);
  return { instance, bindings: { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings'] };
}

describe('B 元に戻す: 削除したリマインダ定義の復活', () => {
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
    testDb.raw.prepare(
      `INSERT INTO reminders (id, name, line_account_id, trigger_type, lifecycle_status)
       VALUES ('reminder-1', '来店のお知らせ', 'account-1', 'manual', 'published')`,
    ).run();
  });

  const remove = (target: ReturnType<typeof app>, id: string) =>
    target.instance.request(`/api/reminders/${id}`, { method: 'DELETE' }, target.bindings);

  const restore = (target: ReturnType<typeof app>, id: string) =>
    target.instance.request(`/api/reminders/${id}/restore`, { method: 'POST' }, target.bindings);

  it('削除→復活で定義が戻り、戻した直後は停止のまま', async () => {
    const target = app(testDb.db);
    expect((await remove(target, 'reminder-1')).status).toBe(200);

    const response = await restore(target, 'reminder-1');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { id: string; name: string; isActive: boolean } };
    expect(body.data.id).toBe('reminder-1');
    expect(body.data.isActive).toBe(false);

    const row = testDb.raw.prepare(
      `SELECT deleted_at, is_active, lifecycle_status FROM reminders WHERE id = 'reminder-1'`,
    ).get() as { deleted_at: string | null; is_active: number; lifecycle_status: string };
    expect(row.deleted_at).toBeNull();
    expect(row.is_active).toBe(0);
    expect(row.lifecycle_status).toBe('stopped');
  });

  it('消していない行・無い行の復活は404。二重の復活も404', async () => {
    const target = app(testDb.db);
    expect((await restore(target, 'reminder-1')).status).toBe(404);
    expect((await restore(target, 'no-such-reminder')).status).toBe(404);
    expect((await remove(target, 'reminder-1')).status).toBe(200);
    expect((await restore(target, 'reminder-1')).status).toBe(200);
    expect((await restore(target, 'reminder-1')).status).toBe(404);
  });
});
