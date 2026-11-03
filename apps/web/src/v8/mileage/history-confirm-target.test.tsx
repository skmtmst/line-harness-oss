// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ account: 'a', status: 'pending', confirm: vi.fn(), voidEntry: vi.fn() }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.account, loading: false }) }))
vi.mock('./frame', async original => ({ ...await original<typeof import('./frame')>(), useMileageShell: () => ({ readonly: false, narrow: false }) }))
vi.mock('@/lib/api', async original => {
 const actual = await original<typeof import('@/lib/api')>()
 const item = () => ({ id: 'h1', primaryFriendId: 'friend-1', displayName: '田中', pictureUrl: null, entryType: 'grant', status: state.status, amount: 100, reason: '来店', source: 'manual', hasSourceEvent: false, sourceReferenceId: null, ruleName: null, mode: 'manual', executedByStaffName: '店長', lineAccountName: '店舗', balanceAfter: 100, occurredAt: '2026-10-01T00:00:00.000Z' })
 return { ...actual, api: { ...actual.api, mileage: { ...actual.api.mileage, history: async () => ({ success: true, data: { items: [item()], summary: { byType: [] }, pagination: { total: 1, limit: 20, offset: 0 } } }), confirmMileageEntry: state.confirm, voidMileageEntry: state.voidEntry } } }
})
import HistoryTab from './history'
beforeEach(() => { state.account = 'a'; state.status = 'pending' })
afterEach(() => { cleanup(); vi.resetAllMocks() })
async function open(kind: 'confirm' | 'void') {
 if (kind === 'void') state.status = 'available'
 fireEvent.click(await screen.findByRole('button', { name: kind === 'confirm' ? '確定する' : '取り消す' }))
 return screen.findByRole(kind === 'void' ? 'alertdialog' : 'dialog')
}
it.each(['confirm', 'void'] as const)('%s の確認に操作先を表示する', async kind => {
 state.status = kind === 'void' ? 'available' : 'pending'
 render(<HistoryTab />)
 const dialog = await open(kind)
 expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
 expect(within(dialog).getByText('環境')).toBeTruthy()
})
it.each(['confirm', 'void'] as const)('%s は切替後の古い確定を送らない', async kind => {
 state.status = kind === 'void' ? 'available' : 'pending'
 const view = render(<HistoryTab />)
 const dialog = await open(kind)
 fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '人工の理由' } })
 const b = within(dialog).getByRole('button', { name: kind === 'confirm' ? '確定する' : '取り消す' })
 const key = Object.keys(b).find(item => item.startsWith('__reactProps$'))!
 const oldConfirm = (b as unknown as Record<string,{onClick:(e:unknown)=>unknown}>)[key].onClick
 state.account='b'; view.rerender(<HistoryTab />)
 state.account='a'; view.rerender(<HistoryTab />)
 await act(async () => { await oldConfirm({ defaultPrevented:false, preventDefault(){}, stopPropagation(){}, currentTarget:b, target:b }) })
 expect(state.confirm).not.toHaveBeenCalled();expect(state.voidEntry).not.toHaveBeenCalled()
})
