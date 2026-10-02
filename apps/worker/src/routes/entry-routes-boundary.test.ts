import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

// N-011: 流入経路一覧が選択中LINEアカウントと無関係に統括全体を返す。
// 実 route＋実SQLiteで確かめる。選択accountをAPIへ渡し、DBの行と共通境界で照合する。

const { entryRoutes } = await import('./entry-routes.js');

const TENANT_B = 'tenant-B';

function app(testDb: SqliteD1, staff: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: testDb.db } as never;
    c.set('staff', staff);
    await next();
  });
  instance.route('/', entryRoutes);
  return instance;
}

const owner = (tenantId: string): AuthenticatedStaff => ({
  id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false, tenantId,
} as AuthenticatedStaff);

function seed(testDb: SqliteD1): void {
  testDb.raw.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, '既定統括'), (?, '支社')`)
    .run(DEFAULT_TENANT_ID, TENANT_B);
  for (const [id, tenant] of [['acc-1', DEFAULT_TENANT_ID], ['acc-2', DEFAULT_TENANT_ID], ['acc-b', TENANT_B]] as const) {
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
    ).run(id, `channel-${id}`, id, tenant);
  }
  const route = (id: string, account: string | null) => testDb.raw.prepare(
    `INSERT INTO entry_routes (id, ref_code, name, line_account_id, tenant_id) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, `ref-${id}`, id, account, DEFAULT_TENANT_ID);
  route('route-1', 'acc-1');
  route('route-2', 'acc-2');
  route('route-free', null);
}

describe('N-011 流入経路一覧のアカウント境界', () => {
  it('選択accountを指定すると他accountの経路を返さない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await app(testDb, owner(DEFAULT_TENANT_ID)).request('/api/entry-routes?account_id=acc-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: Array<{ id: string }> };
    expect(body.success).toBe(true);
    expect(body.data.map((item) => item.id)).toEqual(['route-1']);
  });

  it('範囲外のaccount指定は404にする', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await app(testDb, owner(DEFAULT_TENANT_ID)).request('/api/entry-routes?account_id=acc-b');
    expect(res.status).toBe(404);
  });

  it('指定なしは可視範囲だけを返す', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await app(testDb, owner(DEFAULT_TENANT_ID)).request('/api/entry-routes');
    const body = await res.json() as { success: boolean; data: Array<{ id: string }> };
    expect(body.data.map((item) => item.id).sort()).toEqual(['route-1', 'route-2', 'route-free']);
  });
});

describe('R39 選択中アカウントでの流入リンク作成', () => {
  function post(testDb: SqliteD1, body: unknown) {
    return app(testDb, owner(DEFAULT_TENANT_ID)).request('/api/entry-routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('選んだアカウントで作る→保存→一覧に出る', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const created = await post(testDb, { name: '夏の投稿', refCode: 'r39-summer', lineAccountId: 'acc-1' });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as {
      success: boolean; data: { id: string; lineAccountId: string | null };
    };
    expect(createdBody.data.lineAccountId).toBe('acc-1');

    const listed = await app(testDb, owner(DEFAULT_TENANT_ID)).request('/api/entry-routes?account_id=acc-1');
    const listedBody = await listed.json() as { success: boolean; data: Array<{ id: string }> };
    expect(listedBody.data.map((item) => item.id)).toContain(createdBody.data.id);

    const other = await app(testDb, owner(DEFAULT_TENANT_ID)).request('/api/entry-routes?account_id=acc-2');
    const otherBody = await other.json() as { success: boolean; data: Array<{ id: string }> };
    expect(otherBody.data.map((item) => item.id)).not.toContain(createdBody.data.id);
  });

  it('アカウントなしの作成は400で保存しない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await post(testDb, { name: '所属なし', refCode: 'r39-no-account' });
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; code?: string };
    expect(body.code).toBe('LINE_ACCOUNT_REQUIRED');
    const listed = await app(testDb, owner(DEFAULT_TENANT_ID)).request('/api/entry-routes');
    const listedBody = await listed.json() as { success: boolean; data: Array<{ refCode: string }> };
    expect(listedBody.data.map((item) => item.refCode)).not.toContain('r39-no-account');
  });

  it('範囲外アカウントでの作成は404で保存しない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await post(testDb, { name: '他統括', refCode: 'r39-foreign', lineAccountId: 'acc-b' });
    expect(res.status).toBe(404);
    const listed = await app(testDb, owner(DEFAULT_TENANT_ID)).request('/api/entry-routes');
    const listedBody = await listed.json() as { success: boolean; data: Array<{ refCode: string }> };
    expect(listedBody.data.map((item) => item.refCode)).not.toContain('r39-foreign');
  });
});
