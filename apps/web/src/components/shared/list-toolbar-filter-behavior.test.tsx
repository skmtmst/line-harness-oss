// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FilterChip from './filter-chip'
import { ResponsiveFilterChips } from './list-toolbar'
import ListToolbar, { ListToolbarLeading, ListToolbarRow } from './list-toolbar'
import Select from './select'
import { SaveErrorField } from './save-form-errors'
import { FilterPopover } from './filter-popover'
import selectStyles from './select.module.css'

afterEach(cleanup)

it.each(['filters', 'leading'])('道具段の自動幅は窓の内側の全幅・内容幅・明示幅と選択を保つ: %s', async placement => {
  const change = vi.fn()
  const options = [{ value: 'all', label: 'すべて' }, { value: 'chosen', label: '選んだ条件' }]
  const controls = <>
    <Select aria-label="段の条件" size="full" width={320} value="all" options={options} onChange={change} />
    <FilterPopover open onClose={() => {}} label="追加の条件" trigger={<button>絞り込みを開く</button>} actions={<button>適用する</button>}>
      <Select aria-label="窓の全幅" size="full" value="all" options={options} onChange={change} />
      <Select aria-label="窓の内容幅" size="content" value="all" options={options} onChange={change} />
      <Select aria-label="窓の明示幅" width={119} value="all" options={options} onChange={change} />
    </FilterPopover>
  </>
  render(placement === 'filters' ? <ListToolbar filters={controls} />
    : <ListToolbarLeading leading={controls}><ListToolbarRow><button>通常の操作</button></ListToolbarRow></ListToolbarLeading>)
  const direct = screen.getByRole('button', { name: '段の条件' }).parentElement!
  expect(direct.classList.contains(selectStyles.content)).toBe(true)
  expect(direct.style.width).toBe('')
  const full = await screen.findByRole('button', { name: '窓の全幅' })
  expect(full.parentElement!.classList.contains(selectStyles.full)).toBe(true)
  expect(screen.getByRole('button', { name: '窓の内容幅' }).parentElement!.classList.contains(selectStyles.content)).toBe(true)
  expect(screen.getByRole('button', { name: '窓の明示幅' }).parentElement!.style.width).toBe('119px')
  fireEvent.click(full)
  const chosen = await screen.findByRole('option', { name: '選んだ条件' })
  fireEvent.click(chosen.querySelector('button') ?? chosen)
  expect(change).toHaveBeenCalledExactlyOnceWith('chosen')
})

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
  it('札を保つ指定は2条件を個別に選ぶ・外す操作を保ち、状態の欄を増やさない', () => {
    function Preserved() {
      const [stopped, setStopped] = useState(false), [timed, setTimed] = useState(false)
      return <ListToolbar preserveFilterChips filters={<div role="group" aria-label="条件">
        <FilterChip selected={stopped} onChange={setStopped}>停止中のみ</FilterChip>
        <FilterChip selected={timed} onChange={setTimed}>時間帯あり</FilterChip>
      </div>} />
    }
    render(<Preserved />)
    expect(screen.queryByRole('button', { name: '状態' })).toBeNull()
    const stopped = screen.getByRole('button', { name: '停止中のみ' })
    const timed = screen.getByRole('button', { name: '時間帯あり' })
    fireEvent.click(stopped); fireEvent.click(timed)
    expect(stopped.getAttribute('aria-pressed')).toBe('true')
    expect(timed.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(stopped)
    expect(stopped.getAttribute('aria-pressed')).toBe('false')
    expect(timed.getAttribute('aria-pressed')).toBe('true')
  })
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
