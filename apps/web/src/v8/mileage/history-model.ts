import { jstDateOffset, jstDate } from '@/lib/jst-datetime'
import type { MileageAdminHistoryItem } from '@/lib/api'

export function viewName(item: MileageAdminHistoryItem) {
  return item.displayName || '名前未取得'
}

/* 「付けた」に入る種類。ほかは「使った・取り消し」へ。 */
export function isGranted(item: MileageAdminHistoryItem) {
  return item.entryType === 'grant'
}

export const PRESETS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'よく使う絞り込み' },
  { value: 'granted', label: '付けたのみ' },
  { value: 'spent', label: '使った・取り消しのみ' },
  { value: 'manual', label: '手で動かした分のみ' },
  { value: 'month', label: '今月のみ' },
  { value: 'week', label: '過去7日のみ' },
  { value: 'custom', label: '日付・種類・状態を指定' },
]

export function monthStart(): string {
  return jstDate().slice(0, 7) + '-01'
}

export function daysAgo(days: number) {
  return jstDateOffset(-days)
}

