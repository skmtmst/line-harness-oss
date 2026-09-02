// Booking availability calculation.
// `computeSlots` is a pure function over Interval[]; `getAvailability`
// is the high-level entry point that fetches working hours, busy intervals,
// and applies lead-time / virtual-staff rules.

import type { AvailabilityByStaff } from './booking-types.js';
import { SLOT_GRANULARITY_MINUTES } from './booking-types.js';
import { getStaffGoogleBusy } from './booking-calendar-sync.js';
import type { GoogleServiceAccountCredentials } from './google-service-account.js';

export interface Interval {
  start: string; // HH:MM
  end: string;   // HH:MM
}

/**
 * 埋まっている時間帯。
 *
 * sameMenu は「この予約が、いま空きを計算しているメニューのものか」。
 * 同時受付数が2以上のメニュー（グループ施術など）では、同じメニューの
 * 予約は定員まで重ねられるが、別メニューの予約は定員に関係なく塞ぐ。
 * 1対1の施術とグループを同じ時間に入れることはできないため。
 *
 * Googleカレンダーの予定も別メニュー扱い（sameMenu = false）。
 */
export interface BusyInterval extends Interval {
  sameMenu?: boolean;
}

export interface ComputeSlotsInput {
  working: Interval[];
  busy: BusyInterval[];
  menu: { duration_minutes: number; buffer_after_minutes: number };
  granularityMinutes: number;
  /** 同時に受けられる件数。省略時は1（従来どおり重ねない） */
  capacity?: number;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * 勤務時間から、予約を入れられる開始時刻を並べる。
 *
 * 候補の枠を1つずつ見て、埋まっている時間帯と重なるかを判定する。
 * 以前は「勤務時間から埋まりを引き算する」形だったが、同時受付数を
 * 数えるには「何件重なっているか」が要るので、枠ごとの判定に変えた。
 * 定員1・全て別メニュー扱い、という従来の条件では結果は変わらない。
 */
export function computeSlots(input: ComputeSlotsInput): Interval[] {
  const occupy = input.menu.duration_minutes + input.menu.buffer_after_minutes;
  const display = input.menu.duration_minutes;
  const granularity = input.granularityMinutes;
  // 0 や負の値が入ると全ての枠が消える。設定ミスで予約が一切取れなくなる
  // 方が事故として大きいので、1 に寄せる。
  const capacity = Math.max(1, input.capacity ?? 1);

  const busy = input.busy.map((b) => ({
    start: toMin(b.start),
    end: toMin(b.end),
    sameMenu: b.sameMenu === true,
  }));

  const out: Interval[] = [];
  for (const w of input.working) {
    const wStart = toMin(w.start);
    const wEnd = toMin(w.end);
    let t = Math.ceil(wStart / granularity) * granularity;
    if (t < wStart) t = wStart;
    for (; t + occupy <= wEnd; t += granularity) {
      const slotEnd = t + occupy;
      let sameMenuCount = 0;
      let blocked = false;
      for (const b of busy) {
        if (!overlaps(t, slotEnd, b.start, b.end)) continue;
        if (!b.sameMenu) {
          blocked = true;
          break;
        }
        sameMenuCount++;
      }
      if (blocked || sameMenuCount >= capacity) continue;
      out.push({ start: fromMin(t), end: fromMin(t + display) });
    }
  }
  return out;
}

// ----------------------------------------------------------------
// DB layer

const JST_OFFSET_MS = 9 * 60 * 60_000;

function jstDateStr(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function jstHHMM(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(11, 16);
}

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export interface GetAvailabilityParams {
  lineAccountId: string;
  menuId: string;
  staffId?: string;
  from: string; // YYYY-MM-DD JST
  to: string;
  now: Date;
  minLeadTimeMinutes: number;
  googleCredentials?: GoogleServiceAccountCredentials;
}

export interface CalendarSyncState {
  staff_id: string;
  configured: boolean;
  ok: boolean;
  error?: 'unavailable';
}

function weekdayForDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function googleBusyForJstDate(
  intervals: Array<{ start: string; end: string }>,
  date: string,
): Interval[] {
  const dayStart = new Date(`${date}T00:00:00+09:00`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60_000;
  return intervals.flatMap((interval) => {
    const start = Math.max(new Date(interval.start).getTime(), dayStart);
    const end = Math.min(new Date(interval.end).getTime(), dayEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return [];
    const startMin = Math.floor((start - dayStart) / 60_000);
    const endMin = Math.ceil((end - dayStart) / 60_000);
    return [{ start: fromMin(startMin), end: fromMin(endMin) }];
  });
}

export async function getAvailability(
  db: D1Database,
  params: GetAvailabilityParams,
): Promise<{ by_staff: AvailabilityByStaff[] }> {
  const menu = await db
    .prepare(
      `SELECT m.duration_minutes, m.buffer_after_minutes,
              m.concurrent_capacity, m.booking_window_days, m.cutoff_hours_before,
              sm.override_duration_minutes AS override_duration,
              sm.override_price AS override_price
         FROM menus m
         LEFT JOIN staff_menus sm ON sm.menu_id = m.id AND sm.staff_id = ?2
        WHERE m.id = ?1 AND m.line_account_id = ?3
          AND m.deleted_at IS NULL AND m.is_active = 1`,
    )
    .bind(params.menuId, params.staffId ?? '', params.lineAccountId)
    .first<{
      duration_minutes: number;
      buffer_after_minutes: number;
      concurrent_capacity: number;
      booking_window_days: number | null;
      cutoff_hours_before: number | null;
      override_duration: number | null;
    }>();
  if (!menu) {
    return { by_staff: [] };
  }

  // SQL とパラメータ数を一致させる。staffId 未指定時の no-WHERE バリアントは
  // ?1 と ?2 だけを参照するので bind() も 2 引数に留める。多いと D1 が
  // "Wrong number of parameter bindings" で 500 を返す（本番再現確認済）。
  const staffStmt = params.staffId
    ? db
        .prepare(
          `SELECT s.id, s.display_name, s.is_designation_optional
             FROM staff s
             INNER JOIN staff_menus sm ON sm.staff_id = s.id AND sm.menu_id = ?2 AND sm.is_offered = 1
            WHERE s.line_account_id = ?1 AND s.is_active = 1 AND s.deleted_at IS NULL AND s.id = ?3`,
        )
        .bind(params.lineAccountId, params.menuId, params.staffId)
    : db
        .prepare(
          `SELECT s.id, s.display_name, s.is_designation_optional
             FROM staff s
             INNER JOIN staff_menus sm ON sm.staff_id = s.id AND sm.menu_id = ?2 AND sm.is_offered = 1
            WHERE s.line_account_id = ?1 AND s.is_active = 1 AND s.deleted_at IS NULL
            ORDER BY s.is_designation_optional DESC, s.sort_order ASC`,
        )
        .bind(params.lineAccountId, params.menuId);
  const staffRows = await staffStmt.all<{
    id: string;
    display_name: string;
    is_designation_optional: number;
  }>();
  if (!staffRows.results.length) return { by_staff: [] };

  const staffIds = staffRows.results.map((s) => s.id);
  const dates = eachDate(params.from, params.to);
  const placeholders = staffIds.map(() => '?').join(',');

  const shifts = await db
    .prepare(
      `SELECT staff_id, work_date, start_time, end_time
         FROM staff_shifts
        WHERE staff_id IN (${placeholders})
          AND work_date BETWEEN ? AND ?`,
    )
    .bind(...staffIds, params.from, params.to)
    .all<{ staff_id: string; work_date: string; start_time: string; end_time: string }>();

  const rules = await db
    .prepare(
      `SELECT staff_id, weekday, start_time, end_time
         FROM staff_availability_rules
        WHERE staff_id IN (${placeholders}) AND is_active = 1`,
    )
    .bind(...staffIds)
    .all<{ staff_id: string; weekday: number; start_time: string; end_time: string }>();

  // Coarse range filter: from の前日 00:00 UTC 〜 to の翌日 00:00 UTC で十分な余裕
  const rangeStart = new Date(`${params.from}T00:00:00Z`);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - 1);
  const rangeEnd = new Date(`${params.to}T00:00:00Z`);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);

  const bookings = await db
    .prepare(
      `SELECT staff_id, menu_id, starts_at, block_ends_at
         FROM bookings
        WHERE staff_id IN (${placeholders})
          AND status IN ('requested','confirmed')
          AND starts_at < ?
          AND block_ends_at > ?`,
    )
    .bind(...staffIds, rangeEnd.toISOString(), rangeStart.toISOString())
    .all<{ staff_id: string; menu_id: string; starts_at: string; block_ends_at: string }>();

  const menuForCalc = {
    duration_minutes: menu.override_duration ?? menu.duration_minutes,
    buffer_after_minutes: menu.buffer_after_minutes,
  };
  // 受付の締め切り。全体の最短リード時間とメニューごとの締め切りの、
  // 遅い方を採る。片方だけを見ると、どちらかの設定が黙って無視される。
  const cutoffMinutes = Math.max(
    params.minLeadTimeMinutes,
    (menu.cutoff_hours_before ?? 0) * 60,
  );
  const minLeadAt = new Date(params.now.getTime() + cutoffMinutes * 60_000);

  // 何日先まで受けるか。未設定なら制限しない。
  // 期間の判定は「その日の終わり」ではなく開始時刻で行う。3日先まで、が
  // 「3日後の23:59まで」ではなく「3日後の同時刻まで」だと分かりにくいため、
  // 日付で切る。
  const windowLastDate =
    menu.booking_window_days == null
      ? null
      : jstDateStr(new Date(params.now.getTime() + menu.booking_window_days * 24 * 60 * 60_000));

  const googleBusyByStaff = new Map<string, Array<{ start: string; end: string }> | null>();
  const calendarSync: CalendarSyncState[] = [];
  for (const staff of staffRows.results) {
    try {
      const busy = await getStaffGoogleBusy(db, params.googleCredentials ?? {}, {
        lineAccountId: params.lineAccountId,
        staffId: staff.id,
        timeMin: new Date(`${params.from}T00:00:00+09:00`).toISOString(),
        timeMax: new Date(new Date(`${params.to}T00:00:00+09:00`).getTime() + 24 * 60 * 60_000).toISOString(),
      });
      googleBusyByStaff.set(staff.id, busy);
      calendarSync.push({ staff_id: staff.id, configured: busy !== null, ok: true });
    } catch (error) {
      // Configured calendar must fail closed. Showing slots while Google is
      // unreachable can create double bookings.
      console.error(`Google Calendar availability failed for staff=${staff.id}`, error);
      googleBusyByStaff.set(staff.id, []);
      calendarSync.push({ staff_id: staff.id, configured: true, ok: false, error: 'unavailable' });
    }
  }

  const by_staff: AvailabilityByStaff[] = [];
  for (const s of staffRows.results) {
    const slots: AvailabilityByStaff['slots'] = [];
    const syncState = calendarSync.find((state) => state.staff_id === s.id);
    if (syncState?.configured && !syncState.ok) {
      by_staff.push({ staff_id: s.id, display_name: s.display_name, slots });
      continue;
    }
    for (const date of dates) {
      if (windowLastDate && date > windowLastDate) continue;
      const shift = shifts.results.find((r) => r.staff_id === s.id && r.work_date === date);
      const rule = rules.results.find(
        (r) => r.staff_id === s.id && r.weekday === weekdayForDate(date),
      );
      const working = shift ?? rule;
      if (!working) continue;
      const dayBookings: BusyInterval[] = bookings.results
        .filter((b) => b.staff_id === s.id)
        .filter((b) => jstDateStr(new Date(b.starts_at)) === date)
        .map((b) => ({
          start: jstHHMM(new Date(b.starts_at)),
          end: jstHHMM(new Date(b.block_ends_at)),
          // 同じメニューの予約だけが定員まで重ねられる。
          sameMenu: b.menu_id === params.menuId,
        }));
      const googleBusy = googleBusyByStaff.get(s.id);
      // 外の予定は定員に関係なく塞ぐ（sameMenu を付けない）。
      if (googleBusy) dayBookings.push(...googleBusyForJstDate(googleBusy, date));
      const daySlots = computeSlots({
        working: [{ start: working.start_time, end: working.end_time }],
        busy: dayBookings,
        menu: menuForCalc,
        granularityMinutes: SLOT_GRANULARITY_MINUTES,
        capacity: menu.concurrent_capacity,
      });
      for (const slot of daySlots) {
        const slotStartUtc = new Date(`${date}T${slot.start}:00+09:00`);
        if (slotStartUtc < minLeadAt) continue;
        slots.push({ date, start: slot.start, end: slot.end });
      }
    }
    by_staff.push({ staff_id: s.id, display_name: s.display_name, slots });
  }
  return { by_staff, calendar_sync: calendarSync } as {
    by_staff: AvailabilityByStaff[];
    calendar_sync: CalendarSyncState[];
  };
}
