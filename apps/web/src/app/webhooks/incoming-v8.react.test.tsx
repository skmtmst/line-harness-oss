// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import WebhooksPage from './page'

/*
 * ★V8-B 外部連携のこちらで受け取る（板 `gW0F2`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい受け取るタブに切り替わり、
 * 見本が決めた受け取り口の列・設定カードが出ることを実DOMで固定する。
 * v7 では従来の受け取るタブが出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/webhooks',
  useSearchParams: () => new URLSearchParams([['tab', 'incoming']]),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, accounts: [], loading: false,
}) }))

let root: Root
let host: HTMLDivElement

const inlet = {
  id: 'in-1',
  name: '申込フォーム',
  sourceType: 'form',
  hasSecret: true,
  isActive: true,
  createdAt: '2026-06-02T00:00:00.000Z',
  updatedAt: '2026-09-30T10:12:00.000Z',
}

const detail = {
  ...inlet,
  version: 1,
  identityMatching: {
    methods: [{ kind: 'verified_email', path: 'email' }],
    onNotFound: 'create_candidate',
  },
  actions: [
    { refKind: 'tag', refId: 'tag-1', refVersionId: null, displayName: 'フォーム申込' },
  ],
  actionExecution: { state: 'connected', reason: null },
  latestSample: null,
  templateFields: [],
  pendingUnmatched: 0,
  previousSecretUsableUntil: null,
}

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
    if (url.includes('/api/staff/me') || url.includes('/staff/me')) {
      return json({ success: true, data: { role: 'owner' } })
    }
    if (url.includes('/api/webhooks/outgoing')) return json({ success: true, data: [] })
    if (url.includes('/api/webhooks/incoming/in-1?')) {
      return json({ success: true, data: detail })
    }
    if (url.includes('/unmatched')) return json({ success: true, data: [], total: 0 })
    if (url.includes('/api/webhooks/incoming')) return json({ success: true, data: [inlet] })
    if (url.includes('/interactions')) {
      return json({ success: true, data: { summary: {
        total: 2146, outgoing: 1734, incoming: 412, succeeded: 2144,
        failed: 2, resultUnknown: 0, outgoingFailed: 2, retryable: 2, averageDurationMs: 400,
      } } })
    }
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

test('v8 では gW0F2 の受け取る画面（受け取り口の列・設定カード）が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="gW0F2"]')
  expect(board).not.toBeNull()
  expect(board?.textContent).toContain('申込フォーム')
  expect(board?.textContent).toContain('どこから受け取るか')
  expect(board?.textContent).toContain('届いたらすること')
  expect(board?.textContent).toContain('届いたつもりで試す')
})

test('v7 では従来の受け取るタブが出て gW0F2 は出ない', async () => {
  await renderPage()
  expect(host.querySelector('[data-design-node="gW0F2"]')).toBeNull()
})
