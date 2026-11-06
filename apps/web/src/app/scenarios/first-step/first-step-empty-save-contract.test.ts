import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('../../../v8/scenario-first-step/first-step.tsx', import.meta.url), 'utf8')

/**
 * 点検 #495 中7 の再発防止。
 *
 * 空の保存は欄の誤りにして止め、空のまま進む道は「1通目はあとで書く」に寄せる。
 * その動きは first-step-audit.test.tsx が描いて押して守る。ここは画面全体の誤りへ
 * 戻さない禁止の見張りだけを残す。
 */
describe('シナリオ1通目の空保存（点検 #495 中7）', () => {
  it('空なら欄の誤りにして保存を止める', () => {
    expect(PAGE).not.toContain("setError('内容を入力してください")
  })
})
