import { describe, expect, it } from 'vitest'
import type { WebinarOverview, WebinarOverviewMetric } from '@/lib/api'
import { kpiCells, metricValue } from '@/v8/webinars/overview'
import { audienceText } from '@/v8/webinar-edit/notification-summary'
const NOT_AVAILABLE = '—'

const available = (value: number): WebinarOverviewMetric => ({
  value,
  state: 'available',
  reason: null,
})

const unavailable = (reason: string): WebinarOverviewMetric => ({
  value: null,
  state: 'unavailable',
  reason,
})

const overview = (metrics: Partial<WebinarOverview['metrics']> = {}): WebinarOverview => ({
  state: 'partial',
  registrationMode: 'people',
  metrics: {
    webinars: available(6),
    activeWebinars: available(3),
    registrations: available(428),
    registrationBookings: available(451),
    viewers: unavailable('実際に見た区間の記録をまだ集計できないため'),
    viewRate: unavailable('視聴人数を取得できないため'),
    averageWatchSeconds: unavailable('実際に見た時間の記録をまだ集計できないため'),
    ctaUniquePeople: available(86),
    ctaTotalClicks: unavailable('同じ視聴中の複数クリックを数える記録がないため'),
    ...metrics,
  },
})

describe('ウェビナー一覧の実測値', () => {
  it('実値0は0、未取得は理由付きの横線として表示する', () => {
    expect(metricValue(available(0))).toBe(0)
    expect(metricValue(unavailable('区間の記録が無いため'))).toBeNull()
    expect(kpiCells(overview()).find(card => card.key === 'viewers')?.help).toContain('実際に見た区間の記録をまだ集計できないため')
  })

  it('申込人数と延べ予約を分けて表示する', () => {
    const card = kpiCells(overview()).find(({ key }) => key === 'registrations')
    expect(card?.value).toBe(428)
    expect(card?.unit).toBe('人')
    expect(card?.detail).toBe('延べ予約 451件')
  })

  it('視聴不能を0人にせず、理由は説明アイコンの中へまとめる', () => {
    const card = kpiCells(overview()).find(({ key }) => key === 'viewers')
    expect(card?.value).toBeNull()
    expect(card?.help).toContain('区間')
    /* 3段目は短い状態だけ。理由の長文は detail へ直置きしない（#1005）。 */
    expect(card?.detail).toBe(NOT_AVAILABLE)
    expect(card?.help).toContain('実際に見た区間の記録をまだ集計できないため')
    expect(card?.help).toContain('視聴人数を取得できないため')
    expect(card?.help).toContain('視聴人数:')
    expect(card?.help).toContain('視聴率:')
  })

  it('同じ理由で出せない指標は説明の中でひとつにまとめる', () => {
    const sameReason = overview({
      viewers: unavailable('視聴区間の記録をまだ集計できないため'),
      viewRate: unavailable('視聴区間の記録をまだ集計できないため'),
    })
    const card = kpiCells(sameReason).find(({ key }) => key === 'viewers')
    expect(card?.help?.match(/視聴区間の記録をまだ集計できないため/g)).toHaveLength(1)
    expect(card?.help).not.toContain('視聴人数:')
  })

  it('視聴率の小数を百分率で表示する', () => {
    expect(kpiCells(overview({ viewRate: available(0.729) })).find(card => card.key === 'viewers')?.detail).toBe('申込の 72.9%')
  })

  it('CTAの延べ回数と押した人数を分けて表示する', () => {
    const card = kpiCells(overview()).find(({ key }) => key === 'cta')
    expect(card?.title).toBe('CTAクリック')
    expect(card?.value).toBeNull()
    expect(card?.detail).toBe('押した人 86人')
  })
})

describe('通知対象の実測値', () => {
  it('対象人数と延べ予約を分け、内部語を表示しない', () => {
    const view = audienceText({ people: 184, bookings: 191, definition: 'active_registrations' })
    expect(view).toContain('184人')
    expect(view).toContain('延べ予約は191件')
    expect(view).not.toContain('active_registrations')
  })

  it('実値0と未取得を区別する', () => {
    expect(audienceText({ people: 0, bookings: 0, definition: 'active_registrations' })).toContain('0人')
    expect(audienceText(undefined)).toBe(NOT_AVAILABLE)
  })
})
