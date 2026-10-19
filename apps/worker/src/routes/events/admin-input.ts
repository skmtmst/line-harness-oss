import { type Context } from 'hono';
import type { Env } from '../../worker-env.js';
import { computeRemindersForBooking, insertRemindersForBooking, cancelPendingRemindersFor } from '../../services/event-booking-reminders.js';

// Cancel all pending reminders for an event's confirmed bookings, then
// regenerate them from the latest event settings + slot starts_at.
export async function rebuildRemindersForEvent(db: D1Database, event_id: string): Promise<void> {
  const ev = await db
    .prepare(
      `SELECT reminder_day_before_enabled, reminder_hours_before
         FROM events WHERE id = ?`,
    )
    .bind(event_id)
    .first<{ reminder_day_before_enabled: number; reminder_hours_before: number | null }>();
  if (!ev) return;
  const rows = await db
    .prepare(
      `SELECT b.id AS booking_id, s.starts_at
         FROM event_bookings b
         JOIN event_slots s ON s.id = b.slot_id
        WHERE b.event_id = ? AND b.status = 'confirmed'`,
    )
    .bind(event_id)
    .all<{ booking_id: string; starts_at: string }>();
  for (const r of rows.results ?? []) {
    await cancelPendingRemindersFor(db, r.booking_id);
    const reminders = computeRemindersForBooking({
      starts_at_utc: r.starts_at,
      reminder_day_before_enabled: ev.reminder_day_before_enabled === 1,
      reminder_hours_before: ev.reminder_hours_before,
    });
    await insertRemindersForBooking(db, r.booking_id, reminders);
  }
}

export async function rebuildRemindersForSlot(db: D1Database, slot_id: string): Promise<void> {
  const slot = await db
    .prepare(`SELECT starts_at, event_id FROM event_slots WHERE id = ?`)
    .bind(slot_id)
    .first<{ starts_at: string; event_id: string }>();
  if (!slot) return;
  const ev = await db
    .prepare(
      `SELECT reminder_day_before_enabled, reminder_hours_before
         FROM events WHERE id = ?`,
    )
    .bind(slot.event_id)
    .first<{ reminder_day_before_enabled: number; reminder_hours_before: number | null }>();
  if (!ev) return;
  const rows = await db
    .prepare(
      `SELECT id AS booking_id FROM event_bookings
        WHERE slot_id = ? AND status = 'confirmed'`,
    )
    .bind(slot_id)
    .all<{ booking_id: string }>();
  for (const r of rows.results ?? []) {
    await cancelPendingRemindersFor(db, r.booking_id);
    const reminders = computeRemindersForBooking({
      starts_at_utc: slot.starts_at,
      reminder_day_before_enabled: ev.reminder_day_before_enabled === 1,
      reminder_hours_before: ev.reminder_hours_before,
    });
    await insertRemindersForBooking(db, r.booking_id, reminders);
  }
}

// ============================================================
// U: イベントの状態・変更確認・待ちの手動操作
// -29 §10・§11-2。状態を変える操作は event_change_logs に残す。
// ============================================================

/** 変更の記録に残す操作者。staff ミドルウェアが無い口では null。 */
export function changeActor(c: Context<Env>): { id: string | null; role: string | null } {
  try {
    const staff = c.get('staff') as { id?: string; role?: string } | undefined;
    return { id: staff?.id ?? null, role: staff?.role ?? null };
  } catch {
    return { id: null, role: null };
  }
}

export function waitlistReason(body: Record<string, unknown>): string | null {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  return reason.length > 0 ? reason : null;
}
