import { logger } from '@line-crm/shared/server';
import { bookingCancellationQuote } from '../../features/booking/booking-cancellation/index.js';
import { simulatePaymentRefund } from '../../features/booking/booking-payment-refunds/index.js';
import type { BookingPaymentRecord } from '@line-crm/db';
import type { SelfBookingChange } from '../booking-self-meet-sync.js';
import { type Context } from 'hono';
import type { Env } from '../../worker-env.js';
import { cancelByTrigger } from '../../services/reminder-trigger.js';
import { cancelMeetConsultation } from '../../services/meet-consultation-reminders.js';
import { enqueueCalendarDeleteOperation, removeBookingFromGoogle, runCalendarDeleteOperation } from '../../features/booking/booking-calendar-sync/index.js';
import { type BookingStatus } from '../../features/booking/booking-types/index.js';
import { promoteBookingWaitlist } from '../../features/booking/booking-waitlist/index.js';
import { readSelfBookingRules } from './identity.js';
import { cancelLegacyBookingReminders, cancelObsoleteConfirmationRuns } from './ledger-input.js';
import { googleCredentials } from './availability.js';

/** 期限内の本人取消は、既存の模擬返金と同じ取引・監査を通す。失敗時は取消の再送で回復する。 */
export async function refundSelfBookingPayment(db: D1Database, self: SelfBookingChange, bookingId: string) {
  const payment = await db.prepare(`SELECT p.* FROM booking_payments p JOIN bookings b
    ON b.id=p.booking_id AND b.line_account_id=p.line_account_id
    WHERE b.id=? AND b.line_account_id=? AND b.friend_id=? AND b.status='cancelled' AND p.status='paid'`)
    .bind(bookingId, self.accountId, self.friendId).first<BookingPaymentRecord>();
  if (!payment) return; // 店頭払い・未払い・返金済みは自動返金の対象外。
  const booking = await db.prepare('SELECT starts_at,decided_at,menu_id FROM bookings WHERE id=? AND line_account_id=?')
    .bind(bookingId, self.accountId).first<{ starts_at: string; decided_at: string; menu_id: string }>();
  if (!booking || !Number.isFinite(Date.parse(booking.decided_at))) throw new Error('cancellation_time_unavailable');
  const at = new Date(booking.decided_at);
  const quote = await bookingCancellationQuote(db, bookingId, self.accountId, at);
  const rules = await readSelfBookingRules(db, self.accountId, booking.menu_id);
  if (at.getTime() >= Date.parse(booking.starts_at) || quote.feeNow > 0
    || (!quote.policyAcceptedRequired && at.getTime() > Date.parse(booking.starts_at) - rules.cancelDeadlineMinutesBefore * 60_000)) return;
  await simulatePaymentRefund(db, payment, {
    reason: '期限内の予約キャンセル', notifyLine: false, idempotencyKey: `self-cancel:${bookingId}`,
  }, { id: self.friendId, name: 'お客さま本人（予約キャンセル）' });
}

// 本人取消の副作用 (初回・再送で共通)。管理者取消と同じ順番でそろえる。
export async function runSelfBookingCancelSideEffects(
  c: Context<Env>,
  self: SelfBookingChange,
  row: { id: string; starts_at: string; staff_id: string; friend_id: string | null; external_event_id: string | null },
): Promise<{ calendar_sync: string; meet_sync: string }> {
  const cancelReason = `booking_cancelled:${row.id}:by:self:${self.lineUserId}-retry`;
  // 送信中の REMINDER_SEND_IN_FLIGHT は投げて 409 にする。
  // cancelByTrigger が先に投げるため legacy/Calendar/Meet は未実施のまま残る。
  await cancelByTrigger(c.env.DB, {
    triggerType: 'booking',
    sourceId: row.id,
    sourceEventId: row.id,
    friendId: row.friend_id,
    startsAtIso: row.starts_at,
    lineAccountId: self.accountId,
    cancelReason,
    failOnSendInFlight: true,
  });
  await refundSelfBookingPayment(c.env.DB, self, row.id);
  await cancelLegacyBookingReminders(c.env.DB, row.id);
  await cancelObsoleteConfirmationRuns(c.env.DB, row.id, self.accountId);
  await enqueueCalendarDeleteOperation(c.env.DB, { bookingId: row.id, lineAccountId: self.accountId });
  const calResult = await runCalendarDeleteOperation(c.env.DB, {
    bookingId: row.id,
    lineAccountId: self.accountId,
    remove: () => removeBookingFromGoogle(c.env.DB, googleCredentials(c.env), row.id),
  });
  const meetSync = await cancelSelfBookingMeet(c, self, row.id, row.external_event_id);
  // 取り消し再送でも空き知らせは行う（仮押さえ中なら何もしない）。
  try {
    await promoteBookingWaitlist(c.env.DB, {
      lineAccountId: self.accountId,
      staffId: row.staff_id,
      startsAt: row.starts_at,
    }, undefined, c.env.LIFF_URL ?? '',c.env);
  } catch {
    logger.error("booking_waitlist_promote_failed");
  }
  return {
    calendar_sync: calResult === 'succeeded' ? 'synced' : calResult === 'retry_wait' ? 'failed' : 'not_applicable',
    meet_sync: meetSync,
  };
}

// 本人取消の Meet 連携。結び付きが無ければ何もしない (作らない)。
export async function cancelSelfBookingMeet(
  c: Context<Env>,
  self: SelfBookingChange,
  bookingId: string,
  externalEventId: string | null,
): Promise<'cancelled' | 'not_linked' | 'failed' | 'superseded'> {
  try {
    if (!externalEventId) return 'not_linked';
    // フェンス: 予約が取消確定・本人所有のままかを先に確かめる。
    const booking = await c.env.DB
      .prepare(`SELECT status, friend_id FROM bookings WHERE id = ? AND line_account_id = ?`)
      .bind(bookingId, self.accountId)
      .first<{ status: BookingStatus; friend_id: string | null }>();
    if (!booking || booking.friend_id !== self.friendId) return 'not_linked';
    if (booking.status !== 'cancelled' && booking.status !== 'expired') return 'superseded';
    const consult = await c.env.DB
      .prepare(
        `SELECT friend_id, booking_id, booking_version
           FROM meet_consultations WHERE external_event_id = ?`,
      )
      .bind(externalEventId)
      .first<{ friend_id: string; booking_id: string | null; booking_version: number | null }>();
    if (!consult || consult.friend_id !== self.friendId) return 'not_linked';
    // 見た版のまま止める。SELECT 後に別操作が上書きしていたら version が
    // 合わず false になり、勝者の行には触らない。
    const cancelled = await cancelMeetConsultation(c.env.DB, externalEventId, new Date(), {
      failOnSendInFlight: true,
      expectedBookingId: consult.booking_id,
      expectedBookingVersion: consult.booking_version,
    });
    return cancelled ? 'cancelled' : 'not_linked';
  } catch {
    return 'failed';
  }
}
