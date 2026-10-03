import { Hono } from 'hono';
import {
  createBookingPayment,
  getBookingAdminSettings,
  getBookingPaymentByBooking,
  getBookingPaymentConfig,
  markBookingPayment,
  resolveBookingPaymentConfig,
  saveBookingPaymentConfig,
  saveBookingPaymentMenuSetting,
  type BookingPaymentMode,
  type BookingPaymentProviderName,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import {
  createStripeTestProvider,
  getPaymentProvider,
  registerPaymentProvider,
  type PaymentProvider,
} from '../services/payment-providers.js';
import { recordBookingAudit } from '@line-crm/db';

/**
 * 予約の支払い（決済サービスを差し替えられる作り）。
 *
 * 既存の Stripe まわり（hq-billing など）は触らない。予約の支払いは
 * 別の口として作る。鍵の値はコード・試験・DBに書かず、秘密値から読む。
 * 設定画面には「鍵が入っているか」だけ出す。
 */

const bookingPayments = new Hono<Env>();

function providerFor(
  env: Env['Bindings'],
  name: string,
): PaymentProvider | null {
  if (name === 'stripe') {
    return createStripeTestProvider({ webhookSecret: env.STRIPE_TEST_WEBHOOK_SECRET ?? '' });
  }
  return getPaymentProvider(name);
}

/** テスト用の差し替え口。予約の流れは触らず、登録表だけ差す。 */
export function registerTestPaymentProvider(provider: PaymentProvider): void {
  registerPaymentProvider(provider);
}

function validMode(value: unknown): BookingPaymentMode | null {
  return value === 'none' || value === 'onsite' || value === 'online' ? value : null;
}

function validProvider(value: unknown): BookingPaymentProviderName | null {
  return value === 'none' || value === 'onsite' || value === 'stripe' ? value : null;
}

// GET /api/booking/admin/payment-config — 店の既定と鍵の有無
bookingPayments.get(
  '/api/booking/admin/payment-config',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const accountId = c.req.query('account_id')?.trim();
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    const config = await getBookingPaymentConfig(c.env.DB, accountId);
    return c.json({
      success: true,
      data: {
        ...config,
        keyConfigured: config.provider === 'stripe'
          ? Boolean(c.env.STRIPE_TEST_WEBHOOK_SECRET)
          : true,
        testMode: config.provider === 'stripe',
      },
    });
  },
);

// PUT /api/booking/admin/payment-config — 店の既定を変える
bookingPayments.put(
  '/api/booking/admin/payment-config',
  requireRole('owner', 'admin'),
  async (c) => {
    const accountId = c.req.query('account_id')?.trim();
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    const body = await c.req.json<{
      mode?: unknown; provider?: unknown; holdMinutes?: unknown;
    }>().catch(() => null);
    const mode = validMode(body?.mode);
    const provider = validProvider(body?.provider);
    const holdMinutes = Number(body?.holdMinutes);
    if (!mode || !provider) {
      return c.json({ success: false, error: 'mode と provider を指定してください' }, 400);
    }
    if (!Number.isInteger(holdMinutes) || holdMinutes < 5 || holdMinutes > 1440) {
      return c.json({ success: false, error: 'holdMinutes は 5〜1440 の整数で指定してください' }, 400);
    }
    if (mode === 'online' && provider !== 'stripe') {
      return c.json({ success: false, error: 'online の provider は stripe を指定してください' }, 400);
    }
    if (mode !== 'online' && provider === 'stripe') {
      return c.json({ success: false, error: 'stripe を使うときは mode を online にしてください' }, 400);
    }
    const saved = await saveBookingPaymentConfig(c.env.DB, accountId, { mode, provider, holdMinutes });
    return c.json({ success: true, data: saved });
  },
);

// PUT /api/booking/admin/menus/:id/payment — メニューごとの上書き
bookingPayments.put(
  '/api/booking/admin/menus/:id/payment',
  requireRole('owner', 'admin'),
  async (c) => {
    const accountId = c.req.query('account_id')?.trim();
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    const menuId = c.req.param('id');
    const menu = await c.env.DB.prepare(
      `SELECT id FROM menus WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`,
    ).bind(menuId, accountId).first<{ id: string }>();
    if (!menu) return c.json({ success: false, error: '対象が見つかりません' }, 404);
    const body = await c.req.json<{ mode?: unknown; provider?: unknown }>().catch(() => null);
    const mode = validMode(body?.mode);
    const provider = validProvider(body?.provider);
    if (!mode || !provider) {
      return c.json({ success: false, error: 'mode と provider を指定してください' }, 400);
    }
    await saveBookingPaymentMenuSetting(c.env.DB, accountId, menuId, { mode, provider });
    const effective = await resolveBookingPaymentConfig(c.env.DB, accountId, menuId);
    return c.json({ success: true, data: effective });
  },
);

async function providerCheckout(
  env: Env['Bindings'],
  providerName: string,
  input: { amount: number; currency: string; bookingId: string; idempotencyKey: string },
): Promise<{ checkoutUrl: string | null; providerPaymentId: string | null }> {
  const provider = providerFor(env, providerName);
  if (!provider) throw new Error(`unknown provider: ${providerName}`);
  return provider.startPayment(input);
}

