import { jstNow } from './utils.js';
import { enqueueMileageEvent } from './mileage.js';
export interface Tag {
  id: string;
  name: string;
  color: string;
  /**
   * @deprecated 099 で folders へ移送済み。folder_id を見ること。
   * 追加のみポリシーで列を落とせないため残っているだけで、読み書きしない。
   */
  group_id: string | null;
  /** 所属する分類。folders(kind='tag') の id */
  folder_id: string | null;
  mileage_reward: number;
  referral_mileage_reward: number;
  mileage_multiplier_bps: number | null;
  mileage_multiplier_priority: number;
  /** 友だち一覧の「★つきタグ」列に出すか。0 / 1（111 で追加） */
  is_starred: number;
  /** 一覧での並び順。小さいほど上（112 で追加） */
  display_order: number;
  created_at: string;
  /**
   * 属するフォルダの色（#RRGGBB）。folders.color を読んだもので、tags 側に
   * 保存はしない。
   *
   * 画面に出す印の色はこれ。タグ1つずつに色を持たせると、100枚あるタグで
   * 色がばらけて一覧での区別に使えなくなる。色はフォルダに1つだけ付けて、
   * 中のタグはそれを写す。JOIN していない読み方では undefined になる。
   */
  folder_color?: string | null;
}

/**
 * タグの分類。
 *
 * 099 で folders(kind='tag') へ移送した。形は変えずに、中で見るテーブルだけ
 * 差し替えている（画面とAPIの経路はそのまま）。sort_order は
 * folders.display_order を写したもの。
 */
