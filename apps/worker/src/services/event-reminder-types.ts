import type { EventReminderKind } from './event-booking-types.js';
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
