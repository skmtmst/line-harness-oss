import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')

/**
 * V6 案件作成のLINEアカウント選択の契約（#505 重大1）。
 *
 * 「すべてのアカウント」のまま送ると口が 400 で落とす（複数アカウントの
 * 運用者は既定のまま押すと必ず失敗した）。選べる先が複数あるときは、
 * 押す前に選ばせる。
 */
describe('V6 案件作成のアカウント選択の契約', () => {
  it('選べる先が複数あるときは未選択で押させない', () => {
    expect(PAGE).toContain("if (!lineAccountId && accounts.length > 1) return 'LINEアカウントを選んでください'")
    expect(PAGE).toContain("label: '選んでください'")
    expect(PAGE).not.toContain("label: 'すべてのアカウント'")
  })

  it('選べる先が1つだけなら最初から選んでおく', () => {
    expect(PAGE).toContain('if (list.length === 1) setLineAccountId(list[0].id)')
  })
})
