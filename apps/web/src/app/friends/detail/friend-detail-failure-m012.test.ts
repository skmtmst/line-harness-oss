import { describe, expect, it } from 'vitest'
import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * M012：対応状況の保存・シナリオ登録の失敗で内部文が出る（禁止の見張り）。
 * 失敗の案内そのものは friend-detail-save-failure.test.tsx が窓を描いて確かめる。
 */
describe('M012 友だち詳細の失敗表示', () => {
  it('対応状況・シナリオ登録の失敗で原文をそのまま出す書き方に戻さない', () => {
    expect(PAGE).not.toContain('setSupportError(err instanceof ApiError ? err.message')
    expect(PAGE).not.toContain('setScenarioError(err instanceof ApiError ? err.message')
  })
})
