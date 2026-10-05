import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'data-table.module.css'), 'utf8')

/*
 * ★V8「表の行」（JpOg0・apLqS・axFrW計測）。1行の行＝60px、
 * 名前＋説明の2行の行＝86px。tr の高さは最小値として働くので、
 * 中身が増えれば伸びる。2行の判定は中身（.sub/.memo）で自動。
 */
describe('表の行の高さ（JpOg0）', () => {
  it('v8 の1行の行は60px', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.row \{[^}]*height:\s*60px/s)
  })

  it('v8 の名前＋説明の行は86px（中身で自動）', () => {
    expect(css).toMatch(
      /\[data-theme='v8'\] \.row:has\(\.sub:not\(\[hidden\]\)\)[\s\S]*?height:\s*86px/s,
    )
    expect(css).toMatch(
      /\[data-theme='v8'\] \.row:has\(\.memo:not\(\[hidden\]\)\)[\s\S]*?height:\s*86px/s,
    )
  })

  it('既定（v7）の58pxは変えない', () => {
    expect(css).toMatch(/^\.row \{[^}]*height:\s*58px/m)
  })
})
