import { type FeatureId } from '@line-crm/shared';
import { type FeatureUsageDefinition, type FeatureUsageMeasure } from './analytics-overviews-types.js';


export const FEATURE_USAGE_DEFINITIONS: Record<FeatureId, FeatureUsageDefinition> = {
  scenarios: { unit: '配信', basis: 'last90days' },
  broadcasts: { unit: '配信', basis: 'last90days' },
  templates: { unit: '送信', basis: 'last90days' },
  reminders: { unit: '配信', basis: 'last90days' },
  auto_replies: { unit: '応答', basis: 'last90days' },
  rich_menus: { unit: 'タップ', basis: 'last90days' },
  inflow_tracking: { unit: 'クリック', basis: 'last90days' },
  forms: { unit: '回答', basis: 'last90days' },
  photo_review: { unit: '投稿', basis: 'last90days' },
  automations: { unit: '実行', basis: 'last90days' },
  external_integrations: { unit: '送信', basis: 'last90days' },
  friend_add_routing: { unit: '実行', basis: 'last90days' },
  multi_store_hierarchy: {
    unit: null,
    basis: null,
    unmeasuredReason: 'プールはアカウントをまたぐ設定のため、アカウントごとの利用は計測していません',
  },
  friend_fields: { unit: '記録', basis: 'last90days' },
  support_marks: {
    unit: 'マーク中の友だち',
    basis: 'current',
    lastUsedReason: 'マークの付け替え時刻は記録していません',
  },
  saved_searches: { unit: '利用', basis: 'last90days' },
  media: {
    unit: '登録',
    basis: 'last90days',
    note: 'LINEアカウント所属のある登録だけを数えています',
  },
  common_vars: { unit: '更新', basis: 'last90days' },
  analytics: {
    unit: null,
    basis: null,
    unmeasuredReason: '画面の閲覧は計測していません',
  },
  site_tracking: { unit: '計測', basis: 'last90days' },
  webinars: { unit: '申込', basis: 'last90days' },
  events: { unit: '申込', basis: 'last90days' },
  booking: { unit: '予約', basis: 'last90days' },
  affiliates: { unit: '成果', basis: 'last90days' },
  mileage: {
    unit: '増減',
    basis: 'last90days',
    note: '友だちに紐づく増減だけを数えています',
  },
  ec_commerce: { unit: '連携', basis: 'last90days' },
  line_notifications: { unit: '送信', basis: 'last90days' },
  nen_campaigns: { unit: '配信', basis: 'last90days' },
  visit_stamps: { unit:null,basis:null,unmeasuredReason:'来店スタンプの利用状況はこの一覧では計測していません' },
  restaurant_test: {
    unit: null,
    basis: null,
    unmeasuredReason: 'テスト機能の利用はアカウントごとに計測していません',
  },
};

/** 回数を数える期間。機能の利用傾向を見るための固定の振り返り幅。 */
export const FEATURE_USAGE_WINDOW_DAYS = 90;

/**
 * 機能ごとの利用回数を、機能の意味に合わせて数える（N-448）。
 *
 * 計測できる機能は直近90日の回数と最終利用（期間を区切らない最後の記録）を返す。
 * 機能ごとに1問ずつ投げず、領域ごとの固定文で集計する（N+1回避）。
 * 1文が失敗しても、その領域の機能だけを failed にして他は返す。
 * 件数上限は置かない。回数はSQL側で集計し、行はアプリへ取り出さない。
 */
