import type { CommonVarChangeImpact } from '@line-crm/shared'
import { describe, expect, it } from 'vitest'
import { impactBreakdown, impactCsv, overLimitCount, urgentImpactCount } from './impact-review'

const impact = {
  byKind: { template: 2, form: 1 },
  items: [
    { name: '予約配信', kindLabel: '一斉配信', status: '予約中 9/10 10:00', blocksDeletion: true, changesOnSave: true, currentPreview: '前', nextPreview: '後', exceedsCharacterLimit: false },
    { name: '公開フォーム', kindLabel: '回答フォーム', status: '公開中', blocksDeletion: true, changesOnSave: true, currentPreview: '前', nextPreview: '後', exceedsCharacterLimit: true },
    { name: '送信済み', kindLabel: '一斉配信', status: '送信済み', blocksDeletion: false, changesOnSave: false, currentPreview: '前', nextPreview: '後', exceedsCharacterLimit: false },
  ],
} as CommonVarChangeImpact

describe('共通情報の変更影響', () => {
  it('種類別内訳と、すぐ効くものを分けて数える', () => {
    expect(impactBreakdown(impact)).toBe('テンプレート2・回答フォーム1')
    expect(urgentImpactCount(impact)).toBe(2)
    expect(overLimitCount(impact)).toBe(1)
  })

  it('状態の内訳が取れないときは0件にしない', () => {
    expect(urgentImpactCount({
      ...impact,
      items: [{ ...impact.items[0], status: '使われています' }],
    } as CommonVarChangeImpact)).toBeNull()
  })

  it('APIが返した予約中・公開中の件数を優先する', () => {
    expect(urgentImpactCount({
      ...impact,
      scheduledUsageCount: 2,
      publishedUsageCount: 3,
      items: [{ ...impact.items[0], status: '使われています' }],
    } as CommonVarChangeImpact & { scheduledUsageCount: number; publishedUsageCount: number })).toBe(5)
  })

  it('CSVには送信済みを混ぜず、変更前後を出す', () => {
    const csv = impactCsv(impact)
    expect(csv).toContain('"予約配信","一斉配信","前","後"')
    expect(csv).not.toContain('送信済み')
  })
})
