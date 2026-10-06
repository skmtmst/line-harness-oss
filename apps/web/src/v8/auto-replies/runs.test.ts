import { describe, expect, it } from 'vitest'
import { matchesFilter, periodFrom, statusView } from './runs'

describe('自動応答の実行結果（nWmLg）', () => {
  it('期間「今月」は月の初日から、「この7日」「この30日」は今日を含めて数える', () => {
    const now = new Date(2026, 9, 6, 15, 0)
    expect(periodFrom('month', now)).toBe('2026-10-01')
    expect(periodFrom('last7', now)).toBe('2026-09-30')
    expect(periodFrom('last30', now)).toBe('2026-09-07')
    expect(periodFrom('all', now)).toBeNull()
    expect(periodFrom('custom', now)).toBeNull()
  })

  it('札は絵の言葉（成功・確認待ち・失敗・見送り）で、知らない状態は「確認中」', () => {
    expect(statusView('succeeded').label).toBe('成功')
    expect(statusView('pending').label).toBe('確認待ち')
    expect(statusView('failed').label).toBe('失敗')
    expect(statusView('permanent_failed').label).toBe('失敗')
    expect(statusView('skipped').label).toBe('見送り')
    expect(statusView('future_status').label).toBe('確認中')
  })

  it('「失敗」の絞り込みは一部だけ完了も含み、「見送り」は取り消しも含む', () => {
    const run = (status: string) => ({ status }) as Parameters<typeof matchesFilter>[0]
    expect(matchesFilter(run('partial'), 'failed')).toBe(true)
    expect(matchesFilter(run('succeeded'), 'failed')).toBe(false)
    expect(matchesFilter(run('cancelled'), 'skipped')).toBe(true)
    expect(matchesFilter(run('pending'), 'pending')).toBe(true)
  })
})
