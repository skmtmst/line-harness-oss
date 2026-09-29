// Confirmation side-effects shared by the admin approve route (PATCH
// /api/booking/admin/requests/:id) and the admin proxy-create route
// (POST /api/booking/admin/bookings).
//
// Reminders already in the past are skipped so that confirming a
// same-day booking does not immediately fire "明日のご予約" messages.

import { DEFAULT_ACCOUNT_SETTINGS } from './booking-types.js';
import { getBookingAdminSettings } from '@line-crm/db';

export interface BookingReminderScheduleItem {
  kind: 'day_before' | 'hours_before';
  scheduledAt: string;
}

/** そのタイムゾーンでの日付（YYYY-MM-DD）。 */
function tzDateStr(tz: string, d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** そのタイムゾーンの壁時刻（date + HH:MM）を UTC 瞬間へ直す。 */
function zonedTimeToUtcMs(tz: string, date: string, hhmm: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (at: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(at));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute')) - at;
  };
  let guess = wall - offset(wall);
  guess = wall - offset(guess);
  return guess;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface ReminderScheduleOptions {
  /** 当日お知らせを開始の何時間前に送るか。未指定なら店舗既定（2時間前）。 */
  reminderHoursBefore?: number;
  /** 前日お知らせの店舗固定時刻（HH:MM・店舗TZ）。未指定なら24時間前。 */
  dayBeforeTime?: string | null;
  /** 店舗タイムゾーン。dayBeforeTime の解釈に使う。 */
  timeZone?: string;
  /** 種別ごとの送信可否。未指定は両方送る。 */
  kinds?: { dayBefore?: boolean; hoursBefore?: boolean };
}

export function buildConfirmationReminderSchedule(args: {
  startsAt: Date;
  now: Date;
} & ReminderScheduleOptions): BookingReminderScheduleItem[] {
  const hours = args.reminderHoursBefore ?? DEFAULT_ACCOUNT_SETTINGS.reminder_hours_before;
  const candidates: BookingReminderScheduleItem[] = [];
  if (args.kinds?.dayBefore !== false) {
    if (args.dayBeforeTime) {
      // 店舗固定時刻: 予約日の前日（店舗暦日）の HH:MM に送る。
      const timeZone = args.timeZone ?? 'Asia/Tokyo';
      const dayBefore = addDays(tzDateStr(timeZone, args.startsAt), -1);
      candidates.push({
        kind: 'day_before',
        scheduledAt: new Date(zonedTimeToUtcMs(timeZone, dayBefore, args.dayBeforeTime)).toISOString(),
      });
    } else {
      candidates.push({
        kind: 'day_before',
        scheduledAt: new Date(args.startsAt.getTime() - 86400_000).toISOString(),
      });
    }
  }
  if (args.kinds?.hoursBefore !== false) {
    candidates.push({
      kind: 'hours_before',
      scheduledAt: new Date(args.startsAt.getTime() - hours * 3600_000).toISOString(),
    });
  }
  return candidates.filter((item) => new Date(item.scheduledAt) > args.now);
}

export interface ReminderTiming {
  reminderHoursBefore: number;
  dayBeforeTime: string | null;
  timeZone: string;
}

/**
 * アカウントのリマインダ時刻設定を読む。設定行が無い・列が空の店舗は
 * 従来どおり「24時間前 + 2時間前」。タイムゾーンも店舗設定に合わせる。
 */
export async function getReminderTiming(
  db: D1Database,
  lineAccountId: string,
): Promise<ReminderTiming> {
  const settings = await getBookingAdminSettings(db, lineAccountId);
  return {
    reminderHoursBefore: settings?.reminderHoursBefore ?? DEFAULT_ACCOUNT_SETTINGS.reminder_hours_before,
    dayBeforeTime: settings?.reminderDayBeforeTime ?? null,
    timeZone: settings?.timeZone ?? 'Asia/Tokyo',
  };
}

export async function insertConfirmationReminders(
  db: D1Database,
  args: {
    bookingId: string;
    startsAt: Date;
    now: Date;
  } & ReminderScheduleOptions,
): Promise<number> {
  const inserts = buildConfirmationReminderSchedule(args).map((item) => db
    .prepare(`INSERT INTO booking_reminders (id, booking_id, kind, scheduled_at) VALUES (?,?,?,?)`)
    .bind(crypto.randomUUID(), args.bookingId, item.kind, item.scheduledAt));
  if (inserts.length > 0) {
    await db.batch(inserts);
  }
  return inserts.length;
}
