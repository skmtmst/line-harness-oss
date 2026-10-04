import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const SETTINGS = readFileSync(new URL('../settings/page.tsx', import.meta.url), 'utf8')

/**
 * M026：権限ダイアログ原文・再送と統括名保存に再試行の案内なし。
 * 原文のまま出さず、共通の状態別案内（再試行の言葉つき）へ渡す。
 */
describe('M026 権限者の失敗表示', () => {
  it('権限ダイアログの失敗は状態別案内へ渡す', () => {
    expect(PAGE).toContain("describeApiFailure(caught, '保存'")
    expect(PAGE).toContain('権限者の招待・変更はオーナーか管理者だけができます')
    expect(PAGE).not.toContain("caught.message : '保存できませんでした。もう一度お試しください。'")
  })

  it('招待の再送の失敗は再試行の言葉つきにする', () => {
    expect(PAGE).toContain("describeApiFailure(caught, '招待メールの再送'")
    expect(PAGE).not.toContain("caught.message : '招待メールを送り直せませんでした。'")
  })

  it('統括名保存の失敗は再試行の言葉つきにする（統括名の保存は /hq/settings）', () => {
    expect(SETTINGS).toContain("describeApiFailure(caught, '統括名の保存'")
    expect(SETTINGS).not.toContain("caught.message : '統括名を保存できませんでした。'")
  })
})
