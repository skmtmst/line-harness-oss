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
    expect(css).toMatch(/:root \.name \{[^}]*line-height:\s*18px/s)
    expect(css).toMatch(/:root \.sub \{[^}]*line-height:\s*16px/s)
    expect(css).toMatch(/:root \.memo \{[^}]*line-height:\s*16px/s)
    // 管理画面（52 の前身 58px の行）は変えない。
    expect(css).not.toMatch(/^\.name \{[^}]*line-height/m)
  })

  it('数の帯（小）：上下 10・左右 16・題と数の間 4・数 22', () => {
    const css = read('./kpi-card.module.css')
    const cell = css.match(/:root \.card\[data-kpi-density='compact'\] \{([^}]*)\}/s)?.[1]
    expect(cell).toBeDefined()
    expect(cell).toMatch(/padding:\s*10px 16px/)
    expect(cell).toMatch(/gap:\s*4px/)
    // 数は 22 の段（--text-metric）のまま。見本の例の数は書かない。
    expect(read('../../app/globals.css')).toMatch(/--tpl-band-number-size:\s*22px/)
  })

  it('ボタンの高さ：V8 は 36（見本どおり・直し不要の確認）', () => {
    const css = read('./button.module.css')
    expect(css).toMatch(/:root \.standard,\s*:root \.field \{\s*height:\s*var\(--tpl-button-h\)/s)
    // 行内 32・アイコン 36 も見本どおり。
    expect(css).toMatch(/\.compact\s*\{[^}]*height:\s*32px/s)
    expect(read('./icon-button.module.css')).toMatch(/:root \.button \{[^}]*height:\s*36px/s)
  })

  it('1152 の帯：札は潰さない・パンくずと自分の名前が縮む', () => {
    const css = read('./top-bar.module.css')
    expect(css).toMatch(/:root \.accountPill \{[^}]*flex-shrink:\s*0/s)
    expect(css).toMatch(/:root \.crumbCurrent/s)
    expect(css).toMatch(/min-width:\s*0/)
    // 管理画面 の札（縮む側）は変えない。
    expect(css).not.toMatch(/^\.accountPill \{[^}]*flex-shrink/m)
  })

  it('板の頭：既定の間は 4・compact は EnlYo どおり 2', () => {
    const css = read('./page-header.module.css')
    expect(css).toMatch(/:root \.heading \{[^}]*gap:\s*var\(--tpl-head-gap\)/s)
    expect(css).toMatch(/:root \.header\[data-header-size='compact'\] \.heading \{[^}]*gap:\s*var\(--tpl-compact-gap\)/s)
    // 管理画面 の 5 は変えない。
    expect(css).not.toMatch(/^\.heading \{[^}]*gap:\s*5px/ms)
  })
})
