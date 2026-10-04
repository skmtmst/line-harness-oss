// @vitest-environment happy-dom
/*
 * 行の操作は「主な1つ（詳細）＋…メニュー」。削除は行に直に置かず、
 * メニューの中の危ない操作にあることを実マウントで確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const fetchApi = vi.hoisted(() => vi.fn())
const routerPush = vi.hoisted(() => vi.fn())
const remindersDelete = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchApi,
    // 削除の口は api.ts の中で内部 fetch を使うため、口ごと差し替える。
    api: { ...actual.api, reminders: { ...actual.api.reminders, delete: remindersDelete } },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => 'owner' }
})

vi.mock('@/components/shared/list-kpis', () => ({
  default: () => null,
}))

import RemindersPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  routerPush.mockClear()
  remindersDelete.mockResolvedValue({ success: true, data: null })
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

describe('リマインダ一覧の行操作', () => {
  it('行に名前のリンクと「…」が並び、削除は行に無い', async () => {
    await act(async () => { root.render(<RemindersPage />) })
    await flush()

    const name = [...host.querySelectorAll('a')]
      .find((el) => el.getAttribute('href') === '/reminders/detail?id=r-1' && el.textContent?.includes('予約前のお知らせ'))
    expect(name, '名前のリンクが見つかりません').toBeTruthy()

    expect(host.querySelector('button[aria-label="予約前のお知らせを削除する"]')).toBeNull()

    const more = host.querySelector('button[aria-label="リマインダ「予約前のお知らせ」の操作"]') as HTMLButtonElement
    expect(more, '操作ボタンが見つかりません').toBeTruthy()
  })

  it('「…」を押すとメニュー（詳細・登録者を管理など）と削除が開く', async () => {
    await act(async () => { root.render(<RemindersPage />) })
    await flush()
    const more = host.querySelector('button[aria-label="リマインダ「予約前のお知らせ」の操作"]') as HTMLButtonElement
    act(() => { more.click() })
    // メニューは最上層（MenuPortal→document.body）に出る。器の中にはいない。
    const menu = document.querySelector('[role="menu"]')
    expect(menu, 'メニューが開きません').toBeTruthy()
    expect(menu!.textContent).toContain('詳細を見る')
    expect(menu!.textContent).toContain('登録者を管理')
    expect(menu!.textContent).toContain('削除')
  })

  it('メニューの「削除」は確認の窓を出し、詳細へは移動しない', async () => {
    await act(async () => { root.render(<RemindersPage />) })
    await flush()
    const more = host.querySelector('button[aria-label="リマインダ「予約前のお知らせ」の操作"]') as HTMLButtonElement
    act(() => { more.click() })
    // メニューは最上層（MenuPortal→document.body）に出る。器の中にはいない。
    const item = [...document.querySelectorAll('[role="menuitem"]')]
      .find((el) => el.textContent === '削除') as HTMLButtonElement
    await act(async () => { item.click() })
    await flush()
    // 削除の確認が出る（確認の窓は body 直下の portal）。行の詳細遷移（router.push）は動かない。
    expect(document.body.textContent).toContain('「予約前のお知らせ」を削除する')
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('確認で「削除する」を押すと、その行だけ消える', async () => {
    await act(async () => { root.render(<RemindersPage />) })
    await flush()
    const more = host.querySelector('button[aria-label="リマインダ「予約前のお知らせ」の操作"]') as HTMLButtonElement
    act(() => { more.click() })
    // メニューは最上層（MenuPortal→document.body）に出る。器の中にはいない。
    const item = [...document.querySelectorAll('[role="menuitem"]')]
      .find((el) => el.textContent === '削除') as HTMLButtonElement
    await act(async () => { item.click() })
    await flush()
    const confirm = [...document.body.querySelectorAll('button')]
      .find((el) => el.textContent === '削除する') as HTMLButtonElement
    expect(confirm, '確認の窓の「削除する」が見つかりません').toBeTruthy()
    await act(async () => { confirm.click() })
    await flush()
    // その行（r-1）だけを消しに行く。確認の窓は閉じる。
    expect(remindersDelete).toHaveBeenCalledTimes(1)
    expect(remindersDelete).toHaveBeenCalledWith('r-1')
    expect(document.body.textContent).not.toContain('を削除しますか？')
  })
})
