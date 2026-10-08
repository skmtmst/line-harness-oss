/*
 * 予約の支払い（決済サービスを差し替えられる作り）。
 * 外へ通信しない。Stripeは署名付きの試験の知らせで進める。
 * 本物のお金は動かさない。
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { saveBookingPaymentConfig } from '@line-crm/db';
import { registerTestPaymentProvider } from './booking-payments.js';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(async () => ({ allowedAccountIds: ['account-a'], canSeeUnassigned: false })),
}));

const { bookingPayments } = await import('./booking-payments.js');

const WEBHOOK_SECRET = 'whsec_test_1234567890';
let sqlite: SqliteD1['raw'];
let db: D1Database;

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role: 'owner', readOnly: false });
    return next();
  });
  instance.route('/', bookingPayments);
  return instance;
}

function env(extra: Record<string, unknown> = {}) {
  return { DB: db, STRIPE_TEST_WEBHOOK_SECRET: WEBHOOK_SECRET, ...extra };
}

function seedBooking(status = 'requested') {
  sqlite.exec(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', 'A店', 'token-a', 'secret-a');
    INSERT INTO friends
      (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
    VALUES ('friend-a', 'U${'d'.repeat(32)}', '山田', 'account-a', 1, '2026-09-01', '2026-09-01');
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
      '${status}', 8000, '2026-10-03T00:00:00.000Z');
  `);
}

async function stripeSignature(rawBody: string): Promise<string> {
  const t = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`),
  ));
  const v1 = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${v1}`;
}

const paidEvent = (providerPaymentId: string) => JSON.stringify({
  id: 'evt-test-1',
  type: 'payment_intent.succeeded',
  data: { object: { id: providerPaymentId } },
});

beforeEach(() => {
  vi.clearAllMocks();
  const created = createTestD1();
  sqlite = created.raw;
  db = created.db;
});

describe('予約の支払いの共通口', () => {
  it('同じ申込の再試行は最初の決済URLと同じ支払い記録を返す', async () => {
    seedBooking();
    await saveBookingPaymentConfig(db, 'account-a', { mode: 'online', provider: 'stripe', holdMinutes: 30 });
    const request = () => app().request('/api/booking/payments/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: 'booking-a' }),
    }, env());
    const first = await request();
    const initial = await first.json() as { data: { payment: { id: string }; checkoutUrl: string } };
    expect(first.status).toBe(201);
    const retry = await request();
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ data: {
      payment: { id: initial.data.payment.id }, checkoutUrl: initial.data.checkoutUrl,
    } });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM booking_payments').get()).toEqual({ n: 1 });
  });

  it('何も決めていない店はお支払いなしで鍵も入っていない', async () => {
    seedBooking();
    const response = await app().request(
      '/api/booking/admin/payment-config?account_id=account-a', {}, env(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { mode: 'none', provider: 'none', keyConfigured: true },
    });
  });

  it('Stripe試験：始める→知らせ→支払い済み→確定、二重の知らせは受け付け済み', async () => {
    seedBooking();
    const instance = app();
    const put = await instance.request(
      '/api/booking/admin/payment-config?account_id=account-a',
      {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'online', provider: 'stripe', holdMinutes: 30 }),
      },
      env(),
    );
    expect(put.status).toBe(200);

    const started = await instance.request('/api/booking/payments/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: 'booking-a' }),
    }, env());
    expect(started.status).toBe(201);
    const startedJson = await started.json() as {
      data: { payment: { provider_payment_id: string | null }; checkoutUrl: string | null };
    };
    const providerPaymentId = String(startedJson.data.payment.provider_payment_id ?? '');
    expect(providerPaymentId.startsWith('pi_test_')).toBe(true);
    expect(startedJson.data.checkoutUrl).toContain('checkout.stripe.com/test');

    const body = paidEvent(providerPaymentId);
    const first = await instance.request('/api/booking/payments/webhook/stripe', {
      method: 'POST', headers: { 'stripe-signature': await stripeSignature(body) }, body,
    }, env());
    await expect(first.json()).resolves.toMatchObject({ success: true, status: 'paid' });
    expect(sqlite.prepare(`SELECT status FROM bookings WHERE id = 'booking-a'`).get())
      .toEqual({ status: 'confirmed' });

    const second = await instance.request('/api/booking/payments/webhook/stripe', {
      method: 'POST', headers: { 'stripe-signature': await stripeSignature(body) }, body,
    }, env());
    await expect(second.json()).resolves.toMatchObject({ success: true, status: 'duplicate' });
  });

  it('署名違いは401、失敗の知らせは失敗にする', async () => {
    seedBooking();
    const instance = app();
    await saveBookingPaymentConfig(db, 'account-a', { mode: 'online', provider: 'stripe', holdMinutes: 30 });
    const started = await instance.request('/api/booking/payments/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: 'booking-a' }),
    }, env());
    const startedJson = await started.json() as {
      data: { payment: { provider_payment_id: string | null } };
    };
    const providerPaymentId = String(startedJson.data.payment.provider_payment_id ?? '');

    const bad = await instance.request('/api/booking/payments/webhook/stripe', {
      method: 'POST', headers: { 'stripe-signature': 't=1,v1=dead' },
      body: paidEvent(providerPaymentId),
    }, env());
    expect(bad.status).toBe(401);

    const failedBody = JSON.stringify({
      id: 'evt-test-2', type: 'payment_intent.payment_failed',
      data: { object: { id: providerPaymentId } },
    });
    const failed = await instance.request('/api/booking/payments/webhook/stripe', {
      method: 'POST', headers: { 'stripe-signature': await stripeSignature(failedBody) },
      body: failedBody,
    }, env());
    await expect(failed.json()).resolves.toMatchObject({ success: true, status: 'failed' });
    expect(sqlite.prepare(`SELECT status FROM bookings WHERE id = 'booking-a'`).get())
      .toEqual({ status: 'requested' });
  });

  it('返金すると返金済みになる', async () => {
    seedBooking();
    const instance = app();
    await saveBookingPaymentConfig(db, 'account-a', { mode: 'online', provider: 'stripe', holdMinutes: 30 });
    const started = await instance.request('/api/booking/payments/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: 'booking-a' }),
    }, env());
    const startedJson = await started.json() as {
      data: { payment: { provider_payment_id: string | null } };
    };
    const providerPaymentId = String(startedJson.data.payment.provider_payment_id ?? '');
    const body = paidEvent(providerPaymentId);
    await instance.request('/api/booking/payments/webhook/stripe', {
      method: 'POST', headers: { 'stripe-signature': await stripeSignature(body) }, body,
    }, env());
    const paymentId = (sqlite.prepare(
      `SELECT id FROM booking_payments WHERE booking_id = 'booking-a'`,
    ).get() as { id: string }).id;
    const refunded = await instance.request(`/api/booking/payments/${paymentId}/refund`, {
      method: 'POST',
    }, env());
    await expect(refunded.json()).resolves.toMatchObject({ success: true });
    expect(sqlite.prepare(`SELECT status FROM booking_payments WHERE id = ?`)
      .bind(paymentId).get()).toEqual({ status: 'refunded' });
  });

  it('manual の店は支払い済みでも承認待ちのまま', async () => {
    seedBooking();
    sqlite.exec(`INSERT INTO booking_settings (id, line_account_id, approval_mode, created_at, updated_at)
      VALUES ('setting-a', 'account-a', 'manual', '2026-10-01', '2026-10-01')`);
    const instance = app();
    await saveBookingPaymentConfig(db, 'account-a', { mode: 'online', provider: 'stripe', holdMinutes: 30 });
    const started = await instance.request('/api/booking/payments/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: 'booking-a' }),
    }, env());
    const startedJson = await started.json() as {
      data: { payment: { provider_payment_id: string | null } };
    };
    const body = paidEvent(String(startedJson.data.payment.provider_payment_id ?? ''));
    await instance.request('/api/booking/payments/webhook/stripe', {
      method: 'POST', headers: { 'stripe-signature': await stripeSignature(body) }, body,
    }, env());
    expect(sqlite.prepare(`SELECT status FROM bookings WHERE id = 'booking-a'`).get())
      .toEqual({ status: 'requested' });
    expect(sqlite.prepare(`SELECT status FROM booking_payments WHERE booking_id = 'booking-a'`).get())
      .toEqual({ status: 'paid' });
  });

  it('仮押さえの期限切れは見るたびに外す', async () => {
    seedBooking();
    const instance = app();
    await saveBookingPaymentConfig(db, 'account-a', { mode: 'online', provider: 'stripe', holdMinutes: 30 });
    await instance.request('/api/booking/payments/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: 'booking-a' }),
    }, env());
    sqlite.exec(`UPDATE booking_payments SET hold_until = '2000-01-01T00:00:00.000Z'
      WHERE booking_id = 'booking-a'`);
    const response = await instance.request(
      '/api/booking/payments/by-booking?bookingId=booking-a', {}, env(),
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true, data: { payment: { status: 'expired' } },
    });
    expect(sqlite.prepare(`SELECT status FROM bookings WHERE id = 'booking-a'`).get())
      .toEqual({ status: 'expired' });
  });

  it('偽のプロバイダを差しても予約の流れは同じ', async () => {
    seedBooking();
    registerTestPaymentProvider({
      name: 'fake',
      async startPayment(input) {
        return { checkoutUrl: `https://pay.example.test/${input.bookingId}`, providerPaymentId: `fake_${input.bookingId}` };
      },
      async getStatus() {
        return 'unknown';
      },
      async refund() {
        return true;
      },
      async verifyWebhook(rawBody: string) {
        const parsed = JSON.parse(rawBody) as { id?: string };
        if (!parsed.id) return null;
        return { providerPaymentId: parsed.id, status: 'paid' as const };
      },
    });
    await saveBookingPaymentConfig(db, 'account-a', { mode: 'online', provider: 'fake', holdMinutes: 30 });
    const instance = app();
    const started = await instance.request('/api/booking/payments/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: 'booking-a' }),
    }, env());
    expect(started.status).toBe(201);
    await expect(started.json()).resolves.toMatchObject({
      success: true, data: { checkoutUrl: 'https://pay.example.test/booking-a' },
    });
    const paid = await instance.request('/api/booking/payments/webhook/fake', {
      method: 'POST', body: JSON.stringify({ id: 'fake_booking-a' }),
    }, env());
    await expect(paid.json()).resolves.toMatchObject({ success: true, status: 'paid' });
    expect(sqlite.prepare(`SELECT status FROM bookings WHERE id = 'booking-a'`).get())
      .toEqual({ status: 'confirmed' });
  });
});
