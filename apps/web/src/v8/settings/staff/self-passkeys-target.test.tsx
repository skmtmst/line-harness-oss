// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const fx = vi.hoisted(() => ({ id: 'operator-1', call: vi.fn(), gate: vi.fn(async () => 'fixture-grant'), held: null as null | (() => unknown) }))
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: vi.fn() }))
vi.mock('@/components/step-up-prompt', () => ({ useStepUpGate: () => ({ gate: fx.gate, prompt: null }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffIdentity: () => ({ id: fx.id, name: fx.id === 'operator-1' ? '確認担当者' : '別担当者' }) }))
vi.mock('@/lib/api', () => ({ fetchApi: fx.call, describeSaveFailure: (error: Error) => error.message }))
vi.mock('@/components/shared/confirm-dialog', async original => {
  const actual = await original<typeof import('@/components/shared/confirm-dialog')>()
  return { ...actual, default: (props: React.ComponentProps<typeof actual.default>) => {
    if (props.open && props.title === 'パスキーを削除しますか？' && props.onConfirm) fx.held = props.onConfirm
    return <actual.default {...props} />
  } }
})
import SelfPasskeys from './self-passkeys'

afterEach(() => { cleanup(); vi.clearAllMocks(); fx.held = null; fx.id = 'operator-1' })

async function openSecondKey() {
  fx.call.mockResolvedValue({ success: true, data: [
    { id: 'key-1', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null },
    { id: 'key-2', createdAt: '2026-02-01T00:00:00Z', lastUsedAt: null },
  ] })
  render(<SelfPasskeys enabled />)
  await screen.findByText('パスキー 2')
  fireEvent.click(screen.getAllByRole('button', { name: '削除' })[1])
  return screen.findByRole('alertdialog')
}

it('削除する本人・パスキーと環境を確認窓に出す', async () => {
  const dialog = await openSecondKey()
  expect(within(dialog).getByText('確認担当者')).toBeTruthy()
  expect(within(dialog).getByText(/パスキー 2/)).toBeTruthy()
  expect(within(dialog).getByText('環境')).toBeTruthy()
})

it('キャンセルした古い確認から認証や削除を始めない', async () => {
  const dialog = await openSecondKey()
  const previous = fx.held!
  fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
  await act(async () => { await previous() })
  await waitFor(() => expect(fx.gate).not.toHaveBeenCalled())
  expect(fx.call).toHaveBeenCalledTimes(1)
})

it('ログイン本人が切り替わったら古い確認を閉じる', async () => {
  fx.call.mockResolvedValue({ success: true, data: [{ id: 'key-2', createdAt: '2026-02-01T00:00:00Z', lastUsedAt: null }] })
  const view = render(<SelfPasskeys enabled />)
  await screen.findByText('パスキー 1')
  fireEvent.click(screen.getByRole('button', { name: '削除' }))
  const held = fx.held!
  fx.id = 'operator-2'
  view.rerender(<SelfPasskeys enabled />)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await act(async () => { await held() })
  expect(fx.gate).not.toHaveBeenCalled()
})

it('本人が確認したパスキーだけを削除要求へ渡す', async () => {
  const dialog = await openSecondKey()
  fx.call.mockResolvedValueOnce({ success: true, data: null }).mockResolvedValueOnce({ success: true, data: [] })
  fireEvent.click(within(dialog).getByRole('button', { name: '削除する' }))
  await waitFor(() => expect(fx.call).toHaveBeenCalledWith('/api/auth/passkeys/self', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ id: 'key-2' }) })))
})
