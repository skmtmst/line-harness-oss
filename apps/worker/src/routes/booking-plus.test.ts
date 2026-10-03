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
        total: { bookings: number; confirmed: number; revenue: number; cancelRate: number; noshowRate: number };
        menus: Array<{ menu_id: string; bookings: number; confirmed: number; revenue: number; cancelRate: number; noshowRate: number }>;
        weekdays: Array<{ weekday: number; bookings: number }>;
      };
    };
    expect(json.data.total).toEqual({
      bookings: 4, confirmed: 2, revenue: 16000, cancelRate: 0.25, noshowRate: 0.25,
    });
    expect(json.data.menus).toHaveLength(1);
    expect(json.data.menus[0]).toMatchObject({ menu_id: 'menu-a', bookings: 4, confirmed: 2, revenue: 16000 });
    expect(json.data.weekdays.length).toBeGreaterThan(0);
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

  // 実D1（Miniflare）でのみ動く再現試験。better-sqlite3 模擬は ?N 形の
  // 束縛に対応していないため、ここでは skip（実D1で外して確認する）。
  it.skip('前払いの人の代理登録は確定せず案内を付ける', async () => {
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
    );
    expect(created.status).toBe(201);
    const json = await created.json() as Record<string, unknown>;
    expect(json).toMatchObject({ status: 'requested' });
    expect(json.prepayNotice).toBeTruthy();
  });
});