// POST /api/booking/payments/start — 支払いを始める（担当者用）
bookingPayments.post(
  '/api/booking/payments/start',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const body = await c.req.json<{ bookingId?: unknown; idempotencyKey?: unknown }>().catch(() => null);
    const bookingId = String(body?.bookingId ?? '');
    if (!bookingId) return c.json({ success: false, error: 'bookingId が必要です' }, 400);
    const booking = await c.env.DB.prepare(
      `SELECT id, line_account_id, price_at_booking, status FROM bookings WHERE id = ?`,
    ).bind(bookingId).first<{
      id: string; line_account_id: string; price_at_booking: number; status: string;
    }>();
    if (!booking
      || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [booking.line_account_id])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    if (booking.status !== 'requested') {
      return c.json({ success: false, error: 'この予約は支払いの対象ではありません' }, 409);
    }
    const bookingMenu = await c.env.DB.prepare(
      `SELECT menu_id FROM bookings WHERE id = ?`,
    ).bind(bookingId).first<{ menu_id: string }>();
    const config = await resolveBookingPaymentConfig(
      c.env.DB, booking.line_account_id, bookingMenu?.menu_id ?? '',
    );
    if (config.mode !== 'online') {
      return c.json({ success: false, error: 'この予約はオンライン支払いの対象ではありません' }, 409);
    }
    if (!providerFor(c.env, config.provider)) {
      return c.json({ success: false, error: '支払いの準備ができていません' }, 409);
    }
    const idempotencyKey = typeof body?.idempotencyKey === 'string' && body.idempotencyKey
      ? body.idempotencyKey.slice(0, 200)
      : `booking:${bookingId}`;
    const holdUntil = new Date(Date.now() + config.holdMinutes * 60_000).toISOString();
    const record = await createBookingPayment(c.env.DB, {
      lineAccountId: booking.line_account_id,
      bookingId,
      amount: Number(booking.price_at_booking ?? 0),
      provider: config.provider,
      idempotencyKey,
      holdUntil,
    });
    if (record.status !== 'unpaid') {
      return c.json({ success: true, data: { payment: record, checkoutUrl: null, reused: true } });
    }
    const started = await providerCheckout(c.env, config.provider, {
      amount: record.amount,
      currency: record.currency,
      bookingId,
      idempotencyKey: record.idempotency_key,
    });
    if (started.providerPaymentId) {
      await c.env.DB.prepare(
        `UPDATE booking_payments SET provider_payment_id = ?, status = 'pending', updated_at = ?
          WHERE id = ? AND status = 'unpaid'`,
      ).bind(started.providerPaymentId, new Date().toISOString(), record.id).run();
    }
    const current = await getBookingPaymentByBooking(c.env.DB, booking.line_account_id, bookingId);
    return c.json({ success: true, data: { payment: current, checkoutUrl: started.checkoutUrl } }, 201);
  },
);

// GET /api/booking/payments/by-booking — 支払いの状態（仮押さえの期限切れもここで落とす）
bookingPayments.get(
  '/api/booking/payments/by-booking',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const bookingId = c.req.query('bookingId')?.trim();
    if (!bookingId) return c.json({ success: false, error: 'bookingId が必要です' }, 400);
    const booking = await c.env.DB.prepare(
      `SELECT id, line_account_id FROM bookings WHERE id = ?`,
    ).bind(bookingId).first<{ id: string; line_account_id: string }>();
    if (!booking
      || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [booking.line_account_id])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    const record = await expireBookingPaymentIfHeld(
      c.env.DB, booking.line_account_id, bookingId,
    );
    return c.json({ success: true, data: { payment: record } });
  },
);

/**
 * 仮押さえの期限切れ。期限を過ぎた未払い・支払い中は予約ごと外す。
 * 期限の監視はここ（見るたび）と知らせの受け口で行い、新しい監視の仕組みは作らない。
 */
export async function expireBookingPaymentIfHeld(
  db: D1Database,
  lineAccountId: string,
  bookingId: string,
) {
  const record = await getBookingPaymentByBooking(db, lineAccountId, bookingId);
  if (!record || (record.status !== 'unpaid' && record.status !== 'pending')) return record;
  if (!record.hold_until || record.hold_until > new Date().toISOString()) return record;
  await markBookingPayment(db, {
    lineAccountId, paymentId: record.id, status: 'expired',
  });
  await db.prepare(
    `UPDATE bookings SET status = 'expired', updated_at = ?
      WHERE id = ? AND status = 'requested'`,
  ).bind(new Date().toISOString(), bookingId).run();
  await recordBookingAudit(db, {
    bookingId,
    lineAccountId,
    action: 'expired',
    after: { status: 'expired', reason: 'payment_hold_expired' },
    actorType: 'system',
    actorId: null,
    occurredAt: new Date().toISOString(),
  }).catch(() => undefined);
  return getBookingPaymentByBooking(db, lineAccountId, bookingId);
}

