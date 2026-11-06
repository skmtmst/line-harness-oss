// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SegmentedControl from './segmented'

afterEach(cleanup)

/*
 * 一覧の「1つだけ選ぶ・2〜5個」の絞り込みに使う切り替え。
 * 件数は文字の後ろに小さく出し、キーボードの ← → で選び直せる。
 */
describe('絞り込みの切り替え', () => {
  const OPTIONS = [
    { value: 'all', label: 'すべて', count: 5 },
    { value: 'ok', label: '正常', count: 1 },
    { value: 'warn', label: '要確認', count: 3 },
    { value: 'archived', label: 'アーカイブ', count: 1 },
  ] as const

  it('件数を各項目の文字の後ろに小さく添える', () => {
    const { container } = render(<SegmentedControl aria-label="状態" options={[...OPTIONS]} value="all" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'すべて 5' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '要確認 3' }).getAttribute('aria-pressed')).toBe('false')
    const counts = [...container.querySelectorAll('[data-segment-count]')].map((node) => node.textContent)
    expect([counts, screen.getByRole('button', { name: '要確認 3' }).textContent]).toEqual([['5', '1', '3', '1'], '要確認 3'])
  })

  it('← → で隣の項目へ移り、選んだ項目へ焦点も移る', () => {
    const onChange = vi.fn()
    const { container } = render(<SegmentedControl aria-label="状態" options={[...OPTIONS]} value="ok" onChange={onChange} />)
    const buttons = [...container.querySelectorAll('button')]
    fireEvent.keyDown(buttons[1], { key: 'ArrowRight' })
    fireEvent.keyDown(buttons[1], { key: 'ArrowLeft' })
    expect(onChange.mock.calls).toEqual([['warn'], ['all']])
  })

  it('0件だけを区別し、0件の項目も選べて未取得を0件にしない', () => {
    const onChange = vi.fn()
    render(<SegmentedControl aria-label="件数" value="all" onChange={onChange} options={[
      { value: 'all', label: 'すべて', count: 2 },
      { value: 'empty', label: '保留', count: 0 },
      { value: 'text-zero', label: '停止', count: '0' },
      { value: 'unknown', label: '未取得', count: '—' },
    ]} />)
    expect(screen.getByRole('button', { name: 'すべて 2' }).hasAttribute('data-empty')).toBe(false)
    expect(screen.getByRole('button', { name: '未取得 —' }).hasAttribute('data-empty')).toBe(false)
    expect(screen.getByRole('button', { name: '停止 0' }).hasAttribute('data-empty')).toBe(true)
    const empty = screen.getByRole('button', { name: '保留 0' })
    expect(empty.hasAttribute('data-empty')).toBe(true)
    expect(empty.hasAttribute('disabled')).toBe(false)
    fireEvent.click(empty)
    expect(onChange).toHaveBeenCalledWith('empty')
  })

})

it('ラジオとして使う時は1つのTab入口を保ち、Home・Endで移動し、未選択へ戻せる', () => {
  const onChange = vi.fn()
  const { rerender } = render(<SegmentedControl selectionMode="radio" aria-label="対応状況" options={[{ value: 'open', label: '未対応' }, { value: 'done', label: '対応済み' }]} value="open" onChange={onChange} />)
  const radios = screen.getAllByRole('radio')
  expect(radios.map(node => [node.getAttribute('aria-checked'), node.tabIndex])).toEqual([['true', 0], ['false', -1]])
  fireEvent.keyDown(radios[0], { key: 'End' })
  expect(document.activeElement).toBe(radios[1])
  fireEvent.keyDown(radios[1], { key: 'Home' })
  expect(onChange.mock.calls).toEqual([['done'], ['open']])
  rerender(<SegmentedControl<string> selectionMode="radio" aria-label="対応状況" options={[{ value: 'open', label: '未対応' }, { value: 'done', label: '対応済み' }]} value="all" onChange={onChange} />)
  expect(screen.getAllByRole('radio').map(node => node.getAttribute('aria-checked'))).toEqual(['false', 'false'])
})

it('選択中の押し直しだけ解除し、キー移動と無効時は解除しない', () => {
  const onChange=vi.fn(),onClear=vi.fn()
  const props={selectionMode:'radio' as const,'aria-label':'状態',options:[{value:'open',label:'未対応'},{value:'done',label:'対応済み'}],value:'open',onChange,onClear}
  const view=render(<SegmentedControl {...props}/>)
  fireEvent.click(screen.getByRole('radio',{name:'未対応'}))
  expect(onClear).toHaveBeenCalledOnce()
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('radio',{name:'未対応'}),{key:'End'})
  expect(onChange).toHaveBeenCalledWith('done')
  expect(onClear).toHaveBeenCalledOnce()
  view.rerender(<SegmentedControl {...props} disabled/>)
  fireEvent.click(screen.getByRole('radio',{name:'未対応'}))
  fireEvent.keyDown(screen.getByRole('radio',{name:'未対応'}),{key:'End'})
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onClear).toHaveBeenCalledOnce()
})
