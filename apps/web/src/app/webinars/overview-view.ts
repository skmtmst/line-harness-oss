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
  /** 3段目の短い状態。実測できたときは null。 */
  status: string | null
  /** 3段目の短い補足（公開中・延べ・視聴率など）。 */
  detail: string | null
  /**
   * 説明アイコンの中へ入れる詳しい理由。長文はカードを伸ばさないため
   * 常時表示せず、状態は status で隠さず残す。
   */
  description: string | null
}

const UNAVAILABLE_SHORT = '取得できていません'

const sentence = (text: string) => (/[。！？.!?]$/.test(text) ? text : `${text}。`)

/**
 * 同じ理由で出せない指標は説明の中でひとつにまとめ、
 * 違う理由なら指標ごとに分けて書く。
 */
function describeReasons(pairs: ReadonlyArray<readonly [string, string | null]>): string | null {
  const filled = pairs.filter((pair): pair is readonly [string, string] => Boolean(pair[1]))
  if (filled.length === 0) return null
  const uniqueNotes = [...new Set(filled.map(([, note]) => note))]
  if (uniqueNotes.length === 1) return sentence(uniqueNotes[0])
  return filled.map(([label, note]) => `${label}: ${sentence(note)}`).join('\n')
}

/**
 * 一覧上部の4指標。人数と延べ件数を混ぜず、取得不能な指標は0にしない。
 * 理由文はカードの3段目へ直置きせず、説明アイコンの中へまとめる。
 */
export function overviewCards(overview: WebinarOverview | null): OverviewCard[] {
  const metrics = overview?.metrics
  const webinars = metricView(metrics?.webinars, '件')
  const activeWebinars = metrics?.activeWebinars
  const bookings = metricView(metrics?.registrationBookings, '件')
  const registrations = metricView(metrics?.registrations, '人')
  const viewers = metricView(metrics?.viewers, '人')
  const viewRate = rateView(metrics?.viewRate)
  const cta = metricView(metrics?.ctaUniquePeople, '人')

  return [
    {
      key: 'webinars',
      title: 'ウェビナー数',
      view: webinars,
      status: webinars.available ? null : UNAVAILABLE_SHORT,
      detail:
        activeWebinars?.state === 'available' && activeWebinars.value !== null
          ? `公開中 ${activeWebinars.value.toLocaleString('ja-JP')}件`
          : null,
      description: describeReasons([
        ['ウェビナー数', webinars.note],
        [
          '公開中の数',
          activeWebinars && activeWebinars.state !== 'available' ? activeWebinars.reason : null,
        ],
      ]),
    },
    {
      key: 'registrations',
      title: '申込',
      view: registrations,
      status: registrations.available ? null : UNAVAILABLE_SHORT,
      detail: bookings.available ? `延べ予約 ${bookings.text}` : null,
      description: describeReasons([
        ['申込人数', registrations.note],
        ['延べ予約', bookings.note],
      ]),
    },
    {
      key: 'viewers',
      title: '視聴',
      view: viewers,
      status: viewers.available ? null : UNAVAILABLE_SHORT,
      /* 視聴率が出せないときも「—」だけを短く残し、理由は説明の中へ。 */
      detail: `視聴率 ${viewRate.text}`,
      description: describeReasons([
        ['視聴人数', viewers.note],
        ['視聴率', viewRate.note],
      ]),
    },
    {
      key: 'cta',
      title: 'CTA反応',
      view: cta,
      status: cta.available ? null : UNAVAILABLE_SHORT,
      detail: 'クリックした人',
      description: describeReasons([['CTA反応', cta.note]]),
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
