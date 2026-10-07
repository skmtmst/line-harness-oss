// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const create = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api: { adPlatforms: { create, connect: async () => ({ success: true }) } } }))
import AdConnection from './ad-connection-dialog'
afterEach(cleanup)
it('広告の接続保存中は×・背景・Esc・閉じるで消えない', async () => {
  let resolve!: (value: unknown) => void
  create.mockImplementation(() => new Promise(r => { resolve = r }))
  const close = vi.fn()
  render(<AdConnection provider={{ key: 'meta', label: 'Meta' }} accountId="a" onClose={close} onSaved={async () => {}} />)
  for (const [label, value] of [['広告アカウントID', 'account'], ['ピクセルID', 'pixel'], ['アクセストークン', 'secret']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
  fireEvent.click(screen.getByRole('button', { name: '接続を確認してつなぐ' }))
  expect(screen.getAllByRole('button', { name: '閉じる', exact: true }).every(button => button.hasAttribute('disabled'))).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.mouseDown(screen.getByRole('presentation'))
  expect(close).not.toHaveBeenCalled()
  await act(async () => resolve({ success: true, data: { id: 'p1' } }))
  expect(close).toHaveBeenCalledTimes(1)
})