export interface TagGroup {
  id: string;
  name: string;
  sort_order: number;
  /** #RRGGBB。未設定は null。115 で folders.color を足した。 */
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface FriendTag {
  friend_id: string;
  tag_id: string;
  assigned_at: string;
}

export async function getTags(db: D1Database): Promise<Tag[]> {
  const result = await db
    .prepare(
      `SELECT t.*, fo.color AS folder_color
       FROM tags t
       LEFT JOIN folders fo ON fo.id = t.folder_id
       ORDER BY t.name ASC`,
    )
    .all<Tag>();
  return result.results;
}

export interface TagWithCount extends Tag {
  friend_count: number;
}

export type TagCleanupReason = 'unused' | 'duplicate_name';

export type TagAssignSource =
  | 'ec'
  | 'line_login'
  | 'form'
  | 'ec_purchase'
  | 'manual'
  | 'birthday';

export interface TagWithUsage extends TagWithCount {
  assign_source: TagAssignSource | null;
  used_in_broadcasts: number;
  used_in_forms: number;
  used_in_scenarios: number;
  used_in_auto_replies: number;
  used_in_saved_searches: number;
  other_action_count: number;
  /** 一覧の「整理候補」に入る理由。複数理由でもタグ自体は1件として数える。 */
  cleanup_reasons: TagCleanupReason[];
}

type TagWithUsageRow = Omit<TagWithUsage, 'cleanup_reasons'>;

type TagUsageCountRow = {
  tag_id: string;
  count: number;
};

type TagUsageReferenceRow = {
  tag_id: string;
  entity_id: string;
};

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
     json_tree(CASE WHEN json_valid(a.actions_json) THEN a.actions_json ELSE 'null' END) j WHERE j.type = 'text'`,
  `SELECT CAST(j.value AS TEXT) AS tag_id FROM auto_replies a,
     json_tree(CASE WHEN json_valid(a.friend_conditions_json) THEN a.friend_conditions_json ELSE 'null' END) j
    WHERE j.type = 'text'`,
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
): Promise<Set<string>> {
  const blockingTagIds = new Set<string>();
  for (const query of buildTagUsageBlockingReferenceQueries(selects)) {
    const references = await db.prepare(query).all<{ tag_id: string | null }>();
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

export async function getTagsWithCounts(
  db: D1Database,
): Promise<TagWithCount[]> {
  const result = await db
    .prepare(
      `SELECT t.*, fo.color AS folder_color, COUNT(ft.friend_id) AS friend_count
       FROM tags t
       LEFT JOIN friend_tags ft ON ft.tag_id = t.id
       LEFT JOIN folders fo ON fo.id = t.folder_id
       GROUP BY t.id
       -- 入れ替えたものが先。触っていないものは全部 0 なので、
       -- そのあとの付与人数と名前で並ぶ（設計の既定は付与人数が多い順）。
       ORDER BY t.display_order ASC, friend_count DESC, t.name ASC`,
    )
    .all<TagWithCount>();
  return result.results;
}

/**
 * タグ一覧の「どこで使われているか」を返す。
 *
 * JSON列は部分一致で探さない。たとえば tag-1 を探すときに tag-10 まで
 * 数えてしまうため、json_tree の文字列値とタグIDが完全一致した行だけを見る。
 * 壊れた旧JSONは「参照なし」とし、一覧全体を500にしない。
 *
 * assign_source は、現在のデータから出どころを断定できるものだけを返す。
 * friend_tags には付与元が残っていないので、一般タグを manual と推測しない。
 */
export async function getTagsWithUsage(
  db: D1Database,
): Promise<TagWithUsage[]> {
  const result = await db.prepare(
    `SELECT t.*, fo.color AS folder_color,
            COUNT(DISTINCT ft.friend_id) AS friend_count
       FROM tags t
       LEFT JOIN friend_tags ft ON ft.tag_id = t.id
       LEFT JOIN folders fo ON fo.id = t.folder_id
      GROUP BY t.id
      ORDER BY t.display_order ASC, friend_count DESC, t.name ASC`,
  ).all<Omit<TagWithUsageRow,
    'assign_source' | 'used_in_broadcasts' | 'used_in_forms' |
    'used_in_scenarios' | 'used_in_auto_replies' |
    'used_in_saved_searches' | 'other_action_count'>>();

  const scenarioReferenceSelects = [
    'SELECT trigger_tag_id AS tag_id, id AS entity_id FROM scenarios WHERE trigger_tag_id IS NOT NULL',
    `SELECT CAST(j.value AS TEXT) AS tag_id, s.id AS entity_id
       FROM scenarios s,
            json_tree(CASE WHEN json_valid(s.audience_condition_json)
                           THEN s.audience_condition_json ELSE 'null' END) j
      WHERE j.type = 'text'`,
    'SELECT tag_id, scenario_id AS entity_id FROM scenario_triggers WHERE tag_id IS NOT NULL',
    `SELECT on_reach_tag_id AS tag_id, scenario_id AS entity_id
       FROM scenario_steps WHERE on_reach_tag_id IS NOT NULL`,
    `SELECT CAST(j.value AS TEXT) AS tag_id, a.scenario_id AS entity_id
       FROM scenario_actions a,
            json_tree(CASE WHEN json_valid(a.config_json)
                           THEN a.config_json ELSE 'null' END) j
      WHERE j.type = 'text'`,
    `SELECT CAST(j.value AS TEXT) AS tag_id, a.scenario_id AS entity_id
       FROM scenario_actions a,
            json_tree(CASE WHEN json_valid(a.condition_json)
                           THEN a.condition_json ELSE 'null' END) j
      WHERE j.type = 'text'`,
  ] as const;
  const scenarioReferenceQueries: string[] = [];
  for (let offset = 0; offset < scenarioReferenceSelects.length;
    offset += MAX_TAG_USAGE_COMPOUND_SELECT_TERMS) {
    const references = scenarioReferenceSelects
      .slice(offset, offset + MAX_TAG_USAGE_COMPOUND_SELECT_TERMS)
      .join('\nUNION\n');
    scenarioReferenceQueries.push(`WITH refs(tag_id, entity_id) AS (${references})
      SELECT DISTINCT r.tag_id, r.entity_id
        FROM refs r JOIN tags known ON known.id = r.tag_id`);
  }

  const usageQueries = {
    used_in_broadcasts: `WITH refs(tag_id, entity_id) AS (
         SELECT target_tag_id, id FROM broadcasts WHERE target_tag_id IS NOT NULL
         UNION
         SELECT CAST(j.value AS TEXT), b.id
           FROM broadcasts b,
                json_tree(CASE WHEN json_valid(b.segment_conditions)
                               THEN b.segment_conditions ELSE 'null' END) j
          WHERE j.type = 'text'
       )`,
    used_in_forms: `WITH refs(tag_id, entity_id) AS (
         SELECT on_submit_tag_id, id FROM forms WHERE on_submit_tag_id IS NOT NULL
         UNION
         SELECT CAST(j.value AS TEXT), f.id
           FROM forms f,
                json_tree(CASE WHEN json_valid(f.layout) THEN f.layout ELSE 'null' END) j
          WHERE j.type = 'text'
       )`,
    used_in_auto_replies: `WITH refs(tag_id, entity_id) AS (
         SELECT CAST(j.value AS TEXT), a.id
           FROM auto_replies a,
                json_tree(CASE WHEN json_valid(a.actions_json)
                               THEN a.actions_json ELSE 'null' END) j
          WHERE j.type = 'text'
         UNION
         SELECT CAST(j.value AS TEXT), a.id
           FROM auto_replies a,
                json_tree(CASE WHEN json_valid(a.friend_conditions_json)
                               THEN a.friend_conditions_json ELSE 'null' END) j
          WHERE j.type = 'text'
       )`,
    used_in_saved_searches: `WITH refs(tag_id, entity_id) AS (
         SELECT CAST(j.value AS TEXT), s.id
           FROM saved_searches s,
                json_tree(CASE WHEN json_valid(s.conditions_json)
                               THEN s.conditions_json ELSE 'null' END) j
          WHERE s.scope = 'friends' AND j.type = 'text'
       )`,
    other_action_count: `WITH refs(tag_id, action_key) AS (
         -- 「他N」は、このタグを付ける設定ではなく、このタグが付いた後に
         -- 動くもの。旧列と複数トリガー表の両方に同じシナリオがあっても、
         -- action_key を同じにして1件だけ数える。
         SELECT trigger_tag_id, 'scenario:' || id
           FROM scenarios
          WHERE trigger_type = 'tag_added' AND trigger_tag_id IS NOT NULL
         UNION
         SELECT tag_id, 'scenario:' || scenario_id
           FROM scenario_triggers
          WHERE kind = 'tag_added' AND tag_id IS NOT NULL
         UNION
         -- 公開中のV6自動化は、tag_change の条件にタグIDがあり、かつ
         -- 実際に実行するアクションがある場合だけ。配列の1要素を1件とする。
         SELECT CAST(trigger_value.value AS TEXT),
                'automation:' || d.id || ':' || action.key
           FROM automation_definitions d
           JOIN automation_versions v
             ON v.id = d.current_published_version_id
            AND v.automation_id = d.id
            AND v.status = 'published',
                json_tree(CASE WHEN json_valid(v.trigger_config)
                               THEN v.trigger_config ELSE 'null' END) trigger_value,
                json_each(CASE
                  WHEN json_valid(v.action_config)
                   AND json_type(CASE WHEN json_valid(v.action_config)
                                      THEN v.action_config ELSE 'null' END) = 'array'
                  THEN v.action_config ELSE '[]' END) action
          WHERE v.trigger_type = 'tag_change'
            AND trigger_value.type = 'text'
         UNION
         -- 旧自動化も、タグ変更の条件にIDが明記され、actions が配列のとき
         -- だけ数える。付与元を記録していない行から推測はしない。
         SELECT CAST(condition_value.value AS TEXT),
                'legacy-automation:' || a.id || ':' || action.key
           FROM automations a,
                json_tree(CASE WHEN json_valid(a.conditions)
                               THEN a.conditions ELSE 'null' END) condition_value,
                json_each(CASE
                  WHEN json_valid(a.actions)
                   AND json_type(CASE WHEN json_valid(a.actions)
                                      THEN a.actions ELSE 'null' END) = 'array'
                  THEN a.actions ELSE '[]' END) action
          WHERE a.event_type IN ('tag_change', 'tag_added')
            AND condition_value.type = 'text'
       )`,
  } as const;

  type UsageField = keyof typeof usageQueries | 'used_in_scenarios';
  const usageCounts = new Map<UsageField, Map<string, number>>();
  for (const [field, refsQuery] of Object.entries(usageQueries) as
    [keyof typeof usageQueries, string][]) {
    const distinctKey = field === 'other_action_count' ? 'action_key' : 'entity_id';
    const counts = await db.prepare(`${refsQuery}
      SELECT r.tag_id, COUNT(DISTINCT r.${distinctKey}) count
        FROM refs r JOIN tags known ON known.id = r.tag_id
       GROUP BY r.tag_id`).all<TagUsageCountRow>();
    usageCounts.set(field, new Map(
      counts.results.map((row) => [row.tag_id, Number(row.count)]),
    ));
  }

  const scenarioReferences = new Map<string, Set<string>>();
  for (const query of scenarioReferenceQueries) {
    const references = await db.prepare(query).all<TagUsageReferenceRow>();
    for (const reference of references.results) {
      const entityIds = scenarioReferences.get(reference.tag_id) ?? new Set<string>();
      entityIds.add(reference.entity_id);
      scenarioReferences.set(reference.tag_id, entityIds);
    }
  }
  usageCounts.set('used_in_scenarios', new Map(
    [...scenarioReferences].map(([tagId, entityIds]) => [tagId, entityIds.size]),
  ));

  const rows: TagWithUsageRow[] = result.results.map((tag) => {
    const usedInForms = usageCounts.get('used_in_forms')?.get(tag.id) ?? 0;
    const normalizedId = tag.id.toLocaleLowerCase('en-US');
    let assignSource: TagAssignSource | null = null;
    if ([
      'nen-tag-pet-birthday-this-month',
      'nen-tag-pet-birthday-next-month',
      'nen-tag-delivery-birthday',
    ].includes(tag.id)) assignSource = 'birthday';
    else if (tag.id === 'nen-tag-member-line-linked') assignSource = 'line_login';
    else if (/^nen-tag-(purchase|payment|product)-/u.test(normalizedId)) assignSource = 'ec_purchase';
    else if (/^nen-tag-(member|subscription)-/u.test(normalizedId)) assignSource = 'ec';
    else if (usedInForms > 0) assignSource = 'form';

    return {
      ...tag,
      friend_count: Number(tag.friend_count),
      assign_source: assignSource,
      used_in_broadcasts: usageCounts.get('used_in_broadcasts')?.get(tag.id) ?? 0,
      used_in_forms: usedInForms,
      used_in_scenarios: usageCounts.get('used_in_scenarios')?.get(tag.id) ?? 0,
      used_in_auto_replies: usageCounts.get('used_in_auto_replies')?.get(tag.id) ?? 0,
      used_in_saved_searches: usageCounts.get('used_in_saved_searches')?.get(tag.id) ?? 0,
      other_action_count: usageCounts.get('other_action_count')?.get(tag.id) ?? 0,
    };
  });

  const blockingTagIds = await collectTagUsageBlockingTagIds(db);

  const duplicateCounts = new Map<string, number>();
  for (const row of rows) {
    const normalizedName = normalizeTagNameForCleanup(row.name);
    duplicateCounts.set(normalizedName, (duplicateCounts.get(normalizedName) ?? 0) + 1);
  }

  return rows.map((row) => {
    const cleanupReasons: TagCleanupReason[] = [];
    if (Number(row.friend_count) === 0 && !blockingTagIds.has(row.id)) {
      cleanupReasons.push('unused');
    }
    if ((duplicateCounts.get(normalizeTagNameForCleanup(row.name)) ?? 0) > 1) {
      cleanupReasons.push('duplicate_name');
    }
    return { ...row, cleanup_reasons: cleanupReasons };
  });
}

export interface TagDeleteImpactReferences {
  broadcasts: number;
  forms: number;
  scenarios: number;
  autoReplies: number;
  savedSearches: number;
  automations: number;
  commonActions: number;
  richMenus: number;
  templates: number;
  webinars: number;
  reminders: number;
  entryRoutes: number;
  trackedLinks: number;
  bookingMenus: number;
  affiliateOffers: number;
  events: number;
  analyticsFunnels: number;
  friendAddSettings: number;
}

export interface TagDeleteImpact {
  tag: Pick<Tag, 'id' | 'name'>;
  /** タグを外される友だちの人数。運用設定とは分けて表示する。 */
  friendCount: number;
  /** このタグIDを現在も保存している運用設定の件数。 */
  references: TagDeleteImpactReferences;
  blockingReferenceCount: number;
  canDelete: boolean;
}

type TagDeleteImpactRow = {
  id: string;
  name: string;
  friend_count: number;
  broadcasts: number;
  forms: number;
  scenarios: number;
  auto_replies: number;
  saved_searches: number;
  automations: number;
  common_actions: number;
  rich_menus: number;
  templates: number;
  webinars: number;
  reminders: number;
  entry_routes: number;
  tracked_links: number;
  booking_menus: number;
  affiliate_offers: number;
  events: number;
  analytics_funnels: number;
  friend_add_settings: number;
};

/**
 * タグを消す前に、友だちへの付与と運用設定への参照を1回の読み取りで調べる。
 *
 * 直接の外部キーだけでなく、条件・アクションとしてJSONに保存されたタグIDも
 * 完全一致で数える。壊れた旧JSONは参照なしとして扱い、確認画面自体を500に
 * しない。実行履歴は運用設定ではないため数えない。
 */
export async function getTagDeleteImpact(
  db: D1Database,
  tagId: string,
): Promise<TagDeleteImpact | null> {
  const row = await db.prepare(
    `WITH target AS (
       SELECT id, name FROM tags WHERE id = ?
     ),
     scenario_refs(entity_id) AS (
       SELECT s.id FROM scenarios s, target t
        WHERE s.trigger_tag_id = t.id
           OR EXISTS (
             SELECT 1 FROM json_tree(CASE WHEN json_valid(s.audience_condition_json)
                                          THEN s.audience_condition_json ELSE 'null' END) j
              WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
           )
       UNION
       SELECT st.scenario_id FROM scenario_triggers st, target t WHERE st.tag_id = t.id
       UNION
       SELECT ss.scenario_id FROM scenario_steps ss, target t WHERE ss.on_reach_tag_id = t.id
       UNION
       SELECT sa.scenario_id FROM scenario_actions sa, target t
        WHERE EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(sa.config_json)
                                       THEN sa.config_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        ) OR EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(sa.condition_json)
                                       THEN sa.condition_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        )
     ),
     automation_refs(entity_id) AS (
       SELECT 'v6:' || v.automation_id
         FROM automation_versions v, target t
        WHERE EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(v.trigger_config)
                                       THEN v.trigger_config ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        ) OR EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(v.condition_config)
                                       THEN v.condition_config ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        ) OR EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(v.action_config)
                                       THEN v.action_config ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        )
       UNION
       SELECT 'legacy:' || a.id FROM automations a, target t
        WHERE EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(a.conditions)
                                       THEN a.conditions ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        ) OR EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(a.actions)
                                       THEN a.actions ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        )
     ),
     rich_menu_refs(entity_id) AS (
       SELECT g.id FROM rich_menu_groups g, target t
        WHERE EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(g.targeting_condition)
                                       THEN g.targeting_condition ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        )
       UNION
       SELECT p.group_id
         FROM rich_menu_areas a
         JOIN rich_menu_pages p ON p.id = a.page_id
         CROSS JOIN target t
        WHERE EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(a.tag_ids)
                                       THEN a.tag_ids ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        )
     ),
     analytics_funnel_refs(entity_id) AS (
       SELECT f.id FROM funnels f, target t
        WHERE EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(f.segment_json)
                                       THEN f.segment_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        )
       UNION
       SELECT fs.funnel_id FROM funnel_steps fs, target t
        WHERE EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(fs.match_json)
                                       THEN fs.match_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        )
       UNION
       SELECT v.funnel_id FROM analytics_funnel_versions v, target t
        WHERE EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(v.steps_json)
                                       THEN v.steps_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        ) OR EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(v.segment_json)
                                       THEN v.segment_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        ) OR EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(v.comparison_groups_json)
                                       THEN v.comparison_groups_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
        )
     )
     SELECT t.id, t.name,
            (SELECT COUNT(*) FROM friend_tags ft WHERE ft.tag_id = t.id) AS friend_count,
            (SELECT COUNT(*) FROM broadcasts b
              WHERE b.target_tag_id = t.id OR EXISTS (
                SELECT 1 FROM json_tree(CASE WHEN json_valid(b.segment_conditions)
                                             THEN b.segment_conditions ELSE 'null' END) j
                 WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
              )) AS broadcasts,
            (SELECT COUNT(*) FROM forms f
              WHERE f.on_submit_tag_id = t.id OR EXISTS (
                SELECT 1 FROM json_tree(CASE WHEN json_valid(f.layout)
                                             THEN f.layout ELSE 'null' END) j
                 WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
              )) AS forms,
            (SELECT COUNT(*) FROM scenario_refs) AS scenarios,
            (SELECT COUNT(*) FROM auto_replies a WHERE EXISTS (
              SELECT 1 FROM json_tree(CASE WHEN json_valid(a.actions_json)
                                           THEN a.actions_json ELSE 'null' END) j
               WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
            ) OR EXISTS (
              SELECT 1 FROM json_tree(CASE WHEN json_valid(a.friend_conditions_json)
                                           THEN a.friend_conditions_json ELSE 'null' END) j
               WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
            )) AS auto_replies,
            (SELECT COUNT(*) FROM saved_searches s WHERE EXISTS (
              SELECT 1 FROM json_tree(CASE WHEN json_valid(s.conditions_json)
                                           THEN s.conditions_json ELSE 'null' END) j
               WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
            )) AS saved_searches,
            (SELECT COUNT(*) FROM automation_refs) AS automations,
            (SELECT COUNT(DISTINCT v.common_action_id)
               FROM common_action_versions v WHERE EXISTS (
                 SELECT 1 FROM json_tree(CASE WHEN json_valid(v.action_config)
                                              THEN v.action_config ELSE 'null' END) j
                  WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
               )) AS common_actions,
            (SELECT COUNT(*) FROM rich_menu_refs) AS rich_menus,
            (SELECT COUNT(*) FROM templates mt WHERE EXISTS (
              SELECT 1 FROM json_tree(CASE WHEN json_valid(mt.carousel_actions_json)
                                           THEN mt.carousel_actions_json ELSE 'null' END) j
               WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
            )) AS templates,
            (SELECT COUNT(*) FROM webinars w
              WHERE w.tag_on_attend = t.id OR w.tag_on_cta_click = t.id) AS webinars,
            (SELECT COUNT(*) FROM reminders r WHERE r.target_tag_id = t.id AND r.deleted_at IS NULL) AS reminders,
            (SELECT COUNT(*) FROM entry_routes er WHERE er.tag_id = t.id) AS entry_routes,
            (SELECT COUNT(*) FROM tracked_links tl WHERE tl.tag_id = t.id) AS tracked_links,
            (SELECT COUNT(*) FROM menus m WHERE m.auto_tag_id = t.id) AS booking_menus,
            (SELECT COUNT(*) FROM affiliate_offers ao WHERE ao.tag_id = t.id) AS affiliate_offers,
            (SELECT COUNT(*) FROM events e WHERE e.visible_tag_id = t.id) AS events,
            (SELECT COUNT(*) FROM analytics_funnel_refs) AS analytics_funnels,
            (SELECT COUNT(*) FROM account_settings s
              WHERE s.key = 'friend_add_routing' AND EXISTS (
                SELECT 1 FROM json_tree(CASE WHEN json_valid(s.value)
                                             THEN s.value ELSE 'null' END) j
                 WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
              )) AS friend_add_settings
       FROM target t`,
  ).bind(tagId).first<TagDeleteImpactRow>();

  if (!row) return null;

  const references: TagDeleteImpactReferences = {
    broadcasts: Number(row.broadcasts),
    forms: Number(row.forms),
    scenarios: Number(row.scenarios),
    autoReplies: Number(row.auto_replies),
    savedSearches: Number(row.saved_searches),
    automations: Number(row.automations),
    commonActions: Number(row.common_actions),
    richMenus: Number(row.rich_menus),
    templates: Number(row.templates),
    webinars: Number(row.webinars),
    reminders: Number(row.reminders),
    entryRoutes: Number(row.entry_routes),
    trackedLinks: Number(row.tracked_links),
    bookingMenus: Number(row.booking_menus),
    affiliateOffers: Number(row.affiliate_offers),
    events: Number(row.events),
    analyticsFunnels: Number(row.analytics_funnels),
    friendAddSettings: Number(row.friend_add_settings),
  };
  const blockingReferenceCount = Object.values(references)
    .reduce((sum, count) => sum + count, 0);

  return {
    tag: { id: row.id, name: row.name },
    friendCount: Number(row.friend_count),
    references,
    blockingReferenceCount,
    canDelete: blockingReferenceCount === 0,
  };
}

export interface CreateTagInput {
  name: string;
  color?: string;
  groupId?: string | null;
}

export interface CreateTagsBulkInput {
  name: string;
  groupId?: string | null;
}

export interface CreateTagsBulkResult {
  status: 'created' | 'skipped' | 'failed';
  tagId?: string;
}

// D1 は1文につき100個までしか値を束縛できない。このINSERTは1行4個なので、
// 25行でちょうど100個。500行でも20文に収まり、無料枠の1実行50クエリを超えない。
const TAGS_PER_BULK_INSERT = 25;

export async function createTag(
  db: D1Database,
  input: CreateTagInput,
): Promise<Tag> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const color = input.color ?? '#3B82F6';

  await db
    .prepare(
      // group_id は書かない。folders が正で、group_id は移送前の名残。
      `INSERT INTO tags (id, name, color, folder_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, input.name, color, input.groupId ?? null, now)
    .run();

  return (await db
    .prepare(`SELECT * FROM tags WHERE id = ?`)
    .bind(id)
    .first<Tag>())!;
}

