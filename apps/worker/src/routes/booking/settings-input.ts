import { type BookingExceptionKind, type BookingExceptionScope, type BookingInterval, type BookingPriceMode, type LiffDateView } from '@line-crm/db';
import { isClockTime } from './availability.js';

// ---- Menus CRUD ----

export const BOOKING_EXCEPTION_KINDS = new Set<BookingExceptionKind>(['closed', 'custom_hours', 'open']);

export const BOOKING_EXCEPTION_SCOPES = new Set<BookingExceptionScope>(['store', 'staff', 'resource']);

export const BOOKING_PRICE_MODES = new Set<BookingPriceMode>(['fixed', 'free', 'inquiry']);

export const BOOKING_APPROVAL_MODES = new Set(['automatic', 'manual'] as const);

export const BOOKING_SLOT_GRANULARITIES = new Set([5, 10, 15, 30, 60] as const);

export function integerInRange(value: unknown, min: number, max: number): number | null {
  const number = typeof value === 'number' ? value : Number.NaN;
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

export function isValidTimeZone(value: string): boolean {
  if (!value || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('ja-JP', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export type BookingBusinessHours = Array<{
  weekday: number;
  intervals: Array<{ start: string; end: string; capacity: number }>;
}>;

export function readBookingBusinessHours(input: unknown):
  | { ok: true; value: BookingBusinessHours }
  | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length !== 7) {
    return { ok: false, error: '営業時間は日曜から土曜まで7曜日分を指定してください' };
  }
  const weekdays = new Set<number>();
  const days: BookingBusinessHours = [];
  for (const rawDay of input) {
    if (!rawDay || typeof rawDay !== 'object') {
      return { ok: false, error: '営業時間の曜日が正しくありません' };
    }
    const day = rawDay as Record<string, unknown>;
    const weekday = integerInRange(day.weekday, 0, 6);
    if (weekday === null || weekdays.has(weekday)) {
      return { ok: false, error: '営業時間の曜日が重複しているか正しくありません' };
    }
    weekdays.add(weekday);
    if (!Array.isArray(day.intervals) || day.intervals.length > 8) {
      return { ok: false, error: '1曜日の営業時間は8区間以内で指定してください' };
    }
    const intervals: BookingBusinessHours[number]['intervals'] = [];
    for (const rawInterval of day.intervals) {
      if (!rawInterval || typeof rawInterval !== 'object') {
        return { ok: false, error: '営業時間の区間が正しくありません' };
      }
      const interval = rawInterval as Record<string, unknown>;
      const start = typeof interval.start === 'string' ? interval.start : '';
      const end = typeof interval.end === 'string' ? interval.end : '';
      const capacity = integerInRange(interval.capacity, 1, 1_000);
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)
        || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end)
        || start >= end) {
        return {
          ok: false,
          error: '営業時間は同日内で開始時刻より後の終了時刻を指定してください。24:00と日またぎは使えません',
        };
      }
      if (capacity === null) {
        return { ok: false, error: '同時受付数は1〜1000の整数で指定してください' };
      }
      intervals.push({ start, end, capacity });
    }
    intervals.sort((a, b) => a.start.localeCompare(b.start));
    for (let index = 1; index < intervals.length; index++) {
      if (intervals[index - 1].end > intervals[index].start) {
        return { ok: false, error: '同じ曜日の営業時間を重ねることはできません' };
      }
    }
    days.push({ weekday, intervals });
  }
  days.sort((a, b) => a.weekday - b.weekday);
  return { ok: true, value: days };
}

