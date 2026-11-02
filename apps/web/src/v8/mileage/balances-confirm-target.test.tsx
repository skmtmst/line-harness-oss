// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ account: 'a', reject: vi.fn(), approvals: vi.fn() }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.account, loading: false }) }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('./frame', async original => ({ ...await original<typeof import('./frame')>(), useMileageShell: () => ({ readonly: false, narrow: false, setCount: () => {} }) }))
vi.mock('@/lib/api', async original => {
 const actual = await original<typeof import('@/lib/api')>()
 return { ...actual, api: { ...actual.api, mileage: { ...actual.api.mileage, friendsV6: async () => ({ success: true, data: { items: [], summary: { totalMembers: 0, withBalanceCount: 0, available: 0, pending: 0, monthChange: 0, rankCounts: [], expiringMiles30d: null, nextExpiringAt: null }, pagination: { total: 0, limit: 20, offset: 0 } } }), history: async () => ({ success: true, data: { summary: { byType: [] } } }), adjustmentApprovals: state.approvals, rejectAdjustment: state.reject } } }
})
import BalancesTab from './balances'
beforeEach(() => { state.account='a'; state.approvals.mockResolvedValue({ success: true, data: [{ id: 'r1', friend_id: 'f1', friend_display_name: '人工顧客', direction: 'increase', amount: 5000, reason: '人工の依頼', requested_by_staff_name: '担当', created_at: '2026-09-20T10:00:00+09:00' }] }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
async function open() { fireEvent.click(await screen.findByRole('button', { name: '差し戻す' })); return screen.findByRole('alertdialog') }
it('差し戻しの確認に操作対象を表示する', async () => {
 render(<BalancesTab />)
 const dialog = await open()
 expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
 expect(within(dialog).getByText('環境')).toBeTruthy()
})
it('切替後の古い差し戻し確認を送らない', async () => {
 const view = render(<BalancesTab />)
 const dialog = await open()
 const b = within(dialog).getByRole('button', { name: '差し戻す' })
 const key = Object.keys(b).find(item => item.startsWith('__reactProps$'))!
 const oldConfirm = (b as unknown as Record<string,{onClick:(e:unknown)=>unknown}>)[key].onClick
 state.account='b'; view.rerender(<BalancesTab />)
 state.account='a'; view.rerender(<BalancesTab />)
 await act(async () => { await oldConfirm({ defaultPrevented:false, preventDefault(){}, stopPropagation(){}, currentTarget:b, target:b }) })
 expect(state.reject).not.toHaveBeenCalled()
})
