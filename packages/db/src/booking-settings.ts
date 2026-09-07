import { jstNow } from './utils.js';

export type BookingInterval = { start: string; end: string };
export type BookingExceptionKind = 'closed' | 'custom_hours' | 'open';
export type BookingExceptionScope = 'store' | 'staff' | 'resource';
export type BookingPriceMode = 'fixed' | 'free' | 'inquiry';

export interface BookingAvailabilityExceptionRow {
  id: string;
  line_account_id: string;
  scope_kind: BookingExceptionScope;
  scope_id: string | null;
  date_from: string;
  date_to: string;
  kind: BookingExceptionKind;
  hours_json: string;
  reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface BookingAvailabilityException {
  id: string;
  lineAccountId: string;
  scopeKind: BookingExceptionScope;
  scopeId: string | null;
  date: string | null;
  dateFrom: string;
  dateTo: string;
  kind: BookingExceptionKind;
  intervals: BookingInterval[];
  reason: string | null;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BookingAdminSettings {
  id: string | null;
  lineAccountId: string;
  organizationName: string;
  version: number;
  timeZone: string;
  bookingWindowDays: number;
  cutoffMinutesBefore: number;
  cancelDeadlineMinutesBefore: number;
  maxActiveBookingsPerFriend: number;
  approvalMode: 'automatic' | 'manual';
  holdMinutes: number;
  slotGranularityMinutes: 5 | 10 | 15 | 30 | 60;
  menuCount: number;
  activeMenuCount: number;
  inactiveMenuCount: number;
  businessHours: Array<{ weekday: number; intervals: BookingInterval[] }>;
  exceptions: BookingAvailabilityException[];
  updatedAt: string;
}

const DEFAULT_SETTINGS = {
  timeZone: 'Asia/Tokyo',
  bookingWindowDays: 60,
  cutoffMinutesBefore: 1440,
  cancelDeadlineMinutesBefore: 1440,
  maxActiveBookingsPerFriend: 1,
  approvalMode: 'automatic' as const,
  holdMinutes: 15,
  slotGranularityMinutes: 15 as const,
};

function parseIntervals(raw: string): BookingInterval[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      return typeof value.start === 'string' && typeof value.end === 'string'
        ? [{ start: value.start, end: value.end }]
        : [];
    });
  } catch {
    return [];
  }
}

