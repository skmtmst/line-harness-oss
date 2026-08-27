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
})
