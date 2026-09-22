import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * U014: 一斉配信の検索欄の潰れ（外部UI監査 ab9d80b07）。
 *
 * 390pxで保存検索・条件保存・表示件数と同じ行に押し込まれ、
 * 検索欄がほぼ四角形まで潰れていた。検索は独立した全幅の行にし、
 * 表示件数は結果の側へ移す。
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

describe('一斉配信の検索行（U014）', () => {
  it('検索欄は独立した全幅の行に1つだけ置く', () => {
    const row = searchRowBlock()
    expect(row).toContain('タイトル・内容で検索')
    expect(row).toContain('type="search"')
    expect(row, '検索欄が全幅でない').toContain('w-full')
    // 同じ行に他の操作を押し込まない（潰れの再発防止）。
    expect(row).not.toContain('SelectField')
    expect(row).not.toContain('Button')
    expect(row).not.toContain('type="date"')
  })

  it('保存検索と条件保存は検索とは別の行に置く', () => {
    const rowEnd = PAGE.indexOf('</div>', PAGE.indexOf('data-search-row'))
    expect(PAGE.indexOf('aria-label="保存した検索"')).toBeGreaterThan(rowEnd)
    expect(PAGE.indexOf('この条件を保存')).toBeGreaterThan(rowEnd)
  })

  it('表示件数は検索行から外し、一覧の直前（結果側）へ置く', () => {
    const rowEnd = PAGE.indexOf('</div>', PAGE.indexOf('data-search-row'))
    const pageSizeAt = PAGE.indexOf('aria-label="表示件数"')
    expect(pageSizeAt).toBeGreaterThan(rowEnd)
    // 条件の帯（チップ行）より後ろ＝結果の側にある。
    expect(pageSizeAt).toBeGreaterThan(PAGE.indexOf('broadcast-filter-chip'))
    // 一覧（表）より前にある。
    expect(pageSizeAt).toBeLessThan(PAGE.indexOf('min-w-[640px]'))
  })

  it('狭い幅の1列グリッドは minmax(0,1fr) で画面内に収める', () => {
    /*
     * 暗黙の auto 列は中身の最大幅（表の min-w-[640px]）まで広がるため、
     * 390px で検索行ごと右にはみ出し、横スクロールしないと入力の右端へ
     * 届かなかった（実ブラウザ実測: 検索欄642px / 本文658px）。
     * `grid-cols-1`（= minmax(0,1fr)）で列を容器の幅に止め、
     * 表はカード内の横スクロールに閉じ込める。
     */
    expect(PAGE).toContain('grid grid-cols-1 gap-4 lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]')
  })
})
