import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * ウェビナーの一覧と板  の数値突き合わせ（2026-10-03）。
 * 見本の数字が変わったらここも直す。共通部品の中身は M10 の持ち物なので見ない。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const kpi = readFileSync(join(HERE, '../../components/shared/kpi-card.module.css'), 'utf8')
const table = readFileSync(join(HERE, '../../components/shared/table.module.css'), 'utf8')
const page = readFileSync(join(HERE, '../../v8/webinars/list.tsx'), 'utf8')

describe('ウェビナーの一覧は板 UyUMw の数字どおり', () => {
  it('数の帯のマスは現役の共通の余白と間を使う', () => {
    expect(page).toContain('<KpiBand>')
    expect(kpi).toContain('gap: var(--tpl-band-cell-gap); padding: var(--tpl-band-cell-pad-block) var(--tpl-band-cell-pad-side)')
  })

  it('数の帯の題は現役の共通の13・500・ink', () => {
    expect(kpi).toMatch(/\.label \{[^}]*color: var\(--color-ink\); font-size: var\(--text-caption\); font-weight: 500/s)
  })

  it('表の見出しの地は table-head', () => {
    expect(table).toMatch(/\.headRow \{[^}]*background: var\(--color-table-head\)/s)
  })

  it('探す欄の幅は 240', () => {
    expect(page).toContain("search={{ placeholder: 'ウェビナー名で探す', label: 'ウェビナー名で探す', width: 240")
  })
})
