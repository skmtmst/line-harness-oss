import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ListFilterBar, { FilterControl } from './list-filter-bar'
import { formatPaginationSummary, ListPagination } from './pagination'

const HERE = dirname(fileURLToPath(import.meta.url))
const app = (...parts: string[]) => readFileSync(join(HERE, '..', '..', ...parts), 'utf8')

/**
 * #667 #668: 一覧の件数表記とフィルターバーを1形式へ寄せる。
 *
 * 棚卸しでは件数表記が7種以上（`前へ 1 次へ` のみ・`X件 / 全Y件`・
 * `X〜Y件 / 全Z件`・`全N件` のみ・`つのうち` …）に分散し、
 * フィルターバーもラベル有無・件数切替の形・検索の置き場所が
 * 画面ごとに違っていた。ここでは実Reactで描画し、表記と並びを
 * 文字で確かめる（モックだけの形骸にしない）。
 */
describe('#667 件数表記は「N件中 X〜Y件を表示」の1形式', () => {
  it('最多パターンに寄せ、単位だけ呼び出し側から渡す', () => {
    expect(formatPaginationSummary(13, 2, 10)).toBe('13件中 11〜13件を表示')
    expect(formatPaginationSummary(6, 1, 6, 'つ')).toBe('6つ中 1〜6つを表示')
    expect(formatPaginationSummary(2, 1, 20, '個')).toBe('2個中 1〜2個を表示')
  })

  it('0件と範囲外ページで「最初 > 最後」にならない', () => {
    expect(formatPaginationSummary(0, 1, 20)).toBe('0件中 0〜0件を表示')
    // 3頁しか無いのに5頁を求められたら最終頁へ丸める。
    expect(formatPaginationSummary(25, 5, 10)).toBe('25件中 21〜25件を表示')
    // 数えられない入力は0件扱い（NaN を並べない）。
    expect(formatPaginationSummary(Number.NaN, 1, 20)).toBe('0件中 0〜0件を表示')
  })

  it('ListPagination は件数と共通ページ送りを組にして出す', () => {
    const html = renderToStaticMarkup(
      <ListPagination total={13} page={2} pageSize={10} pageCount={2} onPageChange={vi.fn()} />,
    )
    expect(html).toContain('13件中 11〜13件を表示')
    expect(html).toContain('前へ')
    expect(html).toContain('次へ')
  })

  it('1ページしか無いとき送りは出さず、件数だけ出す', () => {
    const html = renderToStaticMarkup(
      <ListPagination total={5} page={1} pageSize={20} pageCount={1} onPageChange={vi.fn()} />,
    )
    expect(html).toContain('5件中 1〜5件を表示')
    expect(html).not.toContain('前へ')
    expect(html).not.toContain('次へ')
  })
})

describe('#668 フィルターバーは 検索→絞り込み→並び替え→表示件数', () => {
  it('検索は独立した全幅の行、操作は 絞り込み→並び替え→表示件数 の順', () => {
    const html = renderToStaticMarkup(
      <ListFilterBar
        search={<input aria-label="検索" />}
        filters={<button type="button">絞り込み</button>}
        sort={<button type="button">並び替え</button>}
        pageSize={<button type="button">表示件数</button>}
      />,
    )
    expect(html).toContain('data-search-row')
    const order = ['絞り込み', '並び替え', '表示件数'].map((text) => html.indexOf(text))
    expect(order.every((index) => index > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('FilterControl は見えるラベルを付け、並び替えは選択値を省略しない', () => {
    const html = renderToStaticMarkup(
      <FilterControl label="並び順" wide>
        <select aria-label="並び順">
          <option value="usage">使われている数が多い順</option>
        </select>
      </FilterControl>,
    )
    expect(html).toContain('並び順')
    expect(html).toContain('使われている数が多い順')
    // 幅保証の印（CSS側の `.wide`）。省略表示のままにしない。
    expect(html).toMatch(/wide/)
  })

  it('何も渡さなければ描かない（押せない飾りを置かない）', () => {
    expect(renderToStaticMarkup(<ListFilterBar />)).toBe('')
  })
})

describe('#667 #668 適用済み画面の表記統一（正本の抜き取り）', () => {
  it('一覧フッターは ListPagination に寄せる', () => {
    const screens = [
      app('app', 'form-submissions', 'page.tsx'),
      app('app', 'webinars', 'page.tsx'),
      app('app', 'rich-menus', 'page.tsx'),
      app('app', 'ops', 'audit', 'page.tsx'),
      app('app', 'booking', 'menus', 'page.tsx'),
      app('app', 'line-notifications', 'page.tsx'),
      app('app', 'affiliates', 'tabs.tsx'),
    ]
    for (const source of screens) {
      expect(source).toContain('ListPagination')
    }
    // 独自の前後ボタン・`件 / 全`・`つのうち`・`全N件中` の旧表記は残さない。
    const formSubmissions = screens[0]
    expect(formSubmissions).not.toContain('aria-label="前のページ"')
    expect(formSubmissions).not.toContain('aria-label="次のページ"')
    for (const source of screens) {
      expect(source).not.toContain('件 / 全')
      expect(source).not.toContain('つのうち')
    }
    const contents = app('app', 'contents', 'page.tsx')
    expect(contents).toContain('formatPaginationSummary(total, page, pageSize)')
    const vars = app('app', 'contents', 'vars', 'page.tsx')
    expect(vars).toContain('formatPaginationSummary(filtered.length, page, pageSize)')
  })

  it('変数管理のフィルターバーは共通部品＋見えるラベル＋幅保証', () => {
    const vars = app('app', 'contents', 'vars', 'page.tsx')
    expect(vars).toContain('<ListFilterBar')
    expect(vars).toContain('FilterControl label="並び順" wide')
    expect(vars).toContain('FilterControl label="表示件数"')
    // 絞り込み → 並び替え → 表示件数の順に渡す。
    const filtersAt = vars.indexOf('filters={')
    const sortAt = vars.indexOf('sort={')
    const pageSizeAt = vars.indexOf('pageSize={')
    expect(filtersAt).toBeGreaterThan(-1)
    expect(sortAt).toBeGreaterThan(filtersAt)
    expect(pageSizeAt).toBeGreaterThan(sortAt)
  })
})
