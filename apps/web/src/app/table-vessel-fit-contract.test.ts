import { readUiSource as readFileSync } from '../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 表の幅の見張り（m15c）。
 *
 * 共通の表は table-fixed のため、列幅の指定どおりに器へ収まる。
 * 逆に言うと、列幅の指定を誤るとそのままはみ出し・右空きになる。
 * 司令塔の見た目点検（1440px・表の左右の余白）で出た4件を守る。
 *
 * 決まり：最後の列（操作・状態）は中身に合わせた固定幅にし、
 * 割合の列だけでは 100% を超えない。残りは幅を指定しない列が吸う。
 * 直しを割合へ戻すと、この試験が赤くなる。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function read(relativePath: string): string {
  return readFileSync(join(HERE, relativePath), 'utf8')
}

/** `width: '12%'` のような割合指定を全部拾って合計する。 */
function percentTotal(source: string): number {
  const values = [...source.matchAll(/width:\s*['"](\d+(?:\.\d+)?)%['"]/g)].map((m) =>
    Number(m[1]),
  )
  return values.reduce((sum, value) => sum + value, 0)
}

describe('表は器の幅にぴったり収める', () => {
  it('/booking/menus: 操作は「中身を見る」＋「…」で、中身が器からはみ出さない', () => {
    const page = read('booking/menus/page.tsx')
    expect(page).toContain('<DataTable')
    // ★V7 行の操作の決まり：主な1つ＋「…」。共通の RowActions を使う。
    // 4つ並べると1440pxで器から72pxはみ出す。上へ・下へ・止める／再開は「…」の中。
    expect(page).toContain('<RowActions')
    expect(page).toContain("label: '中身を見る'")
    expect(page).toContain("label: '上へ'")
    expect(page).toContain("label: '下へ'")
    expect(page).toContain("label: m.is_active ? '止める' : '再開'")
    // 行への直置きボタン（↑↓・止める・出す）に戻さない。
    expect(page).not.toContain('を上へ')
    expect(page).not.toContain('を下へ')
    expect(page).not.toContain('止める・出す')
    // 操作列は「中身を見る」＋「…」（約138px）に合わせた固定幅。4つ並びの w-48 に戻さない。
    expect(page).toMatch(/<Th[^>]*w-44[^>]*>操作<\/Th>/)
    expect(page).not.toMatch(/<Th[^>]*w-48[^>]*>操作<\/Th>/)
    // 割合の合計は 100% 未満。残りは「だれが受けられるか」（自動）が吸う。
    expect(percentTotal(page)).toBeLessThan(100)
  })

  it('/events: 操作列は固定幅で、中身が器からはみ出さない', () => {
    const page = read('events/page.tsx')
    expect(page).toContain('<DataTable')
    // 操作列は 2ボタン（約242px）に合わせた固定幅。割合（14%）に戻さない。
    expect(page).toMatch(/<Th[^>]*w-64[^>]*>操作<\/Th>/)
    expect(page).not.toMatch(/width:\s*['"]14%['"]/)
    expect(percentTotal(page)).toBeLessThan(100)
  })

  it('/events: 申込条件は1行で省略し、全文は title で確認する', () => {
    const page = read('events/page.tsx')
    // 申込条件は状態の札の下へ畳む。独立した列に戻すと、狭い器で見出しが
    // 重なり「全員」が縦に折れる（m19d の撮影指摘）。
    expect(page).not.toContain('>申込条件</Th>')
    // タグ名は長さが読めない。省略を外して素の文字に戻さない。
    expect(page).toContain('max-w-32 truncate')
    expect(page).toContain('title={e.visible_tag_name}')
  })

  it('/（対応が必要な受信）: 状態列は札に合わせた固定幅で、右に空けない', () => {
    const card = read('../components/support/pending-inbox-card.tsx')
    expect(card).toContain('<DataTable')
    // 状態の札（約52px＋余白）に合わせた 80px。96px に戻さない。
    expect(card).toMatch(/<Th[^>]*width:\s*80[^>]*>状態<\/Th>/)
    expect(card).not.toMatch(/width:\s*96/)
    expect(percentTotal(card)).toBeLessThan(100)
  })
})
