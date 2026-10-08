// @vitest-environment happy-dom
/*
 * 監査 WEB214/215：統括のアカウント一覧。
 * - 214：「条件を外す」はフォルダの選択も外す（フォルダだけ残って空のまま、にしない）
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const account = {
    id: 'acc-1', revision: 1, channelId: '2000000001', name: '銀座店', displayName: '銀座店', basicId: '@ginza', isActive: true,
    country: null, role: null, displayOrder: 0, archivedAt: null, tags: [], folderId: null,
    stats: { friendCount: 3, activeScenarios: 0, messagesThisMonth: 0, staffCount: 1 }, connection: { status: 'ok', checkedAt: null, tokenExpired: false, issues: [] },
  }
  return {
    ...actual,
    api: {
      ...actual.api,
      lineAccounts: { ...actual.api.lineAccounts, list: vi.fn(async () => ({ success: true, data: [account] })) },
      lineAccountFolders: {
        ...actual.api.lineAccountFolders,
        create: vi.fn(async () => ({ success: true, data: { id: 'f2' } })),
        list: vi.fn(async () => ({ success: true, data: { folders: [{ id: 'f1', kind: 'line_account', name: '関西', parentId: null, color: null, displayOrder: 1, accountCount: 0, createdAt: '', updatedAt: '' }], total: 1, unclassifiedCount: 1 } })),
      },
      tenants: { ...actual.api.tenants, me: vi.fn(async () => ({ success: true, data: { name: '本部' } })) },
    },
  }
})
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq',
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/components/hq/platform-notices', () => ({ default: () => null }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner' }))
const fx = vi.hoisted(() => ({ refreshAccounts: vi.fn(async () => {}) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ setSelectedAccountId: () => {}, refreshAccounts: fx.refreshAccounts }) }))

import HqHomeV8 from './home'
import { api } from '@/lib/api'
afterEach(cleanup)

test('214：「条件を外す」でフォルダの選択も外れ、全部のアカウントに戻る', async () => {
  render(<HqHomeV8 />)
  await screen.findAllByText('銀座店')
  const folderButton = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('関西')) as HTMLButtonElement
  expect(folderButton).toBeTruthy()
  await act(async () => { folderButton.click() })
  await waitFor(() => expect(screen.queryAllByText('銀座店').length).toBe(0))
  const clear = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('条件を外す')) as HTMLButtonElement
  await act(async () => { clear.click() })
  await waitFor(() => expect(screen.getAllByText('銀座店').length).toBeGreaterThan(0))
})

test('215：保存のあとの読み直しが失敗したら知らせ、読み直せる', async () => {
  fx.refreshAccounts.mockRejectedValueOnce(new Error('down'))
  render(<HqHomeV8 />)
  await screen.findAllByText('銀座店')
  const add = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('フォルダを追加')) as HTMLButtonElement
  await act(async () => { add.click() })
  const input = document.querySelector('#hq-account-folder-name') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '九州')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const save = [...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].find((b) => /追加|保存/.test(b.textContent ?? '') && !(b.textContent ?? '').includes('フォルダを追加')) as HTMLButtonElement
  await act(async () => { save.click() })
  await waitFor(() => expect(screen.getByText('保存はできましたが、一覧を読み直せませんでした。')).toBeTruthy())
})


test('アカウントのフォルダは名前の横から色を選び、色なしはnull、選んだ色はそのまま送る', async () => {
  render(<HqHomeV8 />)
  await screen.findAllByText('銀座店')
  fireEvent.click(screen.getByRole('button', { name: 'フォルダを追加' }))
  const input = screen.getByRole('textbox', { name: 'フォルダの名前' })
  const colorButton = screen.getByRole('button', { name: 'フォルダの色：色なし' })
  expect(input.closest('[data-folder-name-color]')!.contains(colorButton)).toBe(true)
  fireEvent.change(input, { target: { value: '九州' } })
  fireEvent.click(colorButton)
  fireEvent.click(screen.getByRole('radio', { name: '赤' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '追加する' })) })
  expect(api.lineAccountFolders.create).toHaveBeenCalledWith({ name: '九州', color: '#ef4444' })
  await waitFor(() => expect(document.querySelector('#hq-account-folder-name')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'フォルダを追加' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'フォルダの名前' }), { target: { value: '沖縄' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '追加する' })) })
  expect(api.lineAccountFolders.create).toHaveBeenCalledWith({ name: '沖縄', color: null })
})
