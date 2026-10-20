/*
 * 予約の支払い（決済サービスを差し替えられる作り）。
 * 外へ通信しない。Stripeは署名付きの試験の知らせで進める。
 * 本物のお金は動かさない。
 */
import { runExpirer } from '../features/booking/booking-expirer.js';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker-env';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { getBookingPaymentConfig, saveBookingPaymentConfig } from '@line-crm/db';
import { applyPaidBookingPayment, registerTestPaymentProvider } from './booking-payments.js';

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
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('外部通信は禁止'); }));
  const created = createTestD1();
  sqlite = created.raw;
  db = created.db;
});

afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });

describe('予約の支払いの共通口', () => {
  it.each(['webhook', 'cron'])('REV-H1: %sで支払い確定した予約に確定リマインダと同期記録を作る', async (entry) => {
    seedBooking();
    sqlite.exec(`INSERT INTO booking_payments
      (id,line_account_id,booking_id,amount,provider,provider_payment_id,idempotency_key,status,created_at,updated_at)
      VALUES ('pay-a','account-a','booking-a',8000,'fake','fake-a','booking:booking-a','paid','2026-10-01','2026-10-01');`);
    if (entry === 'webhook') await applyPaidBookingPayment(db, 'fake-a');
    else await runExpirer(db, { now: new Date('2026-10-12T00:00:00Z'), sender: vi.fn() });
    expect(sqlite.prepare("SELECT COUNT(*) n FROM booking_reminders WHERE booking_id='booking-a'").get()).toEqual({ n: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) n FROM booking_operation_runs WHERE booking_id='booking-a' AND kind='google_calendar'").get()).toEqual({ n: 1 });
  });

  it('BK-P02: 支払い反映の途中失敗を次の読込で回復し、監査は一度だけ', async () => {
    seedBooking();
    sqlite.exec(`INSERT INTO booking_payments
      (id,line_account_id,booking_id,amount,provider,provider_payment_id,idempotency_key,status,created_at,updated_at)
      VALUES ('pay-a','account-a','booking-a',8000,'fake','fake-a','booking:booking-a','pending','2026-10-01','2026-10-01');
      CREATE TRIGGER crash_confirmation BEFORE UPDATE OF status ON bookings
      WHEN NEW.status = 'confirmed' BEGIN SELECT RAISE(ABORT,'injected crash'); END;`);
    await expect(applyPaidBookingPayment(db, 'fake-a')).rejects.toThrow('injected crash');
    sqlite.exec(`DROP TRIGGER crash_confirmation;
      UPDATE booking_payments SET status='paid' WHERE id='pay-a';`);
    // 過去版で paid だけ保存されていた行も、同じ読込口から補完する。
    const response = await app().request('/api/booking/payments/by-booking?bookingId=booking-a', {}, env());
    expect(response.status).toBe(200);
    expect(sqlite.prepare("SELECT status FROM bookings WHERE id='booking-a'").get()).toEqual({ status: 'confirmed' });
    await applyPaidBookingPayment(db, 'fake-a');
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM booking_audit_logs WHERE booking_id='booking-a' AND action='confirmed'").get()).toEqual({ n: 1 });
  });

  it('BK-P03: 顧客が戻らなくても10分の支払い期限で定期回収し枠を空ける', async () => {
    seedBooking();
    await saveBookingPaymentConfig(db, 'account-a', { mode: 'online', provider: 'stripe', holdMinutes: 10 });
    await app().request('/api/booking/payments/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: 'booking-a' }),
    }, env());
    sqlite.exec(`UPDATE bookings SET requested_at='2099-01-01T00:00:00.000Z';
      UPDATE booking_payments SET hold_until='2099-01-01T00:10:00.000Z';`);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM booking_slot_allocations WHERE id='booking-a'").get()).toEqual({n:1});
    const sender = vi.fn();
    await runExpirer(db, { now: new Date('2099-01-01T00:11:00.000Z'), sender });
    expect(sqlite.prepare("SELECT status FROM booking_payments WHERE booking_id='booking-a'").get()).toEqual({ status: 'expired' });
    expect(sqlite.prepare("SELECT status FROM bookings WHERE id='booking-a'").get()).toEqual({ status: 'expired' });
    expect(sqlite.prepare("SELECT COUNT(*) n FROM booking_slot_allocations WHERE id='booking-a'").get()).toEqual({n:0});
    expect(sender).not.toHaveBeenCalled();
  });

  it('BK-P02: 予約更新失敗は支払いも戻し、定期回収はpaidを確定・manualを保つ', async () => {
    seedBooking();
    sqlite.exec(`INSERT INTO booking_payments
      (id,line_account_id,booking_id,amount,provider,provider_payment_id,idempotency_key,status,created_at,updated_at)
      VALUES ('pay-a','account-a','booking-a',8000,'fake','fake-a','booking:booking-a','pending','2026-10-01','2026-10-01');
      CREATE TRIGGER crash_confirmation BEFORE UPDATE OF status ON bookings
      WHEN NEW.status = 'confirmed' BEGIN SELECT RAISE(ABORT,'injected crash'); END;`);
    await expect(applyPaidBookingPayment(db, 'fake-a')).rejects.toThrow('injected crash');
    expect(sqlite.prepare("SELECT status FROM booking_payments WHERE id='pay-a'").get()).toEqual({ status: 'pending' });
    sqlite.exec(`DROP TRIGGER crash_confirmation; UPDATE booking_payments SET status='paid';`);
    const sender = vi.fn();
    await runExpirer(db, { now: new Date('2099-01-01T00:11:00.000Z'), sender });
    expect(sqlite.prepare("SELECT status FROM bookings WHERE id='booking-a'").get()).toEqual({ status: 'confirmed' });
    sqlite.exec(`UPDATE bookings SET status='requested';
      INSERT INTO booking_settings (id,line_account_id,approval_mode) VALUES ('manual','account-a','manual');`);
    await runExpirer(db, { now: new Date('2099-01-01T00:11:00.000Z'), sender });
    expect(sqlite.prepare("SELECT status FROM bookings WHERE id='booking-a'").get()).toEqual({ status: 'requested' });
    expect(sender).not.toHaveBeenCalled();
  });

  it('BK-P03: 決済の既定は10分、店が決めた期限は保つ', async () => {
    seedBooking();
    expect((await getBookingPaymentConfig(db, 'account-a')).holdMinutes).toBe(10);
    await saveBookingPaymentConfig(db, 'account-a', { mode: 'online', provider: 'stripe', holdMinutes: 45 });
    expect((await getBookingPaymentConfig(db, 'account-a')).holdMinutes).toBe(45);
  });

  it('BK-P03: 期限回収の途中失敗も原子化し、paidを期限切れにしない', async () => {
    seedBooking();
    sqlite.exec(`INSERT INTO booking_payments
      (id,line_account_id,booking_id,amount,provider,provider_payment_id,idempotency_key,status,hold_until,created_at,updated_at)
      VALUES ('pay-a','account-a','booking-a',8000,'fake','fake-a','booking:booking-a','pending','2000-01-01','2026-10-01','2026-10-01');
      CREATE TRIGGER crash_expiry BEFORE UPDATE OF status ON bookings
      WHEN NEW.status = 'expired' BEGIN SELECT RAISE(ABORT,'injected expiry crash'); END;`);
    const response = await app().request('/api/booking/payments/by-booking?bookingId=booking-a', {}, env());
    expect(response.status).toBe(500);
    expect(sqlite.prepare("SELECT status FROM booking_payments WHERE id='pay-a'").get()).toEqual({ status: 'pending' });
    sqlite.exec(`DROP TRIGGER crash_expiry; UPDATE booking_payments SET status='paid';`);
    await runExpirer(db, { now: new Date('2099-01-01T00:11:00.000Z'), sender: vi.fn() });
    expect(sqlite.prepare("SELECT status FROM booking_payments WHERE id='pay-a'").get()).toEqual({ status: 'paid' });
  });

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

  it('REM3-04 未設定の仮押さえの既定は10分', async () => {
    seedBooking();
    const response = await app().request('/api/booking/admin/payment-config?account_id=account-a', {}, env());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { holdMinutes: 10 } });
  });

  it.each([10, 30])('REM3-04 新しい支払い設定には指定した%d分を保存しDBの既定に任せない', async (holdMinutes) => {
    seedBooking();
    const instance = app();
    const current = await instance.request('/api/booking/admin/payment-config?account_id=account-a', {}, env());
    const defaults = await current.json() as { data: { mode: string; provider: string; holdMinutes: number } };
    expect(defaults.data.holdMinutes).toBe(10);
    const saved = await instance.request('/api/booking/admin/payment-config?account_id=account-a', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...defaults.data, holdMinutes }),
    }, env());
    expect(saved.status).toBe(200);
    expect(sqlite.prepare('SELECT hold_minutes FROM booking_payment_configs WHERE line_account_id = ?').get('account-a'))
      .toEqual({ hold_minutes: holdMinutes });
    const reloaded = await instance.request('/api/booking/admin/payment-config?account_id=account-a', {}, env());
    await expect(reloaded.json()).resolves.toMatchObject({ data: { holdMinutes } });
  });

  it('REM3-04 時間を省略した新規設定は保存せずDBの30分へ戻さない', async () => {
    seedBooking();
    const response = await app().request('/api/booking/admin/payment-config?account_id=account-a', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'none', provider: 'none' }),
    }, env());
    expect(response.status).toBe(400);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM booking_payment_configs').get()).toEqual({ n: 0 });
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
      method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify({reason:'取消',idempotencyKey:'refund-all'}),
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

