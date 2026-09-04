import { describe, expect, it } from 'vitest'
import type { WebinarOverview, WebinarOverviewMetric } from '@/lib/api'
import { NOT_AVAILABLE, audienceText, metricView, overviewCards } from './overview-view'

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
    expect(metricView(available(0), '人')).toEqual({ text: '0人', note: null, available: true })
    expect(metricView(unavailable('区間の記録が無いため'), '人')).toEqual({
      text: NOT_AVAILABLE,
      note: '区間の記録が無いため',
      available: false,
    })
  })

  it('申込人数と延べ予約を分けて表示する', () => {
    const card = overviewCards(overview()).find(({ key }) => key === 'registrations')
    expect(card?.view.text).toBe('428人')
    expect(card?.detail).toBe('延べ予約 451件')
  })

  it('視聴不能を0人にせずAPIの理由を表示する', () => {
    const card = overviewCards(overview()).find(({ key }) => key === 'viewers')
    expect(card?.view.text).toBe(NOT_AVAILABLE)
    expect(card?.view.note).toContain('区間')
  })

  it('CTAは延べクリック数ではなく押した人数を表示する', () => {
    const card = overviewCards(overview()).find(({ key }) => key === 'cta')
    expect(card?.title).toBe('CTAを押した人')
    expect(card?.view.text).toBe('86人')
  })
})

describe('通知対象の実測値', () => {
  it('対象人数と延べ予約を分け、内部語を表示しない', () => {
    const view = audienceText({ people: 184, bookings: 191, definition: 'active_registrations' })
    expect(view.people).toBe('184人')
    expect(view.note).toContain('延べ予約は191件')
    expect(`${view.people}${view.note}`).not.toContain('active_registrations')
  })

  it('実値0と未取得を区別する', () => {
    expect(audienceText({ people: 0, bookings: 0, definition: 'active_registrations' }).people).toBe('0人')
    expect(audienceText(undefined).people).toBe(NOT_AVAILABLE)
  })
})
