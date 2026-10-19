import { type TagDeleteImpact, type TagDeleteImpactRow, type TagDeleteImpactReferences } from './types.js';


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
