import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/*
 * 友だち一覧の読込状態の禁止の見張り。
 * 失敗・再試行・件数・CSV の止め方は friends-list-behavior.test.tsx、
 * 遅い応答を採用しないことは friends-stale-response-contract.test.tsx が描いて確かめる。
 */
describe("管理画面 友だち一覧の読込状態", () => {
  it('読込失敗を通知の文だけにして一覧を0件のまま出す書き方に戻さない', () => {
    expect(PAGE).not.toContain('setError(response.error)')
  })

  it('件数を絞り込みの行に重ねて出さない（見出しの横の1か所だけ）', () => {
    expect(PAGE).not.toContain("{loadStatus === 'ready' ? `${formatNumber(total)}件` : '—'}")
  })
})
