import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const page = readFileSync(new URL('../../v8/inflow-links/list.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../v8/inflow-links/list.module.css', import.meta.url), 'utf8')
const globals = readFileSync(new URL('../globals.css', import.meta.url), 'utf8')

describe('V8 流入と計測の一覧の共通表', () => {
  it("共通部品の左右24と本文13を共通表へ渡し、画面でセルを上書きしない", () => {
    expect(page).toMatch(/<DataTable\b[^>]*\bcolumnLayout=\{\{/)
    expect(page).toContain("padding: '0 var(--tpl-list-inset)'")
    expect(page).toContain("bodyTextSize: 'var(--polish-text-body)'")
    expect(globals).toContain('--tpl-list-inset: 24px')
    expect(css).not.toMatch(/:global\([^)]*\).*\.row/)
  })
})
