import { FEATURE_CATALOG, FEATURE_IDS, type FeatureId } from '@line-crm/shared'
import type { FeatureGroup, FeatureItem, MenuItemOrder } from '@/lib/feature-settings'

export const CATALOG_DEFAULT_FEATURES: Record<FeatureId, boolean> = Object.fromEntries(
  FEATURE_CATALOG.map(({ featureId, defaultEnabled }) => [featureId, defaultEnabled]),
) as Record<FeatureId, boolean>

/** API の不足値や余分な値を、共有カタログの顔ぶれへそろえる。 */
export function normalizeFeatureSettings(raw: Record<string, boolean> = {}): Record<FeatureId, boolean> {
  return Object.fromEntries(FEATURE_CATALOG.map(({ featureId, defaultEnabled }) => [
    featureId,
    typeof raw[featureId] === 'boolean' ? raw[featureId] : defaultEnabled,
  ])) as Record<FeatureId, boolean>
}

/** 保存順を定義順へ当てる。画面表示と変更判定の両方がこの結果を見る。 */
export function applyItemOrder(groups: FeatureGroup[], itemOrder: MenuItemOrder): FeatureGroup[] {
  return groups.map((group) => {
    const order = itemOrder[group.id]
    if (!order || order.length === 0) return group
    const byId = new Map(group.items.map((item) => [item.id, item]))
    const sorted: FeatureItem[] = []
    for (const id of order) {
      const item = byId.get(id)
      if (item && !sorted.includes(item)) sorted.push(item)
    }
    return { ...group, items: [...sorted, ...group.items.filter((item) => !sorted.includes(item))] }
  })
}

/** 3列を手書きIDで固定せず、カタログから出来た区分を同じ密度へ分ける。 */
export function splitFeatureGroups(groups: FeatureGroup[], columnCount = 3): FeatureGroup[][] {
  if (columnCount <= 1 || groups.length <= 1) return [groups]
  const targetSize = Math.ceil(
    groups.reduce((total, group) => total + group.items.length, 0) / columnCount,
  )
  const columns: FeatureGroup[][] = []
  let column: FeatureGroup[] = []
  let size = 0
  for (const group of groups) {
    if (column.length > 0 && size + group.items.length > targetSize && columns.length < columnCount - 1) {
      columns.push(column)
      column = []
      size = 0
    }
    column.push(group)
    size += group.items.length
  }
  columns.push(column)
  return columns
}

export function featureSettingsAreDirty(input: {
  savedFeatures: Record<string, boolean>
  features: Record<string, boolean>
  savedOrder: MenuItemOrder
  currentOrder: MenuItemOrder
}): boolean {
  return FEATURE_IDS.some((key) => input.features[key] !== input.savedFeatures[key])
    || JSON.stringify(input.currentOrder) !== JSON.stringify(input.savedOrder)
}

export const FEATURE_SETTINGS_CONFLICT_MESSAGE =
  'ほかの管理者が先に保存しました。最新の状態を読み直したので、内容を確認してもう一度保存してください。'

export function featureSettingsErrorMessage(status: number | undefined, action: 'load' | 'save'): string {
  if (status === 403) {
    return action === 'save'
      ? '機能設定を変更する権限がありません。オーナーか管理者に依頼してください。'
      : '機能設定を見る権限がありません。オーナーか管理者に依頼してください。'
  }
  return action === 'save'
    ? '保存できませんでした。通信状態を確認して、もう一度お試しください。'
    : '機能設定を読み込めませんでした。時間をおいてもう一度お試しください。'
}
