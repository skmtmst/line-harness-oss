import type { BookingHistoryPayment } from '@line-crm/shared';

/** 現在の設定から過去の支払いを推測しない。予約時の保存値・入金記録だけを使う。 */
export async function customerBookingPayments(db: D1Database, account: string, friend: string) {
  const rows = await db.prepare(`SELECT b.id,ch.mode,b.price_at_booking,p.id AS payment_id,p.amount,p.currency,
    p.status,p.refunded_amount,p.receipt_url FROM bookings b
    LEFT JOIN booking_payment_choices ch ON ch.booking_id=b.id AND ch.line_account_id=b.line_account_id
    LEFT JOIN booking_payments p ON p.id=(SELECT p2.id FROM booking_payments p2
      WHERE p2.booking_id=b.id AND p2.line_account_id=b.line_account_id ORDER BY p2.created_at DESC,p2.id LIMIT 1)
    WHERE b.line_account_id=? AND b.friend_id=? AND (p.id IS NOT NULL OR ch.mode='onsite')`)
    .bind(account,friend).all<{id:string;mode:string|null;price_at_booking:number;payment_id:string|null;
      amount:number;currency:string;status:string;refunded_amount:number;receipt_url:string|null}>();
  return new Map(rows.results.map(row => [row.id, {
    method: row.payment_id ? 'online' : 'onsite',
    status: row.payment_id ? row.status==='paid' && row.refunded_amount>0 ? 'partially_refunded' : row.status : 'onsite',
    amount: row.payment_id ? row.amount : row.price_at_booking, currency: row.currency ?? 'JPY',
    refundedAmount: row.refunded_amount ?? 0, receiptUrl: safeReceiptUrl(row.receipt_url),
  } satisfies BookingHistoryPayment]));
}

export function safeReceiptUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol==='https:' && url.hostname==='pay.stripe.com' && !url.username && !url.password && !url.port ? value : null;
  } catch { return null; }
}
