import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { DEFAULT_TENANT_ID, type RestaurantExternalLink } from '@line-crm/shared';

const auth = vi.hoisted(() => ({ member: null as Record<string, unknown> | null }));
vi.mock('@line-crm/db', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/db')>('@line-crm/db');
  return { ...actual, getStaffByApiKey: vi.fn(async () => auth.member), getStaffByAdminSession: vi.fn(async () => auth.member) };
});
import type { Env } from '../index.js';
import { authMiddleware, sha256Hex } from '../middleware/auth.js';
import { restaurantExternalLinks } from './restaurant-external-links.js';
import { restaurantTest } from './restaurant-test.js';

let testDb: SqliteD1;
let env: Env['Bindings'];
let app: Hono<Env>;
const base = '/api/restaurant-test/external-links';
function request(method: string, id = '', body?: unknown, query = 'account_id=account-a&storeId=store-a', token = 'owner-key') {
  return app.request(`${base}${id ? `/${id}` : ''}?${query}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
}
const create = (externalId = 'board-123', reservationId = 'reservation-a', provider = 'restaurant_board') =>
  request('POST', '', { provider, externalId, reservationId, originProvider: 'hotpepper' });
async function data(response: Response): Promise<RestaurantExternalLink> {
  expect(response.status).toBeLessThan(300);
  return (await response.json() as { data: RestaurantExternalLink }).data;
}
function rows(table: string) { return testDb.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(); }
function member(role = 'staff', readOnly = false, tenant = DEFAULT_TENANT_ID) {
  auth.member = { id: 'operator', name: '担当者', role, access_level: readOnly ? 'read_only' : 'full', tenant_id: tenant, permission_keys: '[]' };
}
beforeEach(() => {
  testDb = createTestD1({ foreignKeys: true });
  // bootstrapは初期データのINSERTを省くため、633そのものも流して確認する。
  testDb.raw.exec('DROP TABLE rt_reservation_external_links');
  testDb.raw.exec(readFileSync(new URL('../../../../packages/db/migrations/633_restaurant_external_links.sql', import.meta.url), 'utf8'));
  auth.member = null;
  testDb.raw.prepare(`UPDATE tenants SET feature_packs='["restaurant"]' WHERE id=?`).run(DEFAULT_TENANT_ID);
  testDb.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES('account-hq','統括','hq','unused','unused')`).run();
  testDb.raw.prepare(`INSERT INTO rt_organizations(id,account_id,tenant_id,name) VALUES('org-hq','account-hq',?,'試験の組織')`).run(DEFAULT_TENANT_ID);
  for (const code of ['a', 'b']) {
    testDb.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES(?,?,?,?,?)`)
      .run(`account-${code}`, '試験の店舗', `channel-${code}`, 'unused', 'unused');
    testDb.raw.prepare(`INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES(?,?,?,?,?)`)
      .run(`store-${code}`, 'org-hq', '試験の店舗', code, `account-${code}`);
    testDb.raw.prepare(`INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES(?,?,?,?,?,1,4)`)
      .run(`table-${code}`, `store-${code}`, code, `卓${code}`, 'table');
    testDb.raw.prepare(`INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,table_id,line_uid)
      VALUES(?,?,'manual','試験のお客さま',2,?,?,?,?)`)
      .run(`reservation-${code}`, `store-${code}`, '2026-12-01T09:00:00Z', '2026-12-01T11:00:00Z', `table-${code}`, `U-${code}`);
    testDb.raw.prepare(`INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES(?,?,?,?)`)
      .run(`friend-${code}`, `account-${code}`, `U-${code}`, `友だち${code}`);
  }
  testDb.raw.prepare(`INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at)
    VALUES('reservation-next','store-a','phone','次のお客さま',2,'2026-12-01T12:00:00Z','2026-12-01T14:00:00Z')`).run();
  testDb.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('operator','担当者','staff','staff-key',?)`).run(DEFAULT_TENANT_ID);
  app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', restaurantExternalLinks);
  // 本体と同じ登録順。既存の予約更新後のキュー・送信へ流れないことも確かめる。
  app.route('/', restaurantTest);
  env = { DB: testDb.db, API_KEY: 'owner-key', RESTAURANT_TEST_ENABLED: 'true' } as Env['Bindings'];
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('外部通信は禁止'); }));
});
afterEach(() => { testDb.raw.close(); vi.unstubAllGlobals(); });

