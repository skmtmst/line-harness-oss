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

async function openFilters() {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="絞り込み"]')!.click()
  })
}

async function pickStatus(label: string) {
  await openFilters()
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="対応状況で絞り込む"]')!.click()
  })
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((el) => el.textContent === label)!
  await act(async () => { option.querySelector('button')!.click() })
}

function threads() {
  return [...host.querySelectorAll('li')]
    .map((li) => li.textContent ?? '')
    .filter((text) => /未対応|対応中|対応済み/.test(text))
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

test('パネルで選ぶと絞り込みが変わる。これまでの動きのまま', async () => {
  await act(async () => root.render(<ChatsPage />))
  await eventually(() => expect(host.textContent).toContain('A未対応'))

  await pickStatus('対応中')

  await eventually(() => {
    expect(host.textContent).toContain('B対応中')
    expect(host.textContent).not.toContain('A未対応')
    expect(host.textContent).not.toContain('C対応済み')
  })
  // パネルを開き直しても選択が残る。
  await openFilters()
  expect(document.querySelector('button[aria-label="対応状況で絞り込む"]')?.textContent).toContain('対応中')
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="対応状況で絞り込む"]')!.click() })
  const selected = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === '対応中')!
  expect(selected.getAttribute('aria-selected')).toBe('true')
  expect(selected.className).not.toMatch(/bg-accent-deep|text-on-accent/)
  const others = [...document.querySelectorAll<HTMLElement>('[role="option"]')].filter(option => option !== selected)
  expect(others.every(option => option.getAttribute('aria-selected') === 'false')).toBe(true)
})

test('「すべて」に戻すと絞り込みが外れる', async () => {
  await act(async () => root.render(<ChatsPage />))
  await eventually(() => expect(host.textContent).toContain('A未対応'))

  await pickStatus('未対応')
  await eventually(() => expect(host.textContent).not.toContain('B対応中'))

  await pickStatus('すべて')
  await eventually(() => {
    expect(host.textContent).toContain('A未対応')
    expect(host.textContent).toContain('C対応済み')
  })
})

/* 一覧の上の段はクイックと名前の検索の2段だけ。状態・担当者は「絞り込み」のパネルにまとめる。 */
test('一覧の上に状態と担当者の段を置かない', async () => {
  await act(async () => root.render(<ChatsPage />))
  await eventually(() => expect(host.textContent).toContain('A未対応'))
  expect(host.querySelector('[role="radiogroup"][aria-label="対応状況で絞り込む"]')).toBeNull()
  expect(host.querySelector('button[aria-label="担当者で絞り込む"]')).toBeNull()
  // クイックと検索は残る。
  expect(host.querySelector('[aria-label="受信箱のクイック絞り込み"]')).not.toBeNull()
  expect(host.querySelector('input[aria-label="名前・メールアドレス・内容で検索"]')).not.toBeNull()
})
