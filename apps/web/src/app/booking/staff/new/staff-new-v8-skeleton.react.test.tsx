// @vitest-environment happy-dom
/*
 * 予約スタッフの登録（V8）の「サクサク感」（V8 のときだけ）。
 * A: メニュー・ログインユーザーの読み込み中は目に見える「読み込み中」の
 *    文字を置かず、骨組みの入れ物が読み込み中と伝える。
 * B: 登録ボタンは押した直後に内側だけ「登録しています…」へ変わる。
 * v7 は従来の見た目のまま（この試験では触らない）。
 */
import React from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  listMenus: null as null | ((...args: unknown[]) => Promise<unknown>),
  listStaff: null as null | ((...args: unknown[]) => Promise<unknown>),
  staffList: null as null | ((...args: unknown[]) => Promise<unknown>),
  createStaff: null as null | ((...args: unknown[]) => Promise<unknown>),
  putStaffMenus: null as null | ((...args: unknown[]) => Promise<unknown>),
  push: null as null | ((...args: unknown[]) => void),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => fixture.push?.(...args), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
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
    api: { staff: { list: (...args: unknown[]) => fixture.staffList!(...(args as [])) } },
    bookingApi: {
      listMenus: (...args: unknown[]) => fixture.listMenus!(...(args as [])),
      listStaff: (...args: unknown[]) => fixture.listStaff!(...(args as [])),
      createStaff: (...args: unknown[]) => fixture.createStaff!(...(args as [])),
      putStaffMenus: (...args: unknown[]) => fixture.putStaffMenus!(...(args as [])),
    },
  }
})

import NewBookingStaffPage from './page'

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

const MENUS = [
  { id: 'menu-1', name: 'カット', duration_minutes: 60, base_price: 8000, price_mode: 'fixed', is_active: 1 },
]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  memStorage.setItem('lh_staff_role', 'owner')
  document.documentElement.dataset.theme = 'v8'
  fixture.listMenus = async () => ({ menus: MENUS })
  fixture.listStaff = async () => ({ staff: [] })
  fixture.staffList = async () => ({ success: true, data: [] })
  fixture.createStaff = vi.fn(async () => ({ id: 'staff-new-1' }))
  fixture.putStaffMenus = vi.fn(async () => ({ ok: true }))
  fixture.push = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  memStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('スタッフ登録（V8）の読み込みと登録ボタン', () => {
  test('メニュー取得が遅れても文字は出さず札の形の骨組みで待つ', async () => {
    const gate = deferred<unknown>()
    fixture.listMenus = () => gate.promise
    render(<NewBookingStaffPage />)

    // V8 に切り替わるまで待ってから、読み込み中の入れ物を確かめる。
    await waitFor(() => { expect(document.querySelector('[aria-busy="true"]')).toBeTruthy() })
    const loadingTexts = screen.queryAllByText('メニューを読み込んでいます')
    expect(loadingTexts.length).toBe(1)
    expect(loadingTexts[0].className).toContain('sr-only')
    // 骨組みは 0.3 秒待ってから出る。
    await waitFor(() => { expect(document.querySelector('[data-skeleton]')).toBeTruthy() })

    await act(async () => { gate.resolve({ menus: MENUS }) })
    expect(await screen.findByRole('button', { name: /カット/ })).toBeTruthy()
  })

  test('ログインユーザー取得が遅れても文字は出さず枠の骨組みで待つ', async () => {
    const gate = deferred<unknown>()
    fixture.staffList = () => gate.promise
    render(<NewBookingStaffPage />)

    await waitFor(() => { expect(document.querySelector('[aria-busy="true"]')).toBeTruthy() })
    const loadingTexts = screen.queryAllByText('ログインユーザーを読み込んでいます')
    expect(loadingTexts.length).toBe(1)
    expect(loadingTexts[0].className).toContain('sr-only')

    await act(async () => { gate.resolve({ success: true, data: [] }) })
    expect(await screen.findByLabelText('ログインユーザーとの紐づけ')).toBeTruthy()
  })

  test('登録を押すとボタンの内側だけ「登録しています…」になる', async () => {
    const gate = deferred<unknown>()
    fixture.createStaff = vi.fn(() => gate.promise)
    render(<NewBookingStaffPage />)
    await screen.findByRole('button', { name: /カット/ })

    fireEvent.change(screen.getByPlaceholderText('例: 田中 美咲'), { target: { value: '田中' } })
    fireEvent.click(screen.getByRole('button', { name: /カット/ }))
    fireEvent.click(screen.getByRole('button', { name: 'スタッフを追加する' }))

    // ボタンの内側だけ登録中に変わり、入力欄は触れるまま。
    expect(await screen.findByRole('button', { name: '登録しています…' })).toBeTruthy()
    expect(screen.getByPlaceholderText('例: 田中 美咲')).toBeTruthy()

    await act(async () => { gate.resolve({ id: 'staff-new-1' }) })
    await waitFor(() => { expect(fixture.createStaff).toHaveBeenCalled() })
    await waitFor(() => { expect(fixture.push).toHaveBeenCalled() })
  })
})
