// @vitest-environment happy-dom
/*
 * 受信箱の右の列（顧客情報）が失敗しても、受信箱全体を落とさない。
 *
 * 2026-10-01、画面確認用のモックAPIが GET /api/friends/:id に一覧の形を
 * 返したとき、右の列の例外で受信箱全体がページのエラー境界に落ちた。
 * 右の列だけを境界で包み、一覧と会話は使えるままにする。
 * あわせて、右の列が想定外の形（一覧の形・null の配列）を受けても
 * 例外を投げないことを、実物の右の列で確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ChatsPage from './page'

const fixture = vi.hoisted(() => ({
  params: new URLSearchParams(),
  sidebarThrows: false,
  friendData: null as unknown,
  mileageData: null as unknown,
}))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => fixture.params,
  usePathname: () => '/chats',
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
// 実物の右の列を使い、sidebarThrows のときだけ描画中に例外を投げさせる。
vi.mock('@/components/chats/friend-info-sidebar', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/components/chats/friend-info-sidebar')>()
  const Real = real.default
  return {
    default: (props: React.ComponentProps<typeof Real>) => {
      if (fixture.sidebarThrows) throw new Error('右の列の描画に失敗')
      return <Real {...props} />
    },
  }
})

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const goodFriend = {
  id: 'friend-a', displayName: '右列確認', pictureUrl: null, isFollowing: true,
  metadata: {}, lineAccountId: 'account-a', realName: null, systemDisplayName: null,
  refCode: null, firstTrackedLinkName: null, createdAt: '2026-09-01T00:00:00.000Z',
  tags: [{ id: 'tag-a', name: '常連', color: '#06C755' }], formSubmissions: [], support: null,
}
const goodMileage = {
  summary: { programId: 'p', programName: 'マイル', available: 0, pending: 0, lifetimeEarned: 0, spent: 0 },
  history: [],
}

function responseFor(url: URL): Response {
  if (url.pathname === '/api/chats') {
    return json({ success: true, data: [{
      id: 'friend-a', friendId: 'friend-a', friendName: '一覧の行', operatorId: null,
      status: 'unread', isUnread: true, lastMessageAt: '2026-09-16T01:00:00.000Z',
      lastMessageContent: '一覧の最新文', lastMessageType: 'text', lastMessageDirection: 'incoming',
    }] })
  }
  if (url.pathname === '/api/chats/stats') {
    return json({ success: true, data: {
      total: 1, unread: 1, inProgress: 0, onHold: 0, resolved: 0,
      oldestUnansweredMinutes: null, assigneeUnread: [],
    } })
  }
  if (url.pathname === '/api/support/inbox') {
    return json({ success: true, data: { items: [], summary: { total: 0 } } })
  }
  if (url.pathname === '/api/operators') return json({ success: true, data: [] })
  if (url.pathname === '/api/inbox/saved-views') return json({ success: true, data: [] })
  if (url.pathname === '/api/friends/friend-a') return json({ success: true, data: fixture.friendData })
  if (url.pathname === '/api/chats/friend-a') {
    return json({ success: true, data: {
      id: 'friend-a', friendId: 'friend-a', friendName: '一覧の行',
      friendRealName: null, friendPictureUrl: null, isAttention: false,
      operatorId: null, status: 'unread', notes: null, revision: 1,
      lastMessageAt: '2026-09-16T01:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z',
      messages: [{
        id: 'message-a', direction: 'incoming', messageType: 'text', content: '会話の本文です',
        isUnsent: false, source: 'user', originKind: null, sentByStaffId: null,
        sentByStaffName: null, scenarioName: null, createdAt: '2026-09-16T01:00:00.000Z',
      }],
      hasMoreMessages: false,
    } })
  }
  if (url.pathname.endsWith('/mileage')) return json({ success: true, data: fixture.mileageData })
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

const sidebarFailure = () => document.querySelector<HTMLElement>('[data-friend-info-sidebar-state="failed"]')
const list = () => document.querySelector<HTMLElement>('[data-inbox-v4="conversation-list"]')

/*
 * 運用者と同じ順で開く。一覧の行を押して会話を開き、「顧客情報を表示」で
 * 右の列を出す（試験の画面幅では右の列は最初は閉じている）。
 * 直リンク（?friend=）は受信箱側も同じ友だちAPIを読むため、右の列だけの
 * 失敗を確かめる場面では使わない。
 */
