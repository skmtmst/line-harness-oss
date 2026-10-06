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
