// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import LayoutPicker, { type LayoutPickerOption } from './layout-picker'

const options: LayoutPickerOption[] = [
  { value: '1', label: '1面', areas: [{ label: 'A', x: 0, y: 0, width: 100, height: 100 }] },
  { value: '2v', label: '上下2面', areas: [{ label: 'A', x: 0, y: 0, width: 100, height: 50 }, { label: 'B', x: 0, y: 50, width: 100, height: 50 }] },
  { value: '2h', label: '左右2面', areas: [{ label: 'A', x: 0, y: 0, width: 50, height: 100 }, { label: 'B', x: 50, y: 0, width: 50, height: 100 }] },
]
afterEach(cleanup)
function Picker() {
  const [value, setValue] = useState('1')
  return <LayoutPicker options={options} value={value} onChange={setValue} />
}
it('形と面の文字を読み上げ、選んだタイルにだけ✓を出す', () => {
  render(<Picker />)
  const group = screen.getByRole('radiogroup', { name: '面の分け方' })
  const radio = within(group).getByRole('radio', { name: '上下2面（面 A・B）' }) as HTMLInputElement
  fireEvent.click(radio)
  expect(radio.checked).toBe(true)
  expect(within(group).getAllByRole('radio').filter((input) => (input as HTMLInputElement).checked)).toHaveLength(1)
  expect(radio.parentElement?.textContent).toBe('AB✓上下2面')
  const areas = radio.parentElement!.querySelectorAll('span[style]') as NodeListOf<HTMLElement>
  expect(Array.from(areas).map((area) => [area.textContent, area.style.top, area.style.height])).toEqual([['A', '0%', '50%'], ['B', '50%', '50%']])
})
it('Tabの入口は選択中の1つ。矢印で選択とフォーカスを移し、両端を巡回する', () => {
  render(<Picker />)
  const radios = screen.getAllByRole('radio') as HTMLInputElement[]
  expect(radios.map((input) => input.tabIndex)).toEqual([0, -1, -1])
  radios[0].focus()
  fireEvent.keyDown(radios[0], { key: 'ArrowDown' })
  expect(radios[1].checked).toBe(true)
  expect(document.activeElement).toBe(radios[1])
  expect(radios.map((input) => input.tabIndex)).toEqual([-1, 0, -1])
  fireEvent.keyDown(radios[1], { key: 'ArrowRight' })
  expect(radios[2].checked).toBe(true)
  fireEvent.keyDown(radios[2], { key: 'ArrowRight' })
  expect(radios[0].checked).toBe(true)
  fireEvent.keyDown(radios[0], { key: 'ArrowLeft' })
  expect(radios[2].checked).toBe(true)
  fireEvent.keyDown(radios[2], { key: 'Home' })
  expect(radios[0].checked).toBe(true)
  fireEvent.keyDown(radios[0], { key: 'End' })
  expect(radios[2].checked).toBe(true)
})
it('保存して形を固定したときはクリックとキーで変更しない', () => {
  const onChange = vi.fn()
  render(<LayoutPicker options={options} value="1" onChange={onChange} disabled />)
  const radio = screen.getByRole('radio', { name: '上下2面（面 A・B）' }) as HTMLInputElement
  radio.click()
  fireEvent.keyDown(radio, { key: 'ArrowRight' })
  expect(radio.disabled).toBe(true)
  expect(onChange).not.toHaveBeenCalled()
})
it('2つの選び方を同じ画面に置いてもラジオの組を混ぜない', () => {
  render(<><Picker /><Picker /></>)
  const groups = screen.getAllByRole('radiogroup')
  const first = within(groups[0]).getAllByRole('radio') as HTMLInputElement[]
  const second = within(groups[1]).getAllByRole('radio') as HTMLInputElement[]
  expect(first[0].name).not.toBe(second[0].name)
  fireEvent.click(first[1])
  expect(first[1].checked).toBe(true)
  expect(second[0].checked).toBe(true)
})
