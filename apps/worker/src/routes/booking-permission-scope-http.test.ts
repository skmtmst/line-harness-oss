/**
 * N-411 (#866): 予約の項目別権限がルートへ接続されていることの対照試験。
 *
 * 実D1(Miniflare)で検証する:
 *   - 予約管理(booking)と予約設定(booking.settings)は別permission
 *   - メニュー(/booking/menus)と予約スタッフ(booking.settings)は別permission
 *   - 「見えるだけ」のviewキーは GET だけ通し、変更系は403
 *   - 本人勤務(booking.staff.own)は staff_member_id が一致する行だけ
 *   - 別アカウント・未紐づけ・キーなしは fail-closed
 *
 * ここでは route 側ガードを直接検証するため、middleware の permissionForApiPath
 * による第一関門は別試験(auth.test.ts 系)が担う。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { Miniflare } from 'miniflare';
import type { Env } from '../index.js';

const access = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(async (_db: unknown, _staff: unknown, ids: string[]) => (
    ids.every((id) => id === 'account-a')
  )),
}));
vi.mock('../services/account-access.js', () => access);

const { default: booking } = await import('./booking.js');
type RealD1 = Awaited<ReturnType<Miniflare['getD1Database']>>;

let mf: Miniflare;
let db: RealD1;

async function applyBootstrap(target: RealD1): Promise<void> {
  const sql = readFileSync(resolve(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8')
    .split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
  const statements = sql.split('\n').reduce<string[]>((out, line) => {
    const last = out.length - 1;
    out[last] = out[last] ? `${out[last]}\n${line}` : line;
    if (line.trimEnd().endsWith(';')) out.push('');
    return out;
  }, ['']).map((statement) => statement.trim()).filter(Boolean);
  for (let index = 0; index < statements.length; index += 50) {
    await target.batch(statements.slice(index, index + 50).map((statement) => target.prepare(statement)));
  }
}

interface StaffStub {
  id: string;
  role: 'owner' | 'admin' | 'staff';
  permissionKeys?: string[];
  viewPermissionKeys?: string[];
  readOnly?: boolean;
}

function appFor(target: D1Database, stub: StaffStub = { id: 'owner-1', role: 'owner' }) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: stub.id,
      name: stub.role,
      role: stub.role,
      readOnly: stub.readOnly ?? false,
      permissionKeys: stub.permissionKeys ?? [],
      viewPermissionKeys: stub.viewPermissionKeys ?? [],
    });
    return next();
  });
  app.route('/', booking);
  return { app, env: { DB: target } as Env['Bindings'] };
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** PUT /settings が要求する完全な body（version は呼び出し側で埋める）。 */
const SETTINGS_BODY = {
  timeZone: 'Asia/Tokyo',
  bookingWindowDays: 60,
  cutoffMinutesBefore: 1440,
  cancelDeadlineMinutesBefore: 1440,
  maxActiveBookingsPerFriend: 1,
  approvalMode: 'automatic',
  holdMinutes: 15,
  slotGranularityMinutes: 15,
};

