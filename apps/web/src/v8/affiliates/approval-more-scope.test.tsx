// @vitest-environment happy-dom
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ account: 'a', list: vi.fn() }))
vi.mock('./frame', async original => ({ ...await original<typeof import('./frame')>(), useAffiliateShell: () => ({ readonly: false, narrow: false, accountId: fixture.account, setCount: vi.fn() }) }))
vi.mock('@/lib/api', async original => { const actual = await original<typeof import('@/lib/api')>(); return { ...actual, api: { ...actual.api, affiliates: { ...actual.api.affiliates, list: async () => ({ success: true, data: [] }) } } } })
vi.mock('./display', async original => ({ ...await original<typeof import('./display')>(), listAllConversionApprovals: fixture.list }))
import ApprovalsTab from './approvals'

afterEach(() => { cleanup(); fixture.list.mockReset(); fixture.account = 'a' })

it('店切替後は新しい店の続きを読み、前の店の遅い続きを混ぜない', async () => {
  let release!: (value: { items: never[]; truncated: boolean }) => void
  const pending = new Promise<{ items: never[]; truncated: boolean }>(resolve => { release = resolve })
  fixture.list.mockImplementation((status: string, offset: number, options: { accountId: string }) => {
    if (offset > 0 && options.accountId === 'a') return pending
    return Promise.resolve({ items: status === 'pending' && offset === 0 ? [{ eventId: `e-${options.accountId}`, friendName: `客-${options.accountId}`, affiliateName: '紹介者', offerName: '案件', lineAccountId: options.accountId, createdAt: '2026-10-01T00:00:00Z', approvalStatus: 'pending' }] : [], truncated: status === 'pending' && offset === 0 })
  })
  const view = render(<ApprovalsTab />)
  fireEvent.click(await screen.findByRole('button', { name: 'さらに読み込む' }))
  await waitFor(() => expect(fixture.list).toHaveBeenCalledWith('pending', 1, { accountId: 'a' }))
  fixture.account = 'b'; view.rerender(<ApprovalsTab />)
  await screen.findByText('客-b')
  await act(async () => { release({ items: [], truncated: false }); await pending })
  const more = await screen.findByRole('button', { name: 'さらに読み込む' })
  fireEvent.click(more)
  await waitFor(() => expect(fixture.list).toHaveBeenCalledWith('pending', 1, { accountId: 'b' }))
})

it('店を戻した後も古い続きの返事を表示しない', async () => {
  const oldRow = { eventId: 'old', friendName: '古い客', affiliateName: '紹介者', offerName: '案件', lineAccountId: 'a', createdAt: '2026-10-01T00:00:00Z', approvalStatus: 'pending' }
  let release!: (value: { items: typeof oldRow[]; truncated: boolean }) => void
  const pending = new Promise<{ items: typeof oldRow[]; truncated: boolean }>(resolve => { release = resolve })
  fixture.list.mockImplementation((status: string, offset: number, options: { accountId: string }) => {
    if (offset > 0) return pending
    return Promise.resolve({ items: status === 'pending' ? [{ ...oldRow, eventId: options.accountId, friendName: `客-${options.accountId}`, lineAccountId: options.accountId }] : [], truncated: status === 'pending' })
  })
  const view = render(<ApprovalsTab />)
  fireEvent.click(await screen.findByRole('button', { name: 'さらに読み込む' }))
  fixture.account = 'b'; view.rerender(<ApprovalsTab />)
  await screen.findByText('客-b')
  fixture.account = 'a'; view.rerender(<ApprovalsTab />)
  await screen.findByText('客-a')
  await act(async () => { release({ items: [oldRow], truncated: false }); await pending })
  expect(screen.queryByText('古い客')).toBeNull()
  expect(screen.getByRole('button', { name: 'さらに読み込む' })).toBeTruthy()
})
