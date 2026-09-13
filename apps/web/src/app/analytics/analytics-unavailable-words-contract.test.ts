import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * 分析の未取得表記を共通契約へ揃える(Issue #606)。
 * 共通基盤(v6-shared-platform-requirements.md §9)の決めごと:
 * 理由不明の未取得は値「—」・ラベル「未取得」。
 * 「取得できません」「取得不可」「unavailable」を画面文言に使わない。
 */
describe('分析の未取得表記', () => {
  it('禁止表記を使わない', () => {
    expect(PAGE).not.toContain('を取得できません')
    expect(PAGE).not.toContain('取得不可')
  })

  it('クロス分析は理由がなければ「未取得」と出す', () => {
    expect(PAGE).toContain("crossResult.stateReason || '未取得'")
  })

  it('経路の売上は未取得と実測を分ける', () => {
    expect(PAGE).toContain("'売上は未取得です'")
  })

  it('保存結果のunavailableは「未取得」と出す', () => {
    expect(PAGE).toContain("unavailable: '未取得'")
    expect(PAGE).toContain('未取得・失敗の最新結果')
  })
})
