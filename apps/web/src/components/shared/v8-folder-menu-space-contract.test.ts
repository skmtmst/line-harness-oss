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
  it('選んでいない行は「…」の場所を取らない', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.row:not\(\[data-active\]\) \.menu \{ width: 0;/)
  })
  it('乗せたとき・キーボードで入ったときは出す', () => {
    expect(css).toMatch(/\.row:not\(\[data-active\]\):focus-within \.menu/)
    expect(css).toMatch(/\.row:not\(\[data-active\]\):focus-within \.menuButton \{ opacity: 1; \}/)
  })
})
