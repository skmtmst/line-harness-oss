// @vitest-environment happy-dom
/* B-177・R230：複製は確認窓を出さず、一覧の元の行の下へ下書きを追加する。 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchApi = vi.hoisted(() => vi.fn())
const apiFolders = vi.hoisted(() => ({ list: vi.fn() }))
const formsDuplicate = vi.hoisted(() => vi.fn())
const routerPush = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const api = (actual as unknown as { api: Record<string, Record<string, unknown>> }).api
  return {
    ...actual,
    fetchApi,
    api: { ...api, folders: apiFolders, forms: { ...api.forms, duplicate: formsDuplicate } },
  }
})

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

/* 役割はサーバへ聞かず、手元の値（lh_staff_role）で決める。新しい一覧は答えが来るまで手元の値を使う。 */
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => null }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

/* 新しい一覧（src/v8/forms/list.tsx）を描く。2026-10-06 に `./list-v8` から向け直した。 */
import FormSubmissionsPage from '@/v8/forms/list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const baseForm = {
  description: null,
  fields: [],
  layout: { version: 2, header: [], sections: [], options: {} },
  onSubmitTagId: null,
  isActive: false,
  status: 'active',
  revision: 1,
  createdAt: '2026-08-01',
  updatedAt: '2026-08-02',
  lastSubmittedAt: null,
  usedByAccounts: [],
  submitCount: 0,
  folderId: null,
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'lh_staff_role' ? 'admin' : null),
    setItem: () => {},
    removeItem: () => {},
  })
  fetchApi.mockImplementation(async (path: string) => ({
    success: true,
    data: {
      items: [path.includes('q=') ? { ...baseForm, id: 'f-2', name: '元のフォームのコピー' } : { ...baseForm, id: 'f-1', name: '元のフォーム' }],
      total: 1, all_total: 1, page: 1, limit: 20,
    },
  }))
  apiFolders.list.mockImplementation(async () => ({ success: true, data: [] }))
  formsDuplicate.mockImplementation(async () => ({ success: true, data: { id: 'f-2', isActive: false } }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

describe('フォーム全体の複製（R230・実マウント）', () => {
  it('行の「…」から1件だけ複製し、一覧に下書きを足す', async () => {
    await act(async () => {
      root.render(<FormSubmissionsPage />)
    })
    await act(async () => {})

    // 1. 行の「…」に「複製」がある
    const menuButton = host.querySelector('button[aria-label^="「元のフォーム」のその他の操作"]')
    expect(menuButton).toBeTruthy()
    await act(async () => {
      menuButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // メニューは最上層の portal に出る（一覧の表で切られないため）。document で探す。
    const duplicateItem = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((el) => el.textContent === '複製する')
    expect(duplicateItem).toBeTruthy()

    await act(async () => {
      duplicateItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})
    expect(formsDuplicate).toHaveBeenCalledTimes(1)
    expect(formsDuplicate).toHaveBeenCalledWith('f-1', 'account-a', '元のフォームのコピー')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(routerPush).not.toHaveBeenCalled()
    const rows = Array.from(host.querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('元のフォーム')
    expect(rows[1].textContent).toContain('元のフォームのコピー')
    expect(rows[1].textContent).toContain('下書き')
  })
})
