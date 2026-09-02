import { describe, expect, it } from 'vitest'
import type { AnalyticsUsageOverview } from '@/lib/api'
import { canTidyUsage, summarizeMenuFeatures, usageObservation } from './analytics-usage'

type Category = AnalyticsUsageOverview['data']['categories'][number]

function category(overrides: Partial<Category> = {}): Category {
  return {
    key: 'templates',
    label: 'テンプレート',
    href: '/templates',
    created: { value: 3, state: 'available', reason: null },
    inUse: { value: 2, state: 'available', reason: null },
    unused: { value: 1, state: 'available', reason: null },
    brokenReferences: { value: 0, state: 'available', reason: null },
    lastUsedAt: { value: '2026-08-30T00:00:00.000Z', state: 'available', reason: null },
    ...overrides,
  }
}

describe('分析・使われ方', () => {
  it('機能設定と同じ正本から、表示中と全メニュー項目を数える', () => {
    const all = summarizeMenuFeatures({ features: {}, specializedFeatureKeys: [] })
    const hidden = summarizeMenuFeatures({
      features: { scenarios: false, templates: false },
      specializedFeatureKeys: [],
    })
    expect(all.total).toBeGreaterThan(0)
    expect(hidden.total).toBe(all.total)
    expect(hidden.enabled).toBe(all.enabled - 2)
  })

  it('未使用と未取得を混ぜず、片づける導線は実値があるときだけ出す', () => {
    expect(usageObservation(category()).text).toBe('1個は使われていません')
    expect(canTidyUsage(category())).toBe(true)

    const unknown = category({
      unused: { value: null, state: 'unavailable', reason: '所属を確認できません' },
    })
    expect(usageObservation(unknown)).toEqual({ text: '所属を確認できません', tone: 'unknown' })
    expect(canTidyUsage(unknown)).toBe(false)
  })

  it('参照切れが取れた場合は未使用より先に知らせる', () => {
    expect(usageObservation(category({
      brokenReferences: { value: 2, state: 'available', reason: null },
    }))).toEqual({ text: '参照切れが2件あります', tone: 'warning' })
  })
})
