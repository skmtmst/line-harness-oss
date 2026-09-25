import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const sideCards = readFileSync(join(HERE, '..', 'components', 'dashboard', 'side-cards.tsx'), 'utf8')

/*
 * DASH-23: ダッシュボード「今日やること」1枚目カードで期間ラベル（「現在」）が
 * 折り返して2段になり、カード間で見出しの高さがずれていた。
 * 期間ラベルは常に1行（nowrap）に保ち、タイトル側が1行省略で削られる。
 */
describe('DASH-23 ダッシュボードの見出しは期間ラベルを折り返さない', () => {
  it('期間ラベルはすべてのカードで折り返し禁止', () => {
    // 送信枠・運用アラートの期間は SideCard 側に移ったので、両方を読む。
    const pattern = /text-ink-faint flex-1 [^"]*pt-0\.5[^"]*|text-ink-faint flex-1 [^"]*text-\[11px\][^"]*|text-ink-faint whitespace-nowrap text-xs font-normal/g
    const periods = (source.match(pattern) ?? []).concat(sideCards.match(pattern) ?? [])
    expect(periods.length).toBeGreaterThanOrEqual(4)
    for (const cls of periods) expect(cls).toContain('whitespace-nowrap')
  })

  it('カードタイトルは1行省略＋title属性で全文を見せる', () => {
    const titles = source.match(/min-w-0 truncate [^"]*(?:font-semibold|font-bold)[^"]*" title=/g) ?? []
    expect(titles.length).toBeGreaterThanOrEqual(3)
  })

  // ★V7：「運用アラート」は切らずに出し、件数と札は本文の段へ出す。
  // 見出しは SideCard の題に残る。題に省略（truncate）を付けない。
  it('運用アラートの見出しは省略しない', () => {
    expect(source).toContain('title="運用アラート"')
    const heading = sideCards.match(/<h2 className="([^"]*)">\{title\}<\/h2>/)
    expect(heading, 'SideCard の題が見つからない').not.toBeNull()
    expect(heading?.[1]).not.toContain('truncate')
  })
})
