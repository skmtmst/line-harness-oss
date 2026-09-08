import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { sendAdConversions } from '../services/ad-conversion.js';
import { adPlatforms } from './ad-platforms.js';

const NOW = '2026-09-09T00:00:00+09:00';

function staff(id: string, tenantId: string, role: AuthenticatedStaff['role'] = 'owner'): AuthenticatedStaff {
  return { id, name: id, role, readOnly: false, tenantId };
}

function app(current: AuthenticatedStaff | null) {
  const instance = new Hono<Env>();
  if (current) {
    instance.use('*', async (c, next) => {
      c.set('staff', current);
      await next();
    });
  }
  instance.route('/', adPlatforms);
  return instance;
}

function seed(testDb: SqliteD1): void {
  testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1'), ('tenant-2', '統括2')`).run();
  for (const [id, tenant] of [['a1', 'tenant-1'], ['a2', 'tenant-1'], ['b1', 'tenant-2']] as const) {
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
    ).run(id, `channel-${id}`, id, tenant);
  }
  insertFriend(testDb.raw, 'f1', { line_account_id: 'a1' });
  insertFriend(testDb.raw, 'f2', { line_account_id: 'a2' });
  insertFriend(testDb.raw, 'fb', { line_account_id: 'b1' });
  testDb.raw.prepare(
    `INSERT INTO ref_tracking (id, ref_code, friend_id, fbclid, created_at) VALUES ('ref-1', 'ref-1', 'f1', 'fb-1', ?)`,
  ).run(NOW);
  for (const [id, account] of [['p1', 'a1'], ['p2', 'a2'], ['pb', 'b1']] as const) {
    testDb.raw.prepare(
      `INSERT INTO ad_platforms (id, name, display_name, config, is_active, line_account_id, created_at, updated_at)
       VALUES (?, 'meta', 'Meta広告', '{"pixel_id":"PIXEL-1","access_token":"token-1234567890"}', 1, ?, ?, ?)`,
    ).run(id, account, NOW, NOW);
  }
  testDb.raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'owner-1', 'owner', 'key-1', 'tenant-1', 'all'),
            ('owner-2', 'owner-2', 'owner', 'key-2', 'tenant-2', 'all'),
            ('scoped-1', 'scoped-1', 'owner', 'key-3', 'tenant-1', 'accounts')`,
  ).run();
  testDb.raw.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at) VALUES ('scoped-1', 'a1', ?)`,
  ).run(NOW);
}

async function idsOf(response: Response): Promise<string[]> {
  const body = await response.json() as { data: Array<{ id: string }> };
  return body.data.map((item) => item.id).sort();
}

const sentUrls: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  sentUrls.length = 0;
});

function mockFetchOk(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    sentUrls.push(url);
    return { ok: true, text: async () => 'ok' };
  }));
}

