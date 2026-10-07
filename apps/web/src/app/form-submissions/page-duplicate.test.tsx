// @vitest-environment happy-dom
/*
 * R230: 回答フォーム全体の複製（実マウント）。
 *
 * 見る筋書き:
 *   1. 行の「…」に「複製する」がある
 *   2. 押すと確認窓が出て、引き継ぐもの・引き継がないものが分かる
 *   3. 複製名を付けて実行すると、新しい下書きの編集画面へ進む
 */
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
  fetchApi.mockImplementation(async () => ({
    success: true,
    data: {
      items: [{ ...baseForm, id: 'f-1', name: '元のフォーム' }],
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
  it('行の「…」から複製でき、新しい下書きの編集画面へ進む', async () => {
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
      .find((el) => el.textContent === '複製')
    expect(duplicateItem).toBeTruthy()

    // 2. 確認窓に引き継ぐもの・引き継がないものが出る
    await act(async () => {
      duplicateItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})
    expect(document.body.textContent).toContain('「元のフォーム」を複製しますか？')
    expect(document.body.textContent).toContain('集まった回答・公開状態・集計は引き継ぎません')
    const nameInput = document.body.querySelector('input[value="元のフォームの複製"]') as HTMLInputElement | null
    expect(nameInput).toBeTruthy()

    // 3. 実行すると新しい下書きの編集画面へ進む
    const confirmButton = Array.from(document.body.querySelectorAll('button'))
      .find((el) => el.textContent === '複製する')
    expect(confirmButton).toBeTruthy()
    await act(async () => {
      confirmButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})
    expect(formsDuplicate).toHaveBeenCalledWith('f-1', 'account-a', '元のフォームの複製')
    expect(routerPush).toHaveBeenCalledWith('/form-submissions/edit?id=f-2&tab=basic')
  })
})
