// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はfetch差替で止める。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import NewInflowLinkPage from './page'

/*
 * ★V8-B 流入リンクを作る（Pencil `KMaMk`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい作る画面に切り替わり、
 * 見本が決めた見出し・4つの段・右の進む順・下の帯が出ることを
 * 実DOMで固定する。v7 では従来の作る画面が出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/inflow-links/new',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a',
  selectedAccount: { id: 'account-a', name: '公式アカウント' },
  loading: false,
}) }))

let staffRole = 'admin'
vi.mock('@/lib/staff-role', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/staff-role')>()
  return { ...original, useStaffRole: () => staffRole }
})

let root: Root
let host: HTMLDivElement
const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

function handler(url: URL) {
  if (url.pathname === '/api/tags') return response({ success: true, data: [] })
  if (url.pathname === '/api/scenarios') {
    return response({ success: true, data: { items: [], total: 0, limit: 200, sort: [] } })
  }
  if (url.pathname === '/api/message-templates') return response({ success: true, data: [] })
  return response({ success: false, error: 'not mocked', data: null })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
async function eventually(check: () => void, timeout = 5000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

beforeEach(() => {
  staffRole = 'admin'
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return handler(url)
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.documentElement.removeAttribute('data-theme')
  vi.unstubAllGlobals()
})

test('v8 の下では Pencil KMaMk の作る画面に切り替わる', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<NewInflowLinkPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="KMaMk"]')).toBeTruthy()
  })
  expect(host.textContent).toContain('流入リンクを作る')
  expect(host.textContent).toContain('どこに置くリンクですか')
  expect(host.textContent).toContain('どの LINE アカウントに入れますか')
  expect(host.textContent).toContain('友だちになったときにすること')
  expect(host.textContent).toContain('発行される URL')
  expect(host.textContent).toContain('お客さまはこの順に進みます')
  expect(host.textContent).toContain('発行してURLを受け取る')
})

test('v8 で空のまま発行すると入力の直し方が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<NewInflowLinkPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="KMaMk"]')).toBeTruthy()
  })
  const saveButton = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('発行してURLを受け取る'),
  )
  expect(saveButton).toBeTruthy()
  await act(async () => {
    saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
  await eventually(() => {
    expect(host.textContent).toContain('リンク名を入力してください')
  })
})
