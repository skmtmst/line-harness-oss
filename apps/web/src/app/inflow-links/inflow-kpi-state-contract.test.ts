import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

/** 数の帯ぶんだけを切り出す。ファイル全体を見ると別の数に当たって素通りする。 */
function band(): string {
  const at = PAGE.indexOf('aria-label="流入と計測の概要"')
  if (at < 0) return ''
  return PAGE.slice(at, at + 4500)
}

/**
 * 設計 `BMmxU`（18-1-F 空・読込・エラー）の主題は「3つを混ぜない」。
 *
 * 一覧側は言い分けていたのに、**帯だけが `sortedRows.length` を
 * そのまま出していた。** 取得に失敗すると配列は空なので、
 * 登録した流入元が1つも無いように読める。数を作っているのと同じ。
 */
describe('流入と計測の帯は、読めていない数を0件と書かない', () => {
  it('流入元の数は読めたときだけ出す', () => {
    const tiles = band()
    expect(tiles, '帯が見つからない').not.toBe('')
    // ここは「読めていないときに数を出さない」ことだけを見る。
    // **何を数えるか**は別の主題なので `inflow-kpi-scope-contract.test.ts` が見る。
    expect(tiles, '読めていなくても件数を出している').toContain(
      "routeCountAvailable ? formatNumber(accountRouteCount) : '—'",
    )
  })

  it('読込中と取得失敗を言い分ける', () => {
    const tiles = band()
    expect(tiles).toContain('読み込んでいます')
    expect(tiles).toContain('読み込めませんでした')
  })

  it('判定は読込中と失敗の両方を見る', () => {
    expect(PAGE).toContain('const routeCountAvailable = !loading && !loadFailed')
  })
})
