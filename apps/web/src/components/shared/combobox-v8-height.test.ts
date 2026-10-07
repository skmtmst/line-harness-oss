import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * ★V8 の「探して選ぶ欄」（友だちを選ぶ欄など）は、ほかの入れる欄・選ぶ欄と同じ高さ 36（絵 w4SBbv・EsYo4）。
 * v7 は 40、指で触る画面は 44 のまま。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'combobox.module.css'), 'utf8')
const globals = readFileSync(join(HERE, '..', '..', 'app', 'globals.css'), 'utf8')

describe('探して選ぶ欄の高さ', () => {
  it('V8 は 36（変数）。指で触る画面には効かせない', () => {
    expect(css).toMatch(/@media not \(pointer: coarse\) \{\s*\[data-theme='v8'\] \.field \{\s*height: var\(--tpl-ux5-combobox-h\);/)
    expect(globals).toMatch(/\[data-theme="v8"\] \{[^}]*--tpl-ux5-combobox-h: 36px;/)
  })

  it('v7 の 40・指の 44 は残す', () => {
    expect(css).toMatch(/\.field \{[^}]*height: 40px;/)
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.field \{\s*height: 44px;/)
  })
})
