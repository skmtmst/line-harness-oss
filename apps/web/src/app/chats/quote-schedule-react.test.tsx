// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ChatsPage from './page'

/*
 * N-025: 引用返信と送信予約の画面対照。
 *   - 「引用」を押すと送信欄の上に引用元が出て、送信に quotedMessageId が付く
 *   - × で引用を外せる
 *   - 予約パネルで日時を選ぶと /schedule へ送り、一覧に出て取消できる
 *   - 引用つき送信済みメッセージには引用元の要約が出る
 */

const fixture = vi.hoisted(() => ({
  params: new URLSearchParams('friend=friend-a'),
  scheduled: [] as Array<{ id: string; scheduledAt: string; content: string; status: string }>,
  sentBodies: [] as Array<Record<string, unknown>>,
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

function responseFor(url: URL, init?: RequestInit): Response {
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
      id: 'friend-a', displayName: '引用確認', pictureUrl: null, isFollowing: true,
      metadata: {}, lineAccountId: 'account-a', realName: null, systemDisplayName: null,
      refCode: null, createdAt: '2026-09-01T00:00:00.000Z', tags: [],
      formSubmissions: [], support: null,
    } })
  }
  if (url.pathname === '/api/chats/friend-a/scheduled' && init?.method !== 'DELETE' && init?.method !== 'PATCH') {
    return json({ success: true, data: { scheduled: fixture.scheduled } })
  }
  if (url.pathname === '/api/chats/friend-a/schedule' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)) as { content: string; scheduledAt: string; quotedMessageId?: string }
    const row = {
      id: `sched-${fixture.scheduled.length + 1}`,
      messageType: 'text',
      content: body.content,
      quotedMessageId: body.quotedMessageId ?? null,
      scheduledAt: new Date(body.scheduledAt).toISOString(),
      status: 'scheduled',
      attemptCount: 0,
      lastErrorCode: null,
      createdAt: '2026-09-16T00:00:00.000Z',
    }
    fixture.scheduled.push(row)
    return json({ success: true, data: { ...row, replayed: false } })
  }
  if (url.pathname.startsWith('/api/chats/friend-a/scheduled/') && init?.method === 'DELETE') {
    const id = url.pathname.split('/').pop()!
    fixture.scheduled = fixture.scheduled.filter((row) => row.id !== id)
    return json({ success: true, data: { cancelled: true } })
  }
  if (url.pathname === '/api/chats/friend-a/send' && init?.method === 'POST') {
    fixture.sentBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
    return json({ success: true, data: { sent: true, messageId: 'm-sent', sentByStaffName: '自分', revision: 2 } })
  }
  if (url.pathname === '/api/chats/friend-a') {
    return json({ success: true, data: {
      id: 'friend-a', friendId: 'friend-a', friendName: '引用確認',
      friendRealName: null, friendPictureUrl: null, isAttention: false,
      operatorId: null, status: 'unread', notes: '', revision: 1,
      lastMessageAt: '2026-09-16T01:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z',
      messages: [
        {
          id: 'm-in-1', direction: 'incoming', messageType: 'text',
          content: '値段はいくらですか？', isUnsent: false, source: null,
          originKind: null, sentByStaffId: null, sentByStaffName: null,
          scenarioName: null, quoted: null, createdAt: '2026-09-16T00:55:00.000Z',
        },
        {
          id: 'm-out-1', direction: 'outgoing', messageType: 'text',
          content: '1,980円です', isUnsent: false, source: 'manual',
          originKind: null, sentByStaffId: 'staff-1', sentByStaffName: 'オーナー',
          scenarioName: null,
          quoted: {
            id: 'm-in-1', direction: 'incoming', messageType: 'text',
            content: '値段はいくらですか？', isUnsent: false, createdAt: '2026-09-16T00:55:00.000Z',
          },
          createdAt: '2026-09-16T01:00:00.000Z',
        },
      ],
      hasMoreMessages: false,
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

async function typeText(host: HTMLElement, text: string) {
  const textarea = host.querySelector('textarea[aria-label="メッセージを入力"]') as HTMLTextAreaElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('N-025 引用返信と送信予約', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    fixture.params = new URLSearchParams('friend=friend-a')
    fixture.scheduled = []
    fixture.sentBodies = []
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) =>
      Promise.resolve(responseFor(new URL(String(input), 'http://localhost'), init)))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
    vi.unstubAllGlobals()
  })

  it('「引用」を押すと引用元が送信欄へ出て、送信に quotedMessageId が付く', async () => {
    await act(async () => { root.render(<ChatsPage />) })
    await eventually(() => {
      expect(host.textContent).toContain('値段はいくらですか？')
    })

    const quoteButtons = Array.from(host.querySelectorAll<HTMLElement>('[data-inbox-v6="quote-reply"]'))
    expect(quoteButtons.length).toBeGreaterThan(0)
    await act(async () => { quoteButtons[0].click() })
    await eventually(() => {
      expect(host.querySelector('[data-inbox-v6="quote-preview"]')?.textContent).toContain('値段はいくらですか？')
    })

    await typeText(host, '1,980円です')
    const sendButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '送信')!
    await act(async () => { sendButton.click() })
    await eventually(() => {
      expect(fixture.sentBodies).toHaveLength(1)
      expect(fixture.sentBodies[0].quotedMessageId).toBe('m-in-1')
    })
    // 送ったら引用は外れる。
    await eventually(() => {
      expect(host.querySelector('[data-inbox-v6="quote-preview"]')).toBeNull()
    })
  })

  it('引用の×で外せる', async () => {
    await act(async () => { root.render(<ChatsPage />) })
    await eventually(() => {
      expect(host.querySelector('[data-inbox-v6="quote-reply"]')).toBeTruthy()
    })
    await act(async () => {
      host.querySelector<HTMLElement>('[data-inbox-v6="quote-reply"]')!.click()
    })
    await eventually(() => {
      expect(host.querySelector('[data-inbox-v6="quote-preview"]')).toBeTruthy()
    })
    await act(async () => {
      host.querySelector<HTMLElement>('[data-inbox-v6="quote-preview"] button')!.click()
    })
    await eventually(() => {
      expect(host.querySelector('[data-inbox-v6="quote-preview"]')).toBeNull()
    })
  })

  it('引用つき送信済みメッセージには引用元の要約が出る', async () => {
    await act(async () => { root.render(<ChatsPage />) })
    await eventually(() => {
      const quoted = host.querySelector('[data-inbox-v6="quoted-message"]')
      expect(quoted?.textContent).toContain('値段はいくらですか？')
    })
  })

  it('予約パネルで日時を選ぶと予約が作られ、一覧に出て取消できる', async () => {
    await act(async () => { root.render(<ChatsPage />) })
    await eventually(() => {
      expect(host.textContent).toContain('値段はいくらですか？')
    })

    await typeText(host, '明日の朝に送ります')
    await act(async () => {
      host.querySelector<HTMLElement>('[data-inbox-v6="schedule-toggle"]')!.click()
    })
    await eventually(() => {
      expect(host.querySelector('[data-inbox-v6="schedule-panel"]')).toBeTruthy()
    })

    // 日時の選択（★V7）で 2027-09-17 09:00 を選ぶ。値は今までどおり日本時間の文字列。
    await act(async () => { host.querySelector<HTMLElement>('#schedule-at')!.click() })
    const dialog = () => host.querySelector('[role="dialog"][aria-label="日時を選ぶ"]')!
    await act(async () => {
      dialog().querySelector<HTMLButtonElement>('button[aria-label="日付"]')!.click()
    })
    for (let i = 0; i < 36; i += 1) {
      const grid = host.querySelector('[role="grid"]')
      if (grid?.getAttribute('aria-label') === '2027年9月') break
      await act(async () => {
        Array.from(host.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '次の月')!.click()
      })
    }
    await act(async () => {
      Array.from(host.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? '').startsWith('2027年9月17日（金）'))!.click()
    })
    await act(async () => {
      const hour = dialog().querySelector<HTMLSelectElement>('select[aria-label="時"]')!
      hour.value = '09'
      hour.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const scheduleButton = Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent === 'この日時で予約する')!
    await act(async () => { scheduleButton.click() })
    await eventually(() => {
      expect(fixture.scheduled).toHaveLength(1)
      expect(fixture.scheduled[0].content).toBe('明日の朝に送ります')
    })

    // パネルは閉じる。もう一度開くと予約一覧に出る。
    await act(async () => {
      host.querySelector<HTMLElement>('[data-inbox-v6="schedule-toggle"]')!.click()
    })
    await eventually(() => {
      const row = host.querySelector('[data-inbox-v6="scheduled-row"]')
      expect(row?.textContent).toContain('明日の朝に送ります')
    })

    const cancelButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '取消')!
    await act(async () => { cancelButton.click() })
    await eventually(() => {
      expect(fixture.scheduled).toHaveLength(0)
      expect(host.querySelector('[data-inbox-v6="scheduled-row"]')).toBeNull()
    })
  })
})
