import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { staff } from './staff.js';

let testDb: ReturnType<typeof createTestD1>;

function request(actorId: string, path: string, method = 'GET') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: actorId, role: 'admin', name: actorId, tenantId: DEFAULT_TENANT_ID,
      readOnly: false, permissionKeys: [], assignedLineAccountId: actorId === 'account-admin' ? 'account-a' : null,
      canAccessDescendantAccounts: false,
    });
    await next();
  });
  app.route('/', staff);
  return app.request(path, { method }, { DB: testDb.db } as Env['Bindings']);
}

beforeEach(() => {
  testDb = createTestD1({ loginPolicy: 'off' });
  const account = testDb.raw.prepare(`INSERT INTO line_accounts
    (id,channel_id,name,channel_access_token,channel_secret,tenant_id,created_by_staff_id)
    VALUES (?,? ,?,'token','secret',?,?)`);
  const member = testDb.raw.prepare(`INSERT INTO staff_members
    (id,name,email,role,api_key,account_scope,tenant_id,assigned_line_account_id)
    VALUES (?,?,?,'admin',?,?,?,?)`);
  member.run('hq-owner', '統括管理者', 'hq@example.com', 'key-hq', 'all', DEFAULT_TENANT_ID, null);
  member.run('hq-admin', '兼任管理者', 'hq-admin@example.com', 'key-hq-admin', 'all', DEFAULT_TENANT_ID, null);
  member.run('account-admin', 'A担当', 'a@example.com', 'key-a', 'accounts', DEFAULT_TENANT_ID, null);
  member.run('other-admin', 'B担当', 'b@example.com', 'key-b', 'accounts', DEFAULT_TENANT_ID, null);
  account.run('account-a', 'channel-a', 'A', DEFAULT_TENANT_ID, 'hq-owner');
  account.run('account-b', 'channel-b', 'B', DEFAULT_TENANT_ID, 'hq-owner');
  testDb.raw.prepare(`UPDATE staff_members SET assigned_line_account_id='account-a' WHERE id='account-admin'`).run();
  testDb.raw.prepare(`UPDATE staff_members SET assigned_line_account_id='account-b' WHERE id='other-admin'`).run();
  testDb.raw.prepare(`INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES (?,?,datetime('now'))`).run('account-admin', 'account-a');
  testDb.raw.prepare(`INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES (?,?,datetime('now'))`).run('other-admin', 'account-b');
  testDb.raw.prepare('INSERT INTO line_account_hq_admin_memberships(line_account_id,staff_id) VALUES (?,?)')
    .run('account-a', 'hq-admin');
});

afterEach(() => testDb.raw.close());

describe('HQ and account member boundaries', () => {
  it('returns only HQ members in the HQ list', async () => {
    const response = await request('hq-owner', '/api/staff');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<{ id: string }> };
    expect(body.data.map((member) => member.id).sort()).toEqual(['hq-admin', 'hq-owner']);
  });

  it('returns the account creator and only that account’s members', async () => {
    const response = await request('account-admin', '/api/staff?lineAccountId=account-a');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<{ id: string; isAccountCreator: boolean; role: string; canManageInAccount: boolean }> };
    expect(body.data.map((member) => member.id).sort()).toEqual(['account-admin', 'hq-admin', 'hq-owner']);
    expect(body.data.find((member) => member.id === 'hq-owner')?.isAccountCreator).toBe(true);
    expect(body.data.find((member) => member.id === 'hq-admin')).toMatchObject({ role: 'admin', canManageInAccount: false });
  });

  it('does not expose other account or HQ members by list or ID', async () => {
    expect((await request('account-admin', '/api/staff')).status).toBe(403);
    expect((await request('account-admin', '/api/staff?lineAccountId=account-b')).status).toBe(404);
    expect((await request('account-admin', '/api/staff/hq-owner')).status).toBe(404);
    expect((await request('account-admin', '/api/staff/hq-admin')).status).toBe(404);
    expect((await request('account-admin', '/api/staff/other-admin')).status).toBe(404);
    expect((await request('account-admin', '/api/staff/other-admin', 'DELETE')).status).toBe(404);
  });
});
