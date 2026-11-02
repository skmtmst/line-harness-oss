// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
const net = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/line-accounts-cache', () => ({ loadLineAccounts: vi.fn(async () => ({ success: true, data: [{ id: 'account', name: '本店' }] })) }))
vi.mock('@/lib/api', async original => {
 const actual = await original<typeof import('@/lib/api')>()
 return { ...actual, api: { ...actual.api, analytics: { ...actual.api.analytics,
  saved: { ...actual.api.analytics.saved, list: async () => ({ success: true, data: [] }) },
  reportSchedules: { ...actual.api.analytics.reportSchedules, list: net.list, setStatus: net.status },
 } } }
})
import Saved from './saved'
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('しまう窓を開くだけで一覧の読取失敗と再読込の口を消さず、しまうの409は窓内だけで示す', async () => {
 const schedule = { id: 'schedule', name: '週のまとめ', status: 'active', savedAnalysisIds: [], cadence: 'weekly', nextRunAt: null, updatedAt: '2026-10-01T00:00:00Z' }
 net.list.mockResolvedValueOnce({ success: true, data: { items: [schedule], recentOneTime: [] } }).mockRejectedValue(new TypeError('read failed'))
 net.status.mockResolvedValueOnce({ success: false, error: '別の人が先に変更しています。' }).mockRejectedValue(new ApiError(409, 'ほかの人が先に変更しました。'))
 render(<Saved accountId="account" canManage />)
 const menu = await screen.findByRole('button', { name: '定期レポート「週のまとめ」の操作' })
 fireEvent.click(menu)
 await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '止める' })) })
 const loadFailure = await screen.findByText('定期レポートを確認できませんでした')
 const reload = screen.getByRole('button', { name: 'もう一度確認' })
 fireEvent.click(screen.getByRole('button', { name: '定期レポート「週のまとめ」の操作' }))
 fireEvent.click(screen.getByRole('menuitem', { name: 'しまう' }))
 const dialog = await screen.findByRole('alertdialog', { name: '定期レポートをしまいますか' })
 expect(await within(dialog).findByText('本店')).toBeTruthy()
 expect(within(dialog).getByText('環境')).toBeTruthy()
 expect(loadFailure.isConnected).toBe(true); expect(reload.isConnected).toBe(true)
 expect(within(dialog).queryByRole('alert')).toBeNull()
 await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'しまう' })) })
 expect(within(dialog).getByRole('alert').textContent).toContain('ほかの人')
 const retry = within(dialog).getByRole('button', { name: 'もう一度' })
 expect(retry.hasAttribute('disabled')).toBe(true); fireEvent.click(retry)
 expect(net.status).toHaveBeenCalledTimes(2)
 expect(loadFailure.isConnected).toBe(true)
})

it('アカウント切替後には古い確認ボタンを保持しても操作しない', async () => {
 const schedule = { id: 'schedule', name: '週のまとめ', status: 'active', savedAnalysisIds: [], cadence: 'weekly', nextRunAt: null, updatedAt: '2026-10-01T00:00:00Z' }
 net.list.mockResolvedValue({ success: true, data: { items: [schedule], recentOneTime: [] } })
 const view = render(<Saved accountId="account" canManage />)
 fireEvent.click(await screen.findByRole('button', { name: '定期レポート「週のまとめ」の操作' }))
 fireEvent.click(screen.getByRole('menuitem', { name: 'しまう' }))
 const button = within(await screen.findByRole('alertdialog', { name: '定期レポートをしまいますか' })).getByRole('button', { name: 'しまう' })
 const key = Object.keys(button).find(item => item.startsWith('__reactProps$'))!
 const handler = (button as unknown as Record<string, { onClick: (event: unknown) => unknown }>)[key].onClick
 view.rerender(<Saved accountId="other" canManage />)
 await act(async () => { await handler({ defaultPrevented: false, preventDefault() {}, stopPropagation() {}, currentTarget: button, target: button }) })
 expect(net.status).not.toHaveBeenCalled()
})

it('画面を離れた後には古い確認ボタンを保持しても操作しない', async () => {
 const schedule = { id: 'schedule', name: '週のまとめ', status: 'active', savedAnalysisIds: [], cadence: 'weekly', nextRunAt: null, updatedAt: '2026-10-01T00:00:00Z' }
 net.list.mockResolvedValue({ success: true, data: { items: [schedule], recentOneTime: [] } })
 const view = render(<Saved accountId="account" canManage />)
 fireEvent.click(await screen.findByRole('button', { name: '定期レポート「週のまとめ」の操作' }))
 fireEvent.click(screen.getByRole('menuitem', { name: 'しまう' }))
 const button = within(await screen.findByRole('alertdialog', { name: '定期レポートをしまいますか' })).getByRole('button', { name: 'しまう' })
 const key = Object.keys(button).find(item => item.startsWith('__reactProps$'))!
 const handler = (button as unknown as Record<string, { onClick: (event: unknown) => unknown }>)[key].onClick
 view.unmount()
 await act(async () => { await handler({ defaultPrevented: false, preventDefault() {}, stopPropagation() {}, currentTarget: button, target: button }) })
 expect(net.status).not.toHaveBeenCalled()
})
