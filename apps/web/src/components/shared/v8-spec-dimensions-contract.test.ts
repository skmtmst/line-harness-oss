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
  it('表の行：名前・補足の行間は 1.35（行 52 前後・上下 9・左右 20 に収める）', () => {
    const css = read('./data-table.module.css')
    expect(css).toMatch(/\[data-theme='v8'\] \.name \{[^}]*line-height:\s*1\.35/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.sub \{[^}]*line-height:\s*1\.35/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.memo \{[^}]*line-height:\s*1\.35/s)
    // v7（52 の前身 58px の行）は変えない。
    expect(css).not.toMatch(/^\.name \{[^}]*line-height/m)
  })
})
