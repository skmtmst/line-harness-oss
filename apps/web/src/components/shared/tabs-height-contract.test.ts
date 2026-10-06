import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'tabs.module.css'), 'utf8')

/*
 * タブの段の高さ（fb9NJ・L24 の後追い）。
 * 部品 clV5c は固定値なし（札は中身＋下 12。中身 20 → 32）。
 * 実装 v8 も固定 height を持たず中身連動（文 20＋下 12＝32）。
 * 書き出し PNG の 35・44 は崩れのため使わない。後ろの指定が勝つ
 * カスケードのため、v8 の .tab／.list の最後の指定が height: auto
 * であることを守る（消すと 35px 固定が復活する）。
 */
describe('タブの段の高さ（内容連動・固定なし）', () => {
  it('v8 の .tab の最後の指定は height: auto（下 12・間 24 は部品どおり）', () => {
    const blocks = [...css.matchAll(/\[data-theme='v8'\]\s*\.tab\s*\{[^}]*\}/gs)].map((m) => m[0])
    expect(blocks.length, 'v8 の .tab の指定がありません').toBeGreaterThan(0)
    const last = blocks[blocks.length - 1]
    expect(last).toMatch(/height:\s*auto/)
    expect(last).toMatch(/padding:\s*0 0 12px/)
    expect(css).toMatch(/\[data-theme='v8'\]\s*\.items\s*\{[^}]*gap:\s*24px/s)
  })

  it('v8 の .list の最後の指定は height: auto（v7 の 44px は変えない）', () => {
    const blocks = [...css.matchAll(/\[data-theme='v8'\]\s*\.list\s*\{[^}]*\}/gs)].map((m) => m[0])
    expect(blocks.length, 'v8 の .list の指定がありません').toBeGreaterThan(0)
    const last = blocks[blocks.length - 1]
    expect(last).toMatch(/height:\s*auto/)
    // v7 の既定（44px）は残す。
    expect(css).toMatch(/\.list\s*\{[^}]*height:\s*44px/s)
  })
})
