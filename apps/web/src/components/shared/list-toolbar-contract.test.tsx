// @vitest-environment happy-dom
import React from 'react'
import { readFileSync } from 'node:fs'
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ListToolbar, { ListToolbarFrame, ListToolbarRow, ListToolbarSearchSlot, ListToolbarEnd } from './list-toolbar'

afterEach(cleanup)

describe('B-178 共通の道具の段の操作', () => {
  it('検索の変更と消す操作を元の受け口へ返す', async () => {
    const onChange = vi.fn()
    render(<ListToolbar search={{ placeholder: '名前を探す', label: '一覧を検索', value: '来店', onChange }} />)
    fireEvent.change(screen.getByRole('searchbox', { name: '一覧を検索' }), { target: { value: '予約' } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('予約'))
    fireEvent.click(screen.getByRole('button', { name: /消/ }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('読み上げ名が省略されたときは探す欄の説明を使う', () => {
    render(<ListToolbar search={{ placeholder: '名前・本文を探す', value: '', onChange: vi.fn() }} />)
    expect(screen.getByRole('searchbox', { name: '名前・本文を探す' })).toBeTruthy()
  })

  it('検索がない一覧でも絞り込みと件数を操作できる', () => {
    const filter = vi.fn(), size = vi.fn()
    render(<ListToolbar filters={<button onClick={filter}>予約のみ</button>} trailing={<select aria-label="表示件数" onChange={size}><option>20件</option><option>50件</option></select>} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '予約のみ' }))
    fireEvent.change(screen.getByRole('combobox', { name: '表示件数' }), { target: { value: '50件' } })
    expect(filter).toHaveBeenCalledOnce()
    expect(size).toHaveBeenCalledOnce()
  })

  it('フォームを共通の段へ移しても検索の送信と条件操作を保つ', () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault()), filter = vi.fn()
    render(<ListToolbarFrame><ListToolbarRow as="form" onSubmit={submit}>
      <ListToolbarSearchSlot><input aria-label="検索" defaultValue="来店" /></ListToolbarSearchSlot>
      <button type="submit">検索する</button>
      <ListToolbarEnd><button type="button" onClick={filter}>詳細条件</button></ListToolbarEnd>
    </ListToolbarRow></ListToolbarFrame>)
    fireEvent.submit(screen.getByRole('textbox', { name: '検索' }).closest('form')!)
    fireEvent.click(screen.getByRole('button', { name: '詳細条件' }))
    expect(submit).toHaveBeenCalledOnce()
    expect(filter).toHaveBeenCalledOnce()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '検索' }).value).toBe('来店')
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

  it('V8 道具の1段（c4n9Kr）：幅280を基準にし、段を折り返さない', () => {
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
    expect(css).toMatch(/\[data-theme='v8'\]\s*\.toolbar\s*{[^}]*flex-wrap:\s*nowrap/s)
  })

  it('畳む道具がないV8一覧では実際の空き幅に合わせて折り返す', () => {
    const css = read('list-toolbar.module.css')
    expect(css).toMatch(/\[data-theme='v8'\]\s*\.toolbar:not\(:has\(\.optional\)\)\s*{[^}]*flex-wrap:\s*wrap/s)
    // 「…」へ畳む一覧と、段を明示する一覧の指定は残す。
    expect(css).toContain('.optional[data-collapsed] > summary')
    expect(css).toContain(".toolbar[data-toolbar-layout='stacked']")
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

  it('2段目の状態切り替えも操作を保つ', () => {
    const onClick = vi.fn()
    render(<ListToolbar secondary={<button onClick={onClick}>注目のみ</button>} />)
    fireEvent.click(screen.getByRole('button', { name: '注目のみ' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

it('並びは道具の段の共通欄だけで選ぶ', () => {
  const html = renderToStaticMarkup(<ListToolbar search={{ placeholder: '探す', value: '', onChange: vi.fn() }} sort={{ value: 'recent', onChange: vi.fn(), options: [{ value: 'recent', label: '新しい順' }] }} />)
  expect(html).toContain('data-list-sort')
  expect(html).toContain('aria-label="並び"')
})