/** 現在の settings version を取得して完全 body を返す。 */
async function settingsBody(app: Hono<Env>, env: Env['Bindings'], accountId = 'account-a') {
  const res = await app.request(`/api/booking/admin/settings?account_id=${accountId}`, {}, env);
  const body = await res.json() as { success: boolean; data: { version: number } };
  return { ...SETTINGS_BODY, expectedVersion: body.data.version };
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
  });
  db = await mf.getD1Database('DB');
  await applyBootstrap(db);
  await db.batch([
    db.prepare(`INSERT INTO line_accounts
      (id,channel_id,name,channel_access_token,channel_secret)
      VALUES ('account-a','channel-a','A店','token','secret')`),
    db.prepare(`INSERT INTO line_accounts
      (id,channel_id,name,channel_access_token,channel_secret)
      VALUES ('account-b','channel-b','B店','token','secret')`),
    db.prepare(`INSERT INTO staff_members (id,name,email,role,api_key,is_active)
      VALUES ('member-self','本人','self@example.com','staff','key-self',1)`),
    db.prepare(`INSERT INTO staff_members (id,name,email,role,api_key,is_active)
      VALUES ('member-other','他人','other@example.com','staff','key-other',1)`),
    // member-self に紐づく予約スタッフ / 無紐づけの他人の予約スタッフ / 別アカウント
    db.prepare(`INSERT INTO staff (id,line_account_id,name,display_name,staff_member_id)
      VALUES ('staff-own','account-a','自分','じぶん','member-self')`),
    db.prepare(`INSERT INTO staff (id,line_account_id,name,display_name,staff_member_id)
      VALUES ('staff-other','account-a','他人','たにん','member-other')`),
    db.prepare(`INSERT INTO staff (id,line_account_id,name,display_name,staff_member_id)
      VALUES ('staff-unlinked','account-a','未紐','みひも',NULL)`),
    db.prepare(`INSERT INTO staff (id,line_account_id,name,display_name,staff_member_id)
      VALUES ('staff-b','account-b','別店','べつ','member-self')`),
  ]);
}, 120_000);

afterAll(async () => { await mf?.dispose(); });

beforeEach(async () => {
  await db.prepare('DELETE FROM staff_shifts').run();
  // 試験で増えた予約スタッフを戻し、fixtureの紐づけ状態を固定する。
  await db.prepare(`DELETE FROM staff WHERE id NOT IN ('staff-own','staff-other','staff-unlinked','staff-b')`).run();
  await db.prepare(`UPDATE staff SET staff_member_id = 'member-self', deleted_at = NULL WHERE id = 'staff-own'`).run();
  access.canAccessAllLineAccounts.mockClear();
});

describe('N-411 予約設定は予約管理とは別permission', () => {
  test('予約管理editだけでは設定を変更できない。booking.settings の edit が要る', async () => {
    const bookingOnly = appFor(db, { id: 's1', role: 'staff', permissionKeys: ['/booking/bookings'] });
    const denied = await bookingOnly.app.request('/api/booking/admin/settings?account_id=account-a', {
      method: 'PUT', headers: JSON_HEADERS,
      body: JSON.stringify(await settingsBody(bookingOnly.app, bookingOnly.env)),
    }, bookingOnly.env);
    expect(denied.status).toBe(403);

    const settingsEditor = appFor(db, { id: 's2', role: 'staff', permissionKeys: ['booking.settings'] });
    const allowed = await settingsEditor.app.request('/api/booking/admin/settings?account_id=account-a', {
      method: 'PUT', headers: JSON_HEADERS,
      body: JSON.stringify(await settingsBody(settingsEditor.app, settingsEditor.env)),
    }, settingsEditor.env);
    expect([200, 201]).toContain(allowed.status);
  });

  test('booking.settings の viewキーは GET を通すが PUT は403', async () => {
    const viewer = appFor(db, { id: 's3', role: 'staff', viewPermissionKeys: ['booking.settings'] });
    const got = await viewer.app.request('/api/booking/admin/settings?account_id=account-a', {}, viewer.env);
    expect(got.status).toBe(200);
    const denied = await viewer.app.request('/api/booking/admin/settings?account_id=account-a', {
      method: 'PUT', headers: JSON_HEADERS,
      body: JSON.stringify(await settingsBody(viewer.app, viewer.env)),
    }, viewer.env);
    expect(denied.status).toBe(403);
  });

  test('設備・例外の変更も booking.settings の edit が要る', async () => {
    const bookingOnly = appFor(db, { id: 's4', role: 'staff', permissionKeys: ['/booking/bookings', '/booking/menus'] });
    for (const [method, path, body] of [
      ['POST', '/api/booking/admin/resources', { name: '個室', type: 'room', capacity: 1 }],
      ['POST', '/api/booking/admin/exceptions', { scopeKind: 'store', dateFrom: '2030-01-01', dateTo: '2030-01-01', kind: 'closed', intervals: [] }],
    ] as const) {
      const res = await bookingOnly.app.request(`${path}?account_id=account-a`, {
        method, headers: JSON_HEADERS, body: JSON.stringify(body),
      }, bookingOnly.env);
      expect(res.status).toBe(403);
    }
    const editor = appFor(db, { id: 's5', role: 'staff', permissionKeys: ['booking.settings'] });
    const created = await editor.app.request('/api/booking/admin/resources?account_id=account-a', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ name: '個室', type: 'room', capacity: 1 }),
    }, editor.env);
    expect(created.status).toBe(201);
  });
});

