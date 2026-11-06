import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { getLineAccountListStats } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { staff } from './staff.js';
import { access } from './access.js';

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
  app.route('/', access);
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
  account.run('account-c', 'channel-c', 'C', DEFAULT_TENANT_ID, 'hq-owner');
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

  it('counts all HQ users and explicitly assigned account members without duplicates', async () => {
    const stats = await getLineAccountListStats(testDb.db, ['account-a', 'account-b', 'account-c']);
    expect(stats['account-a']?.staffCount).toBe(3);
    expect(stats['account-b']?.staffCount).toBe(3);
    expect(stats['account-c']?.staffCount).toBe(2);
    const response = await request('hq-owner', '/api/staff?lineAccountId=account-c');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<{ id: string }> };
    expect(body.data.map((member) => member.id).sort()).toEqual(['hq-admin', 'hq-owner']);
  });

  it('inherits HQ users into a new account without membership rows, preserving roles and status', async () => {
    const insert = testDb.raw.prepare(`INSERT INTO staff_members
      (id,name,role,access_level,api_key,account_scope,tenant_id,is_active,invite_status,totp_enabled_at,totp_secret_enc)
      VALUES (?,?,?,?,?,'all',?,?,?,?,?)`);
    insert.run('hq-staff', '統括スタッフ', 'staff', 'full', 'key-staff', DEFAULT_TENANT_ID, 1, 'active', null, null);
    insert.run('hq-viewer', '統括閲覧', 'staff', 'read_only', 'key-viewer', DEFAULT_TENANT_ID, 1, 'active', null, null);
    insert.run('hq-suspended', '停止中', 'admin', 'full', 'key-suspended', DEFAULT_TENANT_ID, 0, 'active', null, null);
    insert.run('hq-invited', '招待中', 'admin', 'full', 'key-invited', DEFAULT_TENANT_ID, 0, 'pending_email', null, null);
    insert.run('foreign-hq', '別統括', 'admin', 'full', 'key-foreign', 'other-tenant', 1, 'active', null, null);
    testDb.raw.prepare(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id)
      VALUES ('new-account','new-channel','新規','token','secret',?)`).run(DEFAULT_TENANT_ID);
    testDb.raw.prepare(`UPDATE staff_members SET totp_enabled_at='2026-11-03T00:00:00Z',totp_secret_enc='enc' WHERE id='hq-owner'`).run();
    const response = await request('hq-owner', '/api/staff?lineAccountId=new-account');
    expect(response.status).toBe(200);
    const { data } = await response.json() as { data: Array<{id: string; role: string; canManageInAccount: boolean; isActive: boolean}> };
    expect(data.map(row => row.id).sort()).toEqual(['hq-admin','hq-invited','hq-owner','hq-staff','hq-suspended','hq-viewer']);
    expect(data.find(row => row.id === 'hq-admin')).toMatchObject({role:'admin',canManageInAccount:false});
    expect(data.find(row => row.id === 'hq-staff')).toMatchObject({role:'staff',canManageInAccount:false});
    expect(data.find(row => row.id === 'hq-viewer')).toMatchObject({role:'viewer',canManageInAccount:false});
    expect(data.find(row => row.id === 'hq-suspended')?.isActive).toBe(false);
    const accessResponse = await request('hq-owner', '/api/access/users?lineAccountId=new-account');
    expect(accessResponse.status).toBe(200);
    const accessData = await accessResponse.json() as {data:{items:Array<{id:string;roleBundle:string}>;summary:{active:number;mfaEnabled:number;invited:number}}};
    expect(accessData.data.summary).toMatchObject({active:4,mfaEnabled:1,invited:1});
    expect(accessData.data.items.find(row=>row.id==='hq-staff')?.roleBundle).toBe('operations');
    expect(accessData.data.items.find(row=>row.id==='hq-viewer')?.roleBundle).toBe('view_only');
    expect(accessData.data.items.map(row=>row.id).sort()).toEqual(data.map(row=>row.id).sort());
    const stats = await getLineAccountListStats(testDb.db, ['new-account']);
    expect(stats['new-account']?.staffCount).toBe(4);
    expect(testDb.raw.prepare('SELECT COUNT(*) n FROM line_account_hq_admin_memberships WHERE line_account_id=?').get('new-account')).toMatchObject({n:0});
  });

  it('reflects HQ additions and removals in existing accounts immediately', async () => {
    testDb.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,account_scope,tenant_id)
      VALUES ('added','追加した管理者','admin','key-added','all',?)`).run(DEFAULT_TENANT_ID);
    const before = await request('hq-owner','/api/staff?lineAccountId=account-c');
    expect((await before.json() as {data:Array<{id:string}>}).data.some(row=>row.id==='added')).toBe(true);
    testDb.raw.prepare(`UPDATE staff_members SET account_scope='accounts' WHERE id='added'`).run();
    const after = await request('hq-owner','/api/staff?lineAccountId=account-c');
    expect((await after.json() as {data:Array<{id:string}>}).data.some(row=>row.id==='added')).toBe(false);
    const accessResponse = await request('hq-owner','/api/access/users?lineAccountId=account-c');
    expect((await accessResponse.json() as {data:{items:Array<{id:string}>}}).data.items.some(row=>row.id==='added')).toBe(false);
    expect((await getLineAccountListStats(testDb.db,['account-c']))['account-c']?.staffCount).toBe(2);
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
