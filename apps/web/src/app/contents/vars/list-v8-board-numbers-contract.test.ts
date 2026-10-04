import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 共通情報の一覧と板 `FM94M` の数値突き合わせ（2026-10-03）。
 * 見本の数字が変わったらここも直す。共通部品の中身は M10 の持ち物なので見ない。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'list-v8.module.css'), 'utf8')
const tsx = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')

describe('共通情報の一覧は板 FM94M の数字どおり', () => {
  it('数の帯のマスは余白 16/20・間 8', () => {
    expect(css).toMatch(/\.kpi \{[^}]*padding: 16px 20px/s)
    expect(css).toMatch(/\.kpi \{[^}]*gap: 8px/s)
  })

  it('数の帯の題は 12・500・ink、数は 22・600', () => {
    expect(css).toMatch(/\.kpiLabel \{[^}]*font-size: 12px/s)
    expect(css).toMatch(/\.kpiLabel \{[^}]*color: var\(--color-ink\)/s)
    expect(css).toMatch(/\.kpiValue \{[^}]*font-size: 22px/s)
    expect(css).toMatch(/\.kpiValue \{[^}]*font-weight: 600/s)
  })

  it('表の見出しは余白 12/24・12/600/secondary・地 table-head、行の余白は 12/24', () => {
    expect(css).toMatch(/\.table th \{[^}]*padding: 12px 24px/s)
    expect(css).toMatch(/\.table th \{[^}]*font-size: 12px/s)
    expect(css).toMatch(/\.table th \{[^}]*color: var\(--color-ink-secondary\)/s)
    expect(css).toMatch(/\.table th \{[^}]*background: var\(--color-table-head\)/s)
    expect(css).toMatch(/\.table td \{[^}]*padding: 12px 24px/s)
  })

  it('列幅は中身 170・状態 80・使っている所 90で見出しに付く', () => {
    expect(css).toMatch(/\.cellValue \{\s*width: 170px/)
    expect(css).toMatch(/\.cellStatus \{\s*width: 80px/)
    expect(css).toMatch(/\.cellUsage \{\s*width: 90px/)
    expect(tsx).toContain('className={styles.cellValue}')
    expect(tsx).toContain('className={styles.cellStatus}')
    expect(tsx).toContain('className={styles.cellUsage}')
  })

  it('ページ送りの段は余白 10/20・間 6、件数は 13/secondary', () => {
    expect(css).toMatch(/\.foot \{[^}]*gap: 6px/s)
    expect(css).toMatch(/\.foot \{[^}]*padding: 10px 20px/s)
    expect(css).toMatch(/\.footCount \{[^}]*font-size: 13px/s)
    expect(css).toMatch(/\.footCount \{[^}]*color: var\(--color-ink-secondary\)/s)
  })

  it('警告の帯は余白 10/14・間 10、探す欄の幅は 200', () => {
    expect(css).toMatch(/\.alertBand \{[^}]*padding: 10px 14px/s)
    expect(css).toMatch(/\.alertBand \{[^}]*gap: 10px/s)
    expect(css).toMatch(/\.searchWrap \{[^}]*width: 200px/s)
  })
})
