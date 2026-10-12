import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const css = readFileSync(new URL('../../v8/inflow-links/list.module.css', import.meta.url), 'utf8')
const globals = readFileSync(new URL('../globals.css', import.meta.url), 'utf8')

describe('流入と計測の一覧の行は板 xbHxg の余白どおり', () => {
  it('行の余白は共有の列の並びで左右20・上下9を持ち、セルは重ねない', () => {
    expect(css).toContain("row[data-table-layout='columns']")
    expect(css).toContain('padding: var(--tpl-il-row-pad)')
    expect(globals).toContain('--tpl-il-row-pad: 9px 20px')
    expect(css).toContain('padding: 0')
  })
})