describe('広告設定ルートのアカウント境界(#638)', () => {
  it('一覧は自統括だけ。別統括の指定は403、未認証も403', async () => {
    const testDb = createTestD1();
    seed(testDb);

    expect(await idsOf(await app(staff('owner-1', 'tenant-1')).request('/api/ad-platforms', {}, { DB: testDb.db } as Env['Bindings']))).toEqual(['p1', 'p2']);
    expect(await idsOf(await app(staff('owner-2', 'tenant-2')).request('/api/ad-platforms', {}, { DB: testDb.db } as Env['Bindings']))).toEqual(['pb']);
    expect(await idsOf(await app(staff('scoped-1', 'tenant-1')).request('/api/ad-platforms', {}, { DB: testDb.db } as Env['Bindings']))).toEqual(['p1']);

    const cross = await app(staff('owner-1', 'tenant-1')).request('/api/ad-platforms?lineAccountId=b1', {}, { DB: testDb.db } as Env['Bindings']);
    expect(cross.status).toBe(403);
    const own = await app(staff('owner-1', 'tenant-1')).request('/api/ad-platforms?lineAccountId=a1', {}, { DB: testDb.db } as Env['Bindings']);
    expect(await idsOf(own)).toEqual(['p1']);
    expect((await app(null).request('/api/ad-platforms', {}, { DB: testDb.db } as Env['Bindings'])).status).toBe(403);
  });

  it('作成は帰属必須。自アカウントなら201、他統括は403', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const target = app(staff('owner-1', 'tenant-1'));
    const env = { DB: testDb.db } as Env['Bindings'];

    const missing = await target.request('/api/ad-platforms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'meta', config: {} }),
    }, env);
    expect(missing.status).toBe(400);

    const cross = await target.request('/api/ad-platforms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'meta', config: {}, lineAccountId: 'b1' }),
    }, env);
    expect(cross.status).toBe(403);

    const created = await target.request('/api/ad-platforms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'tiktok', config: { pixel_code: 'P1' }, lineAccountId: 'a1' }),
    }, env);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { data: { id: string; lineAccountId: string } };
    expect(createdBody.data.lineAccountId).toBe('a1');
    expect(await idsOf(await target.request('/api/ad-platforms?lineAccountId=a1', {}, env))).toContain(createdBody.data.id);
  });

  it('作成した自アカウント設定が送信に選ばれる', async () => {
    const testDb = createTestD1();
    seed(testDb);
    mockFetchOk();
    // 既存の a1 設定を消し、新規作成だけが選ばれる状態にする。
    const target = app(staff('owner-1', 'tenant-1'));
    const env = { DB: testDb.db } as Env['Bindings'];
    expect((await target.request('/api/ad-platforms/p1', { method: 'DELETE' }, env)).status).toBe(200);
    const created = await target.request('/api/ad-platforms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'meta', config: { pixel_id: 'NEW', access_token: 'token-1234567890' }, lineAccountId: 'a1' }),
    }, env);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { data: { id: string } };

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 100, { idempotencyKey: 'route-test:1' });

    expect(sentUrls).toHaveLength(1);
    const logRows = testDb.raw.prepare(`SELECT ad_platform_id FROM ad_conversion_logs`).all() as Array<{ ad_platform_id: string }>;
    expect(logRows).toEqual([{ ad_platform_id: createdBody.data.id }]);
  });

  it('帰属を空に戻す更新は400。同一アカウント・同一媒体の重複作成は409', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const target = app(staff('owner-1', 'tenant-1'));
    const env = { DB: testDb.db } as Env['Bindings'];

    const cleared = await target.request('/api/ad-platforms/p1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineAccountId: null }),
    }, env);
    expect(cleared.status).toBe(400);

    const dup = await target.request('/api/ad-platforms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'meta', config: {}, lineAccountId: 'a1' }),
    }, env);
    expect(dup.status).toBe(409);

    // 別アカウントの同名は作れる。
    const other = await target.request('/api/ad-platforms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'google', config: {}, lineAccountId: 'a1' }),
    }, env);
    expect(other.status).toBe(201);
  });

  it('テスト送信は友だち所属の設定を使い、認可対象と一致する', async () => {
    const testDb = createTestD1();
    seed(testDb);
    testDb.raw.prepare(`INSERT INTO ref_tracking (id, ref_code, friend_id, fbclid, created_at)
                        VALUES ('ref-2', 'ref-1', 'f2', 'fb-2', ?)`).run(NOW);
    mockFetchOk();
    const target = app(staff('owner-1', 'tenant-1'));
    const env = { DB: testDb.db } as Env['Bindings'];

    const res = await target.request('/api/ad-platforms/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'meta', eventName: 'Purchase', friendId: 'f2' }),
    }, env);
    expect(res.status).toBe(200);
    const logRows = testDb.raw.prepare(`SELECT ad_platform_id, line_account_id FROM ad_conversion_logs`).all() as Array<{
      ad_platform_id: string; line_account_id: string | null;
    }>;
    // a1 の同名設定ではなく、友だち所属(a2)の p2 で送る。
    expect(logRows).toEqual([{ ad_platform_id: 'p2', line_account_id: 'a2' }]);
  });

  it('アカウント限定の担当者は認可外の更新・削除が当たらない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const scoped = app(staff('scoped-1', 'tenant-1'));
    const env = { DB: testDb.db } as Env['Bindings'];

    const denied = await scoped.request('/api/ad-platforms/pb', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: '変' }),
    }, env);
    expect(denied.status).toBe(403);
    const deniedDel = await scoped.request('/api/ad-platforms/pb', { method: 'DELETE' }, env);
    expect(deniedDel.status).toBe(403);
    expect(testDb.raw.prepare(`SELECT display_name FROM ad_platforms WHERE id = 'pb'`).get()).toMatchObject({
      display_name: 'Meta広告',
    });

    const allowed = await scoped.request('/api/ad-platforms/p1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: '変' }),
    }, env);
    expect(allowed.status).toBe(200);
  });

  it('更新・削除は他統括・他組織の管理者でも403', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const env = { DB: testDb.db } as Env['Bindings'];
    const put = (s: AuthenticatedStaff | null, id: string, body: unknown) => app(s).request(`/api/ad-platforms/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, env);

    expect((await put(staff('owner-1', 'tenant-1'), 'p2', { displayName: '変更' })).status).toBe(200);
    expect((await put(staff('owner-1', 'tenant-1'), 'pb', { displayName: '変更' })).status).toBe(403);
    expect((await put(staff('owner-2', 'tenant-2'), 'p1', { displayName: '変更' })).status).toBe(403);
    expect((await put(staff('owner-1', 'tenant-1'), 'no-such', { displayName: '変更' })).status).toBe(404);

    const del = (s: AuthenticatedStaff | null, id: string) => app(s).request(`/api/ad-platforms/${id}`, { method: 'DELETE' }, env);
    expect((await del(staff('owner-1', 'tenant-1'), 'pb')).status).toBe(403);
    expect((await del(staff('owner-2', 'tenant-2'), 'p1')).status).toBe(403);
    expect((await del(staff('owner-1', 'tenant-1'), 'p2')).status).toBe(200);
  });

  it('ログは自統括だけ。別統括の設定ID指定は403', async () => {
    const testDb = createTestD1();
    seed(testDb);
    testDb.raw.prepare(
      `INSERT INTO ad_conversion_logs (id, ad_platform_id, friend_id, line_account_id, event_name, status, created_at)
       VALUES ('log-1', 'p1', 'f1', 'a1', 'Purchase', 'sent', ?), ('log-b', 'pb', 'fb', 'b1', 'Purchase', 'sent', ?)`,
    ).run(NOW, NOW);
    const env = { DB: testDb.db } as Env['Bindings'];

    const own = await app(staff('owner-1', 'tenant-1')).request('/api/ad-platforms/logs', {}, env);
    expect(own.status).toBe(200);
    const ownBody = await own.json() as { data: { items: Array<{ id: string }>; total: number } };
    expect(ownBody.data.items.map((item) => item.id)).toEqual(['log-1']);

    const other = await app(staff('owner-2', 'tenant-2')).request('/api/ad-platforms/logs', {}, env);
    const otherBody = await other.json() as { data: { items: Array<{ id: string }> } };
    expect(otherBody.data.items.map((item) => item.id)).toEqual(['log-b']);

    expect((await app(staff('owner-1', 'tenant-1')).request('/api/ad-platforms/pb/logs', {}, env)).status).toBe(403);
    expect((await app(staff('owner-2', 'tenant-2')).request('/api/ad-platforms/p1/logs', {}, env)).status).toBe(403);
    expect((await app(staff('owner-1', 'tenant-1')).request('/api/ad-platforms/p1/logs', {}, env)).status).toBe(200);
  });

  it('テスト送信は友だちの所属で境界を切る。他統括は送らず403', async () => {
    const testDb = createTestD1();
    seed(testDb);
    mockFetchOk();
    const target = app(staff('owner-1', 'tenant-1'));
    const env = { DB: testDb.db } as Env['Bindings'];
    const testSend = (body: unknown) => target.request('/api/ad-platforms/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, env);

    const ok = await testSend({ platform: 'meta', eventName: 'Purchase', friendId: 'f1' });
    expect(ok.status).toBe(200);
    expect(sentUrls).toHaveLength(1);

    const cross = await testSend({ platform: 'meta', eventName: 'Purchase', friendId: 'fb' });
    expect(cross.status).toBe(403);
    expect(sentUrls).toHaveLength(1);

    const missing = await testSend({ platform: 'meta', eventName: 'Purchase', friendId: 'no-such' });
    expect(missing.status).toBe(404);
    expect(sentUrls).toHaveLength(1);
  });
});
