import type { MileageHistoryItem } from '@/lib/api'

const ENTRY_TYPE_LABELS: Record<MileageHistoryItem['entryType'], string> = {
  grant: '付与',
  reversal: '取消',
  spend: '使用',
  expiration: '失効',
  adjustment: '手動調整',
}

const STATUS_LABELS: Record<MileageHistoryItem['status'], string> = {
  pending: '確定待ち',
  available: '利用可能',
  void: '取消済み',
}

const SOURCE_LABELS: Record<string, string> = {
  line: 'LINE',
  line_relationship: '友だち登録・継続',
  tracked_link: '計測リンク',
  form: '回答フォーム',
  booking: '予約',
  webinar: 'ウェビナー',
  instagram: 'Instagram',
  stripe: '購入',
  tag: 'タグ',
  tag_referral: '紹介',
  affiliate: '紹介成果',
  affiliate_conversion: '紹介成果',
  friend_add_routing: '友だち追加',
  rich_menu: 'リッチメニュー',
  event_booking: 'イベント予約',
  manual: '手動調整',
  admin_adjustment: '手動調整',
}

export function mileageEntryTypeLabel(value: MileageHistoryItem['entryType']): string {
  return ENTRY_TYPE_LABELS[value]
}

export function mileageStatusLabel(value: MileageHistoryItem['status']): string {
  return STATUS_LABELS[value]
}

/** 内部のイベント名をそのまま画面へ出さない。 */
export function mileageSourceLabel(value: string): string {
  return SOURCE_LABELS[value] ?? 'その他の自動処理'
}

export function formatMileageChange(value: number): string {
  const number = Math.abs(value).toLocaleString('ja-JP')
  if (value > 0) return `+${number}`
  if (value < 0) return `−${number}`
  return '0'
}

export function formatMileageDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
