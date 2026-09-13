import { jstNow } from './utils.js';

export type BookingResourceUpdateResult =
  | { status: 'updated' }
  | { status: 'not_found' }
  | { status: 'capacity_conflict'; peakQuantity: number };

export interface BookingResourceBackfillStats {
  bookingCount: number;
  consumptionCount: number;
}

/**
 * 資源をaccount境界内で更新する。
 *
 * 稼働中の資源は、現在以降に重なる予約snapshotの最大同時消費量を下回る
 * capacityへ縮小できない。停止は既存予約を壊さず、新規予約側でfail-closed
 * にするため、この容量条件の対象外にする。
 */
export async function updateBookingResourceSafely(
  db: D1Database,
  input: {
    lineAccountId: string;
    resourceId: string;
    capacity: number;
    isActive: boolean;
    now?: Date;
  },
): Promise<BookingResourceUpdateResult> {
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 1000) {
    throw new Error('booking_resource_capacity_invalid');
  }
  const nowIso = (input.now ?? new Date()).toISOString();
  const active = input.isActive ? 1 : 0;
  const result = await db.prepare(
    `UPDATE booking_resources
        SET capacity = ?, is_active = ?, updated_at = ?
      WHERE id = ? AND line_account_id = ?
        AND (? = 0 OR NOT EXISTS (
          SELECT 1
          FROM (
            SELECT ? AS point
            UNION
            SELECT b.starts_at AS point
              FROM bookings b
              INNER JOIN booking_resource_consumptions brc
                ON brc.booking_id = b.id
             WHERE brc.line_account_id = ?
               AND brc.resource_id = ?
               AND b.status IN ('requested', 'confirmed')
               AND julianday(b.block_ends_at) > julianday(?)
          ) points
          WHERE (
            SELECT COALESCE(SUM(brc2.quantity), 0)
              FROM booking_resource_consumptions brc2
              INNER JOIN bookings b2 ON b2.id = brc2.booking_id
             WHERE brc2.line_account_id = ?
               AND brc2.resource_id = ?
               AND b2.status IN ('requested', 'confirmed')
               AND julianday(b2.starts_at) <= julianday(points.point)
               AND julianday(b2.block_ends_at) > julianday(points.point)
          ) > ?
        ))`,
  ).bind(
    input.capacity,
    active,
    jstNow(),
    input.resourceId,
    input.lineAccountId,
    active,
    nowIso,
    input.lineAccountId,
    input.resourceId,
    nowIso,
    input.lineAccountId,
    input.resourceId,
    input.capacity,
  ).run();
  if ((result.meta?.changes ?? 0) > 0) return { status: 'updated' };

  const resource = await db.prepare(
    `SELECT 1 AS ok FROM booking_resources WHERE id = ? AND line_account_id = ?`,
  ).bind(input.resourceId, input.lineAccountId).first<{ ok: number }>();
  if (!resource) return { status: 'not_found' };

  const peak = await db.prepare(
    `SELECT COALESCE(MAX(used_quantity), 0) AS peak_quantity
       FROM (
         SELECT (
           SELECT COALESCE(SUM(brc2.quantity), 0)
             FROM booking_resource_consumptions brc2
             INNER JOIN bookings b2 ON b2.id = brc2.booking_id
            WHERE brc2.line_account_id = ?
              AND brc2.resource_id = ?
              AND b2.status IN ('requested', 'confirmed')
              AND julianday(b2.starts_at) <= julianday(points.point)
              AND julianday(b2.block_ends_at) > julianday(points.point)
         ) AS used_quantity
         FROM (
           SELECT ? AS point
           UNION
           SELECT b.starts_at AS point
             FROM bookings b
             INNER JOIN booking_resource_consumptions brc ON brc.booking_id = b.id
            WHERE brc.line_account_id = ?
              AND brc.resource_id = ?
              AND b.status IN ('requested', 'confirmed')
              AND julianday(b.block_ends_at) > julianday(?)
         ) points
       )`,
  ).bind(
    input.lineAccountId,
    input.resourceId,
    nowIso,
    input.lineAccountId,
    input.resourceId,
    nowIso,
  ).first<{ peak_quantity: number }>();
  return { status: 'capacity_conflict', peakQuantity: Number(peak?.peak_quantity ?? 0) };
}

/** migration補完行を運用確認できる件数へまとめる。 */
export async function getBookingResourceBackfillStats(
  db: D1Database,
  lineAccountId: string,
): Promise<BookingResourceBackfillStats> {
  const row = await db.prepare(
    `SELECT COUNT(DISTINCT booking_id) AS booking_count,
            COUNT(*) AS consumption_count
       FROM booking_resource_consumptions
      WHERE line_account_id = ?
        AND snapshot_source = 'migration_current_assignment'`,
  ).bind(lineAccountId).first<{ booking_count: number; consumption_count: number }>();
  return {
    bookingCount: Number(row?.booking_count ?? 0),
    consumptionCount: Number(row?.consumption_count ?? 0),
  };
}
