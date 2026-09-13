import { jstNow } from './utils.js';

export interface BookingMenuResourceAssignment {
  menuId: string;
  resourceId: string;
  name: string;
  type: string;
  capacity: number;
  quantity: number;
  isActive: boolean;
  warning: 'resource_inactive' | 'capacity_exceeded' | null;
}

export type ReplaceBookingMenuResourcesResult =
  | { status: 'updated'; version: number; resources: Array<{ resourceId: string; quantity: number }> }
  | { status: 'not_found' }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'invalid_resource' };

export async function listBookingMenuResourceAssignments(
  db: D1Database,
  lineAccountId: string,
): Promise<BookingMenuResourceAssignment[]> {
  const result = await db.prepare(`SELECT mr.menu_id, mr.resource_id, mr.quantity,
      r.name, r.resource_type, r.capacity, r.is_active
    FROM booking_menu_resources mr
    INNER JOIN menus m ON m.id = mr.menu_id
    INNER JOIN booking_resources r ON r.id = mr.resource_id
    WHERE m.line_account_id = ? AND m.deleted_at IS NULL
      AND r.line_account_id = m.line_account_id
    ORDER BY mr.menu_id ASC, r.name ASC, r.id ASC`)
    .bind(lineAccountId)
    .all<{
      menu_id: string; resource_id: string; quantity: number; name: string;
      resource_type: string; capacity: number; is_active: number;
    }>();
  return (result.results ?? []).map((row) => ({
    menuId: row.menu_id,
    resourceId: row.resource_id,
    name: row.name,
    type: row.resource_type,
    capacity: Number(row.capacity),
    quantity: Number(row.quantity),
    isActive: row.is_active === 1,
    warning: row.is_active !== 1
      ? 'resource_inactive'
      : Number(row.quantity) > Number(row.capacity) ? 'capacity_exceeded' : null,
  }));
}

function guardedWantedCte(): string {
  return `WITH request(payload, menu_id, account_id, expected_version) AS (
      VALUES (?, ?, ?, ?)
    ), wanted AS (
      SELECT json_extract(value, '$.resourceId') AS resource_id,
             json_extract(value, '$.quantity') AS quantity
        FROM json_each((SELECT payload FROM request))
    ), allowed AS (
      SELECT 1
       WHERE EXISTS (SELECT 1 FROM menus m, request req
          WHERE m.id = req.menu_id AND m.line_account_id = req.account_id
            AND m.deleted_at IS NULL AND m.version = req.expected_version)
         AND (SELECT COUNT(*) FROM wanted)
           = (SELECT COUNT(DISTINCT resource_id) FROM wanted)
         AND NOT EXISTS (
           SELECT 1 FROM wanted w
           LEFT JOIN booking_resources r ON r.id = w.resource_id
           WHERE r.id IS NULL
             OR r.line_account_id != (SELECT account_id FROM request) OR r.is_active != 1
             OR typeof(w.quantity) != 'integer'
             OR w.quantity < 1 OR w.quantity > 1000 OR w.quantity > r.capacity
         )
    )`;
}

/**
 * メニューの資源割当をaccount境界とmenu版で守り、一つのD1 batchで置換する。
 * 各文が同じCAS・資源妥当性を再確認するため、競合時は全て0件になる。
 * D1 batch中のSQL例外は全体rollbackされ、旧割当だけ消える状態を残さない。
 */
export async function replaceBookingMenuResources(
  db: D1Database,
  input: {
    menuId: string;
    lineAccountId: string;
    expectedVersion: number;
    resources: Array<{ resourceId: string; quantity: number }>;
  },
): Promise<ReplaceBookingMenuResourcesResult> {
  const wantedJson = JSON.stringify(input.resources);
  const bind = (statement: D1PreparedStatement): D1PreparedStatement => statement.bind(
    wantedJson,
    input.menuId,
    input.lineAccountId,
    input.expectedVersion,
  );
  const cte = guardedWantedCte();
  const statements: D1PreparedStatement[] = [
    bind(db.prepare(`${cte}
      DELETE FROM booking_menu_resources
       WHERE menu_id = (SELECT menu_id FROM request) AND EXISTS (SELECT 1 FROM allowed)`)),
  ];
  if (input.resources.length > 0) {
    statements.push(bind(db.prepare(`${cte}
      INSERT INTO booking_menu_resources (menu_id, resource_id, quantity)
      SELECT (SELECT menu_id FROM request), resource_id, quantity FROM wanted
       WHERE EXISTS (SELECT 1 FROM allowed)`)));
  }
  statements.push(bind(db.prepare(`${cte}
    UPDATE menus SET version = version + 1, updated_at = '${jstNow().replaceAll("'", "''")}'
     WHERE id = (SELECT menu_id FROM request)
       AND line_account_id = (SELECT account_id FROM request)
       AND deleted_at IS NULL AND version = (SELECT expected_version FROM request)
       AND EXISTS (SELECT 1 FROM allowed)
    RETURNING version`)));

  const results = await db.batch<D1Result<{ version: number }>>(statements);
  const final = results[results.length - 1];
  if ((final?.meta?.changes ?? 0) > 0) {
    return {
      status: 'updated',
      version: input.expectedVersion + 1,
      // commit後SELECTをすると、直後の別保存を今回の応答へ混ぜてしまう。
      // このtransactionが確定した入力snapshotだけを返す。
      resources: input.resources.map((item) => ({ ...item })),
    };
  }

  const current = await db.prepare(`SELECT version FROM menus
    WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`)
    .bind(input.menuId, input.lineAccountId)
    .first<{ version: number }>();
  if (!current) return { status: 'not_found' };
  if (Number(current.version) !== input.expectedVersion) {
    return { status: 'conflict', currentVersion: Number(current.version) };
  }
  return { status: 'invalid_resource' };
}
