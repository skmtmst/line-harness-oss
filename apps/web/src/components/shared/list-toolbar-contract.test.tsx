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
            <button type="button">この条件を保存</button>
          </>
        }
      />,
    )
    const searchAt = html.indexOf('タイトル・内容で検索')
    const savedAt = html.indexOf('保存した検索')
    const saveAt = html.indexOf('この条件を保存')
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

  it('日付の範囲の入力はListToolbarの中で狭くそろえる（1440で2行目に収める）', () => {
    /*
     * 一斉配信の2行目で日付2つが各208px（w-52）あり、1440pxで
     * 並び順と表示件数が3行目へ落ちた。各150px（計300px・116px減）
     * なら同じ行に収まる。「日付を選ぶ」（5文字・14px＝約70px＋
     * 暦の絵16px＋余白）は150pxで欠けずに入る。
     * 1152px以下での折り返しは .row2 の flex-wrap のまま許す。
     */
    const css = read('list-toolbar.module.css')
    const rule = css.match(/\.filters\s*>\s*\[data-date-input\]\s*{[^}]*}/s)
    expect(rule, '日付入力の幅指定がありません').toBeTruthy()
    expect(rule![0]).toContain('150px')
    expect(rule![0]).not.toContain('208px')
    // 縮めて潰さない（flex:none・入りきらない幅では行ごと折り返す）。
    expect(rule![0]).toMatch(/flex:\s*none/)
  })
})