/**
 * CSVからのタグ登録を、D1の1実行あたりのクエリ上限内でまとめて書く。
 *
 * - idを先に作り、RETURNINGで実際に入った行だけを判別する。
 * - 同名が先に作られた行はINSERT OR IGNOREで見送りにする。
 * - 確認後にフォルダが消えた場合は、外部キー違反にせず未分類で登録する。
 * - 1文が失敗しても、ほかの25行単位の文は続ける。
 */
export async function createTagsBulk(
  db: D1Database,
  inputs: CreateTagsBulkInput[],
): Promise<CreateTagsBulkResult[]> {
  const results: CreateTagsBulkResult[] = Array.from(
    { length: inputs.length },
    () => ({ status: 'failed' }),
  );
  const now = jstNow();

  for (let offset = 0; offset < inputs.length; offset += TAGS_PER_BULK_INSERT) {
    const chunk = inputs.slice(offset, offset + TAGS_PER_BULK_INSERT);
    const prepared = chunk.map((input) => ({
      id: crypto.randomUUID(),
      name: input.name,
      groupId: input.groupId ?? null,
    }));
    const values = prepared
      .map(() => "(?, ?, '#3B82F6', (SELECT id FROM folders WHERE kind = 'tag' AND id = ?), ?)")
      .join(', ');
    const binds = prepared.flatMap((row) => [row.id, row.name, row.groupId, now]);

    try {
      const inserted = await db
        .prepare(
          `INSERT OR IGNORE INTO tags (id, name, color, folder_id, created_at)
           VALUES ${values}
           RETURNING id`,
        )
        .bind(...binds)
        .run<{ id: string }>();
      const insertedIds = new Set((inserted.results ?? []).map((row) => row.id));
      prepared.forEach((row, index) => {
        results[offset + index] = insertedIds.has(row.id)
          ? { status: 'created', tagId: row.id }
          : { status: 'skipped' };
      });
    } catch (error) {
      console.error(`createTagsBulk rows ${offset + 1}-${offset + chunk.length} error:`, error);
      prepared.forEach((_row, index) => {
        results[offset + index] = { status: 'failed' };
      });
    }
  }

  return results;
}

