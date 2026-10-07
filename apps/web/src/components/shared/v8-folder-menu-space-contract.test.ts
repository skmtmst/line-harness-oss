import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ★V8 のフォルダの列：「…」の場所を取るのは選んでいる行だけ（絵 uE9gf・apLqS・I1E7Bt・v19Ivv）。
 * 全部の行が 14px＋間 8px を取ると、選んでいない行の件数が 22〜26px 左にずれる。
 * 選んでいない行でも、乗せたとき・キーボードで中へ入ったときは場所を取って出す（押せなくはしない）。
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'folder-panel.module.css'), 'utf8')

describe('V8 のフォルダの列：「…」の場所', () => {
  // 2026-10-07 動きの点検 4 番：場所取りの hack（幅 0・負の余白）をやめ、件数の場所に重ねる形へ。
  it('選んでいない行は「…」の場所を取らない（件数の場所に重ねる）', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.row:not\(\[data-active\]\) \.menu \{\s*position: absolute;/)
  })
  it('乗せたとき・キーボードで入ったときは出す', () => {
    expect(css).toMatch(/\.row:not\(\[data-active\]\):focus-within \.menu/)
    expect(css).toMatch(/\.row:not\(\[data-active\]\):focus-within \.menuButton,[^{]*\{ opacity: 1; \}/)
  })
})