describe('N-411 メニューと予約スタッフは別permission', () => {
  test('booking.settings だけではメニューを作れず、/booking/menus が要る', async () => {
    const settingsOnly = appFor(db, { id: 's6', role: 'staff', permissionKeys: ['booking.settings'] });
    const denied = await settingsOnly.app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'カット', duration_minutes: 60, base_price: 5000 }),
    }, settingsOnly.env);
    expect(denied.status).toBe(403);
  });

  test('/booking/menus の viewキーは一覧GETを通すが作成は403', async () => {
    const viewer = appFor(db, { id: 's7', role: 'staff', viewPermissionKeys: ['/booking/menus'] });
    const listed = await viewer.app.request('/api/booking/admin/menus?account_id=account-a', {}, viewer.env);
    expect(listed.status).toBe(200);
    const denied = await viewer.app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'カット', duration_minutes: 60, base_price: 5000 }),
    }, viewer.env);
    expect(denied.status).toBe(403);
  });

  test('予約スタッフの登録・変更・削除は booking.settings の edit が要る', async () => {
    const menusOnly = appFor(db, { id: 's8', role: 'staff', permissionKeys: ['/booking/menus'] });
    const denied = await menusOnly.app.request('/api/booking/admin/staff?account_id=account-a', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'x', display_name: 'x' }),
    }, menusOnly.env);
    expect(denied.status).toBe(403);

    const editor = appFor(db, { id: 's9', role: 'staff', permissionKeys: ['booking.settings'] });
    const created = await editor.app.request('/api/booking/admin/staff?account_id=account-a', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'sato', display_name: '佐藤', staff_member_id: 'member-self' }),
    }, editor.env);
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const row = await db.prepare('SELECT staff_member_id FROM staff WHERE id = ?').bind(id).first<{ staff_member_id: string | null }>();
    expect(row?.staff_member_id).toBe('member-self');
  });

  test('存在しない・停止済みのログインユーザーへは紐づけられない(422)', async () => {
    const owner = appFor(db);
    const bad = await owner.app.request('/api/booking/admin/staff?account_id=account-a', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'x', display_name: 'x', staff_member_id: 'member-missing' }),
    }, owner.env);
    expect(bad.status).toBe(422);

    const unlink = await owner.app.request('/api/booking/admin/staff/staff-own?account_id=account-a', {
      method: 'PUT', headers: JSON_HEADERS,
      body: JSON.stringify({ staff_member_id: null }),
    }, owner.env);
    expect(unlink.status).toBe(200);
    const row = await db.prepare('SELECT staff_member_id FROM staff WHERE id = ?').bind('staff-own').first<{ staff_member_id: string | null }>();
    expect(row?.staff_member_id).toBeNull();
    // 後続の試験のため紐づけを戻す
    await db.prepare(`UPDATE staff SET staff_member_id = 'member-self' WHERE id = 'staff-own'`).run();
  });
});

