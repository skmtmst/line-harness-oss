// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はfetch差替で止める。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import EventsListPage from './page'

/*
 * #625: 検索窓に2000文字入れたときのイベント予約一覧。
 *
 * D1 の LIKE パターン50バイト制限で `/api/events/admin/events` が
 * 500になる事故があった。画面側は次を守る必要がある:
 *   - 長い検索語をそのままサーバーへ渡す
 *   - 0件なら空状態、失敗なら失敗表示＋再読み込みで、無限「読み込み中」にしない
 */

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string | null }))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: fixture.accountId, selectedAccount: null, loading: false,
}) }))

const LONG_QUERY = 'a'.repeat(2000)

let root: Root
let host: HTMLDivElement
let calls: URL[]
let handler: (url: URL) => Promise<Response> | Response
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})
const eventRow = (id: string, name: string) => ({
  id, name, venue_name: null, next_slot_starts_at: null,
  total_capacity: null, total_active: 0, pending_count: 0,
  visible_tag_id: null, visible_tag_name: null, is_published: 1,
})
function base(url: URL) {
  if (url.pathname === '/api/events/admin/events') {
    return response({ items: [], total: 0, limit: 20, sort: [] })
  }
  return response({ success: true, data: [] })
}
async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
async function eventually(check: () => void, timeout = 1500) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}
async function typeQuery(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="イベント名で検索"]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  calls = []; handler = base
  fixture.accountId = 'account-a'
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
  await act(async () => root.render(<EventsListPage />))
  await settle()
  await typeQuery(LONG_QUERY)

  await eventually(() => {
    expect(calls.some((url) => url.pathname === '/api/events/admin/events'
      && url.searchParams.get('q') === LONG_QUERY)).toBe(true)
  })
  await eventually(() => {
    expect(host.textContent).toContain('条件に合うイベントはありません')
  })
  expect(host.textContent).not.toContain('読み込み中')
})

test('検索語に一致するイベントは一覧に出る', async () => {
  handler = (url) => {
    if (url.pathname === '/api/events/admin/events') {
      const q = url.searchParams.get('q')
      return response({
        items: q ? [eventRow('ev-1', '夏祭り説明会')] : [],
        total: q ? 1 : 0,
        limit: 20,
        sort: [],
      })
    }
    return base(url)
  }
  await act(async () => root.render(<EventsListPage />))
  await settle()
  await typeQuery('説明会')
  await eventually(() => expect(host.textContent).toContain('夏祭り説明会'))
})

test('一覧口が落ちても失敗表示＋再読み込みが出て、無限「読み込み中」にしない', async () => {
  let fail = false
  handler = (url) => {
    if (fail && url.pathname === '/api/events/admin/events' && url.searchParams.get('q')) {
      return response({ error: 'server exploded' }, 503)
    }
    return base(url)
  }
  await act(async () => root.render(<EventsListPage />))
  await settle()

  fail = true
  await typeQuery(LONG_QUERY)

  await eventually(() => {
    expect(host.textContent).toContain('登録したイベントは消えていません。')
  })
  expect(host.textContent).not.toContain('読み込み中')
  const retry = [...host.querySelectorAll('button')]
    .find((item) => item.textContent?.trim() === 'イベントを再読み込み')
  expect(retry).toBeTruthy()

  // 再読み込みで同じ検索語のまま取り直せる。
  fail = false
  await act(async () => { retry!.click() })
  await eventually(() => {
    expect(host.textContent).toContain('条件に合うイベントはありません')
    expect(calls.filter((url) => url.pathname === '/api/events/admin/events'
      && url.searchParams.get('q') === LONG_QUERY).length).toBeGreaterThanOrEqual(2)
  })
})
