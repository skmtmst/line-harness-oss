/**
 * 会社ごとの機能設定で切り替えられる機能の正本。
 *
 * featureId は account_settings の既存キー `feature.<featureId>` と同じ値を使う。
 * 保存済み設定との対応を壊すため、表示名変更を理由に改名してはいけない。
 */
export const FEATURE_CATALOG = [
  { featureId: 'scenarios', defaultEnabled: true, required: false, bundleId: 'scenarios', disablePolicy: 'stop' },
  { featureId: 'broadcasts', defaultEnabled: true, required: false, bundleId: 'broadcasts', disablePolicy: 'stop' },
  { featureId: 'templates', defaultEnabled: true, required: false, bundleId: 'templates', disablePolicy: 'stop' },
  { featureId: 'reminders', defaultEnabled: true, required: false, bundleId: 'reminders', disablePolicy: 'stop' },
  { featureId: 'auto_replies', defaultEnabled: true, required: false, bundleId: 'auto_replies', disablePolicy: 'stop' },
  { featureId: 'rich_menus', defaultEnabled: true, required: false, bundleId: 'rich_menus', disablePolicy: 'stop' },
  { featureId: 'inflow_tracking', defaultEnabled: true, required: false, bundleId: 'inflow_tracking', disablePolicy: 'stop' },
  { featureId: 'forms', defaultEnabled: true, required: false, bundleId: 'forms', disablePolicy: 'stop' },
  { featureId: 'photo_review', defaultEnabled: true, required: false, bundleId: 'photo_review', disablePolicy: 'stop' },
  { featureId: 'automations', defaultEnabled: true, required: false, bundleId: 'automations', disablePolicy: 'stop' },
  { featureId: 'external_integrations', defaultEnabled: true, required: false, bundleId: 'external_integrations', disablePolicy: 'stop' },
  { featureId: 'friend_add_routing', defaultEnabled: true, required: false, bundleId: 'friend_add_routing', disablePolicy: 'stop' },
  { featureId: 'multi_store_hierarchy', defaultEnabled: false, required: false, bundleId: 'multi_store_hierarchy', disablePolicy: 'stop' },
  { featureId: 'multi_store_bulk_updates', defaultEnabled: false, required: false, bundleId: 'multi_store_bulk_updates', disablePolicy: 'stop' },
  { featureId: 'reservation_ledger', defaultEnabled: false, required: false, bundleId: 'reservation_ledger', disablePolicy: 'stop' },
  { featureId: 'external_reservations', defaultEnabled: false, required: false, bundleId: 'external_reservations', disablePolicy: 'stop' },
  { featureId: 'google_business_profile', defaultEnabled: false, required: false, bundleId: 'google_business_profile', disablePolicy: 'stop' },
  { featureId: 'friend_fields', defaultEnabled: true, required: false, bundleId: 'friend_fields', disablePolicy: 'stop' },
  { featureId: 'support_marks', defaultEnabled: true, required: false, bundleId: 'support_marks', disablePolicy: 'stop' },
  { featureId: 'saved_searches', defaultEnabled: true, required: false, bundleId: 'saved_searches', disablePolicy: 'stop' },
  { featureId: 'media', defaultEnabled: true, required: false, bundleId: 'common_content', disablePolicy: 'stop' },
  { featureId: 'common_vars', defaultEnabled: true, required: false, bundleId: 'common_content', disablePolicy: 'stop' },
  { featureId: 'analytics', defaultEnabled: true, required: false, bundleId: 'analytics', disablePolicy: 'stop' },
  { featureId: 'site_tracking', defaultEnabled: true, required: false, bundleId: 'site_tracking', disablePolicy: 'stop' },
  { featureId: 'webinars', defaultEnabled: false, required: false, bundleId: 'webinars', disablePolicy: 'stop' },
  { featureId: 'events', defaultEnabled: true, required: false, bundleId: 'events', disablePolicy: 'stop' },
  { featureId: 'booking', defaultEnabled: true, required: false, bundleId: 'booking', disablePolicy: 'stop' },
  { featureId: 'affiliates', defaultEnabled: false, required: false, bundleId: 'affiliates', disablePolicy: 'stop' },
  { featureId: 'mileage', defaultEnabled: true, required: false, bundleId: 'mileage', disablePolicy: 'stop' },
  { featureId: 'ec_commerce', defaultEnabled: true, required: false, bundleId: 'ec_commerce', disablePolicy: 'stop' },
  { featureId: 'line_notifications', defaultEnabled: true, required: false, bundleId: 'line_notifications', disablePolicy: 'stop' },
  { featureId: 'nen_campaigns', defaultEnabled: true, required: false, bundleId: 'nen_campaigns', disablePolicy: 'stop' },
  { featureId: 'restaurant_test', defaultEnabled: true, required: false, bundleId: 'restaurant_test', disablePolicy: 'stop' },
] as const;

export type FeatureId = (typeof FEATURE_CATALOG)[number]['featureId'];

export const FEATURE_IDS = FEATURE_CATALOG.map(({ featureId }) => featureId) as FeatureId[];

export function featureCatalogEntry(featureId: FeatureId) {
  return FEATURE_CATALOG.find((item) => item.featureId === featureId)!;
}
