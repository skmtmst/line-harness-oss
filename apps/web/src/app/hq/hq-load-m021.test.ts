import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const PAGE = readFileSync(new URL('../../v8/hq/home.tsx', import.meta.url), 'utf8')

/**
 * M021：読み込み失敗の文言が一律で、権限不足と分からない。
 * 共通の案内へ渡すこと・403 に再試行の口を出さないことは hq-home-wiring-react が描いて見る。
 * ここは一律の文へ戻さない禁止の見張りだけを残す。
 */
describe('M021 統括の読み込み失敗の区別', () => {
  it('一律の失敗文へ戻さない', () => {
    expect(PAGE).not.toContain('統括のアカウント情報を読み込めませんでした。時間をおいてもう一度お試しください。')
  })
})
