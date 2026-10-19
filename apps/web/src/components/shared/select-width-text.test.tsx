// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Select from './select'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')
const OPTIONS = [
  { value: 'new', label: '新しい順' },
  { value: 'old', label: '古い順' },
]

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
})

/**
 * 選ぶ欄の幅と枠なしの形（：絞り込み欄 122〜136・並び替えは枠なし文字＋上下矢印）。
 * 渡さない限り見た目は変わらない。
 */
describe('選ぶ欄の幅と枠なし', () => {
  it('狭い段の印だけでも名前を読み上げ、キーで同じ候補を選べる', () => {
    document.documentElement.dataset.theme = 'v8'
    const change = vi.fn()
    render(<Select aria-label="よく使う絞り込み" value="new" onChange={change} options={OPTIONS}
      icon={<svg aria-hidden="true" />} iconOnly showChevron={false} />)
    const button = screen.getByRole('button', { name: 'よく使う絞り込み' })
    expect(button.getAttribute('data-icon-only')).toBe('true')
    expect(button.getAttribute('data-size')).toBe('compact')
    expect(button.getAttribute('data-design-node')).toBe('H0V8EK')
    expect(button.querySelector('[data-select-value]')?.hasAttribute('hidden')).toBe(true)
    expect(button.querySelector('[class*="chevron"]')).toBeNull()
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(change).toHaveBeenCalledWith('old')
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })
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
    expect(css).toMatch(/:root \.textTrigger\s*\{[^}]*border:\s*0/s)
    expect(css).toMatch(/:root \.textTrigger \.chevron\s*\{\s*display:\s*none;/s)
    expect(container.querySelector('[class*="directionIcon"]')).not.toBeNull()
  })
})


it('W3: page size wording comes from the shared role while the 100 option still selects 100', () => {
  document.documentElement.dataset.theme = 'v8'
  const change=vi.fn()
  render(<Select size="page-size" aria-label="表示件数" value="20" onChange={change}
    options={[{value:'20',label:'20 件表示'},{value:'50',label:'50件'},{value:'100',label:'100件'}]} />)
  const trigger=screen.getByRole('button',{name:'表示件数'})
  expect(trigger.textContent).toBe('20件表示')
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('option',{name:'100件表示'}).querySelector('button')!)
  expect(change).toHaveBeenCalledWith('100')
})

it('W3: a numeric value in an ordinary selector retains its authored label',()=>{
  render(<Select aria-label="点数" value="20" onChange={()=>{}} options={[{value:'20',label:'20点'}]} />)
  expect(screen.getByRole('button',{name:'点数'}).textContent).toBe('20点')
})


it('W3: page-size width on a duration selector keeps days and has no page-count marker',()=>{
  const {container}=render(<Select size="page-size" aria-label="期間" value="7" onChange={()=>{}} options={[{value:'7',label:'7日'},{value:'30',label:'30日'}]} />)
  expect(screen.getByRole('button',{name:'期間'}).textContent).toBe('7日')
  expect(container.querySelector('[data-list-page-size]')).toBeNull()
})
