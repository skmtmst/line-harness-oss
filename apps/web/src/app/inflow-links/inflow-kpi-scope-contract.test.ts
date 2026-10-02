import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const NEW = fs.readFileSync(path.join(__dirname, 'new', 'page.tsx'), 'utf8')

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

  it('受付中・停止中も同じ数え方にそろえる（R273）', () => {
    expect(PAGE).toContain('const accountRouteCount = summary?.routeTotal ?? accountFilteredRows.length')
    // 受付中は isActive が真の登録済み行だけ。停止中リンクを稼働中には数えない。
    expect(PAGE).toContain(
      "const activeRouteCount = accountFilteredRows.filter((r) => r.source !== 'orphan' && r.isActive === true).length",
    )
    expect(PAGE).toContain(
      "const stoppedRouteCount = accountFilteredRows.filter((r) => r.source !== 'orphan' && r.isActive === false).length",
    )
    expect(PAGE, '受付中がまだ絞り込み後の行から数えている')
      .not.toContain("const activeRouteCount = sortedRows.filter((r) => r.source !== 'orphan').length")
  })

  it('帯に受付中と停止中の両方を出す（R273）', () => {
    const card = kpiCard('流入元')
    expect(card, '帯が見つからない').not.toBe('')
    expect(card).toContain('受付中 ${activeRouteCount}・停止中 ${stoppedRouteCount}')
  })

  it('作成確認も公開オフなら停止中だと分かる（R273）', () => {
    // 公開オフで作った直後に「すぐに使えます」と出すと停止中と矛盾する。
    expect(NEW).toContain('公開オフのまま発行すると、URLを開いても友だち追加できません')
  })

  it('フォルダ列の件数は元のままで、意味が重ならない', () => {
    expect(PAGE).toContain("accountFilteredRows.filter((row) => row.genre === genre.name).length")
  })

  it('クリックと平均の追加率もフォルダと検索の前から数える', () => {
    expect(PAGE).toContain('summary?.totalClicks ?? accountClicks')
    expect(PAGE).toContain('accountFilteredRows.reduce((sum, r) => sum + (r.stats?.clickCount ?? 0), 0)')
    expect(PAGE).toContain('accountFilteredRows.reduce((sum, r) => sum + (r.stats?.friendCount ?? 0), 0)')
    expect(PAGE, 'クリック・平均の分子分母がまだ絞り込み後の行から数えている')
      .not.toContain('sortedRows.reduce')
  })
})