// POST /api/booking/payments/:id/refund — 返金する
bookingPayments.post(
  '/api/booking/payments/:id/refund',
  requireRole('owner', 'admin'),
  async (c) => {
    const paymentId = c.req.param('id');
    const record = await c.env.DB.prepare(
      `SELECT * FROM booking_payments WHERE id = ?`,
    ).bind(paymentId).first<{
      id: string; line_account_id: string; status: string;
      provider: string; provider_payment_id: string | null;
    }>();
    if (!record
      || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [record.line_account_id])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    if (record.status !== 'paid') {
      return c.json({ success: false, error: '支払い済みだけ返金できます' }, 409);
    }
    const provider = providerFor(c.env, record.provider);
    if (!provider || !record.provider_payment_id) {
      return c.json({ success: false, error: 'この支払いは返金できません' }, 409);
    }
    const ok = await provider.refund(record.provider_payment_id);
    if (!ok) return c.json({ success: false, error: '返金できませんでした' }, 502);
    const updated = await markBookingPayment(c.env.DB, {
      lineAccountId: record.line_account_id, paymentId: record.id, status: 'refunded',
    });
    return c.json({ success: true, data: { payment: updated } });
  },
);

// POST /api/booking/payments/webhook/:provider — 支払い済みの知らせ
bookingPayments.post(
  '/api/booking/payments/webhook/:provider',
  async (c) => {
    const providerName = c.req.param('provider');
    const rawBody = await c.req.text();
    if (new TextEncoder().encode(rawBody).byteLength > 256 * 1024) {
      return c.json({ success: false, error: 'Payload too large' }, 413);
    }
    const signature = c.req.header('stripe-signature') ?? c.req.header('x-payment-signature') ?? '';
    const provider = providerFor(c.env, providerName);
    if (!provider) return c.json({ success: false, error: 'unknown provider' }, 404);
    const outcome = await provider.verifyWebhook(rawBody, signature);
    if (!outcome) return c.json({ success: false, error: 'Invalid signature' }, 401);
    if (outcome.status !== 'paid') {
      await markUnpaidBookingPaymentByProviderId(c.env.DB, outcome.providerPaymentId, 'failed');
      return c.json({ success: true, status: 'failed' });
    }
    const applied = await applyPaidBookingPayment(c.env.DB, outcome.providerPaymentId);
    if (!applied) return c.json({ success: true, status: 'unknown_payment' });
    return c.json({ success: true, status: applied.duplicate ? 'duplicate' : 'paid' });
  },
);

async function markUnpaidBookingPaymentByProviderId(
  db: D1Database,
  providerPaymentId: string,
  status: 'failed',
): Promise<void> {
  const row = await db.prepare(
    `SELECT id, line_account_id FROM booking_payments
      WHERE provider_payment_id = ? AND status IN ('unpaid', 'pending')`,
  ).bind(providerPaymentId).first<{ id: string; line_account_id: string }>();
  if (!row) return;
  await markBookingPayment(db, { lineAccountId: row.line_account_id, paymentId: row.id, status });
}

/**
 * 支払い済みを予約へ反映する。二重の知らせは2回目を受け付け済みで返す。
 * 店のルールと両立：manual なら「支払い済み・承認待ち」（requested のまま）、
 * automatic なら確定（confirmed）にする。
 */
export async function applyPaidBookingPayment(
  db: D1Database,
  providerPaymentId: string,
): Promise<{ duplicate: boolean } | null> {
  const row = await db.prepare(
    `SELECT id, line_account_id, booking_id, status FROM booking_payments
      WHERE provider_payment_id = ?`,
  ).bind(providerPaymentId).first<{
    id: string; line_account_id: string; booking_id: string; status: string;
  }>();
  if (!row) return null;
  if (row.status === 'paid') return { duplicate: true };
  if (row.status !== 'unpaid' && row.status !== 'pending') return { duplicate: true };
  await markBookingPayment(db, {
    lineAccountId: row.line_account_id, paymentId: row.id, status: 'paid',
  });
  const settings = await getBookingAdminSettings(db, row.line_account_id);
  const now = new Date().toISOString();
  if (settings?.approvalMode === 'manual') {
    await recordBookingAudit(db, {
      bookingId: row.booking_id,
      lineAccountId: row.line_account_id,
      action: 'paid_awaiting_approval',
      after: { status: 'requested', payment: 'paid' },
      actorType: 'system',
      actorId: null,
      occurredAt: now,
    }).catch(() => undefined);
    return { duplicate: false };
  }
  await db.prepare(
    `UPDATE bookings SET status = 'confirmed', decided_at = ?, updated_at = ?
      WHERE id = ? AND status = 'requested'`,
  ).bind(now, now, row.booking_id).run();
  await recordBookingAudit(db, {
    bookingId: row.booking_id,
    lineAccountId: row.line_account_id,
    action: 'confirmed',
    after: { status: 'confirmed', payment: 'paid' },
    actorType: 'system',
    actorId: null,
    occurredAt: now,
  }).catch(() => undefined);
  return { duplicate: false };
}

export { bookingPayments };
