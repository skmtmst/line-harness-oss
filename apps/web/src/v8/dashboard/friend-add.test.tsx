// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FriendAddLink } from './friend-add'

const fixture = vi.hoisted(() => ({
  replace: vi.fn(),
  routes: vi.fn(async () => ({ success: true, data: [{ id: 'route-a', name: '広告の経路', refCode: 'ad-a', isActive: true }] })),
}))
vi.mock('@/lib/api', () => ({ api: { entryRoutes: { list: fixture.routes } } }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { channelId: 'channel-a' } }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/use-same-page-url', () => ({ useSamePageUrl: () => ({ replace: fixture.replace }) }))
vi.mock('@/components/dashboard/qr-dialog', () => ({ default: ({ open, initialRouteId }: { open: boolean; initialRouteId: string }) => open ? <div role="dialog" aria-label="QRの見本" data-route-id={initialRouteId} /> : null }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('経路は確定してからURLへ反映し、基本URLへ戻すとQRも基本のまま開く', async () => {
  render(<FriendAddLink officialProfileUrl={null} visualQa={{ friendAddUrl: 'https://example.test/auth/line?account=channel-a' }} canManage />)
  const url = screen.getByRole('textbox', { name: '友だち追加リンク' }) as HTMLInputElement
  expect(url.value).toBe('https://example.test/auth/line?account=channel-a')
  expect(fixture.routes).toHaveBeenCalledWith('account-a')
  const open = () => fireEvent.click(screen.getByRole('button', { name: '発行中の追加URL' }))
  await waitFor(() => expect((screen.getByRole('button', { name: '発行中の追加URL' }) as HTMLButtonElement).disabled).toBe(false))
  open()
  let dialog = await screen.findByRole('dialog', { name: '発行中の追加URLを選ぶ' })
  expect((within(dialog).getByRole('radio', { name: '基本の追加URL' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(within(dialog).getByRole('radio', { name: '広告の経路' }))
  expect(url.value).toContain('/auth/line?account=channel-a')
  fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
  expect(url.value).toContain('/auth/line?account=channel-a')
  open()
  dialog = await screen.findByRole('dialog', { name: '発行中の追加URLを選ぶ' })
  fireEvent.click(within(dialog).getByRole('radio', { name: '広告の経路' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '選ぶ' }))
  expect(url.value).toMatch(/\/r\/ad-a$/)
  open()
  dialog = await screen.findByRole('dialog', { name: '発行中の追加URLを選ぶ' })
  fireEvent.click(within(dialog).getByRole('radio', { name: '基本の追加URL' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '選ぶ' }))
  expect(url.value).toBe('https://example.test/auth/line?account=channel-a')
  fireEvent.click(screen.getByRole('button', { name: 'QRを表示' }))
  expect(fixture.replace).toHaveBeenCalledWith('/?qr=base')
  expect(screen.getByRole('dialog', { name: 'QRの見本' }).getAttribute('data-route-id')).toBe('')
})
