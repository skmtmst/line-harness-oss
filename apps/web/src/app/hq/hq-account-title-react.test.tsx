// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const titles = vi.hoisted(() => ({ seen: [] as unknown[] }))
// 描画のたびに別物が返ると effect が回り続けるので、固定の1つを返す。
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: (title: unknown) => { titles.seen.push(title) },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ setSelectedAccountId: vi.fn(), refreshAccounts: vi.fn(async () => {}) }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    lineAccounts: { list: vi.fn(async () => ({ success: true, data: [] })) },
    hqNotices: { list: vi.fn(async () => ({ success: true, data: [] })), markRead: vi.fn() },
    operatorHistory: vi.fn(async () => ({ success: true, data: [] })),
  },
  fetchApi: vi.fn(),
}))

import HqPage from './page'
import HqOpenPage from './open/page'

/**
 * 本部のアカウント一覧（/hq と /hq/open）に見出しが無く、いきなり数字から
 * 始まっていた。他の本部画面と同じく `usePageTitle('アカウント')` を置き、
 * 左のメニューと同じ名前にした。再発防止。
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  titles.seen.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

describe('本部のアカウント一覧の見出し', () => {
  it('/hq が見出し「アカウント」を出す', async () => {
    await act(async () => { root.render(<HqPage />) })
    await settle()
    expect(titles.seen).toContain('アカウント')
  })

  it('/hq/open が見出し「アカウント」を出す', async () => {
    window.history.replaceState(null, '', '/hq/open?target=tags')
    await act(async () => { root.render(<HqOpenPage />) })
    await settle()
    expect(titles.seen).toContain('アカウント')
    expect(host.textContent).toContain('どのアカウントのタグを開きますか')
  })
})
