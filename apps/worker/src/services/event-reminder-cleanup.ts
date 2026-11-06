import { reverseSourceConversions } from '@line-crm/db';
import { returnEventEntitlement } from './event-entitlements.js';
// 予約取消・否認・失効後にも通知されないよう、pending だけでなく cron が再試行する failed も取り消す。
export async function cancelPendingRemindersFor(
  db: D1Database,
  booking_id: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE event_booking_reminders
          SET status = 'cancelled'
        WHERE booking_id = ? AND status IN ('pending','failed')`,
    )
    .bind(booking_id)
    .run();
  const cancelled = await db.prepare(`SELECT line_account_id, friend_id FROM event_bookings WHERE id = ? AND status = 'cancelled'`)
    .bind(booking_id).first<{ line_account_id: string; friend_id: string }>();
  if(cancelled)await returnEventEntitlement(db,cancelled.line_account_id,booking_id);
  if (cancelled) await reverseSourceConversions(db, { lineAccountId: cancelled.line_account_id, sourceType: 'reservation_confirmed', bookingId: booking_id, friendId: cancelled.friend_id });

}
