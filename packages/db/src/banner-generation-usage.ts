import { jstNow } from './utils.js';

// -------------------------------------------------------------------- usage

/** 当日（日本時間）の生成枚数。1日の上限判定に使う。 */
export async function getBannerUsageToday(db: D1Database, tenantId: string): Promise<number> {
  const dayPrefix = jstNow().slice(0, 10); // YYYY-MM-DD
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(units), 0) AS units
         FROM banner_usage_ledger
        WHERE tenant_id = ? AND substr(created_at, 1, 10) = ?`,
    )
    .bind(tenantId, dayPrefix)
    .first<{ units: number }>();
  return Number(row?.units ?? 0);
}

/**
 * 直近の失敗した生成の数。短時間に失敗が続いたら自動で一時停止するために使う
 * （鍵の失効や上流の障害で、無駄な呼び出しが積み上がるのを防ぐ）。
 */
export async function countRecentFailedBannerGenerations(
  db: D1Database,
  tenantId: string,
  sinceJst: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM banner_generations
        WHERE tenant_id = ? AND status = 'failed' AND done_count = 0 AND finished_at >= ?`,
    )
    .bind(tenantId, sinceJst)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** 当月（日本時間）の生成枚数の合計（units は1枚＝1）。 */
export async function getBannerUsageThisMonth(db: D1Database, tenantId: string): Promise<number> {
  const monthPrefix = jstNow().slice(0, 7); // YYYY-MM
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(units), 0) AS units
         FROM banner_usage_ledger
        WHERE tenant_id = ? AND substr(created_at, 1, 7) = ?`,
    )
    .bind(tenantId, monthPrefix)
    .first<{ units: number }>();
  return Number(row?.units ?? 0);
}

export async function recordBannerUsage(
  db: D1Database,
  input: { tenantId: string; generationId: string | null; units: number; reason: 'generate' | 'refund' | 'edit' },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO banner_usage_ledger (id, tenant_id, generation_id, units, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), input.tenantId, input.generationId, input.units, input.reason, jstNow())
    .run();
}
