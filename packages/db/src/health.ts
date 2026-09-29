import { jstNow } from './utils.js';
// BAN検知 & リカバリ クエリヘルパー

export interface AccountHealthLogRow {
  id: string;
  line_account_id: string;
  error_code: number | null;
  error_count: number;
  check_period: string;
  risk_level: string;
  created_at: string;
}

export interface AccountMigrationRow {
  id: string;
  from_account_id: string;
  to_account_id: string;
  status: string;
  migrated_count: number;
  total_count: number;
  created_at: string;
  completed_at: string | null;
}

// --- ヘルスログ ---

export async function getAccountHealthLogs(db: D1Database, lineAccountId: string, limit = 50): Promise<AccountHealthLogRow[]> {
  const result = await db.prepare(`SELECT * FROM account_health_logs WHERE line_account_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(lineAccountId, limit).all<AccountHealthLogRow>();
  return result.results;
}

export async function createAccountHealthLog(
  db: D1Database,
  input: { lineAccountId: string; errorCode?: number; errorCount: number; checkPeriod: string; riskLevel: string },
): Promise<AccountHealthLogRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO account_health_logs (id, line_account_id, error_code, error_count, check_period, risk_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.lineAccountId, input.errorCode ?? null, input.errorCount, input.checkPeriod, input.riskLevel, now).run();
  return (await db.prepare(`SELECT * FROM account_health_logs WHERE id = ?`).bind(id).first<AccountHealthLogRow>())!;
}

/**
 * 最新のリスクレベルを取得。
 *
 * 同じ時刻のログが複数あるときは id の大きい方を採る。まとめて取る
 * `getLatestRiskLevels` と同じ並びにしておかないと、サイドバーの要約と
 * 個別画面で違うレベルが出る(#630)。
 */
export async function getLatestRiskLevel(db: D1Database, lineAccountId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT risk_level FROM account_health_logs WHERE line_account_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
    .bind(lineAccountId).first<{ risk_level: string }>();
  return row?.risk_level ?? null;
}

export interface LatestAccountRiskRow {
  line_account_id: string;
  risk_level: string;
}

/**
 * 複数アカウントの最新リスクレベルを1クエリで取得する(サイドバーの N+1 解消用)。
 * ログ本文は返さない。呼び出し側が staff 可視範囲の ID だけを渡すこと。
 *
 * `GROUP BY` に対して裸の `risk_level` を並べる書き方はしない。SQLite は
 * それを通してしまうが、同じ時刻のログが2件あるとどちらの値が返るかは
 * 決まらない。危険と正常が同時刻で並んだときにサイドバーの警告が
 * 出たり出なかったりするので、順位付け(時刻の新しい順、同着は id の
 * 大きい順)で1件に決めてから取り出す(#630)。
 */
export async function getLatestRiskLevels(
  db: D1Database,
  lineAccountIds: readonly string[],
): Promise<LatestAccountRiskRow[]> {
  if (lineAccountIds.length === 0) return [];
  const result = await db.prepare(
    `SELECT line_account_id, risk_level
       FROM (
         SELECT line_account_id,
                risk_level,
                ROW_NUMBER() OVER (
                  PARTITION BY line_account_id
                  ORDER BY created_at DESC, id DESC
                ) AS rn
           FROM account_health_logs
          WHERE line_account_id IN (SELECT value FROM json_each(?))
       )
      WHERE rn = 1`,
  ).bind(JSON.stringify([...lineAccountIds])).all<LatestAccountRiskRow>();
  return result.results;
}

// --- マイグレーション ---

export async function getAccountMigrations(db: D1Database): Promise<AccountMigrationRow[]> {
  const result = await db.prepare(`SELECT * FROM account_migrations ORDER BY created_at DESC`).all<AccountMigrationRow>();
  return result.results;
}

export async function getAccountMigrationById(db: D1Database, id: string): Promise<AccountMigrationRow | null> {
  return db.prepare(`SELECT * FROM account_migrations WHERE id = ?`).bind(id).first<AccountMigrationRow>();
}

export async function createAccountMigration(
  db: D1Database,
  input: { fromAccountId: string; toAccountId: string; totalCount: number },
): Promise<AccountMigrationRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO account_migrations (id, from_account_id, to_account_id, total_count, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, input.fromAccountId, input.toAccountId, input.totalCount, now).run();
  return (await getAccountMigrationById(db, id))!;
}

export async function updateAccountMigration(
  db: D1Database,
  id: string,
  updates: Partial<{ status: string; migratedCount: number; completedAt: string }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.migratedCount !== undefined) { sets.push('migrated_count = ?'); values.push(updates.migratedCount); }
  if (updates.completedAt !== undefined) { sets.push('completed_at = ?'); values.push(updates.completedAt); }
  if (sets.length === 0) return;
  values.push(id);
  await db.prepare(`UPDATE account_migrations SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}
