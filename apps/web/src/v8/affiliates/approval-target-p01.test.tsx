// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ account: null as string | null, send: vi.fn() }))
vi.mock('./frame', async original => ({ ...await original<typeof import('./frame')>(), useAffiliateShell: () => ({ readonly: false, narrow: false, accountId: state.account, setCount: vi.fn() }) }))
vi.mock('@/lib/api', async original => { const actual = await original<typeof import('@/lib/api')>(); return { ...actual, api: { ...actual.api, conversionApprovals: { ...actual.api.conversionApprovals, holdDays: async () => ({ success: true, data: {} }), bulkDecide: state.send }, affiliates: { ...actual.api.affiliates, list: async () => ({ success: true, data: [] }) } } } })
vi.mock('./display', async original => ({ ...await original<typeof import('./display')>(), listAllConversionApprovals: async (status: string) => ({ items: status === 'pending' ? [{ eventId: 'e1', friendName: 'お客様', affiliateName: '紹介者', offerName: '案件', lineAccountId: 'shop-b', lineAccountName: '店B', createdAt: '2026-10-01T00:00:00Z', approvalStatus: 'pending' }] : [], truncated: false }) }))
import ApprovalsTab from './approvals'
afterEach(() => { cleanup(); state.account = null; state.send.mockReset() })
it('成果を却下する窓に実際のアカウントと環境を出し、切替後の古い確認を断る', async () => {
 const view = render(<ApprovalsTab />)
 fireEvent.click(await screen.findByRole('button', { name: 'お客様の成果の操作' }))
 fireEvent.click(await screen.findByRole('menuitem', { name: '認めない（却下）' }))
 const dialog = await screen.findByRole('alertdialog')
 expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
 expect(within(dialog).getByText('店B')).toBeTruthy()
 expect(within(dialog).getByText('環境')).toBeTruthy()
 const button = within(dialog).getByRole('button', { name: '認めない（却下）' })
 const key = Object.keys(button).find(k => k.startsWith('__reactProps$'))!
 const old = (button as unknown as Record<string, { onClick: () => void }>)[key].onClick
 state.account='shop-a'; view.rerender(<ApprovalsTab />)
 state.account=null; view.rerender(<ApprovalsTab />)
 old()
 expect(state.send).not.toHaveBeenCalled()
})
it('確認した成果だけを却下する', async () => {
 state.send.mockResolvedValue({ success: true, data: { succeeded: ['e1'], conflicted: [], denied: [], failed: [] } })
 render(<ApprovalsTab />)
 fireEvent.click(await screen.findByRole('button', { name: 'お客様の成果の操作' }))
 fireEvent.click(await screen.findByRole('menuitem', { name: '認めない（却下）' }))
 const dialog = await screen.findByRole('alertdialog')
 expect(within(dialog).getByText('店B')).toBeTruthy()
 fireEvent.click(within(dialog).getByRole('button', { name: '認めない（却下）' }))
 expect(state.send).toHaveBeenCalledWith([{ id: 'e1', status: 'rejected', expectedStatus: 'pending' }])
})
