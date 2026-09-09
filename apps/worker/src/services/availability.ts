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

function isHhmm(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** 重なる稼働区間をまとめる。例外日が複数ある日の union 用。 */
function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .map((i) => ({ s: toMin(i.start), e: toMin(i.end) }))
    .filter((v) => Number.isFinite(v.s) && Number.isFinite(v.e) && v.s < v.e)
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const merged: Array<{ s: number; e: number }> = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last && cur.s <= last.e) last.e = Math.max(last.e, cur.e);
    else merged.push({ ...cur });
  }
  return merged.map((m) => ({ start: fromMin(m.s), end: fromMin(m.e) }));
}

/** 稼働区間と店舗例外時間の共通部分だけを残す（短縮営業用）。 */
function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const s = Math.max(toMin(x.start), toMin(y.start));
      const e = Math.min(toMin(x.end), toMin(y.end));
      if (s < e) out.push({ start: fromMin(s), end: fromMin(e) });
    }
  }
  return mergeIntervals(out);
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

const FALLBACK_TIME_ZONE = 'Asia/Tokyo';

/** booking_settings.timezone を読む。壊れた値は Asia/Tokyo に寄せる。 */
function normalizeTimeZone(raw: unknown): string {
  const candidate = typeof raw === 'string' && raw.trim() ? raw.trim() : FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    console.error('booking availability: invalid timezone, falling back to Asia/Tokyo');
    return FALLBACK_TIME_ZONE;
  }
}

