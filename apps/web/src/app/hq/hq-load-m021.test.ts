import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * M021：読み込み失敗の文言が一律で、権限不足と分からない。
 * 捕まえた失敗を共通部品へ渡し、403 は権限不足として区別する。
 * 再試行口は残すが、403（押しても直らない）には出さない。
 */
describe('M021 統括の読み込み失敗の区別', () => {
  it('読み込み失敗は共通の状態別案内に渡す', () => {
    expect(PAGE).toContain('loadFailureNotice(')
    expect(PAGE).toContain("'統括のアカウント情報'")
    expect(PAGE).not.toContain('統括のアカウント情報を読み込めませんでした。時間をおいてもう一度お試しください。')
  })

  it('権限不足には再試行口を出さない', () => {
    expect(PAGE).toContain('classifyApiFailure(')
  })
})
