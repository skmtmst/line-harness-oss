/** 飲食店で使う左メニューと機能設定の区分。項目IDは共通メニューの正本を参照する。 */
import { FEATURE_CATALOG, type FeatureId } from './feature-catalog.js';
import { MENU_SECTION_CATALOG } from './menu-catalog.js';
export const RESTAURANT_MENU_LAYOUT = [
  { id: 'basic', label: 'メイン', itemIds: ['dashboard', 'inbox', 'friends', 'friend-attributes', 'restaurant-reservations', 'visit-stamps'] },
  { id: 'restaurant-booking', label: '予約・来店', itemIds: ['restaurant-tables', 'restaurant-inventory', 'restaurant-menu', 'events'] },
  { id: 'restaurant-operations', label: '店舗運営', itemIds: ['restaurant-delivery', 'restaurant-google', 'restaurant-line-followup'] },
  { id: 'delivery', label: '配信', itemIds: ['scenarios', 'broadcasts', 'reminders', 'auto-replies', 'friend-add-settings', 'webinars'] },
  { id: 'contents', label: 'コンテンツ', itemIds: ['templates', 'rich-menus', 'forms', 'common-vars', 'contents'] },
  { id: 'results', label: '成果と分析', itemIds: ['affiliates', 'mileage', 'inflow', 'conversions', 'analytics'] },
  { id: 'automation', label: '自動化', itemIds: ['automations', 'webhooks'] },
  { id: 'specialized', label: '専用機能', itemIds: ['nen-members', 'nen-pets', 'nen-health', 'photo-review', 'nen-campaigns'] },
  { id: 'settings', label: '設定', itemIds: ['getting-started', 'line-accounts', 'pools', 'staff', 'settings', 'emergency', 'ec-commerce'] },
] as const;

export const RESTAURANT_DEFAULT_OFF_FEATURES = [
  'mileage', 'inflow_tracking', 'site_tracking', 'analytics',
  'automations', 'external_integrations', 'webinars', 'events',
] as const;

/** メイン以外の飲食店専用項目は、機能ごとに表示を切り替えられる。 */
export const RESTAURANT_OPTIONAL_ITEM_IDS = [
  'restaurant-tables', 'restaurant-inventory', 'restaurant-menu',
  'restaurant-delivery', 'restaurant-google', 'restaurant-line-followup',
] as const;

/** 新しく飲食店を選んだアカウントだけに保存する機能の初期値。 */
export function restaurantDefaultFeatures(): Record<FeatureId, boolean> {
  const off = new Set<string>(RESTAURANT_DEFAULT_OFF_FEATURES);
  return Object.fromEntries(FEATURE_CATALOG.map(({ featureId, defaultEnabled }) => [
    featureId, defaultEnabled && !off.has(featureId),
  ])) as Record<FeatureId, boolean>;
}

/** 飲食店の保存順を検証するときの完全な項目集合。 */
export function expectedRestaurantMenuItemOrder(specializedFeatureKeys: ReadonlySet<string>): Record<string, string[]> {
  const source = new Map(MENU_SECTION_CATALOG.flatMap((section) =>
    section.items.map((item) => [item.id, item] as const)));
  return Object.fromEntries(RESTAURANT_MENU_LAYOUT.flatMap((section) => {
    const ids = section.itemIds.filter((id) => {
      const item = source.get(id);
      return item && (section.id !== 'specialized' || (item.featureKey && specializedFeatureKeys.has(item.featureKey)));
    });
    return ids.length ? [[section.id, ids]] : [];
  }));
}
