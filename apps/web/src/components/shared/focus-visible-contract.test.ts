import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const DIR = __dirname
const files = fs.readdirSync(DIR)
const read = (name: string) => fs.readFileSync(path.join(DIR, name), 'utf8')
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * **押せる部品には、キーボードのフォーカスが見えること。**
 *
 * 最初の3部品はフォーカス指定が0件だった（`docs/v6-common-rules.md` §5-6）。
 * キーボードだけで操作する人が、**いまどこにいるか分からなくなる。**
 *
 * これまでは部品を名指しで見ていたので、**新しく足した部品は見張られない。**
 * `filter-chip.css` は押せる部品なのに 1 度も見られていなかった。
 * ここで「自分で押せる要素を描いている部品」を機械で拾って、全部に当てる。
 *
 * ## `:focus` ではなく `:focus-visible`
 *
 * `:focus` だとマウスで押したときにも輪郭が出る。押した直後に枠が付くと
 * 「選んだ状態になった」と読み違える。キーボードのときだけ出す。
 */

/** 自分で押せる要素を描いている部品（共通 Button を使うだけの部品は対象外）。 */
function drawsOwnControl(src: string): boolean {
  return /<button|<a\s|role="button"|tabIndex=|<summary|<details|<input|<select|<textarea/.test(src)
}

const PARTS = files
  .filter((n) => n.endsWith('.tsx') && !n.includes('.test.'))
  .map((n) => ({ n, base: n.replace(/\.tsx$/, ''), src: read(n) }))
  .filter((p) => drawsOwnControl(p.src))

/** その部品が持つ自前の CSS。無ければ Tailwind か、ほかの部品に任せている。 */
const cssOf = (base: string) =>
  [`${base}.module.css`, `${base}.css`].find((n) => files.includes(n))

describe('押せる部品のフォーカスが見える', () => {
  it('押せる部品を拾えている', () => {
    // 拾い方を間違えて 0 件になると、以下が素通りする。
    expect(PARTS.length).toBeGreaterThanOrEqual(20)
    expect(PARTS.map((p) => p.base)).toContain('filter-chip')
  })

  it('自前の CSS を持つ部品は :focus-visible を持つ', () => {
    const missing = PARTS.filter((p) => {
      const css = cssOf(p.base)
      return css !== undefined && !/:focus-visible/.test(withoutComments(read(css)))
    }).map((p) => p.base)
    expect(missing, '押せる部品にフォーカスの輪郭が無い').toEqual([])
  })

  it('フォーカスの輪郭を消さない', () => {
    // CSS 側。`outline: none` / `outline: 0` を書かない。
    // 例外: 外側の枠が `:focus-within` で ring を出す複合部品
    // （Combobox・MultiSelect）は、中の input の輪郭を消して
    // 外枠の ring を正本にする。二重の輪郭を避けるため。
    // SearchField は例外にしない。外枠 ring では Tab 点検が反応せず、
    // 輪郭は中の input 自身に出す（2026-09-25）。
    // 緑は「正常」の意味なので、輪郭の色は action にそろえる。
    for (const name of files.filter((n) => n.endsWith('.css'))) {
      const css = withoutComments(read(name))
      if (/:focus-within\s*\{[^}]*outline:\s*2px solid var\(--color-action\)/.test(css)) continue
      expect(css, `${name} がフォーカス輪郭を消している`).not.toMatch(/outline:\s*(?:0|none)\b/)
    }
  })

  it('入力欄の輪郭は action 色で2px・外側に余白', () => {
    // TextField・Select・DateField ほか、入力欄のフォーカスは
    // `2px・action 色・outline-offset: 2px` にそろえる。
    // 緑（accent 系）は「正常」の意味なので輪郭に使わない。
    // 白地で 3:1 未満の緑枠だけの変化はやめる。
    const targets = [
      'text-field.module.css',
      'select-field.module.css',
      'form-controls.module.css',
      'select.module.css',
      'date-field.module.css',
    ]
    for (const name of targets) {
      const css = withoutComments(read(name))
      expect(css, `${name} の輪郭が action 色ではない`).toMatch(/:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--color-action\)/)
      expect(css, `${name} に緑の輪郭が残っている`).not.toMatch(/:focus-visible[^{]*\{[^}]*var\(--color-accent/)
    }
  })

  it('Tailwind でもフォーカスの輪郭を消さない', () => {
    // **CSS だけ見ていると素通りする。** `focus:outline-none` は class 名なので、
    // CSS モジュールの検査に当たらない。実際 3 部品がこれで消していた。
    const offenders = files
      .filter((n) => n.endsWith('.tsx') && !n.includes('.test.'))
      .filter((n) => /focus:outline-none|focus-visible:outline-none/.test(read(n)))
    expect(offenders, '輪郭を消すなら、代わりの輪郭を focus-visible で出す').toEqual([])
  })
})
