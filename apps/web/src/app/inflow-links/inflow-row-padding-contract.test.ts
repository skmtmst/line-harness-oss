import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const css = readFileSync(new URL('../../v8/inflow-links/list.module.css', import.meta.url), 'utf8')
const globals = readFileSync(new URL('../globals.css', import.meta.url), 'utf8')

describe('流入と計測の一覧の行は板 xbHxg の余白どおり', () => {
  it('行の寸法は共通DataTableへ渡し、画面でセルを上書きしない', () => {
    const page = readFileSync(new URL('../../v8/inflow-links/list.tsx', import.meta.url), 'utf8')
    expect(page).toContain("padding: '0 var(--tpl-list-inset)'")
    expect(page).toContain("rowHeight: 'var(--polish-table-row)'")
    expect(globals).toContain('--tpl-list-inset: 24px')
    expect(css).not.toMatch(/:global\([^)]*\).*\.table/)
  })
})
