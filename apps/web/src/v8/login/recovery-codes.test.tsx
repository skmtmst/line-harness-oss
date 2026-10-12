// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import RecoveryCodes from './recovery-codes'
afterEach(cleanup)
it('shows recovery codes once in memory and requires saving them before continuing', () => {
  const onContinue = vi.fn()
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  render(<RecoveryCodes codes={['fixture-code-1', 'fixture-code-2']} onContinue={onContinue} />)
  expect(screen.getByText(/fixture-code-1/)).toBeTruthy()
  const proceed = screen.getByRole('button', { name: '管理画面へ進む' }) as HTMLButtonElement
  expect(proceed.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: '回復コードを保存しました' }))
  expect(proceed.disabled).toBe(false)
  fireEvent.click(proceed)
  expect(onContinue).toHaveBeenCalledOnce()
  expect(storage).not.toHaveBeenCalled()
  storage.mockRestore()
})
