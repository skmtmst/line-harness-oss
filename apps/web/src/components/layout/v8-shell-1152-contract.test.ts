import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ★V8 の 1152px の板（35 枚）は、どれも左メニューが開いたまま（幅 240）で、
 * 上の帯に LINE アカウントの切り替えの札がある。
 *
 * 2026-10-06 まで、1152 では ①保存が無いと左メニューが畳まれ ②開いても 216 に細り
 * ③ v7 の「見出しの span を画面外へ」が V8 の札そのものに当たって幅 0 に潰れていた。
 * 35 枚すべてが 2〜30% で、1枚も合格できなかった。戻らないように見張る。
 */
const here = dirname(fileURLToPath(import.meta.url))
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8')

describe('V8 の枠：1152px でも絵どおり', () => {
  it('保存が無いときに左メニューを畳むのは 1152px 未満だけ', () => {
    const src = read('sidebar.tsx')
    expect(src).toMatch(/export const SIDEBAR_AUTO_COLLAPSE_BELOW = 1152\b/)
    expect(src).toContain('setCollapsed(window.innerWidth < SIDEBAR_AUTO_COLLAPSE_BELOW)')
  })

  it('開いた左メニューを狭い幅で 216px に詰めない', () => {
    const css = read('sidebar.module.css')
    expect(css).not.toMatch(/\[data-theme="v8"\] \.desktop:not\(\[data-collapsed\]\)\s*\{[^}]*216px/)
  })

  it('上の帯の LINE アカウントの札を 1439px 以下でも潰さない', () => {
    const css = read('..', 'shared', 'top-bar.module.css')
    expect(css).toMatch(/\[data-theme='v8'\] \.accountField > \.accountPill \{[^}]*position: relative;[^}]*width: auto;/)
  })

  it('行の「…」のメニューの項目は絵の高さ（変数）', () => {
    const css = read('..', 'shared', 'action-menu.module.css')
    expect(css).toMatch(/\[data-theme="v8"\] \.item:not\(\.itemTall\) \{[^}]*height: var\(--tpl-menu-item-h\);/)
    const globals = read('..', '..', 'app', 'globals.css')
    expect(globals).toMatch(/--tpl-menu-item-h: 34px;/)
  })
})
