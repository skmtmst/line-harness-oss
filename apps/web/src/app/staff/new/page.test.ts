import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
describe('店舗側のユーザー追加', () => {
  it('選択中の店舗だけを担当範囲として送る', () => {
    expect(source).toContain("accountScope: 'accounts'")
    expect(source).toContain('scopedLineAccountIds: [selectedAccountId]')
  })
  it('STEP3の初期表示アカウントの説明を維持する', () => {
    expect(source).toContain('最初に表示するLINEアカウント')
    expect(source).toContain('ログイン直後の表示だけを決めます。組織内のほかのアカウントにも切り替えて操作できます。')
  })
  it('下アカウントの継承は選べる形で既定オフにする', () => {
    expect(source).toContain('この店舗より下のアカウントにも権限を付ける')
    expect(source).toContain('useState(false)')
    expect(source).toContain('canAccessDescendantAccounts: inheritAccounts')
    expect(source).not.toContain('canAccessDescendantAccounts: true')
  })
  it('メール形式と担当範囲を保存前に確かめる', () => {
    expect(source).toContain('正しいメールアドレスを入力してください')
    expect(source).toContain('/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/')
    expect(source).toContain('担当範囲は')
  })
})
