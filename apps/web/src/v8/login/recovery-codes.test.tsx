// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import RecoveryCodes from './recovery-codes'
afterEach(cleanup)
it('shows codes only in memory and provides an explicit acknowledgement before continuing', () => {
  const onContinue = vi.fn()
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  render(<RecoveryCodes codes={['fixture-code-1', 'fixture-code-2']} onContinue={onContinue} />)
  expect(screen.getByText(/fixture-code-1/)).toBeTruthy()
  const proceed = screen.getByRole('button', { name: '控えました。ログインする' }) as HTMLButtonElement
  expect(proceed.disabled).toBe(false)
  fireEvent.click(proceed)
  expect(onContinue).toHaveBeenCalledOnce()
  expect(storage).not.toHaveBeenCalled()
  storage.mockRestore()
})
