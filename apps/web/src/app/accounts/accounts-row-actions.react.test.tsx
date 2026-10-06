// @vitest-environment happy-dom
/*
 * 板 V7vn3：LINEアカウント一覧の行操作は「⋯」にまとめる。
 * 開くと詳細・確かめ直し・引き継ぎ・アーカイブが出ることを実マウントで確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const listAccounts = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      lineAccounts: { ...actual.api.lineAccounts, list: listAccounts },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/accounts',
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageChrome: () => ({}),
}))

import AccountsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  push.mockClear()
  listAccounts.mockImplementation(async () => ({
    success: true,
    data: [{
      id: 'account-a',
      name: '本店アカウント',
      channelId: '1234567890',
      channelSecret: null,
      isActive: true,
      isDefault: true,
      timezone: 'Asia/Tokyo',
      webhook: { status: 'matched' },
      stats: { friendCount: 120 },
      parentLineAccountId: null,
      archivedAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function flush() {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

describe('V7vn3 LINEアカウント一覧の行操作', () => {
  it('行の操作は「⋯」1つで、枠つき「詳細」ボタンは無い', async () => {
    await act(async () => { root.render(<AccountsPage />) })
    await flush()

    const menuButton = [...host.querySelectorAll('button')]
      .find((el) => el.getAttribute('aria-label') === '本店アカウントの操作')
    expect(menuButton, '行の「⋯」ボタンが見つかりません').toBeTruthy()
    // #641 の枠つき詳細ボタンはやめ、メニューの中に移した。
    expect(host.textContent).not.toContain('•••')
    const detailLinks = [...host.querySelectorAll('a')]
      .filter((el) => el.getAttribute('href') === '/accounts/detail?id=account-a')
    expect(detailLinks, '行に直接の詳細リンクが残っています').toHaveLength(0)
  })

  it('「⋯」を開くと4項目が出て、詳細で詳しい画面へ行く', async () => {
    await act(async () => { root.render(<AccountsPage />) })
    await flush()

    const menuButton = [...host.querySelectorAll('button')]
      .find((el) => el.getAttribute('aria-label') === '本店アカウントの操作')
    expect(menuButton).toBeTruthy()
    await act(async () => { menuButton?.click() })
    await flush()

    // メニューはポータルに出るので、画面全体で探す。
    const body = document.body.textContent ?? ''
    for (const label of ['詳細', '接続をもう一度確かめる', '引き継ぎ', 'アーカイブ']) {
      expect(body, `メニューに「${label}」がありません`).toContain(label)
    }

    const detail = [...document.body.querySelectorAll('button')].find((el) => el.textContent === '詳細')
    expect(detail).toBeTruthy()
    await act(async () => { detail?.click() })
    expect(push).toHaveBeenCalledWith('/accounts/detail?id=account-a')
  })
})
