// @vitest-environment happy-dom
/*
 * V8 回答フォーム一覧（src/v8/forms）の動きの試験。BEHAVIOR.md の「今までと変えたところ」を守る。
 * 未分類の件数・閲覧のみの帯と押せない「フォルダを追加」・行の「…」の読み上げ名・1152 で保存先を出さない・表示件数 10/20/50。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const fetchApi = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())
const listStats = vi.hoisted(() => vi.fn())
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const narrow = vi.hoisted(() => ({ value: false }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const api = (actual as unknown as { api: Record<string, object> }).api
  return {
    ...actual,
    fetchApi,
    api: { ...api, folders: { ...api.folders, list: listFolders }, listStats: { get: listStats } },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', liffId: 'liff-a' }, loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.value }
})

vi.mock('@/lib/use-narrow-viewport', () => ({
  useNarrowViewport: () => narrow.value,
}))

import FormsListV8 from './list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const baseForm = {
  description: '来店後に感想を聞く',
  fields: [],
  layout: { version: 2, header: [], sections: [], options: {} },
  onSubmitTagId: null,
  isActive: true,
  status: 'active',
  revision: 1,
  submitCount: 12,
  monthlySubmitCount: 3,
  monthlyCompletionRate: 50,
  createdAt: '2026-08-01',
  updatedAt: '2026-08-02',
  lastSubmittedAt: null,
  usedByAccounts: [],
  destinationSummary: { friendFieldCount: 3, tagCount: 0 },
}

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function mount() {
  await act(async () => { root.render(<FormsListV8 />) })
  await flush()
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  role.value = 'owner'
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  window.localStorage.setItem('lh_staff_role', 'owner')
  narrow.value = false
  fetchApi.mockReset()
  fetchApi.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/forms?')) {
      return { success: true, data: { items: [{ ...baseForm, id: 'f-1', name: '来店アンケート', folderId: null }], total: 1, all_total: 1, page: 1, limit: 20 } }
    }
    return { success: true, data: {} }
  })
  listFolders.mockReset()
  listFolders.mockResolvedValue({ success: true, data: [{ id: 'fol-1', kind: 'form', name: '来店・予約', itemCount: 6, displayOrder: 0, color: null }], unfiledCount: 3 })
  listStats.mockReset()
  listStats.mockResolvedValue({ success: true, data: { forms: { published: 5, draft: 2, monthlySubmits: 712, prevMonthSubmits: 640, monthlyCompletionRate: 74, pendingPostActions: 2 } } })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('V8 回答フォーム一覧', () => {
  it('未分類の行にフォルダの口の unfiledCount を出す', async () => {
    await mount()
    const unfiled = screen.getByRole('button', { name: /未分類/ })
    expect(unfiled.textContent).toContain('3')
  })

  it('行の名前の前に、左のフォルダの列と同じ色の丸が付く（未分類は輪）', async () => {
    fetchApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/forms?')) {
        return {
          success: true,
          data: {
            items: [
              { ...baseForm, id: 'f-1', name: '来店アンケート', folderId: 'fol-1' },
              { ...baseForm, id: 'f-2', name: 'イベント申込', folderId: null },
            ],
            total: 2, all_total: 2, page: 1, limit: 20,
          },
        }
      }
      return { success: true, data: {} }
    })
    listFolders.mockResolvedValue({ success: true, data: [{ id: 'fol-1', kind: 'form', name: '来店・予約', itemCount: 6, displayOrder: 0, color: '#2f6fde' }], unfiledCount: 3 })
    await mount()
    const filed = host.querySelector('tr[data-row-id="f-1"]')?.querySelectorAll('[data-folder-dot]') ?? []
    expect(filed).toHaveLength(1)
    expect(filed[0].getAttribute('data-folder-dot')).toBe('filed')
    expect(filed[0].getAttribute('aria-label')).toBe('フォルダ：来店・予約')
    const unfiled = host.querySelector('tr[data-row-id="f-2"]')?.querySelectorAll('[data-folder-dot]') ?? []
    expect(unfiled).toHaveLength(1)
    expect(unfiled[0].getAttribute('data-folder-dot')).toBe('unfiled')
  })

  it('行の「…」は「「〇〇」のその他の操作」で押せて、項目が開く', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '「来店アンケート」のその他の操作' }))
    await flush()
    expect(screen.getByRole('menuitem', { name: '受付を止める' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '削除' })).toBeTruthy()
  })

  it('変えられない人には閲覧のみの帯が出て、「フォルダを追加」は出さない（押せない飾りを置かない）', async () => {
    role.value = 'staff'
    await mount()
    expect(screen.getByText('閲覧のみで見ています。変える操作は管理者に頼んでください。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /フォルダを追加/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /フォームを作る/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '「来店アンケート」のその他の操作' }))
    await flush()
    expect(screen.getByRole('menuitem', { name: '集まった回答' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '編集' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '削除' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '「来店アンケート」の詳細を見る' }))
    await flush()
    expect(screen.queryByRole('button', { name: 'フォーム名を変更する' })).toBeNull()
    expect(screen.queryByText('編集する')).toBeNull()
    expect(screen.queryByRole('button', { name: '複製' })).toBeNull()
  })

  it('フォームの編集権限がある staff は変更でき、フォルダの管理だけは出さない', async () => {
    role.value = 'staff'
    window.localStorage.setItem('lh_staff_role', 'staff')
    window.localStorage.setItem('lh_staff_permissions', JSON.stringify(['/form-submissions']))
    await mount()
    expect(screen.getAllByRole('button', { name: /フォームを作る/ }).length).toBeGreaterThan(0)
    expect(screen.queryByText('閲覧のみで見ています。変える操作は管理者に頼んでください。')).toBeNull()
    expect(screen.queryByRole('button', { name: /フォルダを追加/ })).toBeNull()
  })

  it('管理できる人には帯を出さず、「フォルダを追加」を押せる', async () => {
    await mount()
    expect(screen.queryByText('閲覧のみで見ています。変える操作は管理者に頼んでください。')).toBeNull()
    const add = screen.getByRole('button', { name: /フォルダを追加/ }) as HTMLButtonElement
    expect(add.disabled).toBe(false)
  })

  it('1152 の板では保存先の列を出さない', async () => {
    narrow.value = true
    await mount()
    expect(screen.queryByRole('columnheader', { name: '保存先' })).toBeNull()
    expect(screen.queryByText('友だち情報 3')).toBeNull()
  })

  it('広い板では保存先の列を出す', async () => {
    await mount()
    expect(screen.getByRole('columnheader', { name: '保存先' })).toBeTruthy()
    expect(screen.getByText('友だち情報 3')).toBeTruthy()
  })

  it('1ページに収まるときは件数だけ（N件）', async () => {
    await mount()
    expect(screen.getByText('1件')).toBeTruthy()
  })

  it('一覧の口へ件数 20・最新の回答順で頼む', async () => {
    await mount()
    const listCall = fetchApi.mock.calls.map(([path]) => String(path)).find((path) => path.startsWith('/api/forms?'))
    expect(listCall).toContain('limit=20')
    expect(listCall).toContain('sort=latest-answer')
    expect(listCall).toContain('with_list_summary=1')
  })

  it('件数が1ページを超えるときは共通の ListRange で「N件中 X〜Y件を表示」と出す', async () => {
    fetchApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/forms?')) {
        return {
          success: true,
          data: {
            items: [
              { ...baseForm, id: 'f-1', name: '来店アンケート', folderId: null },
              { ...baseForm, id: 'f-2', name: '予約後アンケート', folderId: null },
            ],
            total: 45, all_total: 45, page: 1, limit: 20,
          },
        }
      }
      return { success: true, data: {} }
    })
    await mount()
    expect(host.textContent).toContain('45件中 1〜2件を表示')
  })
})

/*
 * 2026-10-06 点検：表全体を1つの右クリックで包み、押した行を state に入れてから項目を作っていたので、
 * 1回目の右クリックでは空で開かず、2回目は前に押した行の項目が出ていた。
 */
