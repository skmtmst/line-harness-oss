import type { ChatStatusInfo } from './friend-info-types'
/**  知らせの文に使う対応状況の名前（受信箱の状態の切り替えと同じ言葉）。 */
export const STATUS_WORD: Record<NonNullable<ChatStatusInfo['status']>, string> = {
  unread: '未対応',
  in_progress: '対応中',
  on_hold: '保留',
  resolved: '対応済み',
}

export const STATUS_OPTIONS: Array<{ value: NonNullable<ChatStatusInfo['status']>; label: string }> = [
  { value: 'unread', label: '未対応' },
  { value: 'in_progress', label: '対応中' },
  { value: 'on_hold', label: '保留' },
  { value: 'resolved', label: '対応済み' },
]
