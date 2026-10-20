import { sqlIdSet } from './id-queries.js';
import type { Tag, TagWithCount } from './tags/types/index.js';

export interface TagReadScope {
  allowedAccountIds: string[];
  canSeeUnassigned: boolean;
}

export function tagReadPredicate(scope?: TagReadScope, alias: 't' | 'known' = 't'): { sql: string; binds: string[] } {
  if (!scope) return { sql: '1 = 1', binds: [] };
  const accounts = sqlIdSet(scope.allowedAccountIds);
  return {
    sql: `(${alias}.line_account_id IN (${accounts.sql})${scope.canSeeUnassigned ? ` OR ${alias}.line_account_id IS NULL` : ''})`,
    binds: accounts.binds,
  };
}

export async function getTags(db: D1Database, scope?: TagReadScope): Promise<Tag[]> {
  const predicate = tagReadPredicate(scope);
  const result = await db
    .prepare(
      `SELECT t.*, fo.color AS folder_color
       FROM tags t
       LEFT JOIN folders fo ON fo.id = t.folder_id
       WHERE ${predicate.sql}
       ORDER BY t.name ASC, t.id ASC`,
    )
    .bind(...predicate.binds)
    .all<Tag>();
  return result.results;
}

export async function getTagsWithCounts(
  db: D1Database,
  scope?: TagReadScope,
): Promise<TagWithCount[]> {
  const predicate = tagReadPredicate(scope);
  const result = await db
    .prepare(
      `SELECT t.*, fo.color AS folder_color, COUNT(ft.friend_id) AS friend_count
       FROM tags t
       LEFT JOIN friend_tags ft ON ft.tag_id = t.id
       LEFT JOIN folders fo ON fo.id = t.folder_id
       WHERE ${predicate.sql}
       GROUP BY t.id
       -- 入れ替えたものが先。触っていないものは全部 0 なので、
       -- そのあとの付与人数と名前で並ぶ（設計の既定は付与人数が多い順）。
       ORDER BY t.display_order ASC, friend_count DESC, t.name ASC, t.id ASC`,
    )
    .bind(...predicate.binds)
    .all<TagWithCount>();
  return result.results;
}
