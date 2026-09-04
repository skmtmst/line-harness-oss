import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const LIST_STATE = readFileSync(
  join(HERE, '..', '..', 'components', 'shared', 'list-state.tsx'),
  'utf8',
)

/**
 * リマインダ一覧の「無い」と「読めない」（設計 `dC0yg` 7-1-J）。
 *
 * **失敗を「ありません」と言わない。** 上に「読み込めませんでした」を
 * 出しているのに、一覧の中で「ありません。作成してください」と並ぶと、
 * **登録済みのものが消えたように読める。**
 *
 * **言い方は共通部品から引く。** 画面ごとに書くと、同じ事故が画面に
 * よって違う言葉になる。ここは「リマインダの読み込みに失敗しました。
 * もう一度お試しください。」で、ほかの画面は「表示できませんでした」だった。
 */
describe('リマインダ一覧の空と失敗', () => {
  it('失敗の言い方を画面で書き直さない', () => {
    // 共通部品から引く。ここに文字列を直接書かない。
    expect(PAGE).toContain('LIST_STATE_PRESETS.error.title')
    expect(PAGE).not.toContain('リマインダの読み込みに失敗しました')
    expect(PAGE).not.toContain('いまは読み込めていません')
  })

  it('共通部品が、直らないときの行き先を持っている', () => {
    // 「もう一度お試しください」だけだと、押し直しても直らないとき詰まる。
    expect(LIST_STATE).toContain('再読み込みしても直らない場合はエラー報告へ。')
    // 画面から読めるように出ていること（`export` を外すと引けなくなる）。
    expect(LIST_STATE).toMatch(/export const PRESETS/)
  })

  it('3つの状態を言い分ける', () => {
    // 読めない / そもそも0件 / 絞り込みで0件 は、運用者にとって意味が違う。
    expect(PAGE).toContain('上の案内をご覧ください')
    expect(PAGE).toContain('リマインダがありません。「＋ 新しいリマインダ」から作成してください。')
    expect(PAGE).toContain('この条件に合うリマインダはありません。')
  })
})
