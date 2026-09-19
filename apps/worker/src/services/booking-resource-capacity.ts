/**
 * 予約INSERTへ連結する資源ガード。
 *
 * bind順:
 *  1 menuId, 2 accountId,
 *  3 menuId, 4 accountId, 5 accountId, 6 blockEndsAt, 7 startsAt
 */
export const BOOKING_RESOURCE_CAPACITY_GUARD_SQL = `AND NOT EXISTS (
  SELECT 1
    FROM booking_menu_resources mr
    LEFT JOIN booking_resources r ON r.id = mr.resource_id
   WHERE mr.menu_id = ?
     AND (
       r.id IS NULL
       OR r.line_account_id != ?
       OR r.is_active != 1
       OR mr.quantity > r.capacity
     )
)
AND NOT EXISTS (
  SELECT 1
    FROM booking_menu_resources mr
    INNER JOIN booking_resources r ON r.id = mr.resource_id
   WHERE mr.menu_id = ?
     AND r.line_account_id = ?
     AND r.is_active = 1
     AND (
       SELECT COALESCE(SUM(brc.quantity), 0)
         FROM booking_resource_consumptions brc
         INNER JOIN bookings occupied ON occupied.id = brc.booking_id
        WHERE brc.line_account_id = ?
          AND brc.resource_id = r.id
          AND occupied.status IN ('requested', 'confirmed')
          AND julianday(occupied.starts_at) < julianday(?)
          AND julianday(occupied.block_ends_at) > julianday(?)
     ) + mr.quantity > r.capacity
)`;

/**
 * 予約変更 (PATCH) 版の資源ガード。変更対象の消費行を合計から外す。
 * 自予約の snapshot を含めると、同じ枠のままの変更が容量超過と誤判定される。
 *
 * bind順:
 *  1 menuId, 2 accountId,
 *  3 menuId, 4 accountId, 5 accountId, 6 excludeBookingId, 7 blockEndsAt, 8 startsAt
 */
export const BOOKING_RESOURCE_CAPACITY_GUARD_EXCLUDE_SQL = `AND NOT EXISTS (
  SELECT 1
    FROM booking_menu_resources mr
    LEFT JOIN booking_resources r ON r.id = mr.resource_id
   WHERE mr.menu_id = ?
     AND (
       r.id IS NULL
       OR r.line_account_id != ?
       OR r.is_active != 1
       OR mr.quantity > r.capacity
     )
)
AND NOT EXISTS (
  SELECT 1
    FROM booking_menu_resources mr
    INNER JOIN booking_resources r ON r.id = mr.resource_id
   WHERE mr.menu_id = ?
     AND r.line_account_id = ?
     AND r.is_active = 1
     AND (
       SELECT COALESCE(SUM(brc.quantity), 0)
         FROM booking_resource_consumptions brc
         INNER JOIN bookings occupied ON occupied.id = brc.booking_id
        WHERE brc.line_account_id = ?
          AND brc.resource_id = r.id
          AND occupied.status IN ('requested', 'confirmed')
          AND occupied.id != ?
          AND julianday(occupied.starts_at) < julianday(?)
          AND julianday(occupied.block_ends_at) > julianday(?)
     ) + mr.quantity > r.capacity
)`;

export function bookingResourceGuardExcludeBindings(input: {
  menuId: string;
  lineAccountId: string;
  excludeBookingId: string;
  startsAt: string;
  blockEndsAt: string;
}): unknown[] {
  return [
    input.menuId,
    input.lineAccountId,
    input.menuId,
    input.lineAccountId,
    input.lineAccountId,
    input.excludeBookingId,
    input.blockEndsAt,
    input.startsAt,
  ];
}

export function bookingResourceGuardBindings(input: {
  menuId: string;
  lineAccountId: string;
  startsAt: string;
  blockEndsAt: string;
}): unknown[] {
  return [
    input.menuId,
    input.lineAccountId,
    input.menuId,
    input.lineAccountId,
    input.lineAccountId,
    input.blockEndsAt,
    input.startsAt,
  ];
}

/**
 * 予約本体と、その時点のメニュー資源割当snapshotを同じD1 batchで保存する。
 * D1 batchは逐次実行され、途中失敗時は全体がrollbackされる。
 */
export async function insertBookingWithResourceSnapshot(
  db: D1Database,
  input: {
    bookingInsert: D1PreparedStatement;
    bookingId: string;
    lineAccountId: string;
    menuId: string;
  },
): Promise<{ inserted: boolean; consumptionCount: number }> {
  const snapshot = db.prepare(
    `INSERT INTO booking_resource_consumptions (
       booking_id, line_account_id, resource_id, quantity, snapshot_source
     )
     SELECT ?, ?, mr.resource_id, mr.quantity, 'booking'
       FROM booking_menu_resources mr
       INNER JOIN booking_resources r ON r.id = mr.resource_id
      WHERE mr.menu_id = ?
        AND r.line_account_id = ?
        AND r.is_active = 1
        AND EXISTS (
          SELECT 1 FROM bookings b
           WHERE b.id = ? AND b.line_account_id = ?
        )`,
  ).bind(
    input.bookingId,
    input.lineAccountId,
    input.menuId,
    input.lineAccountId,
    input.bookingId,
    input.lineAccountId,
  );
  const [bookingResult, snapshotResult] = await db.batch<D1Result<unknown>>([
    input.bookingInsert,
    snapshot,
  ]);
  return {
    inserted: (bookingResult?.meta?.changes ?? 0) > 0,
    consumptionCount: Number(snapshotResult?.meta?.changes ?? 0),
  };
}
