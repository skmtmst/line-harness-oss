import { type AnalyticsMetricState, type AnalyticsMetric, type AnalyticsOverviewContext, type UsageCategoryInput, type UsageReferenceHealth, type UsageReferenceHealthRow } from './analytics-overviews-types.js';


export function metric<T>(
  value: T | null,
  state: AnalyticsMetricState = 'available',
  reason: string | null = null,
): AnalyticsMetric<T> {
  return { value, state, reason };
}

export function envelope<T>(context: AnalyticsOverviewContext, data: T) {
  return {
    lineAccountId: context.lineAccountId,
    timeZone: context.timeZone,
    period: { from: context.fromDate, to: context.toDate },
    dataCutoffAt: context.dataCutoffAt,
    data,
  };
}

export function usageCategory(input: UsageCategoryInput) {
  const state = input.state ?? 'available';
  const reason = input.reason ?? null;
  const unused = input.created == null || input.inUse == null
    ? null : Math.max(0, input.created - input.inUse);
  return {
    key: input.key,
    label: input.label,
    href: input.href,
    created: metric(input.created, state, reason),
    inUse: metric(input.inUse, state, reason),
    unused: metric(unused, state, reason),
    brokenReferences: input.brokenReferences,
    lastUsedAt: metric(input.lastUsedAt, state, reason),
  };
}

/**
 * 運用中の設定が持つ参照だけを、参照先の分類ごとに数える。
 *
 * 参照元の行をアプリへ取り出さず、件数に関係なく固定1 statementで完了する。
 * UNIONを使わないのは、D1のcompound SELECT上限（5項）へ将来触れないため。
 * 新しいconsumer_typeは推測で表へ結び付けず、partialとして明示する。
 */
