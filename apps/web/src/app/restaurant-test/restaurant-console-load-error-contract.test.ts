import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'restaurant-console.tsx'), 'utf8')

function errorTags() {
  const tags = [...source.matchAll(/<ListState\b[\s\S]*?\/>/g)].map(([t]) => t)
  return tags.filter((t) => t.includes('kind="error"'))
}

/**
 * D024: スナップショットの取得失敗が、未登録の1枚（EmptySetup）に
 * 落ちる。理由と読み直し口だけを足し、機能自体は変えない。
 */
describe('D024 飲食店コンソールの読み込み失敗', () => {
  it('取得失敗の1枚に捕まえた失敗と読み直し口を渡す', () => {
    const errors = errorTags()
    expect(errors.length).toBeGreaterThan(0)
    for (const tag of errors) {
      expect(tag, '取得失敗').toContain('error={')
      expect(tag, '取得失敗').toContain('onRetry=')
    }
  })

  it('未登録の1枚は残し、失敗時だけ別の1枚を出す', () => {
    expect(source).toContain('EmptySetup')
    expect(source).toContain('loadError')
  })
})
