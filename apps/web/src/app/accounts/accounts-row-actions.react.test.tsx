// @vitest-environment happy-dom
/*
 * #641: LINEアカウント一覧の行操作を「枠つき詳細ボタン」へ統一。
 * 文字リンク＋押せない「•••」の飾りをやめたことを実マウントで確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const listAccounts = vi.hoisted(() => vi.fn())

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
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

import AccountsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
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

describe('#641 LINEアカウント一覧の行操作', () => {
  it('操作欄は枠つき「詳細」ボタンで、押せない「•••」の飾りは無い', async () => {
    await act(async () => { root.render(<AccountsPage />) })
    await flush()

    const detail = [...host.querySelectorAll('a')]
      .find((el) => el.getAttribute('href') === '/accounts/detail?id=account-a' && el.textContent?.includes('詳細'))
    expect(detail, '枠つき「詳細」ボタンが見つかりません').toBeTruthy()
    expect(host.textContent).not.toContain('•••')
  })
})
