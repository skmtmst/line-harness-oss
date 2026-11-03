// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import RemindersList from './list'

const net = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn(), folders: vi.fn(), stats: vi.fn(), hold: false, account: 'account-a' }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, fetchApi: net.read, api: { ...actual.api,
    reminders: { ...actual.api.reminders, update: net.update },
    folders: { ...actual.api.folders, list: net.folders }, listStats: { get: net.stats },
  } }
})
vi.mock('@/lib/undoable', async original => {
  const actual = await original<typeof import('@/lib/undoable')>()
  const { scheduledConfirmation } = await import('@/test-utils/confirmed-undo-test-handle')
  return { ...actual, runUndoable: (options: Parameters<typeof actual.runUndoable>[0] & { confirmation?: boolean }) => {
    if (!options.confirmation) return actual.runUndoable(options)
    const scheduled = scheduledConfirmation(options)
    if (!net.hold) void Promise.resolve().then(() => scheduled.execute()).catch(() => {})
    return scheduled.handle
  } }
})
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: net.account, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), useSearchParams: () => new URLSearchParams(''), usePathname: () => '/reminders' }))
const rows = ['r1', 'r2'].map((id, index) => ({ id, name: `お知らせ${index + 1}`, isActive: true, lifecycleStatus: 'published', folderId: null, stepCount: 1, displayOrder: index, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', plannedDeliveries: 1 }))
beforeEach(() => {
  vi.clearAllMocks(); net.hold = false; net.account = 'account-a'; verifiedStaffRole('owner')
  window.history.replaceState(null, '', '/reminders')
  net.read.mockResolvedValue({ success: true, data: { items: rows, total: 2, limit: 20, sort: [] } })
  net.folders.mockResolvedValue({ success: true, data: [{ id: 'folder-a', name: '確認用' }], unfiledCount: 2 })
  net.stats.mockResolvedValue({ success: true, data: { reminders: { total: 2, active: 2, waiting: 2, sentThisMonth: 0, failed: 0 } } })
  net.update.mockResolvedValue({ success: true, data: {} })
})
afterEach(() => { cleanup(); verifiedStaffRole(null) })

async function openMove() {
  render(<RemindersList />)
  const first = await screen.findByText('お知らせ1')
  const checks = rows.map(row => within(screen.getByText(row.name).closest('tr')!).getByRole('checkbox'))
  checks.forEach(check => fireEvent.click(check))
  fireEvent.click(screen.getByRole('button', { name: 'フォルダへ移す', exact: true }))
  const dialog = await screen.findByRole('dialog')
  const destination = within(dialog).getByRole('button', { name: '移動先のフォルダ' })
  await act(async () => { fireEvent.click(destination) })
  await act(async () => { fireEvent.click(within(screen.getByRole('option', { name: '確認用', exact: true })).getByRole('button')) })
  expect(within(dialog).getByRole('button', { name: '移動先のフォルダ' }).textContent).toBe('確認用')
  expect(net.update).not.toHaveBeenCalled()
  return { dialog, checks, first }
}

it('移動の失敗は窓に具体的な理由を出し、移動先と選択を保ち、保存済みを除いて未完了だけ再試行する', async () => {
  net.update.mockResolvedValueOnce({ success: true, data: {} }).mockRejectedValueOnce(new Error('通信できませんでした。'))
  const { dialog, checks } = await openMove()
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '移動する' })) })
  expect((await within(dialog).findByRole('alert')).textContent).toMatch(/全 2 件中 1 件の保存を確認しました。2 件目で止めました。未送信は 0 件です。理由：/)
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(within(dialog).getByRole('button', { name: '移動先のフォルダ' }).textContent).toBe('確認用')
  checks.forEach(check => expect(check).toHaveProperty('checked', true))
  expect(net.update.mock.calls.map(([id]) => id)).toEqual(['r1', 'r2'])
  await act(async () => { const retry = within(dialog).getByRole('button', { name: 'もう一度' }); fireEvent.click(retry); fireEvent.click(retry) })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(net.update.mock.calls).toEqual([['r1', { folderId: 'folder-a' }], ['r2', { folderId: 'folder-a' }], ['r2', { folderId: 'folder-a' }]])
})

it('窓の中で元に戻すと送信0で閉じ、選んだ行を残す', async () => {
  net.hold = true
  const { dialog, checks } = await openMove()
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '移動する' })) })
  fireEvent.click(await within(dialog).findByRole('button', { name: '元に戻す' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(net.update).not.toHaveBeenCalled()
  checks.forEach(check => expect(check).toHaveProperty('checked', true))
})

vi.mock('@/lib/admin-version-cache', () => ({ loadAdminVersionDetail: async () => ({ version: '2.7.0', deploy_env: 'staging' }) }))
vi.mock('@/lib/line-accounts-cache', () => ({ loadLineAccounts: async () => ({ success: true, data: [{ id: 'account-a', name: '本店' }, { id: 'account-b', name: '二号店' }] }) }))

it('一括停止の窓は操作先を示し、アカウント切替で閉じて古い対象を送らない', async () => {
  const view = render(<RemindersList />)
  await screen.findByText('お知らせ1')
  rows.forEach(row => fireEvent.click(within(screen.getByText(row.name).closest('tr')!).getByRole('checkbox')))
  fireEvent.click(screen.getByRole('button', { name: '止める', exact: true }))
  const dialog = await screen.findByRole('dialog', { name: '2件のリマインダを停止しますか？' })
  await within(within(dialog).getByRole('region', { name: '操作の対象' })).findByText('本店')
  expect(net.update).not.toHaveBeenCalled()
  net.account = 'account-b'
  view.rerender(<RemindersList />)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(net.update).not.toHaveBeenCalled()
})

it('一件の停止窓は所属不明と環境を示し、切替後の古い確認を断る', async () => {
  const view = render(<RemindersList />)
  await screen.findByText('お知らせ1')
  fireEvent.click(screen.getByRole('button', { name: 'リマインダ「お知らせ1」の操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '一時停止する' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
  expect(within(dialog).getByText('不明')).toBeTruthy()
  expect(within(dialog).getByText('環境')).toBeTruthy()
  const button = within(dialog).getByRole('button', { name: '一時停止する' })
  const key = Object.keys(button).find(k => k.startsWith('__reactProps$'))!
  const old = (button as unknown as Record<string, { onClick: () => void }>)[key].onClick
  net.account = 'account-b'; view.rerender(<RemindersList />)
  net.account = 'account-a'; view.rerender(<RemindersList />)
  await act(async () => old())
  expect(net.update).not.toHaveBeenCalled()
})
it('確認した一件のリマインダを停止する', async () => {
  render(<RemindersList />)
  await screen.findByText('お知らせ1')
  fireEvent.click(screen.getByRole('button', { name: 'リマインダ「お知らせ1」の操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '一時停止する' }))
  const dialog = await screen.findByRole('dialog')
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '一時停止する' })) })
  expect(net.update).toHaveBeenCalledWith('r1', { isActive: false })
})
