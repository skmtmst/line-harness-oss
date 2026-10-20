// @vitest-environment happy-dom
/* V8: row operations stay in the accessible menu; no direct destructive control. */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const listPage = vi.hoisted(() => vi.fn())
const tapStats = vi.hoisted(() => vi.fn())
const external = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: vi.fn(async () => ({ success: true, data: { id: 'owner-1', role: 'owner' } })) },
      richMenuGroups: { ...actual.api.richMenuGroups, listPage, tapStats, external },
      folders: { ...actual.api.folders, list: listFolders },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccount: { id: 'account-a', name: '本店' }, selectedAccountId: 'account-a', loading: false }),
}))

vi.mock('@/components/shell/page-chrome', async () => ({ ...(await import('@/test-utils/page-chrome-mock')).pageChromeMock(),
  usePageTitle: () => {},
}))

import RichMenusPage from '@/v8/rich-menus/list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const group = {
  id: 'g-1',
  name: '通常メニュー',
  status: 'published',
  size: 'large',
  chatBarText: 'メニュー',
  isDefaultForAll: true,
  targetingEnabled: false,
  targetingCondition: null,
  publishingAt: null,
  monthlyStats: { taps: 42, uniqueAudience: { value: 30, state: 'ready' } },
  updatedAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  window.history.replaceState({}, '', '/rich-menus')
  window.dispatchEvent(new PopStateEvent('popstate'))
  listPage.mockImplementation(async () => ({
    success: true,
    data: { items: [group], total: 1, facets: { total: 1, published: 1, targeting: 0, draft: 0, folderCounts: {} } },
  }))
  tapStats.mockImplementation(async () => ({ success: true, data: { from: '2026-08-01', to: '2026-09-01', byArea: [], byGroup: [], total: 0 } }))
  external.mockImplementation(async () => ({ success: true, data: { currentDefault: null, lineMenus: [] } }))
  listFolders.mockImplementation(async () => ({ success: true, data: [], unfiledCount: 0 }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
})

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

describe('#641 リッチメニュー一覧の行操作', () => {
  it('編集・表示先・複製・切替・削除は行の「…」メニュー', async () => {
    await act(async () => { root.render(<RichMenusPage />) })
    await flush()

    const edit = [...host.querySelectorAll('a')]
      .find((el) => el.getAttribute('href') === '/rich-menus/edit?id=g-1' && el.textContent?.includes('編集'))
    expect(edit, '行の右に編集ボタンを置かない').toBeUndefined()

    // 行にゴミ箱アイコンだけのボタンは置かない。
    expect(host.querySelector('button[aria-label="通常メニューを削除する"]'), 'ゴミ箱アイコンの直置きが残っています').toBeNull()

    const more = host.querySelector('button[aria-label="リッチメニュー「通常メニュー」の操作"]') as HTMLButtonElement
    expect(more, '「…」の撮影口が消えています').toBeTruthy()
    expect(more.getAttribute('aria-label')).toBe('リッチメニュー「通常メニュー」の操作')
    act(() => { more.click() })
    // メニューは最上層（MenuPortal→document.body）に出る。器の中にはいない。
    const menu = document.querySelector('[role="menu"]')
    expect(menu, 'メニューが開きません').toBeTruthy()
    expect(menu!.textContent).toContain('編集')
    expect(menu!.textContent).toContain('表示先')
    expect(menu!.textContent).toContain('複製')
    expect(menu!.textContent).toContain('切替のつながりを見る')
    expect(menu!.textContent).toContain('削除する')
  })
})
