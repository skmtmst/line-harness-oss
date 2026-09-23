// @vitest-environment happy-dom
/*
 * #641: リマインダ一覧の行操作を「枠つき詳細ボタン＋削除アイコン＋・・・」へ統一。
 * 削除とその他メニューだけだった行に、主操作の枠つきボタンが出ることを
 * 実マウントで確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const fetchApi = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, fetchApi }
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

vi.mock('@/components/shared/list-kpis', () => ({
  default: () => null,
}))

import RemindersPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fetchApi.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/folders')) {
      return { success: true, data: [], unfiledCount: 0 }
    }
    return {
      success: true,
      data: {
        items: [{
          id: 'r-1', name: '予約前のお知らせ', description: null, isActive: true, folderId: null,
          lifecycleStatus: 'published', stepCount: 1, displayOrder: 0,
          plannedDeliveries: null, lastSentAt: null,
          createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
        }],
        total: 1, limit: 20, sort: [],
      },
    }
  })
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

describe('#641 リマインダ一覧の行操作', () => {
  it('行の先頭に枠つき「詳細」ボタン、削除アイコン、「・・・」が並ぶ', async () => {
    await act(async () => { root.render(<RemindersPage />) })
    await flush()

    const detail = [...host.querySelectorAll('a')]
      .find((el) => el.getAttribute('href') === '/reminders/detail?id=r-1' && el.textContent?.includes('詳細'))
    expect(detail, '枠つき「詳細」ボタンが見つかりません').toBeTruthy()

    const del = host.querySelector('button[aria-label="予約前のお知らせを削除"]')
    expect(del, '削除アイコンが見つかりません').toBeTruthy()

    const more = host.querySelector('button[aria-label="予約前のお知らせのその他操作"]') as HTMLButtonElement
    expect(more, 'その他ボタンが見つかりません').toBeTruthy()
  })

  it('「・・・」を押すとメニュー（登録者を管理など）が開く', async () => {
    await act(async () => { root.render(<RemindersPage />) })
    await flush()
    const more = host.querySelector('button[aria-label="予約前のお知らせのその他操作"]') as HTMLButtonElement
    act(() => { more.click() })
    const menu = host.querySelector('[role="menu"]')
    expect(menu, 'メニューが開きません').toBeTruthy()
    expect(menu!.textContent).toContain('登録者を管理')
    expect(menu!.textContent).toContain('配信予定を確認')
  })
})
