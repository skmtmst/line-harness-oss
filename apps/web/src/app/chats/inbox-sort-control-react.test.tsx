// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ChatsPage from './page'

const fixture = vi.hoisted(() => ({ params: new URLSearchParams(), chatQueries: [] as URLSearchParams[] }))

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

beforeEach(() => {
  fixture.params = new URLSearchParams()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  })
  fixture.chatQueries = []
  vi.stubGlobal('fetch', (input: string | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/chats') {
      fixture.chatQueries.push(url.searchParams)
      // 既定の口は「未読が先・新しい順」、sort=latest は新しい順だけで返す。画面はこの順のまま混ぜる。
      const rows = [
        {
          id: 'chat-unread-old', friendId: 'friend-unread-old', friendName: 'LINE未読古', operatorId: null,
          status: 'resolved', isUnread: true, lastMessageAt: '2026-08-30T00:00:00.000Z',
          lastMessageContent: '古いが未読', lastMessageType: 'text', lastMessageDirection: 'incoming',
        },
        {
          id: 'chat-new', friendId: 'friend-new', friendName: 'LINE新', operatorId: null,
          status: 'resolved', isUnread: false, lastMessageAt: '2026-09-03T00:00:00.000Z',
          lastMessageContent: '最新', lastMessageType: 'text', lastMessageDirection: 'incoming',
        },
        {
          id: 'chat-old', friendId: 'friend-old', friendName: 'LINE古', operatorId: null,
          status: 'resolved', isUnread: false, lastMessageAt: '2026-09-01T00:00:00.000Z',
          lastMessageContent: '最古', lastMessageType: 'text', lastMessageDirection: 'incoming',
        },
      ]
      const data = url.searchParams.get('sort') === 'latest'
        ? [...rows].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
        : rows
      return response({ success: true, data })
    }
    if (url.pathname === '/api/support/inbox') {
      return response({ success: true, data: {
        // メールの口は並びの指定を持たず、未読が先で返す。
        items: [{
          id: 'email:unread-old', threadId: 'thread-unread-old', customerName: 'メール未読古',
          customerIdentifier: 'old@example.test', subject: '古い未読', preview: '古い未読',
          status: 'resolved', assignedStaffId: null, isUnread: true,
          lastIncomingAt: '2026-08-29T00:00:00.000Z', lastMessageAt: '2026-08-29T00:00:00.000Z',
        }, {
          id: 'email:middle', threadId: 'thread-middle', customerName: 'メール中',
          customerIdentifier: 'middle@example.test', subject: '中間', preview: '中間',
          status: 'resolved', assignedStaffId: null, isUnread: false,
          lastIncomingAt: '2026-09-02T00:00:00.000Z', lastMessageAt: '2026-09-02T00:00:00.000Z',
        }],
        summary: { total: 2 },
      } })
    }
    if (url.pathname === '/api/operators') return response({ success: true, data: [] })
    if (url.pathname === '/api/chats/stats') {
      return response({ success: true, data: {
        total: 3, unread: 0, assigneeUnread: [], waiting: 0, waitingOverAnHour: 0,
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

async function renderList() {
  await act(async () => root.render(<ChatsPage />))
  await eventually(() => {
    expect(host.textContent).toContain('LINE新')
    expect(host.textContent).toContain('メール中')
    expect(host.textContent).toContain('LINE古')
    expect(host.textContent).toContain('LINE未読古')
    expect(host.textContent).toContain('メール未読古')
  })
  return host.querySelector<HTMLElement>('[data-inbox-v4="conversation-list"]')!
}

const order = (list: HTMLElement) => {
  const rendered = list.textContent ?? ''
  return ['LINE未読古', 'メール未読古', 'LINE新', 'メール中', 'LINE古'].sort((a, b) => rendered.indexOf(a) - rendered.indexOf(b))
}

test('既定は未読が先・新しい順で、LINEとメールを統合する。口へは並びを送らない', async () => {
  const list = await renderList()
  const control = list.querySelector<HTMLButtonElement>('[data-inbox-sort="choice"] button[aria-label="並び順"]')
  expect(control?.textContent).toContain('未読が先・新しい順')
  // 古いが未読の行が、新しい既読より先に来る。既読同士は新しい順。
  expect(order(list)).toEqual(['LINE未読古', 'メール未読古', 'LINE新', 'メール中', 'LINE古'])
  expect(fixture.chatQueries.every((query) => !query.has('sort'))).toBe(true)
})

test('「新しい順」を選ぶと URL の ?sort=latest に残す（ほかの指定は残す）', async () => {
  fixture.params = new URLSearchParams('from=dashboard')
  const replace = vi.spyOn(window.history, 'replaceState')
  const list = await renderList()
  const control = list.querySelector<HTMLButtonElement>('[data-inbox-sort="choice"] button[aria-label="並び順"]')!
  await act(async () => { control.click() })
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"] button')].find((button) => button.textContent?.trim() === '新しい順')
  expect(option).toBeTruthy()
  await act(async () => { option!.click() })
  const url = String(replace.mock.calls.at(-1)?.[2] ?? '')
  expect(new URL(url, 'http://localhost').searchParams.get('sort')).toBe('latest')
  expect(new URL(url, 'http://localhost').searchParams.get('from')).toBe('dashboard')
})

test('?sort=latest では未読を先にせず、LINEとメールを時刻だけで混ぜる。口へ sort=latest を送る', async () => {
  fixture.params = new URLSearchParams('sort=latest')
  const list = await renderList()
  expect(list.querySelector('[data-inbox-sort="choice"] button[aria-label="並び順"]')?.textContent).toContain('新しい順')
  expect(order(list)).toEqual(['LINE新', 'メール中', 'LINE古', 'LINE未読古', 'メール未読古'])
  expect(fixture.chatQueries.length).toBeGreaterThan(0)
  expect(fixture.chatQueries.every((query) => query.get('sort') === 'latest' && !query.has('beforeUnread'))).toBe(true)
})
