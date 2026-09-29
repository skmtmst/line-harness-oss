import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, 'page.tsx'), 'utf8')

function errorTags(source: string, tag: string) {
  const tags = [...source.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?/>`, 'g'))].map(([t]) => t)
  return tags.filter((t) => t.includes('kind="error"'))
}

/**
 * D023: id ありの読み込み失敗は、決まった文だけ出して
 * 読み直し口が無い。捕まえた失敗を共通部品へ渡し、その場で
 * 読み直せるようにする（403 は再試行を出さない、429 は待ち案内）。
 */
describe('D023 シナリオ配信方式の読み込み失敗', () => {
  it('取得失敗の1枚に捕まえた失敗と読み直し口を渡す', () => {
    const errors = errorTags(page, 'TargetMissing')
    expect(errors.length).toBeGreaterThan(0)
    for (const tag of errors) {
      expect(tag, '取得失敗').toContain('error={')
      expect(tag, '取得失敗').toContain('onRetry=')
    }
  })

  it('読み直すとシナリオを取り直す', () => {
    expect(page).toContain('scenarioReloadKey')
    expect(page).toContain('setScenarioReloadKey')
  })
})
