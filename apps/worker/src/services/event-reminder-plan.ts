import type { ComputedReminder } from './event-booking-reminders.js';

/** 作成/CASの取引へ通知予定を含める。従来の単独呼出しも同じSQLを使う。 */
export function prepareEventReminders(db:D1Database,bookingId:string,reminders:ComputedReminder[],onlyConfirmed=false):D1PreparedStatement[] {
  return reminders.map(r=>db.prepare(`INSERT INTO event_booking_reminders
    (id,booking_id,kind,scheduled_at,status,retry_count)
    SELECT ?,?,?,?,'pending',0 WHERE
      ${onlyConfirmed?"EXISTS(SELECT 1 FROM event_bookings WHERE id=? AND status='confirmed') AND ":''}
      NOT EXISTS(SELECT 1 FROM event_booking_reminders WHERE booking_id=? AND kind=? AND scheduled_at=?)`)
    .bind(crypto.randomUUID(),bookingId,r.kind,r.scheduled_at,...(onlyConfirmed?[bookingId]:[]),bookingId,r.kind,r.scheduled_at));
}