/**
 * タグの所属分類を変える。null で「未分類」に戻す。
 *
 * 名前や色の変更と分けているのは、分類の付け替えが一覧の画面から
 * 一括で行われる操作で、名前の編集とは使われ方が違うため。
 */
export async function assignTagToGroup(
  db: D1Database,
  id: string,
  groupId: string | null,
): Promise<Tag | null> {
  await db
    .prepare(`UPDATE tags SET folder_id = ? WHERE id = ?`)
    .bind(groupId, id)
    .run();
  return (
    (await db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(id).first<Tag>()) ??
    null
  );
}

/**
 * タグの名前と色を変える。
 *
 * 一覧の表からマイルの列を外して編集画面へ移したときに要るようになった。
 * それまでは作るときにしか決められず、打ち間違えたタグは消して作り直す
 * しかなかった。作り直すと、付いていた友だちの分がすべて外れる。
 *
 * 渡されたものだけ当てる。色だけ変えたいときに名前を送らせると、
 * 呼ぶ側が現在値を読んでから書くことになり、その間に別の人が変えた
 * 名前を上書きしてしまう。
 */
export async function updateTag(
  db: D1Database,
  id: string,
  input: { name?: string; color?: string; isStarred?: boolean },
): Promise<Tag | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    binds.push(input.name);
  }
  if (input.color !== undefined) {
    sets.push('color = ?');
    binds.push(input.color);
  }
  if (input.isStarred !== undefined) {
    sets.push('is_starred = ?');
    binds.push(input.isStarred ? 1 : 0);
  }
  if (sets.length > 0) {
    await db
      .prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run();
  }
  return (
    (await db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(id).first<Tag>()) ?? null
  );
}