export function readBookingAdminSettings(input: Record<string, unknown>):
  | {
    ok: true;
    value: {
      expectedVersion: number;
      timeZone: string;
      bookingWindowDays: number;
      cutoffMinutesBefore: number;
      cancelDeadlineMinutesBefore: number;
      maxActiveBookingsPerFriend: number;
      approvalMode: 'automatic' | 'manual';
      holdMinutes: number;
      waitlistHoldMinutes?: number;
      slotGranularityMinutes: 5 | 10 | 15 | 30 | 60;
      reminderDayBeforeTime: string | null;
      reminderHoursBefore: number | null;
      liffDateView?: LiffDateView;
      businessHours?: BookingBusinessHours;
    };
  }
  | { ok: false; error: string } {
  const expectedVersion = integerInRange(input.expectedVersion, 0, Number.MAX_SAFE_INTEGER);
  const timeZone = typeof input.timeZone === 'string' ? input.timeZone.trim() : '';
  const bookingWindowDays = integerInRange(input.bookingWindowDays, 1, 365);
  const cutoffMinutesBefore = integerInRange(input.cutoffMinutesBefore, 0, 43_200);
  const cancelDeadlineMinutesBefore = integerInRange(input.cancelDeadlineMinutesBefore, 0, 43_200);
  const maxActiveBookingsPerFriend = integerInRange(input.maxActiveBookingsPerFriend, 1, 100);
  const approvalMode = input.approvalMode;
  const holdMinutes = integerInRange(input.holdMinutes, 1, 1_440);
  // キャンセル待ちの仮押さえ分数。省いたら今の値を保つ。あるのに形が違えば拒否する。
  const waitlistHoldMinutes = input.waitlistHoldMinutes === undefined
    ? undefined
    : integerInRange(input.waitlistHoldMinutes, 1, 1_440);
  const slotGranularityMinutes = integerInRange(input.slotGranularityMinutes, 5, 60);
  const businessHours = Object.hasOwn(input, 'businessHours')
    ? readBookingBusinessHours(input.businessHours)
    : null;
  // N-395: リマインダの送信時刻。null / 未指定は従来の既定
  // (前日=24時間前、当日=2時間前)。明示するなら正しい形だけを受ける。
  const reminderDayBeforeTime = input.reminderDayBeforeTime === undefined || input.reminderDayBeforeTime === null
    ? null
    : typeof input.reminderDayBeforeTime === 'string' && isClockTime(input.reminderDayBeforeTime)
      ? input.reminderDayBeforeTime
      : 'invalid';
  const reminderHoursBefore = input.reminderHoursBefore === undefined || input.reminderHoursBefore === null
    ? null
    : integerInRange(input.reminderHoursBefore, 1, 72);
  // LIFF 予約「日時を選ぶ」段の最初の形。省いたら今の値を保つ
  // （営業時間だけの保存で黙って戻さない）。あるのに形が違えば拒否する。
  const liffDateView = input.liffDateView === undefined
    ? undefined
    : input.liffDateView === 'list' || input.liffDateView === 'calendar'
      ? input.liffDateView
      : 'invalid';

  if (expectedVersion === null) return { ok: false, error: 'expectedVersionが正しくありません' };
  if (!isValidTimeZone(timeZone)) return { ok: false, error: 'タイムゾーンが正しくありません' };
  if (bookingWindowDays === null) return { ok: false, error: '受付期間は1〜365日で指定してください' };
  if (cutoffMinutesBefore === null) return { ok: false, error: '受付締切は0〜43200分で指定してください' };
  if (cancelDeadlineMinutesBefore === null) return { ok: false, error: 'キャンセル期限は0〜43200分で指定してください' };
  if (maxActiveBookingsPerFriend === null) return { ok: false, error: '同時予約数は1〜100件で指定してください' };
  if (!BOOKING_APPROVAL_MODES.has(approvalMode as 'automatic' | 'manual')) {
    return { ok: false, error: '承認方式が正しくありません' };
  }
  if (holdMinutes === null) return { ok: false, error: '仮押さえ時間は1〜1440分で指定してください' };
  if (waitlistHoldMinutes === null) {
    return { ok: false, error: 'キャンセル待ちの仮押さえ時間は1〜1440分で指定してください' };
  }
  if (slotGranularityMinutes === null
    || !BOOKING_SLOT_GRANULARITIES.has(slotGranularityMinutes as 5 | 10 | 15 | 30 | 60)) {
    return { ok: false, error: '予約枠の間隔が正しくありません' };
  }
  if (reminderDayBeforeTime === 'invalid') {
    return { ok: false, error: '前日のお知らせ時刻はHH:MMで指定してください' };
  }
  if (input.reminderHoursBefore !== undefined && input.reminderHoursBefore !== null && reminderHoursBefore === null) {
    return { ok: false, error: '当日のお知らせは1〜72時間前で指定してください' };
  }
  if (liffDateView === 'invalid') {
    return { ok: false, error: '日時を選ぶ画面の最初の形が正しくありません' };
  }
  if (businessHours && !businessHours.ok) return businessHours;
  return {
    ok: true,
    value: {
      expectedVersion,
      timeZone,
      bookingWindowDays,
      cutoffMinutesBefore,
      cancelDeadlineMinutesBefore,
      maxActiveBookingsPerFriend,
      approvalMode: approvalMode as 'automatic' | 'manual',
      holdMinutes,
      ...(waitlistHoldMinutes !== undefined ? { waitlistHoldMinutes } : {}),
      slotGranularityMinutes: slotGranularityMinutes as 5 | 10 | 15 | 30 | 60,
      reminderDayBeforeTime: reminderDayBeforeTime === 'invalid' ? null : reminderDayBeforeTime,
      reminderHoursBefore,
      ...(liffDateView !== undefined ? { liffDateView } : {}),
      ...(businessHours ? { businessHours: businessHours.value } : {}),
    },
  };
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function readBookingIntervals(raw: unknown): { ok: true; value: BookingInterval[] } | { ok: false } {
  if (!Array.isArray(raw) || raw.length > 8) return { ok: false };
  const intervals: BookingInterval[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false };
    const value = item as Record<string, unknown>;
    const start = typeof value.start === 'string' ? value.start : '';
    const end = typeof value.end === 'string' ? value.end : '';
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) || start >= end) {
      return { ok: false };
    }
    intervals.push({ start, end });
  }
  intervals.sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 1; index < intervals.length; index++) {
    if (intervals[index - 1].end > intervals[index].start) return { ok: false };
  }
  return { ok: true, value: intervals };
}

