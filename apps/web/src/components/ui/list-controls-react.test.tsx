// @vitest-environment happy-dom
/*
 * SortSelect / PageSizeSelect（監査6 #668）を本物のReactで動かす試験。
 *
 * 一覧のツールバーで「並び順」「表示件数」を選ぶ口は、字ラベルつき・
 * 選択中の語が切れない幅の1形にそろえる。見るのはラベル、選択肢の
 * 書き方、幅の下限、操作できることの4点。
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import SortSelect from './sort-select'
import PageSizeSelect from './page-size-select'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(cleanup)

describe('SortSelect（監査6 #668: 並び順の統一）', () => {
  const options = [
    { value: 'usage_desc', label: '使われている数が多い順' },
    { value: 'updated_desc', label: '更新が新しい順' },
  ]

  it('「並び順」の字ラベルつきの選び口を出す', () => {
    render(<SortSelect value="usage_desc" onChange={() => {}} options={options} />)
    expect(screen.getByText('並び順')).toBeTruthy()
    // 選び口は共通 Select（開くボタン）。読み上げ名で結び付く。
    const select = screen.getByLabelText('並び順')
    expect(select.tagName).toBe('BUTTON')
    // 字ラベルはラッパの label 要素で選び口と結び付く
    expect(select.closest('label')?.textContent).toContain('並び順')
  })

  it('選択中の語が切れないよう幅は内容・下限あり（w-auto min-w-40）', () => {
    render(<SortSelect value="usage_desc" onChange={() => {}} options={options} />)
    const select = screen.getByLabelText('並び順')
    // 幅は選び欄の器（ボタンの親）が持つ
    expect(select.parentElement?.className).toContain('w-auto')
    expect(select.parentElement?.className).toContain('min-w-40')
    // 選んでいる語がボタンに出ている
    expect(select.textContent).toContain('使われている数が多い順')
  })

  it('選ぶと onChange へ新しい値を渡す', () => {
    const onChange = vi.fn()
    render(<SortSelect value="usage_desc" onChange={onChange} options={options} />)
    fireEvent.click(screen.getByLabelText('並び順'))
    fireEvent.click(screen.getByRole('listbox').querySelectorAll('button')[1])
    expect(onChange).toHaveBeenCalledWith('updated_desc')
  })
})

describe('PageSizeSelect（監査6 #668: 表示件数の統一）', () => {
  it('「表示件数」の字ラベルつきで、選択肢は「N件表示」の1形', () => {
    render(<PageSizeSelect value={20} onChange={() => {}} />)
    expect(screen.getByText('表示件数')).toBeTruthy()
    // 選び口は共通 Select（開くボタン）。
    // 「20件」でも「20件を表示」でもなく設計の語「20件表示」
    fireEvent.click(screen.getByLabelText('表示件数'))
    const listbox = screen.getByRole('listbox')
    expect(listbox.textContent).toContain('20件表示')
    expect(listbox.textContent).toContain('50件表示')
    expect(listbox.textContent).toContain('100件表示')
  })

  it('件数の選択肢は画面が渡すものを使う（既定は 20・50・100）', () => {
    render(<PageSizeSelect value={30} onChange={() => {}} options={[10, 30, 50]} />)
    // 開く前に掴む（開いた後は字ラベルとボタンの両方に当たることがある）。
    const select = screen.getByLabelText('表示件数')
    fireEvent.click(select)
    const listbox = screen.getByRole('listbox')
    expect(listbox.textContent).toContain('10件表示')
    expect(listbox.textContent).toContain('30件表示')
    expect(listbox.textContent).toContain('50件表示')
    // 選んでいる値がボタンに出ている
    expect(select.textContent).toContain('30件表示')
  })

  it('選ぶと onChange へ数値で渡す', () => {
    const onChange = vi.fn()
    render(<PageSizeSelect value={20} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('表示件数'))
    // 既定の選択肢は 20・50・100（[1] が 50）。
    fireEvent.click(screen.getByRole('listbox').querySelectorAll('button')[1])
    expect(onChange).toHaveBeenCalledWith(50)
  })
})
