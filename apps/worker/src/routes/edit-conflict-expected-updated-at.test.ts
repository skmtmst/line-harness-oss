/*
 * 同時編集の見分けは「最後に直した日時で比べる」。
 * 予約設定・予約メニュー・ウェビナー編集の更新口は、読んだときの更新日時
 * expectedUpdatedAt を任意で受ける。違えば409と今の中身を返し、
 * 同じなら保存、送らなければ今までどおり保存する。
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';

vi.mock('../services/account-access.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, canAccessAllLineAccounts: vi.fn(async () => true) };
});

const { default: booking } = await import('./booking.js');
const { webinarRoutes } = await import('./webinars.js');

let sqlite: SqliteD1['raw'];
let db: D1Database;

function staffApp(route: Hono<Env>) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', route);
  return app;
}

const SETTINGS_BODY = {
  expectedVersion: 0,
  timeZone: 'Asia/Tokyo',
  bookingWindowDays: 60,
  cutoffMinutesBefore: 1440,
  cancelDeadlineMinutesBefore: 1440,
  maxActiveBookingsPerFriend: 1,
  approvalMode: 'automatic',
  holdMinutes: 15,
  slotGranularityMinutes: 15,
};

beforeEach(() => {
  const created = createTestD1();
  sqlite = created.raw;
  db = created.db;
  sqlite.exec(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', 'A店', 'token-a', 'secret-a');
    INSERT INTO menus
      (id, line_account_id, name, duration_minutes, base_price, version, updated_at)
    VALUES ('menu-a', 'account-a', 'カット', 60, 8000, 1, '2026-10-01T00:00:00.000');
    INSERT INTO webinars
      (id, account_id, title, slug, created_at, updated_at)
    VALUES ('webinar-a', 'account-a', '説明会', 'setsumei', '2026-10-01', '2026-10-01');
  `);
});

describe('同時編集は更新日時で見分ける', () => {
  it('予約設定：違えば409で今の中身を返し、書き換えない', async () => {
    const app = staffApp(booking as Hono<Env>);
    const env = { DB: db };
    const created = await app.request('/api/booking/admin/settings?account_id=account-a', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SETTINGS_BODY),
    }, env);
    expect(created.status).toBe(201);

    const stale = await app.request('/api/booking/admin/settings?account_id=account-a', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...SETTINGS_BODY, expectedVersion: 1, bookingWindowDays: 90,
        expectedUpdatedAt: '2000-01-01T00:00:00.000',
      }),
    }, env);
    expect(stale.status).toBe(409);
    const json = await stale.json() as Record<string, unknown>;
    expect(json).toMatchObject({ success: false, code: 'VERSION_CONFLICT' });
    expect((json.data as Record<string, unknown>).latest).toMatchObject({ lineAccountId: 'account-a' });
    expect(sqlite.prepare(
      `SELECT booking_window_days FROM booking_settings WHERE line_account_id = 'account-a'`,
    ).get()).toEqual({ booking_window_days: 60 });
  });

  it('予約メニュー：同じなら保存する', async () => {
    const app = staffApp(booking as Hono<Env>);
    const env = { DB: db };
    const response = await app.request('/api/booking/admin/menus/menu-a?account_id=account-a', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'カット', duration_minutes: 60, base_price: 8000,
        expectedVersion: 1, expectedUpdatedAt: '2026-10-01T00:00:00.000',
      }),
    }, env);
    expect(response.status).toBe(200);
    expect(sqlite.prepare(
      `SELECT version FROM menus WHERE id = 'menu-a'`,
    ).get()).toEqual({ version: 2 });
  });

  it('ウェビナー編集：送らなければ今までどおり保存する', async () => {
    const app = staffApp(webinarRoutes as Hono<Env>);
    const env = { DB: db };
    const response = await app.request('/api/webinars/webinar-a/editor', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 0, publicDescription: 'ようこそ' }),
    }, env);
    expect(response.status).toBe(200);
    expect(sqlite.prepare(
      `SELECT version FROM webinar_editor_settings WHERE webinar_id = 'webinar-a'`,
    ).get()).toEqual({ version: 1 });
  });
});
