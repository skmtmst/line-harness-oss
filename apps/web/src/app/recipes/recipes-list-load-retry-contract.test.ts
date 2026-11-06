import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

function errorTags() {
  const tags = [...PAGE.matchAll(/<ListState\b[\s\S]*?\/>/g)].map(([t]) => t)
  // 一覧は kind を式で切り替える（kind={status === 'error' ? ...}）ため、
  // 失敗に関わる1枚を式の断片で拾う。
  return tags.filter((t) => t.includes("'error'"))
}

/**
 * D025/M043: レシピ一覧の取得失敗に読み直し口が無い。
 * 捕まえた失敗を共通部品へ渡し、その場で読み直せるようにする
 * （403 は再試行を出さない、429 は待ち案内）。
 */
describe('D025/M043 レシピ一覧の読み込み失敗', () => {
  it('取得失敗の1枚に捕まえた失敗と読み直し口を渡す', () => {
    const errors = errorTags()
    expect(errors.length).toBeGreaterThan(0)
    for (const tag of errors) {
      expect(tag, '取得失敗').toContain('error={')
      expect(tag, '取得失敗').toContain('onRetry=')
    }
  })

  it('読み直すとレシピを取り直す', () => {
    expect(PAGE).toContain('loadError')
    expect(PAGE).toContain('setReloadKey')
  })
})
