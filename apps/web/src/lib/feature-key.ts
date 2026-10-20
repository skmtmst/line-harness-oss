'use client'

/**
 * オン／オフを持てる機能。
 *
 * ここに無いキーはサーバーが受け付けない（worker の TOGGLEABLE_FEATURES と
 * 対で保つ）。打ち間違いをそのまま保存できるようにすると、「切ったはずなのに
 * 出ている」という形で表に出る。
 */
export type FeatureKey =
  | 'scenarios'
  | 'broadcasts'
  | 'templates'
  | 'reminders'
  | 'auto_replies'
  | 'rich_menus'
  | 'webinars'
  | 'inflow_tracking'
  | 'forms'
  | 'mileage'
  | 'affiliates'
  | 'analytics'
  | 'media'
  | 'events'
  | 'booking'
  | 'visit_stamps'
  | 'automations'
  | 'external_integrations'
  | 'friend_add_routing'
  | 'nen_campaigns'
  | 'photo_review'
  | 'ec_commerce'
  | 'line_notifications'
  | 'restaurant_test'
  | 'multi_store_hierarchy'
  | 'friend_fields'
  | 'support_marks'
  | 'saved_searches'
  | 'common_vars'
  | 'site_tracking'
