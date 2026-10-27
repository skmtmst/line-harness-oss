import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const PAGE = readFileSync(new URL('../../../v8/hq/members.tsx', import.meta.url), 'utf8')
const SETTINGS = readFileSync(new URL('../../../v8/hq/settings.tsx', import.meta.url), 'utf8')

/**
 * M026：権限ダイアログ原文・再送と統括名保存に再試行の案内なし。
 * 共通の状態別案内へ渡すことは members-failure-react が描いて押して見る。
 * ここは原文のまま出す古い形へ戻さない禁止の見張りだけを残す。
 */
describe('M026 権限者の失敗表示', () => {
  it('権限ダイアログ・招待の再送・統括名の保存を原文の代替文へ戻さない', () => {
    expect(PAGE).not.toContain("caught.message : '保存できませんでした。もう一度お試しください。'")
    expect(PAGE).not.toContain("caught.message : '招待メールを送り直せませんでした。'")
    expect(SETTINGS).not.toContain("caught.message : '統括名を保存できませんでした。'")
  })
})
