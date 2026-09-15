/**
 * 会社ごとの機能設定で切り替えられる機能の正本。
 *
 * featureId は account_settings の既存キー `feature.<featureId>` と同じ値を使う。
 * 保存済み設定との対応を壊すため、表示名変更を理由に改名してはいけない。
 */
export const FEATURE_CATALOG = [
  { featureId: 'scenarios', defaultEnabled: true, required: false, bundleId: 'scenarios', entitlementKey: 'send', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'broadcasts', defaultEnabled: true, required: false, bundleId: 'broadcasts', entitlementKey: 'send', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'templates', defaultEnabled: true, required: false, bundleId: 'templates', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'reminders', defaultEnabled: true, required: false, bundleId: 'reminders', entitlementKey: 'send', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'auto_replies', defaultEnabled: true, required: false, bundleId: 'auto_replies', entitlementKey: 'send', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'rich_menus', defaultEnabled: true, required: false, bundleId: 'rich_menus', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'inflow_tracking', defaultEnabled: true, required: false, bundleId: 'inflow_tracking', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'forms', defaultEnabled: true, required: false, bundleId: 'forms', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'photo_review', defaultEnabled: true, required: false, bundleId: 'photo_review', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'automations', defaultEnabled: true, required: false, bundleId: 'automations', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'external_integrations', defaultEnabled: true, required: false, bundleId: 'external_integrations', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'friend_add_routing', defaultEnabled: true, required: false, bundleId: 'friend_add_routing', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'multi_store_hierarchy', defaultEnabled: false, required: false, bundleId: 'multi_store_hierarchy', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'multi_store_bulk_updates', defaultEnabled: false, required: false, bundleId: 'multi_store_bulk_updates', entitlementKey: 'included', dependencies: ['multi_store_hierarchy'], disablePolicy: 'stop' },
  { featureId: 'reservation_ledger', defaultEnabled: false, required: false, bundleId: 'reservation_ledger', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'external_reservations', defaultEnabled: false, required: false, bundleId: 'external_reservations', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'google_business_profile', defaultEnabled: false, required: false, bundleId: 'google_business_profile', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'friend_fields', defaultEnabled: true, required: false, bundleId: 'friend_fields', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'support_marks', defaultEnabled: true, required: false, bundleId: 'support_marks', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'saved_searches', defaultEnabled: true, required: false, bundleId: 'saved_searches', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'media', defaultEnabled: true, required: false, bundleId: 'common_content', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'common_vars', defaultEnabled: true, required: false, bundleId: 'common_content', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'analytics', defaultEnabled: true, required: false, bundleId: 'analytics', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'site_tracking', defaultEnabled: true, required: false, bundleId: 'site_tracking', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'webinars', defaultEnabled: false, required: false, bundleId: 'webinars', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'events', defaultEnabled: true, required: false, bundleId: 'events', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'booking', defaultEnabled: true, required: false, bundleId: 'booking', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'affiliates', defaultEnabled: false, required: false, bundleId: 'affiliates', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'mileage', defaultEnabled: true, required: false, bundleId: 'mileage', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'ec_commerce', defaultEnabled: true, required: false, bundleId: 'ec_commerce', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'line_notifications', defaultEnabled: true, required: false, bundleId: 'line_notifications', entitlementKey: 'send', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'nen_campaigns', defaultEnabled: true, required: false, bundleId: 'nen_campaigns', entitlementKey: 'send', dependencies: [], disablePolicy: 'stop' },
  { featureId: 'restaurant_test', defaultEnabled: true, required: false, bundleId: 'restaurant_test', entitlementKey: 'included', dependencies: [], disablePolicy: 'stop' },
] as const;

export type FeatureId = (typeof FEATURE_CATALOG)[number]['featureId'];
export type FeatureEntitlementKey = (typeof FEATURE_CATALOG)[number]['entitlementKey'];

export const FEATURE_IDS = FEATURE_CATALOG.map(({ featureId }) => featureId) as FeatureId[];

export function featureCatalogEntry(featureId: FeatureId) {
  return FEATURE_CATALOG.find((item) => item.featureId === featureId)!;
}

type DependencyCatalogEntry = {
  readonly featureId: string;
  readonly dependencies: readonly string[];
};

/**
 * カタログを読み込む時点で、入力ミスと循環を拒否する。
 * テストから小さな仮カタログも渡せるよう、検査に不要な項目は要求しない。
 */
export function assertValidFeatureCatalog(catalog: readonly DependencyCatalogEntry[]): void {
  const ids = new Set(catalog.map(({ featureId }) => featureId));
  if (ids.size !== catalog.length) throw new Error('機能カタログに重複したfeatureIdがあります');

  for (const entry of catalog) {
    for (const dependency of entry.dependencies) {
      if (!ids.has(dependency)) {
        throw new Error(`${entry.featureId} の存在しない依存先です: ${dependency}`);
      }
    }
  }

  const byId = new Map(catalog.map((entry) => [entry.featureId, entry]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (featureId: string, path: string[]): void => {
    if (visiting.has(featureId)) {
      const start = path.indexOf(featureId);
      throw new Error(`機能カタログの循環依存です: ${[...path.slice(start), featureId].join(' -> ')}`);
    }
    if (visited.has(featureId)) return;
    visiting.add(featureId);
    const nextPath = [...path, featureId];
    for (const dependency of byId.get(featureId)?.dependencies ?? []) visit(dependency, nextPath);
    visiting.delete(featureId);
    visited.add(featureId);
  };
  for (const featureId of ids) visit(featureId, []);
}

assertValidFeatureCatalog(FEATURE_CATALOG);
