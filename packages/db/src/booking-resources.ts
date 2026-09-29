import { jstNow } from './utils.js';

export type BookingResourceUpdateResult =
  | { status: 'updated'; version?: number; item?: BookingResourceRecord }
  | { status: 'not_found' }
  | { status: 'version_conflict'; currentVersion: number }
  | { status: 'assignment_conflict'; requiredQuantity: number }
  | { status: 'capacity_conflict'; peakQuantity: number };

export interface BookingResourceRecord {
  id: string;
  lineAccountId: string;
  name: string;
  type: string;
  capacity: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

type BookingResourceRow = {
  id: string; line_account_id: string; name: string; resource_type: string;
  capacity: number; is_active: number; version: number; created_at: string; updated_at: string;
};

function serializeResource(row: BookingResourceRow): BookingResourceRecord {
  return {
    id: row.id, lineAccountId: row.line_account_id, name: row.name, type: row.resource_type,
    capacity: Number(row.capacity), isActive: row.is_active === 1, version: Number(row.version),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function getBookingResource(
  db: D1Database,
  lineAccountId: string,
  resourceId: string,
): Promise<BookingResourceRecord | null> {
  const row = await db.prepare(`SELECT id, line_account_id, name, resource_type, capacity,
      is_active, version, created_at, updated_at
    FROM booking_resources WHERE id = ? AND line_account_id = ?`)
    .bind(resourceId, lineAccountId).first<BookingResourceRow>();
  return row ? serializeResource(row) : null;
}

export async function createBookingResource(
  db: D1Database,
  input: { lineAccountId: string; name: string; type: string; capacity: number; isActive: boolean },
): Promise<BookingResourceRecord> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const row = await db.prepare(`INSERT INTO booking_resources
      (id, line_account_id, name, resource_type, capacity, is_active, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    RETURNING id, line_account_id, name, resource_type, capacity, is_active,
      version, created_at, updated_at`)
    .bind(id, input.lineAccountId, input.name, input.type, input.capacity, input.isActive ? 1 : 0, now, now)
    .first<BookingResourceRow>();
  if (!row) throw new Error('booking_resource_create_failed');
  return serializeResource(row);
}

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
    expectedVersion?: number;
    name?: string;
    type?: string;
    now?: Date;
  },
): Promise<BookingResourceUpdateResult> {
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 1000) {
    throw new Error('booking_resource_capacity_invalid');
  }
  const nowIso = (input.now ?? new Date()).toISOString();
  const active = input.isActive ? 1 : 0;
  const versionSet = input.expectedVersion === undefined ? '' : ', version = version + 1';
  const versionWhere = input.expectedVersion === undefined ? '' : ' AND version = ?';
  const returning = input.expectedVersion === undefined ? '' : ` RETURNING id, line_account_id,
    name, resource_type, capacity, is_active, version, created_at, updated_at`;
  const statement = db.prepare(
    `UPDATE booking_resources
        SET name = COALESCE(?, name), resource_type = COALESCE(?, resource_type),
            capacity = ?, is_active = ?, updated_at = ?${versionSet}
      WHERE id = ? AND line_account_id = ?
        ${versionWhere}
        AND (? = 0 OR NOT EXISTS (
          SELECT 1 FROM booking_menu_resources
           WHERE resource_id = ? AND quantity > ?
        ))
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
        ))${returning}`,
  ).bind(
    input.name ?? null,
    input.type ?? null,
    input.capacity,
    active,
    jstNow(),
    input.resourceId,
    input.lineAccountId,
    ...(input.expectedVersion === undefined ? [] : [input.expectedVersion]),
    active,
    input.resourceId,
    input.capacity,
    active,
    nowIso,
    input.lineAccountId,
    input.resourceId,
    nowIso,
    input.lineAccountId,
    input.resourceId,
    input.capacity,
  );
  if (input.expectedVersion === undefined) {
    const result = await statement.run();
    if ((result.meta?.changes ?? 0) > 0) return { status: 'updated' };
  } else {
    const row = await statement.first<BookingResourceRow>();
    if (row) {
      const item = serializeResource(row);
      return { status: 'updated', version: item.version, item };
    }
  }

  const resource = await db.prepare(
    `SELECT ${input.expectedVersion === undefined ? '1 AS ok' : 'version'}
      FROM booking_resources WHERE id = ? AND line_account_id = ?`,
  ).bind(input.resourceId, input.lineAccountId).first<{ ok?: number; version?: number }>();
  if (!resource) return { status: 'not_found' };
  if (input.expectedVersion !== undefined && Number(resource.version) !== input.expectedVersion) {
    return { status: 'version_conflict', currentVersion: Number(resource.version) };
  }

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
  const peakQuantity = Number(peak?.peak_quantity ?? 0);
  if (peakQuantity > input.capacity) return { status: 'capacity_conflict', peakQuantity };

  const assignment = await db.prepare(`SELECT COALESCE(MAX(quantity), 0) AS required_quantity
    FROM booking_menu_resources WHERE resource_id = ?`)
    .bind(input.resourceId)
    .first<{ required_quantity: number }>();
  return {
    status: 'assignment_conflict',
    requiredQuantity: Number(assignment?.required_quantity ?? 0),
  };
}

export type BookingResourceDeleteResult =
  | { status: 'deleted' }
  | { status: 'not_found' }
  | { status: 'version_conflict'; currentVersion: number }
  | { status: 'reference_conflict'; menuCount: number; bookingCount: number; exceptionCount: number };

export async function deleteBookingResourceSafely(
  db: D1Database,
  input: { lineAccountId: string; resourceId: string; expectedVersion: number },
): Promise<BookingResourceDeleteResult> {
  const result = await db.prepare(`DELETE FROM booking_resources
    WHERE id = ? AND line_account_id = ? AND version = ?
      AND (0 = 1 OR (
        NOT EXISTS (SELECT 1 FROM booking_menu_resources WHERE resource_id = ?)
        AND NOT EXISTS (SELECT 1 FROM booking_resource_consumptions WHERE resource_id = ?)
        AND NOT EXISTS (SELECT 1 FROM booking_availability_exceptions
          WHERE scope_kind = 'resource' AND scope_id = ?)
      ))`)
    .bind(input.resourceId, input.lineAccountId, input.expectedVersion,
      input.resourceId, input.resourceId, input.resourceId).run();
  if ((result.meta?.changes ?? 0) > 0) return { status: 'deleted' };

  const current = await db.prepare(`SELECT version,
      (SELECT COUNT(*) FROM booking_menu_resources WHERE resource_id = r.id) AS menu_count,
      (SELECT COUNT(DISTINCT booking_id) FROM booking_resource_consumptions WHERE resource_id = r.id) AS booking_count,
      (SELECT COUNT(*) FROM booking_availability_exceptions
        WHERE scope_kind = 'resource' AND scope_id = r.id) AS exception_count
    FROM booking_resources r WHERE r.id = ? AND r.line_account_id = ?`)
    .bind(input.resourceId, input.lineAccountId)
    .first<{ version: number; menu_count: number; booking_count: number; exception_count: number }>();
  if (!current) return { status: 'not_found' };
  if (Number(current.version) !== input.expectedVersion) {
    return { status: 'version_conflict', currentVersion: Number(current.version) };
  }
  return {
    status: 'reference_conflict',
    menuCount: Number(current.menu_count), bookingCount: Number(current.booking_count),
    exceptionCount: Number(current.exception_count),
  };
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
