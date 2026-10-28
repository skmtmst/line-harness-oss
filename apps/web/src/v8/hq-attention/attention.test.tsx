// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  push: vi.fn(),
  select: vi.fn(),
  toast: vi.fn(),
  attention: vi.fn(),
  accounts: [{ id: 'account-a', name: '本店' }],
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fixture.push }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ accounts: fixture.accounts, selectedAccountId: null, setSelectedAccountId: fixture.select }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: fixture.toast }))
vi.mock('@/lib/api/helpers/styles', () => ({ hqStyleApi: { attention: fixture.attention } }))
vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  api: { lineAccountFolders: { list: async () => ({ success: true, data: { folders: [] } }) } },
}))

import AttentionPage from '@/app/hq/attention/page'

beforeEach(() => {
  fixture.push.mockReset()
  fixture.select.mockReset()
  fixture.toast.mockReset()
  fixture.attention.mockResolvedValue({ success: true, data: { items: [{
    accountId: 'account-a', name: '本店', counts: { connections: 1, unhandledChats: 2 }, details: {},
  }] } })
})
afterEach(cleanup)

it.each([
  ['LINE の接続', '/accounts'],
  ['本店の未対応のトーク 2件を開く', '/chats?status=unread'],
])('%sから個別画面を開くと切り替え先を知らせる', async (name, href) => {
  render(<AttentionPage />)
  const action = await screen.findByRole('button', { name })
  fireEvent.click(action)
  await waitFor(() => expect(fixture.push).toHaveBeenCalledWith(href))
  expect(fixture.select).toHaveBeenCalledWith('account-a')
  expect(fixture.toast).toHaveBeenCalledWith('本店 に切り替えました', { tone: 'info' })
})

it('アカウントの詳細を見るだけなら切り替えも通知もしない', async () => {
  render(<AttentionPage />)
  fireEvent.click(await screen.findByRole('button', { name: '本店' }))
  expect(fixture.push).toHaveBeenCalledWith('/accounts/detail?id=account-a')
  expect(fixture.select).not.toHaveBeenCalled()
  expect(fixture.toast).not.toHaveBeenCalled()
})
