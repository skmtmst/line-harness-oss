// @vitest-environment happy-dom
/*
 * 監査 WEB232：「下書きを保存」で作れたのに止められなかったら、一覧へ移らずに知らせ、
 * もう一度押すと止めるところだけやり直す（同じ送り先をもう1つ作らない）。
 */
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})
const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/webhooks/new',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '本店' }, accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => 'owner' }
})

import WebhooksCreateV8 from './create'
afterEach(() => { cleanup(); vi.unstubAllGlobals(); nav.push.mockReset() })

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

test('止められなかったら知らせて残り、もう一度押すと止めるだけやり直す', async () => {
  const calls: string[] = []
  let puts = 0
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method !== 'GET') calls.push(`${method} ${new URL(url).pathname}`)
    if (method === 'POST' && url.includes('/api/webhooks/outgoing')) return json({ success: true, data: { id: 'wh-1', secret: 'x' } })
    if (method === 'PUT' && url.includes('/api/webhooks/outgoing/wh-1')) {
      puts += 1
      return puts === 1 ? json({ success: false, error: 'down' }, 500) : json({ success: true, data: { id: 'wh-1' } })
    }
    if (url.includes('/api/staff/me')) return json({ success: true, data: { role: 'owner' } })
    return json({ success: true, data: [] })
  })
  render(<WebhooksCreateV8 />)
  fireEvent.change(document.querySelector('#wh-new-name')!, { target: { value: '予約台帳' } })
  fireEvent.change(document.querySelector('#wh-new-url')!, { target: { value: 'https://example.com/hook' } })
  fireEvent.change(document.querySelector('#wh-new-secret')!, { target: { value: 'x'.repeat(40) } })
  fireEvent.click(document.querySelector('input[name="wh-new-mode"][value="all"]')!)
  await act(async () => { screen.getByRole('button', { name: '下書きを保存' }).click() })
  await waitFor(() => expect(screen.getByText(/まだ止められていません/)).toBeTruthy())
  expect(nav.push).not.toHaveBeenCalled()
  await act(async () => { screen.getByRole('button', { name: '下書きを保存' }).click() })
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/webhooks'))
  expect(calls.filter((call) => call.startsWith('POST /api/webhooks/outgoing'))).toHaveLength(1)
  expect(puts).toBe(2)
})
