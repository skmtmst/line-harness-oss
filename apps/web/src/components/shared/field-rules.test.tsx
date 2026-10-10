// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Field, TextInput } from './form-controls'
afterEach(cleanup)
it('B-158 決まり4：任意が二重にならず、上限のある入力は自動で文字数と読み上げ説明を出す', () => {
  render(<Field label="メモ（任意）"><TextInput defaultValue="あいう" maxLength={20} /></Field>)
  expect(screen.getAllByText('任意')).toHaveLength(1)
  expect(screen.queryByText('メモ（任意）')).toBeNull()
  expect(screen.getByText('3/20文字')).toBeTruthy()
  const input = screen.getByRole('textbox', { name: 'メモ' })
  expect(input.getAttribute('aria-describedby')).toContain(screen.getByText('3/20文字').id)
  fireEvent.input(input, { target: { value: 'あいうえお' } })
  expect(screen.getByText('5/20文字')).toBeTruthy()
})
it('必須は札を1つ・任意は出さず、指定された上限と超過を守る', () => {
  const { container } = render(<Field label="名前（必須）" count={{ value: 21, max: 20 }}><TextInput /></Field>)
  expect(screen.getAllByText('必須')).toHaveLength(1)
  expect(screen.queryByText('任意')).toBeNull()
  expect(container.querySelector('[data-field-count="over"]')?.textContent).toBe('21/20文字')
  expect(screen.getByRole('textbox').getAttribute('aria-required')).toBe('true')
})

it('複数の選択肢は欄のラベルで上書きせず、それぞれの名前で操作できる', () => {
  render(<Field label="既定値"><label><input type="checkbox" />A</label><label><input type="checkbox" />B</label></Field>)
  expect(screen.getByRole('checkbox', { name: 'A' })).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: 'B' })).toBeTruthy()
})
