import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'),
  'utf8',
)

/** リマインダ一覧の状態（設計 `dC0yg` 7-1-J）。 */
describe('リマインダ一覧の空と失敗', () => {
  it('失敗を「ありません」と言わない', () => {
    /*
     * 上に「読み込めませんでした」を出しているのに、一覧の中で
     * 「ありません。作成してください」と並ぶと、登録済みのものが
     * 消えたように読める。
     */
    expect(PAGE).toContain("リマインダがありません。「＋ 新しいリマインダ」から作成してください。")
    expect(PAGE).toContain('表示できませんでした。上の案内をご覧ください。')
  })

  it('直らないときの行き先を書く', () => {
    // 「もう一度お試しください」だけだと、押し直しても直らないとき詰まる。
    expect(PAGE).toContain('再読み込みしても直らない場合はエラー報告へ。')
    expect(PAGE).not.toContain('リマインダの読み込みに失敗しました。もう一度お試しください。')
  })

  it('絞り込みで0件になった場合と、そもそも0件を分ける', () => {
    expect(PAGE).toContain('この条件に合うリマインダはありません。')
  })
})
