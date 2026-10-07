import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
// 一覧の入口は src/v8/broadcasts/list.tsx（古い list-v8.module.css はもう描かれない）。
// 新しい一覧は寸法を共通の値（globals.css の --tpl-bc-*・--text-*）から読む。
const CSS = readFileSync(join(HERE, '../../v8/broadcasts/list.module.css'), 'utf8')
const GLOBALS = readFileSync(join(HERE, '../globals.css'), 'utf8')
const token = (name: string) => GLOBALS.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim()

/*
 * V8 一斉配信の数字合わせ（NtCE3）。見本 `NtCE3.html` の寸法に合わせる。
 * 見出し 13px/500・余白13px 20px、行の余白9px 20px、題13px/500。
 * 件数・金額などの中身は API の実データを出す（絵の数は写さない）。
 */
describe('一斉配信の数字合わせ', () => {
  it('見出しは12px・500・余白13px 20px', () => {
    expect(CSS).toMatch(/\.table thead th \{[^}]*padding-block: var\(--tpl-bc-head-pad-block\)/)
    expect(token('--tpl-bc-head-pad-block')).toBe('13px')
    expect(CSS).toMatch(/\.table th:first-child,\s*\.table td:first-child \{ padding-left: var\(--tpl-bc-edge-pad\)/)
    expect(token('--tpl-bc-edge-pad')).toBe('20px')
    expect(CSS).toMatch(/\.table thead th \{[^}]*font-size: var\(--text-caption\)/)
    expect(token('--text-caption')).toBe('12px')
    expect(CSS).toMatch(/\.table thead th \{[^}]*font-weight: 500/)
  })

  it('行は余白9px 20px', () => {
    expect(CSS).toMatch(/\.table td \{[^}]*padding: var\(--tpl-bc-cell-pad-block\)/)
    expect(token('--tpl-bc-cell-pad-block')).toBe('9px')
    expect(CSS).toMatch(/\.table th:last-child,\s*\.table td:last-child \{ padding-right: var\(--tpl-bc-edge-pad\)/)
  })

  it('題は13px・500', () => {
    expect(CSS).toMatch(/\.cellTitle \{[^}]*font-size: var\(--text-label\)/)
    expect(token('--text-label')).toBe('13px')
    expect(CSS).toMatch(/\.cellTitle \{[^}]*font-weight: 500/)
  })
})