/**
 * 並び順をまとめて書く。
 *
 * 1件ずつ当てると、10件動かしたときに10往復する。その途中で誰かが
 * 一覧を開くと、半分だけ入れ替わった並びが見える。まとめて送る。
 *
 * 絞り込み中は、画面に見えているタグのIDだけが渡る。指定されたタグが
 * 現在占めている位置だけを入れ替え、指定されていないタグはその場に残す。
 * 最後に全体へ一意の順番を振るので、部分的な並び替えでも順番が重複しない。
 */
export async function reorderTags(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length < 2) return;

  const current = await db
    .prepare(
      `SELECT t.id
         FROM tags t
         LEFT JOIN friend_tags ft ON ft.tag_id = t.id
        GROUP BY t.id
        ORDER BY t.display_order ASC, COUNT(ft.friend_id) DESC, t.name ASC`,
    )
    .all<{ id: string }>();

  const existing = new Set(current.results.map((tag) => tag.id));
  const requested = ids.filter((id) => existing.has(id));
  if (requested.length < 2) return;

  const requestedSet = new Set(requested);
  let requestedIndex = 0;
  const nextOrder = current.results.map((tag) =>
    requestedSet.has(tag.id) ? requested[requestedIndex++] : tag.id,
  );

  await db.batch(
    nextOrder.map((id, i) =>
      db.prepare(`UPDATE tags SET display_order = ? WHERE id = ?`).bind(i, id),
    ),
  );
}

