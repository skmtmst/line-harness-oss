import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/** #975 U072: レシピが無いときも次の行動を出す。 */
describe('レシピが無いときの次の行動（#975 U072）', () => {
  it('自分で作る入口と設定確認を出す', () => {
    expect(PAGE).toContain('使えるレシピがありません')
    expect(PAGE).toContain('自動化を自分で作る')
    expect(PAGE).toContain('シナリオを自分で作る')
    expect(PAGE).toContain('機能設定を確認する')
    expect(PAGE).toContain('href="/automations/new"')
    expect(PAGE).toContain('href="/scenarios"')
    expect(PAGE).toContain('href="/settings"')
  })
})
