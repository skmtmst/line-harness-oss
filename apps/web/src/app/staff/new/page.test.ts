import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'
const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
describe('店舗側のユーザー追加', () => {
  it('選択中の店舗だけを担当範囲として送る', () => {
    expect(source).toContain("accountScope: 'accounts'")
    expect(source).toContain('scopedLineAccountIds: [selectedAccountId]')
  })
  it('担当アカウントは画面で選ばせず、配下への権限も付けない', () => {
    expect(source).not.toContain('最初に表示するLINEアカウント')
    expect(source).not.toContain('この店舗より下のアカウントにも権限を付ける')
    expect(source).toContain('assignedLineAccountId: selectedAccountId')
    expect(source).toContain('canAccessDescendantAccounts: false')
  })
  it('メール形式と担当範囲を保存前に確かめる', () => {
    expect(source).toContain('正しいメールアドレスを入力してください')
    expect(source).toContain('/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/')
    expect(source).toContain('のみを閲覧・操作できる担当者として追加されます')
  })
  it('メールアドレスは254文字までで保存前に止める（M959）', () => {
    expect(source).toContain('254')
    expect(source).toContain('maxLength')
  })
})
