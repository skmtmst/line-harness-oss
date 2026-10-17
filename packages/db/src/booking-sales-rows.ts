export interface SalesRow {
  menu_id: string; menu_name: string | null; status: string; price: number; starts_at: string;
}

export async function fetchSalesRows(
  db: D1Database,
  lineAccountId: string,
  from: string,
  to: string,
): Promise<SalesRow[]> {
  const rows = await db.prepare(
    `SELECT b.menu_id, m.name AS menu_name, b.status,
            COALESCE(b.price_at_booking, m.base_price, 0) AS price,
            b.starts_at
       FROM bookings b
       LEFT JOIN menus m ON m.id = b.menu_id
      WHERE b.line_account_id = ? AND julianday(b.starts_at) >= julianday(?) AND julianday(b.starts_at) < julianday(?)`,
  ).bind(lineAccountId, from, to).all<SalesRow>();
  return rows.results ?? [];
}