export async function deleteTag(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM tags WHERE id = ?`).bind(id).run();
}

// --- タグの親分類 -----------------------------------------------------------
//
// 「お悩み」「ペット」のような分類でタグをまとめる。分類は入れ子にしない。
// 二段で足りることが分かっているし、階層を許すと画面もクエリも一気に複雑になる。

export async function getTagGroups(db: D1Database): Promise<TagGroup[]> {
  const result = await db
    .prepare(
      `SELECT id, name, display_order AS sort_order, color, created_at, updated_at
         FROM folders WHERE kind = 'tag'
        ORDER BY display_order ASC, name ASC`,
    )
    .all<TagGroup>();
  return result.results;
}

export async function createTagGroup(
  db: D1Database,
  input: { name: string; sortOrder?: number; color?: string | null },
): Promise<TagGroup> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO folders (id, kind, name, display_order, color, created_at, updated_at)
       VALUES (?, 'tag', ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.name, input.sortOrder ?? 0, input.color ?? null, now, now)
    .run();
  return (await db
    .prepare(
      `SELECT id, name, display_order AS sort_order, color, created_at, updated_at
         FROM folders WHERE id = ?`,
    )
    .bind(id)
    .first<TagGroup>())!;
}

export async function updateTagGroup(
  db: D1Database,
  id: string,
  input: { name?: string; sortOrder?: number; color?: string | null },
): Promise<TagGroup | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    values.push(input.name);
  }
  if (input.sortOrder !== undefined) {
    sets.push('display_order = ?');
    values.push(input.sortOrder);
  }
  if (input.color !== undefined) {
    sets.push('color = ?');
    values.push(input.color);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    values.push(jstNow(), id);
    await db
      .prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = ? AND kind = 'tag'`)
      .bind(...values)
      .run();
  }
  return (
    (await db
      .prepare(
        `SELECT id, name, display_order AS sort_order, color, created_at, updated_at
           FROM folders WHERE id = ? AND kind = 'tag'`,
      )
      .bind(id)
      .first<TagGroup>()) ?? null
  );
}

