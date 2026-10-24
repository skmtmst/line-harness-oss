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

})
