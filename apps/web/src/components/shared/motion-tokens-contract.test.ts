import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 動きの物差し（Pencil ★V7「基礎 動き」、V7 文書 `bi8Au`）の契約。
 *
 * 部品ごとに 120ms・150ms・300ms と長さがばらばらだったので、V7 から
 * `--motion-*` の4段と2本の曲線だけを使う。ここでは
 *   1. 物差しが `:root` にあること（`@theme` だと CSS Modules からは読めず消える）
 *   2. 動きを減らす設定で全部止まること
 *   3. 共通部品の CSS に ms を直接書いた所が増えないこと
 * を見張る。3 の BASELINE は減らす方向にだけ直す。
 */

const SHARED = dirname(fileURLToPath(import.meta.url))
const GLOBALS = readFileSync(join(SHARED, '..', '..', 'app', 'globals.css'), 'utf8')

/** V7 より前から ms を直書きしている部品。トークンへ移したら消す。 */
const BASELINE = [
  'filter-chip.css',
  'list-state.module.css',
  'radio-card.module.css',
  'search-field.module.css',
  'kpi-card.module.css',
]

function rawDurationDeclarations(css: string): string[] {
  return (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/(?:transition|animation)[\w-]*\s*:[^;]*;/g) ?? [])
    // `0s`（すぐ切り替える）は長さではないので数えない
    .filter((declaration) => /(?<![\d.])(?!0m?s\b)\d+(?:\.\d+)?m?s\b/.test(declaration))
}

describe('動きの物差し（★V7 基礎 動き）', () => {
  it('4段の長さと2本の曲線が :root にある', () => {
    const root = GLOBALS.match(/:root\s*\{[\s\S]*?\n\}/g)?.find((block) => block.includes('--motion-base')) ?? ''
    expect(root).toMatch(/--motion-instant:\s*80ms;/)
    expect(root).toMatch(/--motion-fast:\s*120ms;/)
    expect(root).toMatch(/--motion-base:\s*200ms;/)
    expect(root).toMatch(/--motion-slow:\s*300ms;/)
    expect(root).toMatch(/--motion-ease-out:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\);/)
    expect(root).toMatch(/--motion-ease-in-out:\s*cubic-bezier\(0\.65, 0, 0\.35, 1\);/)
  })

  it('Tailwind の ease-* を上書きしない', () => {
    expect(GLOBALS).not.toMatch(/^\s*--ease-(?:out|in-out|in):/m)
  })

  it('動きを減らす設定では、動きと移り変わりが一瞬になる', () => {
    const block = GLOBALS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(block).toMatch(/transition-duration:\s*0\.01ms !important;/)
    expect(block).toMatch(/animation-duration:\s*0\.01ms !important;/)
    expect(block).toMatch(/animation-iteration-count:\s*1 !important;/)
  })

  it('共通部品の CSS に ms を直接書いた所が増えていない', () => {
    const offenders = readdirSync(SHARED)
      .filter((name) => name.endsWith('.css'))
      .filter((name) => rawDurationDeclarations(readFileSync(join(SHARED, name), 'utf8')).length > 0)
    expect(offenders.filter((name) => !BASELINE.includes(name))).toEqual([])
    // トークンへ移し終えた部品は BASELINE から消す（残すと、また直書きしても通ってしまう）
    expect(BASELINE.filter((name) => !offenders.includes(name))).toEqual([])
  })

  it('チェックボックスは物差しの値だけで動く', () => {
    const css = readFileSync(join(SHARED, 'checkbox.module.css'), 'utf8')
    expect(css).toMatch(/var\(--motion-fast\) var\(--motion-ease-out\)/)
    expect(css).toMatch(/stroke-dashoffset var\(--motion-base\) var\(--motion-ease-out\)/)
  })
})