describe('N-411 本人勤務(booking.staff.own)', () => {
  const ownStaff = () => appFor(db, { id: 'member-self', role: 'staff', permissionKeys: ['booking.staff.own'] });

  test('/staff/me は自分に紐づく予約スタッフだけを返す', async () => {
    const { app, env } = ownStaff();
    const res = await app.request('/api/booking/admin/staff/me?account_id=account-a', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { staff: Array<{ id: string }> };
    expect(body.staff.map((s) => s.id)).toEqual(['staff-own']);

    // account 未指定なら紐づく全件（別アカウントの自分分も含む）
    const all = await app.request('/api/booking/admin/staff/me', {}, env);
    const allBody = await all.json() as { staff: Array<{ id: string }> };
    expect(allBody.staff.map((s) => s.id).sort()).toEqual(['staff-b', 'staff-own']);
  });

  test('本人のシフトは読み書きできるが、他人・未紐づけは403', async () => {
    const { app, env } = ownStaff();
    const ownGet = await app.request('/api/booking/admin/staff/staff-own/shifts?account_id=account-a', {}, env);
    expect(ownGet.status).toBe(200);

    const otherGet = await app.request('/api/booking/admin/staff/staff-other/shifts?account_id=account-a', {}, env);
    expect(otherGet.status).toBe(403);
    const unlinkedGet = await app.request('/api/booking/admin/staff/staff-unlinked/shifts?account_id=account-a', {}, env);
    expect(unlinkedGet.status).toBe(403);

    const ownPut = await app.request('/api/booking/admin/staff/staff-own/shifts?account_id=account-a', {
      method: 'PUT', headers: JSON_HEADERS,
      body: JSON.stringify({ shifts: [{ work_date: '2030-01-06', start_time: '09:00', end_time: '18:00' }] }),
    }, env);
    expect(ownPut.status).toBe(200);

    const otherPut = await app.request('/api/booking/admin/staff/staff-other/shifts?account_id=account-a', {
      method: 'PUT', headers: JSON_HEADERS,
      body: JSON.stringify({ shifts: [{ work_date: '2030-01-06', start_time: '09:00', end_time: '18:00' }] }),
    }, env);
    expect(otherPut.status).toBe(403);
  });

  test('viewキーは本人のGETだけ通し、本人へのPUTは403', async () => {
    const viewer = appFor(db, { id: 'member-self', role: 'staff', viewPermissionKeys: ['booking.staff.own'] });
    const got = await viewer.app.request('/api/booking/admin/staff/staff-own/shifts?account_id=account-a', {}, viewer.env);
    expect(got.status).toBe(200);
    const put = await viewer.app.request('/api/booking/admin/staff/staff-own/shifts?account_id=account-a', {
      method: 'PUT', headers: JSON_HEADERS,
      body: JSON.stringify({ shifts: [{ work_date: '2030-01-07', start_time: '09:00', end_time: '18:00' }] }),
    }, viewer.env);
    expect(put.status).toBe(403);
  });

  test('キー無しのstaffは本人レコードへも403（deny-by-default）', async () => {
    const noKey = appFor(db, { id: 'member-self', role: 'staff' });
    const res = await noKey.app.request('/api/booking/admin/staff/staff-own/shifts?account_id=account-a', {}, noKey.env);
    expect(res.status).toBe(403);
  });

  test('別アカウントの同名紐づけは別物。account-aの口からB店の行は404', async () => {
    const { app, env } = ownStaff();
    // staff-b は account-b にあり member-self 紐づけだが、account-a の口からは見えない
    const res = await app.request('/api/booking/admin/staff/staff-b/shifts?account_id=account-a', {}, env);
    expect(res.status).toBe(404);
  });

  test('owner/admin は全員分を通す（従来どおり）', async () => {
    const owner = appFor(db);
    const res = await owner.app.request('/api/booking/admin/staff/staff-other/shifts?account_id=account-a', {}, owner.env);
    expect(res.status).toBe(200);
  });

  test('休憩・外部連携・勤務ルールも同じ本人ガードで守られる', async () => {
    const { app, env } = ownStaff();
    for (const sub of ['availability-rules', 'breaks', 'break-dates', 'google-calendar']) {
      const own = await app.request(`/api/booking/admin/staff/staff-own/${sub}?account_id=account-a`, {}, env);
      expect(own.status, `${sub} own GET`).toBe(200);
      const other = await app.request(`/api/booking/admin/staff/staff-other/${sub}?account_id=account-a`, {}, env);
      expect(other.status, `${sub} other GET`).toBe(403);
    }
  });
});
