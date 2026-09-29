import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')

/**
 * V6 NENコラム編集の型の契約（#512 重大1）。
 *
 * 実API（`routes/nen-campaigns.ts` の columns 口）もモックもラクダ語
 * （`introText`・`publishedAt`）で返す。ここだけヘビ語の別型で読んでいた
 * ため、下書きが常に空になり保存ボタンがずっと押せないままだった。
 * `api.nenCampaigns.columns`（`NenColumn`）に統一して見張る。
 */
describe('V6 NENコラム編集の型の契約', () => {
  it('一覧は NenColumn（ラクダ語）の口から読む', () => {
    expect(PAGE).toContain('api.nenCampaigns.columns(selectedAccountId)')
    expect(PAGE).toContain('c.introText')
    expect(PAGE).toContain('column.publishedAt')
    expect(PAGE).toContain('column.introText')
    expect(PAGE).toContain('api.nenCampaigns.updateColumnMessage(')
  })

  it('ヘビ語の別型に戻さない', () => {
    expect(PAGE).not.toContain('intro_text')
    expect(PAGE).not.toContain('published_at')
    expect(PAGE).not.toContain('api.nenColumns.')
  })
})
