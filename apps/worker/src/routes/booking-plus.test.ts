/*
 * 予約の追加機能（7 売上・8 無断キャンセル）。
 * 画面は後から。API・データ・試験だけ。
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(async () => ({ allowedAccountIds: ['account-a'], canSeeUnassigned: false })),
}));

const { bookingPlus } = await import('./booking-plus.js');

let sqlite: SqliteD1['raw'];
let db: D1Database;

function staffApp(route: Hono<Env>) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role: 'owner', readOnly: false });
    return next();
  });
  instance.route('/', route);
  return instance;
}

const env = () => ({ DB: db });

const execCtx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

function seedBase() {
  sqlite.exec(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', 'A店', 'token-a', 'secret-a');
    INSERT INTO friends
      (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
    VALUES ('friend-a', 'U${'f'.repeat(32)}', '山田', 'account-a', 1, '2026-09-01', '2026-09-01');
    INSERT INTO staff (id, line_account_id, name, display_name)
    VALUES ('staff-1', 'account-a', '担当者', '担当者');
    INSERT INTO menus
      (id, line_account_id, name, duration_minutes, base_price, version)
    VALUES ('menu-a', 'account-a', 'カット', 60, 8000, 1);
    INSERT INTO staff_menus (staff_id, menu_id, is_offered)
    VALUES ('staff-1', 'menu-a', 1);
    INSERT INTO bookings
      (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
       block_ends_at, status, price_at_booking, requested_at)
    VALUES
      ('b-confirmed-1', 'account-a', 'friend-a', 'staff-1', 'menu-a',
        '2026-11-04T01:00:00.000Z', '2026-11-04T02:00:00.000Z', '2026-11-04T02:00:00.000Z',
        'confirmed', 8000, '2026-10-01'),
      ('b-confirmed-2', 'account-a', 'friend-a', 'staff-1', 'menu-a',
        '2026-11-05T01:00:00.000Z', '2026-11-05T02:00:00.000Z', '2026-11-05T02:00:00.000Z',
        'confirmed', 8000, '2026-10-01'),
      ('b-cancelled-1', 'account-a', 'friend-a', 'staff-1', 'menu-a',
        '2026-11-06T01:00:00.000Z', '2026-11-06T02:00:00.000Z', '2026-11-06T02:00:00.000Z',
        'cancelled', 8000, '2026-10-01'),
      ('b-noshow-1', 'account-a', 'friend-a', 'staff-1', 'menu-a',
        '2026-11-07T01:00:00.000Z', '2026-11-07T02:00:00.000Z', '2026-11-07T02:00:00.000Z',
        'no_show', 8000, '2026-10-01');
  `);
}

beforeEach(() => {
  vi.clearAllMocks();
  const created = createTestD1();
  sqlite = created.raw;
  db = created.db;
});

describe('7 予約からの売上', () => {
  it('件数・売上・率をメニュー別と曜日別に返す', async () => {
    seedBase();
    const response = await staffApp(bookingPlus).request(
      '/api/booking/admin/sales-summary?account_id=account-a&from=2026-11-01&to=2026-12-01',
      {},
      env(),
    );
    expect(response.status).toBe(200);
    const json = await response.json() as {
      data: {
        total: { bookings: number; confirmed: number; revenue: number; cancelRate: number; noshowRate: number; cancelled: number; noshow: number };
        menus: Array<{ menu_id: string; bookings: number; confirmed: number; revenue: number; cancelRate: number; noshowRate: number }>;
        weekdays: Array<{ weekday: number; bookings: number }>;
        revenueSource: string;
        previous: { revenue: number; bookings: number };
      };
    };
    expect(json.data.total).toEqual({
      bookings: 4, confirmed: 2, revenue: 16000, cancelRate: 0.25, noshowRate: 0.25,
      cancelled: 1, noshow: 1,
    });
    expect(json.data.menus).toHaveLength(1);
    expect(json.data.menus[0]).toMatchObject({ menu_id: 'menu-a', bookings: 4, confirmed: 2, revenue: 16000 });
    expect(json.data.weekdays.length).toBeGreaterThan(0);
    expect(json.data.revenueSource).toBe('menu');
    expect(json.data.previous).toMatchObject({ revenue: 0, bookings: 0 });
  });

  it('決済を入れた店は実際の入金で数える', async () => {
    seedBase();
    sqlite.exec(`
      INSERT INTO booking_payment_configs
        (line_account_id, mode, provider, hold_minutes, created_at, updated_at)
      VALUES ('account-a', 'online', 'none', 30, '2026-10-01', '2026-10-01');
      INSERT INTO booking_payments
        (id, line_account_id, booking_id, amount, currency, status, provider,
         idempotency_key, paid_at, created_at, updated_at)
      VALUES ('pay-1', 'account-a', 'b-confirmed-1', 5000, 'JPY', 'paid', 'none',
        'booking:b-confirmed-1', '2026-11-04T03:00:00.000Z', '2026-11-04', '2026-11-04');
    `);
    const response = await staffApp(bookingPlus).request(
      '/api/booking/admin/sales-summary?account_id=account-a&from=2026-11-01&to=2026-12-01',
      {},
      env(),
    );
    expect(response.status).toBe(200);
    const json = await response.json() as {
      data: { total: { revenue: number }; revenueSource: string };
    };
    expect(json.data.revenueSource).toBe('paid');
    expect(json.data.total.revenue).toBe(5000);
  });

  it('from・to がおかしいと400', async () => {
    seedBase();
    const response = await staffApp(bookingPlus).request(
      '/api/booking/admin/sales-summary?account_id=account-a&from=2026-12-01&to=2026-11-01',
      {},
      env(),
    );
    expect(response.status).toBe(400);
  });
});

describe('8 無断キャンセルの印と前払いのみ', () => {
  it('基準（既定3）を超えたら前払いのみ、基準を変えられる', async () => {
    seedBase();
    sqlite.exec(`
      INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
         block_ends_at, status, price_at_booking, requested_at)
      VALUES
        ('b-noshow-2', 'account-a', 'friend-a', 'staff-1', 'menu-a',
          '2026-11-08T01:00:00.000Z', '2026-11-08T02:00:00.000Z', '2026-11-08T02:00:00.000Z',
          'no_show', 8000, '2026-10-01'),
        ('b-noshow-3', 'account-a', 'friend-a', 'staff-1', 'menu-a',
          '2026-11-09T01:00:00.000Z', '2026-11-09T02:00:00.000Z', '2026-11-09T02:00:00.000Z',
          'no_show', 8000, '2026-10-01');
    `);
    const instance = staffApp(bookingPlus);
    // 種の日付は固定なので、数える期間を広げて壁時計に左右されないようにする。
    await instance.request(
      '/api/booking/admin/noshow-settings?account_id=account-a',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ windowMonths: 120 }) },
      env(),
    );
    const first = await instance.request(
      '/api/booking/admin/friends/friend-a/noshow?account_id=account-a', {}, env(),
    );
    await expect(first.json()).resolves.toMatchObject({
      success: true, data: { noshowCount: 3, threshold: 3, prepayOnly: false, manual: false },
    });
    const saved = await instance.request(
      '/api/booking/admin/noshow-settings?account_id=account-a',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threshold: 2 }) },
      env(),
    );
    await expect(saved.json()).resolves.toMatchObject({ success: true, data: { threshold: 2 } });
    const second = await instance.request(
      '/api/booking/admin/friends/friend-a/noshow?account_id=account-a', {}, env(),
    );
    await expect(second.json()).resolves.toMatchObject({
      success: true, data: { noshowCount: 3, threshold: 2, prepayOnly: true, manual: false },
    });
  });

  it('店が手で付けて外せる', async () => {
    seedBase();
    const instance = staffApp(bookingPlus);
    const set = await instance.request(
      '/api/booking/admin/friends/friend-a/prepay?account_id=account-a',
      { method: 'POST' },
      env(),
    );
    await expect(set.json()).resolves.toMatchObject({
      success: true, data: { prepayOnly: true, manual: true },
    });
    const cleared = await instance.request(
      '/api/booking/admin/friends/friend-a/prepay?account_id=account-a',
      { method: 'DELETE' },
      env(),
    );
    await expect(cleared.json()).resolves.toMatchObject({
      success: true, data: { prepayOnly: false, manual: false },
    });
  });

  it('無断が多い人も店が手で許せる（manual_off）', async () => {
    seedBase();
    sqlite.exec(`
      INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
         block_ends_at, status, price_at_booking, requested_at)
      VALUES
        ('b-noshow-2', 'account-a', 'friend-a', 'staff-1', 'menu-a',
          '2026-11-08T01:00:00.000Z', '2026-11-08T02:00:00.000Z', '2026-11-08T02:00:00.000Z',
          'no_show', 8000, '2026-10-01'),
        ('b-noshow-3', 'account-a', 'friend-a', 'staff-1', 'menu-a',
          '2026-11-09T01:00:00.000Z', '2026-11-09T02:00:00.000Z', '2026-11-09T02:00:00.000Z',
          'no_show', 8000, '2026-10-01'),
        ('b-noshow-4', 'account-a', 'friend-a', 'staff-1', 'menu-a',
          '2026-11-10T01:00:00.000Z', '2026-11-10T02:00:00.000Z', '2026-11-10T02:00:00.000Z',
          'no_show', 8000, '2026-10-01');
    `);
    const instance = staffApp(bookingPlus);
    // 種の日付は固定なので、数える期間を広げて壁時計に左右されないようにする。
    await instance.request(
      '/api/booking/admin/noshow-settings?account_id=account-a',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ windowMonths: 120 }) },
      env(),
    );
    const before = await instance.request(
      '/api/booking/admin/friends/friend-a/noshow?account_id=account-a', {}, env(),
    );
    await expect(before.json()).resolves.toMatchObject({
      success: true, data: { noshowCount: 4, prepayOnly: true, manual: false },
    });
    const forgiven = await instance.request(
      '/api/booking/admin/friends/friend-a/prepay?account_id=account-a',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'manual_off', reason: '電話で確認が取れた' }),
      },
      env(),
    );
    await expect(forgiven.json()).resolves.toMatchObject({
      success: true,
      data: {
        noshowCount: 4, prepayOnly: false, manual: true,
        lastEvent: { action: 'manual_off', reason: '電話で確認が取れた', staffName: '担当者' },
      },
    });
    const bad = await instance.request(
      '/api/booking/admin/friends/friend-a/prepay?account_id=account-a',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'auto' }),
      },
      env(),
    );
    expect(bad.status).toBe(400);
  });

  it('古い無断は数える期間の外なら数えない', async () => {
    seedBase();
    // 種の来なかった日（2026-11-07）は壁時計より後なので、ここでは
    // 今日を基準にした2件だけで数える。300日前は直近6か月の外。
    const day = 24 * 3600_000;
    const recent = new Date(Date.now() - 10 * day).toISOString();
    const old = new Date(Date.now() - 300 * day).toISOString();
    sqlite.exec(`
      INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
         block_ends_at, status, price_at_booking, requested_at)
      VALUES
        ('b-noshow-recent', 'account-a', 'friend-a', 'staff-1', 'menu-a',
          '${recent}', '${recent}', '${recent}', 'no_show', 8000, '2026-10-01'),
        ('b-noshow-old', 'account-a', 'friend-a', 'staff-1', 'menu-a',
          '${old}', '${old}', '${old}', 'no_show', 8000, '2026-10-01');
    `);
    const instance = staffApp(bookingPlus);
    const response = await instance.request(
      '/api/booking/admin/friends/friend-a/noshow?account_id=account-a', {}, env(),
    );
    const json = await response.json() as {
      data: { noshowCount: number; windowMonths: number; recentDates: string[] };
    };
    // 300日前は期間の外。10日前は必ず期間の中（種の日は壁時計しだい）。
    expect(json.data.noshowCount).toBeGreaterThanOrEqual(1);
    expect(json.data.recentDates).toContain(recent);
    expect(json.data.recentDates).not.toContain(old);
  });

  it('仕組みをオフにしたら前払いのみにしない', async () => {
    seedBase();
    const instance = staffApp(bookingPlus);
    const saved = await instance.request(
      '/api/booking/admin/noshow-settings?account_id=account-a',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false, threshold: 1, windowMonths: 12, noPaymentMode: 'notice' }),
      },
      env(),
    );
    await expect(saved.json()).resolves.toMatchObject({
      success: true,
      data: { enabled: false, threshold: 1, windowMonths: 12, noPaymentMode: 'notice' },
    });
    const response = await instance.request(
      '/api/booking/admin/friends/friend-a/noshow?account_id=account-a', {}, env(),
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true, data: { prepayOnly: false, enabled: false },
    });
  });

  it('印を外すとき理由が無いと400', async () => {
    seedBase();
    const response = await staffApp(bookingPlus).request(
      '/api/booking/admin/friends/friend-a/prepay?account_id=account-a',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'manual_off' }),
      },
      env(),
    );
    expect(response.status).toBe(400);
  });

  // 前払いの人の代理登録は確定せず案内を付ける。
  it('前払いの人の代理登録は確定せず案内を付ける', async () => {
    seedBase();
    const plus = staffApp(bookingPlus);
    await plus.request(
      '/api/booking/admin/friends/friend-a/prepay?account_id=account-a',
      { method: 'POST' },
      env(),
    );
    const startsAt = new Date();
    startsAt.setUTCDate(startsAt.getUTCDate() + 7);
    startsAt.setUTCHours(2, 0, 0, 0);
    const workDate = new Date(startsAt.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
    sqlite.exec(`INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
      VALUES ('shift-1', 'staff-1', '${workDate}', '00:00', '23:59')`);
    const { default: booking } = await import('./booking.js');
    const created = await staffApp(booking).request(
      '/api/booking/admin/bookings?account_id=account-a',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'test-prepay-1' },
        body: JSON.stringify({
          friend_id: 'friend-a', menu_id: 'menu-a', staff_id: 'staff-1',
          starts_at: startsAt.toISOString(),
        }),
      },
      { DB: db },
      execCtx,
    );
    expect(created.status).toBe(201);
    const json = await created.json() as Record<string, unknown>;
    expect(json).toMatchObject({ status: 'requested' });
    expect(json.prepayNotice).toBeTruthy();
  });
});
