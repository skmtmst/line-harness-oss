import { describe, expect, it } from 'vitest'
import type { Webinar, WebinarAnalytics } from '@/lib/api'
import {
  NOT_AVAILABLE,
  STEPS,
  nextLabelOf,
  nextStepOf,
  publishBlockers,
  stepStateOf,
  summaryRows,
} from './edit-steps'

const webinar = (over: Partial<Webinar> = {}): Webinar => ({
  id: 'webinar-1',
  accountId: 'visual-qa-account',
  title: 'NEN活用スタートセミナー',
  slug: 'nen-start',
  status: 'active',
  videoPrefix: 'webinars/nen-start',
  durationSeconds: 2538,
  schedule: [{ type: 'daily', time: '10:00' }],
  cta: null,
  ...over,
} as Webinar)

const analytics = (reservations: number): WebinarAnalytics => ({
  summary: {
    reservations, viewers: 0, registeredAndJoined: 0, watched5m: 0, watched15m: 0,
    completed: 0, avgWatchedSeconds: 0, ctaClicks: 0, formSubmissions: 0,
  },
  daily: [],
  participants: [],
} as unknown as WebinarAnalytics)

describe('段の並び', () => {
  it('設計と同じ5段', () => {
    expect(STEPS.map((s) => s.title)).toEqual(['基本設定', '動画', 'CTA・フォーム', '通知', '確認'])
  })

  it('次へは行き先の名前で言う', () => {
    expect(nextLabelOf('video')).toBe('CTA・フォームへ')
    expect(nextStepOf('review')).toBeNull()
    expect(nextLabelOf('review')).toBeNull()
  })
})

describe('段の印', () => {
  it('通り過ぎただけでは済みにしない', () => {
    // 空のまま公開へ進めてしまう。
    expect(stepStateOf('basic', 'video', webinar({ title: '  ' }))).toBe('todo')
    expect(stepStateOf('video', 'cta', webinar({ videoPrefix: null }))).toBe('todo')
    expect(stepStateOf('video', 'cta', webinar({ schedule: [] }))).toBe('todo')
  })

  it('入力が入っていれば済み', () => {
    expect(stepStateOf('basic', 'video', webinar())).toBe('done')
    expect(stepStateOf('video', 'cta', webinar())).toBe('done')
  })

  it('分からないものを済みにしない', () => {
    // 通知の設定は別の口にあり、確認は人が読んで決めること。
    expect(stepStateOf('notifications', 'basic', webinar())).toBe('todo')
    expect(stepStateOf('review', 'basic', webinar())).toBe('todo')
  })

  it('いまの段はいまの段として出す', () => {
    expect(stepStateOf('cta', 'cta', webinar())).toBe('current')
    expect(stepStateOf('basic', 'basic', null)).toBe('current')
  })
})

describe('設定サマリー', () => {
  it('未取得は — で、0人とは分ける', () => {
    /*
      設計は「申込 184人」を出しているが、その数は1本ぶんの集計から来る。
      まだ読めていないときに0人と書くと、誰も申し込んでいないように読める。
    */
    const rows = summaryRows(webinar(), null)
    expect(rows.find((r) => r.label === '申込')?.value).toBe(NOT_AVAILABLE)
    expect(summaryRows(webinar(), analytics(0)).find((r) => r.label === '申込')?.value).toBe('0人')
    expect(summaryRows(webinar(), analytics(184)).find((r) => r.label === '申込')?.value).toBe('184人')
  })

  it('足りないものには理由を添える', () => {
    const rows = summaryRows(webinar({ videoPrefix: null, schedule: [] }), analytics(0))
    expect(rows.find((r) => r.label === '動画')?.note).toContain('視聴できません')
    expect(rows.find((r) => r.label === '配信枠')?.note).toContain('次の回')
  })

  it('内部の値をそのまま出さない', () => {
    for (const status of ['active', 'draft', 'archived'] as const) {
      const value = summaryRows(webinar({ status }), null).find((r) => r.label === '公開')?.value
      expect(value).not.toMatch(/[a-z]/)
    }
  })
})

describe('公開の可否', () => {
  it('足りないものを1つずつ言う', () => {
    expect(publishBlockers(webinar())).toEqual([])
    expect(publishBlockers(webinar({ videoPrefix: null, schedule: [] }))).toEqual([
      '動画が設定されていません',
      '配信枠が1件もありません',
    ])
  })
})

describe('撮影の目印', () => {
  it('設計Nodeがある段だけ、そのNodeを目印にする', () => {
    /*
      基本設定は編集画面ぶんの設計面が無い（`lvaY5` は作成画面の面）。
      Nodeを流用すると、別のルートの絵をこの画面から撮ってしまう。
    */
    expect(STEPS.find((s) => s.key === 'basic')?.node).toBeUndefined()
    expect(STEPS.find((s) => s.key === 'basic')?.mark).toBe('webinar-step-basic')
    expect(STEPS.filter((s) => s.node).map((s) => s.node)).toEqual(['PV1Vh', 'd3rFGD', 'Ho8z4', 'D6yO7e'])
  })

  it('目印は重ならない', () => {
    expect(new Set(STEPS.map((s) => s.mark)).size).toBe(STEPS.length)
  })
})
