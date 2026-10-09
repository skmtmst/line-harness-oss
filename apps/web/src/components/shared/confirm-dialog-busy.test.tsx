// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import ConfirmDialog from './confirm-dialog'
afterEach(cleanup)
test('busyを渡さなくても非同期の実行中は二重送信と窓の終了を防ぐ', async () => {
  let resolve!: () => void
  const confirm = vi.fn(() => new Promise<void>((done) => { resolve = done }))
  const cancel = vi.fn()
  render(<ConfirmDialog open title="削除の確認" description="削除します" confirmLabel="削除する" onConfirm={confirm} onCancel={cancel} />)
  const button = screen.getByRole('button', { name: '削除する' }) as HTMLButtonElement
  fireEvent.click(button)
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-busy')).toBe('true')
  fireEvent.click(button)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(cancel).not.toHaveBeenCalled()
  await act(async () => { resolve(); await Promise.resolve() })
  expect(button.disabled).toBe(false)
})
