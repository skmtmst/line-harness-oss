// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ChatsPage from './page'

/*
 * N-030: LINE一覧の取得に失敗したとき「もう一度お試しください」とだけ
 * 出ていて、直す手段がページ全体の再読み込みしかなかった。
 * 失敗した一覧の場所に再読み込みボタンを出し、同じ条件で取り直せる
 * ことを、本物の ChatsPage + 本物の api.ts + 握り潰した fetch で確かめる。
 */

const fixture = vi.hoisted(() => ({ accountId: 'account-a', params: new URLSearchParams() }))
vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => fixture.params,
  usePathname: () => '/chats',
  useRouter: () => ({ push() {}, replace() {} }),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: fixture.accountId, selectedAccount: null, loading: false,
}) }))

let root: Root
let host: HTMLDivElement
let calls: URL[]
let handler: (url: URL) => Promise<Response> | Response
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})
const linePayload = (names: string[] = []) => ({ success: true, data: names.map((name) => ({
  id: `chat-${name}`, friendId: `friend-${name}`, friendName: name, operatorId: 'operator-a',
  status: 'unread', isUnread: true, lastMessageAt: '2026-09-01T00:00:00.000Z',
  lastMessageContent: name, lastMessageType: 'text', lastMessageDirection: 'incoming',
})) })
function base(url: URL) {
  if (url.pathname === '/api/chats') return response(linePayload())
  if (url.pathname === '/api/support/inbox') return response({ success: true, data: { items: [], summary: { total: 0 } } })
  if (url.pathname === '/api/operators') return response({ success: true, data: [{ id: 'operator-a', name: '担当A' }] })
  if (url.pathname === '/api/chats/stats') return response({ success: true, data: {
    total: 0, unread: 0, assigneeUnread: [], waiting: 0, waitingOverAnHour: 0,
  } })
  return response({ success: true, data: [] })
}
const list = () => host.querySelector<HTMLElement>('[data-inbox-v4="conversation-list"]')!
const retryButton = () => [...host.querySelectorAll('button')]
  .find((item) => item.textContent?.trim() === '会話を読み込み直す')
async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
async function eventually(check: () => void, timeout = 1000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}
beforeEach(() => {
  calls = []; handler = base
  fixture.accountId = 'account-a'; fixture.params = new URLSearchParams()
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

test('LINE一覧の失敗は一覧の中に再読み込みボタンつきで出る', async () => {
  handler = (url) => url.pathname === '/api/chats'
    ? response({ success: false, error: 'server exploded' }, 503)
    : base(url)
  await act(async () => root.render(<ChatsPage />))
  await settle()
  await eventually(() => expect(retryButton()).toBeTruthy())
  expect(list().textContent).toContain('チャットの読み込みに失敗しました。')
  // APIの内部文言はそのまま出さない
  expect(list().textContent).not.toContain('server exploded')
  // 0件表示に化けない
  expect(list().querySelector('[data-inbox-list-state="empty"]')).toBeNull()
})

test('再読み込みボタンで同じ条件の一覧を取り直し、成功したら失敗行が消える', async () => {
  let fail = true
  handler = (url) => {
    if (url.pathname === '/api/chats') {
      return fail ? response({ success: false }, 503) : response(linePayload(['田中']))
    }
    return base(url)
  }
  await act(async () => root.render(<ChatsPage />))
  await settle()
  await eventually(() => expect(retryButton()).toBeTruthy())
  expect(list().textContent).not.toContain('田中')

  fail = false
  await act(async () => { retryButton()!.click() })
  await settle()
  await eventually(() => expect(list().textContent).toContain('田中'))
  expect(retryButton()).toBeUndefined()
  expect(list().textContent).not.toContain('チャットの読み込みに失敗しました。')
  // 取り直しのリクエストが実際に出ている
  expect(calls.filter((url) => url.pathname === '/api/chats').length).toBeGreaterThanOrEqual(2)
})

test('メールだけ見ている画面ではLINE一覧の失敗行を出さない', async () => {
  fixture.params = new URLSearchParams('channel=email')
  handler = (url) => url.pathname === '/api/chats'
    ? response({ success: false }, 503)
    : base(url)
  await act(async () => root.render(<ChatsPage />))
  await settle()
  await eventually(() => expect(
    list().querySelector('[data-inbox-list-state="empty"], [data-inbox-list-state="filtered-empty"], [role="alert"]'),
  ).toBeTruthy())
  expect(retryButton()).toBeUndefined()
  expect(list().textContent).not.toContain('チャットの読み込みに失敗しました。')
})
