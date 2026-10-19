// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ me: vi.fn(), update: vi.fn() }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), useSearchParams: () => new URLSearchParams('id=wh-1') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, staff: { ...actual.api.staff, me: fixture.me }, webhooks: { ...actual.api.webhooks, outgoing: { ...actual.api.webhooks.outgoing,
    detail: async () => ({ success: true, data: { name: '送り先', url: 'https://example.test/events', eventTypes: [], maxRetries: 3 } }), update: fixture.update,
  } } } }
})
import Edit from './edit'
beforeEach(() => { fixture.me.mockReset(); fixture.update.mockReset() })
afterEach(cleanup)
it('設定が先に届いても本人確認が終わるまで保存を出さない', async () => {
  let resolve!: (data: unknown) => void
  fixture.me.mockImplementation(() => new Promise(r => { resolve = r }))
  render(<Edit />)
  await screen.findByText(/権限の確認が終わるまで編集できません/)
  expect(screen.queryByRole('button', { name: /保存する/ })).toBeNull()
  await act(async () => { resolve({ success: true, data: { id: 'owner', role: 'owner' } }) })
  expect(await screen.findByRole('button', { name: /保存する/ })).toBeTruthy()
  expect(fixture.update).not.toHaveBeenCalled()
})
it('本人確認の失敗は保存を隠し、共通の読取を再試行できる', async () => {
  fixture.me.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ success: true, data: { role: 'owner' } })
  render(<Edit />)
  await screen.findByText(/権限の確認が終わるまで編集できません/)
  expect(screen.queryByRole('button', { name: /保存する/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  expect(await screen.findByRole('button', { name: /保存する/ })).toBeTruthy()
  expect(fixture.update).not.toHaveBeenCalled()
})
it('閲覧のみのオーナーには保存と編集欄を出さない', async () => {
  fixture.me.mockResolvedValue({ success: true, data: { role: 'owner', roleBundle: 'view_only' } })
  render(<Edit />)
  await screen.findByText(/送り先の変更は統括だけ/)
  expect(screen.queryByRole('button', { name: /保存する/ })).toBeNull()
  expect(screen.queryByRole('textbox', { name: '名前' })).toBeNull()
})