export async function collectUsageReferenceHealth(
  db: D1Database,
  lineAccountId: string,
): Promise<UsageReferenceHealth> {
  const supportedKeys = [
    'templates',
    'scenarios',
    'forms',
    'rich_menus',
    'friend_attributes',
    'inflow_conversion',
    'automations',
  ] as const;
  try {
    const row = await db.prepare(
      `/* usage-reference-health */
       SELECT
         (SELECT COUNT(*) FROM auto_replies ar
            LEFT JOIN templates t ON t.id = ar.template_id
             AND (t.line_account_id = ar.line_account_id OR t.line_account_id IS NULL)
           WHERE ar.line_account_id = ? AND ar.template_id IS NOT NULL AND t.id IS NULL
             AND ar.deleted_at IS NULL)
         + (SELECT COUNT(*) FROM scenario_steps ss
              JOIN scenarios s ON s.id = ss.scenario_id
              LEFT JOIN templates t ON t.id = ss.template_id
               AND (t.line_account_id = s.line_account_id OR t.line_account_id IS NULL)
             WHERE s.line_account_id = ? AND ss.template_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM scenario_actions sa
              JOIN scenarios s ON s.id = sa.scenario_id
              LEFT JOIN templates t
                ON t.id = json_extract(sa.config_json, '$.templateId')
               AND (t.line_account_id = s.line_account_id OR t.line_account_id IS NULL)
             WHERE s.line_account_id = ? AND sa.action_type = 'send_template'
               AND json_type(sa.config_json, '$.templateId') = 'text' AND t.id IS NULL)
         + (SELECT COUNT(*) FROM rich_menu_areas a
              JOIN rich_menu_pages p ON p.id = a.page_id
              JOIN rich_menu_groups g ON g.id = p.group_id
              LEFT JOIN templates t ON t.id = a.template_id
               AND (t.line_account_id = g.account_id OR t.line_account_id IS NULL)
             WHERE g.account_id = ? AND a.template_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM reminder_steps rs
              JOIN reminders r ON r.id = rs.reminder_id
              LEFT JOIN templates t ON t.id = rs.template_id
               AND (t.line_account_id = r.line_account_id OR t.line_account_id IS NULL)
             WHERE r.line_account_id = ? AND r.current_published_version_id IS NULL
               AND rs.template_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM tracked_links l
              LEFT JOIN templates t ON t.id = l.template_id
               AND (t.line_account_id = l.line_account_id OR t.line_account_id IS NULL)
             WHERE l.line_account_id = ? AND l.template_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM tracked_links l
              LEFT JOIN message_templates t ON t.id = l.intro_template_id
             WHERE l.line_account_id = ? AND l.intro_template_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM tracked_links l
              LEFT JOIN message_templates t ON t.id = l.reward_template_id
             WHERE l.line_account_id = ? AND l.reward_template_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM entry_routes e
              LEFT JOIN message_templates t ON t.id = e.intro_template_id
             WHERE e.line_account_id = ? AND e.intro_template_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM reminder_version_steps rs
              JOIN reminders r ON r.current_published_version_id = rs.reminder_version_id
              LEFT JOIN templates t ON t.id = rs.template_id
               AND (t.line_account_id = r.line_account_id OR t.line_account_id IS NULL)
             WHERE r.line_account_id = ? AND rs.template_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM automations a
              JOIN json_each(CASE WHEN json_valid(a.actions) THEN a.actions ELSE '[]' END) action
              LEFT JOIN templates t
                ON t.id = json_extract(action.value, '$.params.template_id')
               AND (t.line_account_id = a.line_account_id OR t.line_account_id IS NULL)
             WHERE a.line_account_id = ?
               AND json_type(action.value, '$.params.template_id') = 'text' AND t.id IS NULL)
           AS templates_broken,

         (SELECT COUNT(*) FROM tracked_links l
            LEFT JOIN scenarios s ON s.id = l.scenario_id
             AND (s.line_account_id = l.line_account_id OR s.line_account_id IS NULL)
           WHERE l.line_account_id = ? AND l.scenario_id IS NOT NULL AND s.id IS NULL)
         + (SELECT COUNT(*) FROM entry_routes e
              LEFT JOIN scenarios s ON s.id = e.scenario_id
               AND (s.line_account_id = e.line_account_id OR s.line_account_id IS NULL)
             WHERE e.line_account_id = ? AND e.scenario_id IS NOT NULL AND s.id IS NULL)
         + (SELECT COUNT(*) FROM friend_scenarios fs
              JOIN friends f ON f.id = fs.friend_id
              LEFT JOIN scenarios s ON s.id = fs.scenario_id
               AND (s.line_account_id = f.line_account_id OR s.line_account_id IS NULL)
             WHERE f.line_account_id = ? AND fs.status <> 'completed' AND s.id IS NULL)
         + (SELECT COUNT(*) FROM scenarios source
              LEFT JOIN scenarios target
                ON target.id = source.on_complete_scenario_id
               AND (target.line_account_id = source.line_account_id OR target.line_account_id IS NULL)
             WHERE source.line_account_id = ? AND source.on_complete_scenario_id IS NOT NULL
               AND target.id IS NULL)
         + (SELECT COUNT(*) FROM scenario_actions sa
              JOIN scenarios source ON source.id = sa.scenario_id
              LEFT JOIN scenarios target
                ON target.id = json_extract(sa.config_json, '$.scenarioId')
               AND (target.line_account_id = source.line_account_id OR target.line_account_id IS NULL)
             WHERE source.line_account_id = ? AND sa.action_type = 'scenario'
               AND json_type(sa.config_json, '$.scenarioId') = 'text' AND target.id IS NULL)
         + (SELECT COUNT(*) FROM rich_menu_areas a
              JOIN rich_menu_pages p ON p.id = a.page_id
              JOIN rich_menu_groups g ON g.id = p.group_id
              LEFT JOIN scenarios target
                ON target.id = json_extract(
                  CASE WHEN json_valid(a.action_data) THEN a.action_data ELSE '{}' END,
                  '$.scenarioId'
                )
               AND (target.line_account_id = g.account_id OR target.line_account_id IS NULL)
             WHERE g.account_id = ?
               AND json_type(
                 CASE WHEN json_valid(a.action_data) THEN a.action_data ELSE '{}' END,
                 '$.scenarioId'
               ) = 'text' AND target.id IS NULL)
         + (SELECT COUNT(*) FROM forms f
              JOIN form_accounts fa ON fa.form_id = f.id
              JOIN form_versions v
                ON v.id = f.current_published_version_id AND v.form_id = f.id
              LEFT JOIN scenarios target ON target.id = v.on_submit_scenario_id
               AND (target.line_account_id = fa.line_account_id OR target.line_account_id IS NULL)
             WHERE fa.line_account_id = ? AND v.on_submit_scenario_id IS NOT NULL
               AND target.id IS NULL)
           AS scenarios_broken,

         (SELECT COUNT(*) FROM rich_menu_areas a
            JOIN rich_menu_pages p ON p.id = a.page_id
            JOIN rich_menu_groups g ON g.id = p.group_id
            LEFT JOIN forms f ON f.id = a.form_id AND f.status = 'active'
            LEFT JOIN form_accounts fa
              ON fa.form_id = f.id AND fa.line_account_id = g.account_id
           WHERE g.account_id = ? AND a.form_id IS NOT NULL
             AND (f.id IS NULL OR fa.form_id IS NULL))
           AS forms_broken,

         (SELECT COUNT(*) FROM rich_menu_assignments a
            LEFT JOIN rich_menu_groups g ON g.id = a.group_id AND g.account_id = a.line_account_id
           WHERE a.line_account_id = ? AND a.group_id IS NOT NULL AND g.id IS NULL)
         + (SELECT COUNT(*) FROM rich_menu_schedules s
              LEFT JOIN rich_menu_groups g ON g.id = s.group_id AND g.account_id = s.account_id
             WHERE s.account_id = ? AND g.id IS NULL)
         + (SELECT COUNT(*) FROM rich_menu_schedules s
              LEFT JOIN rich_menu_groups g ON g.id = s.restore_group_id AND g.account_id = s.account_id
             WHERE s.account_id = ? AND s.restore_group_id IS NOT NULL AND g.id IS NULL)
         + (SELECT COUNT(*) FROM rich_menu_groups g
              LEFT JOIN rich_menu_pages p ON p.id = g.default_page_id AND p.group_id = g.id
             WHERE g.account_id = ? AND g.default_page_id IS NOT NULL AND p.id IS NULL)
         + (SELECT COUNT(*) FROM rich_menu_areas a
              JOIN rich_menu_pages source_page ON source_page.id = a.page_id
              JOIN rich_menu_groups source_group ON source_group.id = source_page.group_id
              LEFT JOIN rich_menu_pages target_page
                ON target_page.id = json_extract(
                  CASE WHEN json_valid(a.action_data) THEN a.action_data ELSE '{}' END,
                  '$.targetPageId'
                )
               AND target_page.group_id = source_group.id
             WHERE source_group.account_id = ? AND a.action_type = 'richmenuswitch'
               AND json_type(
                 CASE WHEN json_valid(a.action_data) THEN a.action_data ELSE '{}' END,
                 '$.targetPageId'
               ) = 'text' AND target_page.id IS NULL)
           AS rich_menus_broken,

         (SELECT COUNT(*) FROM scenario_steps ss
            JOIN scenarios s ON s.id = ss.scenario_id
            LEFT JOIN tags t ON t.id = ss.on_reach_tag_id
             AND (t.line_account_id = s.line_account_id OR t.line_account_id IS NULL)
           WHERE s.line_account_id = ? AND ss.on_reach_tag_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM scenario_triggers st
              JOIN scenarios s ON s.id = st.scenario_id
              LEFT JOIN tags t ON t.id = st.tag_id
               AND (t.line_account_id = s.line_account_id OR t.line_account_id IS NULL)
             WHERE s.line_account_id = ? AND st.tag_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM tracked_links l
              LEFT JOIN tags t ON t.id = l.tag_id
               AND (t.line_account_id = l.line_account_id OR t.line_account_id IS NULL)
             WHERE l.line_account_id = ? AND l.tag_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM entry_routes e
              LEFT JOIN tags t ON t.id = e.tag_id
               AND (t.line_account_id = e.line_account_id OR t.line_account_id IS NULL)
             WHERE e.line_account_id = ? AND e.tag_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM reminders r
              LEFT JOIN tags t ON t.id = r.target_tag_id
               AND (t.line_account_id = r.line_account_id OR t.line_account_id IS NULL)
             WHERE r.line_account_id = ? AND r.target_tag_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM scenario_actions sa
              JOIN scenarios s ON s.id = sa.scenario_id
              JOIN json_each(CASE WHEN json_valid(sa.config_json) THEN sa.config_json ELSE '{}' END, '$.tagIds') tag_ref
              LEFT JOIN tags t ON t.id = CAST(tag_ref.value AS TEXT)
               AND (t.line_account_id = s.line_account_id OR t.line_account_id IS NULL)
             WHERE s.line_account_id = ? AND sa.action_type = 'tag'
               AND tag_ref.type = 'text' AND t.id IS NULL)
         + (SELECT COUNT(*) FROM reminders r
              LEFT JOIN friend_fields f ON f.id = r.trigger_field_id
             WHERE r.line_account_id = ? AND r.trigger_type = 'friend_field'
               AND r.trigger_field_id IS NOT NULL AND f.id IS NULL)
         + (SELECT COUNT(*) FROM rich_menu_areas a
              JOIN rich_menu_pages p ON p.id = a.page_id
              JOIN rich_menu_groups g ON g.id = p.group_id
              JOIN json_each(CASE WHEN json_valid(a.tag_ids) THEN a.tag_ids ELSE '[]' END) tag_ref
              LEFT JOIN tags t ON t.id = CAST(tag_ref.value AS TEXT)
               AND (t.line_account_id = g.account_id OR t.line_account_id IS NULL)
             WHERE g.account_id = ? AND tag_ref.type = 'text' AND t.id IS NULL)
         + (SELECT COUNT(*) FROM forms f
              JOIN form_accounts fa ON fa.form_id = f.id
              JOIN form_versions v
                ON v.id = f.current_published_version_id AND v.form_id = f.id
              LEFT JOIN tags t ON t.id = v.on_submit_tag_id
               AND (t.line_account_id = fa.line_account_id OR t.line_account_id IS NULL)
             WHERE fa.line_account_id = ? AND v.on_submit_tag_id IS NOT NULL AND t.id IS NULL)
         + (SELECT COUNT(*) FROM forms f
              JOIN form_accounts fa ON fa.form_id = f.id
              JOIN form_versions v
                ON v.id = f.current_published_version_id AND v.form_id = f.id
              JOIN json_each(CASE WHEN json_valid(v.fields) THEN v.fields ELSE '[]' END) field
              LEFT JOIN friend_fields target
                ON target.id = json_extract(field.value, '$.friendFieldId')
             WHERE fa.line_account_id = ?
               AND json_type(field.value, '$.friendFieldId') = 'text' AND target.id IS NULL)
           AS friend_attributes_broken,

         (SELECT COUNT(*) FROM rich_menu_areas a
            JOIN rich_menu_pages p ON p.id = a.page_id
            JOIN rich_menu_groups g ON g.id = p.group_id
            LEFT JOIN tracked_links l
              ON l.id = a.tracked_link_id AND l.line_account_id = g.account_id
           WHERE g.account_id = ? AND a.tracked_link_id IS NOT NULL AND l.id IS NULL)
         + (SELECT COUNT(*) FROM conversion_events e
              JOIN friends f ON f.id = e.friend_id
              LEFT JOIN conversion_points p
                ON p.id = e.conversion_point_id AND p.line_account_id = f.line_account_id
             WHERE f.line_account_id = ? AND p.id IS NULL)
         + (SELECT COUNT(*) FROM entry_routes e
              LEFT JOIN traffic_pools p ON p.id = e.pool_id
             WHERE e.line_account_id = ? AND e.pool_id IS NOT NULL AND p.id IS NULL)
           AS inflow_conversion_broken,

         (SELECT COUNT(*) FROM common_action_bindings b
            LEFT JOIN common_actions a
              ON a.id = b.common_action_id AND a.line_account_id = b.line_account_id
           WHERE b.line_account_id = ? AND b.consumer_type IN ('automation', 'tag') AND a.id IS NULL)
         + (SELECT COUNT(*) FROM common_action_bindings b
              LEFT JOIN common_action_versions v
                ON v.id = b.common_action_version_id AND v.common_action_id = b.common_action_id
             WHERE b.line_account_id = ? AND b.consumer_type IN ('automation', 'tag') AND v.id IS NULL)
         + (SELECT COUNT(*) FROM common_action_bindings b
              LEFT JOIN automation_definitions a
                ON a.id = b.consumer_id AND a.line_account_id = b.line_account_id
             WHERE b.line_account_id = ? AND b.consumer_type = 'automation' AND a.id IS NULL)
         + (SELECT COUNT(*) FROM common_action_bindings b
              LEFT JOIN tags t ON t.id = b.consumer_id AND t.line_account_id = b.line_account_id
             WHERE b.line_account_id = ? AND b.consumer_type = 'tag' AND t.id IS NULL)
           AS automations_broken,

         (SELECT GROUP_CONCAT(consumer_type) FROM (
            SELECT DISTINCT consumer_type FROM common_action_bindings
             WHERE line_account_id = ? AND consumer_type NOT IN ('automation', 'tag')
             ORDER BY consumer_type
          )) AS unsupported_consumer_types`,
    ).bind(...Array(42).fill(lineAccountId)).first<UsageReferenceHealthRow>();

    if (!row) {
      return Object.fromEntries(supportedKeys.map((key) => [
        key,
        metric<number>(null, 'unavailable', '参照情報を取得できませんでした'),
      ]));
    }
    const unsupported = row.unsupported_consumer_types?.split(',').filter(Boolean) ?? [];
    return {
      templates: metric(Number(row.templates_broken ?? 0)),
      scenarios: metric(Number(row.scenarios_broken ?? 0)),
      forms: metric(
        Number(row.forms_broken ?? 0),
        'partial',
        'リッチメニューからの参照だけを確認しています。回答フォーム自体に単一のLINEアカウント所属がないため、ほかの利用先は除外しています',
      ),
      rich_menus: metric(Number(row.rich_menus_broken ?? 0)),
      friend_attributes: metric(
        Number(row.friend_attributes_broken ?? 0),
        'partial',
        '所属を確認できる公開フォームと型の決まった参照だけを集計し、型を安全に特定できない条件JSONは除外しています',
      ),
      inflow_conversion: metric(Number(row.inflow_conversion_broken ?? 0)),
      automations: metric(
        Number(row.automations_broken ?? 0),
        unsupported.length > 0 ? 'partial' : 'available',
        unsupported.length > 0
          ? `未対応の利用先種別（${unsupported.join('、')}）を除外しています`
          : null,
      ),
    };
  } catch {
    return Object.fromEntries(supportedKeys.map((key) => [
      key,
      metric<number>(null, 'failed', '参照情報の照合に失敗しました'),
    ]));
  }
}

export function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