export async function collectFeatureUsage(
  db: D1Database,
  lineAccountId: string,
  since: string,
): Promise<Map<FeatureId, FeatureUsageMeasure>> {
  const account = lineAccountId;
  const groups: Array<{ ids: FeatureId[]; sql: string; binds: unknown[] }> = [
    {
      ids: ['scenarios', 'broadcasts', 'templates', 'reminders', 'auto_replies', 'friend_add_routing'],
      sql: `/* usage-feature-delivery */
        SELECT
          (SELECT COUNT(*) FROM messages_log m
            WHERE m.line_account_id = ?
              AND (m.scenario_step_id IS NOT NULL OR m.scenario_version_step_id IS NOT NULL)
              AND datetime(m.created_at) >= datetime(?)) AS scenarios_count,
          (SELECT MAX(m.created_at) FROM messages_log m
            WHERE m.line_account_id = ?
              AND (m.scenario_step_id IS NOT NULL OR m.scenario_version_step_id IS NOT NULL)) AS scenarios_last,
          (SELECT COUNT(*) FROM broadcasts b
            WHERE (b.line_account_id = ? OR (b.target_type = 'multi-account-dedup'
                AND EXISTS (SELECT 1 FROM json_each(b.account_ids) je WHERE je.value = ?)))
              AND b.sent_at IS NOT NULL AND datetime(b.sent_at) >= datetime(?)) AS broadcasts_count,
          (SELECT MAX(b.sent_at) FROM broadcasts b
            WHERE (b.line_account_id = ? OR (b.target_type = 'multi-account-dedup'
                AND EXISTS (SELECT 1 FROM json_each(b.account_ids) je WHERE je.value = ?)))
              AND b.sent_at IS NOT NULL) AS broadcasts_last,
          (SELECT COUNT(*) FROM messages_log m
            WHERE m.line_account_id = ? AND m.template_id_at_send IS NOT NULL
              AND datetime(m.created_at) >= datetime(?)) AS templates_count,
          (SELECT MAX(m.created_at) FROM messages_log m
            WHERE m.line_account_id = ? AND m.template_id_at_send IS NOT NULL) AS templates_last,
          (SELECT COUNT(*) FROM reminder_delivery_runs r
            WHERE r.line_account_id = ? AND r.status = 'succeeded'
              AND datetime(COALESCE(r.completed_at, r.created_at)) >= datetime(?)) AS reminders_count,
          (SELECT MAX(COALESCE(r.completed_at, r.created_at)) FROM reminder_delivery_runs r
            WHERE r.line_account_id = ? AND r.status = 'succeeded') AS reminders_last,
          (SELECT COUNT(*) FROM auto_reply_hits h
            WHERE h.line_account_id = ? AND datetime(h.hit_at) >= datetime(?)) AS auto_replies_count,
          (SELECT MAX(h.hit_at) FROM auto_reply_hits h
            WHERE h.line_account_id = ?) AS auto_replies_last,
          (SELECT COUNT(*) FROM friend_add_action_runs r
            JOIN friend_add_events e ON e.id = r.event_id
            WHERE e.line_account_id = ? AND r.status = 'completed'
              AND datetime(COALESCE(r.completed_at, r.updated_at, r.created_at)) >= datetime(?)) AS friend_add_routing_count,
          (SELECT MAX(COALESCE(r.completed_at, r.updated_at, r.created_at)) FROM friend_add_action_runs r
            JOIN friend_add_events e ON e.id = r.event_id
            WHERE e.line_account_id = ? AND r.status = 'completed') AS friend_add_routing_last`,
      binds: [
        account, since, account,
        account, account, since, account, account,
        account, since, account,
        account, since, account,
        account, since, account,
        account, since, account,
      ],
    },
    {
      ids: ['rich_menus', 'forms', 'media', 'common_vars'],
      sql: `/* usage-feature-content */
        SELECT
          (SELECT COUNT(*) FROM rich_menu_area_taps t
            WHERE t.line_account_id = ? AND datetime(t.tapped_at) >= datetime(?)) AS rich_menus_count,
          (SELECT MAX(t.tapped_at) FROM rich_menu_area_taps t
            WHERE t.line_account_id = ?) AS rich_menus_last,
          (SELECT COUNT(*) FROM form_submissions fs JOIN friends f ON f.id = fs.friend_id
            WHERE f.line_account_id = ? AND datetime(fs.created_at) >= datetime(?)) AS forms_count,
          (SELECT MAX(fs.created_at) FROM form_submissions fs JOIN friends f ON f.id = fs.friend_id
            WHERE f.line_account_id = ?) AS forms_last,
          (SELECT COUNT(*) FROM media m
            WHERE m.line_account_id = ? AND m.archived_at IS NULL
              AND datetime(m.created_at) >= datetime(?)) AS media_count,
          (SELECT MAX(m.created_at) FROM media m
            WHERE m.line_account_id = ? AND m.archived_at IS NULL) AS media_last,
          (SELECT COUNT(*) FROM common_var_versions v JOIN common_vars cv ON cv.id = v.common_var_id
            WHERE cv.line_account_id = ? AND datetime(v.created_at) >= datetime(?)) AS common_vars_count,
          (SELECT MAX(v.created_at) FROM common_var_versions v JOIN common_vars cv ON cv.id = v.common_var_id
            WHERE cv.line_account_id = ?) AS common_vars_last`,
      binds: [
        account, since, account,
        account, since, account,
        account, since, account,
        account, since, account,
      ],
    },
    {
      ids: ['inflow_tracking', 'affiliates', 'mileage', 'site_tracking'],
      sql: `/* usage-feature-results */
        SELECT
          (SELECT COUNT(*) FROM link_clicks c JOIN tracked_links l ON l.id = c.tracked_link_id
            WHERE l.line_account_id = ? AND datetime(c.clicked_at) >= datetime(?)) AS inflow_tracking_count,
          (SELECT MAX(c.clicked_at) FROM link_clicks c JOIN tracked_links l ON l.id = c.tracked_link_id
            WHERE l.line_account_id = ?) AS inflow_tracking_last,
          (SELECT COUNT(*) FROM conversion_events e JOIN friends f ON f.id = e.friend_id
            WHERE f.line_account_id = ? AND datetime(e.created_at) >= datetime(?)) AS affiliates_count,
          (SELECT MAX(e.created_at) FROM conversion_events e JOIN friends f ON f.id = e.friend_id
            WHERE f.line_account_id = ?) AS affiliates_last,
          (SELECT COUNT(*) FROM mileage_ledger l JOIN friends f ON f.id = l.beneficiary_friend_id
            WHERE f.line_account_id = ? AND datetime(l.occurred_at) >= datetime(?)) AS mileage_count,
          (SELECT MAX(l.occurred_at) FROM mileage_ledger l JOIN friends f ON f.id = l.beneficiary_friend_id
            WHERE f.line_account_id = ?) AS mileage_last,
          (SELECT COUNT(*) FROM site_events s
            WHERE s.line_account_id = ? AND datetime(s.occurred_at) >= datetime(?)) AS site_tracking_count,
          (SELECT MAX(s.occurred_at) FROM site_events s
            WHERE s.line_account_id = ?) AS site_tracking_last`,
      binds: [
        account, since, account,
        account, since, account,
        account, since, account,
        account, since, account,
      ],
    },
    {
      ids: [
        'automations', 'external_integrations', 'saved_searches', 'friend_fields',
        'support_marks', 'booking', 'events', 'webinars',
      ],
      sql: `/* usage-feature-ops */
        SELECT
          (SELECT COUNT(*) FROM automation_runs r
            WHERE r.line_account_id = ? AND r.is_test = 0
              AND r.status IN ('success', 'partial', 'failed')
              AND datetime(COALESCE(r.started_at, r.created_at)) >= datetime(?)) AS automations_count,
          (SELECT MAX(COALESCE(r.started_at, r.created_at)) FROM automation_runs r
            WHERE r.line_account_id = ? AND r.is_test = 0
              AND r.status IN ('success', 'partial', 'failed')) AS automations_last,
          (SELECT COUNT(*) FROM webhook_interaction_logs w
            WHERE w.line_account_id = ? AND w.direction = 'outgoing'
              AND datetime(w.started_at) >= datetime(?)) AS external_integrations_count,
          (SELECT MAX(w.started_at) FROM webhook_interaction_logs w
            WHERE w.line_account_id = ? AND w.direction = 'outgoing') AS external_integrations_last,
          (SELECT COUNT(*) FROM saved_search_usage_events u
            WHERE u.line_account_id = ? AND datetime(u.used_at) >= datetime(?)) AS saved_searches_count,
          (SELECT MAX(u.used_at) FROM saved_search_usage_events u
            WHERE u.line_account_id = ?) AS saved_searches_last,
          (SELECT COUNT(*) FROM friend_field_values v JOIN friends f ON f.id = v.friend_id
            WHERE f.line_account_id = ? AND datetime(v.updated_at) >= datetime(?)) AS friend_fields_count,
          (SELECT MAX(v.updated_at) FROM friend_field_values v JOIN friends f ON f.id = v.friend_id
            WHERE f.line_account_id = ?) AS friend_fields_last,
          (SELECT COUNT(*) FROM friends f
            WHERE f.line_account_id = ? AND f.support_mark_id IS NOT NULL) AS support_marks_count,
          (SELECT COUNT(*) FROM bookings b
            WHERE b.line_account_id = ? AND datetime(b.created_at) >= datetime(?)) AS booking_count,
          (SELECT MAX(b.created_at) FROM bookings b
            WHERE b.line_account_id = ?) AS booking_last,
          (SELECT COUNT(*) FROM event_bookings b
            WHERE b.line_account_id = ? AND datetime(b.created_at) >= datetime(?)) AS events_count,
          (SELECT MAX(b.created_at) FROM event_bookings b
            WHERE b.line_account_id = ?) AS events_last,
          (SELECT COUNT(*) FROM webinar_registrations r JOIN friends f ON f.id = r.friend_id
            WHERE f.line_account_id = ? AND datetime(r.created_at) >= datetime(?)) AS webinars_count,
          (SELECT MAX(r.created_at) FROM webinar_registrations r JOIN friends f ON f.id = r.friend_id
            WHERE f.line_account_id = ?) AS webinars_last`,
      binds: [
        account, since, account,
        account, since, account,
        account, since, account,
        account, since, account,
        account,
        account, since, account,
        account, since, account,
        account, since, account,
      ],
    },
    {
      ids: ['photo_review', 'ec_commerce', 'line_notifications', 'nen_campaigns'],
      sql: `/* usage-feature-specialized */
        SELECT
          (SELECT COUNT(*) FROM nen_photo_submissions s
            WHERE s.line_account_id = ? AND datetime(s.created_at) >= datetime(?)) AS photo_review_count,
          (SELECT MAX(s.created_at) FROM nen_photo_submissions s
            WHERE s.line_account_id = ?) AS photo_review_last,
          (SELECT COUNT(*) FROM ec_events e
            WHERE e.line_account_id = ? AND datetime(e.received_at) >= datetime(?)) AS ec_commerce_count,
          (SELECT MAX(e.received_at) FROM ec_events e
            WHERE e.line_account_id = ?) AS ec_commerce_last,
          (SELECT COUNT(*) FROM notification_deliveries d
            WHERE d.line_account_id = ? AND d.audience_type = 'customer'
              AND datetime(d.queued_at) >= datetime(?)) AS line_notifications_count,
          (SELECT MAX(d.queued_at) FROM notification_deliveries d
            WHERE d.line_account_id = ? AND d.audience_type = 'customer') AS line_notifications_last,
          (SELECT COUNT(*) FROM nen_delivery_jobs j
            WHERE j.line_account_id = ? AND j.status = 'sent'
              AND datetime(j.sent_at) >= datetime(?)) AS nen_campaigns_count,
          (SELECT MAX(j.sent_at) FROM nen_delivery_jobs j
            WHERE j.line_account_id = ? AND j.status = 'sent') AS nen_campaigns_last`,
      binds: [
        account, since, account,
        account, since, account,
        account, since, account,
        account, since, account,
      ],
    },
  ];
  const measures = new Map<FeatureId, FeatureUsageMeasure>();
  await Promise.all(groups.map(async (group) => {
    try {
      const row = await db
        .prepare(group.sql)
        .bind(...group.binds)
        .first<Record<string, number | string | null>>();
      for (const id of group.ids) {
        measures.set(id, {
          count: row && row[`${id}_count`] != null ? Number(row[`${id}_count`]) : null,
          lastUsedAt: row ? ((row[`${id}_last`] as string | null | undefined) ?? null) : null,
          failed: !row,
        });
      }
    } catch {
      for (const id of group.ids) {
        measures.set(id, { count: null, lastUsedAt: null, failed: true });
      }
    }
  }));
  return measures;
}
