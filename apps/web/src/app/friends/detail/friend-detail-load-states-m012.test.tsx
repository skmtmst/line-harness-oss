// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * M012：友だち本体の読み込み失敗は3つの面に分ける。
 *
 *   403（権限不足）…「この友だちを見る権限がありません」。押しても
 *     直らないので「もう一度読み込む」は出さない。
 *   404（削除・別アカウント）…「この友だちは見つかりません」＋一覧へ戻る。
 *   通信失敗…「友だちを読み込めませんでした」＋「もう一度読み込む」。
 *
 * 監査 228-003：403 の応答に 404 の案内（削除・別アカウント）が出ていた。
 * 本物の React で描画し、403 が見つからない案内へ落ちないことを固定する。
 * 静的な配線の固定は friend-detail-failure-m012.test.ts が持つ。
 */

const state = vi.hoisted(() => ({
  friendGet: (_id: string, _options?: unknown): Promise<unknown> =>
    Promise.resolve({ success: true, data: null }),
}))

const routing = vi.hoisted(() => ({
  params: new URLSearchParams('id=friend-1&tab=timeline'),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => routing.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchApi: () =>
      Promise.resolve({ success: true, data: { items: [], nextCursor: null } }),
    api: {
      ...actual.api,
      friends: {
        ...actual.api.friends,
        get: (...args: unknown[]) =>
          state.friendGet(args[0] as string, args[1] as unknown),
      },
      friendFields: {
        ...actual.api.friendFields,
        forFriend: () =>
          Promise.resolve({ success: true, data: { items: [], hiddenPersonalCount: 0 } }),
        saveForFriend: () => Promise.resolve({ success: true, data: { updated: 0 }, warnings: [] }),
      },
      chats: {
        ...actual.api.chats,
        get: () => Promise.reject(new Error('no chat')),
        update: () => Promise.reject(new Error('no chat')),
      },
      operators: {
        ...actual.api.operators,
        list: () => Promise.resolve({ success: true, data: [] }),
      },
      featureSettings: {
        ...actual.api.featureSettings,
        visibility: async () => ({
          success: true as const,
          data: { features: { friend_fields: true } },
        }),
      },
    },
  }
})

let host: HTMLDivElement
let root: Root
let FriendDetailPage: typeof import('./page').default
const storage = new Map<string, string>()

beforeEach(async () => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  routing.params = new URLSearchParams('id=friend-1&tab=timeline')
  storage.clear()
  storage.set('lh_staff_role', 'admin')
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  state.friendGet = () => Promise.resolve({ success: true, data: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  FriendDetailPage = (await import('./page')).default
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function render() {
  await act(async () => {
    root.render(React.createElement(FriendDetailPage))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function eventually(check: () => void, timeout = 1_500): Promise<void> {
  const started = Date.now()
  while (true) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }
}

function buttons(): string[] {
  return Array.from(host.querySelectorAll('button')).map((b) => b.textContent ?? '')
}

describe('M012 読み込み失敗の3つの面', () => {
  it('403 は権限の面に出し、見つからない案内・再試行口は出さない', async () => {
    const { ApiError } = await import('@/lib/api')
    state.friendGet = () => Promise.reject(new ApiError(403, 'API error: 403'))
    await render()
    await eventually(() => {
      expect(host.textContent).toContain('この友だちを見る権限がありません')
    })
    // 228-003 の再発防止：削除・別アカウントの案内へ落ちない。
    expect(host.textContent).not.toContain('この友だちは見つかりません')
    expect(host.textContent).not.toContain('友だちを読み込めませんでした')
    expect(buttons()).not.toContain('もう一度読み込む')
  })

  it('404 は見つからない案内に出し、一覧へ戻る', async () => {
    const { ApiError } = await import('@/lib/api')
    state.friendGet = () => Promise.reject(new ApiError(404, 'API error: 404'))
    await render()
    await eventually(() => {
      expect(host.textContent).toContain('この友だちは見つかりません')
    })
    expect(host.textContent).toContain('友だち一覧へ戻る')
    expect(host.textContent).not.toContain('この友だちを見る権限がありません')
  })

  it('通信失敗は読み直しの面に出し、もう一度読み込むが押せる', async () => {
    state.friendGet = () => Promise.reject(new TypeError('Failed to fetch'))
    await render()
    await eventually(() => {
      expect(host.textContent).toContain('友だちを読み込めませんでした')
    })
    expect(buttons()).toContain('もう一度読み込む')
    expect(host.textContent).not.toContain('この友だちは見つかりません')
    expect(host.textContent).not.toContain('この友だちを見る権限がありません')
  })
})
