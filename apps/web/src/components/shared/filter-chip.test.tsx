// @vitest-environment happy-dom
/* 一覧の絞り込み札（★管理画面・m13i）。全画面で1つの形にそろえるための契約。 */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FilterChip from './filter-chip'

afterEach(() => cleanup())

describe('絞り込み札 FilterChip（m13i）', () => {
  it('条件の選択と窓の開閉を別の属性で伝える', () => {
    const onChange = vi.fn()
    const {container, rerender} = render(<FilterChip selected={false} onChange={onChange} aria-haspopup="dialog" aria-expanded={false}>配信日</FilterChip>)
    const button = container.querySelector('button')!
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(button)
    expect(onChange).toHaveBeenCalledWith(true)
    rerender(<FilterChip selected={false} onChange={onChange} aria-haspopup="dialog" aria-expanded>配信日</FilterChip>)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })
  it('押せるボタンとして描き、選んでいない時は印を出さない', () => {
    const onChange = vi.fn()
    const { container } = render(
      <FilterChip selected={false} onChange={onChange}>
        未対応
      </FilterChip>,
    )
    const button = container.querySelector('button')!
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.textContent).toContain('未対応')
    // 未選択は○や星などの飾りを付けない（m13i でそろえる3通りの1つを消す）。
    expect(button.querySelector('svg')).toBeNull()
  })

  it('選んだら✓だけを出し、押すと外す値を返す', () => {
    const onChange = vi.fn()
    const { container } = render(
      <FilterChip selected onChange={onChange}>
        未対応
      </FilterChip>,
    )
    const button = container.querySelector('button')!
    expect(button.getAttribute('aria-pressed')).toBe('true')
    // ✓（lucide の Check）の1つだけ。○（Circle）は出さない。
    expect(button.querySelectorAll('svg')).toHaveLength(1)
    fireEvent.click(button)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('押すと選ぶ値を返す', () => {
    const onChange = vi.fn()
    const { container } = render(
      <FilterChip selected={false} onChange={onChange}>
        すべて
      </FilterChip>,
    )
    fireEvent.click(container.querySelector('button')!)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('件数は文字の後ろに小さく出す', () => {
    const { container } = render(
      <FilterChip selected={false} onChange={vi.fn()} count={201}>
        認めるのを待っている
      </FilterChip>,
    )
    const count = container.querySelector('.v6-filter-chip__count')!
    expect(count.textContent).toBe('201')
    // 読み上げ名は「ラベル 件」のまま（既存試験の /認めるのを待っている 201/ を保つ）。
    expect(container.querySelector('button')!.textContent).toContain('認めるのを待っている 201')
  })

  it('押せない札は disabled にする', () => {
    const onChange = vi.fn()
    const { container } = render(
      <FilterChip selected={false} onChange={onChange} disabled>
        過去の支払い
      </FilterChip>,
    )
    expect((container.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('状態の札は印を省いても件数と選択状態を伝える', () => {
    const { container } = render(<FilterChip selected showCheck={false} count={0} onChange={() => {}}>送信済み</FilterChip>)
    const button = container.querySelector('button')!
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.textContent).toBe('送信済み 0')
    expect(button.querySelector('svg')).toBeNull()
  })

  it('現在のV8の高さ36・タッチ44pxを保つ', () => {
    expect(CODE).toMatch(/:root \.v6-filter-chip\s*\{[^}]*height:\s*36px/s)
    // 選択色の後勝ちと故障復元は実ブラウザのcomputed対照で守る。
    // タッチ端末は44px（#639 の契約と同じ錨）。
    expect(CODE).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.v6-filter-chip\s*\{\s*min-height:\s*44px;/,
    )
  })

  it('押せない札から状態の変更を送らない', () => {
    const change = vi.fn()
    const { container } = render(<FilterChip selected={false} disabled onChange={change}>未対応</FilterChip>)
    fireEvent.click(container.querySelector('button')!)
    expect(change).not.toHaveBeenCalled()
  })
})
