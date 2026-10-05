import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'page-header.module.css'), 'utf8')

/*
 * 板の頭は部品 EnlYo の値どおり。
 * 題 20px/600/行27・間 2px・説明 13px/400/行20・上の余白 20。
 * v7 は変えない。
 */
describe('板の頭（v8・部品 EnlYo）', () => {
  it('題は 20・行27・間 2・説明は 13・行20', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.title \{[^}]*font-size:\s*20px/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.title \{[^}]*line-height:\s*27px/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.heading \{[^}]*gap:\s*2px/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.description \{[^}]*font-size:\s*var\(--text-label\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.description \{[^}]*line-height:\s*20px/s)
  })

  it('頭の上の余白は 20', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.header \{[^}]*padding:\s*20px 24px/s)
  })
})
