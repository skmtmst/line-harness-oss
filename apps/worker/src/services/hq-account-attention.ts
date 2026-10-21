import type { HqAttentionCounts } from '@line-crm/shared';

/** Caller must verify this account belongs to the current visible HQ scope. */
export async function readAccountAttention(db: D1Database, a: string, includeDetails = true) {
  const queries: Record<string, string> = {
        unhandledChats: `SELECT id,'/chats' href FROM chats WHERE line_account_id=? AND status IN('unread','in_progress','on_hold')`,
        pendingBookings: `SELECT id,'/booking/bookings' href FROM bookings WHERE line_account_id=? AND status='requested' UNION ALL SELECT id,'/events/bookings' href FROM event_bookings WHERE line_account_id=? AND status='requested' UNION ALL SELECT r.id,'/restaurant-test/reservations' href FROM rt_reservations r JOIN rt_stores s ON s.id=r.store_id WHERE s.line_account_id=? AND r.status='pending' AND r.hold_expires_at IS NULL`,
        unpaid: `SELECT id FROM booking_payments WHERE line_account_id=? AND status IN('unpaid','pending','failed')`,
        connections: `SELECT id,'/accounts' href FROM line_account_connection_checks c WHERE line_account_id=? AND result IN('failed','mismatched','unconfigured') AND NOT EXISTS(SELECT 1 FROM line_account_connection_checks n WHERE n.line_account_id=c.line_account_id AND n.check_kind=c.check_kind AND n.checked_at>c.checked_at)`,
        stoppedDeliveries: `SELECT id,'/broadcasts' href FROM broadcasts WHERE line_account_id=? AND status IN('stopped','failed')`,
  };

    const counts: Record<string, number> = {},
      details: Record<string, unknown[]> = {};
    for (const [kind, sql] of Object.entries(queries)) {
      const bindings = Array.from(
        { length: kind === 'pendingBookings' ? 3 : 1 },
        () => a,
      );
      const count = await db.prepare(
        `SELECT COUNT(*) count FROM (${sql})`,
      )
        .bind(...bindings)
        .first<{ count: number }>();
      counts[kind] = count?.count ?? 0;
      if (includeDetails) details[kind] = (
        await db.prepare(sql + ' LIMIT 100')
          .bind(...bindings)
          .all()
      ).results;
    }
  return { counts: counts as HqAttentionCounts, details };
}
