import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const shared = (name: string) => readFileSync(join(HERE, '..', 'shared', name), 'utf8')
const css = readFileSync(join(HERE, 'page-templates.module.css'), 'utf8')

/*
 * 一覧の型の寸法（design/v8/LIST-TEMPLATE-SPEC.md・絵 apLqS）。
 * 頭87（20/24/12・題22/700/32・間4・説明13/19）・帯116で頭の直下・
 * フォルダ200・道具64（14/24/36/間8）・見出し40（12/24）・行62
 * （12/24・名18＋間4＋補足16）・下は上下10。v7 には効かない。
 */
describe('一覧の型の寸法（LIST-TEMPLATE-SPEC）', () => {
  it('表の見出しは中身で40（上下12・左右24・中身16）', () => {
    const table = shared('table.module.css')
    expect(table).toMatch(/\[data-theme='v8'\] \.headRow \{[^}]*height:\s*auto/s)
    expect(table).toMatch(/\[data-theme='v8'\] \.headRow \.cell \{[^}]*padding:\s*var\(--tpl-thead-pad-block\) var\(--tpl-thead-pad-side\)/s)
    expect(table).toMatch(/\[data-theme='v8'\] \.headRow \.cell \{[^}]*line-height:\s*var\(--tpl-thead-lh\)/s)
  })

  it('表の行は余白＋中身で62（名18＋間4＋補足16・固定の高さなし）', () => {
    const dataTable = shared('data-table.module.css')
    expect(dataTable).toMatch(/\[data-theme='v8'\] \.bodyCell \{[^}]*padding:\s*var\(--tpl-row-pad-block\) var\(--tpl-row-pad-side\)/s)
    expect(dataTable).toMatch(/\[data-theme='v8'\] \.name \{[^}]*line-height:\s*18px/s)
    expect(dataTable).toMatch(/\[data-theme='v8'\] \.sub \{[^}]*margin-top:\s*var\(--tpl-sub-gap\)/s)
    expect(dataTable).toMatch(/\[data-theme='v8'\] \.sub \{[^}]*line-height:\s*16px/s)
    expect(dataTable).not.toMatch(/\[data-theme='v8'\] \.row \{[^}]*height:\s*(60|86)px/s)
    expect(dataTable).not.toMatch(/\.rowDouble/)
    expect(dataTable).not.toMatch(/:has\(\.sub/)
  })

  it('数の帯は上下の線だけ・数は22（帯116の式）', () => {
    const kpi = shared('kpi-card.module.css')
    const strip = kpi.match(/\[data-theme='v8'\] \.strip\[data-kpi-presentation='band'\] \{[^}]*\}/s)
    expect(strip, '帯の指定がありません').toBeTruthy()
    expect(strip![0]).toMatch(/border-block:\s*1px solid var\(--color-hairline\)/)
    expect(strip![0]).not.toMatch(/border:\s*1px solid/)
    expect(kpi).toMatch(/\[data-theme='v8'\] \.strip\[data-kpi-presentation='band'\] \.number \{[^}]*font-size:\s*var\(--tpl-band-number-size\)/s)
  })

  it('下は上下10・左右24（型の枠。部品の根は部品の絵どおり10/20）', () => {
    expect(css).toMatch(/\.pagination \{[^}]*padding:\s*var\(--tpl-page-pad-block\) var\(--tpl-page-pad-side\)/s)
    expect(shared('pagination.module.css')).toMatch(/\[data-theme='v8'\] \.pagination \{[^}]*padding:\s*10px 20px/s)
  })

  it('古い帯 CSS（kpi-band-v8.css）は消えている', () => {
    expect(() => readFileSync(join(HERE, '..', 'shared', 'kpi-band-v8.css'), 'utf8')).toThrow()
    const globals = readFileSync(join(HERE, '..', '..', 'app', 'globals.css'), 'utf8')
    expect(globals).not.toMatch(/kpi-band-v8/)
  })
})
