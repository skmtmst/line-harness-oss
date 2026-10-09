import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * ウェビナーの一覧と板 `UyUMw` の数値突き合わせ（2026-10-03）。
 * 見本の数字が変わったらここも直す。共通部品の中身は M10 の持ち物なので見ない。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'list-v8.module.css'), 'utf8')

describe('ウェビナーの一覧は板 UyUMw の数字どおり', () => {
  it('数の帯のマスは余白 16/20・間 8', () => {
    expect(css).toMatch(/\.kpiCell \{[^}]*padding: 16px 20px/s)
    expect(css).toMatch(/\.kpiCell \{[^}]*gap: 8px/s)
  })

  it('数の帯の題は 12・500・ink', () => {
    expect(css).toMatch(/\.kpiLabel \{[^}]*font-size: 12px/s)
    expect(css).toMatch(/\.kpiLabel \{[^}]*color: var\(--color-ink\)/s)
  })

  it('表の見出しの地は table-head', () => {
    expect(css).toMatch(/\.table thead th \{[^}]*background: var\(--color-table-head\)/s)
  })

  it('探す欄の幅は 240', () => {
    expect(css).toMatch(/\.searchWrap \{[^}]*width: 240px/s)
  })
})
