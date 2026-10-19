import { tagReadPredicate, type TagReadScope } from '../tag-lists.js';
import { type Tag } from './types.js';


/** D1実測：5項まで。6項で SQLITE_ERROR 7500。1項の余裕を確保する。 */
export const MAX_TAG_USAGE_COMPOUND_SELECT_TERMS = 4;

/**
 * 削除を妨げる運用設定からタグIDを読むSELECT。
 * 配列へ参照元を追加しても、下の組み立て処理が安全な項数へ自動分割する。
 */
export const TAG_USAGE_BLOCKING_REFERENCE_SELECTS = [
  'SELECT target_tag_id AS tag_id FROM broadcasts WHERE target_tag_id IS NOT NULL',
  `SELECT CAST(j.value AS TEXT) AS tag_id FROM broadcasts b,
     json_tree(CASE WHEN json_valid(b.segment_conditions) THEN b.segment_conditions ELSE 'null' END) j
    WHERE j.type = 'text'`,
  'SELECT on_submit_tag_id AS tag_id FROM forms WHERE on_submit_tag_id IS NOT NULL',
  `SELECT CAST(j.value AS TEXT) AS tag_id FROM forms f,
     json_tree(CASE WHEN json_valid(f.layout) THEN f.layout ELSE 'null' END) j WHERE j.type = 'text'`,
  `SELECT v.on_submit_tag_id AS tag_id FROM forms f
     JOIN form_versions v ON v.id = f.current_published_version_id
    WHERE v.on_submit_tag_id IS NOT NULL`,
  `SELECT CAST(j.value AS TEXT) AS tag_id FROM forms f
     JOIN form_versions v ON v.id = f.current_published_version_id,
     json_tree(CASE WHEN json_valid(v.layout) THEN v.layout ELSE 'null' END) j WHERE j.type = 'text'`,
  'SELECT trigger_tag_id AS tag_id FROM scenarios WHERE trigger_tag_id IS NOT NULL',
  `SELECT CAST(j.value AS TEXT) AS tag_id FROM scenarios s,
     json_tree(CASE WHEN json_valid(s.audience_condition_json) THEN s.audience_condition_json ELSE 'null' END) j
    WHERE j.type = 'text'`,
  'SELECT tag_id FROM scenario_triggers WHERE tag_id IS NOT NULL',
  'SELECT on_reach_tag_id AS tag_id FROM scenario_steps WHERE on_reach_tag_id IS NOT NULL',
  `SELECT CAST(j.value AS TEXT) AS tag_id FROM scenario_actions a,
     json_tree(CASE WHEN json_valid(a.config_json) THEN a.config_json ELSE 'null' END) j WHERE j.type = 'text'`,
  `SELECT CAST(j.value AS TEXT) AS tag_id FROM scenario_actions a,
     json_tree(CASE WHEN json_valid(a.condition_json) THEN a.condition_json ELSE 'null' END) j WHERE j.type = 'text'`,
  `SELECT CAST(j.value AS TEXT) AS tag_id FROM auto_replies a,
     json_tree(CASE WHEN json_valid(a.actions_json) THEN a.actions_json ELSE 'null' END) j
    WHERE j.type = 'text' AND a.deleted_at IS NULL`,
  `SELECT CAST(j.value AS TEXT) AS tag_id FROM auto_replies a,
     json_tree(CASE WHEN json_valid(a.friend_conditions_json) THEN a.friend_conditions_json ELSE 'null' END) j
    WHERE j.type = 'text' AND a.deleted_at IS NULL`,
  `SELECT CAST(j.value AS TEXT) AS tag_id FROM saved_searches s,
     json_tree(CASE WHEN json_valid(s.conditions_json) THEN s.conditions_json ELSE 'null' END) j WHERE j.type = 'text'`,
  ...[
    ['automation_versions', 'trigger_config'], ['automation_versions', 'condition_config'],
    ['automation_versions', 'action_config'], ['automations', 'conditions'], ['automations', 'actions'],
    ['common_action_versions', 'action_config'], ['rich_menu_groups', 'targeting_condition'],
    ['rich_menu_areas', 'tag_ids'], ['templates', 'carousel_actions_json'], ['funnels', 'segment_json'],
    ['funnel_steps', 'match_json'], ['analytics_funnel_versions', 'steps_json'],
    ['analytics_funnel_versions', 'segment_json'], ['analytics_funnel_versions', 'comparison_groups_json'],
  ].map(([table, column]) => `SELECT CAST(j.value AS TEXT) AS tag_id FROM ${table} r,
     json_tree(CASE WHEN json_valid(r.${column}) THEN r.${column} ELSE 'null' END) j WHERE j.type = 'text'`),
  'SELECT tag_on_attend AS tag_id FROM webinars WHERE tag_on_attend IS NOT NULL',
  'SELECT tag_on_cta_click AS tag_id FROM webinars WHERE tag_on_cta_click IS NOT NULL',
  'SELECT target_tag_id AS tag_id FROM reminders WHERE target_tag_id IS NOT NULL AND deleted_at IS NULL',
  'SELECT tag_id FROM entry_routes WHERE tag_id IS NOT NULL',
  'SELECT tag_id FROM tracked_links WHERE tag_id IS NOT NULL',
  'SELECT auto_tag_id AS tag_id FROM menus WHERE auto_tag_id IS NOT NULL',
  'SELECT tag_id FROM affiliate_offers WHERE tag_id IS NOT NULL',
  'SELECT visible_tag_id AS tag_id FROM events WHERE visible_tag_id IS NOT NULL',
  `SELECT CAST(j.value AS TEXT) AS tag_id FROM account_settings s,
     json_tree(CASE WHEN json_valid(s.value) THEN s.value ELSE 'null' END) j
    WHERE s.key = 'friend_add_routing' AND j.type = 'text'`,
] as const;

