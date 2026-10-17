import { FEATURE_IDS } from '@line-crm/shared';
import { type AnalyticsOverviewContext } from './analytics-overviews-types.js';
import { FEATURE_USAGE_WINDOW_DAYS, collectFeatureUsage, FEATURE_USAGE_DEFINITIONS } from './analytics-overviews-usage-measures.js';
import { collectUsageReferenceHealth, usageCategory, metric, envelope } from './analytics-overviews-metrics.js';


export async function getAnalyticsUsageOverview(
  db: D1Database,
  context: AnalyticsOverviewContext,
) {
  const usageSince = new Date(
    Date.parse(context.dataCutoffAt || context.toExclusive) - FEATURE_USAGE_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const [templates, scenarios, forms, richMenus, tagsFields, inflow, automations, mediaVars, activity, referenceHealth, featureUsage] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS created,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM messages_log m
                    WHERE m.template_id_at_send = t.id AND m.line_account_id = ?) OR
                  EXISTS (SELECT 1 FROM auto_replies a
                    WHERE a.template_id = t.id AND a.line_account_id = ?
                      AND a.deleted_at IS NULL) OR
                  EXISTS (SELECT 1 FROM scenario_steps ss JOIN scenarios s ON s.id = ss.scenario_id
                    WHERE ss.template_id = t.id AND s.line_account_id = ?)
                THEN 1 ELSE 0 END) AS in_use,
              (SELECT MAX(m.created_at) FROM messages_log m
                WHERE m.line_account_id = ? AND m.template_id_at_send IS NOT NULL) AS last_used_at
         FROM templates t WHERE t.line_account_id = ?`,
    ).bind(...Array(5).fill(context.lineAccountId)).first<{ created: number; in_use: number; last_used_at: string | null }>(),
    db.prepare(
      `SELECT COUNT(*) AS created,
              SUM(CASE WHEN s.is_active = 1 OR EXISTS (
                SELECT 1 FROM friend_scenarios fs JOIN friends f ON f.id = fs.friend_id
                 WHERE fs.scenario_id = s.id AND f.line_account_id = ?
              ) THEN 1 ELSE 0 END) AS in_use,
              (SELECT MAX(m.created_at) FROM messages_log m JOIN scenario_steps ss ON ss.id = m.scenario_step_id
                JOIN scenarios sx ON sx.id = ss.scenario_id WHERE m.line_account_id = ?) AS last_used_at
         FROM scenarios s WHERE s.line_account_id = ?`,
    ).bind(...Array(3).fill(context.lineAccountId)).first<{ created: number; in_use: number; last_used_at: string | null }>(),
    db.prepare(
      `SELECT COUNT(DISTINCT fs.form_id) AS created,
              COUNT(DISTINCT CASE WHEN fs.id IS NOT NULL THEN fs.form_id END) AS in_use,
              MAX(fs.created_at) AS last_used_at
         FROM form_submissions fs JOIN friends f ON f.id = fs.friend_id
        WHERE f.line_account_id = ?`,
    ).bind(context.lineAccountId).first<{ created: number; in_use: number; last_used_at: string | null }>(),
    db.prepare(
      `SELECT COUNT(*) AS created,
              SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS in_use,
              (SELECT MAX(tapped_at) FROM rich_menu_area_taps WHERE line_account_id = ?) AS last_used_at
         FROM rich_menu_groups WHERE account_id = ?`,
    ).bind(context.lineAccountId, context.lineAccountId)
      .first<{ created: number; in_use: number; last_used_at: string | null }>(),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM tags WHERE line_account_id = ? OR line_account_id IS NULL) +
         (SELECT COUNT(DISTINCT fv.field_id) FROM friend_field_values fv JOIN friends f ON f.id = fv.friend_id
           WHERE f.line_account_id = ?) AS created,
         (SELECT COUNT(DISTINCT ft.tag_id) FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id
           WHERE f.line_account_id = ?) +
         (SELECT COUNT(DISTINCT fv.field_id) FROM friend_field_values fv JOIN friends f ON f.id = fv.friend_id
           WHERE f.line_account_id = ?) AS in_use,
         MAX(last_used_at) AS last_used_at FROM (
           SELECT MAX(ft.assigned_at) AS last_used_at FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id
            WHERE f.line_account_id = ?
           UNION ALL SELECT MAX(fv.updated_at) FROM friend_field_values fv JOIN friends f ON f.id = fv.friend_id
            WHERE f.line_account_id = ?
         )`,
    ).bind(...Array(6).fill(context.lineAccountId))
      .first<{ created: number; in_use: number; last_used_at: string | null }>(),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM tracked_links WHERE line_account_id = ?) +
         (SELECT COUNT(*) FROM conversion_points WHERE line_account_id = ?) AS created,
         (SELECT COUNT(*) FROM tracked_links WHERE line_account_id = ? AND is_active = 1) +
         (SELECT COUNT(DISTINCT ce.conversion_point_id) FROM conversion_events ce JOIN friends f ON f.id = ce.friend_id
           WHERE f.line_account_id = ?) AS in_use,
         MAX(last_used_at) AS last_used_at FROM (
           SELECT MAX(c.clicked_at) AS last_used_at FROM link_clicks c JOIN tracked_links l ON l.id = c.tracked_link_id
            WHERE l.line_account_id = ?
           UNION ALL SELECT MAX(ce.created_at) FROM conversion_events ce JOIN friends f ON f.id = ce.friend_id
            WHERE f.line_account_id = ?
         )`,
    ).bind(...Array(6).fill(context.lineAccountId))
      .first<{ created: number; in_use: number; last_used_at: string | null }>(),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM automation_definitions WHERE line_account_id = ?) +
         (SELECT COUNT(*) FROM common_actions WHERE line_account_id = ?) AS created,
         (SELECT COUNT(*) FROM automation_definitions WHERE line_account_id = ? AND status = 'active') +
         (SELECT COUNT(*) FROM common_actions WHERE line_account_id = ? AND status = 'published') AS in_use,
         MAX(last_used_at) AS last_used_at FROM (
           SELECT MAX(completed_at) AS last_used_at FROM automation_runs WHERE line_account_id = ?
           UNION ALL SELECT MAX(updated_at) FROM common_action_bindings WHERE line_account_id = ?
         )`,
    ).bind(...Array(6).fill(context.lineAccountId))
      .first<{ created: number; in_use: number; last_used_at: string | null }>(),
    Promise.resolve({ created: null, in_use: null, last_used_at: null }),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM automation_runs
           WHERE line_account_id = ? AND is_test = 0
             AND status IN ('success', 'partial', 'failed')
             AND datetime(COALESCE(started_at, created_at)) >= datetime(?)
             AND datetime(COALESCE(started_at, created_at)) < datetime(?)) AS automatic_runs,
         (SELECT COUNT(*) FROM messages_log
           WHERE line_account_id = ? AND direction = 'outgoing'
             AND source = 'manual'
             AND COALESCE(delivery_type, 'push') <> 'test'
             AND datetime(created_at) >= datetime(?)
             AND datetime(created_at) < datetime(?)) AS manual_sends`,
    ).bind(
      context.lineAccountId,
      context.from,
      context.toExclusive,
      context.lineAccountId,
      context.from,
      context.toExclusive,
    ).first<{ automatic_runs: number; manual_sends: number }>(),
    collectUsageReferenceHealth(db, context.lineAccountId),
    collectFeatureUsage(db, context.lineAccountId, usageSince),
  ]);
  const categories = [
    usageCategory({ key: 'templates', label: 'テンプレート', href: '/templates', created: Number(templates?.created ?? 0), inUse: Number(templates?.in_use ?? 0), lastUsedAt: templates?.last_used_at ?? null, brokenReferences: referenceHealth.templates }),
    usageCategory({ key: 'scenarios', label: 'シナリオ', href: '/scenarios', created: Number(scenarios?.created ?? 0), inUse: Number(scenarios?.in_use ?? 0), lastUsedAt: scenarios?.last_used_at ?? null, brokenReferences: referenceHealth.scenarios }),
    usageCategory({ key: 'forms', label: '回答フォーム', href: '/form-submissions', created: Number(forms?.created ?? 0), inUse: Number(forms?.in_use ?? 0), lastUsedAt: forms?.last_used_at ?? null, state: 'partial', reason: '回答実績から所属を確認できるフォームのみです', brokenReferences: referenceHealth.forms }),
    usageCategory({ key: 'rich_menus', label: 'リッチメニュー', href: '/rich-menus', created: Number(richMenus?.created ?? 0), inUse: Number(richMenus?.in_use ?? 0), lastUsedAt: richMenus?.last_used_at ?? null, brokenReferences: referenceHealth.rich_menus }),
    usageCategory({ key: 'friend_attributes', label: 'タグ・友だち情報', href: '/tags', created: Number(tagsFields?.created ?? 0), inUse: Number(tagsFields?.in_use ?? 0), lastUsedAt: tagsFields?.last_used_at ?? null, state: 'partial', reason: '旧共通項目はLINEアカウント所属を持たないため、利用実績から判定しています', brokenReferences: referenceHealth.friend_attributes }),
    usageCategory({ key: 'inflow_conversion', label: '流入リンク・成果地点', href: '/inflow-links', created: Number(inflow?.created ?? 0), inUse: Number(inflow?.in_use ?? 0), lastUsedAt: inflow?.last_used_at ?? null, brokenReferences: referenceHealth.inflow_conversion }),
    usageCategory({ key: 'automations', label: 'オートメーション・共通アクション', href: '/automations', created: Number(automations?.created ?? 0), inUse: Number(automations?.in_use ?? 0), lastUsedAt: automations?.last_used_at ?? null, brokenReferences: referenceHealth.automations }),
    usageCategory({ key: 'media_vars', label: '登録メディア・共通情報', href: '/contents', created: mediaVars.created, inUse: mediaVars.in_use, lastUsedAt: mediaVars.last_used_at, state: 'unavailable', reason: '旧データにLINEアカウント所属がないため、安全に分けられません', brokenReferences: metric<number>(null, 'unavailable', '旧データにLINEアカウント所属がないため、参照切れを取得できません') }),
  ];
  const knownUnused = categories.filter((item) => item.unused.value !== null);
  const unusedItems = knownUnused.reduce((sum, item) => sum + (item.unused.value ?? 0), 0);
  const unusedIncomplete = knownUnused.length !== categories.length
    || knownUnused.some((item) => item.unused.state !== 'available');
  const referenceMetrics = categories.map((item) => item.brokenReferences);
  const knownReferenceMetrics = referenceMetrics.filter((item) => item.value !== null);
  const brokenReferences = knownReferenceMetrics.reduce(
    (sum, item) => sum + (item.value ?? 0),
    0,
  );
  const referenceIncomplete = knownReferenceMetrics.length !== referenceMetrics.length
    || knownReferenceMetrics.some((item) => item.state !== 'available');
  const referenceFailed = referenceMetrics.some((item) => item.state === 'failed');
  const automaticRuns = Number(activity?.automatic_runs ?? 0);
  const manualSends = Number(activity?.manual_sends ?? 0);
  const automaticReason = '現在はオートメーションの実行記録だけを数えています';
  /*
   * 全任意機能の利用状況（N-448）。共有カタログの全 featureId を必ず返し、
   * 画面側は featureId で機械照合する。計測できる機能は直近90日の回数と
   * 最終利用、計測できない機能は未計測理由を返す。取得不可を 0 にしない。
   */
  const features = FEATURE_IDS.map((featureId) => {
    const definition = FEATURE_USAGE_DEFINITIONS[featureId];
    if (definition.basis === null) {
      const reason = definition.unmeasuredReason ?? 'この機能の利用は計測していません';
      return {
        featureId,
        activityUnit: null,
        activityBasis: null,
        activity: metric<number>(null, 'unavailable', reason),
        lastUsedAt: metric<string>(null, 'unavailable', reason),
      };
    }
    const measured = featureUsage.get(featureId);
    if (!measured || measured.failed) {
      return {
        featureId,
        activityUnit: definition.unit,
        activityBasis: definition.basis,
        activity: metric<number>(null, 'failed', '利用状況の集計に失敗しました'),
        lastUsedAt: metric<string>(null, 'failed', '利用状況の集計に失敗しました'),
      };
    }
    const state = definition.note ? 'partial' : 'available';
    return {
      featureId,
      activityUnit: definition.unit,
      activityBasis: definition.basis,
      activity: metric(measured.count, state, definition.note ?? null),
      lastUsedAt: definition.lastUsedReason
        ? metric<string>(null, 'unavailable', definition.lastUsedReason)
        : metric(measured.lastUsedAt, state, definition.note ?? null),
    };
  });
  return envelope(context, {
    state: categories.some((item) => item.created.state !== 'available' || item.brokenReferences.state !== 'available') ? 'partial' : 'available',
    stateReason: '旧データの所属が分からない項目は合計へ混ぜていません',
    checkedAt: context.dataCutoffAt,
    summary: {
      unusedItems: metric(
        unusedItems,
        unusedIncomplete ? 'partial' : 'available',
        unusedIncomplete ? '取得できた分類だけの合計です' : null,
      ),
      brokenReferences: metric(
        knownReferenceMetrics.length > 0 ? brokenReferences : null,
        knownReferenceMetrics.length === 0 && referenceFailed
          ? 'failed'
          : referenceIncomplete ? 'partial' : 'available',
        knownReferenceMetrics.length === 0 && referenceFailed
          ? '参照情報の照合に失敗しました'
          : referenceIncomplete
            ? referenceFailed
              ? '照合に失敗した分類と未取得の分類を除く、確認できた分類だけの合計です'
              : '未取得・一部取得の分類を含むため、確認できた参照だけの合計です'
            : null,
      ),
      automaticRuns: metric(automaticRuns, 'partial', automaticReason),
      manualSends: metric(manualSends),
      estimatedHoursSaved: metric(
        Math.round((automaticRuns * 30 / 3600) * 100) / 100,
        'partial',
        `${automaticReason}。1回30秒として試算しています`,
      ),
    },
    categories,
    features,
    automaticDeletion: false,
  });
}
