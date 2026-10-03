// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import NewWebhookPage from './page'

/*
 * ★V8-B 外部連携の送り先を作る（板 `hsD8e`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい作る画面に切り替わることを
 * 実DOMで固定する。v7 では従来の作る画面が出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/webhooks/new',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, accounts: [], loading: false,
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
    if (url.includes('/api/staff/me') || url.includes('/staff/me')) {
      return json({ success: true, data: { role: 'owner' } })
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
    root.render(<NewWebhookPage />)
  })
  await act(async () => {})
}

test('v8 では hsD8e の作る画面（向き・見本・下の帯）が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="hsD8e"]')
  expect(board).not.toBeNull()
  expect(board?.textContent).toContain('送り先を作る')
  expect(board?.textContent).toContain('こちらから送る')
  expect(board?.textContent).toContain('届く中身の見本')
  expect(board?.textContent).toContain('つくって動かす')
  expect(board?.textContent).toContain('下書きを保存')
})

test('v7 では従来の作る画面が出て hsD8e は出ない', async () => {
  await renderPage()
  expect(host.querySelector('[data-design-node="hsD8e"]')).toBeNull()
})
