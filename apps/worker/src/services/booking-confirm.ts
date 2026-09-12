// Confirmation side-effects shared by the admin approve route (PATCH
// /api/booking/admin/requests/:id) and the admin proxy-create route
// (POST /api/booking/admin/bookings).
//
// Reminders already in the past are skipped so that confirming a
// same-day booking does not immediately fire "明日のご予約" messages.

import { DEFAULT_ACCOUNT_SETTINGS } from './booking-types.js';

export interface BookingReminderScheduleItem {
  kind: 'day_before' | 'hours_before';
  scheduledAt: string;
}

export function buildConfirmationReminderSchedule(args: {
  startsAt: Date;
  now: Date;
  reminderHoursBefore?: number;
}): BookingReminderScheduleItem[] {
  const hours = args.reminderHoursBefore ?? DEFAULT_ACCOUNT_SETTINGS.reminder_hours_before;
  const candidates: BookingReminderScheduleItem[] = [
    { kind: 'day_before', scheduledAt: new Date(args.startsAt.getTime() - 86400_000).toISOString() },
    { kind: 'hours_before', scheduledAt: new Date(args.startsAt.getTime() - hours * 3600_000).toISOString() },
  ];
  return candidates.filter((item) => new Date(item.scheduledAt) > args.now);
}

export async function insertConfirmationReminders(
  db: D1Database,
  args: {
    bookingId: string;
    startsAt: Date;
    now: Date;
    reminderHoursBefore?: number;
  },
): Promise<number> {
  const inserts = buildConfirmationReminderSchedule(args).map((item) => db
    .prepare(`INSERT INTO booking_reminders (id, booking_id, kind, scheduled_at) VALUES (?,?,?,?)`)
    .bind(crypto.randomUUID(), args.bookingId, item.kind, item.scheduledAt));
  if (inserts.length > 0) {
    await db.batch(inserts);
  }
  return inserts.length;
}
