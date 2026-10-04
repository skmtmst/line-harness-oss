import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { webhooks } from './webhooks.js';

const owner: AuthenticatedStaff = {
  id: 'owner-1',
  name: '所有者',
  role: 'owner',
  readOnly: false,
  tenantId: 'tenant-1',
};

function app(db: D1Database, currentStaff: AuthenticatedStaff = owner) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', currentStaff);
    await next();
  });
  instance.route('/', webhooks);
  return { instance, bindings: { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings'] };
}

describe('B 元に戻す: 削除したWebhookの復活', () => {
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
       VALUES ('owner-1', '所有者', 'owner', 'owner-key', '[]', 'tenant-1', 'all')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO incoming_webhooks (id, name, source_type, line_account_id, is_active)
       VALUES ('incoming-1', '受信1', 'custom', 'account-1', 1)`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO outgoing_webhooks (id, name, url, event_types, line_account_id, is_active)
       VALUES ('outgoing-1', '送信1', 'https://example.test/hook', '["message"]', 'account-1', 1)`,
    ).run();
  });

  const del = (target: ReturnType<typeof app>, kind: 'incoming' | 'outgoing', id: string) =>
    target.instance.request(
      `/api/webhooks/${kind}/${id}?lineAccountId=account-1`,
      { method: 'DELETE' },
      target.bindings,
    );

  const restore = (target: ReturnType<typeof app>, kind: 'incoming' | 'outgoing', id: string) =>
    target.instance.request(
      `/api/webhooks/${kind}/${id}/restore?lineAccountId=account-1`,
      { method: 'POST' },
      target.bindings,
    );

  it('受信の削除→復活で戻り、戻した直後は停止のまま', async () => {
    const target = app(testDb.db);
    expect((await del(target, 'incoming', 'incoming-1')).status).toBe(200);

    const response = await restore(target, 'incoming', 'incoming-1');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { id: string; isActive: boolean } };
    expect(body.data.id).toBe('incoming-1');
    expect(body.data.isActive).toBe(false);

    const row = testDb.raw.prepare(
      `SELECT deleted_at, is_active FROM incoming_webhooks WHERE id = 'incoming-1'`,
    ).get() as { deleted_at: string | null; is_active: number };
    expect(row.deleted_at).toBeNull();
    expect(row.is_active).toBe(0);
  });

  it('送信の削除→復活で戻り、戻した直後は停止のまま', async () => {
    const target = app(testDb.db);
    expect((await del(target, 'outgoing', 'outgoing-1')).status).toBe(200);

    const response = await restore(target, 'outgoing', 'outgoing-1');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { id: string; isActive: boolean } };
    expect(body.data.id).toBe('outgoing-1');
    expect(body.data.isActive).toBe(false);

    const row = testDb.raw.prepare(
      `SELECT deleted_at, is_active FROM outgoing_webhooks WHERE id = 'outgoing-1'`,
    ).get() as { deleted_at: string | null; is_active: number };
    expect(row.deleted_at).toBeNull();
    expect(row.is_active).toBe(0);
  });

  it('消していない行・無い行の復活は404。アカウント無指定は400', async () => {
    const target = app(testDb.db);
    expect((await restore(target, 'incoming', 'incoming-1')).status).toBe(404);
    expect((await restore(target, 'outgoing', 'no-such-hook')).status).toBe(404);
    const noAccount = await target.instance.request(
      '/api/webhooks/incoming/incoming-1/restore',
      { method: 'POST' },
      target.bindings,
    );
    expect(noAccount.status).toBe(400);
  });
});
