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
  it('/booking/menus: V8の名前と行末操作が器からはみ出さない', () => {
    const page = read('../v8/booking-menus/tabs/menus-tab.tsx')
    const css = read('../v8/booking-menus/settings.module.css')
    expect(page).toContain('className={styles.menuRow}')
    expect(page).toContain('<RowMenu')
    expect(page).toContain('className={styles.rowMenuButton}')
    expect(css).toMatch(/\.colName\s*\{[^}]*flex: 1 1 0;[^}]*min-width: 0;/)
    expect(css).toMatch(/\.rowMenuButton\s*\{[^}]*width: var\(--tpl-bm-28\)/)
    expect(css).toMatch(/\.menuName\s*\{[^}]*max-width: 100%;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/)
  })

  it('/events: 操作列は固定幅で、中身が器からはみ出さない', () => {
    const page = read('../v8/events/list.tsx')
    const css = read('../v8/events/list.module.css')
    expect(page).toContain('<DataTable')
    // V8の行末メニューは共通の固定幅。旧2ボタン分の幅へ戻さない。
    expect(page).toContain('<col className={styles.colMenu} />')
    expect(page).toContain('<Th aria-label="操作" />')
    expect(css).toContain('.colMenu { width: var(--tpl-fm-col-menu); }')
    expect(page).not.toMatch(/width:\s*['"]14%['"]/)
    expect(percentTotal(page)).toBeLessThan(100)
  })

  it('/events: 申込条件は1行で省略し、全文は title で確認する', () => {
    const page = read('../v8/events/list.tsx')
    // 申込条件は状態の札の下へ畳む。独立した列に戻すと、狭い器で見出しが
    // 重なり「全員」が縦に折れる（m19d の撮影指摘）。
    expect(page).not.toContain('>申込条件</Th>')
    // タグ名は長さが読めない。省略を外して素の文字に戻さない。
    expect(page).toContain("<TagPill name={e.visible_tag_name ?? '消えたタグ'} size=\"sm\" />")
    const tag = read('../components/shared/tag-pill.tsx')
    expect(tag).toContain('<TruncatedText className={styles.name} value={name} />')
    expect(read('../components/shared/truncated-text.module.css')).toContain('white-space: nowrap; text-overflow: ellipsis;')
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
