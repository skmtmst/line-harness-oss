import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/*
 * ★V8 寸法契約（M10 数字直し）。
 * 見本（Pencil ★V8 共通部品の板 q4UhqD・Iqhzb・ZBjxY、数字は
 * design/v8/COMPONENT-MAP.md に写し）の寸法だけを守る。
 * 画面に出る件数・金額などの中身は対象外（API の実データを出す）。
 */
describe('V8 寸法契約（見本との突き合わせ）', () => {
  it('表の行：HTML の名前 18px・補足 16px の行間', () => {
    const css = read('./data-table.module.css')
    expect(css).toMatch(/\[data-theme='v8'\] \.name \{[^}]*line-height:\s*18px/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.sub \{[^}]*line-height:\s*16px/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.memo \{[^}]*line-height:\s*16px/s)
    // v7（52 の前身 58px の行）は変えない。
    expect(css).not.toMatch(/^\.name \{[^}]*line-height/m)
  })

  it('数の帯（小）：上下 10・左右 16・題と数の間 4・数 22', () => {
    const css = read('./kpi-card.module.css')
    const cell = css.match(/\[data-theme='v8'\] \.card\[data-kpi-density='compact'\] \{([^}]*)\}/s)?.[1]
    expect(cell).toBeDefined()
    expect(cell).toMatch(/padding:\s*10px 16px/)
    expect(cell).toMatch(/gap:\s*4px/)
    // 数は 22 の段（--text-metric）のまま。見本の例の数は書かない。
    expect(read('../../app/globals.css')).toMatch(/--text-metric:\s*22px/)
  })

  it('ボタンの高さ：V8 は 36（見本どおり・直し不要の確認）', () => {
    const css = read('./button.module.css')
    expect(css).toMatch(/\[data-theme='v8'\] \.standard,\s*\[data-theme='v8'\] \.field \{\s*height:\s*36px/s)
    // 行内 32・アイコン 36 も見本どおり。
    expect(css).toMatch(/\.compact\s*\{[^}]*height:\s*32px/s)
    expect(read('./icon-button.module.css')).toMatch(/\[data-theme='v8'\] \.button \{[^}]*height:\s*36px/s)
  })

  it('1152 の帯：札は潰さない・パンくずと自分の名前が縮む', () => {
    const css = read('./top-bar.module.css')
    expect(css).toMatch(/\[data-theme='v8'\] \.accountPill \{[^}]*flex-shrink:\s*0/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.crumbCurrent/s)
    expect(css).toMatch(/min-width:\s*0/)
    // v7 の札（縮む側）は変えない。
    expect(css).not.toMatch(/^\.accountPill \{[^}]*flex-shrink/m)
  })

  it('板の頭：HTML の題と説明の間は 2px', () => {
    const css = read('./page-header.module.css')
    expect(css).toMatch(/\[data-theme='v8'\] \.heading \{[^}]*gap:\s*2px/s)
    // v7 の 5 は変えない。
    expect(css).toMatch(/\.heading \{[^}]*gap:\s*5px/s)
  })
})
