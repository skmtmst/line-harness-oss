

export type StaffMenuAssignment = {
  menu_id: string;
  is_offered: boolean;
  override_duration_minutes?: number | null;
  override_price?: number | null;
};

// 担当者1人分の割り当てを「消して入れ直す」文を返す。呼び出し側が
// db.batch にまとめて渡し、DELETE と INSERT が別トランザクションに
// 分かれないようにする。
export function staffMenusReplaceStatements(
  db: D1Database,
  staffId: string,
  menus: StaffMenuAssignment[],
): D1PreparedStatement[] {
  return [
    db.prepare(`DELETE FROM staff_menus WHERE staff_id = ?`).bind(staffId),
    ...menus.map((m) =>
      db
        .prepare(
          `INSERT INTO staff_menus
            (staff_id, menu_id, is_offered, override_duration_minutes, override_price)
           VALUES (?,?,?,?,?)`,
        )
        .bind(
          staffId,
          m.menu_id,
          m.is_offered ? 1 : 0,
          m.override_duration_minutes ?? null,
          m.override_price ?? null,
        ),
    ),
  ];
}

// ---- staff breaks (N-405 #655; 枠への差し引きは #1471 合流後に availability 側で有効化) ----

export const BREAK_WEEKLY_LIMIT = 28;

// 1日4件×7日
export const BREAK_DATE_LIMIT = 366;
