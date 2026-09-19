import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * U019: アカウント検索と表示件数を分ける（外部UI監査 ab9d80b07）。
 *
 * 390pxで件数の札の横に検索欄が押し込まれ、プレースホルダーが
 * 途中までしか見えなかった。検索は独立した全幅の行にし、
 * 件数は結果の件数とまとめて置く。
 *
 * ブラウザの実測幅は vitest では取れないので、**潰れない構造**を
 * 契約として見る: 検索欄が `data-search-row` の専用行に1つだけあり、
 * 全幅（`w-full`）で、同じ行に他の操作を置かないこと。
 */
const searchRowBlock = (): string => {
  const start = PAGE.indexOf('data-search-row')
  const end = PAGE.indexOf('</div>', start)
  return PAGE.slice(start, end)
}

describe('アカウント一覧の検索行（U019）', () => {
  it('検索欄は独立した全幅の行に1つだけ置く', () => {
    const row = searchRowBlock()
    expect(row).toContain('アカウント名・チャネルIDで検索')
    expect(row, '検索欄が全幅でない').toContain('className="w-full"')
    // 同じ行に件数の札や絞り込みを置かない（潰れの再発防止）。
    expect(row).not.toContain('20件表示')
    expect(row).not.toContain('ACCOUNT_FILTERS')
    expect(row).not.toContain('Button')
  })

  it('「20件表示」は検索の横ではなく、結果の件数とまとめて置く', () => {
    const rowEnd = PAGE.indexOf('</div>', PAGE.indexOf('data-search-row'))
    const pageSizeAt = PAGE.indexOf('20件表示')
    const shownAt = PAGE.indexOf('件を表示</span>')
    expect(pageSizeAt).toBeGreaterThan(rowEnd)
    // 結果の件数のすぐ隣（状態の絞り込みと同じ行の中）にある。
    expect(pageSizeAt).toBeGreaterThan(PAGE.indexOf('ACCOUNT_FILTERS.map'))
    expect(shownAt).toBeGreaterThan(pageSizeAt)
  })
})