export function readBookingException(input: Record<string, unknown>):
  | {
    ok: true;
    value: {
      scopeKind: BookingExceptionScope;
      scopeId: string | null;
      dateFrom: string;
      dateTo: string;
      kind: BookingExceptionKind;
      intervals: BookingInterval[];
      reason: string | null;
    };
  }
  | { ok: false; error: string } {
  const scopeKind = String(input.scopeKind ?? '');
  const kind = String(input.kind ?? '');
  const dateFrom = typeof input.dateFrom === 'string' ? input.dateFrom : '';
  const dateTo = typeof input.dateTo === 'string' ? input.dateTo : '';
  const rawScopeId = typeof input.scopeId === 'string' ? input.scopeId.trim() : '';
  const reason = input.reason == null ? null : typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!BOOKING_EXCEPTION_SCOPES.has(scopeKind as BookingExceptionScope)) {
    return { ok: false, error: 'scopeKindが正しくありません' };
  }
  if ((scopeKind === 'store' && rawScopeId) || (scopeKind !== 'store' && !rawScopeId)) {
    return { ok: false, error: '対象とscopeIdの組み合わせが正しくありません' };
  }
  if (!isCalendarDate(dateFrom) || !isCalendarDate(dateTo) || dateFrom > dateTo) {
    return { ok: false, error: '例外日の期間が正しくありません' };
  }
  if (!BOOKING_EXCEPTION_KINDS.has(kind as BookingExceptionKind)) {
    return { ok: false, error: '例外日の種類が正しくありません' };
  }
  if (reason !== null && (!reason || reason.length > 200)) {
    return { ok: false, error: '理由は200文字以内で指定してください' };
  }
  const intervals = readBookingIntervals(input.intervals);
  if (!intervals.ok || (kind === 'closed' && intervals.value.length > 0)
    || (kind !== 'closed' && intervals.value.length === 0)) {
    return { ok: false, error: '営業時間は重ならない正しい時刻で指定してください' };
  }
  return {
    ok: true,
    value: {
      scopeKind: scopeKind as BookingExceptionScope,
      scopeId: scopeKind === 'store' ? null : rawScopeId,
      dateFrom,
      dateTo,
      kind: kind as BookingExceptionKind,
      intervals: intervals.value,
      reason,
    },
  };
}

