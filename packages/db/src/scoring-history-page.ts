import type { FriendScoreRow } from './scoring-types.js';
import { boundedListLimit } from './utils.js';

/** Bound to the same authorized friend and account as the next request. */
export interface ScoreHistoryCursor {
  friendId: string;
  lineAccountId: string;
  createdAt: string;
  id: string;
}

/**
 * Opt-in detail pagination. The existing complete history/export query keeps
 * returning every row; callers authorize the friend before using either path.
 * A composite history index still requires a separately approved migration.
 */
export async function getFriendScoreHistoryPage(
  db: D1Database,
  input: {
    friendId: string;
    lineAccountId: string;
    limit?: number;
    cursor?: ScoreHistoryCursor;
  },
): Promise<{ items: FriendScoreRow[]; nextCursor: ScoreHistoryCursor | null }> {
  const { friendId, lineAccountId, cursor } = input;
  if (cursor && (
    cursor.friendId !== friendId || cursor.lineAccountId !== lineAccountId
    || typeof cursor.createdAt !== 'string' || typeof cursor.id !== 'string'
    || !cursor.createdAt || !cursor.id
  )) throw new Error('score_history_cursor_scope_mismatch');
  const limit = boundedListLimit(input.limit, 100);
  const cursorSql = cursor ? ' AND (s.created_at < ? OR (s.created_at = ? AND s.id < ?))' : '';
  const cursorBinds = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : [];
  const result = await db.prepare(
    `SELECT s.id, s.friend_id, s.scoring_rule_id, s.score_change, s.reason, s.created_at,
            s.event_type, s.source, s.rule_key, s.operation, s.score_before, s.score_after,
            s.occurred_at, s.executed_by_staff_id, s.executed_by_staff_name
       FROM friend_scores s
       JOIN friends f ON f.id = s.friend_id
      WHERE s.friend_id = ? AND f.line_account_id = ?${cursorSql}
      ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
  ).bind(friendId, lineAccountId, ...cursorBinds, limit + 1).all<FriendScoreRow>();
  const items = result.results.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: result.results.length > limit && last
      ? { friendId, lineAccountId, createdAt: last.created_at, id: last.id }
      : null,
  };
}