export function serializeBookingException(
  row: BookingAvailabilityExceptionRow,
): BookingAvailabilityException {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    date: row.date_from === row.date_to ? row.date_from : null,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    kind: row.kind,
    intervals: parseIntervals(row.hours_json),
    reason: row.reason,
    note: row.reason,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getBookingAdminSettings(
  db: D1Database,
  lineAccountId: string,
): Promise<BookingAdminSettings | null> {
  const [account, setting, hoursResult, exceptionResult, counts] = await Promise.all([
    db.prepare(`SELECT id, name, created_at FROM line_accounts WHERE id = ?`)
      .bind(lineAccountId)
      .first<{ id: string; name: string; created_at: string }>(),
    db.prepare(`SELECT * FROM booking_settings WHERE line_account_id = ?`)
      .bind(lineAccountId)
      .first<{
        id: string;
        timezone: string;
        booking_window_days: number;
        cutoff_minutes_before: number;
        cancel_deadline_minutes_before: number;
        max_active_bookings_per_friend: number;
        approval_mode: 'automatic' | 'manual';
        hold_minutes: number;
        slot_granularity_minutes: 5 | 10 | 15 | 30 | 60;
        version: number;
        updated_at: string;
      }>(),
    db.prepare(`SELECT bh.weekday, bh.start_time, bh.end_time
      FROM booking_business_hours bh
      INNER JOIN booking_settings bs ON bs.id = bh.booking_settings_id
      WHERE bs.line_account_id = ?
      ORDER BY bh.weekday ASC, bh.start_time ASC`)
      .bind(lineAccountId)
      .all<{ weekday: number; start_time: string; end_time: string }>(),
    db.prepare(`SELECT * FROM booking_availability_exceptions
      WHERE line_account_id = ? AND scope_kind = 'store'
      ORDER BY date_from ASC, date_to ASC, id ASC`)
      .bind(lineAccountId)
      .all<BookingAvailabilityExceptionRow>(),
    db.prepare(`SELECT COUNT(*) AS menu_count,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_menu_count
      FROM menus WHERE line_account_id = ? AND deleted_at IS NULL`)
      .bind(lineAccountId)
      .first<{ menu_count: number; active_menu_count: number | null }>(),
  ]);
  if (!account) return null;

  const grouped = new Map<number, BookingInterval[]>();
  for (let weekday = 0; weekday <= 6; weekday++) grouped.set(weekday, []);
  for (const row of hoursResult.results ?? []) {
    grouped.get(Number(row.weekday))?.push({ start: row.start_time, end: row.end_time });
  }
  const menuCount = Number(counts?.menu_count ?? 0);
  const activeMenuCount = Number(counts?.active_menu_count ?? 0);

  return {
    id: setting?.id ?? null,
    lineAccountId,
    organizationName: account.name,
    version: Number(setting?.version ?? 0),
    timeZone: setting?.timezone ?? DEFAULT_SETTINGS.timeZone,
    bookingWindowDays: Number(setting?.booking_window_days ?? DEFAULT_SETTINGS.bookingWindowDays),
    cutoffMinutesBefore: Number(setting?.cutoff_minutes_before ?? DEFAULT_SETTINGS.cutoffMinutesBefore),
    cancelDeadlineMinutesBefore: Number(
      setting?.cancel_deadline_minutes_before ?? DEFAULT_SETTINGS.cancelDeadlineMinutesBefore,
    ),
    maxActiveBookingsPerFriend: Number(
      setting?.max_active_bookings_per_friend ?? DEFAULT_SETTINGS.maxActiveBookingsPerFriend,
    ),
    approvalMode: setting?.approval_mode ?? DEFAULT_SETTINGS.approvalMode,
    holdMinutes: Number(setting?.hold_minutes ?? DEFAULT_SETTINGS.holdMinutes),
    slotGranularityMinutes: setting?.slot_granularity_minutes ?? DEFAULT_SETTINGS.slotGranularityMinutes,
    menuCount,
    activeMenuCount,
    inactiveMenuCount: Math.max(0, menuCount - activeMenuCount),
    businessHours: [...grouped.entries()].map(([weekday, intervals]) => ({ weekday, intervals })),
    exceptions: (exceptionResult.results ?? []).map(serializeBookingException),
    updatedAt: setting?.updated_at ?? account.created_at,
  };
}

export async function listBookingAvailabilityExceptions(
  db: D1Database,
  lineAccountId: string,
): Promise<BookingAvailabilityException[]> {
  const result = await db.prepare(`SELECT * FROM booking_availability_exceptions
    WHERE line_account_id = ? ORDER BY date_from ASC, date_to ASC, id ASC`)
    .bind(lineAccountId)
    .all<BookingAvailabilityExceptionRow>();
  return (result.results ?? []).map(serializeBookingException);
}

export async function getBookingAvailabilityException(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<BookingAvailabilityException | null> {
  const row = await db.prepare(`SELECT * FROM booking_availability_exceptions
    WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .first<BookingAvailabilityExceptionRow>();
  return row ? serializeBookingException(row) : null;
}

async function bookingExceptionScopeExists(
  db: D1Database,
  lineAccountId: string,
  scopeKind: BookingExceptionScope,
  scopeId: string | null,
): Promise<boolean> {
  if (scopeKind === 'store') return scopeId === null;
  if (!scopeId) return false;
  const sql = scopeKind === 'staff'
    ? `SELECT 1 AS ok FROM staff
        WHERE id = ? AND line_account_id = ? AND is_active = 1`
    : `SELECT 1 AS ok FROM booking_resources
        WHERE id = ? AND line_account_id = ? AND is_active = 1`;
  const row = await db.prepare(sql)
    .bind(scopeId, lineAccountId)
    .first<{ ok: number }>();
  return Boolean(row?.ok);
}

export async function createBookingAvailabilityException(
  db: D1Database,
  input: {
    lineAccountId: string;
    scopeKind: BookingExceptionScope;
    scopeId: string | null;
    dateFrom: string;
    dateTo: string;
    kind: BookingExceptionKind;
    intervals: BookingInterval[];
    reason: string | null;
  },
): Promise<BookingAvailabilityException | null> {
  if (!await bookingExceptionScopeExists(db, input.lineAccountId, input.scopeKind, input.scopeId)) {
    return null;
  }
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO booking_availability_exceptions
    (id, line_account_id, scope_kind, scope_id, date_from, date_to,
     kind, hours_json, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      input.lineAccountId,
      input.scopeKind,
      input.scopeId,
      input.dateFrom,
      input.dateTo,
      input.kind,
      JSON.stringify(input.intervals),
      input.reason,
      now,
      now,
    )
    .run();
  const row = await db.prepare(`SELECT * FROM booking_availability_exceptions
    WHERE id = ? AND line_account_id = ?`)
    .bind(id, input.lineAccountId)
    .first<BookingAvailabilityExceptionRow>();
  return row ? serializeBookingException(row) : null;
}

export async function updateBookingAvailabilityException(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    expectedVersion: number;
    scopeKind: BookingExceptionScope;
    scopeId: string | null;
    dateFrom: string;
    dateTo: string;
    kind: BookingExceptionKind;
    intervals: BookingInterval[];
    reason: string | null;
  },
): Promise<
  | { status: 'updated'; item: BookingAvailabilityException }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'not_found' }
  | { status: 'scope_not_found' }
> {
  if (!await bookingExceptionScopeExists(db, input.lineAccountId, input.scopeKind, input.scopeId)) {
    return { status: 'scope_not_found' };
  }
  const result = await db.prepare(`UPDATE booking_availability_exceptions
    SET scope_kind = ?, scope_id = ?, date_from = ?, date_to = ?, kind = ?,
        hours_json = ?, reason = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND line_account_id = ? AND version = ?`)
    .bind(
      input.scopeKind,
      input.scopeId,
      input.dateFrom,
      input.dateTo,
      input.kind,
      JSON.stringify(input.intervals),
      input.reason,
      jstNow(),
      input.id,
      input.lineAccountId,
      input.expectedVersion,
    )
    .run();
  if ((result.meta.changes ?? 0) > 0) {
    const row = await db.prepare(`SELECT * FROM booking_availability_exceptions
      WHERE id = ? AND line_account_id = ?`)
      .bind(input.id, input.lineAccountId)
      .first<BookingAvailabilityExceptionRow>();
    return row
      ? { status: 'updated', item: serializeBookingException(row) }
      : { status: 'not_found' };
  }
  const current = await db.prepare(`SELECT version FROM booking_availability_exceptions
    WHERE id = ? AND line_account_id = ?`)
    .bind(input.id, input.lineAccountId)
    .first<{ version: number }>();
  return current
    ? { status: 'conflict', currentVersion: Number(current.version) }
    : { status: 'not_found' };
}

export async function updateBookingMenuSettings(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    expectedVersion: number;
    priceMode?: BookingPriceMode;
    basePrice?: number;
    bookingWindowDays?: number | null;
    cutoffHoursBefore?: number | null;
    cancelDeadlineHoursBefore?: number | null;
  },
): Promise<
  | { status: 'updated'; version: number }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'not_found' }
  | { status: 'no_changes' }
> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (input.priceMode !== undefined) add('price_mode', input.priceMode);
  if (input.basePrice !== undefined) add('base_price', input.basePrice);
  if (input.priceMode === 'free' || input.priceMode === 'inquiry') {
    const existingIndex = sets.indexOf('base_price = ?');
    if (existingIndex >= 0) values[existingIndex] = 0;
    else add('base_price', 0);
  }
  if (input.bookingWindowDays !== undefined) add('booking_window_days', input.bookingWindowDays);
  if (input.cutoffHoursBefore !== undefined) add('cutoff_hours_before', input.cutoffHoursBefore);
  if (input.cancelDeadlineHoursBefore !== undefined) {
    add('cancel_deadline_hours_before', input.cancelDeadlineHoursBefore);
  }
  if (sets.length === 0) return { status: 'no_changes' };
  sets.push('version = version + 1', 'updated_at = ?');
  values.push(jstNow(), input.id, input.lineAccountId, input.expectedVersion);
  const result = await db.prepare(`UPDATE menus SET ${sets.join(', ')}
    WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL AND version = ?`)
    .bind(...values)
    .run();
  if ((result.meta.changes ?? 0) > 0) {
    return { status: 'updated', version: input.expectedVersion + 1 };
  }
  const current = await db.prepare(`SELECT version FROM menus
    WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`)
    .bind(input.id, input.lineAccountId)
    .first<{ version: number }>();
  return current
    ? { status: 'conflict', currentVersion: Number(current.version) }
    : { status: 'not_found' };
}
