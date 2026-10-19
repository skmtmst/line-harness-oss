import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { inputError, inputJsonBoundary } from '../../lib/input-errors.js';
import { requireOwnBookingStaffOrAdmin, resolveAccountIdAdmin, assertStaffInAccount } from './identity.js';
import { BreakRow, breaksFingerprint, findBreakOverlap, staffStoreTimeZone, resolveWallTime, formatUtcOffset } from './break-input.js';
import { BREAK_WEEKLY_LIMIT, BREAK_DATE_LIMIT } from './staff-input.js';
import { isValidTimeRange, isValidShiftDate } from './availability.js';

export function registerStaffBreaks(booking: Hono<Env>): void {
booking.get('/api/booking/admin/staff/:id/breaks', requireOwnBookingStaffOrAdmin(), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const rows = await c.env.DB
    .prepare(
      `SELECT id, weekday, start_time, end_time, time_zone
         FROM staff_breaks
        WHERE staff_id = ?
        ORDER BY weekday ASC, start_time ASC`,
    )
    .bind(staffId)
    .all<BreakRow & { time_zone: string }>();
  const breaks = rows.results.map((row) => ({
    id: row.id,
    weekday: row.weekday,
    start_time: row.start_time,
    end_time: row.end_time,
    time_zone: row.time_zone,
  }));
  return c.json({
    breaks,
    version: breaksFingerprint(rows.results),
  });
});

