import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 友だち追加時の配信の一覧と板 `MRhef` の数値突き合わせ（2026-10-03）。
 * 見本の数字が変わったらここも直す。共通部品の中身は M10 の持ち物なので見ない。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'list-v8.module.css'), 'utf8')
const tsx = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')

describe('友だち追加時の配信の一覧は板 MRhef の数字どおり', () => {
  it('数の帯のマスは余白 16/20・間 8', () => {
    expect(css).toMatch(/\.kpi \{[^}]*padding: 16px 20px/s)
    expect(css).toMatch(/\.kpi \{[^}]*gap: 8px/s)
  })

  it('数の帯の題は 12・500・ink、数は 22・600', () => {
    expect(css).toMatch(/\.kpiLabel \{[^}]*font-weight: 500/s)
    expect(css).toMatch(/\.kpiLabel \{[^}]*color: var\(--color-ink\)/s)
    expect(css).toMatch(/\.kpiValue \{[^}]*font-size: 22px/s)
    expect(css).toMatch(/\.kpiValue \{[^}]*font-weight: 600/s)
  })

  it('表の見出しは余白 12/24・12/600/secondary・地 table-head、行の余白は 12/24・中央寄せ', () => {
    expect(css).toMatch(/\.table th \{[^}]*padding: 12px 24px/s)
    expect(css).toMatch(/\.table th \{[^}]*font-size: 12px/s)
    expect(css).toMatch(/\.table th \{[^}]*color: var\(--color-ink-secondary\)/s)
    expect(css).toMatch(/\.table th \{[^}]*background: var\(--color-table-head\)/s)
    expect(css).toMatch(/\.table td \{[^}]*padding: 12px 24px/s)
    expect(css).toMatch(/\.table td \{[^}]*vertical-align: middle/s)
  })

  it('列幅は順 28・設定は伸び縮み・最初に送るもの 170・状態 80・直近7日 64・操作 28', () => {
    expect(tsx).toContain('<col style={{ width: 28 }} />')
    expect(tsx).toContain('<col style={{ width: 170 }} />')
    expect(tsx).toContain('<col style={{ width: 80 }} />')
    expect(tsx).toContain('<col style={{ width: 64 }}')
    expect(tsx).not.toContain('<col style={{ width: 72 }} />')
    expect(tsx).not.toContain('<col style={{ width: 200 }} />')
  })

  it('探す欄の幅は 220', () => {
    expect(css).toMatch(/\.searchWrap \{[^}]*width: 220px/s)
  })
})
