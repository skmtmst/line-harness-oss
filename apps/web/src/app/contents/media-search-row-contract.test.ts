import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * U016: 登録メディアの検索欄の潰れ（外部UI監査 ab9d80b07）。
 *
 * 390pxで検索・種別の絞り込み・表示切替が横並びになり、入力幅が
 * 無くなっていた。検索1行・フィルタ1行に分け、表示切替・並び順・
 * 表示件数は結果の見出し側へまとめる。
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

describe('登録メディアの検索行（U016）', () => {
  it('検索欄は独立した全幅の行に1つだけ置く', () => {
    const row = searchRowBlock()
    expect(row).toContain('ファイル名で検索')
    expect(row, '検索欄が全幅でない').toContain('className="w-full"')
    // 同じ行に他の操作を押し込まない（潰れの再発防止）。
    expect(row).not.toContain('Select')
    expect(row).not.toContain('FilterChip')
    expect(row).not.toContain('並べ方')
    expect(row).not.toContain('Button')
  })

  it('種別フィルタは検索とは別の行に置く', () => {
    const rowEnd = PAGE.indexOf('</div>', PAGE.indexOf('data-search-row'))
    expect(PAGE.indexOf('使っていない')).toBeGreaterThan(rowEnd)
  })

  it('表示切替・並び順・表示件数は結果の見出し側（一覧の直前）へまとめる', () => {
    const rowEnd = PAGE.indexOf('</div>', PAGE.indexOf('data-search-row'))
    const viewToggleAt = PAGE.indexOf('aria-label="並べ方"')
    const sortAt = PAGE.indexOf('aria-label="並び順"')
    const pageSizeAt = PAGE.indexOf('aria-label="表示件数"')
    for (const [name, at] of [['並べ方', viewToggleAt], ['並び順', sortAt], ['表示件数', pageSizeAt]] as const) {
      expect(at, `${name} が検索行に残っている`).toBeGreaterThan(rowEnd)
      // 結果の一覧（`h8pBZr`）の直前にある。
      expect(at, `${name} が結果の側に無い`).toBeLessThan(PAGE.indexOf('data-design-node="h8pBZr"'))
    }
  })
})
