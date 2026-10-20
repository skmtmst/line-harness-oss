import { getReminderTiming, insertConfirmationReminders } from '../../features/booking/booking-confirm/index.js';
import { recordBookingAudit } from '@line-crm/db';
import { queueBookingOperation } from '../../features/booking/booking-operation-runs/index.js';
import { BOOKING_CONFIRMED_AUTOMATION_EVENT } from './availability.js';

/**
 * R560: 予約INSERTの後に履歴・予定処理の書き込みが欠けた保留予約へ、
 * 同じ要求の再送で不足を埋める。存在するものは作り直さない。
 * - 履歴: action='created' が無ければ1件だけ足す。
 * - カレンダー連携の予定行: 同じ一意キーで置く（重ね書きしない）。
 * - 友だち付きの予約だけ: リマインダが0件なら方針どおり作り直し、
 *   確認連絡・自動化の予定行も同じ一意キーで置く。
 * 外への送信そのものは再送では起こさず、予定行を残して背景の再試行に任せる。
 */
export async function ensureProxyBookingSideEffects(
  db: D1Database,
  row: {
    id: string;
    staff_id: string;
    menu_id: string;
    starts_at: string;
    price_at_booking: number;
    source: string;
    notification_policy_snapshot: string | null;
  },
  scope: {
    lineAccountId: string;
    friendId: string | null;
  },
  actor: { actorType: 'staff'; actorId: string | null; actorName: string | null },
): Promise<void> {
  const audit = await db
    .prepare(
      `SELECT id FROM booking_audit_logs
        WHERE booking_id = ? AND line_account_id = ? AND action = 'created'`,
    )
    .bind(row.id, scope.lineAccountId)
    .first<{ id: string }>();
  if (!audit) {
    await recordBookingAudit(db, {
      bookingId: row.id,
      lineAccountId: scope.lineAccountId,
      action: 'created',
      after: {
        status: 'confirmed',
        staff_id: row.staff_id,
        menu_id: row.menu_id,
        starts_at: row.starts_at,
        price: Number(row.price_at_booking),
        source: row.source,
      },
      ...actor,
      occurredAt: new Date().toISOString(),
    });
  }
  await queueBookingOperation(db, {
    bookingId: row.id,
    lineAccountId: scope.lineAccountId,
    kind: 'google_calendar',
    idempotencyKey: `${row.id}:google-calendar:create`,
  });
  if (!scope.friendId) return;
  let policy: { send_line_confirmation?: unknown; day_before?: unknown; hours_before?: unknown } = {};
  try {
    policy = JSON.parse(row.notification_policy_snapshot ?? '{}') as typeof policy;
  } catch {
    policy = {};
  }
  const sendDayBefore = policy.day_before ?? true;
  const sendHoursBefore = policy.hours_before ?? true;
  if (sendDayBefore || sendHoursBefore) {
    const existing = await db
      .prepare(`SELECT COUNT(*) AS n FROM booking_reminders WHERE booking_id = ?`)
      .bind(row.id)
      .first<{ n: number }>();
    if (!existing || existing.n === 0) {
      const timing = await getReminderTiming(db, scope.lineAccountId);
      await insertConfirmationReminders(db, {
        bookingId: row.id,
        startsAt: new Date(row.starts_at),
        now: new Date(),
        reminderHoursBefore: timing.reminderHoursBefore,
        dayBeforeTime: timing.dayBeforeTime,
        timeZone: timing.timeZone,
        kinds: { dayBefore: Boolean(sendDayBefore), hoursBefore: Boolean(sendHoursBefore) },
      });
    }
  }
  if (policy.send_line_confirmation ?? true) {
    await queueBookingOperation(db, {
      bookingId: row.id,
      lineAccountId: scope.lineAccountId,
      kind: 'confirmation_line',
      idempotencyKey: `${row.id}:confirmation-line:approved`,
      result: { notificationKind: 'approved', openTracking: 'inbox' },
    });
  }
  await queueBookingOperation(db, {
    bookingId: row.id,
    lineAccountId: scope.lineAccountId,
    kind: 'automation',
    idempotencyKey: `${row.id}:automation:calendar-booked`,
    result: { eventType: BOOKING_CONFIRMED_AUTOMATION_EVENT },
  });
}