booking.put('/api/booking/admin/staff/:id/breaks', requireOwnBookingStaffOrAdmin(), inputJsonBoundary({"breaks":["array"]}), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return inputError(c, { error: 'missing_account_id' }, 400, ["account_id"]);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const body = await c.req.json<{
    breaks?: Array<{ id?: string; weekday: number; start_time: string; end_time: string }>;
    expectedVersion?: unknown;
  }>().catch(() => null);
  if (!body || !Array.isArray(body.breaks)) return inputError(c, { error: 'invalid_breaks' }, 400, ["breaks"]);
  if (body.breaks.length > BREAK_WEEKLY_LIMIT) return inputError(c, { error: 'too_many_breaks' }, 400, ["breaks"]);
  if (typeof body.expectedVersion !== 'string' || body.expectedVersion.length === 0) {
    return inputError(c, { error: 'invalid_version' }, 400, ["expectedVersion"]);
  }
  for (const item of body.breaks) {
    if (!Number.isInteger(item.weekday) || item.weekday < 0 || item.weekday > 6) {
      return inputError(c, { error: 'invalid_weekday' }, 422, ["breaks"]);
    }
    if (!isValidTimeRange(item.start_time, item.end_time)) {
      return inputError(c, { error: 'invalid_time_range' }, 422, ["breaks"]);
    }
  }
  const current = await c.env.DB
    .prepare(
      `SELECT id, weekday, start_time, end_time
         FROM staff_breaks
        WHERE staff_id = ?`,
    )
    .bind(staffId)
    .all<BreakRow>();
  const currentRows = current.results;
  const currentVersion = breaksFingerprint(currentRows);
  const knownIds = new Set(currentRows.map((row) => row.id));
  const unknown = body.breaks.find((item) => item.id != null && !knownIds.has(item.id));
  if (currentVersion !== body.expectedVersion || unknown) {
    return c.json({
      error: 'version_conflict',
      data: { version: currentVersion, breaks: currentRows },
    }, 409);
  }
  const byWeekday = new Map<number, Array<{ key: string; start_time: string; end_time: string }>>();
  body.breaks.forEach((item, index) => {
    const list = byWeekday.get(item.weekday) ?? [];
    list.push({ key: item.id ?? `new-${index}`, start_time: item.start_time, end_time: item.end_time });
    byWeekday.set(item.weekday, list);
  });
  for (const list of byWeekday.values()) {
    if (findBreakOverlap(list)) return inputError(c, { error: 'break_overlap' }, 422, ["breaks"]);
  }
  const rules = await c.env.DB
    .prepare(`SELECT weekday, start_time, end_time FROM staff_availability_rules WHERE staff_id = ? AND is_active = 1`)
    .bind(staffId)
    .all<{ weekday: number; start_time: string; end_time: string }>();
  for (const item of body.breaks) {
    const rule = rules.results.find((entry) => entry.weekday === item.weekday);
    if (!rule || rule.start_time > item.start_time || item.end_time > rule.end_time) {
      return inputError(c, { error: 'break_outside_working_hours' }, 422, ["breaks"]);
    }
  }
  const timeZone = await staffStoreTimeZone(c.env.DB, accountId);
  const now = new Date().toISOString();
  const payloadIds = new Set(body.breaks.map((item) => item.id).filter((id): id is string => id != null));
  const statements: D1PreparedStatement[] = [
    ...currentRows
      .filter((row) => !payloadIds.has(row.id))
      .map((row) => c.env.DB.prepare(`DELETE FROM staff_breaks WHERE id = ?`).bind(row.id)),
    ...body.breaks.map((item) => {
      if (item.id != null) {
        return c.env.DB
          .prepare(
            `UPDATE staff_breaks
                SET weekday = ?, start_time = ?, end_time = ?, time_zone = ?, updated_at = ?
              WHERE id = ? AND staff_id = ?`,
          )
          .bind(item.weekday, item.start_time, item.end_time, timeZone, now, item.id, staffId);
      }
      return c.env.DB
        .prepare(
          `INSERT INTO staff_breaks
            (id, staff_id, weekday, start_time, end_time, time_zone)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), staffId, item.weekday, item.start_time, item.end_time, timeZone);
    }),
  ];
  if (statements.length > 0) await c.env.DB.batch(statements);
  const fresh = await c.env.DB
    .prepare(
      `SELECT id, weekday, start_time, end_time, time_zone
         FROM staff_breaks
        WHERE staff_id = ?
        ORDER BY weekday ASC, start_time ASC`,
    )
    .bind(staffId)
    .all<BreakRow & { time_zone: string }>();
  const freshRows = fresh.results.map((row) => ({
    id: row.id,
    weekday: row.weekday,
    work_date: null,
    start_time: row.start_time,
    end_time: row.end_time,
    time_zone: row.time_zone,
  }));
  return c.json({ ok: true, count: freshRows.length, version: breaksFingerprint(freshRows), breaks: freshRows });
});

// ---- staff break dates (N-405 #655; 日付指定の休憩) ----

booking.get('/api/booking/admin/staff/:id/break-dates', requireOwnBookingStaffOrAdmin(), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const rows = await c.env.DB
    .prepare(
      `SELECT id, work_date, start_time, end_time, time_zone, start_utc_offset, end_utc_offset
         FROM staff_break_dates
        WHERE staff_id = ?
        ORDER BY work_date ASC, start_time ASC`,
    )
    .bind(staffId)
    .all();
  return c.json({
    breaks: rows.results,
    version: breaksFingerprint(rows.results as unknown as BreakRow[]),
  });
});

booking.put('/api/booking/admin/staff/:id/break-dates', requireOwnBookingStaffOrAdmin(), inputJsonBoundary({"breaks":["array"]}), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return inputError(c, { error: 'missing_account_id' }, 400, ["account_id"]);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const body = await c.req.json<{
    breaks?: Array<{ id?: string; work_date: string; start_time: string; end_time: string }>;
    expectedVersion?: unknown;
  }>().catch(() => null);
  if (!body || !Array.isArray(body.breaks)) return inputError(c, { error: 'invalid_breaks' }, 400, ["breaks"]);
  if (body.breaks.length > BREAK_DATE_LIMIT) return inputError(c, { error: 'too_many_break_dates' }, 400, ["breaks"]);
  if (typeof body.expectedVersion !== 'string' || body.expectedVersion.length === 0) {
    return inputError(c, { error: 'invalid_version' }, 400, ["expectedVersion"]);
  }
  for (const item of body.breaks) {
    if (!isValidShiftDate(item.work_date)) {
      return inputError(c, { error: 'invalid_date' }, 422, ["breaks"]);
    }
    if (!isValidTimeRange(item.start_time, item.end_time)) {
      return inputError(c, { error: 'invalid_time_range' }, 422, ["breaks"]);
    }
  }
  const current = await c.env.DB
    .prepare(
      `SELECT id, work_date, start_time, end_time
         FROM staff_break_dates
        WHERE staff_id = ?`,
    )
    .bind(staffId)
    .all<BreakRow>();
  const currentRows = current.results;
  const currentVersion = breaksFingerprint(currentRows);
  const knownIds = new Set(currentRows.map((row) => row.id));
  const unknown = body.breaks.find((item) => item.id != null && !knownIds.has(item.id));
  if (currentVersion !== body.expectedVersion || unknown) {
    return c.json({
      error: 'version_conflict',
      data: { version: currentVersion, breaks: currentRows },
    }, 409);
  }
  const byDate = new Map<string, Array<{ key: string; start_time: string; end_time: string }>>();
  body.breaks.forEach((item, index) => {
    const list = byDate.get(item.work_date) ?? [];
    list.push({ key: item.id ?? `new-${index}`, start_time: item.start_time, end_time: item.end_time });
    byDate.set(item.work_date, list);
  });
  for (const list of byDate.values()) {
    if (findBreakOverlap(list)) return inputError(c, { error: 'break_overlap' }, 422, ["breaks"]);
  }
  const timeZone = await staffStoreTimeZone(c.env.DB, accountId);
  const resolved = new Map<string, { startOffset: string; endOffset: string }>();
  for (const item of body.breaks) {
    const start = resolveWallTime(item.work_date, item.start_time, timeZone);
    const end = resolveWallTime(item.work_date, item.end_time, timeZone);
    if (!start || !end) return inputError(c, { error: 'dst_gap' }, 422, ["breaks"]);
    resolved.set(`${item.work_date}|${item.start_time}|${item.end_time}`, {
      startOffset: formatUtcOffset(start.offsetMinutes),
      endOffset: formatUtcOffset(end.offsetMinutes),
    });
  }
  const dates = [...new Set(body.breaks.map((item) => item.work_date))];
  const rules = await c.env.DB
    .prepare(`SELECT weekday, start_time, end_time FROM staff_availability_rules WHERE staff_id = ? AND is_active = 1`)
    .bind(staffId)
    .all<{ weekday: number; start_time: string; end_time: string }>();
  const shifts = dates.length === 0 ? { results: [] as Array<{ work_date: string; start_time: string; end_time: string }> } : await c.env.DB
    .prepare(`SELECT work_date, start_time, end_time FROM staff_shifts WHERE staff_id = ? AND work_date IN (${dates.map(() => '?').join(',')})`)
    .bind(staffId, ...dates)
    .all<{ work_date: string; start_time: string; end_time: string }>();
  for (const item of body.breaks) {
    const shift = shifts.results.find((entry) => entry.work_date === item.work_date);
    const working = shift ?? rules.results.find(
      (entry) => entry.weekday === new Date(`${item.work_date}T00:00:00Z`).getUTCDay(),
    );
    if (!working || working.start_time > item.start_time || item.end_time > working.end_time) {
      return inputError(c, { error: 'break_outside_working_hours' }, 422, ["breaks"]);
    }
  }
  const now = new Date().toISOString();
  const payloadIds = new Set(body.breaks.map((item) => item.id).filter((id): id is string => id != null));
  const statements: D1PreparedStatement[] = [
    ...currentRows
      .filter((row) => !payloadIds.has(row.id))
      .map((row) => c.env.DB.prepare(`DELETE FROM staff_break_dates WHERE id = ?`).bind(row.id)),
    ...body.breaks.map((item) => {
      const offsets = resolved.get(`${item.work_date}|${item.start_time}|${item.end_time}`) ?? {
        startOffset: '+09:00',
        endOffset: '+09:00',
      };
      if (item.id != null) {
        return c.env.DB
          .prepare(
            `UPDATE staff_break_dates
                SET work_date = ?, start_time = ?, end_time = ?, time_zone = ?,
                    start_utc_offset = ?, end_utc_offset = ?, updated_at = ?
              WHERE id = ? AND staff_id = ?`,
          )
          .bind(item.work_date, item.start_time, item.end_time, timeZone,
            offsets.startOffset, offsets.endOffset, now, item.id, staffId);
      }
      return c.env.DB
        .prepare(
          `INSERT INTO staff_break_dates
            (id, staff_id, work_date, start_time, end_time, time_zone,
             start_utc_offset, end_utc_offset)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), staffId, item.work_date, item.start_time, item.end_time,
          timeZone, offsets.startOffset, offsets.endOffset);
    }),
  ];
  if (statements.length > 0) await c.env.DB.batch(statements);
  const fresh = await c.env.DB
    .prepare(
      `SELECT id, work_date, start_time, end_time, time_zone, start_utc_offset, end_utc_offset
         FROM staff_break_dates
        WHERE staff_id = ?
        ORDER BY work_date ASC, start_time ASC`,
    )
    .bind(staffId)
    .all();
  return c.json({
    ok: true,
    count: (fresh.results as unknown[]).length,
    version: breaksFingerprint(fresh.results as unknown as BreakRow[]),
    breaks: fresh.results,
  });
});
}
