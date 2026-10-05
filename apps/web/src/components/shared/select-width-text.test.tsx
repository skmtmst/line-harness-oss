// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import Select from './select'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')
const OPTIONS = [
  { value: 'new', label: '新しい順' },
  { value: 'old', label: '古い順' },
]

afterEach(() => {
  cleanup()
})

/**
 * 選ぶ欄の幅と枠なしの形（x6QsVz：絞り込み欄 122〜136・並び替えは枠なし文字＋上下矢印）。
 * 渡さない限り見た目は変わらない。
 */
describe('選ぶ欄の幅と枠なし', () => {
  it('width を渡すと箱の幅になる', () => {
    const { container } = render(
      <Select aria-label="タグ" value="new" onChange={() => {}} options={OPTIONS} width={130} />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.style.width).toBe('130px')
  })

  it('渡さないと幅の指定は付かない', () => {
    const { container } = render(
      <Select aria-label="タグ" value="new" onChange={() => {}} options={OPTIONS} />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.style.width).toBe('')
  })

  it('icon を渡すと箱の先頭に図柄が出る（v19Ivv の栞）', () => {
    const { container } = render(
      <Select
        aria-label="よく使う絞り込み"
        value="all"
        onChange={() => {}}
        options={OPTIONS}
        icon={<svg aria-hidden="true"><circle cx="4" cy="4" r="3" /></svg>}
      />,
    )
    expect(container.querySelector('[class*="leadingIcon"]')).not.toBeNull()
  })

  it('icon を渡さなければ図柄は出ない', () => {
    const { container } = render(
      <Select aria-label="タグ" value="new" onChange={() => {}} options={OPTIONS} />,
    )
    expect(container.querySelector('[class*="leadingIcon"]')).toBeNull()
  })

  it('treatment="text" で上下矢印が出る（箱は v8 の CSS で消える）', () => {
    const { container } = render(
      <Select aria-label="並び順" value="new" onChange={() => {}} options={OPTIONS} treatment="text" />,
    )
    expect(screen.getByText('新しい順')).toBeTruthy()
    const css = read('select.module.css')
    expect(css).toMatch(/\[data-theme='v8'\] \.textTrigger\s*\{[^}]*border:\s*0/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.textTrigger \.chevron\s*\{\s*display:\s*none;/s)
    expect(container.querySelector('[class*="directionIcon"]')).not.toBeNull()
  })
})
