import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const FILTER_BAR = readFileSync(
  join(HERE, '../../../components/shared/list-filter-bar.tsx'),
  'utf8',
)

/*
 * #973 U026: 共通情報の一覧（/contents/vars）で、フォルダ・検索・表を
 * 包む親グリッドが右へ広がり、ページ全体が横にはみ出していた。
 */
describe('共通情報一覧のはみ出し（#973 U026）', () => {
  it('一覧側のグリッド子は min-w-0 で縮める', () => {
    expect(PAGE).toContain('lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]')
    const contentColumn = PAGE.match(/lg:grid-cols-\[var\(--folder-rail-width\)_minmax\(0,1fr\)\][\s\S]*?<div className="min-w-0">/)
    expect(contentColumn, '表を抱える一覧側が min-w-0 を持たない').not.toBeNull()
  })

  it('狭い幅ではフォルダを縦パネルではなく1行の選択欄にする', () => {
    expect(PAGE).toContain('id="vars-folder-filter"')
    expect(PAGE).toMatch(/className="space-y-2 lg:hidden"[\s\S]{0,200}?vars-folder-filter/)
    // 縦パネルは広い幅だけに出す。
    expect(PAGE).toMatch(/className="hidden space-y-3 lg:block"[\s\S]{0,100}?<FolderPanel/)
  })

  it('検索は独立した全幅の行にし、入力に最小幅を課さない', () => {
    // #668: 検索行は共通 `ListFilterBar` の `search` 枠が持つ。
    // `data-search-row` の実体は部品側にある。
    expect(PAGE).toContain('<ListFilterBar')
    expect(PAGE).toContain("import SearchField from '@/components/shared/search-field'")
    expect(FILTER_BAR).toContain('data-search-row')
    // かつての `min-w-64 flex-1` のインライン検索欄は狭い幅ではみ出す元。
    expect(PAGE).not.toContain('min-w-64')
  })

  it('読み込み・空の状態は820pxの表の外へ出す', () => {
    // 空状態の主操作が横スクロールの奥へ切れないよう、表のセルに入れない。
    expect(PAGE).not.toContain('colSpan={7}')
    const listState = PAGE.indexOf('ListState kind="loading"')
    const scrollable = PAGE.indexOf('overflow-x-auto')
    expect(listState).toBeGreaterThan(-1)
    expect(scrollable).toBeGreaterThan(-1)
    expect(listState).toBeLessThan(scrollable)
  })
})
