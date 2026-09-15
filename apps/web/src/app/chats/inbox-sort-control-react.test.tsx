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
  vi.stubGlobal('fetch', (input: string | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/chats') {
      return response({ success: true, data: [
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
      ] })
    }
    if (url.pathname === '/api/support/inbox') {
      return response({ success: true, data: {
        items: [{
          id: 'email:middle', threadId: 'thread-middle', customerName: 'メール中',
          customerIdentifier: 'middle@example.test', subject: '中間', preview: '中間',
          status: 'resolved', assignedStaffId: null, isUnread: false,
          lastIncomingAt: '2026-09-02T00:00:00.000Z', lastMessageAt: '2026-09-02T00:00:00.000Z',
        }],
        summary: { total: 1 },
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

test('並び順は固定表示で、LINEとメールを新しい順に統合する', async () => {
  await act(async () => root.render(<ChatsPage />))

  await eventually(() => {
    expect(host.textContent).toContain('LINE新')
    expect(host.textContent).toContain('メール中')
    expect(host.textContent).toContain('LINE古')
  })

  const list = host.querySelector<HTMLElement>('[data-inbox-v4="conversation-list"]')!
  const sortDescription = list.querySelector<HTMLElement>('[data-inbox-sort="fixed"]')
  expect(sortDescription?.textContent?.trim()).toBe('並び順：新しい順')

  const interactiveSortControls = [...list.querySelectorAll('select, button, [role="combobox"]')]
    .filter((element) => /並び順|新しい順/.test(
      `${element.getAttribute('aria-label') ?? ''}${element.textContent ?? ''}`,
    ))
  expect(interactiveSortControls).toHaveLength(0)

  const rendered = list.textContent ?? ''
  expect(rendered.indexOf('LINE新')).toBeLessThan(rendered.indexOf('メール中'))
  expect(rendered.indexOf('メール中')).toBeLessThan(rendered.indexOf('LINE古'))
})