export function buildTagUsageBlockingReferenceQueries(
  selects: readonly string[] = TAG_USAGE_BLOCKING_REFERENCE_SELECTS,
): string[] {
  const queries: string[] = [];
  for (let offset = 0; offset < selects.length; offset += MAX_TAG_USAGE_COMPOUND_SELECT_TERMS) {
    const referenceSelects = selects
      .slice(offset, offset + MAX_TAG_USAGE_COMPOUND_SELECT_TERMS)
      .join('\nUNION\n');
    queries.push(`SELECT DISTINCT r.tag_id
      FROM (${referenceSelects}) r
      JOIN tags known ON known.id = r.tag_id`);
  }
  return queries;
}

export async function collectTagUsageBlockingTagIds(
  db: D1Database,
  selects: readonly string[] = TAG_USAGE_BLOCKING_REFERENCE_SELECTS,
  scope?: TagReadScope,
): Promise<Set<string>> {
  const predicate = tagReadPredicate(scope, 'known');
  const blockingTagIds = new Set<string>();
  for (const query of buildTagUsageBlockingReferenceQueries(selects)) {
    const references = await db.prepare(`${query} WHERE ${predicate.sql}`)
      .bind(...predicate.binds).all<{ tag_id: string | null }>();
    for (const reference of references.results) {
      if (reference.tag_id !== null) blockingTagIds.add(reference.tag_id);
    }
  }
  return blockingTagIds;
}

/**
 * 見た目だけ違う同名タグをまとめて見つけるための比較名。
 *
 * 保存している名前自体は変えない。全角英数字・全角空白、前後や連続する空白、
 * 大文字小文字だけを比較時にそろえる。
 */
export function normalizeTagNameForCleanup(name: string): string {
  return name
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('ja-JP');
}

/** Find an equal comparison name, including rows created before normalized_name. */
export async function findTagByNormalizedName(
  db: D1Database,
  name: string,
  lineAccountId: string | null,
  excludeId?: string,
): Promise<Tag | null> {
  const normalizedName = normalizeTagNameForCleanup(name);
  const rows = await db.prepare(
    `SELECT * FROM tags
      WHERE line_account_id IS ?
        AND (normalized_name = ? OR normalized_name IS NULL)
      ORDER BY id`,
  ).bind(lineAccountId, normalizedName).all<Tag>();
  return (rows.results ?? []).find((row) =>
    row.id !== excludeId
    && (row.normalized_name === normalizedName
      || (row.normalized_name === null
        && normalizeTagNameForCleanup(row.name) === normalizedName))) ?? null;
}

export function tagNameConflict(): Error {
  // Existing route contracts map SQLite UNIQUE errors to HTTP 409.
  return new Error('UNIQUE constraint failed: tags normalized name');
}

export async function assertTagNameAvailable(
  db: D1Database,
  name: string,
  lineAccountId: string | null,
  excludeId?: string,
): Promise<void> {
  if (await findTagByNormalizedName(db, name, lineAccountId, excludeId)) {
    throw tagNameConflict();
  }
}