/**
 * 分類を消す。属していたタグは消さず「未分類」に戻る
 * （tags.folder_id は ON DELETE SET NULL）。
 *
 * 分類は入れ物であって、タグそのものではない。入れ物を捨てたら中身も
 * 捨てる、では友だちに付いたタグまで巻き込まれる。
 */
export async function deleteTagGroup(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM folders WHERE id = ? AND kind = 'tag'`).bind(id).run();
}

export async function addTagToFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<boolean> {
  const now = jstNow();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
       VALUES (?, ?, ?)`,
    )
    .bind(friendId, tagId, now)
    .run();
  const added = (result.meta?.changes ?? 0) > 0;
  if (added) {
    try {
      await enqueueMileageEvent(db, {
        eventType: 'tag_added',
        source: 'tag',
        sourceEventId: `${friendId}:${tagId}:${now}`,
        friendId,
        subjectKey: tagId,
        metadata: { tagId },
        occurredAt: now,
      });
    } catch (error) {
      console.error('tag mileage enqueue failed:', error);
    }
  }
  return added;
}

export async function updateTagMileageSettings(
  db: D1Database,
  tagId: string,
  input: {
    rewardMiles: number;
    referralRewardMiles: number;
    multiplierBps: number | null;
    multiplierPriority: number;
  },
): Promise<Tag | null> {
  await db
    .prepare(
      `UPDATE tags
          SET mileage_reward = ?, referral_mileage_reward = ?,
              mileage_multiplier_bps = ?, mileage_multiplier_priority = ?
        WHERE id = ?`,
    )
    .bind(
      input.rewardMiles,
      input.referralRewardMiles,
      input.multiplierBps,
      input.multiplierPriority,
      tagId,
    )
    .run();
  return db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(tagId).first<Tag>();
}

