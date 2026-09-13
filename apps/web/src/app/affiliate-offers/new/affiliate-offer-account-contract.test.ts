import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')

/**
 * V6 案件作成のLINEアカウント選択の契約（#505 重大1 / #686 cross-account）。
 *
 * 「すべてのアカウント」のまま送ると口が 400 で落とす（複数アカウントの
 * 運用者は既定のまま押すと必ず失敗した）。#686 差し戻し以降は、選ばせる
 * のではなく画面上部で選んでいるLINEアカウントへ固定し、他アカウントへ
 * 誤って作成できないようにする。
 */
describe('V6 案件作成のアカウント選択の契約', () => {
  it('選択中のLINEアカウントが無いときは押させない', () => {
    expect(PAGE).toContain('if (!selectedAccountId) return \'LINEアカウントを選んでください（画面上部で選べます）\'')
  })

  it('誘導するLINEアカウントは選択中アカウントへ固定し、選ばせない', () => {
    expect(PAGE).toContain('const { selectedAccountId, selectedAccount } = useAccount()')
    expect(PAGE).toContain('lineAccountId: selectedAccountId')
    expect(PAGE).not.toContain("label: '選んでください'")
    expect(PAGE).not.toContain("label: 'すべてのアカウント'")
  })
})
