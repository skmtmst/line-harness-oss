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
 * #625: 検索窓に2000文字入れたときのシナリオ一覧。
 *
 * D1 の LIKE パターン50バイト制限で `/api/scenarios?query=` が500になり、
 * 画面が「読み込み中」のまま戻らない事故があった。画面側は次を守る必要がある:
 *   - 長い検索語をそのままサーバーへ渡す
 *   - 0件なら空状態、失敗なら失敗表示＋再読み込みで、無限「読み込み中」にしない
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/scenarios',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, loading: false,
}) }))

const LONG_QUERY = 'とても長い検索語'.repeat(200)

let root: Root
let host: HTMLDivElement
let calls: URL[]
let handler: (url: URL) => Promise<Response> | Response
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})
const scenarioRow = (id: string, name: string) => ({
  id, name, description: null, triggerType: 'friend_add', triggerTagId: null,
  lineAccountId: 'account-a', isActive: true, deliveryMode: 'relative',
  allowConcurrent: true, displayOrder: 0, folderId: null,
  audienceCondition: null, onCompleteMode: 'pause', onCompleteScenarioId: null,
  createdAt: '2026-09-01', updatedAt: '2026-09-01',
  stepCount: 1, subscriberCount: 0, completedCount: 0,
})
const scenarioPage = (items: unknown[], total = items.length) => response({
  success: true, data: { items, total, limit: 50, sort: [] },
})
function base(url: URL) {
  if (url.pathname === '/api/scenarios') return scenarioPage([])
  if (url.pathname === '/api/folders') return response({ success: true, data: [], unfiledCount: 0 })
  // KPI まとめ口は本題と関係ない。失敗として返し「取得できませんでした」の札に倒す。
  if (url.pathname === '/api/list-stats') return response({ success: false, error: 'not needed' })
  return response({ success: true, data: {} })
}
async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
async function eventually(check: () => void, timeout = 2000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}
async function typeQuery(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="シナリオ名で検索"]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  calls = []; handler = base
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
    calls.push(url)
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

test('2000文字の検索語は切り捨てずサーバーへ届き、0件なら空状態が出る', async () => {
  await act(async () => root.render(<ScenariosPage />))
  await settle()
  await typeQuery(LONG_QUERY)

  // debounce(300ms)のあと、検索語をそのまま乗せた一覧取得が出る
  await eventually(() => {
    expect(calls.some((url) => url.pathname === '/api/scenarios'
      && url.searchParams.get('query') === LONG_QUERY)).toBe(true)
  })
  // 0件は障害ではなく空状態。「読み込んでいます」を残さない。
  await eventually(() => {
    expect(host.textContent).toContain('まだシナリオがありません')
  })
  expect(host.querySelector('[data-list-state="loading"]')).toBeNull()
})

test('検索語に一致するシナリオは一覧に出る', async () => {
  handler = (url) => {
    if (url.pathname === '/api/scenarios' && url.searchParams.get('query')) {
      return scenarioPage([scenarioRow('sc-1', '夏のキャンペーン')])
    }
    return base(url)
  }
  await act(async () => root.render(<ScenariosPage />))
  await settle()
  await typeQuery('キャンペーン')
  await eventually(() => expect(host.textContent).toContain('夏のキャンペーン'))
})

test('一覧口が落ちても失敗表示＋再読み込みが出て、無限「読み込み中」にしない', async () => {
  let fail = false
  handler = (url) => {
    if (fail && url.pathname === '/api/scenarios' && url.searchParams.get('query')) {
      return response({ success: false, error: 'server exploded' }, 503)
    }
    return base(url)
  }
  await act(async () => root.render(<ScenariosPage />))
  await settle()

  fail = true
  await typeQuery(LONG_QUERY)

  // 失敗は「読み込んでいます」のままにせず、失敗表示＋再読み込みにする。
  await eventually(() => {
    expect(host.querySelector('[data-list-state="error"]')).toBeTruthy()
  })
  expect(host.textContent).toContain('登録したシナリオは消えていません。')
  expect(host.querySelector('[data-list-state="loading"]')).toBeNull()

  // 再読み込みで同じ検索語のまま取り直せる。
  fail = false
  const retry = [...host.querySelectorAll('button')]
    .find((item) => item.textContent?.trim() === '再読み込み')
  expect(retry).toBeTruthy()
  await act(async () => { retry!.click() })
  await eventually(() => {
    expect(host.querySelector('[data-list-state="error"]')).toBeNull()
    expect(calls.filter((url) => url.pathname === '/api/scenarios'
      && url.searchParams.get('query') === LONG_QUERY).length).toBeGreaterThanOrEqual(2)
  })
})