async function openChatAndCustomerInfo(root: Root) {
  await act(async () => root.render(<ChatsPage />))
  let row: HTMLButtonElement | undefined
  await eventually(() => {
    row = [...(list()?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('一覧の行'))
    expect(row, '一覧の行').toBeTruthy()
  })
  await act(async () => { row!.click() })
  await eventually(() => expect(document.body.textContent).toContain('会話の本文です'))
  const toggle = document.querySelector<HTMLButtonElement>('[data-inbox-v6="customer-info-toggle"]')
  expect(toggle, '顧客情報を表示').toBeTruthy()
  if (toggle!.getAttribute('aria-expanded') !== 'true') await act(async () => { toggle!.click() })
}

describe('受信箱の右の列のエラー境界', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    fixture.params = new URLSearchParams()
    fixture.sidebarThrows = false
    fixture.friendData = goodFriend
    fixture.mileageData = goodMileage
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    vi.stubGlobal('fetch', (input: string | URL) => responseFor(new URL(String(input), 'http://localhost')))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    // 境界が拾った例外を React が console.error へ出す。試験の出力を汚さない。
    vi.spyOn(console, 'error').mockImplementation(() => {})
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

  it('右の列が例外を投げても、一覧と会話は残り、右の列だけ再試行できる', async () => {
    fixture.sidebarThrows = true
    await openChatAndCustomerInfo(root)

    await eventually(() => expect(sidebarFailure(), '右の列の失敗表示').toBeTruthy())
    expect(host.textContent).toContain('会話の本文です')
    expect(list()?.textContent).toContain('一覧の行')
    const failure = sidebarFailure()
    expect(failure, '右の列の失敗表示').toBeTruthy()
    expect(failure!.textContent).toContain('顧客情報を読み込めませんでした')

    // 文字があるだけでなく、押せるボタンであること。
    const retry = [...failure!.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'もう一度試す')
    expect(retry, 'もう一度試すボタン').toBeTruthy()
    expect(retry!.disabled).toBe(false)

    fixture.sidebarThrows = false
    await act(async () => { retry!.click() })
    await eventually(() => expect(host.textContent).toContain('常連'))
    expect(sidebarFailure()).toBeNull()
    expect(host.textContent).toContain('会話の本文です')
  })

  it('1人分ではなく一覧の形が返っても、右の列は落ちず取得失敗として扱う', async () => {
    fixture.friendData = { items: [goodFriend], total: 1, page: 1, limit: 20, hasNextPage: false }
    await openChatAndCustomerInfo(root)

    await eventually(() => expect(host.textContent).toContain('友だち情報を取得できませんでした'))
    expect(sidebarFailure()).toBeNull()
    expect(host.textContent).toContain('会話の本文です')
    expect(list()?.textContent).toContain('一覧の行')
  })

  it('タグ・フォーム回答・マイル履歴が配列でなくても（null・一覧の形）、右の列は落ちず空として出す', async () => {
    // タグは null ではなく一覧の形（{ items }）。`?? []` では防げない形も確かめる。
    fixture.friendData = { ...goodFriend, tags: { items: [] }, formSubmissions: null, formSubmissionTotal: 3 }
    fixture.mileageData = { ...goodMileage, history: null }
    await openChatAndCustomerInfo(root)

    await eventually(() => expect(host.textContent).toContain('タグなし'))
    expect(host.textContent).toContain('回答はまだありません')
    // 回答を1件も受け取れていないのに「1〜0件を表示」とは出さない。
    expect(host.textContent).not.toContain('件中')
    expect(sidebarFailure()).toBeNull()
    expect(host.textContent).toContain('会話の本文です')
  })
})
