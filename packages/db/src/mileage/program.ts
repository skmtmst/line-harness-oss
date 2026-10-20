import { jstNow } from '../utils.js';


export const DEFAULT_MILEAGE_PROGRAM_ID = 'default';

/**
 * Bootstrap files contain schema objects but not seed rows, so lazily ensure the
 * built-in program before any default-wallet operation. The migration also
 * seeds it; INSERT OR IGNORE keeps both deployment paths safe.
 */
export async function ensureDefaultMileageProgram(db: D1Database): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO mileage_programs
         (id, code, name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .bind(
      DEFAULT_MILEAGE_PROGRAM_ID,
      DEFAULT_MILEAGE_PROGRAM_ID,
      'Harnessマイル',
      now,
      now,
    )
    .run();
}

export async function ensureBuiltInProgram(db: D1Database, programId: string): Promise<void> {
  if (programId === DEFAULT_MILEAGE_PROGRAM_ID) {
    await ensureDefaultMileageProgram(db);
  }
}

/**
 * N-231 公開版(案1)。受付時点で固定する適用版の集合 {rule_id: version_number}。
 * 0 は未公開(旧口で作ったまま)で、処理時は live を読む。単一IDへ潰さない。
 */
export async function getAccountRuleVersionMap(
  db: D1Database,
  lineAccountId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .prepare(
      `SELECT id, COALESCE(published_version_number, 0) AS version_number
         FROM mileage_rules
        WHERE line_account_id = ?`,
    )
    .bind(lineAccountId)
    .all<{ id: string; version_number: number }>();
  const map: Record<string, number> = {};
  for (const row of rows.results) {
    map[row.id] = Number(row.version_number ?? 0);
  }
  return map;
}
