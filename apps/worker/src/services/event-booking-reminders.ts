// Event booking reminders: schedule + cron processor.
// Phase 1 mirrors booking-reminders.ts pattern but on event_booking_reminders.

import {
  REMINDER_MAX_RETRY,
  type EventReminderKind,
} from './event-booking-types.js';
import type {
  EventBookingNotificationSender,
  EventNotificationKind,
} from './event-booking-notifier.js';
import { resolveLineCredential } from '@line-crm/db';

export interface ComputedReminder {
  kind: EventReminderKind;
  scheduled_at: string; // UTC ISO8601 (Z)
}

export interface ComputeRemindersInput {
  starts_at_utc: string; // UTC ISO8601
  reminder_day_before_enabled: boolean;
  reminder_hours_before: number | null;
  now?: Date;
}

const JST_OFFSET_MS = 9 * 3600_000;

// Reminders that fall in the past are dropped. Pure function, no DB.
export function computeRemindersForBooking(input: ComputeRemindersInput): ComputedReminder[] {
  const out: ComputedReminder[] = [];
  const startMs = new Date(input.starts_at_utc).getTime();
  const nowMs = (input.now ?? new Date()).getTime();

  if (input.reminder_day_before_enabled) {
    // 前日 18:00 JST = 09:00 UTC of the day before starts_at(JST)
    const startJst = new Date(startMs + JST_OFFSET_MS);
    const dayBeforeUtc = new Date(
      Date.UTC(
        startJst.getUTCFullYear(),
        startJst.getUTCMonth(),
        startJst.getUTCDate() - 1,
        9, // 09:00 UTC == 18:00 JST
        0,
        0,
      ),
    );
    if (dayBeforeUtc.getTime() > nowMs) {
      out.push({ kind: 'day_before', scheduled_at: dayBeforeUtc.toISOString() });
    }
  }

  if (input.reminder_hours_before != null && input.reminder_hours_before > 0) {
    const hoursBeforeMs = startMs - input.reminder_hours_before * 3600_000;
    if (hoursBeforeMs > nowMs) {
      out.push({ kind: 'hours_before', scheduled_at: new Date(hoursBeforeMs).toISOString() });
    }
  }

  return out;
}

// Persist reminders for a single booking. Caller decides when to invoke
// (e.g. after status -> 'confirmed').
export async function insertRemindersForBooking(
  db: D1Database,
  booking_id: string,
  reminders: ComputedReminder[],
): Promise<void> {
  for (const r of reminders) {
    await db
      .prepare(
        `INSERT INTO event_booking_reminders
           (id, booking_id, kind, scheduled_at, status, retry_count)
         VALUES (?, ?, ?, ?, 'pending', 0)`,
      )
      .bind(crypto.randomUUID(), booking_id, r.kind, r.scheduled_at)
      .run();
  }
}

// Cancel pending and retryable failed reminders linked to a booking
// (cancel/reject/expire flows). The cron retries `failed` rows, so a stale
// failed row left here would still notify after the booking is gone.
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
}

interface DueEventReminderRow {
  id: string;
  booking_id: string;
  line_account_id: string;
  kind: EventReminderKind;
  retry_count: number;
  event_name: string;
  venue_name: string | null;
  venue_url: string | null;
  reminder_message_extra: string | null;
  starts_at: string;
  channel_access_token: string;
  channel_access_token_encrypted: string | null;
  line_user_id: string;
  reminder_hours_before: number | null;
}

