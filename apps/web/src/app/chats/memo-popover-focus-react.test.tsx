// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ChatsPage from './page'

/*
 * N-031: 内部メモの紙は role="dialog" なのに Tab が裏の送信欄へ抜け、
 * 閉じてもフォーカスが「内部メモ」ボタンへ戻らなかった。
 * 共通の useOverlayFocus で、Tabを紙の中に留め・Escapeで閉じ・
 * 閉じたら開いたボタンへ戻ることを、本物の ChatsPage で確かめる。
 */

const fixture = vi.hoisted(() => ({
  params: new URLSearchParams('friend=friend-a'),
}))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => fixture.params,
  usePathname: () => '/chats',
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-a',
    selectedAccount: null,
    loading: false,
  }),
}))

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

function responseFor(url: URL): Response {
  if (url.pathname === '/api/chats') return json({ success: true, data: [] })
  if (url.pathname === '/api/chats/stats') {
    return json({ success: true, data: {
      total: 0, unread: 0, inProgress: 0, onHold: 0, resolved: 0,
      oldestUnansweredMinutes: null, assigneeUnread: [],
    } })
  }
  if (url.pathname === '/api/support/inbox') {
    return json({ success: true, data: { items: [], summary: { total: 0 } } })
  }
  if (url.pathname === '/api/operators') return json({ success: true, data: [] })
  if (url.pathname === '/api/inbox/saved-views') return json({ success: true, data: [] })
  if (url.pathname === '/api/friends/friend-a') {
    return json({ success: true, data: {
      id: 'friend-a', displayName: 'メモ確認', pictureUrl: null, isFollowing: true,
      metadata: {}, lineAccountId: 'account-a', realName: null, systemDisplayName: null,
      refCode: null, createdAt: '2026-09-01T00:00:00.000Z', tags: [],
      formSubmissions: [], support: null,
    } })
  }
  if (url.pathname === '/api/chats/friend-a') {
    return json({ success: true, data: {
      id: 'friend-a', friendId: 'friend-a', friendName: 'メモ確認',
      friendRealName: null, friendPictureUrl: null, isAttention: false,
      operatorId: null, status: 'unread', notes: '既存のメモ', revision: 1,
      lastMessageAt: '2026-09-16T01:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z',
      messages: [], hasMoreMessages: false,
    } })
  }
  if (url.pathname.endsWith('/mileage')) {
    return json({ success: true, data: {
      summary: { programId: 'p', programName: 'マイル', available: 0, pending: 0, lifetimeEarned: 0, spent: 0 },
      history: [],
    } })
  }
  if (url.pathname.endsWith('/rich-menu')) {
    return json({ success: true, data: { id: null, name: null, isDefault: false } })
  }
  if (url.pathname.endsWith('/read')) return json({ success: true, data: { isUnread: false } })
  return json({ success: true, data: [] })
}

async function eventually(check: () => void, timeout = 1_500): Promise<void> {
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

const popover = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-inbox-v6="internal-memo-popover"]')
const toggleButton = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-inbox-v6="internal-memo-toggle"]')
const keydown = (key: string, shiftKey = false) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))

describe('N-031 内部メモの紙のフォーカス制御', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    fixture.params = new URLSearchParams('friend=friend-a')
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    vi.stubGlobal('fetch', (input: string | URL) =>
      Promise.resolve(responseFor(new URL(String(input), 'http://localhost'))))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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

  async function openMemo(): Promise<HTMLElement> {
    await act(async () => root.render(<ChatsPage />))
    await eventually(() => expect(toggleButton(host)).toBeTruthy())
    const toggle = toggleButton(host)!
    await act(async () => { toggle.focus(); toggle.click() })
    const panel = popover(host)!
    expect(panel).toBeTruthy()
    return panel
  }

  it('開くと本文へフォーカスが入る', async () => {
    const panel = await openMemo()
    await eventually(() =>
      expect(document.activeElement).toBe(panel.querySelector('textarea')))
  })

  it('Tab は紙の中で回り、裏の送信欄へ抜けない', async () => {
    const panel = await openMemo()
    const textarea = panel.querySelector('textarea')!
    await eventually(() => expect(document.activeElement).toBe(textarea))

    // 本文が空=既存メモと同じではないので保存が効く。末尾=メモを保存。
    const buttons = [...panel.querySelectorAll('button')].filter((b) => !b.disabled)
    const last = buttons[buttons.length - 1]
    await act(async () => { last.focus(); keydown('Tab') })
    expect(document.activeElement).toBe(textarea)

    // 先頭(textarea)で Shift+Tab は末尾へ回る
    await act(async () => { textarea.focus(); keydown('Tab', true) })
    expect(document.activeElement).toBe(last)
  })

  it('Escape で閉じて、開いた「内部メモ」ボタンへフォーカスが戻る', async () => {
    await openMemo()
    const toggle = toggleButton(host)!
    await act(async () => { keydown('Escape') })
    expect(popover(host)).toBeNull()
    await eventually(() => expect(document.activeElement).toBe(toggle))
  })

  it('キャンセルで閉じても、開いたボタンへフォーカスが戻る', async () => {
    const panel = await openMemo()
    const toggle = toggleButton(host)!
    const cancel = [...panel.querySelectorAll('button')]
      .find((b) => b.textContent === 'キャンセル')!
    await act(async () => { cancel.focus(); cancel.click() })
    expect(popover(host)).toBeNull()
    await eventually(() => expect(document.activeElement).toBe(toggle))
  })
})
