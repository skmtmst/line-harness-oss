import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { inputError, inputJsonBoundary } from '../../lib/input-errors.js';
import { requireOwnBookingStaffOrAdmin, resolveAccountIdAdmin, assertStaffInAccount } from './identity.js';

export function registerStaffAvailability(booking: Hono<Env>): void {
// ---- shifts ----

booking.get('/api/booking/admin/staff/:id/availability-rules', requireOwnBookingStaffOrAdmin(), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const rows = await c.env.DB
    .prepare(
      `SELECT id, weekday, start_time, end_time, is_active
         FROM staff_availability_rules
        WHERE staff_id = ?
        ORDER BY weekday ASC`,
    )
    .bind(staffId)
    .all();
  return c.json({ rules: rows.results });
});

booking.put('/api/booking/admin/staff/:id/availability-rules', requireOwnBookingStaffOrAdmin(), inputJsonBoundary({"rules":["array"]}), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return inputError(c, { error: 'missing_account_id' }, 400, ["account_id"]);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const body = await c.req.json<{
    rules: Array<{ weekday: number; start_time: string; end_time: string }>;
  }>();
  if (!Array.isArray(body.rules)) return inputError(c, { error: 'invalid_rules' }, 400, ["rules"]);
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const weekdays = new Set<number>();
  for (const rule of body.rules) {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) {
      return inputError(c, { error: 'invalid_weekday' }, 422, ["rules"]);
    }
    if (weekdays.has(rule.weekday)) return inputError(c, { error: 'duplicate_weekday' }, 422, ["rules"]);
    weekdays.add(rule.weekday);
    if (!hhmm.test(rule.start_time) || !hhmm.test(rule.end_time) || rule.start_time >= rule.end_time) {
      return inputError(c, { error: 'invalid_time_range' }, 422, ["rules"]);
    }
  }
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`DELETE FROM staff_availability_rules WHERE staff_id = ?`).bind(staffId),
    ...body.rules.map((rule) =>
      c.env.DB
        .prepare(
          `INSERT INTO staff_availability_rules
            (id, staff_id, weekday, start_time, end_time, is_active)
           VALUES (?, ?, ?, ?, ?, 1)`,
        )
        .bind(crypto.randomUUID(), staffId, rule.weekday, rule.start_time, rule.end_time),
    ),
  ];
  await c.env.DB.batch(statements);
  return c.json({ ok: true, count: body.rules.length });
});
}
