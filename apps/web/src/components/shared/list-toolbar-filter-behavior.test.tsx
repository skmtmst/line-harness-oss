// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import FilterChip from './filter-chip'
import { ResponsiveFilterChips } from './list-toolbar'
import ListToolbar from './list-toolbar'
import Select from './select'
import { SaveErrorField } from './save-form-errors'

afterEach(cleanup)
function Harness({ multiple = false, withAll = false }: { multiple?: boolean; withAll?: boolean }) {
  const [chosen, setChosen] = useState<string[]>(multiple ? ['有効', '停止中'] : [])
  return <><output aria-label="適用する条件">{chosen.join(',') || 'all'}</output><ResponsiveFilterChips>
    {(withAll ? ['すべて', '有効', '停止中'] : ['有効', '停止中']).map(name => <FilterChip key={name} selected={chosen.includes(name)} onChange={checked => setChosen(old => checked ? multiple ? [...old, name] : [name] : old.filter(value => value !== name))}>{name}</FilterChip>)}
  </ResponsiveFilterChips></>
}
function choose(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: '状態' }))
  const option = screen.getByRole('option', { name })
  fireEvent.click(option.querySelector('button') ?? option)
}
describe('狭い欄の状態の選択', () => {
  it('明示された用途の欄を重ねず、用途の選択と解除を保つ', () => {
    function Named() {
      const [shape, setShape] = useState<string | null>(null)
      return <><output aria-label="用途の条件">{shape ?? 'all'}</output><ListToolbar filters={<ResponsiveFilterChips label="用途">
        <FilterChip selected={shape === null} onChange={() => setShape(null)}>すべて</FilterChip>
        <FilterChip selected={shape === 'image'} onChange={on => setShape(on ? 'image' : null)}>画像</FilterChip>
      </ResponsiveFilterChips>} /></>
    }
    render(<Named />)
    expect(screen.getAllByRole('button', { name: '用途' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '状態' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '用途' }))
    const image = screen.getByRole('option', { name: /画像/ })
    fireEvent.click(image.querySelector('button') ?? image)
    expect(screen.getByLabelText('用途の条件').textContent).toBe('image')
    fireEvent.click(screen.getByRole('button', { name: '用途' }))
    const all = screen.getByRole('option', { name: /すべて/ })
    fireEvent.click(all.querySelector('button') ?? all)
    expect(screen.getByLabelText('用途の条件').textContent).toBe('all')
  })
  it('欄のエラーの包みと単一の選ぶ欄を保ち、文字の頭を重ねない', () => {
    render(<ListToolbar filters={<SaveErrorField names={['sort']}><Select aria-label="並び" label="並び" value="recent" onChange={() => {}} options={[{value:'recent',label:'並び：更新が新しい順'}]} /></SaveErrorField>} />)
    expect(screen.getByRole('button', { name: '並び' }).textContent).toBe('並び：更新が新しい順')
  })
  it('未選択をすべてと表示し、選ぶ・解除する操作を元の絞り込みへ返す', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: '状態' }).textContent?.trim()).toBe('状態：すべて')
    choose(/有効/)
    expect(screen.getByLabelText('適用する条件').textContent).toBe('有効')
    choose(/すべて/)
    expect(screen.getByLabelText('適用する条件').textContent).toBe('all')
  })
  it('元の札にすべてがあるとき、同じ選択肢を増やさない', () => {
    render(<Harness withAll />)
    fireEvent.click(screen.getByRole('button', { name: '状態' }))
    expect(screen.getAllByRole('option', { name: /すべて/ })).toHaveLength(1)
  })
  it('複数選んだ条件を隠さず、1つ外してもほかの条件は残す', () => {
    render(<Harness multiple />)
    expect(screen.getByRole('button', { name: '状態' }).textContent).toContain('2件の条件')
    choose(/有効/)
    expect(screen.getByLabelText('適用する条件').textContent).toBe('停止中')
  })
})
