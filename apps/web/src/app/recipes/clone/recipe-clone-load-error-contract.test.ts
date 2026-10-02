import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

function errorTags() {
  const tags = [...PAGE.matchAll(/<TargetMissing\b[\s\S]*?\/>/g)].map(([t]) => t)
  return tags.filter((t) => t.includes('kind="error"'))
}

/**
 * M044: レシピ複製の取得失敗は、403 でも汎用の文と読み直し口を出す。
 * 捕まえた失敗を共通部品へ渡す（403 は権限の案内になり、
 * 押しても直らない再試行は出ない。429 は待ち案内）。
 */
describe('M044 レシピ複製の読み込み失敗', () => {
  it('取得失敗の1枚に捕まえた失敗を渡す', () => {
    const errors = errorTags()
    expect(errors.length).toBeGreaterThan(0)
    for (const tag of errors) {
      expect(tag, '取得失敗').toContain('error={')
      expect(tag, '取得失敗').toContain('onRetry=')
    }
  })

  it('404 以外の失敗を残す', () => {
    expect(PAGE).toContain('loadError')
  })

  it('403・429だけ共通文へ切り替える目安を持つ', () => {
    expect(PAGE).toContain('isForbiddenOrRateLimited')
    expect(PAGE).toContain("loadFailureCopy(loadError, 'レシピ')")
  })

  it('画面固有の汎用文を残す（403・429以外は画面の文のまま）', () => {
    expect(PAGE).toContain('レシピを読み込めませんでした')
  })
})
