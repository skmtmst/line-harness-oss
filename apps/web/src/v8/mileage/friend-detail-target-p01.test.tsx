// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ account: 'a', entryAccount: 'a' as string | null, confirm: vi.fn(), voidEntry: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/mileage/friend', useSearchParams: () => new URLSearchParams('id=f1') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.account, loading: false }) }))
vi.mock('@/lib/line-accounts-cache', () => ({ loadLineAccounts: async () => ({ success: true, data: [{ id: 'a', name: '店A' }, { id: 'other', name: '店B' }] }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/lib/api', async original => {
 const actual = await original<typeof import('@/lib/api')>()
 const item = { id: 'e1', entryType: 'grant', status: 'pending', amount: 10, reason: '来店', source: 'rule', hasSourceEvent: false, sourceReferenceId: null, ruleName: null, mode: 'automatic', executedByStaffName: null, lineAccountId: 'a', notificationStatus: null, notificationErrorCode: null, balanceAfter: 10, occurredAt: '2026-10-01T00:00:00Z', displayName: '田中' }
 return { ...actual, api: { ...actual.api, friends: { ...actual.api.friends, get: async () => ({ success: true, data: { id: 'f1', displayName: '田中', createdAt: '2026-01-01T00:00:00Z' } }), mileage: async () => ({ success: true, data: { summary: { available: 0, pending: 10, lifetimeEarned: 10, spent: 0 }, history: [], insights: null } }) }, mileage: { ...actual.api.mileage, friendsV6: async () => ({ success: true, data: { balanceSource: 'musubo', items: [] } }), history: async () => ({ success: true, data: { items: [{ ...item, lineAccountId: state.entryAccount }], summary: { byType: [] }, pagination: { total: 1, limit: 100, offset: 0 } } }), confirmMileageEntry: state.confirm, voidMileageEntry: state.voidEntry } } }
})
import FriendDetail from './friend-detail'
beforeEach(() => { state.account = 'a'; state.entryAccount = 'a' })
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('マイル明細の確定窓に対象を出し、切替後は古い確認を実行できない', async () => {
 const view = render(<FriendDetail />)
 const menu = await screen.findByRole('button', { name: /操作/ })
 fireEvent.click(menu)
 fireEvent.click(await screen.findByRole('menuitem', { name: '確定する' }))
 const dialog = await screen.findByRole('dialog')
 expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
 expect(within(dialog).getByText('環境')).toBeTruthy()
 fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '確認した理由' } })
 const button = within(dialog).getByRole('button', { name: /この理由で確定する/ })
 const key = Object.keys(button).find(k => k.startsWith('__reactProps$'))!
 const old = (button as unknown as Record<string, { onClick: (e: unknown) => unknown }>)[key].onClick
 state.account = 'b'; view.rerender(<FriendDetail />)
 state.account = 'a'; view.rerender(<FriendDetail />)
 await act(async () => { await old({ defaultPrevented: false, preventDefault() {}, stopPropagation() {}, currentTarget: button, target: button }) })
 expect(state.confirm).not.toHaveBeenCalled()
})

it('明細のアカウントを実行先に使う', async () => {
 state.entryAccount = 'other'
 state.confirm.mockResolvedValue({ success: false, error: 'test' })
 render(<FriendDetail />)
 fireEvent.click(await screen.findByRole('button', { name: /操作/ }))
 fireEvent.click(await screen.findByRole('menuitem', { name: '確定する' }))
 const dialog = await screen.findByRole('dialog')
 expect(await within(dialog).findByText('店B')).toBeTruthy()
 expect(within(dialog).getByText('10 マイル')).toBeTruthy()
 fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '確認した理由' } })
 fireEvent.click(within(dialog).getByRole('button', { name: /この理由で確定する/ }))
 expect(state.confirm).toHaveBeenCalledWith('e1', { accountId: 'other', reason: '確認した理由' })
})

it('取消しも明細の所属アカウントに送る', async () => {
 state.entryAccount = 'other'
 state.voidEntry.mockResolvedValue({ success: false, error: 'test' })
 render(<FriendDetail />)
 fireEvent.click(await screen.findByRole('button', { name: /操作/ }))
 fireEvent.click(await screen.findByRole('menuitem', { name: '取消す' }))
 const dialog = await screen.findByRole('alertdialog')
 expect(await within(dialog).findByText('店B')).toBeTruthy()
 fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '取消の理由' } })
 fireEvent.click(within(dialog).getByRole('button', { name: /この理由で取消す/ }))
 expect(state.voidEntry).toHaveBeenCalledWith('e1', { accountId: 'other', reason: '取消の理由' })
})

it('明細のアカウントが不明なら選択中のアカウントを代用しない', async () => {
 state.entryAccount = null
 render(<FriendDetail />)
 fireEvent.click(await screen.findByRole('button', { name: /操作/ }))
 fireEvent.click(await screen.findByRole('menuitem', { name: '確定する' }))
 const dialog = await screen.findByRole('dialog')
 fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '確認した理由' } })
 fireEvent.click(within(dialog).getByRole('button', { name: /この理由で確定する/ }))
 expect(state.confirm).not.toHaveBeenCalled()
 expect(within(dialog).getByText('名前を確認できません')).toBeTruthy()
})
