// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SegmentedControl from './segmented'

afterEach(() => cleanup())

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'segmented.module.css'), 'utf8')

const OPTIONS = [
  { value: 'graph', label: 'グラフ' },
  { value: 'table', label: '表' },
] as const

/*
 * 切替器の小型（d8X09 グラフ／表）。
 * 器 r8・項目 3/10・文 12/18・つまみ r6・全体の高さ 28。
 * 箱型（dtJVi：項目 6/12・文 13・つまみ r8）の合格は変えない。
 */
describe('切替器の小型（d8X09）', () => {
  it('size="small" で data-size が付く。既定は medium', () => {
    const small = render(
      <SegmentedControl aria-label="表示" options={[...OPTIONS]} value="graph" onChange={() => {}} size="small" />,
    )
    expect(small.container.firstElementChild!.getAttribute('data-size')).toBe('small')
    small.unmount()
    const def = render(
      <SegmentedControl aria-label="表示" options={[...OPTIONS]} value="graph" onChange={() => {}} />,
    )
    expect(def.container.firstElementChild!.getAttribute('data-size')).toBe('medium')
    def.unmount()
  })

  it('小型も選べてキーボードで移れる（動きは箱型と同じ）', () => {
    const onChange = vi.fn()
    const { container } = render(
      <SegmentedControl aria-label="表示" options={[...OPTIONS]} value="graph" onChange={onChange} size="small" />,
    )
    const buttons = container.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1])
    expect(onChange).toHaveBeenCalledWith('table')
  })

  it('小型は v8 だけで器 r8・項目 3/10・文 12/18・つまみ r6', () => {
    expect(CSS).toMatch(/\[data-theme='v8'\]\s*\.root\[data-size='small'\]\s*\{[^}]*border-radius:\s*var\(--radius-segment\)/s)
    expect(CSS).toMatch(
      /\[data-theme='v8'\]\s*\.root\[data-size='small'\]\s*\.item\s*\{[^}]*padding:\s*3px 10px/s,
    )
    expect(CSS).toMatch(
      /\[data-theme='v8'\]\s*\.root\[data-size='small'\]\s*\.item\s*\{[^}]*font-size:\s*var\(--text-caption\)/s,
    )
    expect(CSS).toMatch(
      /\[data-theme='v8'\]\s*\.root\[data-size='small'\]\s*\.item\s*\{[^}]*line-height:\s*18px/s,
    )
    expect(CSS).toMatch(
      /\[data-theme='v8'\]\s*\.root\[data-size='small'\]\s*\.thumb\s*\{[^}]*border-radius:\s*var\(--radius-mini\)/s,
    )
  })

  it('箱型の既定（項目 6/12・文 13・器 control）は変えない', () => {
    expect(CSS).toMatch(/\.item\s*\{[^}]*padding:\s*6px 12px/s)
    expect(CSS).toMatch(/\.item\s*\{[^}]*font-size:\s*var\(--text-label\)/s)
  })
})

/*
 * 切替器のパネル内（★BG-B `SLgY5` つくる枚数の4択）。
 * 器 余白3・r8・横いっぱい／項目 5/12・文 12/17・選択中 700／つまみ r6・上下 3。
 * 板の文字左端 1057・1100・1146・1192 に合う寸法なので、数字を変えると
 * ±4px の照合が外れる（docs/v8-design-rules.md §1 の2・§3）。
 */
describe('切替器のパネル内（★BG-B SLgY5）', () => {
  const COUNTS = [
    { value: '1', label: '1枚' },
    { value: '2', label: '2枚' },
    { value: '3', label: '3枚' },
    { value: '4', label: '4枚' },
  ]

  it('size="panel" で data-size が付く', () => {
    const { container } = render(
      <SegmentedControl aria-label="枚数" options={COUNTS} value="1" onChange={() => {}} size="panel" />,
    )
    expect(container.firstElementChild!.getAttribute('data-size')).toBe('panel')
  })

  it('パネル内は v8 だけで 器 余白3・r8・横いっぱい／項目 5/12・文 12/17／選択中 700／つまみ r6・上下3', () => {
    expect(CSS).toMatch(/\[data-theme='v8'\]\s*\.root\[data-size='panel'\]\s*\{[^}]*display:\s*flex/s)
    expect(CSS).toMatch(/\[data-theme='v8'\]\s*\.root\[data-size='panel'\]\s*\{[^}]*padding:\s*3px/s)
    expect(CSS).toMatch(
      /\[data-theme='v8'\]\s*\.root\[data-size='panel'\]\s*\{[^}]*border-radius:\s*var\(--radius-segment\)/s,
    )
    expect(CSS).toMatch(
      /\[data-theme='v8'\]\s*\.root\[data-size='panel'\]\s*\.item\s*\{[^}]*padding:\s*5px 12px/s,
    )
    expect(CSS).toMatch(
      /\[data-theme='v8'\]\s*\.root\[data-size='panel'\]\s*\.item\s*\{[^}]*font-size:\s*var\(--text-caption\)/s,
    )
    expect(CSS).toMatch(
      /\[data-theme='v8'\]\s*\.root\[data-size='panel'\]\s*\.item\s*\{[^}]*line-height:\s*17px/s,
    )
    expect(CSS).toMatch(
      /\[data-theme='v8'\]\s*\.root\[data-size='panel'\]\s*\.selected\s*\{[^}]*font-weight:\s*700/s,
    )
    expect(CSS).toMatch(
      /\[data-theme='v8'\]\s*\.root\[data-size='panel'\]\s*\.thumb\s*\{[^}]*border-radius:\s*var\(--radius-mini\)/s,
    )
    expect(CSS).toMatch(/\[data-theme='v8'\]\s*\.root\[data-size='panel'\]\s*\.thumb\s*\{[^}]*top:\s*3px/s)
  })

  it('disabled で項目すべてを押せなくし、薄く見せる', () => {
    const onChange = vi.fn()
    const { container } = render(
      <SegmentedControl aria-label="枚数" options={COUNTS} value="1" onChange={onChange} size="panel" disabled />,
    )
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons).toHaveLength(4)
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    fireEvent.click(buttons[2])
    expect(onChange).not.toHaveBeenCalled()
    expect(CSS).toMatch(/\.root:has\(\.item:disabled\)\s*\{[^}]*opacity:\s*0\.5/s)
  })
})