function startsAtJstFmt(utcIso: string): string {
  const jst = new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

function notificationKindFor(reminderKind: EventReminderKind): EventNotificationKind {
  return reminderKind === 'day_before' ? 'reminder_day_before' : 'reminder_hours_before';
}

export interface ProcessDueEventRemindersParams {
  now: Date;
  sender: EventBookingNotificationSender;
}

export async function processDueEventReminders(
  db: D1Database,
  params: ProcessDueEventRemindersParams,
): Promise<{ sent: number; failed: number }> {
  // status: 'pending' or 'failed' (retryable). 'sent' / 'failed_permanent'
  // / 'cancelled' are excluded. Booking must still be confirmed and slot
  // start in the future at processing time.
  const due = await db
    .prepare(
      `SELECT r.id, r.booking_id, r.kind, r.retry_count,
              b.line_account_id,
              e.name AS event_name, e.venue_name, e.venue_url,
              e.reminder_message_extra, e.reminder_hours_before,
              s.starts_at,
              la.channel_access_token,
              la.channel_access_token_encrypted,
              f.line_user_id
         FROM event_booking_reminders r
         INNER JOIN event_bookings b ON b.id = r.booking_id
         INNER JOIN events e ON e.id = b.event_id
         INNER JOIN event_slots s ON s.id = b.slot_id
         INNER JOIN line_accounts la ON la.id = b.line_account_id
         INNER JOIN friends f ON f.id = b.friend_id
        WHERE r.status IN ('pending','failed')
          AND r.scheduled_at <= ?
          AND b.status = 'confirmed'
          AND s.starts_at > ?
        LIMIT 100`,
    )
    .bind(params.now.toISOString(), params.now.toISOString())
    .all<DueEventReminderRow>();

  let sent = 0;
  let failed = 0;
  for (const row of due.results ?? []) {
    // 読み出し時点の試行回数。fence の CAS はこの値を epoch に使い、失敗記録も
    // これを基準にする (claim 後に row を読み直さない)。
    // catch へ来るのは自分が失敗したときだけ。握れなかった行は continue で
    // 抜けるので catch を通らない。よって fence の前で投げた場合 (資格情報が
    // 復号できない等) も1回ぶん数える: 数えないと retry_count が伸びず、上限で
    // failed_permanent へ打ち切れないまま failed で滞留する (due の SELECT は
    // LIMIT 100 で ORDER BY が無く、滞留行が正常なリマインダを押し出す)。
    const priorRetry = row.retry_count;
    const attemptedRetry = priorRetry + 1;
    try {
      // 送信の準備 (資格情報の復号) は fence の前に済ませる。fence と外部
      // 送信の間に待つ処理を挟まない (V6 の verifyClaimedRunBeforeSend と
      // 同じ形。窓を SQL 1文ぶんに詰める)。
      const accessToken = await resolveLineCredential(
        row.channel_access_token_encrypted,
        row.channel_access_token,
        { lineAccountId: row.line_account_id, field: 'channel_access_token' },
      );
      // Optimistic claim: bump retry_count CAS-style on (id, retry_count).
      // If two cron invocations fetched the same row, only one of them wins
      // this UPDATE; the other gets changes=0 and skips. retry_count thus
      // doubles as a claim epoch, sufficient on D1 without a dedicated lock
      // column or a new migration.
      // 併せて取消との直列化も同じ1文で行う。上の SELECT の
      // b.status='confirmed' は読み出し時にしか効かず、claim 後・送信前の
      // 取消を止められない。送る直前に予約の状態を確かめ、取消が先なら
      // 0 件にして送らない。
      const claim = await db
        .prepare(
          `UPDATE event_booking_reminders
              SET retry_count = retry_count + 1
            WHERE id = ? AND retry_count = ? AND status IN ('pending','failed')
              AND EXISTS (
                SELECT 1 FROM event_bookings b
                 WHERE b.id = event_booking_reminders.booking_id
                   AND b.status = 'confirmed')`,
        )
        .bind(row.id, priorRetry)
        .run();
      if ((claim.meta?.changes ?? 0) === 0) continue;

      await params.sender({
        channelAccessToken: accessToken,
        toLineUserId: row.line_user_id,
        kind: notificationKindFor(row.kind),
        ctx: {
          eventName: row.event_name,
          startsAtJst: startsAtJstFmt(row.starts_at),
          venueName: row.venue_name,
          venueUrl: row.venue_url,
          hoursBefore: row.reminder_hours_before ?? 0,
          reminderExtra: row.reminder_message_extra,
        },
      });
      await db
        .prepare(
          `UPDATE event_booking_reminders SET status='sent', sent_at = ? WHERE id = ?`,
        )
        .bind(params.now.toISOString(), row.id)
        .run();
      sent++;
    } catch (e) {
      // fence で握れていれば DB 上も同じ値まで進んでいる (二重に数えない)。
      const newStatus = attemptedRetry >= REMINDER_MAX_RETRY ? 'failed_permanent' : 'failed';
      await db
        .prepare(
          `UPDATE event_booking_reminders SET status = ?, retry_count = ?, last_error = ? WHERE id = ?`,
        )
        .bind(newStatus, attemptedRetry, e instanceof Error ? e.message : String(e), row.id)
        .run();
      failed++;
    }
  }
  return { sent, failed };
}

export const _internals = { REMINDER_MAX_RETRY };
