import type { IndustryStyle, StyleAnalyticsData, StyleMetric } from '@line-crm/shared'
import type { StyleAnalytics } from './model'

const count = (metric: StyleMetric | undefined): number | null => metric?.status === 'available'
  && typeof metric.value === 'number' && Number.isFinite(metric.value) && metric.value >= 0 ? metric.value : null

/** Pair the same ordinal day of the selected and comparison periods. */
export function dailyAnalyticsSeries(style: IndustryStyle, comparison: StyleAnalyticsData['dailyComparison']): NonNullable<StyleAnalytics['chart']> {
  const key = style === 'restaurant' ? 'bookings' : 'visits'
  const points = (comparison?.current ?? []).map((day, index) => {
    const previous = comparison?.previous?.[index]
    return { label: day.date, now: count(day.metrics[key]), prev: count(previous?.metrics[key]), previousLabel: previous?.date }
  })
  const values = points.flatMap(p => [p.now, p.prev]).filter((value): value is number => value !== null)
  const max = Math.max(1, ...values)
  const axisIdx = points.length ? [0, Math.floor(points.length / 4), Math.floor(points.length / 2), Math.floor(points.length * 3 / 4), points.length - 1] : []
  const axis = [...new Set(axisIdx)].map(index => {
    const date = new Date(`${points[index].label}T00:00:00Z`)
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
  })
  return {
    title: style === 'salon' ? '日ごとの来店（来店日で数える）' : style === 'consult' ? '日ごとの実施した面談（面談日で数える）' : style === 'lesson' ? '日ごとの出席' : '日ごとの予約（来店日で数える）',
    help: '選択した期間と比較期間の同じ順番の日を並べます。取得できていない値は表示しません。',
    ticks: [String(max), String(Math.round(max / 2)), '0'], axis, points, max,
    ...(values.length ? {} : { emptyMessage: '日ごとの集計はまだ取得できていません。' }),
  }
}
