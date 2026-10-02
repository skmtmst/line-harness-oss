// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はfetch差替で止める。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import ScenariosPage from './page'

/*
 * m23m: 読み込み失敗の配線。一覧口の失敗（403・429）が共通の1枚へ
 * 言い分けられて出ることを、実DOMで固定する。
 * - 403 … 権限の案内になり、押しても直らない再試行の口は出ない
 * - 429 … 待ち秒数（Retry-After）の案内になり、再試行の口は残る
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/scenarios',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, loading: false,
}) }))

let root: Root
let host: HTMLDivElement
let handler: (url: URL) => Promise<Response> | Response
const response = (data: unknown, status = 200, headers?: Record<string, string>) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json', ...(headers ?? {}) } },
)
function base(url: URL) {
  if (url.pathname === '/api/folders') return response({ success: true, data: [], unfiledCount: 0 })
  // KPI まとめ口は本題と関係ない。失敗として返し「取得できませんでした」の札に倒す。
  if (url.pathname === '/api/list-stats') return response({ success: false, error: 'not needed' })
  return response({ success: true, data: {} })
}
async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
async function eventually(check: () => void, timeout = 3000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}
beforeEach(() => {
  handler = base
  const values = new Map<string, string>()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  })
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
  vi.unstubAllGlobals()
})

test('一覧口の403は権限の案内になり再試行の口は出ない', async () => {
  handler = (url) => {
    if (url.pathname === '/api/scenarios') {
      return response({ success: false, error: 'forbidden' }, 403)
    }
    return base(url)
  }
  await act(async () => root.render(<ScenariosPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-list-state="error"]')).toBeTruthy()
  })
  expect(host.textContent).toContain('表示できませんでした')
  expect(host.textContent).toContain('権限')
  expect(host.textContent).not.toContain('API error')
  const retry = [...host.querySelectorAll('button')]
    .find((item) => item.textContent?.trim() === 'もう一度読み込む')
  expect(retry).toBeUndefined()
})

test('一覧口の429は待ち秒数の案内になり再試行の口は残る', async () => {
  handler = (url) => {
    if (url.pathname === '/api/scenarios') {
      return response({ success: false, error: 'rate_limited' }, 429, { 'Retry-After': '30' })
    }
    return base(url)
  }
  await act(async () => root.render(<ScenariosPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-list-state="error"]')).toBeTruthy()
  })
  expect(host.textContent).toContain('表示できませんでした')
  expect(host.textContent).toContain('30秒')
  const retry = [...host.querySelectorAll('button')]
    .find((item) => item.textContent?.trim() === 'もう一度読み込む')
  expect(retry).toBeTruthy()
})
