// @vitest-environment happy-dom
/*
 * 予約スタッフの登録（V8）の「その場で確かめる入力」。
 * 名前欄を離れたとき（blur）に直し方を欄の下へ出す。文は保存時と同じ。
 * v7 は触らない。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  listMenus: null as null | ((...args: unknown[]) => Promise<unknown>),
  listStaff: null as null | ((...args: unknown[]) => Promise<unknown>),
  staffList: null as null | ((...args: unknown[]) => Promise<unknown>),
  createStaff: null as null | ((...args: unknown[]) => Promise<unknown>),
  putStaffMenus: null as null | ((...args: unknown[]) => Promise<unknown>),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

beforeEach(() => {
  memStorage.setItem('lh_staff_role', 'owner')
  document.documentElement.dataset.theme = 'v8'
  fixture.listMenus = async () => ({ menus: MENUS })
  fixture.listStaff = async () => ({ staff: [] })
  fixture.staffList = async () => ({ success: true, data: [] })
  fixture.createStaff = vi.fn(async () => ({ id: 'staff-new-1' }))
  fixture.putStaffMenus = vi.fn(async () => ({ ok: true }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  memStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('スタッフ登録（V8）の名前欄を離れたときの確かめ', () => {
  test('空のまま離れると保存前に欄の下へ直し方が出る', async () => {
    render(<NewBookingStaffPage />)
    const name = await screen.findByPlaceholderText('例: 田中 美咲')

    fireEvent.blur(name)
    expect(await screen.findByText('スタッフ名を入力してください')).toBeTruthy()
    expect(fixture.createStaff).not.toHaveBeenCalled()
  })

  test('名前を入れると直し方が消える', async () => {
    render(<NewBookingStaffPage />)
    const name = await screen.findByPlaceholderText('例: 田中 美咲')

    fireEvent.blur(name)
    await screen.findByText('スタッフ名を入力してください')

    fireEvent.change(name, { target: { value: '田中' } })
    expect(screen.queryByText('スタッフ名を入力してください')).toBeNull()
  })
})
