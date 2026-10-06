import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'page-header.module.css'), 'utf8')

/*
 * 板の頭は 379 板の多数派（JKjsE）が既定。値は --tpl-* で読む。
 * 部品 EnlYo どおりの小さい形は data-header-size="compact" に残す。
 * v7 は変えない。
 */
describe('板の頭（v8・JKjsE既定＋EnlYo compact）', () => {
  it('既定は題 22/700/32・間 4・説明 13/19・余白 20/24/12・枠なし', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.title \{[^}]*font-size:\s*var\(--tpl-title-size\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.title \{[^}]*font-weight:\s*var\(--tpl-title-weight\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.title \{[^}]*line-height:\s*var\(--tpl-title-lh\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.heading \{[^}]*gap:\s*var\(--tpl-head-gap\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.description \{[^}]*font-size:\s*var\(--tpl-desc-size\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.description \{[^}]*line-height:\s*var\(--tpl-desc-lh\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.header \{[^}]*padding:\s*var\(--tpl-head-pad-top\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.header \{[^}]*border:\s*0/s)
  })

  it('compact は EnlYo どおり（20/27・間 2・説明 13/20）', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.header\[data-header-size='compact'\] \.title \{[^}]*font-size:\s*var\(--tpl-compact-title-size\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.header\[data-header-size='compact'\] \.title \{[^}]*line-height:\s*var\(--tpl-compact-title-lh\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.header\[data-header-size='compact'\] \.heading \{[^}]*gap:\s*var\(--tpl-compact-gap\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.header\[data-header-size='compact'\] \.description \{[^}]*line-height:\s*var\(--tpl-compact-desc-lh\)/s)
  })
})
