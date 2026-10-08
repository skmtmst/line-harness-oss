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
import {
  ensureWorkflowStep, claimWorkflowStep, finishWorkflowStep, failWorkflowStep, releaseWorkflowStep,
  activeTenantLineAccountSql,
  isOperationCapabilityStopped,
  resolveLineCredential,
} from '@line-crm/db';
import { stoppedTenantLineAccountSql } from './tenant-runtime-status.js';
import { featureJobCanRun } from './feature-enforcement.js';

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
         SELECT ?, ?, ?, ?, 'pending', 0
          WHERE NOT EXISTS (
            SELECT 1 FROM event_booking_reminders
             WHERE booking_id = ? AND kind = ? AND scheduled_at = ?
          )`,
      )
      .bind(
        crypto.randomUUID(), booking_id, r.kind, r.scheduled_at,
        booking_id, r.kind, r.scheduled_at,
      )
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
  await db.prepare(
    `UPDATE event_booking_reminders
        SET status = 'cancelled', last_error = 'tenant_suspended'
      WHERE status IN ('pending','failed')
        AND scheduled_at <= ?
        AND EXISTS (
          SELECT 1 FROM event_bookings stopped_booking
           WHERE stopped_booking.id = event_booking_reminders.booking_id
             AND ${stoppedTenantLineAccountSql('stopped_booking.line_account_id')}
        )`,
  ).bind(params.now.toISOString()).run();
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
          AND ${activeTenantLineAccountSql('b.line_account_id')}
          AND NOT EXISTS(SELECT 1 FROM workflow_steps ws WHERE ws.scope_id='line:' || b.line_account_id
            AND ws.process_kind='event_reminder' AND ws.subject_id=r.id AND ws.step_key='send'
            AND (ws.status IN ('exhausted','unknown','canceled') OR ws.next_attempt_at>?
              OR (ws.status='running' AND ws.lease_expires_at>?)))
        LIMIT 100`,
    )
    .bind(params.now.toISOString(), params.now.toISOString(),params.now.getTime(),params.now.getTime())
    .all<DueEventReminderRow>();

  let sent = 0;
  let failed = 0;
  for (const row of due.results ?? []) {
    // 機能オフ中はclaimせずpendingのまま残す。再オンで再開する。
    if (row.line_account_id && !await featureJobCanRun(db, { accountId: row.line_account_id, featureId: 'events', job: 'event reminders' })) {
      continue;
    }
    // 緊急停止 (#1050): reminder_dispatch が止まっている統括は claim せず
    // pending のまま残す。復旧すれば次の cron が拾う。
    if (await isOperationCapabilityStopped(db, row.line_account_id, 'reminder_dispatch')) {
      continue;
    }
    const ref = { scopeId: `line:${row.line_account_id}`, processKind: 'event_reminder', subjectId: row.id, stepKey: 'send' };
    const now = params.now.getTime();
    const snapshot = await ensureWorkflowStep(db, ref, {
      now, maxAttempts: REMINDER_MAX_RETRY, initialAttempts:row.retry_count,
      input: {
        toLineUserId: row.line_user_id,
        kind: notificationKindFor(row.kind),
        ctx: { eventName: row.event_name, startsAtJst: startsAtJstFmt(row.starts_at),
          venueName: row.venue_name, venueUrl: row.venue_url,
          hoursBefore: row.reminder_hours_before ?? 0, reminderExtra: row.reminder_message_extra },
      },
    });
    // A provider acknowledgement followed by a failed domain write is reconciled without sending again.
    if (snapshot.status === 'succeeded') {
      await db.prepare(`UPDATE event_booking_reminders SET status='sent', sent_at=?
        WHERE id=? AND status IN ('pending','failed')`).bind(params.now.toISOString(),row.id).run();
      continue;
    }
    const lease = await claimWorkflowStep(db,ref,{now});
    if (!lease) continue;
    const owner = lease.lease_owner!;
    try {
      const accessToken = await resolveLineCredential(row.channel_access_token_encrypted,row.channel_access_token,
        { lineAccountId: row.line_account_id, field: 'channel_access_token' });
      const eligible = await db.prepare(`SELECT 1 ok FROM event_booking_reminders r
        JOIN event_bookings b ON b.id=r.booking_id WHERE r.id=? AND r.status IN ('pending','failed')
        AND b.status='confirmed' AND ${activeTenantLineAccountSql('b.line_account_id')}`).bind(row.id).first();
      if (!eligible || await isOperationCapabilityStopped(db,row.line_account_id,'reminder_dispatch')) {
        await releaseWorkflowStep(db,ref,owner,now);
        continue;
      }
      // LINE remembers retry UUIDs for 24 hours. An uncertain old dispatch needs human reconciliation.
      if (lease.attempt_count > 1 && now - lease.first_attempt_at! >= 23 * 3600_000) {
        await failWorkflowStep(db,ref,owner,{now,unknown:true,code:'delivery_unknown'});
        continue;
      }
      const input = JSON.parse(lease.input_json!);
      await params.sender({ ...input, channelAccessToken: accessToken, retryKey: lease.retry_key });
      await finishWorkflowStep(db,ref,owner,{now,result:{accepted:true},statements:[
        db.prepare(`UPDATE event_booking_reminders SET status='sent',sent_at=?,retry_count=?,last_error=NULL
          WHERE id=? AND status IN ('pending','failed')`).bind(params.now.toISOString(),lease.attempt_count,row.id),
      ]});
      sent++;
    } catch {
      await failWorkflowStep(db,ref,owner,{now,delayMs:60_000,code:'delivery_failed'});
      // Only this owner's failure may change the reminder. Cancellation and accepted sends stay intact.
      await db.prepare(`UPDATE event_booking_reminders SET status=?,retry_count=?,last_error='delivery_failed'
        WHERE id=? AND status IN ('pending','failed') AND EXISTS (SELECT 1 FROM workflow_steps
          WHERE scope_id=? AND process_kind='event_reminder' AND subject_id=? AND step_key='send'
            AND attempt_count=? AND status IN ('failed','exhausted'))`)
        .bind(lease.attempt_count>=REMINDER_MAX_RETRY?'failed_permanent':'failed',lease.attempt_count,row.id,
          ref.scopeId,row.id,lease.attempt_count).run();
      failed++;
    }
  }
  return { sent, failed };
}

export const _internals = { REMINDER_MAX_RETRY };
