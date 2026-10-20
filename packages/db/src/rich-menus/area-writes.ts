import { type RichMenuGroup } from './types.js';


// tag_ids は JSON 文字列で持つ。壊れた値が入っていても画面を落とさない。
export function parseRichMenuTagIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

export async function getRichMenuGroups(
  db: D1Database,
  accountId: string,
): Promise<RichMenuGroup[]> {
  const result = await db
    .prepare(
      // 自分で決めた並び順が先。同じなら更新の新しい順（これまでの並び）。
      `SELECT * FROM rich_menu_groups WHERE account_id = ?
        ORDER BY display_order ASC, updated_at DESC`,
    )
    .bind(accountId)
    .all<RichMenuGroup>();
  return result.results ?? [];
}

export async function getRichMenuCurrentAudience(
  db: D1Database,
  accountId: string,
  groupId: string,
  isDefaultForAll: boolean,
): Promise<number> {
  const row = isDefaultForAll
    ? await db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM friends f
           LEFT JOIN rich_menu_assignments current
             ON current.line_account_id = ? AND current.friend_id = f.id
          WHERE f.line_account_id = ?
            AND f.is_following = 1
            AND (current.id IS NULL OR current.group_id = ?)`,
      )
      .bind(accountId, accountId, groupId)
      .first<{ count: number }>()
    : await db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM rich_menu_assignments current
           JOIN friends f ON f.id = current.friend_id
          WHERE current.line_account_id = ?
            AND current.group_id = ?
            AND f.is_following = 1`,
      )
      .bind(accountId, groupId)
      .first<{ count: number }>();
  return Number(row?.count ?? 0);
}
