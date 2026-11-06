import { arrayMove } from '@dnd-kit/sortable'
import { DASHBOARD_TODAY_VISIBLE_LIMIT, type DashboardCardId } from '@line-crm/shared'
import type { DashboardPreferenceItem } from './dashboard-preference-defaults'

// V8の編集画面が使う配置の計算。旧編集画面は削除済み。
export {
  DASHBOARD_CARD_DEFINITIONS,
  defaultDashboardPreferences,
  normalizeDashboardPreferences,
} from './dashboard-preference-defaults'
export type {
  DashboardGroup,
  DashboardPreferenceItem,
  DashboardPreferences,
} from './dashboard-preference-defaults'
export type { DashboardCardId }
export const TODAY_TASK_LIMIT = DASHBOARD_TODAY_VISIBLE_LIMIT

export function reorderDashboardItems(
  items: DashboardPreferenceItem[],
  activeId: DashboardCardId,
  overId: DashboardCardId,
): DashboardPreferenceItem[] {
  const oldIndex = items.findIndex((item) => item.id === activeId)
  const newIndex = items.findIndex((item) => item.id === overId)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return items
  return arrayMove(items, oldIndex, newIndex)
}

/*
 * R116: ドラッグを使わない1つずつの移動。タッチやマウスだけ、キーボード
 * だけのどちらでも順番を変えられるようにする。端では何もしない。
 */
export function moveDashboardItem(
  items: DashboardPreferenceItem[],
  id: DashboardCardId,
  direction: 'up' | 'down',
): DashboardPreferenceItem[] {
  const index = items.findIndex((item) => item.id === id)
  const next = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || next < 0 || next >= items.length) return items
  return arrayMove(items, index, next)
}

/** 「今日やること」の5枚目をONにしたとき、並びのいちばん下を自動でOFFにする。 */
export function toggleDashboardItem(
  items: DashboardPreferenceItem[],
  id: DashboardCardId,
  limit?: number,
): DashboardPreferenceItem[] {
  const target = items.find((item) => item.id === id)
  if (!target) return items

  const toggled = items.map((item) => item.id === id ? { ...item, visible: !item.visible } : item)
  if (target.visible || limit === undefined) return toggled
  if (toggled.filter((item) => item.visible).length <= limit) return toggled

  const lowestVisible = toggled.findLast((item) => item.visible)
  return lowestVisible
    ? toggled.map((item) => item.id === lowestVisible.id ? { ...item, visible: false } : item)
    : toggled
}
