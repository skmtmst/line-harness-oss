import { type RichMenuTargetingCandidate } from './types.js';


/**
 * 出し分けの候補を、見る順に返す。
 *
 * 条件が入っていて、有効で、LINE に登録済み（1ページ目の richmenu がある）
 * ものだけ。下書きのメニューを出そうとしても LINE 側に実体が無いので、
 * ここで落としておく。
 */
export async function getRichMenuTargetingCandidates(
  db: D1Database,
  accountId: string,
): Promise<RichMenuTargetingCandidate[]> {
  const rows = await db
    .prepare(
      `SELECT g.id                 AS group_id,
              g.name               AS name,
              g.targeting_priority AS priority,
              g.targeting_condition AS condition,
              p.line_richmenu_id   AS line_richmenu_id
         FROM rich_menu_groups g
         JOIN rich_menu_pages  p ON p.group_id = g.id AND p.order_index = 0
        WHERE g.account_id = ?
          AND g.targeting_enabled = 1
          AND g.targeting_condition IS NOT NULL
          AND g.status = 'published'
          AND p.line_richmenu_id IS NOT NULL
        ORDER BY g.targeting_priority ASC, g.created_at ASC`,
    )
    .bind(accountId)
    .all<{
      group_id: string;
      name: string;
      priority: number;
      condition: string;
      line_richmenu_id: string | null;
    }>();
  return (rows.results ?? []).map((r) => ({
    groupId: r.group_id,
    name: r.name,
    priority: r.priority,
    condition: r.condition,
    lineRichMenuId: r.line_richmenu_id,
  }));
}

/** 出し分けの条件を持つメニューの数。一覧の見出しに出す。 */
export async function countRichMenuTargetingRules(
  db: D1Database,
  accountId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM rich_menu_groups
        WHERE account_id = ? AND targeting_enabled = 1 AND targeting_condition IS NOT NULL`,
    )
    .bind(accountId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// =============================================================================
// N-163: ボタン名（area.label）まで届く一覧検索
// =============================================================================

/**
 * 一覧検索の比較形。大小文字と空白（半角・全角）を揃えてから部分一致させる。
 * メニュー名・トークバー文言（TS側で includes 比較）とボタン名（SQL側で
 * 同じ正規化を再現）が同じ基準で当たるように、ここ1か所で決める。
 */
export function normalizeRichMenuSearchText(value: string): string {
  return value.toLowerCase().replace(/[\s　]+/g, '');
}

/** LIKE のワイルドカードを持ち込まないよう、検索語をリテラル扱いにする。 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * ボタン名（area.label）が正規化クエリに部分一致する group の id 一覧。
 * account の境目はここで絞る。別アカウントのボタン名が検索に混ざらない。
 */
export async function listRichMenuGroupIdsByAreaLabel(
  db: D1Database,
  accountId: string,
  normalizedQuery: string,
): Promise<Set<string>> {
  if (!normalizedQuery) return new Set();
  const rows = await db
    .prepare(
      `SELECT DISTINCT p.group_id AS group_id
         FROM rich_menu_areas a
         JOIN rich_menu_pages  p ON p.id = a.page_id
         JOIN rich_menu_groups g ON g.id = p.group_id
        WHERE g.account_id = ?
          AND a.label IS NOT NULL
          AND REPLACE(REPLACE(LOWER(a.label), ' ', ''), '　', '')
              LIKE '%' || ? || '%' ESCAPE '\\'`,
    )
    .bind(accountId, escapeLikePattern(normalizedQuery))
    .all<{ group_id: string }>();
  return new Set((rows.results ?? []).map((row) => row.group_id));
}
