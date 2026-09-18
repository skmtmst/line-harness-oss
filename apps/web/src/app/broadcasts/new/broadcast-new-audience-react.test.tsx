// @vitest-environment happy-dom
/*
 * 分析画面から配信作成へ対象者を渡す画面側の試験(N-274 / #842)。
 *
 * URL には audienceId だけを載せ、人数・期限はページ側でAPIへ読み直す。
 * 実物の NewBroadcastPage を react-dom/client で mount し、
 *   - 有効な対象者は人数と期限を画面へ出す
 *   - 期限切れ(410)・不存在/他アカウント(404)は作成画面へ進ませない
 *   - アカウント切替後に届いた古い応答は捨てる
 *   - 0人の対象者でも開ける（届く相手がいないだけ）
 * を確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const mocks = vi.hoisted(() => ({
  query: 'audienceId=aud-1',
  accountId: 'acc-1',
  accountLoading: false,
  audience: vi.fn(),
  tagsList: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.query),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: mocks.accountId, loading: mocks.accountLoading }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      tags: { ...actual.api.tags, list: mocks.tagsList },
      analytics: { ...actual.api.analytics, audience: mocks.audience },
    },
  }
})

import NewBroadcastPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<NewBroadcastPage />)
  })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const AUDIENCE = {
  id: 'aud-1',
  sourceKind: 'cross',
  selectionKey: 'a:b',
  memberCount: 5,
  expiresAt: '2026-10-02T12:00:00.000Z',
  createdAt: '2026-10-01T12:00:00.000Z',
}

describe('配信作成への分析対象者の受け渡し(N-274)', () => {
  beforeEach(() => {
    mocks.query = 'audienceId=aud-1'
    mocks.accountId = 'acc-1'
    mocks.accountLoading = false
    mocks.tagsList.mockResolvedValue({ success: true, data: [] })
    mocks.audience.mockResolvedValue({ success: true, data: AUDIENCE })
  })

  afterEach(async () => {
    if (root) await act(async () => { root.unmount() })
    host?.remove()
    vi.clearAllMocks()
  })

  it('有効な対象者は人数と期限を出してフォームを開く', async () => {
    await mount()
    await flush()
    expect(mocks.audience).toHaveBeenCalledWith('aud-1', 'acc-1')
    expect(host.textContent).toContain('分析で作った対象者')
    expect(host.textContent).toContain('5人')
    expect(host.textContent).toContain('まで有効')
  })

  it('期限切れ(410)は作り直しを案内し、フォームを出さない', async () => {
    const { ApiError } = await import('@/lib/api')
    mocks.audience.mockRejectedValue(new ApiError(410, 'expired'))
    await mount()
    await flush()
    expect(host.textContent).toContain('24時間を過ぎました')
    expect(host.textContent).toContain('分析画面へ戻る')
    expect(host.textContent).not.toContain('配信対象')
  })

  it('不存在・他アカウント(404)は見つからない旨を出し、フォームを出さない', async () => {
    const { ApiError } = await import('@/lib/api')
    mocks.audience.mockRejectedValue(new ApiError(404, 'Not found'))
    await mount()
    await flush()
    expect(host.textContent).toContain('対象者が見つかりません')
    expect(host.textContent).not.toContain('配信対象')
  })

  it('アカウントを切り替えると対象者を読み直し、先に届いた古い応答は捨てる', async () => {
    // 1回目(acc-1)は遅れて届き、2回目(acc-2)が先に返る。
    let resolveFirst: ((v: unknown) => void) | undefined
    mocks.audience
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ success: true, data: { ...AUDIENCE, memberCount: 42 } })
    await mount()
    await flush()
    expect(mocks.audience).toHaveBeenCalledTimes(1)

    mocks.accountId = 'acc-2'
    await act(async () => {
      root.render(<NewBroadcastPage />)
    })
    await flush()
    expect(mocks.audience).toHaveBeenCalledWith('aud-1', 'acc-2')
    expect(host.textContent).toContain('42人')

    // 遅れて届いた acc-1 の応答は捨てられ、画面は acc-2 の結果のまま。
    await act(async () => {
      resolveFirst?.({ success: true, data: { ...AUDIENCE, memberCount: 7 } })
      await Promise.resolve()
    })
    await flush()
    expect(host.textContent).toContain('42人')
    expect(host.textContent).not.toContain('7人')
  })

  it('0人の対象者でも開ける（届く相手がいないだけ）', async () => {
    mocks.audience.mockResolvedValue({ success: true, data: { ...AUDIENCE, memberCount: 0 } })
    await mount()
    await flush()
    expect(host.textContent).toContain('分析で作った対象者')
    expect(host.textContent).toContain('0人')
  })
})
