// @vitest-environment happy-dom
/*
 * N-022: 画像と本文が両方あるときは結合送信口を1回だけ呼ぶ。
 *
 * 実物の ChatsPage をマウントして操作する。通信だけ差し替える。
 *   - 画像添付＋本文入力→送信で POST send-combined が1本出ること
 *   - 旧来の POST send が0本であること（部分送信の経路を通らない）
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import ChatsPage from './page'

const fixture = vi.hoisted(() => ({
  accountId: 'acc-1' as string,
  params: new URLSearchParams(),
}))

const net = vi.hoisted(() => ({
  calls: [] as string[],
}))

vi.mock('next/link', () => ({ default: () => null }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => fixture.params,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/chats',
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: fixture.accountId,
    selectedAccount: { id: 'acc-1', name: '本店' },
    loading: false,
  }),
}))

function chatRow() {
  return {
    id: 'chat-1', friendId: 'fr-1', friendName: '利用者1', friendRealName: null,
    friendPictureUrl: null, lineAccountId: 'acc-1', lineAccountName: '本店',
    operatorId: null, operatorName: null, status: 'unread', notes: null,
    isUnread: true, unreadCount: 1, revision: 1,
    lastMessageAt: '2026-09-01T00:00:00.000Z', lastMessageContent: 'こんにちは',
    lastMessageDirection: 'incoming', lastMessageType: 'text',
    createdAt: '2026-09-01T00:00:00.000Z',
  }
}

function chatDetail() {
  return {
    id: 'chat-1', friendId: 'fr-1', friendName: '利用者1', friendRealName: null,
    friendPictureUrl: null, operatorId: null, status: 'unread', notes: null,
    revision: 1, lastMessageAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z', messages: [],
    hasMoreMessages: false,
  }
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    const method = (init?.method ?? 'GET').toUpperCase()
    net.calls.push(`${method} ${path.split('?')[0]}`)
    let body: unknown = { success: true, data: [] }
    if (path.startsWith('/api/chats/stats')) {
      body = { success: true, data: { total: 1, unread: 1, inProgress: 0, onHold: 0, resolved: 0, oldestUnansweredMinutes: null, assigneeUnread: [] } }
    } else if (path.startsWith('/api/chats?')) {
      body = { success: true, data: [chatRow()] }
    } else if (path === '/api/chats/chat-1' || path.startsWith('/api/chats/chat-1?')) {
      body = { success: true, data: chatDetail() }
    } else if (path === '/api/chats/chat-1/read') {
      body = { success: true, data: { isUnread: false } }
    } else if (path.startsWith('/api/inbox/saved-views')) {
      body = { success: true, data: [] }
    } else if (path.startsWith('/api/support/inbox')) {
      body = { success: true, data: { items: [] } }
    } else if (path.startsWith('/api/operators')) {
      body = { success: true, data: [] }
    } else if (path.startsWith('/api/images')) {
      body = { success: true, data: { id: 'img-1', key: 'k', url: 'https://cdn.test/o.jpg', mimeType: 'image/jpeg', size: 100 } }
    } else if (path === '/api/chats/chat-1/send-combined') {
      body = { success: true, data: { sent: true, messageId: 'k', messageIds: ['k:0', 'k:1'], sentByStaffName: '担当', revision: 2 } }
    } else if (path.match(/^\/api\/friends\/([^/?]+)(\?|$)/)) {
      body = { success: true, data: null }
    } else if (/\/mileage(\?|$)/.test(path)) {
      body = { success: true, data: { summary: { programId: 'p', programName: 'M', available: 0, pending: 0, lifetimeEarned: 0, spent: 0 }, history: [] } }
    } else if (/\/rich-menu(\?|$)/.test(path)) {
      body = { success: true, data: { id: null, name: null, isDefault: false } }
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  net.calls.length = 0
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
  } as Storage)
  installFetch()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('画像＋本文の結合送信', () => {
  it('send-combinedを1本だけ呼び、旧sendを呼ばない', async () => {
    await act(async () => { root.render(<ChatsPage />) })
    // 会話を選ぶ。
    const row = await screen.findByRole('button', { name: /利用者1/ })
    await act(async () => { fireEvent.click(row) })
    await waitFor(() => {
      expect(screen.getByLabelText('メッセージを入力')).toBeTruthy()
    })
    // 画像を付ける。
    const fileInput = host.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(fileInput).not.toBeNull()
    const file = new File(['x'.repeat(100)], 'o.jpg', { type: 'image/jpeg' })
    // happy-dom の File には arrayBuffer が無いことがある。実物の読み取りを足す。
    if (typeof (file as unknown as { arrayBuffer?: unknown }).arrayBuffer !== 'function') {
      Object.defineProperty(file, 'arrayBuffer', {
        value: async () => new TextEncoder().encode('x'.repeat(100)).buffer,
      })
    }
    await act(async () => {
      fireEvent.change(fileInput!, { target: { files: [file] } })
    })
    await waitFor(() => {
      expect(net.calls.some((c) => c.startsWith('POST /api/images'))).toBe(true)
    })
    // 本文を書いて送る。
    await act(async () => {
      fireEvent.change(screen.getByLabelText('メッセージを入力'), { target: { value: 'こんにちは' } })
    })
    net.calls.length = 0
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送信' }))
    })
    await waitFor(() => {
      expect(net.calls.filter((c) => c === 'POST /api/chats/chat-1/send-combined')).toHaveLength(1)
    })
    expect(net.calls.filter((c) => c === 'POST /api/chats/chat-1/send')).toHaveLength(0)
  })
})
