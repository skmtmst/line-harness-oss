import { tagReadPredicate, type TagReadScope } from './tag-lists.js';
import { type TagWithUsage, type TagWithUsageRow, type TagUsageCountRow, type TagUsageReferenceRow, type TagAssignSource, type TagCleanupReason, type TagDeleteImpact, type TagDeleteImpactRow, type TagDeleteImpactReferences } from './tags-types.js';
import { MAX_TAG_USAGE_COMPOUND_SELECT_TERMS, collectTagUsageBlockingTagIds, TAG_USAGE_BLOCKING_REFERENCE_SELECTS, normalizeTagNameForCleanup } from './tags-names.js';


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
  scope?: TagReadScope,
): Promise<TagWithUsage[]> {
  const predicate = tagReadPredicate(scope);
  const result = await db.prepare(
    `SELECT t.*, fo.color AS folder_color,
            COUNT(DISTINCT ft.friend_id) AS friend_count
       FROM tags t
       LEFT JOIN friend_tags ft ON ft.tag_id = t.id
       LEFT JOIN folders fo ON fo.id = t.folder_id
      WHERE ${predicate.sql}
      GROUP BY t.id
      ORDER BY t.display_order ASC, friend_count DESC, t.name ASC, t.id ASC`,
  ).bind(...predicate.binds).all<Omit<TagWithUsageRow,
    'assign_source' | 'used_in_broadcasts' | 'used_in_forms' |
    'used_in_scenarios' | 'used_in_auto_replies' |
    'used_in_saved_searches' | 'other_action_count'>>();

  if (result.results.length === 0) return [];
  const referenceScope = tagReadPredicate(scope, 'known');

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
        FROM refs r JOIN tags known ON known.id = r.tag_id
       WHERE ${referenceScope.sql}`);
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
         UNION
         SELECT v.on_submit_tag_id, f.id
           FROM forms f JOIN form_versions v ON v.id = f.current_published_version_id
          WHERE v.on_submit_tag_id IS NOT NULL
         UNION
         SELECT CAST(j.value AS TEXT), f.id
           FROM forms f JOIN form_versions v ON v.id = f.current_published_version_id,
                json_tree(CASE WHEN json_valid(v.layout) THEN v.layout ELSE 'null' END) j
          WHERE j.type = 'text'
       )`,
    used_in_auto_replies: `WITH refs(tag_id, entity_id) AS (
         SELECT CAST(j.value AS TEXT), a.id
           FROM auto_replies a,
                json_tree(CASE WHEN json_valid(a.actions_json)
                               THEN a.actions_json ELSE 'null' END) j
          WHERE j.type = 'text' AND a.deleted_at IS NULL
         UNION
         SELECT CAST(j.value AS TEXT), a.id
           FROM auto_replies a,
                json_tree(CASE WHEN json_valid(a.friend_conditions_json)
                               THEN a.friend_conditions_json ELSE 'null' END) j
          WHERE j.type = 'text' AND a.deleted_at IS NULL
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
       WHERE ${referenceScope.sql}
       GROUP BY r.tag_id`).bind(...referenceScope.binds).all<TagUsageCountRow>();
    usageCounts.set(field, new Map(
      counts.results.map((row) => [row.tag_id, Number(row.count)]),
    ));
  }

  const scenarioReferences = new Map<string, Set<string>>();
  for (const query of scenarioReferenceQueries) {
    const references = await db.prepare(query).bind(...referenceScope.binds).all<TagUsageReferenceRow>();
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

  const blockingTagIds = await collectTagUsageBlockingTagIds(db, TAG_USAGE_BLOCKING_REFERENCE_SELECTS, scope);

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
            (SELECT COUNT(*) FROM (
               SELECT f.id FROM forms f
                WHERE f.on_submit_tag_id = t.id OR EXISTS (
                  SELECT 1 FROM json_tree(CASE WHEN json_valid(f.layout)
                                               THEN f.layout ELSE 'null' END) j
                   WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
                )
               UNION
               SELECT f.id FROM forms f
                 JOIN form_versions v ON v.id = f.current_published_version_id
                WHERE v.on_submit_tag_id = t.id OR EXISTS (
                  SELECT 1 FROM json_tree(CASE WHEN json_valid(v.layout)
                                               THEN v.layout ELSE 'null' END) j
                   WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
                )
             )) AS forms,
            (SELECT COUNT(*) FROM scenario_refs) AS scenarios,
            (SELECT COUNT(*) FROM auto_replies a WHERE a.deleted_at IS NULL AND (EXISTS (
              SELECT 1 FROM json_tree(CASE WHEN json_valid(a.actions_json)
                                           THEN a.actions_json ELSE 'null' END) j
               WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
            ) OR EXISTS (
              SELECT 1 FROM json_tree(CASE WHEN json_valid(a.friend_conditions_json)
                                           THEN a.friend_conditions_json ELSE 'null' END) j
               WHERE j.type = 'text' AND CAST(j.value AS TEXT) = t.id
            ))) AS auto_replies,
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
