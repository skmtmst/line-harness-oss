// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
const net = vi.hoisted(() => ({ list: vi.fn(), stop: vi.fn() }))
vi.mock('@/lib/api/helpers/gap1', () => ({ lineSenderApi: { list: net.list, deactivate: net.stop } }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
import Senders from './senders-card'
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('送り手の409は窓で再送を止め、取消で読み直し、最新の版を確認してから送る', async () => {
 const sender = { id: 'sender', name: '確認用の送り手', status: 'active', visibility: 'all', version: 3, iconUrl: null }
 net.list.mockResolvedValueOnce({ success: true, data: [sender] }).mockResolvedValue({ success: true, data: [{ ...sender, version: 4 }] })
 net.stop.mockRejectedValueOnce(new ApiError(409, '変更されています。')).mockResolvedValue({ success: true })
 render(<Senders accountId="account" accountName="確認の店" />)
 const open = async () => { fireEvent.click(await screen.findByRole('button', { name: '送り手「確認用の送り手」の操作' })); fireEvent.click(screen.getByRole('menuitem', { name: '使わない' })); return screen.findByRole('alertdialog', { name: '「確認用の送り手」を使わなくしますか？' }) }
 const dialog = await open()
 await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '使わない' })) })
 expect(within(dialog).getByRole('alert').textContent).toContain('閉じて最新')
 const retry = within(dialog).getByRole('button', { name: 'もう一度' }); expect(retry.hasAttribute('disabled')).toBe(true)
 fireEvent.click(retry); expect(net.stop).toHaveBeenCalledTimes(1)
 fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
 await waitFor(() => expect(net.list).toHaveBeenCalledTimes(2))
 const fresh = await open()
 await act(async () => { const submit = within(fresh).getByRole('button', { name: '使わない' }); fireEvent.click(submit); fireEvent.click(submit) })
 expect(net.stop.mock.calls).toEqual([['account', 'sender', 3], ['account', 'sender', 4]])
 await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
})
it('送り手を止める確認に対象を出し、アカウント切替後の古い窓を閉じる', async () => {
 net.list.mockResolvedValue({ success: true, data: [{ id: 'sender', name: '確認用の送り手', status: 'active', visibility: 'all', version: 3 }] })
 const view = render(<Senders accountId="account" accountName="確認の店" />)
 fireEvent.click(await screen.findByRole('button', { name: '送り手「確認用の送り手」の操作' }))
 fireEvent.click(screen.getByRole('menuitem', { name: '使わない' }))
 const dialog = await screen.findByRole('alertdialog')
 expect(dialog.textContent).toContain('LINEアカウント'); expect(dialog.textContent).toContain('確認の店'); expect(dialog.textContent).toContain('環境')
 view.rerender(<Senders accountId="other" accountName="別の店" />)
 await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
 view.rerender(<Senders accountId="account" accountName="確認の店" />)
 expect(screen.queryByRole('alertdialog')).toBeNull(); expect(net.stop).not.toHaveBeenCalled()
})