function tzParts(tz: string, d: Date): { y: number; mo: number; day: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return { y: get('year'), mo: get('month'), day: get('day'), h: get('hour') % 24, mi: get('minute') };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** そのタイムゾーンでの日付（例外日・予約帰属の突合に使う）。 */
export function tzDateStr(tz: string, d: Date): string {
  const p = tzParts(tz, d);
  return `${p.y}-${pad2(p.mo)}-${pad2(p.day)}`;
}

/** そのタイムゾーンでの時刻。 */
export function tzHHMM(tz: string, d: Date): string {
  const p = tzParts(tz, d);
  return `${pad2(p.h)}:${pad2(p.mi)}`;
}

/** UTC 瞬間におけるそのタイムゾーンのずれ（分未満切り捨て）。 */
function tzOffsetMs(tz: string, utcMs: number): number {
  const floored = utcMs - (utcMs % 60_000);
  const p = tzParts(tz, new Date(floored));
  return Date.UTC(p.y, p.mo - 1, p.day, p.h, p.mi) - floored;
}

/** 「そのタイムゾーンの日付+時刻」を UTC 瞬間へ直す（枠・締切の比較用）。 */
function zonedTimeToUtcMs(tz: string, date: string, hhmm: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  // 壁時刻を UTC と見なした値からずれを引く。ずれは推定値に依存する
  //（夏時間）ため、壁時刻を起点に2回求め直す。差分を積むと2重にずれる。
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall - tzOffsetMs(tz, wall);
  guess = wall - tzOffsetMs(tz, guess);
  return guess;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * instant をそのタイムゾーンの offset 付き ISO へ直す（候補の一意識別子）。
 * 同じ壁時刻が2回現れる fold 日でも offset で区別できる
 *（01:30-04:00 と 01:30-05:00）。
 */
function tzInstantIso(tz: string, utcMs: number): string {
  const p = tzParts(tz, new Date(utcMs));
  const offset = tzOffsetMs(tz, utcMs);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const sec = new Date(utcMs).getUTCSeconds();
  return `${p.y}-${pad2(p.mo)}-${pad2(p.day)}T${pad2(p.h)}:${pad2(p.mi)}:${pad2(sec)}`
    + `${sign}${pad2(Math.floor(abs / 3_600_000))}:${pad2(Math.floor((abs % 3_600_000) / 60_000))}`;
}

/** 店舗のタイムゾーン。booking.ts の競合代替候補でも使う。 */
export async function getAccountTimeZone(
  db: D1Database,
  lineAccountId: string,
): Promise<string> {
  const row = await db
    .prepare(`SELECT timezone FROM booking_settings WHERE line_account_id = ?`)
    .bind(lineAccountId)
    .first<{ timezone: string | null }>();
  return normalizeTimeZone(row?.timezone ?? FALLBACK_TIME_ZONE);
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
  // 暦日の曜日はタイムゾーンに依らない。00:00Z の曜日＝その日付の曜日。
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function googleBusyForDate(
  intervals: Array<{ start: string; end: string }>,
  date: string,
  timeZone: string,
): Interval[] {
  const dayStart = zonedTimeToUtcMs(timeZone, date, '00:00');
  const dayEnd = zonedTimeToUtcMs(timeZone, addDays(date, 1), '00:00');
  return intervals.flatMap((interval) => {
    const start = new Date(interval.start).getTime();
    const end = new Date(interval.end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return [];
    // その日の範囲で切り取り、端点を壁時刻へ直接直す。現地0時からの
    // 実経過分で HH:MM 化すると、夏時間の切替日（存在しない 02:00 台や
    // 25時まである日）にずれる。NY DST 開始の 07:00Z は 03:00 であり、
    // 実経過 120 分の「02:00」ではない。
    const clippedStart = Math.max(start, dayStart);
    const clippedEnd = Math.min(end, dayEnd);
    if (clippedStart >= clippedEnd) return [];
    const busyStart = tzHHMM(timeZone, new Date(clippedStart));
    // 日終端ちょうどは「24:00」と書く（toMin で 1440 になる）。
    const busyEnd = clippedEnd === dayEnd ? '24:00' : tzHHMM(timeZone, new Date(clippedEnd));
    if (toMin(busyStart) >= toMin(busyEnd)) return [];
    return [{ start: busyStart, end: busyEnd }];
  });
}

interface AvailabilityExceptionRow {
  scope_kind: string;
  scope_id: string | null;
  date_from: string;
  date_to: string;
  kind: string;
  hours_json: string;
}

/**
 * 例外日の時間を読む。壊れた行は null（呼び出し側で fail-closed 扱い）。
 *
 * 書き込み口（POST/PATCH /api/booking/admin/exceptions）が形を検証済み
 * だが、手編集の DB でも予約を受けてしまわないよう、ここでも見直す。
 */
function parseExceptionHours(raw: string): Interval[] | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: Interval[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null;
    const value = item as Record<string, unknown>;
    if (typeof value.start !== 'string' || typeof value.end !== 'string') return null;
    if (!isHhmm(value.start) || !isHhmm(value.end) || !(value.start < value.end)) return null;
    out.push({ start: value.start, end: value.end });
  }
  return out;
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
         LEFT JOIN staff_menus sm ON sm.menu_id = m.id AND sm.staff_id = ?
        WHERE m.id = ? AND m.line_account_id = ?
          AND m.deleted_at IS NULL AND m.is_active = 1`,
    )
    .bind(params.staffId ?? '', params.menuId, params.lineAccountId)
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
  // 2 引数に留める。多いと D1 が "Wrong number of parameter bindings" で
  // 500 を返す（本番再現確認済）。番号付き ?NN は D1 と better-sqlite3 で
  // 数え方が違うため、ここでは無名 ? を文の順に並べる。
  const staffStmt = params.staffId
    ? db
        .prepare(
          `SELECT s.id, s.display_name, s.is_designation_optional
             FROM staff s
             INNER JOIN staff_menus sm ON sm.staff_id = s.id AND sm.menu_id = ? AND sm.is_offered = 1
            WHERE s.line_account_id = ? AND s.is_active = 1 AND s.deleted_at IS NULL AND s.id = ?`,
        )
        .bind(params.menuId, params.lineAccountId, params.staffId)
    : db
        .prepare(
          `SELECT s.id, s.display_name, s.is_designation_optional
             FROM staff s
             INNER JOIN staff_menus sm ON sm.staff_id = s.id AND sm.menu_id = ? AND sm.is_offered = 1
            WHERE s.line_account_id = ? AND s.is_active = 1 AND s.deleted_at IS NULL
            ORDER BY s.is_designation_optional DESC, s.sort_order ASC`,
        )
        .bind(params.menuId, params.lineAccountId);
  const staffRows = await staffStmt.all<{
    id: string;
    display_name: string;
    is_designation_optional: number;
  }>();
  if (!staffRows.results.length) return { by_staff: [] };

  const staffIds = staffRows.results.map((s) => s.id);
  const dates = eachDate(params.from, params.to);
  const placeholders = staffIds.map(() => '?').join(',');

  const [businessHours, menuResources, exceptionsResult, settingsRow] = await Promise.all([
    db.prepare(`SELECT bh.weekday, bh.start_time, bh.end_time, bh.capacity
      FROM booking_business_hours bh
      INNER JOIN booking_settings bs ON bs.id = bh.booking_settings_id
      WHERE bs.line_account_id = ? ORDER BY bh.weekday, bh.start_time`)
      .bind(params.lineAccountId)
      .all<{ weekday: number; start_time: string; end_time: string; capacity: number }>(),
    db.prepare(`SELECT r.id, r.capacity, mr.quantity
      FROM booking_menu_resources mr
      INNER JOIN booking_resources r ON r.id = mr.resource_id
      WHERE mr.menu_id = ? AND r.line_account_id = ? AND r.is_active = 1`)
      .bind(params.menuId, params.lineAccountId)
      .all<{ id: string; capacity: number; quantity: number }>(),
    // 休業日・例外日。要求アカウントのものだけ読む（他アカウントの休業を見ない）。
    // 期間が要求範囲と重なる行だけに絞る。変更直後に読むため結果を溜め置かない。
    db.prepare(`SELECT scope_kind, scope_id, date_from, date_to, kind, hours_json
      FROM booking_availability_exceptions
      WHERE line_account_id = ?
        AND date_from <= ?
        AND date_to >= ?`)
      .bind(params.lineAccountId, params.to, params.from)
      .all<AvailabilityExceptionRow>(),
    db.prepare(`SELECT timezone FROM booking_settings WHERE line_account_id = ?`)
      .bind(params.lineAccountId)
      .first<{ timezone: string | null }>(),
  ]);
  // 店舗のタイムゾーンで日付・時刻を読む。未設定・壊れた値は Asia/Tokyo。
  const timeZone = normalizeTimeZone(settingsRow?.timezone ?? FALLBACK_TIME_ZONE);
  const resourceCapacity = (menuResources.results ?? []).reduce(
    (min, row) => Math.min(min, Math.floor(Number(row.capacity) / Math.max(1, Number(row.quantity)))),
    Number.POSITIVE_INFINITY,
  );
  const menuResourceIds = new Set(
    (menuResources.results ?? []).map((row) => String(row.id)),
  );
  const exceptions = exceptionsResult.results ?? [];

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

  // 既存予約を読む範囲は、店舗タイムゾーンの暦日の境界そのものにする。
  // 暦日を UTC の 00:00 と見なして前後 1 日ずつ足す形だと、UTC より
  // 遅れた店舗（America/New_York = UTC-5）の夜の予約が範囲から落ちる。
  // NY の 11/02 20:00 は 11/03 01:00Z で、`to+1 の 00:00Z` を越えるため
  // `starts_at < ?` に当たらず、埋まっているのに空き枠として出ていた。
  // 端点は zonedTimeToUtcMs で求めるので、夏時間の切替日でもずれない。
  // 前後の余裕は要らない。`starts_at < 終端 AND block_ends_at > 始端` が
  // 範囲と重なる予約をすべて拾う（日を跨いで始まった予約も含む）。
  const rangeStart = new Date(zonedTimeToUtcMs(timeZone, params.from, '00:00'));
  const rangeEnd = new Date(zonedTimeToUtcMs(timeZone, addDays(params.to, 1), '00:00'));

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

  // 何日先まで受けるか。未設定なら制限しない。日付で切る。
  // 24 時間の倍数の加算では夏時間の切替日（23 時間・25 時間の日）に
  // 暦日がずれるため、暦日で足す。
  const windowLastDate =
    menu.booking_window_days == null
      ? null
      : addDays(tzDateStr(timeZone, params.now), menu.booking_window_days);

  const googleBusyByStaff = new Map<string, Array<{ start: string; end: string }> | null>();
  const calendarSync: CalendarSyncState[] = [];
  for (const staff of staffRows.results) {
    try {
      const busy = await getStaffGoogleBusy(db, params.googleCredentials ?? {}, {
        lineAccountId: params.lineAccountId,
        staffId: staff.id,
        timeMin: new Date(zonedTimeToUtcMs(timeZone, params.from, '00:00')).toISOString(),
        timeMax: new Date(zonedTimeToUtcMs(timeZone, addDays(params.to, 1), '00:00')).toISOString(),
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

  // 既存予約の instant 一覧（担当ごと）。壁日付ではなく instant の重なりで
  // 当日分を拾う。fold を跨ぐ予約が壁日付では別日に落ちるため。
  const bookingMsByStaff = new Map<string, Array<{ startMs: number; endMs: number; sameMenu: boolean }>>();
  for (const b of bookings.results ?? []) {
    const startMs = new Date(b.starts_at).getTime();
    const endMs = new Date(b.block_ends_at).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) continue;
    const list = bookingMsByStaff.get(b.staff_id) ?? [];
    list.push({ startMs, endMs, sameMenu: b.menu_id === params.menuId });
    bookingMsByStaff.set(b.staff_id, list);
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
      // その日の例外日（JST 日付で突合。YYYY-MM-DD の辞書式比較でよい）。
      // 毎週ルール・シフトより例外日を優先する。優先順位は下の通り。
      //
      // 塞ぐ（closed）: 担当・資源（このメニューが使うもの）は絶対に塞ぐ。
      //   店舗 closed は、店舗 open（臨時営業）が同日にあれば open 区間だけ開ける。
      // 時間: 担当 custom が稼働を置き換え、担当 open が足す。店舗 open は
      //   平日には足し、closed 日には open 区間だけ再開する。
      //   店舗 custom と資源の時間（custom/open）は共通部分に絞る。資源は
      //   資源ごとに union し、資源の間で intersection する（全資源が同時
      //   に要るため）。資源に稼働の基準が無いため、資源 open も custom と
      //   同じ絞り込みになる（基準が常時可のため、開ける方向には働かない）。
      // 壊れた時間・空の時間は fail-closed（枠 0）。
      const dayExceptions = exceptions.filter(
        (e) => e.date_from <= date && date <= e.date_to,
      );
      // 適用範囲だけを集める。適用外（別担当・使わない資源）の行は読まない。
      const storeRows = dayExceptions.filter((e) => e.scope_kind === 'store');
      const staffRows = dayExceptions.filter(
        (e) => e.scope_kind === 'staff' && e.scope_id === s.id,
      );
      const resourceRows = dayExceptions.filter(
        (e) => e.scope_kind === 'resource'
          && e.scope_id != null
          && menuResourceIds.has(e.scope_id),
      );
      // 適用される時間行を読む。壊れた行が 1 つでもあれば fail-closed。
      let brokenTime = false;
      const readHours = (rows: AvailabilityExceptionRow[], kind: string): Interval[] => {
        const out: Interval[] = [];
        for (const row of rows) {
          if (row.kind !== kind) continue;
          const hours = parseExceptionHours(row.hours_json);
          if (hours === null) {
            brokenTime = true;
            return [];
          }
          out.push(...hours);
        }
        return mergeIntervals(out);
      };
      const staffCustomHours = readHours(staffRows, 'custom_hours');
      const staffOpenHours = readHours(staffRows, 'open');
      const storeOpenHours = readHours(storeRows, 'open');
      const storeCustomHours = readHours(storeRows, 'custom_hours');
      // 資源は資源ごとに union する。予約には全ての資源が同時に要るため、
      // 資源の間は後で intersection する。空の資源が1つでもあれば枠0。
      const resourceHoursById = new Map<string, Interval[]>();
      for (const row of resourceRows) {
        if (row.kind !== 'custom_hours' && row.kind !== 'open') continue;
        const hours = parseExceptionHours(row.hours_json);
        if (hours === null) {
          brokenTime = true;
          break;
        }
        const key = row.scope_id as string;
        const list = resourceHoursById.get(key) ?? [];
        list.push(...hours);
        resourceHoursById.set(key, list);
      }
      const hasStaffCustom = staffRows.some((e) => e.kind === 'custom_hours');
      const hasStaffOpen = staffRows.some((e) => e.kind === 'open');
      const hasStoreOpen = storeRows.some((e) => e.kind === 'open');
      const hasStoreCustom = storeRows.some((e) => e.kind === 'custom_hours');
      if (brokenTime) continue;
      const staffClosed = staffRows.some((e) => e.kind === 'closed');
      const resourceClosed = resourceRows.some((e) => e.kind === 'closed');
      const storeClosed = storeRows.some((e) => e.kind === 'closed');
      if (staffClosed || resourceClosed) continue;
      // 店舗 open（臨時営業）は店舗 closed を切り抜く。担当・資源 closed は越えない。
      if (storeClosed && storeOpenHours.length === 0) continue;
      // 空の open 行は fail-closed（足す時間が無いのに開けない）。
      if ((hasStaffOpen && staffOpenHours.length === 0)
        || (hasStoreOpen && storeOpenHours.length === 0)) continue;
      const shift = shifts.results.find((r) => r.staff_id === s.id && r.work_date === date);
      const rule = rules.results.find(
        (r) => r.staff_id === s.id && r.weekday === weekdayForDate(date),
      );
      const base = shift ?? rule;
      const coreWorking: Interval[] = hasStaffCustom
        ? staffCustomHours
        : base
          ? [{ start: base.start_time, end: base.end_time }]
          : [];
      let workingList = mergeIntervals([...coreWorking, ...staffOpenHours]);
      if (!storeClosed) {
        workingList = mergeIntervals([...workingList, ...storeOpenHours]);
      } else {
        // 店舗 closed を open が切り抜く日は、open 区間だけ再開する。
        // 通常勤務は足さない（09-17 勤務＋10-12 open なら 10-12 だけ）。
        workingList = workingList.length === 0
          ? storeOpenHours
          : intersectIntervals(workingList, storeOpenHours);
      }
      // 空の custom 行との共通部分は空になる（fail-closed）。
      if (hasStoreCustom) workingList = intersectIntervals(workingList, storeCustomHours);
      for (const hours of resourceHoursById.values()) {
        workingList = intersectIntervals(workingList, mergeIntervals(hours));
        if (workingList.length === 0) break;
      }
      if (workingList.length === 0) continue;
      const dayBookings: BusyInterval[] = bookings.results
        .filter((b) => b.staff_id === s.id)
        .filter((b) => tzDateStr(timeZone, new Date(b.starts_at)) === date)
        .map((b) => ({
          start: tzHHMM(timeZone, new Date(b.starts_at)),
          end: tzHHMM(timeZone, new Date(b.block_ends_at)),
          // 同じメニューの予約だけが定員まで重ねられる。
          sameMenu: b.menu_id === params.menuId,
        }));
      const googleBusy = googleBusyByStaff.get(s.id);
      // 外の予定は定員に関係なく塞ぐ（sameMenu を付けない）。
      if (googleBusy) dayBookings.push(...googleBusyForDate(googleBusy, date, timeZone));
      const dayHours = (businessHours.results ?? [])
        .filter((hour) => hour.weekday === weekdayForDate(date));
      const storeCapacity = workingList.reduce(
        (min, working) => dayHours
          .filter((hour) => hour.start_time <= working.start && hour.end_time >= working.end)
          .reduce((inner, hour) => Math.min(inner, Number(hour.capacity ?? 1)), min),
        Number.POSITIVE_INFINITY,
      );
      const effectiveCapacity = Math.max(1, Math.min(
        Number(menu.concurrent_capacity ?? 1),
        Number.isFinite(storeCapacity) ? storeCapacity : Number.POSITIVE_INFINITY,
        resourceCapacity,
      ));
      const daySlots = computeSlots({
        working: workingList,
        busy: dayBookings,
        menu: menuForCalc,
        granularityMinutes: SLOT_GRANULARITY_MINUTES,
        capacity: effectiveCapacity,
      });
      // instant 側の busy。当日の範囲と重なるものを instant のまま集める。
      // fold を跨ぐ予約・予定は壁時刻へ潰すと消える（01:30→01:30）ため、
      // 壁とは別に instant の重なりを見る。
      const dayStartMs = zonedTimeToUtcMs(timeZone, date, '00:00');
      const dayEndMs = zonedTimeToUtcMs(timeZone, addDays(date, 1), '00:00');
      const busyMs: Array<{ startMs: number; endMs: number; sameMenu: boolean }> = [];
      for (const b of bookingMsByStaff.get(s.id) ?? []) {
        if (b.startMs < dayEndMs && dayStartMs < b.endMs) {
          busyMs.push({
            startMs: Math.max(b.startMs, dayStartMs),
            endMs: Math.min(b.endMs, dayEndMs),
            sameMenu: b.sameMenu,
          });
        }
      }
      if (googleBusy) {
        for (const interval of googleBusy) {
          const startMs = new Date(interval.start).getTime();
          const endMs = new Date(interval.end).getTime();
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) continue;
          if (startMs < dayEndMs && dayStartMs < endMs) {
            busyMs.push({
              startMs: Math.max(startMs, dayStartMs),
              endMs: Math.min(endMs, dayEndMs),
              sameMenu: false,
            });
          }
        }
      }
      const occupyMs = (menuForCalc.duration_minutes + menuForCalc.buffer_after_minutes) * 60_000;
      for (const slot of daySlots) {
        // gap（存在しない壁時刻。DST 開始日の 02:00 台）は候補にしない。
        // 壁→instant→壁が往復一致するものだけ出す。
        const slotStartMs = zonedTimeToUtcMs(timeZone, date, slot.start);
        const roundTripped = new Date(slotStartMs);
        if (tzDateStr(timeZone, roundTripped) !== date
          || tzHHMM(timeZone, roundTripped) !== slot.start) continue;
        if (new Date(slotStartMs) < minLeadAt) continue;
        const slotEndMs = slotStartMs + occupyMs;
        const wallSameCount = dayBookings.filter((booking) => booking.sameMenu === true
          && overlaps(toMin(slot.start), toMin(slot.end), toMin(booking.start), toMin(booking.end))).length;
        // instant 側の重なり。壁側が見落とす fold 跨ぎを拾う。
        // 重なりは真の時間衝突なので、壁で空いていても塞ぐ。
        let instantBlocked = false;
        let instantSameCount = 0;
        for (const busy of busyMs) {
          if (slotStartMs < busy.endMs && busy.startMs < slotEndMs) {
            if (!busy.sameMenu) {
              instantBlocked = true;
              break;
            }
            instantSameCount++;
          }
        }
        if (instantBlocked) continue;
        const sameMenuCount = Math.max(wallSameCount, instantSameCount);
        const remaining = Math.max(0, effectiveCapacity - sameMenuCount);
        slots.push({
          date,
          start: slot.start,
          end: slot.end,
          timeZone,
          startUtc: tzInstantIso(timeZone, slotStartMs),
          endUtc: tzInstantIso(timeZone, slotStartMs + menuForCalc.duration_minutes * 60_000),
          capacity: effectiveCapacity,
          remaining,
          state: remaining === 0 ? 'full' : remaining < effectiveCapacity ? 'limited' : 'available',
        });
      }
    }
    by_staff.push({ staff_id: s.id, display_name: s.display_name, slots });
  }
  return { by_staff, calendar_sync: calendarSync } as {
    by_staff: AvailabilityByStaff[];
    calendar_sync: CalendarSyncState[];
  };
}
