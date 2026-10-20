import { sqlIdSet } from './id-queries.js';
import { jstNow } from './utils.js';
import type { SavedSearchUsageCount, SavedSearchReferenceUsageCount } from './saved-search-usage-types.js';

export function savedSearchMonth(now = jstNow()): string {
  return now.slice(0, 7);
}

/** 一覧の「今月の呼び出し」を検索ごとにまとめて返す。 */
export async function getSavedSearchUsageCounts(
  db: D1Database,
  savedSearchIds: string[],
  lineAccountId: string,
  now = jstNow(),
): Promise<Map<string, number>> {
  const ids = [...new Set(savedSearchIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const placeholders = sqlIdSet(ids).sql;
  const result = await db.prepare(
    `SELECT saved_search_id, COUNT(*) AS call_count_this_month
       FROM saved_search_usage_events
      WHERE line_account_id = ?
        AND saved_search_id IN (${placeholders})
        AND substr(used_at, 1, 7) = ?
      GROUP BY saved_search_id`,
  ).bind(lineAccountId, ...(ids.length ? sqlIdSet(ids).binds : []), savedSearchMonth(now)).all<SavedSearchUsageCount>();
  return new Map(result.results.map((row) => [
    row.saved_search_id,
    Number(row.call_count_this_month),
  ]));
}

/** 詳細の使用先ごとに、今月何回呼ばれたかを返す。 */
export async function getSavedSearchReferenceUsageCounts(
  db: D1Database,
  savedSearchIds: string[],
  lineAccountId: string,
  now = jstNow(),
): Promise<Map<string, number>> {
  const ids = [...new Set(savedSearchIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const placeholders = sqlIdSet(ids).sql;
  const result = await db.prepare(
    `SELECT saved_search_id, reference_kind, reference_id,
            COUNT(*) AS call_count_this_month
       FROM saved_search_usage_events
      WHERE line_account_id = ?
        AND saved_search_id IN (${placeholders})
        AND substr(used_at, 1, 7) = ?
      GROUP BY saved_search_id, reference_kind, reference_id`,
  ).bind(lineAccountId, ...(ids.length ? sqlIdSet(ids).binds : []), savedSearchMonth(now)).all<SavedSearchReferenceUsageCount>();
  return new Map(result.results.map((row) => [
    `${row.saved_search_id}:${row.reference_kind}:${row.reference_id ?? ''}`,
    Number(row.call_count_this_month),
  ]));
}
