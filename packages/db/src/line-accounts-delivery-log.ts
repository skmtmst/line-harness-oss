import { jstNow } from './utils.js';
import { type SkippedDelivery } from './line-accounts-types.js';


/**
 * 「止めていたので送らなかった」の記録。同じ job は一度だけ残す
 * （cron が回るたびに増えないよう UNIQUE で抑える）。
 */
export async function recordSkippedDelivery(
  db: D1Database,
  input: {
    lineAccountId: string;
    kind: string;
    refId: string;
    title?: string | null;
    reason?: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO account_skipped_deliveries
         (id, line_account_id, kind, ref_id, title, reason, skipped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.lineAccountId,
      input.kind,
      input.refId,
      input.title ?? null,
      input.reason ?? 'account_inactive',
      jstNow(),
    )
    .run();
}

export async function listSkippedDeliveries(
  db: D1Database,
  lineAccountId: string,
): Promise<SkippedDelivery[]> {
  const result = await db
    .prepare(
      `SELECT * FROM account_skipped_deliveries
        WHERE line_account_id = ? ORDER BY skipped_at DESC`,
    )
    .bind(lineAccountId)
    .all<SkippedDelivery>();
  return result.results;
}

export async function recordPoolSwitchEvent(
  db: D1Database,
  input: {
    poolId: string;
    lineAccountId: string;
    direction: 'out' | 'in';
    reason: string;
    actor?: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO account_pool_switch_events
         (id, pool_id, line_account_id, direction, reason, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.poolId,
      input.lineAccountId,
      input.direction,
      input.reason,
      input.actor ?? 'system',
      jstNow(),
    )
    .run();
}

/**
 * 自動で外れていてまだ戻っていないプール参加を返す。
 * 「直近の切替が out で、その後に in が無い」行だけ。
 */
export async function listAutoSwitchedOutPoolAccounts(
  db: D1Database,
): Promise<Array<{ pool_id: string; line_account_id: string; switched_at: string }>> {
  const result = await db
    .prepare(
      `SELECT pool_id, line_account_id, created_at AS switched_at
         FROM account_pool_switch_events e
        WHERE e.direction = 'out'
          AND NOT EXISTS (
            SELECT 1 FROM account_pool_switch_events r
             WHERE r.line_account_id = e.line_account_id
               AND r.pool_id = e.pool_id
               AND r.direction = 'in'
               AND (r.created_at > e.created_at
                    OR (r.created_at = e.created_at AND r.rowid > e.rowid))
          )
        GROUP BY e.pool_id, e.line_account_id`,
    )
    .all<{ pool_id: string; line_account_id: string; switched_at: string }>();
  return result.results;
}
