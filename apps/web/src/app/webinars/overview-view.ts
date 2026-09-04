import type { WebinarOverview, WebinarOverviewMetric } from '@/lib/api'

export const NOT_AVAILABLE = '—'

export type MetricView = {
  text: string
  note: string | null
  available: boolean
}

export function metricView(
  metric: WebinarOverviewMetric | undefined,
  unit: string,
): MetricView {
  if (!metric || metric.state !== 'available' || metric.value === null) {
    return {
      text: NOT_AVAILABLE,
      note: metric?.reason ?? '取得できていません',
      available: false,
    }
  }

  return {
    text: `${metric.value.toLocaleString('ja-JP')}${unit}`,
    note: null,
    available: true,
  }
}

export function rateView(metric: WebinarOverviewMetric | undefined): MetricView {
  if (!metric || metric.state !== 'available' || metric.value === null) {
    return {
      text: NOT_AVAILABLE,
      note: metric?.reason ?? '取得できていません',
      available: false,
    }
  }

  return {
    text: `${Math.round(metric.value * 1000) / 10}%`,
    note: null,
    available: true,
  }
}

export type OverviewCard = {
  key: 'webinars' | 'registrations' | 'viewers' | 'cta'
  title: string
  view: MetricView
  detail: string | null
}

/**
 * 一覧上部の4指標。人数と延べ件数を混ぜず、取得不能な指標は0にしない。
 */
export function overviewCards(overview: WebinarOverview | null): OverviewCard[] {
  const metrics = overview?.metrics
  const bookings = metricView(metrics?.registrationBookings, '件')
  const viewRate = rateView(metrics?.viewRate)

  return [
    {
      key: 'webinars',
      title: 'ウェビナー数',
      view: metricView(metrics?.webinars, '件'),
      detail:
        metrics?.activeWebinars.state === 'available' && metrics.activeWebinars.value !== null
          ? `公開中 ${metrics.activeWebinars.value.toLocaleString('ja-JP')}件`
          : null,
    },
    {
      key: 'registrations',
      title: '申込',
      view: metricView(metrics?.registrations, '人'),
      detail: bookings.available ? `延べ予約 ${bookings.text}` : null,
    },
    {
      key: 'viewers',
      title: '視聴',
      view: metricView(metrics?.viewers, '人'),
      detail: viewRate.available
        ? `視聴率 ${viewRate.text}`
        : `視聴率 ${NOT_AVAILABLE}（${viewRate.note}）`,
    },
    {
      key: 'cta',
      title: 'CTA反応',
      view: metricView(metrics?.ctaUniquePeople, '人'),
      detail: 'クリックした人',
    },
  ]
}

export function audienceText(
  audience: { people: number; bookings: number; definition: string } | undefined,
): { people: string; note: string } {
  if (!audience) {
    return { people: NOT_AVAILABLE, note: '対象人数を読み込めていません' }
  }

  return {
    people: `${audience.people.toLocaleString('ja-JP')}人`,
    note: `取消を除いた有効な申込。延べ予約は${audience.bookings.toLocaleString('ja-JP')}件`,
  }
}
