import type { WebinarOverview, WebinarOverviewMetric } from '@/lib/api'

/**
 * ウェビナー一覧の帯（設計 `ZC13r`）と通知の対象人数（`Ho8z4`）。
 *
 * **数えられないものを0にしない。** 口は `state: 'unavailable'` と理由を
 * 返す。`—` と理由をそのまま出し、画面で作り直さない。
 */

export const NOT_AVAILABLE = '—'

export type MetricView = {
  /** 画面に出す値。未取得は `—`。 */
  text: string
  /** 未取得のときだけ理由。実値0では出さない。 */
  note: string | null
  available: boolean
}

/**
 * 1つの数の見え方。
 *
 * `available` かつ 0 は **`0`**（実値0）。`unavailable` は **`—`** と理由。
 * 理由が無いまま `—` にしない——「読めていない」のか「まだ無い」のかが
 * 分からなくなる。
 */
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
  return { text: `${metric.value.toLocaleString('ja-JP')}${unit}`, note: null, available: true }
}

/** 平均視聴時間は秒で返る。分にして読ませる。未取得はそのまま `—`。 */
export function watchTimeView(metric: WebinarOverviewMetric | undefined): MetricView {
  if (!metric || metric.state !== 'available' || metric.value === null) {
    return { text: NOT_AVAILABLE, note: metric?.reason ?? '取得できていません', available: false }
  }
  const minutes = Math.round(metric.value / 60)
  return { text: `${minutes.toLocaleString('ja-JP')}分`, note: null, available: true }
}

/** 割合は口が小数で返す。百分率にして読ませる。 */
export function rateView(metric: WebinarOverviewMetric | undefined): MetricView {
  if (!metric || metric.state !== 'available' || metric.value === null) {
    return { text: NOT_AVAILABLE, note: metric?.reason ?? '取得できていません', available: false }
  }
  return { text: `${Math.round(metric.value * 1000) / 10}%`, note: null, available: true }
}

export type OverviewCard = {
  key: string
  title: string
  view: MetricView
  /** 値が読めているときに添える説明。未取得のときは理由が優先される。 */
  detail: string | null
}

/**
 * 帯に並べる4枚。
 *
 * **申込は実人数を主に出す。** 延べ予約は同じ数ではない（1人が2回
 * 申し込める）ので、副文で分けて見せる。
 * **CTAは「押した人」。** クリック延べ数は別の数で、いまは取れない。
 */
export function overviewCards(overview: WebinarOverview | null): OverviewCard[] {
  const m = overview?.metrics
  const bookings = metricView(m?.registrationBookings, '件')
  return [
    {
      key: 'webinars',
      title: 'ウェビナー数',
      view: metricView(m?.webinars, '件'),
      detail: m?.activeWebinars.state === 'available' && m.activeWebinars.value !== null
        ? `公開中 ${m.activeWebinars.value.toLocaleString('ja-JP')}`
        : null,
    },
    {
      key: 'registrations',
      title: '申込',
      view: metricView(m?.registrations, '人'),
      /* 実人数と延べ予約を混ぜない。1人が2回申し込めば、人は1・予約は2。 */
      detail: bookings.available ? `延べ予約 ${bookings.text}` : null,
    },
    {
      key: 'viewers',
      title: '視聴',
      view: metricView(m?.viewers, '人'),
      detail: null,
    },
    {
      /*
        設計は「CTA反応 86件 / クリック」だが、口が返すのは
        `ctaUniquePeople`（押した実人数）。**件数の名前で人数を出さない。**
        クリック延べ数（`ctaTotalClicks`）はいま取れない。
      */
      key: 'cta',
      title: 'CTAを押した人',
      view: metricView(m?.ctaUniquePeople, '人'),
      /* 押した延べ回数は別の数。取れていないので「—」とは書かず、触れない。 */
      detail: null,
    },
  ]
}

/**
 * 通知の対象人数（`Ho8z4`）。
 *
 * **`definition` は内部語なので画面へ出さない。** 「有効な申込」と説明する。
 * `people` と `bookings` は別の数で、混ぜると1人が何回も数えられて見える。
 */
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
