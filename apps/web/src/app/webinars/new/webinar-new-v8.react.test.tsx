// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import NewWebinarPage from './page'

/*
 * ★V8-B ウェビナー①基本設定（作る）（板 `j7PP04`）の契約。
 * V8 の作る画面に統一し、
 * 5段の帯・開催形式・見え方・下の帯が出ることを実DOMで固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/webinars/new',
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
    if (url.includes('/folders')) return json({ success: true, data: [] })
    return json({ data: null }, 404)
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
    root.render(<NewWebinarPage />)
  })
  await act(async () => {})
}

test('v8 では j7PP04 の作る画面（5段の帯・開催形式・見え方）が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="j7PP04"]')
  expect(board).not.toBeNull()
  expect(board?.textContent).toContain('ウェビナーを作る')
  expect(board?.textContent).toContain('基本設定')
  expect(board?.textContent).toContain('オンデマンド配信')
  expect(board?.textContent).toContain('日時指定配信')
  expect(board?.textContent).toContain('LINE での見え方')
  expect(board?.textContent).toContain('動画の設定へ')
})
