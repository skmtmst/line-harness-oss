// Cron handler: expire 24h-old `requested` event bookings + purge
// idempotency rows. Mirrors booking-expirer.ts but without a friend
// notification — spec §7.1 lists no expired-kind notification for events.

import { purgeExpiredEventIdempotency } from './event-booking-idempotency.js';
import { REQUESTED_EXPIRE_HOURS } from './event-booking-types.js';
import { enqueueEventWaitlistPromotion } from './event-waitlist.js';
import { cancelByTrigger } from './reminder-trigger.js';

interface StaleRow {
  id: string;
  line_account_id: string;
  friend_id: string;
  event_id: string;
  slot_id: string;
  starts_at: string | null;
}

export interface RunEventBookingExpirerParams {
  now: Date;
}

export async function runEventBookingExpirer(
  db: D1Database,
  params: RunEventBookingExpirerParams,
): Promise<{ expired: number; idempotencyPurged: number }> {
  const cutoff = new Date(
    params.now.getTime() - REQUESTED_EXPIRE_HOURS * 3600_000,
  ).toISOString();
  const stale = await db
    .prepare(
      `SELECT b.id, b.line_account_id, b.friend_id, b.event_id, b.slot_id, s.starts_at
         FROM event_bookings b
         LEFT JOIN event_slots s ON s.id = b.slot_id
        WHERE b.status = 'requested' AND b.requested_at < ?
        LIMIT 200`,
    )
    .bind(cutoff)
    .all<StaleRow>();

  let expired = 0;
  for (const row of stale.results ?? []) {
    // Conditional UPDATE to avoid racing with concurrent admin decide.
    const upd = await db
      .prepare(
        `UPDATE event_bookings
            SET status = 'expired', decided_at = ?, updated_at = ?
          WHERE id = ? AND status = 'requested'`,
      )
      .bind(params.now.toISOString(), params.now.toISOString(), row.id)
      .run();
    if ((upd.meta?.changes ?? 0) === 0) continue;
    await db
      .prepare(
        `UPDATE event_booking_reminders
            SET status = 'cancelled'
          WHERE booking_id = ? AND status IN ('pending','failed')`,
      )
      .bind(row.id)
      .run();
    // N-065: 期限切れも取消と同じく V6 の未送信予定だけを止める。送信済み履歴は残す。
    // 1件の失敗で残りを止めないよう行単位で握る。再実行は active が無いため冪等。
    try {
      await cancelByTrigger(db, {
        triggerType: 'event',
        sourceId: row.id,
        sourceEventId: row.id,
        friendId: row.friend_id,
        startsAtIso: row.starts_at,
        lineAccountId: row.line_account_id,
        cancelReason: `event_expired:${row.id}:by:system`,
      });
    } catch (error) {
      console.error('reminder cancel (event expired) failed:', error);
    }
    await enqueueEventWaitlistPromotion(db, {
      lineAccountId: row.line_account_id,
      eventId: row.event_id,
      occurrenceId: row.slot_id,
      sourceKey: `booking:${row.id}:expired`,
      now: params.now,
    });
    expired++;
  }

  const idempotencyPurged = await purgeExpiredEventIdempotency(db, params.now);
  return { expired, idempotencyPurged };
}