describe('外部予約を結ぶ仕組み（取り込み・予約更新・送信なし）', () => {
  it('同時に同じ外部IDを結んでも成功は1件だけ。前後の空白も同じID', async () => {
    const responses = await Promise.all([create(), create(' board-123 ', 'reservation-next')]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect(rows('rt_reservation_external_links')).toHaveLength(1);
    expect((await responses.find(r => r.status === 409)!.json() as { code: string }).code).toBe('duplicate_external_id');
  });
  it('結ぶ→外す→再読込→結び直す。外した後は友だち・卓も表示対象から外す', async () => {
    const link = await data(await create());
    expect(link).toMatchObject({ version: 1, status: 'linked', originProvider: 'hotpepper', reservation: {
      id: 'reservation-a', friend: { id: 'friend-a' }, tables: [{ id: 'table-a', label: '卓a' }],
    } });
    const unlinked = await data(await request('DELETE', link.id, { expectedVersion: 1 }));
    expect(unlinked).toMatchObject({ version: 2, status: 'unlinked', reservation: null });
    expect(unlinked.unlinkedAt).not.toBeNull();
    expect(await data(await request('GET', link.id))).toEqual(unlinked);
    const list = await (await request('GET')).json() as { data: { links: RestaurantExternalLink[]; total: number } };
    expect(list.data.total).toBe(1);
    expect(list.data.links[0].reservation).toBeNull();
    const reserved = await (await request('GET', '', undefined, 'account_id=account-a&storeId=store-a&reservationId=reservation-a')).json() as { data: { links: RestaurantExternalLink[] } };
    expect(reserved.data.links).toHaveLength(0);
    expect((await create()).status).toBe(409);
    const rebound = await data(await request('PATCH', link.id, { expectedVersion: 2, reservationId: 'reservation-next' }));
    expect(rebound).toMatchObject({ status: 'linked', version: 3, unlinkedAt: null, reservation: { id: 'reservation-next', friend: null, tables: [] } });
    expect(rows('rt_reservation_external_links')).toHaveLength(1);
  });
  it('同時の結び直しと解除は1件だけ成功。古い画面で上書きしない', async () => {
    const link = await data(await create());
    const responses = await Promise.all([
      request('PATCH', link.id, { expectedVersion: 1, reservationId: 'reservation-next' }),
      request('DELETE', link.id, { expectedVersion: 1 }),
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = await data(await request('GET', link.id));
    expect(winner.version).toBe(2);
    expect((await request('PATCH', link.id, { expectedVersion: 1, reservationId: 'reservation-a' })).status).toBe(409);
    expect(await data(await request('GET', link.id))).toEqual(winner);
  });
  it('外部IDの発行元と店舗を区別。同じIDを複数経路から1つの予約へ結べる', async () => {
    await data(await create());
    await data(await create('board-123', 'reservation-a', 'hotpepper'));
    await data(await request('POST', '', { provider: 'restaurant_board', externalId: 'board-123', reservationId: 'reservation-b' }, 'account_id=account-b&storeId=store-b'));
    expect(rows('rt_reservation_external_links')).toHaveLength(3);
  });
  it('認証・機能の有無・別組織・別アカウント・別店舗の予約を検査する', async () => {
    expect((await request('GET', '', undefined, undefined, 'no-key')).status).toBe(401);
    expect((await create('foreign', 'reservation-b')).status).toBe(404);
    expect((await request('GET', '', undefined, 'account_id=account-a&storeId=store-b')).status).toBe(404);
    expect((await request('GET', '', undefined, 'account_id=account-a&storeId=store-a&tenant_id=another')).status).toBe(403);
    member('admin', false, 'another');
    expect((await request('GET', '', undefined, undefined, 'staff-key')).status).toBe(404);
    auth.member = null;
    env.RESTAURANT_TEST_ENABLED = 'false';
    expect((await request('GET')).status).toBe(404);
    env.RESTAURANT_TEST_ENABLED = 'true';
    testDb.raw.prepare('UPDATE tenants SET feature_packs = ? WHERE id = ?').run('[]', DEFAULT_TENANT_ID);
    expect((await request('GET')).status).toBe(404);
  });
  it('担当者は結べる。閲覧のみは読取だけでPOST/PATCH/DELETEを拒否', async () => {
    member();
    const link = await data(await request('POST', '', { provider: 'restaurant_board', externalId: 'staff-link', reservationId: 'reservation-a' }, undefined, 'staff-key'));
    for (const role of ['staff', 'admin', 'owner']) {
      member(role, true);
      expect((await request('GET', link.id, undefined, undefined, 'staff-key')).status).toBe(200);
      for (const [method, id, body] of [
        ['POST', '', { provider: 'restaurant_board', externalId: 'blocked', reservationId: 'reservation-a' }],
        ['PATCH', link.id, { expectedVersion: 1, reservationId: 'reservation-next' }],
        ['DELETE', link.id, { expectedVersion: 1 }],
      ] as const) expect((await request(method, id, body, undefined, 'staff-key')).status).toBe(403);
    }
    expect((await data(await request('GET', link.id))).version).toBe(1);
  });
  it('選択中の店舗を越えて読まず、別店舗の対応IDも変更しない', async () => {
    const link = await data(await create());
    expect((await request('GET', link.id, undefined, 'account_id=account-b&storeId=store-b')).status).toBe(404);
    expect((await request('PATCH', link.id, { expectedVersion: 1, reservationId: 'reservation-b' }, 'account_id=account-b&storeId=store-b')).status).toBe(404);
    member();
    testDb.raw.prepare(`INSERT INTO admin_sessions(token_hash,staff_id,expires_at,selected_restaurant_store_id) VALUES(?,'operator','2099-01-01','store-b')`).run(await sha256Hex('session-test'));
    expect((await request('GET', '', undefined, undefined, 'lh_session:session-test')).status).toBe(404);
    expect((await request('GET', '', undefined, 'account_id=account-b&storeId=store-b', 'lh_session:session-test')).status).toBe(200);
  });
  it('同じ統括でも、担当するLINE公式アカウントだけを読める', async () => {
    member();
    testDb.raw.prepare("UPDATE staff_members SET account_scope='accounts' WHERE id='operator'").run();
    testDb.raw.prepare("INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES('operator','account-hq',datetime('now')),('operator','account-a',datetime('now'))").run();
    expect((await request('GET', '', undefined, undefined, 'staff-key')).status).toBe(200);
    expect((await request('GET', '', undefined, 'account_id=account-b&storeId=store-b', 'staff-key')).status).toBe(403);
    expect((await request('GET', '', undefined, 'account_id=account-hq&storeId=store-b', 'staff-key')).status).toBe(404);
  });
  it('DBでも別店舗へ結ぶことを拒否する', () => {
    expect(() => testDb.raw.prepare(`INSERT INTO rt_reservation_external_links(id,store_id,provider,external_id,reservation_id,updated_by)
      VALUES('bad','store-a','restaurant_board','bad','reservation-b','operator')`).run()).toThrow('external_link_store_mismatch');
  });
  it('旧予約に残る外部IDとも二重に結ばない', async () => {
    testDb.raw.prepare("UPDATE rt_reservations SET source='restaurant_board',external_id='legacy-123' WHERE id='reservation-a'").run();
    expect((await create('legacy-123', 'reservation-next')).status).toBe(409);
    const link = await data(await create('legacy-123'));
    expect((await request('PATCH', link.id, { expectedVersion: 1, reservationId: 'reservation-next' })).status).toBe(409);
    expect((await data(await request('GET', link.id))).reservation?.id).toBe('reservation-a');
  });
  it('予約の友だちと全卓を読む。別アカウントのUIDから友だちを推測しない', async () => {
    testDb.raw.prepare(`UPDATE rt_reservations SET line_uid='U-b' WHERE id='reservation-a'`).run();
    testDb.raw.prepare(`INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('table-extra','store-a','extra','結合卓','table',1,4)`).run();
    testDb.raw.prepare(`INSERT INTO rt_reservation_table_links(reservation_id,table_id) VALUES('reservation-a','table-extra')`).run();
    const link = await data(await create());
    expect(link.reservation?.friend).toBeNull();
    expect(link.reservation?.tables.map(t => t.id).sort()).toEqual(['table-a', 'table-extra']);
  });
  it('SQLiteの時差なしの日時もUTCとして返す', async () => {
    testDb.raw.prepare("UPDATE rt_reservations SET starts_at='2026-12-01 09:00:00',ends_at='2026-12-01 11:00:00' WHERE id='reservation-a'").run();
    const link = await data(await create());
    expect(link.reservation?.startsAt).toBe('2026-12-01T09:00:00Z');
    expect(link.reservation?.endsAt).toBe('2026-12-01T11:00:00Z');
    expect(link.updatedAt).toMatch(/Z$/);
    const unlinked = await data(await request('DELETE', link.id, { expectedVersion: 1 }));
    expect(unlinked.unlinkedAt).toMatch(/Z$/);
  });
  it('予約・全卓対応・在庫・友だち・待ち・キューを変えず、外部通信も0', async () => {
    const tables = ['rt_reservations', 'rt_reservation_table_links', 'rt_inventory_slots', 'friends', 'rt_seat_waitlist', 'rt_sync_events', 'rt_customer_notice_outbox', 'rt_inventory_rule_queue', 'visit_stamp_visit_queue'];
    const before = tables.map(rows);
    const link = await data(await create());
    await data(await request('PATCH', link.id, { expectedVersion: 1, reservationId: 'reservation-next' }));
    await data(await request('DELETE', link.id, { expectedVersion: 2 }));
    expect(tables.map(rows)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
    expect(testDb.raw.prepare("SELECT name,is_active,accepts_reservations FROM rt_media WHERE code='restaurant_board'").get())
      .toEqual({ name: 'レストランボード', is_active: 0, accepts_reservations: 0 });
  });
  it('欠けたID・型違い・未知の媒体・版なし・壊れたJSONは400で記録を増やさない', async () => {
    for (const invalid of [
      {}, { provider: 'line', externalId: '123', reservationId: 'reservation-a' },
      { provider: 'restaurant_board', externalId: [], reservationId: 'reservation-a' },
      { provider: 'restaurant_board', externalId: ' '.repeat(3), reservationId: 'reservation-a' },
      { provider: 'restaurant_board', externalId: 'x'.repeat(201), reservationId: 'reservation-a' },
      { provider: 'restaurant_board', externalId: 'bad\nvalue', reservationId: 'reservation-a' },
      { provider: 'restaurant_board', externalId: '123', reservationId: 'reservation-a', originProvider: 'unknown' },
    ]) expect((await request('POST', '', invalid)).status).toBe(400);
    const link = await data(await create());
    for (const method of ['PATCH', 'DELETE']) {
      expect((await request(method, link.id, { reservationId: 'reservation-next' })).status).toBe(400);
      const response = await app.request(`${base}/${link.id}?account_id=account-a&storeId=store-a`, { method,
        headers: { Authorization: 'Bearer owner-key', 'Content-Type': 'application/json' }, body: '{broken' }, env);
      expect(response.status).toBe(400);
    }
    expect((await request('GET', '', undefined, 'account_id=account-a&storeId=store-a&limit=-1')).status).toBe(400);
    expect(rows('rt_reservation_external_links')).toHaveLength(1);
  });
});
