import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ListToolbar from './list-toolbar'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')

/**
 * ★V7 `Xn1Mz`「一覧の上の道具の並び」。
 *
 * - 1行目：検索（幅320・虫眼鏡つき）→ 保存した検索 → この条件を保存。
 *   検索を横いっぱいに伸ばさない。検索を枠付きの箱で包まない。
 * - 2行目：左に絞り込み、右端に並び順と表示件数。表示件数だけの行を作らない。
 * - 狭い幅では2行目の右が下へ折り返す。検索は縮めても240まで。
 */
describe('ListToolbar 一覧の上の道具の並び（★V7 Xn1Mz）', () => {
  it('1行目に検索・保存した検索・この条件を保存を同じ行で出す', () => {
    const html = renderToStaticMarkup(
      <ListToolbar
        search={{ placeholder: 'タイトル・内容で検索', value: '', onChange: vi.fn() }}
        actions={
          <>
            <select aria-label="保存した検索" />
            <button type="button">この条件を保存する</button>
          </>
        }
      />,
    )
    const searchAt = html.indexOf('タイトル・内容で検索')
    const savedAt = html.indexOf('保存した検索')
    const saveAt = html.indexOf('この条件を保存する')
    expect(searchAt).toBeGreaterThan(-1)
    expect(savedAt).toBeGreaterThan(searchAt)
    expect(saveAt).toBeGreaterThan(savedAt)
  })

  it('2行目は左に絞り込み・右端に並び順と表示件数を出す', () => {
    const html = renderToStaticMarkup(
      <ListToolbar
        search={{ placeholder: '探す', value: '', onChange: vi.fn() }}
        filters={<button type="button">予約中のみ</button>}
        trailing={
          <>
            <select aria-label="並び順" />
            <select aria-label="表示件数" />
          </>
        }
      />,
    )
    const filterAt = html.indexOf('予約中のみ')
    const sortAt = html.indexOf('aria-label="並び順"')
    const perPageAt = html.indexOf('aria-label="表示件数"')
    expect(filterAt).toBeGreaterThan(-1)
    expect(sortAt).toBeGreaterThan(filterAt)
    expect(perPageAt).toBeGreaterThan(sortAt)
  })

  it('絞り込みも並び順も無いときは2行目を作らない（表示件数だけの行を作らない）', () => {
    const html = renderToStaticMarkup(
      <ListToolbar search={{ placeholder: '探す', value: '', onChange: vi.fn() }} />,
    )
    expect(html).not.toContain('row2')
  })

  it('検索の幅は320・下限240で部品が持つ（画面ごとに手で書かせない）', () => {
    const css = read('list-toolbar.module.css')
    const searchRule = css.match(/\.row1\s*>\s*\.search\s*{[^}]*}/s)
    expect(searchRule, '検索の幅指定がありません').toBeTruthy()
    expect(searchRule![0]).toContain('320px')
    expect(searchRule![0]).toContain('240px')
    // 横いっぱいに伸ばさない（flex-1 方式に戻さない）。
    expect(searchRule![0]).not.toMatch(/flex:\s*1(?![\d.])/)
  })

  it('検索を枠付きの箱（カード）で包まない', () => {
    const src = read('list-toolbar.tsx')
    expect(src).not.toMatch(/bg-canvas|border-hairline|rounded-card/)
  })

  it('狭い幅では折り返す（右の2つが下へ行ける）', () => {
    const css = read('list-toolbar.module.css')
    expect(css).toMatch(/\.row1\s*{[^}]*flex-wrap:\s*wrap/s)
    expect(css).toMatch(/\.row2\s*{[^}]*flex-wrap:\s*wrap/s)
    expect(css).toMatch(/\.trailing\s*{[^}]*margin-left:\s*auto/s)
  })

  it('検索欄は虫眼鏡つきの共通 SearchField を使う', () => {
    const src = read('list-toolbar.tsx')
    expect(src).toContain("from './search-field'")
    expect(src).toContain('<SearchField')
  })

  it('V8 道具の1段（c4n9Kr）：探す欄は幅280で縮まない（狭い板は帯ごと折り返す）', () => {
    /*
     * 正本 c4n9Kr の検索は width:280px・flex-shrink:0。
     * 中の文（flex:1）が伸び縮みし、外の箱は縮まない。
     * 白い板 1100〜1200 でも右端がはみ出さないよう、
     * 帯全体の flex-wrap で下へ折り返す（探す欄を潰さない）。
     * v7 の 320・下限240 は変えない。
     */
    const css = read('list-toolbar.module.css')
    const v8Rule = css.match(/\[data-theme='v8'\]\s*\.row1\s*>\s*\.search\s*{[^}]*}/s)
    expect(v8Rule, 'V8 の探す欄の幅指定がありません').toBeTruthy()
    expect(v8Rule![0]).toContain('280px')
    // 縮ませない（flex:none＝flex-shrink:0。min-width:0・flex:1 方式に戻さない）。
    expect(v8Rule![0]).toMatch(/flex:\s*none/)
    expect(v8Rule![0]).not.toContain('min-width: 0')
    expect(v8Rule![0]).not.toMatch(/flex:\s*1(?![\d.])/)
    // 狭い板では帯ごと折り返す。
    expect(css).toMatch(/\[data-theme='v8'\]\s*\.toolbar\s*{[^}]*flex-wrap:\s*wrap/s)
  })

  it('日付の範囲の入力はListToolbarの中で狭くそろえる（1440で2行目に収める）', () => {
    /*
     * 一斉配信の2行目で日付2つが各208px（w-52）あり、1440pxで
     * 並び順と表示件数が3行目へ落ちた。各132px（計264px・152px減）
     * なら同じ行に収まる。132pxは中の文字を「開始日」「終了日」
     * （3文字・14px＝約42px＋暦の絵16px＋余白＝約116px）に
     * 短くした最小。「日付を選ぶ」（約70px）のままでは欠ける。
     * 1152px以下での折り返しは .row2 の flex-wrap のまま許す。
     */
    const css = read('list-toolbar.module.css')
    const rule = css.match(/\.filters\s*>\s*\[data-date-input\]\s*{[^}]*}/s)
    expect(rule, '日付入力の幅指定がありません').toBeTruthy()
    expect(rule![0]).toContain('132px')
    expect(rule![0]).not.toContain('208px')
    expect(rule![0]).not.toContain('150px')
    // 縮めて潰さない（flex:none・入りきらない幅では行ごと折り返す）。
    expect(rule![0]).toMatch(/flex:\s*none/)
  })

  it('並び順・表示件数の選ぶ欄は2行目の中で狭くそろえる（1440で1行に収める）', () => {
    /*
     * 既定幅（176px・128px）のままでは一斉配信の2行目が1440px
     * （中身の幅 ≈835px）で3行目へ落ちた。並び順150px・表示件数96px
     * にそろえる。「配信日が新しい順」「20件表示」のままでは欠けるので、
     * 呼び出し側で「新しい順」「20件」へ短くする（2行目の見出し・
     * aria-labelで意味は分かる）。印（data-sort-select・
     * data-per-page-select）を付けた画面だけが対象で、他の一覧の
     * 既定幅は変えない。1152px以下での折り返しは許す。
     */
    const css = read('list-toolbar.module.css')
    const sortRule = css.match(/\.trailing\s*>\s*\[data-sort-select\]\s*{[^}]*}/s)
    expect(sortRule, '並び順の幅指定がありません').toBeTruthy()
    expect(sortRule![0]).toContain('150px')
    expect(sortRule![0]).toMatch(/flex:\s*none/)
    const perPageRule = css.match(/\.trailing\s*>\s*\[data-per-page-select\]\s*{[^}]*}/s)
    expect(perPageRule, '表示件数の幅指定がありません').toBeTruthy()
    expect(perPageRule![0]).toContain('96px')
    expect(perPageRule![0]).toMatch(/flex:\s*none/)
  })
})
