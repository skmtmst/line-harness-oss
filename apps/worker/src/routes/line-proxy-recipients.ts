import type { Friend } from '@line-crm/db';

// Chunk size for friend lookups via IN (...) — same 100-bind ceiling.
export const LOOKUP_CHUNK = 90;

/** Look up friends for a set of userIds in IN-clause chunks (≤100 binds each). */
export async function getFriendsByLineUserIds(
  db: D1Database,
  userIds: string[],
  lineAccountId: string | null,
): Promise<Map<string, Friend>> {
  const found = new Map<string, Friend>();
  for (let i = 0; i < userIds.length; i += LOOKUP_CHUNK) {
    const chunk = userIds.slice(i, i + LOOKUP_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    if (lineAccountId) {
      const scoped = await db
        .prepare(
          `SELECT * FROM friends
            WHERE line_account_id = ?
              AND line_user_id IN (${placeholders})`,
        )
        .bind(lineAccountId, ...chunk)
        .all<Friend>();
      for (const row of scoped.results ?? []) found.set(row.line_user_id, row);
    }

    // 別アカウント所有の行には触れない (Issue #961)。拾うのは未割当
    // (line_account_id IS NULL) の行だけ。他アカウントの友だちへ送信を
    // 記録する場合は、行を移す代わりにこのアカウント用の行を作る側へ回す。
    const unresolved = chunk.filter((lineUserId) => !found.has(lineUserId));
    if (unresolved.length > 0) {
      const unresolvedPlaceholders = unresolved.map(() => '?').join(',');
      const fallback = await db
        .prepare(
          `SELECT * FROM friends
            WHERE line_account_id IS NULL
              AND line_user_id IN (${unresolvedPlaceholders})`,
        )
        .bind(...unresolved)
        .all<Friend>();
      for (const row of fallback.results ?? []) found.set(row.line_user_id, row);
    }
  }
  return found;
}

/** Reuse the send-time lookup when writing the successful push's history. */
export async function readProxyPushRecipient(db: D1Database, accountId: string, uid: string) {
  const row = await db.prepare(`SELECT f.*, EXISTS (
      SELECT 1 FROM friend_delivery_consents c JOIN friends recipient
        ON recipient.id=c.friend_id AND recipient.line_account_id=c.line_account_id
      WHERE c.state<>'granted' AND c.line_account_id=? AND recipient.line_user_id=?
    ) AS delivery_suppressed FROM friends f
    WHERE f.line_user_id=? AND (f.line_account_id=? OR f.line_account_id IS NULL)
    ORDER BY (f.line_account_id=?) DESC LIMIT 1`)
    .bind(accountId, uid, uid, accountId, accountId).first<Friend & { delivery_suppressed: number }>();
  if (!row) return { friend: null, suppressed: false };
  const { delivery_suppressed, ...friend } = row;
  return { friend: friend as Friend, suppressed: delivery_suppressed === 1 };
}
