import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/*
 * V8「サクサク感」E：ダッシュボードの数のタイルを押すと、そのタイルが
 * 広がって内訳へ（共通 view-transition でつながる移り変わり）。
 * v7 は押せないまま（見た目・動きを変えない）。
 */
describe('ダッシュボードの数のタイルはV8だけ広げられる', () => {
  it('広げ・畳みは共通の withViewTransition を通す（自前の動きを書かない）', () => {
    expect(source).toContain("from '@/components/shared/view-transition'")
    expect(source).toContain('withViewTransition(() => {')
  })

  it('V8 のときだけ数を押せる（v7 は押せない p のまま）', () => {
    expect(source).toContain("theme === 'v8'")
    // onToggle が無いときは従来どおりの p（h-[116px] の高さも保つ）。
    expect(source).toContain('<p className="text-ink text-hero leading-none font-bold tabular-nums" aria-busy={loading || undefined}>')
    expect(source).toContain(': { expanded: false as const, onToggle: undefined, detailId: undefined }')
  })

  it('数のボタンは開閉の読み上げ（aria-expanded・内訳の region）を持つ', () => {
    expect(source).toContain('aria-expanded={expanded}')
    expect(source).toContain('role="region"')
  })

  it('4枚のタイルすべてに広げたときの内訳がある（実データのみ）', () => {
    const count = (source.match(/detailContent=\{/g) ?? []).length
    expect(count).toBe(4)
  })

  it('広げは useAdminTheme の v8 のときだけ付く', () => {
    expect(source).toContain("from '@/lib/use-admin-theme'")
    expect(source).toContain('useAdminTheme()')
  })
})
