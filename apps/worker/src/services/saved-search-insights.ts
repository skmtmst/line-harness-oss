import {
  validateSearchConditions,
  type SavedSearch,
} from '@line-crm/db';
import { compileSavedSearch } from './saved-search-filter.js';

export interface SavedSearchMatchInsight {
  matchCount: number | null;
  matchCountError: string | null;
}

/**
 * 保存した検索の該当人数を、友だち一覧と同じ条件評価器でまとめて数える。
 *
 * 0人と評価不能を分ける。壊れた条件を0人として返すと「対象はいない」と
 * 読まれ、条件の修正が後回しになるため、理由付きnullを返す。
 */
export async function getSavedSearchMatchInsights(
  db: D1Database,
  rows: SavedSearch[],
  lineAccountId: string,
): Promise<Map<string, SavedSearchMatchInsight>> {
  const output = new Map<string, SavedSearchMatchInsight>();
  const prepared: Array<{ id: string; statement: D1PreparedStatement }> = [];

  for (const row of rows) {
    let raw: unknown;
    try {
      raw = JSON.parse(row.conditions_json);
    } catch {
      output.set(row.id, { matchCount: null, matchCountError: '条件のJSONが壊れています' });
      continue;
    }
    const validated = validateSearchConditions(raw);
    if (!validated.ok) {
      output.set(row.id, { matchCount: null, matchCountError: validated.error });
      continue;
    }
    const compiled = compileSavedSearch(validated.value);
    if (!compiled.ok) {
      output.set(row.id, { matchCount: null, matchCountError: compiled.error });
      continue;
    }
    prepared.push({
      id: row.id,
      statement: db.prepare(
        `SELECT COUNT(DISTINCT f.id) AS total
           FROM friends f
          WHERE f.line_account_id = ? AND ${compiled.value.sql}`,
      ).bind(lineAccountId, ...compiled.value.binds),
    });
  }

  if (prepared.length === 0) return output;
  let results: D1Result<unknown>[];
  try {
    results = await db.batch(prepared.map((item) => item.statement));
  } catch {
    for (const item of prepared) {
      output.set(item.id, {
        matchCount: null,
        matchCountError: '該当人数を確認できませんでした',
      });
    }
    return output;
  }
  prepared.forEach((item, index) => {
    const result = results[index];
    const first = result?.results?.[0] as { total?: number | string } | undefined;
    if (!result?.success || first?.total === undefined) {
      output.set(item.id, { matchCount: null, matchCountError: '該当人数を確認できませんでした' });
      return;
    }
    output.set(item.id, { matchCount: Number(first.total), matchCountError: null });
  });
  return output;
}