/**
 * When an administrator enables a reward on an existing tag, normalize its
 * historic assignments into the same queue. INSERT OR IGNORE plus ledger
 * idempotency makes repeated saves safe.
 */
export async function enqueueHistoricTagMileage(
  db: D1Database,
  tagId: string,
): Promise<number> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO engagement_events
         (id, program_id, idempotency_key, event_type, source, source_event_id,
          actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
       SELECT 'tag-event:' || ft.friend_id || ':' || ft.tag_id,
              'default', 'tag:' || ft.friend_id || ':' || ft.tag_id || ':' || ft.assigned_at,
              'tag_added', 'tag', ft.friend_id || ':' || ft.tag_id || ':' || ft.assigned_at,
              f.user_id, ft.friend_id,
              json_object('tagId', ft.tag_id, 'subjectKey', ft.tag_id, 'backfilled', 1),
              ft.assigned_at, ?
         FROM friend_tags ft
         JOIN friends f ON f.id = ft.friend_id
        WHERE ft.tag_id = ?`,
    )
    .bind(now, tagId)
    .run();

  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO mileage_event_queue
         (engagement_event_id, status, attempts, available_at, created_at, updated_at)
       SELECT ee.id, 'pending', 0, ?, ?, ?
         FROM engagement_events ee
        WHERE ee.event_type = 'tag_added'
          AND ee.source = 'tag'
          AND json_extract(ee.metadata, '$.tagId') = ?`,
    )
    .bind(now, now, now, tagId)
    .run();

  const reset = await db
    .prepare(
      `UPDATE mileage_event_queue
          SET status = 'pending', attempts = 0, available_at = ?,
              processing_started_at = NULL, processed_at = NULL,
              last_error = NULL, updated_at = ?
        WHERE engagement_event_id IN (
          SELECT ee.id
            FROM engagement_events ee
            JOIN tags t ON t.id = json_extract(ee.metadata, '$.tagId')
           WHERE ee.event_type = 'tag_added'
             AND ee.source = 'tag'
             AND t.id = ?
             AND (
               (t.mileage_reward > 0 AND NOT EXISTS (
                 SELECT 1 FROM mileage_ledger ml
                  WHERE ml.engagement_event_id = ee.id AND ml.source = 'tag'
               ))
               OR
               (t.referral_mileage_reward > 0 AND NOT EXISTS (
                 SELECT 1 FROM mileage_ledger ml
                  WHERE ml.engagement_event_id = ee.id AND ml.source = 'tag_referral'
               ))
             )
        )
          AND status IN ('processed', 'failed')`,
    )
    .bind(now, now, tagId)
    .run();
  return (inserted.meta?.changes ?? 0) + (reset.meta?.changes ?? 0);
}

export async function removeTagFromFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM friend_tags WHERE friend_id = ? AND tag_id = ?`,
    )
    .bind(friendId, tagId)
    .run();
}

export async function getFriendTags(
  db: D1Database,
  friendId: string,
): Promise<Tag[]> {
  const result = await db
    .prepare(
      `SELECT t.*, fo.color AS folder_color
       FROM tags t
       INNER JOIN friend_tags ft ON ft.tag_id = t.id
       LEFT JOIN folders fo ON fo.id = t.folder_id
       WHERE ft.friend_id = ?
       ORDER BY t.name ASC`,
    )
    .bind(friendId)
    .all<Tag>();
  return result.results;
}

/**
 * 表示中の友だちのタグを1回で取得する。
 * ID配列はjson_eachへ1バインドで渡し、D1のバインド数上限にも依存しない。
 */
export async function getFriendTagsByFriendIds(
  db: D1Database,
  friendIds: string[],
): Promise<Map<string, Tag[]>> {
  if (friendIds.length === 0) return new Map();
  const result = await db
    .prepare(
      `SELECT ft.friend_id, t.*, fo.color AS folder_color
       FROM friend_tags ft
       INNER JOIN tags t ON t.id = ft.tag_id
       LEFT JOIN folders fo ON fo.id = t.folder_id
       WHERE ft.friend_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
       ORDER BY ft.friend_id ASC, t.name ASC`,
    )
    .bind(JSON.stringify(friendIds))
    .all<Tag & { friend_id: string }>();

  const byFriendId = new Map<string, Tag[]>();
  for (const row of result.results) {
    const tags = byFriendId.get(row.friend_id) ?? [];
    tags.push(row);
    byFriendId.set(row.friend_id, tags);
  }
  return byFriendId;
}

import type { Friend } from './friends';

export async function getFriendsByTag(
  db: D1Database,
  tagId: string,
  lineAccountId?: string | null,
): Promise<Friend[]> {
  const accountClause = lineAccountId ? ' AND f.line_account_id = ?' : '';
  const bindings = lineAccountId ? [tagId, lineAccountId] : [tagId];
  const result = await db
    .prepare(
      `SELECT f.*
       FROM friends f
       INNER JOIN friend_tags ft ON ft.friend_id = f.id
       WHERE ft.tag_id = ?${accountClause}
       ORDER BY f.created_at DESC`,
    )
    .bind(...bindings)
    .all<Friend>();
  return result.results;
}
