// @vitest-environment happy-dom
/* 一覧の絞り込み札（★管理画面・m13i）。全画面で1つの形にそろえるための契約。 */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FilterChip from './filter-chip'

afterEach(() => cleanup())

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'filter-chip.css'), 'utf8')
/** 注釈を落とした宣言だけを見る（#639・#669 と同じやり方）。 */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

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

  it('v8 の札は固定絵の共通寸法を使う（高36・内側0/12・間4・角丸999・枠control-border＋薄い影）', () => {
    expect(CODE).toMatch(/:root\s*\.v6-filter-chip\s*\{[^}]*height:\s*36px/s)
    expect(CODE).toMatch(/:root\s*\.v6-filter-chip\s*\{[^}]*padding:\s*0 var\(--polish-space-field\)/s)
    expect(CODE).toMatch(/:root\s*\.v6-filter-chip\s*\{[^}]*gap:\s*calc\(var\(--tpl-toolbar-gap\) \/ 2\)/s)
    expect(CODE).toMatch(/:root\s*\.v6-filter-chip\s*\{\s*[^}]*border-radius:\s*999px/s)
    expect(CODE).toMatch(/:root\s*\.v6-filter-chip\s*\{[^}]*outline:\s*1px solid var\(--color-control-border\)/s)
  })

  it('現在のV8の高さ36・緑の選択を使い、タッチ44pxを保つ', () => {
    expect(CODE).toMatch(/:root \.v6-filter-chip\s*\{[^}]*height:\s*36px/s)
    // 現役の選択はの薄い緑の地と濃い緑の文字。aria-pressed の動きも別の試験で守る。
    expect(CODE).toMatch(
      /:root \.v6-filter-chip\[aria-pressed='true'\]\s*\{[^}]*background:\s*var\(--color-selection-bg\)/s,
    )
    expect(CODE).toMatch(/\.v6-filter-chip\[aria-pressed='true'\]\s*\{[^}]*color:\s*var\(--color-selection-border\)/s)
    // タッチ端末は44px（#639 の契約と同じ錨）。
    expect(CODE).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.v6-filter-chip\s*\{\s*min-height:\s*44px;/,
    )
  })
})
