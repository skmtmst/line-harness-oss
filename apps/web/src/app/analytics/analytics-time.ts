/** 分析の日時を、画面内で統一して日本時間へそろえる。 */
export function formatAnalyticsDateTime(value: string | null): string {
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

/**
 * 集計期間やコホートの日付だけを、日本時間の暦日で出す。
 * toLocaleDateString は端末の地域を使うため、日本より遅い地域で開くと
 * 1日前の日付にずれて「同じ条件のはずの表と注記」が食い違う。
 */
export function formatAnalyticsDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date)
}

const WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土'] as const

/**
 * 日付列(YYYY-MM-DD)の曜日。日付そのものの曜日は地域に依らないので、
 * UTCの暦日として読む。getDay() は端末の地域を使い、日本より遅い地域では
 * 前日の曜日を返してしまう。
 */
export function analyticsWeekday(date: string): string {
  return WEEKDAY_JP[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? ''
}
