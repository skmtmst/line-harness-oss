// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import WebhooksPage from './page'

/*
 * ★V8-B 外部連携の見本（板 `SAUCs`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい見本タブに切り替わり、
 * 節の名付けがタブ名（こちらで受け取る・こちらから送る）とそろい、
 * 受け取る5＋送る4の見本カードが出ることを実DOMで固定する。
 * v7 では従来の見本タブが出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/webhooks',
  useSearchParams: () => new URLSearchParams([['tab', 'notify']]),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a',
  selectedAccount: { name: 'NEN-TEST' },
  accounts: [],
  loading: false,
}) }))

let root: Root
let host: HTMLDivElement

const json = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/webhooks/outgoing')) return json({ success: true, data: [] })
    if (url.includes('/api/webhooks/incoming')) return json({ success: true, data: [] })
    if (url.includes('/api/webhooks/interactions')) {
      return json({ success: true, data: { summary: {
        total: 0, outgoing: 0, incoming: 0, succeeded: 0,
        failed: 0, resultUnknown: 0, outgoingFailed: 0, retryable: 0, averageDurationMs: null,
      } } })
    }
    if (url.includes('/api/staff/me')) return json({ success: true, data: { role: 'owner' } })
    return json({ success: false, error: 'not found' }, 404)
  })
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
})

async function renderPage() {
  await act(async () => {
    root.render(<WebhooksPage />)
  })
  await act(async () => {})
}

test('v8 では SAUCs の見本カードがタブ名とそろって出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="SAUCs"]')
  expect(board).not.toBeNull()
  expect(board?.textContent).toContain('こちらで受け取る（どこから来るか）')
  expect(board?.textContent).not.toContain('受け取る見本')
  expect(board?.textContent).toContain('こちらから送る（いつ・何を送るか）')
  expect(board?.textContent).not.toContain('送る見本')
  expect(board?.textContent).toContain('LINE公式アカウント')
  expect(board?.textContent).toContain('決済サービス')
  expect(board?.textContent).toContain('友だちが追加されたとき')
  expect(board?.textContent).toContain('注文が確定したとき')
  expect(board?.textContent).toContain('friend_add')
  expect(board?.textContent).toContain('見本に書いたことだけを送ります')
})

test('v7 では従来の見本タブが出て SAUCs は出ない', async () => {
  await renderPage()
  expect(host.querySelector('[data-design-node="SAUCs"]')).toBeNull()
  expect(host.textContent).toContain('受け取る見本')
})