describe('V8 回答フォーム一覧の右クリック', () => {
  beforeEach(() => {
    fetchApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/forms?')) {
        return {
          success: true,
          data: {
            items: [
              { ...baseForm, id: 'f-1', name: '来店アンケート', folderId: null },
              { ...baseForm, id: 'f-2', name: '受付を終えたアンケート', folderId: null, isActive: false },
            ],
            total: 2, all_total: 2, page: 1, limit: 20,
          },
        }
      }
      return { success: true, data: {} }
    })
  })

  const rowCell = (id: string) => {
    const row = host.querySelector(`tr[data-row-id="${id}"]`)
    expect(row, `${id} の行がある`).toBeTruthy()
    return row!.querySelector('td')!
  }
  const openMenu = () => document.body.querySelector('[data-context-menu] [role="menu"]')

  it('1回目の右クリックで、押した行の項目のメニューが開く', async () => {
    await mount()
    await act(async () => { fireEvent.contextMenu(rowCell('f-2'), { clientX: 80, clientY: 140 }) })
    await flush()
    const menu = openMenu()
    expect(menu, '1回目で開く').toBeTruthy()
    expect(menu!.getAttribute('aria-label')).toBe('「受付を終えたアンケート」の操作')
    // 止まっているフォームには「受付を止める」が無い（押した行の中身で作っている）。
    expect(menu!.textContent).toContain('フォルダへ移す')
    expect(menu!.textContent).not.toContain('受付を止める')
  })

  it('続けて別の行を右クリックすると、前の行ではなくその行の項目が出る', async () => {
    await mount()
    await act(async () => { fireEvent.contextMenu(rowCell('f-2'), { clientX: 80, clientY: 140 }) })
    await flush()
    await act(async () => { fireEvent.keyDown(openMenu()!, { key: 'Escape' }) })
    await flush()
    expect(openMenu()).toBeNull()
    await act(async () => { fireEvent.contextMenu(rowCell('f-1'), { clientX: 80, clientY: 100 }) })
    await flush()
    const menu = openMenu()
    expect(menu, '2回目も開く').toBeTruthy()
    expect(menu!.getAttribute('aria-label')).toBe('「来店アンケート」の操作')
    expect(menu!.textContent).toContain('受付を止める')
  })
})
