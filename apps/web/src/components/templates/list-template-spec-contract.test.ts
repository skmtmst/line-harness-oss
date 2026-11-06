import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const shared = (name: string) => readFileSync(join(HERE, '..', 'shared', name), 'utf8')
const css = readFileSync(join(HERE, 'page-templates.module.css'), 'utf8')

/*
 * 一覧の型の寸法（design/v8/LIST-TEMPLATE-SPEC.md・絵 ）。
 * 頭87（20/24/12・題22/700/32・間4・説明13/19）・帯116で頭の直下・
 * フォルダ200・道具64（14/24/36/間8）・見出し40（12/24）・行はで中身1行52／2行以上60
 * （実寸はlist-row-height.test.mjsで確認）・下は上下10。管理画面 には効かない。
 */
describe('一覧の型の寸法（LIST-TEMPLATE-SPEC）', () => {
  it('表の見出しは中身で40（上下12・左右24・中身16）', () => {
    const table = shared('table.module.css')
    expect(table).toMatch(/:root \.headRow \{[^}]*height:\s*auto/s)
    expect(table).toMatch(/:root \.headRow \.cell \{[^}]*padding:\s*var\(--tpl-thead-pad-block\) var\(--tpl-thead-pad-side\)/s)
    expect(table).toMatch(/:root \.headRow \.cell \{[^}]*line-height:\s*var\(--tpl-thead-lh\)/s)
  })

  it('一覧の行は共通の中身判定で52／60を選ぶ（古いセルの余白は一覧で二重に足さない）', () => {
    const dataTable = shared('data-table.module.css')
    expect(dataTable).toMatch(/:root \.bodyCell \{[^}]*padding:\s*var\(--tpl-row-pad-block\) var\(--tpl-row-pad-side\)/s)
    expect(dataTable).toMatch(/:root \.name \{[^}]*line-height:\s*18px/s)
    expect(dataTable).toMatch(/:root \.sub \{[^}]*margin-top:\s*var\(--tpl-sub-gap\)/s)
    expect(dataTable).toMatch(/:root \.sub \{[^}]*line-height:\s*16px/s)
    expect(dataTable).not.toMatch(/:root \.row \{[^}]*height:\s*(60|86)px/s)
    expect(dataTable).not.toMatch(/\.rowDouble/)
    expect(dataTable).not.toMatch(/:has\(\.sub/)
    expect(dataTable).toContain('--list-content-row-h: var(--tpl-list-row-multi-h)')
    expect(dataTable).toContain('[data-list-content-lines]')
  })

  it('数の帯は上下の線だけ・数は22（帯116の式）', () => {
    const kpi = shared('kpi-card.module.css')
    const strip = kpi.match(/:root \.strip\[data-kpi-presentation='band'\] \{[^}]*\}/s)
    expect(strip, '帯の指定がありません').toBeTruthy()
    expect(strip![0]).toMatch(/border-block:\s*1px solid var\(--tpl-band-line\)/)
    expect(strip![0]).not.toMatch(/border:\s*1px solid/)
    expect(kpi).toMatch(/:root \.strip\[data-kpi-presentation='band'\] \.number \{[^}]*font-size:\s*var\(--tpl-band-number-size\)/s)
  })

  it('下は上下10・左右24（型の枠。部品の根は部品の絵どおり10/20）', () => {
    expect(css).toMatch(/\.pagination \{[^}]*padding:\s*var\(--tpl-page-pad-block\) var\(--tpl-page-pad-side\)/s)
    expect(shared('pagination.module.css')).toMatch(/:root \.pagination \{[^}]*padding:\s*10px 20px/s)
  })

  it('道具の段は64の式（上下14・左右24・間8・中身36。直書きなし）', () => {
    const toolbar = shared('list-toolbar.module.css')
    expect(toolbar).toMatch(/:root \.toolbar \{[^}]*padding:\s*var\(--tpl-toolbar-pad-block\) var\(--tpl-toolbar-pad-side\)/s)
    expect(toolbar).toMatch(/:root \.toolbar \{[^}]*gap:\s*var\(--tpl-toolbar-gap\)/s)
    expect(toolbar).not.toMatch(/:root \.toolbar \{[^}]*padding:\s*14px 24px/s)
  })

  it('フォルダの列は幅200・内側16/12・高さは板に伸ばす（固定の高さなし）', () => {
    const panel = shared('folder-panel.module.css')
    expect(panel).toMatch(/:root \.panel \{[^}]*width:\s*var\(--tpl-folder-width\)/s)
    expect(panel).toMatch(/:root \.panel \{[^}]*padding:\s*var\(--tpl-folder-pad-block\) var\(--tpl-folder-pad-side\)/s)
    expect(panel).toMatch(/:root \.panel \{[^}]*align-self:\s*stretch/s)
    expect(panel).not.toMatch(/:root \.panel \{[^}]*min-height:\s*612px/s)
    expect(panel).not.toMatch(/width:\s*224\.5px/)
    expect(css).toMatch(/\.folders \{[^}]*padding:\s*var\(--tpl-folder-pad-block\) var\(--tpl-folder-pad-side\)/s)
  })

  it('帯116の式（マス16/20・上24・間8・数22/26・間8・下18）', () => {
    const kpi = shared('kpi-card.module.css')
    expect(kpi).toMatch(/:root \.strip \.card \{[^}]*padding:\s*var\(--tpl-band-cell-pad-block\) var\(--tpl-band-cell-pad-side\)/s)
    expect(kpi).toMatch(/:root \.head \{[^}]*min-height:\s*24px/s)
    expect(kpi).toMatch(/:root \.strip \.number \{[^}]*line-height:\s*var\(--tpl-band-number-lh\)/s)
    expect(kpi).toMatch(/:root \.detail \{[^}]*line-height:\s*18px/s)
  })

  it('寸法の変数の値（LIST-TEMPLATE-SPECどおり）', () => {
    const globals = readFileSync(join(HERE, '..', '..', 'app', 'globals.css'), 'utf8')
    expect(globals).toMatch(/--tpl-folder-width:\s*200px/)
    expect(globals).toMatch(/--tpl-folder-pad-block:\s*16px/)
    expect(globals).toMatch(/--tpl-folder-pad-side:\s*12px/)
    expect(globals).toMatch(/--tpl-toolbar-pad-block:\s*14px/)
    expect(globals).toMatch(/--tpl-toolbar-pad-side:\s*24px/)
    expect(globals).toMatch(/--tpl-band-cell-pad-block:\s*16px/)
    expect(globals).toMatch(/--tpl-band-cell-pad-side:\s*24px/)
  })

  it('帯の CSS（kpi-band-v8.css）は残す・数は変数で22', () => {
    const band = readFileSync(join(HERE, '..', 'shared', 'kpi-band-v8.css'), 'utf8')
    expect(band).toMatch(/:root \[data-kpi-strip\]\[data-kpi-presentation='band'\] \{[^}]*display:\s*grid/s)
    expect(band).toMatch(/\[data-kpi-strip\]\[data-kpi-presentation='band'\] \[data-kpi-number\] \{[^}]*font-size:\s*var\(--tpl-band-number-size\)/s)
    const globals = readFileSync(join(HERE, '..', '..', 'app', 'globals.css'), 'utf8')
    expect(globals).toMatch(/@import "\.\.\/components\/shared\/kpi-band-v8\.css"/)
  })
})
