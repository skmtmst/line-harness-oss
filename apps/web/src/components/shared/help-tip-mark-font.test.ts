import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * V8 の「?」の印：字の箱を絵の行の高さ（10）に近づけるため、半角の「?」は上下の幅の小さい Inter で描く。
 * Noto Sans JP の 10px では字の箱が 15 になり、測ると上に 3・高さ +5 ずれる（2026-10-07 測定）。
 * 円の大きさ 16 と字の大きさ 10 は変えない。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'help-tip.module.css'), 'utf8')
const globals = readFileSync(join(HERE, '..', '..', 'app', 'globals.css'), 'utf8')

describe('「?」の印の字', () => {
  it('V8 の印の字は Inter の変数で描き、最後に効く', () => {
    const last = css.lastIndexOf("[data-theme='v8'] .mark {")
    expect(css.slice(last)).toMatch(/font-family: var\(--tpl-ux5-help-mark-font\);/)
    expect(globals).toMatch(/\[data-theme="v8"\] \{[^}]*--tpl-ux5-help-mark-font: var\(--font-inter\), Inter, sans-serif;/)
  })

  it('円は 16px・字は 10px のまま', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.mark \{[^}]*width: 16px;[^}]*height: 16px;/)
    expect(css).toMatch(/font-size: 10px;\s*line-height: 10px;/)
  })
})
