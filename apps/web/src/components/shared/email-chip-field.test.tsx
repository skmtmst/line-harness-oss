// @vitest-environment happy-dom
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EmailChipField } from './email-chip-field'

afterEach(cleanup)
function Form({ onSubmit = vi.fn() }: { onSubmit?: () => void }) {
  const [value, setValue] = useState('')
  return <form onSubmit={event => { event.preventDefault(); onSubmit() }}><label htmlFor="email">メール</label><EmailChipField id="email" value={value} onValueChange={setValue} /><output>{value}</output></form>
}
it('入力をEnterでチップにし、送信せず、外して打ち直せる', () => {
  const submit = vi.fn()
  render(<Form onSubmit={submit} />)
  const input = screen.getByLabelText('メール')
  fireEvent.change(input, { target: { value: 'staff@example.com' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(submit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'staff@example.comを外す' }))
  expect(screen.getByRole('status').textContent).toBe('')
  expect(document.activeElement).toBe(input)
})
it('貼り付けた1件はチップにし、複数件は残してその場で理由を示す', () => {
  render(<Form />)
  const input = screen.getByLabelText('メール')
  const paste = (text: string) => fireEvent.paste(input, { clipboardData: { getData: () => text } })
  paste(' staff@example.com ')
  expect(screen.getByRole('button', { name: 'staff@example.comを外す' })).toBeTruthy()
  paste('one@example.com, two@example.com')
  expect(screen.queryByRole('button', { name: /を外す/ })).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('1件ずつ')
  expect((input as HTMLInputElement).value).toBe('one@example.com, two@example.com')
})
it('不正な宛先は離れた場で知らせ、修正すれば消える', () => {
  render(<Form />)
  const input = screen.getByLabelText('メール')
  fireEvent.change(input, { target: { value: 'bad@' } })
  fireEvent.blur(input)
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByRole('alert').textContent).toContain('正しいメール')
  fireEvent.change(input, { target: { value: 'fixed@example.com' } })
  fireEvent.blur(input)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: 'fixed@example.comを外す' })).toBeTruthy()
})
