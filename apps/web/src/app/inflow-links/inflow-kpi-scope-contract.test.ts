import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

function kpiCard(title: string): string {
  const at = PAGE.indexOf(`title="${title}"`)
  if (at < 0) return ''
  const start = PAGE.lastIndexOf('<KpiCard', at)
  const end = PAGE.indexOf('/>', at)
  return PAGE.slice(start, end)
}

/**
 * 検証環境（`3a21ef5e`）で、フォルダ列が
 * テスト`0`／SNS`2`／代理店`0`／未分類`1`＝合計3本と出ている横で、
 * 帯は **「流入元 0件」** だった。選択中が「テスト」だったため。
 *
 * 帯は画面全体の要約なので、**フォルダを選び替えたり検索欄に文字を打つだけで
 * 総数が変わってはいけない。** フォルダ内の件数は
 * 「選択中のフォルダ … 0 リンク」で別に出ている。
 *
 * `sortedRows` はフォルダで絞ったうえ検索文字でも絞った配列。
 * フォルダ列の件数は `accountFilteredRows` から数えており、
 * **同じ画面の中で数え方が2通りあった。**
 */
describe('流入と計測の帯は、選択中のフォルダだけを数えない', () => {
  it('流入元の数は、フォルダと検索で絞る前から数える', () => {
    const card = kpiCard('流入元')
    expect(card, '帯が見つからない').not.toBe('')
    expect(card, '絞り込んだ行数を出している').not.toContain('sortedRows.length')
    expect(card).toContain('routeCountAvailable ? accountRouteCount : null')
  })

  it('稼働中も同じ数え方にそろえる', () => {
    expect(PAGE).toContain('const accountRouteCount = accountFilteredRows.length')
    expect(PAGE).toContain(
      "const activeRouteCount = accountFilteredRows.filter((r) => r.source !== 'orphan').length",
    )
    expect(PAGE, '稼働中がまだ絞り込み後の行から数えている')
      .not.toContain("const activeRouteCount = sortedRows.filter((r) => r.source !== 'orphan').length")
  })

  it('フォルダ列の件数は元のままで、意味が重ならない', () => {
    expect(PAGE).toContain("accountFilteredRows.filter((row) => row.genre === genre.name).length")
  })
})
