// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ChatsPage from './page'

const fixture = vi.hoisted(() => ({ params: new URLSearchParams() }))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => fixture.params,
  usePathname: () => '/chats',
  useRouter: () => ({ push() {}, replace() {} }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-a',
    selectedAccount: null,
    loading: false,
  }),
}))

const response = (data: unknown) => new Response(JSON.stringify(data), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
})

const lineChats = [
  {
    id: 'chat-a', friendId: 'friend-a', friendName: 'A未対応', operatorId: null,
    status: 'unread', isUnread: true, lastMessageAt: '2026-09-03T00:00:00.000Z',
    lastMessageContent: '返事待ち', lastMessageType: 'text', lastMessageDirection: 'incoming',
  },
  {
    id: 'chat-b', friendId: 'friend-b', friendName: 'B対応中', operatorId: null,
    status: 'in_progress', isUnread: false, lastMessageAt: '2026-09-02T00:00:00.000Z',
    lastMessageContent: '対応している', lastMessageType: 'text', lastMessageDirection: 'incoming',
  },
  {
    id: 'chat-c', friendId: 'friend-c', friendName: 'C対応済み', operatorId: null,
    status: 'resolved', isUnread: false, lastMessageAt: '2026-09-01T00:00:00.000Z',
    lastMessageContent: '終わり', lastMessageType: 'text', lastMessageDirection: 'incoming',
  },
]

let root: Root
let host: HTMLDivElement

async function eventually(check: () => void, timeout = 1000) {
  const started = Date.now()
  while (true) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

function radios() {
  const group = host.querySelector<HTMLElement>('[role="radiogroup"][aria-label="対応状況で絞り込む"]')!
  const items = [...group.querySelectorAll<HTMLElement>('[role="radio"]')]
  return { group, items }
}

beforeEach(() => {
  fixture.params = new URLSearchParams()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  })
  vi.stubGlobal('fetch', (input: string | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/chats') {
      // 口側の絞り込みの代わり。状態の指定があればその状態だけ返す。
      const status = url.searchParams.get('status')
      const data = status ? lineChats.filter((chat) => chat.status === status) : lineChats
      return response({ success: true, data })
    }
    if (url.pathname === '/api/support/inbox') {
      return response({ success: true, data: { items: [], summary: { total: 0 } } })
    }
    if (url.pathname === '/api/operators') return response({ success: true, data: [] })
    if (url.pathname === '/api/chats/quick-counts') {
      const status = url.searchParams.get('status')
      const n = status ? lineChats.filter((chat) => chat.status === status).length : lineChats.length
      const c = { all: n, reply: 0, overdue: 0 }
      return response({ success: true, data: { ...c, line: c, email: c } })
    }
    if (url.pathname === '/api/chats/stats') {
      return response({ success: true, data: {
        total: 3, unread: 1, assigneeUnread: [], waiting: 0, waitingOverAnHour: 0,
      } })
    }
    return response({ success: true, data: [] })
  })

  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('状態の切り替えは5つが1行で、選んだ所だけが選ばれている', async () => {
  await act(async () => root.render(<ChatsPage />))
  await eventually(() => expect(host.textContent).toContain('A未対応'))

  const { group, items } = radios()
  expect(items.map((item) => item.textContent?.trim())).toEqual(
    ['すべて', '未対応', '対応中', '保留', '対応済み'],
  )
  // 左の欄の最小の幅でも2行に落ちない。折り返しの指定は無い。
  expect(group.className).toContain('flex-nowrap')
  expect(group.className).not.toContain('flex-wrap')
  for (const item of items) {
    expect(item.className).toContain('flex-1')
    expect(item.className).toContain('whitespace-nowrap')
  }
  // 最初は「すべて」。選んでいる所だけ Tab で止まる。
  expect(items[0].getAttribute('aria-checked')).toBe('true')
  expect(items.slice(1).map((item) => item.getAttribute('aria-checked'))).toEqual(
    ['false', 'false', 'false', 'false'],
  )
  expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1, -1, -1])
})

test('押すと絞り込みが変わる。これまでの動きのまま', async () => {
  await act(async () => root.render(<ChatsPage />))
  await eventually(() => expect(host.textContent).toContain('A未対応'))

  const { items } = radios()
  await act(async () => items[2].dispatchEvent(new MouseEvent('click', { bubbles: true })))

  await eventually(() => {
    expect(host.textContent).toContain('B対応中')
    expect(host.textContent).not.toContain('A未対応')
    expect(host.textContent).not.toContain('C対応済み')
  })
  const { items: after } = radios()
  expect(after[2].getAttribute('aria-checked')).toBe('true')
})

test('左右のキーで選ぶ所が動く', async () => {
  await act(async () => root.render(<ChatsPage />))
  await eventually(() => expect(host.textContent).toContain('A未対応'))

  const { items } = radios()
  items[0].focus()
  await act(async () => {
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })

  await eventually(() => {
    const { items: after } = radios()
    expect(after[1].getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(after[1])
  })
  // キーで選んだら絞り込みも動く。
  await eventually(() => {
    expect(host.textContent).toContain('A未対応')
    expect(host.textContent).not.toContain('B対応中')
  })
})

/* ★V8（M0393 XqSvX「状態」）：「すべて」の所は無く、4つに件数。選んだ所をもう一度押すとすべてに戻る。 */
test('V8：4つに件数が付き、選んだ所をもう一度押すと絞り込みが外れる', async () => {
  document.documentElement.dataset.theme = 'v8'
  try {
    await act(async () => root.render(<ChatsPage />))
    await eventually(() => expect(host.textContent).toContain('A未対応'))
    await eventually(() => {
      const { items } = radios()
      expect(items.map((item) => item.textContent?.trim())).toEqual(['未対応1', '対応中1', '保留0', '対応済み1'])
    })
    const { items } = radios()
    // 何も選んでいない（すべて）ときは先頭に Tab で入れる。
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1, -1])
    await act(async () => items[1].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await eventually(() => {
      expect(host.textContent).not.toContain('A未対応')
      expect(radios().items[1].getAttribute('aria-checked')).toBe('true')
    })
    await act(async () => radios().items[1].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await eventually(() => {
      expect(host.textContent).toContain('A未対応')
      expect(host.textContent).toContain('C対応済み')
      expect(radios().items.every((item) => item.getAttribute('aria-checked') === 'false')).toBe(true)
    })
  } finally {
    delete document.documentElement.dataset.theme
  }
})
