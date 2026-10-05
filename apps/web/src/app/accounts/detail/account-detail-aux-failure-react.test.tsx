// @vitest-environment happy-dom
/*
 * R521: 親名称用の一覧取得だけ失敗してもアカウント詳細全体が読めなくなる。
 *
 * 本物の React で本物の `AccountDetailPage` を mount し、差し替えるのは通信だけ。
 * - 本人GET成功・一覧GET失敗でも、登録内容や接続状態は表示する。
 * - 親名称の欄だけ「読み込めませんでした」＋取り直しを出す。
 * - 一覧の取り直しが成功すれば親名称が復旧する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountDetailPage from './page'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=child-a'),
  usePathname: () => '/accounts/detail',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined, usePageChrome: () => ({}) }))

const CHILD = {
  id: 'child-a', channelId: '2007000009', name: '子アカウント',
  loginChannelId: null, liffId: null, isActive: true, archivedAt: null,
  isDefault: false, timezone: 'Asia/Tokyo',
  createdAt: '', updatedAt: '', country: null, role: null, displayOrder: 0,
  ogSiteName: null, ogDefaultDescription: null, ogDefaultImageUrl: null,
  parentLineAccountId: 'parent-a',
  stats: { friendCount: 3, activeScenarios: 0, messagesThisMonth: 0 },
  webhook: { expectedUrl: 'https://example.test/hook', actualUrl: 'https://example.test/hook', active: true, status: 'matched' },
}

const PARENT = {
  id: 'parent-a', channelId: '2007000001', name: '親アカウント',
  loginChannelId: null, liffId: null, isActive: true, archivedAt: null,
  isDefault: true, timezone: 'Asia/Tokyo',
  createdAt: '', updatedAt: '', country: null, role: null, displayOrder: 0,
  ogSiteName: null, ogDefaultDescription: null, ogDefaultImageUrl: null,
  parentLineAccountId: null,
}

const net = vi.hoisted(() => ({
  /** true の間だけ全アカウント一覧 GET を通信断にする（本人GETは通す）。 */
  listDown: true,
}))

function stubFetch() {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/line-accounts/child-a')) {
      return new Response(JSON.stringify({ success: true, data: CHILD }), { status: 200 })
    }
    if (/\/api\/line-accounts(\?|$)/.test(url)) {
      if (net.listDown) throw new TypeError('fetch failed')
      return new Response(JSON.stringify({ success: true, data: [PARENT, CHILD] }), { status: 200 })
    }
    if (url.includes('/api/staff/me')) {
      return new Response(JSON.stringify({ success: true, data: { id: 's1', role: 'staff' } }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
  }) as typeof globalThis.fetch
}

let container: HTMLDivElement
let root: Root
const originalFetch = globalThis.fetch

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  net.listDown = true
  stubFetch()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

describe('R521 親一覧だけ失敗したときの詳細（本物のReact）', () => {
  it('本人の詳細は出し、親名称の欄だけ未取得＋取り直しにする', async () => {
    await act(async () => { root.render(<AccountDetailPage />) })
    await flush()

    const text = container.textContent ?? ''
    // 詳細の主情報は読める。
    expect(text).toContain('子アカウント')
    expect(text).toContain('2007000009')
    // 画面全体のエラーにはしない。
    expect(text).not.toContain('アカウントを読み込めませんでした')
    // 親名称の欄だけ未取得と取り直し。
    expect(text).toContain('読み込めませんでした')
    expect(text).toContain('もう一度読み込む')
  })

  it('一覧の取り直しが成功すれば親名称が復旧する', async () => {
    await act(async () => { root.render(<AccountDetailPage />) })
    await flush()
    expect(container.textContent ?? '').toContain('読み込めませんでした')

    net.listDown = false
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'もう一度読み込む',
    )
    expect(retry).toBeTruthy()
    await act(async () => { retry?.click() })
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('親アカウント')
    expect(text).not.toContain('読み込めませんでした')
  })
})
