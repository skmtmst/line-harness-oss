import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

/** 帯の1枚ぶんだけを切り出す。ファイル全体を見ると別の帯に当たって素通りする。 */
function kpiCard(title: string): string {
  const at = PAGE.indexOf(`title="${title}"`)
  if (at < 0) return ''
  const start = PAGE.lastIndexOf('<KpiCard', at)
  const end = PAGE.indexOf('/>', at)
  return PAGE.slice(start, end)
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
    const card = kpiCard('流入元')
    expect(card, '帯が見つからない').not.toBe('')
    // ここは「読めていないときに数を出さない」ことだけを見る。
    // **何を数えるか**は別の主題なので `inflow-kpi-scope-contract.test.ts` が見る。
    // 式の字面ごと固定していたため、数える対象を直したときに
    // 意図は保たれているのにこの試験だけが落ちていた。
    expect(card, '読めていなくても件数を出している').toMatch(/value=\{routeCountAvailable \? \w+ : null\}/)
  })

  it('読込中と取得失敗を言い分ける', () => {
    const card = kpiCard('流入元')
    expect(card).toContain('読み込んでいます')
    expect(card).toContain('読み込めませんでした')
  })

  it('判定は読込中と失敗の両方を見る', () => {
    expect(PAGE).toContain('const routeCountAvailable = !loading && !loadFailed')
  })

  it('クリックの帯も未取得を0にしない', () => {
    const card = kpiCard('クリック')
    expect(card).toContain('summaryAvailable ? totalClicks : null')
  })
})
