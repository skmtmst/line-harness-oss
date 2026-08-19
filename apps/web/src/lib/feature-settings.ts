import { MENU_SECTIONS, type MenuItem } from './menu'

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
  | 'automations'
  | 'external_integrations'
  | 'friend_add_routing'
  | 'nen_campaigns'
  | 'photo_review'
  | 'ec_commerce'

export interface FeatureItem {
  id: string
  label: string
  note: string
  /** オン／オフに使うキー。空なら常に有効。 */
  keys: FeatureKey[]
  badge?: '専用'
  required?: boolean
}

export interface FeatureGroup {
  id: string
  label: string
  items: FeatureItem[]
}

export const FEATURE_SETTINGS_UPDATED_EVENT = 'line-harness:feature-settings-updated'
export const SPECIALIZED_FEATURE_KEYS: FeatureKey[] = ['nen_campaigns', 'photo_review', 'ec_commerce']

/**
 * 記録が無い契約の初期状態。
 *
 * V2 10-3 でオフと決めたものだけ false。ここに無いキーがあると機能設定の
 * 「変更あり」の判定から漏れるので、FeatureKey と同じ数だけ並べる。
 */
export const DEFAULT_FEATURES: Record<FeatureKey, boolean> = {
  scenarios: true,
  broadcasts: true,
  templates: true,
  reminders: true,
  auto_replies: true,
  rich_menus: true,
  webinars: false,
  inflow_tracking: true,
  forms: true,
  mileage: true,
  affiliates: false,
  analytics: true,
  media: true,
  events: true,
  booking: true,
  automations: true,
  external_integrations: true,
  friend_add_routing: true,
  nen_campaigns: true,
  photo_review: true,
  ec_commerce: true,
}

function toFeatureItem(item: MenuItem): FeatureItem {
  return {
    id: item.id,
    label: item.label,
    note: item.note,
    keys: item.featureKey ? [item.featureKey] : [],
    required: item.required,
    badge: item.featureKey && SPECIALIZED_FEATURE_KEYS.includes(item.featureKey) ? '専用' : undefined,
  }
}

/**
 * 機能設定に出す区分。サイドメニューの区分と項目をそのまま写す。
 *
 * 別々に並べていた頃は、機能設定にしか無い項目・メニューにしか無い項目が
 * 双方にあった。1か所（MENU_SECTIONS）から作る。
 */
export const FEATURE_GROUPS: FeatureGroup[] = MENU_SECTIONS.map((section) => ({
  id: section.id,
  label: section.title,
  items: section.items.map(toFeatureItem),
}))

/** URL からオン／オフのキーを引く。サイドバーが表示を決めるのに使う。 */
export const SIDEBAR_FEATURE_BY_HREF: Partial<Record<string, FeatureKey>> = Object.fromEntries(
  MENU_SECTIONS.flatMap((section) =>
    section.items.filter((item) => item.featureKey).map((item) => [item.href, item.featureKey!]),
  ),
)

export function itemIsEnabled(item: FeatureItem, features: Record<string, boolean>): boolean {
  if (item.required || item.keys.length === 0) return true
  return item.keys.every((key) => features[key] !== false)
}

/** 区分の中で、切り替えられる項目の数。 */
export function groupFeatureCount(group: FeatureGroup): number {
  return group.items.filter((item) => !item.required && item.keys.length > 0).length
}

/** 区分の中で、いま有効な項目の数。 */
export function groupEnabledCount(group: FeatureGroup, features: Record<string, boolean>): number {
  return group.items.filter(
    (item) => !item.required && item.keys.length > 0 && itemIsEnabled(item, features),
  ).length
}

/**
 * 画面に出す区分。
 *
 * 専用機能は、この契約で専門設計してあるものだけを出す。カタログが空の
 * サービスでは区分ごと出さない。切り替えられる項目が1つも無い区分
 * （設定など）は、スイッチが並ばないので出さない。
 */
export function visibleFeatureGroups(options: { specializedFeatureKeys: string[] }): FeatureGroup[] {
  const specialized = new Set(options.specializedFeatureKeys)
  return FEATURE_GROUPS.map((group) =>
    group.id === 'specialized'
      ? { ...group, items: group.items.filter((item) => item.keys.some((key) => specialized.has(key))) }
      : group,
  ).filter((group) => group.items.length > 0)
}

/** 並び順の保存の形。区分の目印ごとに、項目の目印を並べて持つ。 */
export type MenuItemOrder = Record<string, string[]>

/** いまの並びを、そのまま保存できる形にする。 */
export function itemOrderFromGroups(groups: FeatureGroup[]): MenuItemOrder {
  return Object.fromEntries(groups.map((group) => [group.id, group.items.map((item) => item.id)]))
}

/**
 * 区分の中で1つ動かす。区分をまたいでは動かせない。
 *
 * またげるようにすると「受信箱を配信の中へ」といった並びが作れてしまい、
 * サイドバーの見出しと中身が合わなくなる。
 */
export function moveItemWithinGroup(ids: string[], id: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
