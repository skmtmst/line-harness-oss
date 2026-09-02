/** 写真が届いた時刻を、運用画面の基準である日本時間へそろえる。 */
export function formatPhotoReceivedAt(value: unknown): string {
  const date = new Date(String(value ?? ''))
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