describe('お客さまが選ぶ支払い設定',()=>{
 it('店の既定・メニュー上書き・解除を保存し、Stripe以外との組合せは断る',async()=>{
  seedBooking();const headers={'Content-Type':'application/json'};
  const store='/api/booking/admin/payment-config?account_id=account-a';
  expect((await app().request(store,{method:'PUT',headers,body:JSON.stringify({mode:'customer_choice',provider:'stripe',holdMinutes:10})},env())).status).toBe(200);
  expect(await getBookingPaymentConfig(db,'account-a')).toMatchObject({mode:'customer_choice',provider:'stripe'});
  const menu='/api/booking/admin/menus/menu-a/payment?account_id=account-a';
  expect((await app().request(menu,{method:'PUT',headers,body:JSON.stringify({mode:'customer_choice',provider:'stripe'})},env())).status).toBe(200);
  expect((await app().request(menu,{method:'PUT',headers,body:JSON.stringify({mode:'customer_choice',provider:'onsite'})},env())).status).toBe(400);
  expect((await app().request(store,{method:'PUT',headers,body:JSON.stringify({mode:'customer_choice',provider:'none',holdMinutes:10})},env())).status).toBe(400);
  expect((await app().request(menu,{method:'DELETE'},env())).status).toBe(200);
 });
});
