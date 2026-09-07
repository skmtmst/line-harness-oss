type TimeInterval = { start: string; end: string }
type BusinessHoursDay = { weekday: number; intervals: TimeInterval[] }

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

export function shortTime(value: string): string {
  return value.replace(/^0/, '')
}

export function openHours(intervals: TimeInterval[]): string {
  if (intervals.length === 0) return '—'
  return `${shortTime(intervals[0].start)} 〜 ${shortTime(intervals[intervals.length - 1].end)}`
}

export function breakHours(intervals: TimeInterval[]): string {
  if (intervals.length < 2) return intervals.length === 0 ? '—' : 'なし'
  return intervals.slice(0, -1).map((interval, index) => (
    `${shortTime(interval.end)} 〜 ${shortTime(intervals[index + 1].start)}`
  )).join(' / ')
}

export function shortDate(value: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${Number(match[1])}/${Number(match[2])}` : value
}

export function businessHourSummary(
  businessHours: BusinessHoursDay[] | null | undefined,
): { value: string; detail: string } {
  if (!businessHours?.length) return { value: '—', detail: '受付枠で曜日ごとに確認' }
  const spans = businessHours.flatMap((day) => {
    if (day.intervals.length === 0) return []
    const last = day.intervals.at(-1)
    if (!last) return []
    return [`${shortTime(day.intervals[0].start)}〜${shortTime(last.end)}`]
  })
  const counts = new Map<string, number>()
  for (const span of spans) counts.set(span, (counts.get(span) ?? 0) + 1)
  const value = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '—'
  const detail = businessHours
    .filter((day) => day.intervals.length > 0)
    .map((day) => WEEKDAYS[day.weekday] ?? '')
    .filter(Boolean)
    .join('・')
  return { value, detail }
}

export function bookingWindowEnd(days: number, now = new Date()): string {
  const date = new Date(now)
  date.setDate(date.getDate() + Math.max(0, days - 1))
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).format(date)
}
