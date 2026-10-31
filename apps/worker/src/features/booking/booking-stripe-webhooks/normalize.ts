import { BOOKING_STRIPE_EVENT_KINDS, BookingStripeError, type BookingStripeEvent } from './types.js';
const identifier = (value: unknown): string | null => typeof value === 'string' && /^[a-z][a-z0-9_]{1,254}$/i.test(value) ? value : null;
const text = (value: unknown): string | null => typeof value === 'string' && /^[a-z_.]{1,120}$/.test(value) ? value : null;
const number = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
const objectId = (value: unknown): string | null => identifier(typeof value === 'object' && value !== null ? (value as {id?: unknown}).id : value);
/** 署名を確かめた後でだけ呼ぶ。本文・任意metadata・個人情報は台帳に広げない。 */
export function normalizeBookingStripeEvent(value: unknown): BookingStripeEvent {
  if (!value || typeof value !== 'object') throw new BookingStripeError('invalid_event', 400);
  const e = value as Record<string, unknown>, o = (e.data as {object?: Record<string, unknown>} | undefined)?.object;
  const id = identifier(e.id), account = identifier(e.account), type = text(e.type), created = number(e.created);
  const oid = identifier(o?.id), kind = text(o?.object);
  if (!id?.startsWith('evt_') || !account?.startsWith('acct_') || !type || created === null || !oid || !kind
    || !Object.hasOwn(BOOKING_STRIPE_EVENT_KINDS,kind) || !BOOKING_STRIPE_EVENT_KINDS[kind]?.includes(type) || typeof e.api_version !== 'string' || e.api_version.length > 80 || !o) throw new BookingStripeError('invalid_event', 400);
  // 不足はnullのまま残す。期間や金額を推測して権利を作らない。
  const amount = kind === 'invoice' ? o.amount_due : kind === 'checkout.session' ? o.amount_total : o.amount;
  return {id, account, type, apiVersion: e.api_version, created, object: {id: oid, kind,
    status: text(o.status), paymentStatus: text(o.payment_status), amount: number(amount),
    amountPaid: number(o.amount_paid), amountRemaining: number(o.amount_remaining), amountReceived: number(o.amount_received),
    paidOutOfBand: typeof o.paid_out_of_band==='boolean' ? o.paid_out_of_band : null,
    autoAdvance: typeof o.auto_advance==='boolean' ? o.auto_advance : null,
    currency: typeof o.currency === 'string' && /^[a-z]{3}$/.test(o.currency) ? o.currency : null,
    customer: objectId(o.customer), paymentMethod: objectId(o.payment_method), setupIntent: objectId(o.setup_intent), checkoutMode: text(o.mode), paymentIntent: objectId(o.payment_intent),
    subscription: objectId(o.subscription), periodStart: number(o.period_start), periodEnd: number(o.period_end)}};
}
export async function stripeReceiptDigest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))), b => b.toString(16).padStart(2,'0')).join('');
}
