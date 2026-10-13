// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import OtpInput from './otp-input'
afterEach(cleanup)
function Input() { const [value, setValue] = useState(''); return <OtpInput label="回復コード" format="recovery" length={8} value={value} onChange={setValue} /> }
it('pastes a complete 4-4 recovery code into eight named slots and supports correction with keys', () => {
  render(<Input />)
  const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
  expect(inputs).toHaveLength(8)
  expect(screen.getByRole('group', { name: '回復コード' })).toBeTruthy()
  fireEvent.paste(inputs[0], { clipboardData: { getData: () => '7k2q-9fxm' } })
  expect(inputs.map(i => i.value).join('')).toBe('7K2Q9FXM')
  expect(screen.getByRole('textbox', { name: '8文字目' })).toBe(document.activeElement)
  fireEvent.keyDown(inputs[7], { key: 'Backspace' })
  expect(inputs.map(i => i.value).join('')).toBe('7K2Q9FX')
  fireEvent.keyDown(inputs[7], { key: 'P' })
  expect(inputs.map(i => i.value).join('')).toBe('7K2Q9FXP')
  fireEvent.keyDown(inputs[7], { key: 'Home' })
  expect(document.activeElement).toBe(inputs[0])
})
