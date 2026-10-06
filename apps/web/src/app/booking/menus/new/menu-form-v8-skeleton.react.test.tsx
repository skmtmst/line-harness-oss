// @vitest-environment happy-dom
/*
 * 予約メニューの作成・編集（V8）の「サクサク感」。
 * A: 候補の読み込み中は目に見える「読み込み中…」を置かず、骨組みの入れ物が読み込み中と伝える。
 * B: 保存ボタンは押した直後にボタンの中だけ「保存中…」へ変わり（busy）、画面を止めない。
 */
import React from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  push: null as null | ((...args: unknown[]) => void),
  tagsList: null as null | (() => Promise<unknown>),
  createMenu: null as null | ((...args: unknown[]) => Promise<unknown>),
  listMenus: null as null | (() => Promise<unknown>),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => fixture.push?.(...args), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [] }),
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
  usePageCrumbs: () => undefined,
}))
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label'?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

const memStorage = vi.hoisted(() => {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
  }
})
vi.stubGlobal('localStorage', memStorage)
memStorage.setItem('lh_staff_role', 'owner')

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  class ApiError extends Error {
    status: number
    code: string | undefined
    constructor(status: number, message?: string, code?: string) {
      super(message || `API error: ${status}`)
      this.name = 'ApiError'
      this.status = status
      this.code = code
    }
  }
  return {
    ...actual,
    ApiError,
    api: {
      tags: { list: (...args: unknown[]) => fixture.tagsList!(...(args as [])) },
      mileage: { rules: async () => ({ success: true, data: [] }) },
    },
    bookingApi: {
      listMenus: (...args: unknown[]) => fixture.listMenus!(...(args as [])),
      listStaff: async () => ({ staff: [{ id: 'staff-a', display_name: '担当A', is_active: 1 }] }),
      getSettings: async () => ({ success: true, data: { bookingWindowDays: 30 } }),
      listResources: async () => ({ success: true, data: { resources: [] } }),
      listStaffMenusBulk: async () => ({ staff: [] }),
      getStaffMenus: async () => ({ matrix: [] }),
      putStaffMenus: async () => ({ ok: true }),
      createMenu: (...args: unknown[]) => fixture.createMenu!(...(args as [])),
    },
  }
})

import NewBookingMenuPage from './page'

const TAGS = [
  { id: 'tag-1', name: '予約済み', lineAccountId: 'account-a', status: 'active' },
  { id: 'tag-2', name: '常連さん', lineAccountId: 'account-a', status: 'active' },
]

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  fixture.push = vi.fn()
  fixture.tagsList = async () => ({ success: true, data: TAGS })
  fixture.listMenus = async () => ({ menus: [] })
  fixture.createMenu = vi.fn(async () => ({ id: 'menu-new', version: 1 }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('メニュー作成（V8）の読み込みと保存ボタン', () => {
  test('タグ取得が遅れても「読み込み中…」の文字は出さず骨組みの入れ物で待つ', async () => {
    const gate = deferred<unknown>()
    fixture.tagsList = () => gate.promise
    render(<NewBookingMenuPage />)

    // 骨組みの入れ物が読み込み中と伝え、選ばせない。目に見える文字は置かない。
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(screen.queryByText('タグを読み込んでいます…')).toBeNull()
    expect(screen.queryByLabelText('予約後に付けるタグ')).toBeNull()

    await act(async () => { gate.resolve({ success: true, data: TAGS }) })
    const select = await screen.findByLabelText('予約後に付けるタグ') as HTMLSelectElement
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['— なし —', '予約済み', '常連さん'])
  })

  test('保存を押すとボタンの内側だけ「保存中…」になり成功したら一覧へ戻る', async () => {
    const gate = deferred<unknown>()
    fixture.createMenu = vi.fn(() => gate.promise)
    render(<NewBookingMenuPage />)
    await screen.findByLabelText('予約後に付けるタグ')

    fireEvent.change(screen.getByPlaceholderText('例: トリミング（小型犬）'), { target: { value: 'カット' } })
    fireEvent.click(screen.getByRole('button', { name: /担当A/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存して公開' }))

    // ボタンの内側だけ保存中に変わり、画面は止めない（入力欄は触れるまま）。
    const savingButton = await screen.findByRole('button', { name: '保存中…' })
    expect(savingButton.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByPlaceholderText('例: トリミング（小型犬）')).toBeTruthy()

    await act(async () => { gate.resolve({ id: 'menu-new', version: 1 }) })
    await waitFor(() => { expect(fixture.createMenu).toHaveBeenCalled() })
    await waitFor(() => { expect(fixture.push).toHaveBeenCalledWith('/booking/menus') })
  })
})
