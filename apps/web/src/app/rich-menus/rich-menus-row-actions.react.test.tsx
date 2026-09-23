// @vitest-environment happy-dom
/*
 * #641: リッチメニュー一覧の行操作を「枠つき編集ボタン＋削除アイコン＋・・・」へ統一。
 * 文字リンク5個をやめ、表示先・複製・切替のつながりは「その他」メニューへ集約した
 * ことを実マウントで確かめる。削除の撮影口（szXsT）は維持する。
 */
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
      richMenuGroups: { ...actual.api.richMenuGroups, listPage, tapStats, external },
      folders: { ...actual.api.folders, list: listFolders },
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
  useAccount: () => ({ selectedAccount: { id: 'account-a', name: '本店' }, selectedAccountId: 'account-a', loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

import RichMenusPage from './page'

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
})

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

describe('#641 リッチメニュー一覧の行操作', () => {
  it('「編集」が枠つきボタン、削除は撮影口つきアイコン、残りは「・・・」メニュー', async () => {
    await act(async () => { root.render(<RichMenusPage />) })
    await flush()

    const edit = [...host.querySelectorAll('a')]
      .find((el) => el.getAttribute('href') === '/rich-menus/edit?id=g-1' && el.textContent?.includes('編集'))
    expect(edit, '枠つき「編集」ボタンが見つかりません').toBeTruthy()

    const del = host.querySelector('button[data-qa-open="szXsT"]')
    expect(del, '削除の撮影口が消えています').toBeTruthy()
    expect(del!.getAttribute('aria-label')).toBe('通常メニューを削除')

    const more = host.querySelector('button[aria-label="通常メニューのその他操作"]') as HTMLButtonElement
    expect(more, 'その他ボタンが見つかりません').toBeTruthy()
    act(() => { more.click() })
    const menu = host.querySelector('[role="menu"]')
    expect(menu, 'メニューが開きません').toBeTruthy()
    expect(menu!.textContent).toContain('表示先')
    expect(menu!.textContent).toContain('複製')
    expect(menu!.textContent).toContain('切替のつながりを見る')
  })
})
