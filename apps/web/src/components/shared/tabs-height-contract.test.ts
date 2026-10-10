import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const css = readFileSync(new URL('./tabs.module.css', import.meta.url), 'utf8')
// B-180 は旧「内容連動32px」の見た目契約を置き換える。
describe('B-180 タブの寸法', () => {
  it('各形の最後に高さ36の変数を適用し、選択側だけ下線と600を持つ', () => {
    expect(css).toMatch(/\.list \.tab\.tab\s*\{[^}]*height: var\(--tpl-tabs-h\)[^}]*font-weight: var\(--tpl-tabs-weight\)[^}]*border-bottom: 2px solid transparent/s)
    expect(css).toMatch(/\.list \.current\.current\s*\{[^}]*font-weight: var\(--tpl-tabs-current-weight\)[^}]*border-bottom-color: var\(--color-ink\)/s)
    expect(css).toContain(".items[data-sliding='true'] .current { border-bottom-color: transparent; }")
  })
})
