import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const RANK = readFileSync(join(HERE, 'rank-settings-tab.tsx'), 'utf8')
const LIFETIME = readFileSync(join(HERE, 'lifetime-tab.tsx'), 'utf8')

/**
 * R55: 会員の設定表が1440px・768pxで重なって読めない。
 * 会員一覧と同じ形（@container＋谷間帯の列削減＋1行省略＋title）で守る。
 * 幅の前提：768pxではサイドバーなし（表幅688）・1440pxでは2/3幅（表幅741）。
 * タグ見出しは約115px要る。戻すと赤くなるよう、畳まない列の固定幅に
 * 上限を置く（数字は「狭い表でも残す列が収まる」ための予算）。
 */

/** thead内の w-NN をpxに直して合計する。 */
function fixedHeadWidths(source: string): number {
  const head = source.slice(source.indexOf('<thead>'), source.indexOf('</thead>'))
  return [...head.matchAll(/\bw-(\d+)\b/g)]
    .reduce((sum, match) => sum + Number(match[1]) * 4, 0)
}

/** cq-hide-below-* が付くThとTdの組が同じ数だけある（片方だけ畳まない）。 */
function hiddenPairs(source: string, marker: string): { th: number; td: number } {
  const head = source.slice(source.indexOf('<thead>'), source.indexOf('</thead>'))
  const body = source.slice(source.indexOf('<tbody>'), source.indexOf('</tbody>'))
  const count = (text: string) =>
    (text.match(new RegExp(`<T[hd][^>]*${marker}`, 'g')) ?? []).length
  return { th: count(head), td: count(body) }
}

describe('R55 会員設定表の重なり', () => {
  it('ランク設定表は表幅で列を畳み、畳まない列は予算に収める', () => {
    expect(RANK).toContain('<DataTable className="@container">')
    // 会員数だけを狭い表で畳む。ThとTdの組が一致する。
    const pairs = hiddenPairs(RANK, 'cq-hide-below-800')
    expect(pairs.th).toBe(1)
    expect(pairs.td).toBe(1)
    // 畳まない固定列の合計（600）が、741pxの表でタグ見出し115pxを残せる。
    // 戻す（680）と赤くなる。
    expect(fixedHeadWidths(RANK)).toBeLessThanOrEqual(600)
  })

  it('ライフタイム表は2段階で畳み、説明文は省略＋titleで読める', () => {
    expect(LIFETIME).toContain('<DataTable className="@container">')
    const narrow = hiddenPairs(LIFETIME, 'cq-hide-below-1010')
    expect(narrow.th).toBe(1)
    expect(narrow.td).toBe(1)
    const narrower = hiddenPairs(LIFETIME, 'cq-hide-below-800')
    expect(narrower.th).toBe(1)
    expect(narrower.td).toBe(1)
    // 畳むまでの間は説明文が隣へ重ならない。
    expect(LIFETIME).toContain('truncate')
    expect(LIFETIME).toContain('title="限定グッズは決まり次第ここで設定します"')
  })
})