export function readPriceModeAndAmount(input: { price_mode?: unknown; base_price?: unknown }):
  | { ok: true; priceMode: BookingPriceMode; basePrice: number }
  | { ok: false; error: string } {
  const priceMode = String(input.price_mode ?? 'fixed') as BookingPriceMode;
  if (!BOOKING_PRICE_MODES.has(priceMode)) {
    return { ok: false, error: 'price_mode must be fixed, free, or inquiry' };
  }
  if (priceMode !== 'fixed') return { ok: true, priceMode, basePrice: 0 };
  const basePrice = Number(input.base_price);
  if (!Number.isInteger(basePrice) || basePrice < 0 || basePrice > 100_000_000) {
    return { ok: false, error: 'base_price must be an integer between 0 and 100000000' };
  }
  return { ok: true, priceMode, basePrice };
}

export type BookingResourceInput = { name: string; type: string; capacity: number; isActive: boolean };

export const BOOKING_RESOURCE_MUTABLE_FIELDS = ['name', 'type', 'capacity', 'isActive'] as const;

export function readBookingResourceInput(
  body: Record<string, unknown>,
  current?: BookingResourceInput,
  mode: 'create' | 'update' = 'create',
): { ok: true; value: BookingResourceInput } | { ok: false; error: string } {
  const allowed = new Set<string>([
    ...BOOKING_RESOURCE_MUTABLE_FIELDS,
    ...(mode === 'update' ? ['expectedVersion'] : []),
  ]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, error: `${unknown}は指定できません` };
  if (mode === 'update' && !BOOKING_RESOURCE_MUTABLE_FIELDS.some((key) => (
    Object.prototype.hasOwnProperty.call(body, key)
  ))) return { ok: false, error: '変更する項目を1つ以上指定してください' };
  const supplied = (key: typeof BOOKING_RESOURCE_MUTABLE_FIELDS[number], fallback: unknown) => (
    Object.prototype.hasOwnProperty.call(body, key) ? body[key] : fallback
  );
  const rawName = supplied('name', current?.name);
  const rawType = supplied('type', current?.type);
  const rawCapacity = supplied('capacity', current?.capacity);
  const rawActive = supplied('isActive', current?.isActive ?? true);
  if (typeof rawName !== 'string' || rawName.trim().length === 0 || rawName.trim().length > 100) {
    return { ok: false, error: 'nameは1〜100文字で指定してください' };
  }
  if (typeof rawType !== 'string' || rawType.trim().length === 0 || rawType.trim().length > 50) {
    return { ok: false, error: 'typeは1〜50文字で指定してください' };
  }
  if (!Number.isInteger(rawCapacity) || Number(rawCapacity) < 1 || Number(rawCapacity) > 1000) {
    return { ok: false, error: 'capacityは1〜1000の整数で指定してください' };
  }
  if (typeof rawActive !== 'boolean') {
    return { ok: false, error: 'isActiveはbooleanで指定してください' };
  }
  return {
    ok: true,
    value: { name: rawName.trim(), type: rawType.trim(), capacity: Number(rawCapacity), isActive: rawActive },
  };
}

export function readBookingMenuResources(body: Record<string, unknown>):
  | { ok: true; expectedVersion: number; resources: Array<{ resourceId: string; quantity: number }> }
  | { ok: false; error: string } {
  if (Object.keys(body).some((key) => key !== 'expectedVersion' && key !== 'resources')) {
    return { ok: false, error: '指定できない項目があります' };
  }
  if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
    return { ok: false, error: 'expectedVersionは1以上の整数で指定してください' };
  }
  if (!Array.isArray(body.resources) || body.resources.length > 30) {
    return { ok: false, error: 'resourcesは30件以内の配列で指定してください' };
  }
  const resources: Array<{ resourceId: string; quantity: number }> = [];
  const seen = new Set<string>();
  for (const raw of body.resources) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: '資源の指定が正しくありません' };
    }
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some((key) => key !== 'resourceId' && key !== 'quantity')) {
      return { ok: false, error: '資源の指定が正しくありません' };
    }
    const resourceId = typeof item.resourceId === 'string' ? item.resourceId.trim() : '';
    if (!resourceId || seen.has(resourceId)) {
      return { ok: false, error: '資源IDは空欄や重複のない形で指定してください' };
    }
    if (!Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 1000) {
      return { ok: false, error: 'quantityは1〜1000の整数で指定してください' };
    }
    seen.add(resourceId);
    resources.push({ resourceId, quantity: Number(item.quantity) });
  }
  return { ok: true, expectedVersion: Number(body.expectedVersion), resources };
}
