import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { getBookingCustomerContext } from '../../features/booking/booking-admin-detail/index.js';
import { resolveAccountIdAdmin } from './identity.js';

export function registerCustomerContext(booking: Hono<Env>): void {
// Admin mirror of the LIFF availability lookup. minLeadTimeMinutes is 0:
// the operator is on the phone with the customer and may book a slot
// starting within the lead-time window that customers themselves cannot.
booking.get('/api/booking/admin/customer-context', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const friendId = c.req.query('friend_id')?.trim() || null;
  const bookingCustomerId = c.req.query('booking_customer_id')?.trim() || null;
  if ((!friendId && !bookingCustomerId) || (friendId && bookingCustomerId)) {
    return c.json({ error: 'missing_customer' }, 400);
  }
  const customer = await getBookingCustomerContext(c.env.DB, {
    lineAccountId: accountId,
    friendId,
    bookingCustomerId,
  });
  if (!customer) return c.json({ error: 'customer_not_found' }, 404);
  return c.json({ customer });
});

/**
 * 前回と同じで予約：友だちごとの「前回の予約（メニュー・担当）」を返す。
 *
 * 最新の1件（取り消し・却下・期限切れを除く）のメニューと担当を返す。
 * 前回の担当が辞めた（is_active=0・削除ずみ）・メニューが止まっている
 * （is_active=0・削除ずみ・担当が扱っていない）ときは返さない
 * （available=false）。画面はこの口を見て「前回と同じ」ボタンを出す。
 */
booking.get('/api/booking/admin/last-booking', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const friendId = c.req.query('friend_id')?.trim() || null;
  const bookingCustomerId = c.req.query('booking_customer_id')?.trim() || null;
  if ((!friendId && !bookingCustomerId) || (friendId && bookingCustomerId)) {
    return c.json({ error: 'missing_customer' }, 400);
  }
  const ownerColumn = friendId ? 'b.friend_id' : 'b.booking_customer_id';
  const ownerValue = (friendId ?? bookingCustomerId) as string;
  const row = await c.env.DB
    .prepare(
      `SELECT b.id, b.starts_at, b.status,
              m.id AS menu_id, m.name AS menu_name, m.is_active AS menu_active,
              m.deleted_at AS menu_deleted_at,
              s.id AS staff_id, s.display_name AS staff_name,
              s.is_active AS staff_active, s.deleted_at AS staff_deleted_at,
              sm.is_offered AS staff_offers_menu
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN staff_menus sm ON sm.staff_id = b.staff_id AND sm.menu_id = b.menu_id
        WHERE b.line_account_id = ? AND ${ownerColumn} = ?
          AND b.status NOT IN ('cancelled', 'rejected', 'expired')
        ORDER BY b.starts_at DESC LIMIT 1`,
    )
    .bind(accountId, ownerValue)
    .first<{
      id: string;
      starts_at: string;
      status: string;
      menu_id: string;
      menu_name: string;
      menu_active: number;
      menu_deleted_at: string | null;
      staff_id: string;
      staff_name: string;
      staff_active: number;
      staff_deleted_at: string | null;
      staff_offers_menu: number | null;
    }>();
  if (!row) return c.json({ available: false, reason: 'no_history' });
  if (Number(row.menu_active) !== 1 || row.menu_deleted_at !== null) {
    return c.json({ available: false, reason: 'menu_inactive' });
  }
  if (Number(row.staff_active) !== 1 || row.staff_deleted_at !== null) {
    return c.json({ available: false, reason: 'staff_inactive' });
  }
  if (row.staff_offers_menu !== null && Number(row.staff_offers_menu) !== 1) {
    return c.json({ available: false, reason: 'not_offered' });
  }
  return c.json({
    available: true,
    booking: {
      id: row.id,
      starts_at: row.starts_at,
      status: row.status,
      menu: { id: row.menu_id, name: row.menu_name },
      staff: { id: row.staff_id, display_name: row.staff_name },
    },
  });
});
}
