import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'list-v8.module.css'), 'utf8')

/*
 * V8 一斉配信の数字合わせ（NtCE3）。見本 `NtCE3.html` の寸法に合わせる。
 * 見出し 13px/500・余白13px 20px、行の余白9px 20px、題13px/500。
 * 件数・金額などの中身は API の実データを出す（絵の数は写さない）。
 */
describe('一斉配信の数字合わせ', () => {
  it('見出しは12px・500・余白13px 20px', () => {
    expect(CSS).toContain('padding: 13px 20px')
    expect(CSS).toMatch(/\.table th \{[^}]*font-size: 12px/)
    expect(CSS).toMatch(/\.table th \{[^}]*font-weight: 500/)
  })

  it('行は余白9px 20px', () => {
    expect(CSS).toMatch(/\.table td \{[^}]*padding: 9px 20px/)
  })

  it('題は13px・500', () => {
    expect(CSS).toMatch(/\.cellTitle \{[^}]*font-size: 13px/)
    expect(CSS).toMatch(/\.cellTitle \{[^}]*font-weight: 500/)
  })
})
