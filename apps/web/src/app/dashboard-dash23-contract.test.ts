import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/*
 * DASH-23: ダッシュボード「今日やること」1枚目カードで期間ラベル（「現在」）が
 * 折り返して2段になり、カード間で見出しの高さがずれていた。
 * 期間ラベルは常に1行（nowrap）に保ち、タイトル側が1行省略で削られる。
 */
describe('DASH-23 ダッシュボードの見出しは期間ラベルを折り返さない', () => {
  it('期間ラベルはすべてのカードで折り返し禁止', () => {
    const periods = source.match(/text-ink-faint flex-1 [^"]*pt-0\.5[^"]*|text-ink-faint flex-1 [^"]*text-\[11px\][^"]*|text-ink-faint whitespace-nowrap text-xs font-normal/g) ?? []
    expect(periods.length).toBeGreaterThanOrEqual(4)
    for (const cls of periods) expect(cls).toContain('whitespace-nowrap')
  })

  it('カードタイトルは1行省略＋title属性で全文を見せる', () => {
    const titles = source.match(/min-w-0 truncate [^"]*(?:font-semibold|font-bold)[^"]*" title=/g) ?? []
    expect(titles.length).toBeGreaterThanOrEqual(3)
  })

  // ★V7：「運用アラート」は切らずに出し、右の状態の文は下の段へ折り返す。
  it('運用アラートの見出しは省略しない', () => {
    expect(source).toContain('<h2 className="text-ink shrink-0 text-base font-bold">運用アラート</h2>')
  })
})
