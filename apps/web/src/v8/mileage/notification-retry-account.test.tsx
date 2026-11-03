// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ owner: 'other' as string | null, entryType: 'adjustment', retry: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/mileage/friend', useSearchParams: () => new URLSearchParams('id=f1') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/lib/api', async original => {
 const actual = await original<typeof import('@/lib/api')>()
 const item = { id: 'e1', status: 'confirmed', amount: 10, reason: '来店', source: 'rule', hasSourceEvent: false, sourceReferenceId: null, ruleName: null, mode: 'automatic', executedByStaffName: null, notificationStatus: 'failed', notificationErrorCode: null, balanceAfter: 10, occurredAt: '2026-10-01T00:00:00Z', displayName: '田中' }
 return { ...actual, api: { ...actual.api, friends: { ...actual.api.friends, get: async () => ({ success: true, data: { id: 'f1', displayName: '田中', createdAt: '2026-01-01T00:00:00Z' } }), mileage: async () => ({ success: true, data: { summary: { available: 10, pending: 0, lifetimeEarned: 10, spent: 0 }, history: [], insights: null } }) }, mileage: { ...actual.api.mileage, friendsV6: async () => ({ success: true, data: { balanceSource: 'musubo', items: [] } }), history: async () => ({ success: true, data: { items: [{ ...item, entryType: state.entryType, lineAccountId: state.owner }], summary: { byType: [] }, pagination: { total: 1, limit: 100, offset: 0 } } }), retryMileageNotification: state.retry } } }
})
import FriendDetail from './friend-detail'
beforeEach(() => { state.owner = 'other'; state.entryType = 'adjustment'; state.retry.mockReset(); state.retry.mockResolvedValue({ success: false, error: 'test' }) })
afterEach(cleanup)
async function retry() {
 render(<FriendDetail />)
 fireEvent.click(await screen.findByRole('button', { name: /操作/ }))
 fireEvent.click(await screen.findByRole('menuitem', { name: '通知を再送' }))
}
it('通知の所属が選択中と違えば記録先に送り、不明なら代用しない', async () => {
 await retry()
 expect(state.retry).toHaveBeenCalledWith('e1', { accountId: 'other' })
 cleanup(); state.retry.mockClear(); state.owner = null
 await retry()
 expect(state.retry).not.toHaveBeenCalled()
 expect(await screen.findByText(/所属.*確認でき.*再送/)).toBeTruthy()
})
it('調整以外の記録には通知再送を出さない', async () => {
 state.entryType = 'grant'
 render(<FriendDetail />)
 expect((await screen.findAllByText('来店')).length).toBeGreaterThan(0)
 expect(screen.queryByRole('menuitem', { name: '通知を再送' })).toBeNull()
 expect(screen.queryByRole('button', { name: /操作/ })).toBeNull()
})
it('通知の所属先が不明なら送らず理由を伝える', async () => {
 state.owner = null
 await retry()
 expect(state.retry).not.toHaveBeenCalled()
 expect(await screen.findByText(/所属.*確認でき.*再送/)).toBeTruthy()
})
