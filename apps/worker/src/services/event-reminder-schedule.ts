import { jstCalendar as japanCalendar } from '@line-crm/shared';
export type { ComputedReminder, ComputeRemindersInput } from './event-reminder-types.js';
import type { ComputedReminder, ComputeRemindersInput } from './event-reminder-types.js';
import { prepareEventReminders } from './event-reminder-plan.js';
import type { EventReminderKind } from './event-booking-types.js';


// 過去になった予定は送らない。予定計算は DB を使わない純粋関数にする。
export function computeRemindersForBooking(input: ComputeRemindersInput): ComputedReminder[] {
  const out: ComputedReminder[] = [];
  const startMs = new Date(input.starts_at_utc).getTime();
  const nowMs = (input.now ?? new Date()).getTime();

  if (input.reminder_day_before_enabled) {
    // 前日 18:00 JST = 09:00 UTC of the day before starts_at(JST)
    const startJst = japanCalendar(new Date(startMs));
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

// 保存のタイミングは確定後などの呼出元が決め、ここでは1予約の予定だけを保存する。
export async function insertRemindersForBooking(
  db: D1Database,
  booking_id: string,
  reminders: ComputedReminder[],
): Promise<void> {
  for (const statement of prepareEventReminders(db,booking_id,reminders)) await statement.run();
}
