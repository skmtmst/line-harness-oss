import { describe, expect, it } from 'vitest'
import type { WebinarOverview, WebinarOverviewMetric } from '@/lib/api'
import {
  NOT_AVAILABLE,
  audienceText,
  metricView,
  overviewCards,
  rateView,
  watchTimeView,
} from './overview-view'

const ok = (value: number): WebinarOverviewMetric => ({ value, state: 'available', reason: null })
const no = (reason: string): WebinarOverviewMetric => ({ value: null, state: 'unavailable', reason })

const overview = (over: Partial<WebinarOverview['metrics']> = {}): WebinarOverview => ({
  state: 'partial',
  registrationMode: 'people',
  metrics: {
    webinars: ok(6),
    activeWebinars: ok(3),
    registrations: ok(428),
    registrationBookings: ok(451),
    viewers: no('実際に見た区間の記録をまだ集計できないため'),
    viewRate: no('視聴人数を取得できないため'),
    averageWatchSeconds: no('実際に見た時間の記録をまだ集計できないため'),
    ctaUniquePeople: ok(86),
    ctaTotalClicks: no('同じ視聴中の複数クリックを数える記録がないため'),
    ...over,
  },
})

describe('1つの数の見え方', () => {
  it('実値0は0。未取得と混ぜない', () => {
    expect(metricView(ok(0), '人')).toEqual({ text: '0人', note: null, available: true })
  })

  it('未取得は — と理由', () => {
    const view = metricView(no('区間の記録が無いため'), '人')
    expect(view.text).toBe(NOT_AVAILABLE)
    expect(view.note).toBe('区間の記録が無いため')
    expect(view.available).toBe(false)
  })

  it('理由が無いまま — にしない', () => {
    // 「読めていない」のか「まだ無い」のかが分からなくなる。
    expect(metricView(undefined, '人').note).toBeTruthy()
  })

  it('桁を区切って読ませる', () => {
    expect(metricView(ok(1428), '人').text).toBe('1,428人')
  })
})

describe('視聴の指標', () => {
  it('平均視聴時間は分にする', () => {
    expect(watchTimeView(ok(1800)).text).toBe('30分')
  })

  it('取れないものを最後の再生位置から作らない', () => {
    // `last_position_seconds` は最後の再生位置で、見た時間ではない。
    expect(watchTimeView(no('記録が無いため')).text).toBe(NOT_AVAILABLE)
    expect(rateView(no('視聴人数を取得できないため')).text).toBe(NOT_AVAILABLE)
  })

  it('割合は百分率にする', () => {
    expect(rateView(ok(0.729)).text).toBe('72.9%')
  })
})

describe('帯の4枚', () => {
  it('申込は実人数を主に出し、延べ予約は分けて添える', () => {
    /*
      1人が2回申し込めば、人は1・予約は2。混ぜると人数が水増しされて見える。
    */
    const cards = overviewCards(overview())
    const registrations = cards.find((c) => c.key === 'registrations')
    expect(registrations?.title).toBe('申込')
    expect(registrations?.view.text).toBe('428人')
    expect(registrations?.detail).toBe('延べ予約 451件')
  })

  it('CTAは押した実人数', () => {
    const cta = cards().find((c) => c.key === 'cta')
    expect(cta?.title).toBe('CTAを押した人')
    // 設計は「CTA反応…件 クリック」だが、返るのは実人数。件数の名前で人数を出さない。
    expect(cta?.title).not.toContain('件')
    expect(cta?.view.text).toBe('86人')
    // 押した延べ回数は別の数。取れていないので触れない。
    expect(cta?.detail).toBeNull()
  })

  it('視聴人数は未取得のまま理由を出す', () => {
    const viewers = cards().find((c) => c.key === 'viewers')
    expect(viewers?.view.text).toBe(NOT_AVAILABLE)
    expect(viewers?.view.note).toContain('区間')
  })

  it('設計の視聴312人・72.9%を固定値で置かない', () => {
    const texts = cards().map((c) => `${c.view.text}${c.detail ?? ''}`).join(' ')
    expect(texts).not.toContain('312')
    expect(texts).not.toContain('72.9')
  })

  it('実値0のときは0件・0人と出す', () => {
    const zero = overviewCards(overview({
      webinars: ok(0), activeWebinars: ok(0), registrations: ok(0),
      registrationBookings: ok(0), ctaUniquePeople: ok(0),
    }))
    expect(zero.find((c) => c.key === 'webinars')?.view.text).toBe('0件')
    expect(zero.find((c) => c.key === 'registrations')?.view.text).toBe('0人')
    expect(zero.find((c) => c.key === 'registrations')?.detail).toBe('延べ予約 0件')
  })

  it('読めていないときは4枚とも — と理由', () => {
    for (const card of overviewCards(null)) {
      expect(card.view.text).toBe(NOT_AVAILABLE)
      expect(card.view.note).toBeTruthy()
    }
  })

  function cards() {
    return overviewCards(overview())
  }
})

describe('通知の対象人数', () => {
  it('実人数を出し、延べ予約は分けて言う', () => {
    const text = audienceText({ people: 184, bookings: 191, definition: 'active_registrations' })
    expect(text.people).toBe('184人')
    expect(text.note).toContain('191件')
  })

  it('内部語をそのまま出さない', () => {
    // `definition` は口の言葉。画面では「有効な申込」と説明する。
    const text = audienceText({ people: 184, bookings: 191, definition: 'active_registrations' })
    expect(`${text.people}${text.note}`).not.toContain('active_registrations')
    expect(text.note).toContain('有効な申込')
  })

  it('実値0は0人', () => {
    expect(audienceText({ people: 0, bookings: 0, definition: 'active_registrations' }).people).toBe('0人')
  })

  it('読めていないときは0人にしない', () => {
    expect(audienceText(undefined).people).toBe(NOT_AVAILABLE)
  })
})
