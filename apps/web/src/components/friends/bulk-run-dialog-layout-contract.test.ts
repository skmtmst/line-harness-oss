import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(join(__dirname, 'bulk-run-dialog.module.css'), 'utf8')
/** メニュー非表示（1280px未満）向けの断片だけを見る。 */
const NARROW = CSS.slice(CSS.indexOf('@media (max-width: 1279.98px)'))

/**
 * Issue #1015 CHK-05（#985 の対応＋残存修正を固定）:
 * 友だち一括操作の画面を 390〜1440px の全対象幅で使える形にする。
 *
 * - 左の256px空きはPCメニュー（1280px以上）が実在する間だけ。
 *   折り畳み境界はメニュー非表示の1280pxにそろえる（1100pxではない）。
 * - 1280px未満ではモバイルの固定ヘッダー（68px）ごと覆い、
 *   ヘッダーの下端が帯となって残らないようにする。
 * - 見出しバーは画面幅を超えない。操作カードは狭い幅で列を減らす。
 */
describe('CHK-05 友だち一括操作の幅対応', () => {
  it('折り畳み境界はPCメニュー非表示の1280pxにそろえる', () => {
    expect(CSS).toContain('@media (max-width: 1279.98px)')
    // 1100pxで畳むと、メニューが消える1101〜1279pxに空白が残る。
    expect(CSS).not.toContain('@media (max-width: 1100px)')
    expect(NARROW).toContain('left: 0')
  })

  it('1280px未満はモバイルの固定ヘッダーごと覆う', () => {
    /*
      上56pxだけ空けると、68pxのモバイルヘッダーの下端12pxが
      見出しバーの下に帯となって残る。画面を使い切る窓なので、
      背景を上端まで伸ばしてヘッダーごと覆う。
    */
    expect(NARROW).toContain('.backdrop { top: 0; left: 0; padding-top: 72px; }')
    expect(CSS).toContain('@media (max-width: 640px)')
    expect(CSS).toContain('padding: 72px 16px 16px')
  })

  it('見出しバーは画面幅を超えない', () => {
    expect(NARROW).toContain('width: min(420px, 100vw)')
  })

  it('操作カードは狭い幅で列を減らす', () => {
    expect(NARROW).toContain('repeat(2, minmax(150px, 1fr))')
    expect(CSS).toContain('repeat(auto-fit, minmax(150px, 1fr))')
  })
})
