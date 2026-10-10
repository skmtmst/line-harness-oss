// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import FilterChip from './filter-chip'
import { ResponsiveFilterChips } from './list-toolbar'

afterEach(cleanup)
function Harness({ multiple = false }: { multiple?: boolean }) {
  const [chosen, setChosen] = useState<string[]>(multiple ? ['有効', '停止中'] : [])
  return <><output aria-label="適用する条件">{chosen.join(',') || 'all'}</output><ResponsiveFilterChips>
    {['有効', '停止中'].map(name => <FilterChip key={name} selected={chosen.includes(name)} onChange={checked => setChosen(old => checked ? multiple ? [...old, name] : [name] : old.filter(value => value !== name))}>{name}</FilterChip>)}
  </ResponsiveFilterChips></>
}
function choose(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: '状態' }))
  const option = screen.getByRole('option', { name })
  fireEvent.click(option.querySelector('button') ?? option)
}
describe('狭い欄の状態の選択', () => {
  it('未選択をすべてと表示し、選ぶ・解除する操作を元の絞り込みへ返す', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: '状態' }).textContent?.trim()).toBe('状態：すべて')
    choose(/有効/)
    expect(screen.getByLabelText('適用する条件').textContent).toBe('有効')
    choose(/すべて/)
    expect(screen.getByLabelText('適用する条件').textContent).toBe('all')
  })
  it('複数選んだ条件を隠さず、1つ外してもほかの条件は残す', () => {
    render(<Harness multiple />)
    expect(screen.getByRole('button', { name: '状態' }).textContent).toContain('2件の条件')
    choose(/有効/)
    expect(screen.getByLabelText('適用する条件').textContent).toBe('停止中')
  })
})
