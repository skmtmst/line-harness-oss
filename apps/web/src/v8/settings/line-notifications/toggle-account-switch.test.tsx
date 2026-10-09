// @vitest-environment happy-dom
/*
 * 監査 WEB197：出す・止めるの確かめを開いたまま別のアカウントへ移ったら、
 * 前のアカウントのお知らせの確かめを残さない（確定で今のアカウントへ書かない）。
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})
const fx = vi.hoisted(() => ({ account: 'account-a' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/line-notifications',
}))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fx.account, selectedAccount: { id: fx.account, name: fx.account } }) }))
vi.mock('@/components/shell/page-chrome', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shell/page-chrome')>()
  return { ...actual, usePageTitle: () => undefined, usePageCrumbs: () => undefined }
})
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => 'owner' }
})

import Screen from './screen'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
const setting = (label: string) => ({
  eventType: 'ec.order.confirmed', label, isEnabled: true, title: `${label}の見出し`, introText: '', outroText: '', category: 'order',
  buttonLabel: '', buttonUrl: '', imageUrl: '', displayOrder: 1, fixedFields: [], fixedPreview: '', updatedAt: '2026-10-01T00:00:00Z',
})

test('確かめを開いたまま B に移ったら、A の確かめは閉じる', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const account = url.searchParams.get('lineAccountId') ?? url.searchParams.get('account_id') ?? ''
    if (url.pathname === '/api/ec-commerce/settings') return json({ success: true, data: [setting(account === 'account-a' ? 'A の注文' : 'B の注文')] })
    if (url.pathname === '/api/ec-commerce/overview') return json({ success: true, data: { total: 0, processed: 0, identityPending: 0, failed: 0, skipped: 0, last24h: 0, lastReceivedAt: null, byType: [], subscriptions: 0 } })
    if (url.pathname.includes('/operator-rules')) return json({ success: true, data: { items: [], summary: { total: 0, published: 0, stopped: 0, missingRecipients: 0, recipients: 0, acceptedToday: 0, excludedToday: 0 } } })
    return json({ success: true, data: [] })
  })
  const view = render(<Screen />)
  const toggle = await screen.findByRole('switch', { name: 'A の注文のお知らせを出す・止める' })
  await act(async () => { toggle.click() })
  await waitFor(() => expect(screen.getByText(/「A の注文」のお知らせを止めますか/)).toBeTruthy())
  fx.account = 'account-b'
  view.rerender(<Screen />)
  await screen.findByRole('switch', { name: 'B の注文のお知らせを出す・止める' })
  expect(screen.queryByText(/「A の注文」のお知らせを止めますか/)).toBeNull()
})

test('B-139：見出しを空にして保存すると、帯ではなく見出しの欄が赤くなり、真下に理由が出て、そこへ移る', async () => {
  fx.account = 'account-a'
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
  const writes: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if ((init?.method ?? 'GET') !== 'GET') writes.push(url.pathname)
    if (url.pathname === '/api/ec-commerce/settings') return json({ success: true, data: [setting('A の注文')] })
    if (url.pathname === '/api/ec-commerce/overview') return json({ success: true, data: { total: 0, processed: 0, identityPending: 0, failed: 0, skipped: 0, last24h: 0, lastReceivedAt: null, byType: [], subscriptions: 0 } })
    if (url.pathname.includes('/operator-rules')) return json({ success: true, data: { items: [], summary: { total: 0, published: 0, stopped: 0, missingRecipients: 0, recipients: 0, acceptedToday: 0, excludedToday: 0 } } })
    return json({ success: true, data: [] })
  })
  render(<Screen />)
  await screen.findByRole('switch', { name: /のお知らせを出す・止める$/ })
  await act(async () => { (document.querySelector('button[aria-label$="の内容を編集"]') as HTMLButtonElement).click() })
  const title = document.getElementById('cn-title') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, '')
    title.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const save = screen.getAllByRole('button').find((b) => /を保存する$/.test(b.textContent?.trim() ?? ''))!
  await act(async () => { save.click() })
  await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
  expect(writes).toEqual([])
  expect(title.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById('cn-title-error')?.textContent).toBe('通知の見出しを入力してください。')
  expect(document.activeElement).toBe(title)
})
