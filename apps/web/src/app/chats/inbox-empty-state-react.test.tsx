// @vitest-environment happy-dom
import React, { act } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ChatsPage from './page'

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

type Pending = { resolve: (value: Response) => void }
let root: Root
let host: HTMLDivElement
let calls: URL[]
let handler: (url: URL) => Promise<Response> | Response
let pending: Pending[]
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})
const linePayload = (names: string[] = []) => ({ success: true, data: names.map((name) => ({
  id: `chat-${name}`, friendId: `friend-${name}`, friendName: name, operatorId: 'operator-a',
  status: 'unread', isUnread: true, lastMessageAt: '2026-09-01T00:00:00.000Z',
  lastMessageContent: name, lastMessageType: 'text', lastMessageDirection: 'incoming',
})) })
const emailPayload = (names: string[] = []) => ({ success: true, data: {
  items: names.map((name) => ({
    id: `email:${name}`, threadId: `thread-${name}`, customerName: name,
    customerIdentifier: `${name}@example.test`, subject: name, preview: name,
    status: 'unread', assignedStaffId: 'operator-a', isUnread: true,
    lastIncomingAt: '2026-09-01T00:00:00.000Z', lastMessageAt: '2026-09-01T00:00:00.000Z',
  })), summary: { total: names.length },
} })
function base(url: URL) {
  if (url.pathname === '/api/chats') return response(linePayload())
  if (url.pathname === '/api/support/inbox') return response(emailPayload())
  if (url.pathname === '/api/operators') return response({ success: true, data: [{ id: 'operator-a', name: '担当A' }] })
  if (url.pathname === '/api/chats/stats') return response({ success: true, data: {
    total: 0, unread: 0, assigneeUnread: [], waiting: 0, waitingOverAnHour: 0,
  } })
  return response({ success: true, data: [] })
}
function hold() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  pending.push({ resolve })
  return { promise, resolve }
}
const list = () => host.querySelector<HTMLElement>('[data-inbox-v4="conversation-list"]')!
const state = (kind: string) => list().querySelector(`[data-inbox-list-state="${kind}"]`)
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
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith(label))
  expect(button, label).toBeTruthy()
  await act(async () => { button!.click() })
}
const isFilteredRequest = (url: URL) => Boolean(
  url.searchParams.get('q')
    || (url.searchParams.get('status') && url.searchParams.get('status') !== 'all')
    || url.searchParams.get('operatorId')
    || url.searchParams.get('assignee')
    || url.searchParams.get('unreadOnly')
    || url.searchParams.get('quickFilter'),
)
async function renderWithRowsUnlessFiltered() {
  handler = (url) => {
    if (url.pathname === '/api/chats') return response(linePayload(isFilteredRequest(url) ? [] : ['通常の会話']))
    if (url.pathname === '/api/support/inbox') return response(emailPayload())
    return base(url)
  }
  await act(async () => root.render(<ChatsPage />))
}
async function applySingleFilter(kind: 'search' | 'status' | 'quick' | 'assignee' | 'unread') {
  if (kind === 'search') {
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('[aria-label="名前・メールアドレス・内容で検索"]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '該当なし')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await eventually(() => expect(
      calls.filter((url) => url.pathname === '/api/chats').at(-1)?.searchParams.get('q'),
    ).toBe('該当なし'))
    return
  }
  if (kind === 'status') { await click('未対応'); return }
  if (kind === 'quick') { await click('期限超過'); return }
  await click('絞り込み')
  if (kind === 'assignee') {
    await act(async () => {
      const select = host.querySelector<HTMLSelectElement>('[aria-label="担当者で絞り込む（パネル）"]')!
      select.value = 'operator-a'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    return
  }
  await act(async () => { host.querySelector<HTMLInputElement>('[aria-label="未読だけ表示"]')!.click() })
}
beforeEach(() => {
  calls = []; pending = []; handler = base
  fixture.accountId = 'account-a'; fixture.params = new URLSearchParams()
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  vi.stubGlobal('fetch', (input: string | URL) => {
    const url = new URL(String(input), 'http://localhost')
    calls.push(url)
    return handler(url)
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => {
    for (const item of pending) item.resolve(response({ success: false }, 503))
    await Promise.resolve()
  })
  await act(async () => root.unmount())
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

test('all は双方の取得完了後だけ通常0件を一覧内に表示する', async () => {
  const email = hold()
  handler = (url) => url.pathname === '/api/support/inbox' ? email.promise : base(url)
  await act(async () => root.render(<ChatsPage />))
  expect(state('loading')).toBeTruthy()
  expect(list().textContent).not.toContain('まだ会話がありません')
  await act(async () => { email.resolve(response(emailPayload())) })
  expect(state('empty')).toBeTruthy()
  expect(list().textContent).toContain('まだ会話がありません')
})

test('片側に会話があれば、もう片側の待機や障害を0件と表示しない', async () => {
  handler = (url) => {
    if (url.pathname === '/api/chats') return response(linePayload(['田中']))
    if (url.pathname === '/api/support/inbox') return response({ success: false }, 503)
    return base(url)
  }
  await act(async () => root.render(<ChatsPage />))
  await settle()
  expect(list().textContent).toContain('田中')
  expect(state('empty')).toBeNull()
  expect(state('filtered-empty')).toBeNull()
})

test('障害時は0件と断定しない', async () => {
  handler = (url) => url.pathname === '/api/support/inbox'
    ? response({ success: false }, 503)
    : base(url)
  await act(async () => root.render(<ChatsPage />))
  await settle()
  expect(list().textContent).toContain('メールの読み込みに失敗しました。')
  expect(state('empty')).toBeNull()
})

test('LINE一覧の障害時も0件と断定しない', async () => {
  handler = (url) => url.pathname === '/api/chats'
    ? response({ success: false }, 503)
    : base(url)
  await act(async () => root.render(<ChatsPage />))
  await settle()
  expect(host.textContent).toContain('チャットの読み込みに失敗しました。')
  expect(state('empty')).toBeNull()
})

test('line 選択時はメールの待機や障害から独立して通常0件を表示する', async () => {
  fixture.params = new URLSearchParams('channel=line')
  const email = hold()
  handler = (url) => url.pathname === '/api/support/inbox' ? email.promise : base(url)
  await act(async () => root.render(<ChatsPage />))
  await settle()
  expect(state('empty')).toBeTruthy()
  expect(list().textContent).not.toContain('メールの読み込みに失敗しました。')
})

test('line 選択時はメールが失敗しても通常0件を表示する', async () => {
  fixture.params = new URLSearchParams('channel=line')
  handler = (url) => url.pathname === '/api/support/inbox'
    ? response({ success: false }, 503)
    : base(url)
  await act(async () => root.render(<ChatsPage />))
  await settle()
  expect(state('empty')).toBeTruthy()
  expect(list().textContent).not.toContain('メールの読み込みに失敗しました。')
})

test.each([
  ['検索', 'search'],
  ['状態', 'status'],
  ['期限', 'quick'],
  ['担当', 'assignee'],
  ['未読', 'unread'],
] as const)('%s条件だけで0件なら条件用空状態にする', async (_label, kind) => {
  await renderWithRowsUnlessFiltered()
  expect(list().textContent).toContain('通常の会話')
  await applySingleFilter(kind)
  await eventually(() => expect(state('filtered-empty')).toBeTruthy())
  expect(state('empty')).toBeNull()
})

test('条件変更の描画から新条件取得開始まで旧0件を空状態として出さない', async () => {
  await act(async () => root.render(<ChatsPage />))
  expect(state('empty')).toBeTruthy()
  const next = hold()
  handler = (url) => isFilteredRequest(url) ? next.promise.then((value) => value.clone()) : base(url)
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === '未対応')!
  act(() => {
    flushSync(() => button.click())
    expect(state('loading')).toBeTruthy()
    expect(state('filtered-empty')).toBeNull()
  })
})

test('条件解除の描画から再取得開始まで旧0件を通常0件として出さない', async () => {
  handler = (url) => {
    if (url.pathname === '/api/chats') return response(linePayload())
    if (url.pathname === '/api/support/inbox') return response(emailPayload())
    return base(url)
  }
  await act(async () => root.render(<ChatsPage />))
  await click('未対応')
  await eventually(() => expect(state('filtered-empty')).toBeTruthy())

  const next = hold()
  handler = (url) => isFilteredRequest(url) ? base(url) : next.promise.then((value) => value.clone())
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === '絞り込みを解除')!
  act(() => {
    flushSync(() => button.click())
    expect(state('loading')).toBeTruthy()
    expect(state('empty')).toBeNull()
  })
})

test('全条件の結果0件を区別し、解除後に会話を戻す', async () => {
  const filtered = (url: URL) => ['q', 'status', 'operatorId', 'assignee', 'unreadOnly', 'quickFilter']
    .some((key) => url.searchParams.has(key))
  handler = (url) => {
    if (url.pathname === '/api/chats') return response(linePayload(filtered(url) ? [] : ['戻った会話']))
    if (url.pathname === '/api/support/inbox') return response(emailPayload())
    return base(url)
  }
  await act(async () => root.render(<ChatsPage />))

  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('[aria-label="名前・メールアドレス・内容で検索"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '見つからない')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await eventually(() => {
    const searchCall = calls.filter((url) => url.pathname === '/api/chats').at(-1)!
    expect(searchCall.searchParams.get('q')).toBe('見つからない')
  })
  await click('未対応')
  await click('絞り込み')
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('[aria-label="担当者で絞り込む（パネル）"]')!
    select.value = 'operator-a'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await eventually(() => {
    const assigneeCall = calls.filter((url) => url.pathname === '/api/chats').at(-1)!
    expect(assigneeCall.searchParams.get('operatorId')).toBe('operator-a')
  })
  await click('期限超過')
  await act(async () => { host.querySelector<HTMLInputElement>('[aria-label="未読だけ表示"]')!.click() })

  await eventually(() => expect(state('filtered-empty')).toBeTruthy())
  expect(list().textContent).toContain('条件に一致する会話がありません')
  expect(list().contains(state('filtered-empty'))).toBe(true)
  await click('絞り込みを解除')
  await eventually(() => expect(list().textContent).toContain('戻った会話'))

  const line = calls.filter((url) => url.pathname === '/api/chats').at(-1)!
  const email = calls.filter((url) => url.pathname === '/api/support/inbox').at(-1)!
  for (const key of ['q', 'status', 'operatorId', 'assignee', 'unreadOnly', 'quickFilter']) {
    expect(line.searchParams.has(key), `line:${key}`).toBe(false)
    if (key === 'status') expect(email.searchParams.get(key), 'email:status').toBe('all')
    else expect(email.searchParams.has(key), `email:${key}`).toBe(false)
  }
})
