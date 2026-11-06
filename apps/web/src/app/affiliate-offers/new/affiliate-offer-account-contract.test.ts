import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, '../new-offer-v8.tsx'), 'utf8')

/**
 * 管理画面 案件作成のLINEアカウント選択の禁止の見張り。
 * 選択中アカウントへの固定と、未選択のときに送らないことは offer-account-fixed.test.tsx が押して確かめる。
 */
describe("管理画面 案件作成のアカウント選択の契約", () => {
  it('誘導するLINEアカウントを選ばせる欄に戻さない', () => {
    expect(PAGE).not.toContain("label: '選んでください'")
    expect(PAGE).not.toContain("label: 'すべてのアカウント'")
  })
})
