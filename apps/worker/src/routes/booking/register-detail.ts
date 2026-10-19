import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { buildConfirmationReminderSchedule, getReminderTiming } from '../../features/booking/booking-confirm/index.js';
import { listBookingAuditLogs } from '@line-crm/db';
import { getBookingAdminDetail } from '../../features/booking/booking-admin-detail/index.js';
import { resolveAccountIdAdmin } from './identity.js';

export function registerDetail(booking: Hono<Env>): void {
booking.get('/api/booking/admin/reminder-preview', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const startsAt = new Date(c.req.query('starts_at') ?? '');
  if (Number.isNaN(startsAt.getTime())) return c.json({ error: 'invalid_starts_at' }, 400);
  // N-395: 店舗ごとの設定時刻で予定を出す。設定が無い店舗は従来の既定値。
  const timing = await getReminderTiming(c.env.DB, accountId);
  return c.json({
    reminders: buildConfirmationReminderSchedule({
      startsAt,
      now: new Date(),
      reminderHoursBefore: timing.reminderHoursBefore,
      dayBeforeTime: timing.dayBeforeTime,
      timeZone: timing.timeZone,
    }),
  });
});

booking.get('/api/booking/admin/bookings/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const bookingDetail = await getBookingAdminDetail(c.env.DB, {
    id: c.req.param('id'),
    lineAccountId: accountId,
  });
  if (!bookingDetail) return c.json({ error: 'booking_not_found' }, 404);
  return c.json({ booking: bookingDetail });
});

booking.get('/api/booking/admin/bookings/:id/audit-logs', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const bookingId = c.req.param('id');
  const exists = await c.env.DB
    .prepare(`SELECT 1 AS ok FROM bookings WHERE id = ? AND line_account_id = ?`)
    .bind(bookingId, accountId)
    .first<{ ok: number }>();
  if (!exists) return c.json({ error: 'booking_not_found' }, 404);
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query('limit') || '100', 10) || 100));
  const logs = await listBookingAuditLogs(c.env.DB, { bookingId, lineAccountId: accountId, limit });
  return c.json({ audit_logs: logs });
});
}
