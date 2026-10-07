import { describe, expect, it } from 'vitest'
import { audienceOf, progressStatusText, runAudienceText, runStamp } from './model'

describe('リッチメニューの詳細の計算', () => {
  it('段の呼び名：手を付けていない段は「しない」', () => {
    expect(['done', 'failed', 'running', 'pending', 'skipped'].map((s) => progressStatusText(s as never))).toEqual(['済み', '失敗', '実行中', 'しない', 'しない'])
  })
  it('出す相手と、版が誰に出る版か（読めない版は —）', () => {
    expect(audienceOf({ isDefaultForAll: true, targetingEnabled: true })).toBe('all')
    expect(audienceOf({ isDefaultForAll: false, targetingEnabled: true })).toBe('targeted')
    expect(audienceOf({ isDefaultForAll: false, targetingEnabled: false })).toBe('none')
    const run = (v: { isDefaultForAll: boolean | null; targetingEnabled: boolean | null }) => ({ version: v }) as never
    expect(runAudienceText(run({ isDefaultForAll: true, targetingEnabled: false }))).toBe('すべての友だち（既定）')
    expect(runAudienceText(run({ isDefaultForAll: null, targetingEnabled: null }))).toBe('—')
  })
  it('時刻は日本時間', () => {
    expect(runStamp('2026-10-01T01:45:00Z')).toBe('10/1 10:45')
    expect(runStamp('2026-10-01T01:46:00Z', true)).toBe('10:46')
  })
})
