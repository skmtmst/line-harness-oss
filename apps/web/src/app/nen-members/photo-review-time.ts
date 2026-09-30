import { formatDateTime } from '@/lib/format'
/** 写真が届いた時刻を、運用画面の基準である日本時間へそろえる。 */
export function formatPhotoReceivedAt(value: unknown): string {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) return '—'
  return formatDateTime(date)
}
