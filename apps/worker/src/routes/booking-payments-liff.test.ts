/*
 * お客さま用（LIFF）の支払いの口。
 * 本人確認は fetch stub（LINE verify は外へ出ない）。
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { saveBookingPaymentConfig } from '@line-crm/db';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(async () => ({ allowedAccountIds: ['account-a'], canSeeUnassigned: false })),
}));

const { bookingPayments } = await import('./booking-payments.js');

const LINE_USER_ID = `U${'e'.repeat(32)}`;
let sqlite: SqliteD1['raw'];
let db: D1Database;

vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  if (String(input).includes('api.line.me/oauth2/v2.1/verify')) {
    return new Response(JSON.stringify({ sub: LINE_USER_ID }), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${String(input)}`);
}));

function app() {
  const instance = new Hono<Env>();
  instance.route('/', bookingPayments);
  return instance;
}

const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' };

beforeEach(() => {
  const created = createTestD1();
  sqlite = created.raw;
  db = created.db;
  sqlite.exec(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, liff_id)
    VALUES ('account-a', 'channel-a', 'A店', 'token-a', 'secret-a', 'liff-1');
    INSERT INTO friends
      (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
    VALUES ('friend-a', '${LINE_USER_ID}', '山田', 'account-a', 1, '2026-09-01', '2026-09-01');
    INSERT INTO staff (id, line_account_id, name, display_name)
    VALUES ('staff-1', 'account-a', '担当者', '担当者');
    INSERT INTO menus
      (id, line_account_id, name, duration_minutes, base_price, version)
    VALUES ('menu-a', 'account-a', 'カット', 60, 8000, 1);
    INSERT INTO bookings
      (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
       block_ends_at, status, price_at_booking, requested_at)
    VALUES ('booking-a', 'account-a', 'friend-a', 'staff-1', 'menu-a',
      '2026-12-01T00:00:00.000Z', '2026-12-01T01:00:00.000Z', '2026-12-01T01:00:00.000Z',
      'requested', 8000, '2026-10-03T00:00:00.000Z');
    INSERT INTO bookings
      (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
       block_ends_at, status, price_at_booking, requested_at)
    VALUES ('booking-other', 'account-a', 'friend-a', 'staff-1', 'menu-a',
      '2026-12-02T00:00:00.000Z', '2026-12-02T01:00:00.000Z', '2026-12-02T01:00:00.000Z',
      'confirmed', 8000, '2026-10-03T00:00:00.000Z');
  `);
});

describe('LIFFの支払いの口', () => {
  it('自分の予約だけ始められ、状態を見られる', async () => {
    await saveBookingPaymentConfig(db, 'account-a', { mode: 'online', provider: 'stripe', holdMinutes: 30 });
    const instance = app();
    const started = await instance.request(
      '/api/liff/booking/payments/start?liffId=liff-1',
      { method: 'POST', headers, body: JSON.stringify({ bookingId: 'booking-a' }) },
      { DB: db, STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test' },
    );
    expect(started.status).toBe(201);
    const startedJson = await started.json() as {
      payment: { status: string }; checkoutUrl: string | null;
    };
    expect(startedJson.payment.status).toBe('pending');
    expect(startedJson.checkoutUrl).toContain('checkout.stripe.com/test');

    const retry = await instance.request(
      '/api/liff/booking/payments/start?liffId=liff-1',
      { method: 'POST', headers, body: JSON.stringify({ bookingId: 'booking-a' }) },
      { DB: db, STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test' },
    );
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ checkoutUrl: startedJson.checkoutUrl });

    const status = await instance.request(
      '/api/liff/booking/payments/by-booking?liffId=liff-1&bookingId=booking-a',
      { headers },
      { DB: db },
    );
    await expect(status.json()).resolves.toMatchObject({
      payment: { status: 'pending' },
    });
  });

  it('対象外の予約は始められない', async () => {
    await saveBookingPaymentConfig(db, 'account-a', { mode: 'online', provider: 'stripe', holdMinutes: 30 });
    const instance = app();
    // 確定済みは対象外
    const done = await instance.request(
      '/api/liff/booking/payments/start?liffId=liff-1',
      { method: 'POST', headers, body: JSON.stringify({ bookingId: 'booking-other' }) },
      { DB: db, STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test' },
    );
    expect(done.status).toBe(409);
    // 無い予約は404
    const missing = await instance.request(
      '/api/liff/booking/payments/by-booking?liffId=liff-1&bookingId=no-such',
      { headers },
      { DB: db },
    );
    expect(missing.status).toBe(404);
  });
});
