// @vitest-environment happy-dom
/*
 * 追加発見: ログインユーザー一覧の取得失敗と「誰もいない」を言い分ける。
 *
 * - 失敗時は「紐づけない」だけの選択肢にせず、画面内で再取得できる。
 * - 本当の0件は今までどおり選択肢だけで、再取得は出さない。
 * - 再取得で直れば候補が出て、入力済みの名前は残る。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  listMenus: null as null | ((...args: unknown[]) => Promise<unknown>),
  memberList: null as null | (() => Promise<unknown>),
  createStaff: null as null | ((...args: unknown[]) => Promise<unknown>),
  putStaffMenus: null as null | ((...args: unknown[]) => Promise<unknown>),
  push: null as null | ((...args: unknown[]) => void),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => fixture.push!(...args), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a' }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
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
    api: { staff: { list: () => fixture.memberList!() } },
    bookingApi: {
      listMenus: (...args: unknown[]) => fixture.listMenus!(...(args as [])),
      createStaff: (...args: unknown[]) => fixture.createStaff!(...args),
      putStaffMenus: (...args: unknown[]) => fixture.putStaffMenus!(...args),
    },
  }
})

import NewBookingStaffPage from './page'

// 画面は localStorage の権限表を読む。happy-dom では未定義なので
// インメモリに差し替え、owner（全通過）にする。
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
  { id: 'menu-1', name: 'カット', duration_minutes: 60, base_price: 8000, price_mode: 'fixed' },
]

const MEMBERS = [
  { id: 'member-1', name: '管理者', email: 'owner@example.com', isActive: true },
]

beforeEach(() => {
  memStorage.setItem('lh_staff_role', 'owner')
  fixture.listMenus = async () => ({ menus: MENUS })
  fixture.memberList = async () => ({ success: true, data: MEMBERS })
  fixture.createStaff = vi.fn(async () => ({ id: 'staff-new-1' }))
  fixture.putStaffMenus = vi.fn(async () => ({ ok: true }))
  fixture.push = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  memStorage.clear()
})

async function renderNew() {
  render(<NewBookingStaffPage />)
  await screen.findByText('ログインユーザーとの紐づけ')
}

describe('追加発見 ログインユーザー一覧の取得失敗と未設定を言い分ける', () => {
  test('取得失敗は選択肢だけにせず再取得の口を出す', async () => {
    fixture.memberList = async () => { throw new Error('network down') }
    await renderNew()

    expect(await screen.findByText('ログインユーザーを読み込めませんでした')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeTruthy()
  })

  test('本当の0件は選択肢だけで再取得は出さない', async () => {
    fixture.memberList = async () => ({ success: true, data: [] })
    await renderNew()

    await screen.findByRole('combobox', { name: 'ログインユーザーとの紐づけ' })
    expect(screen.queryByText('ログインユーザーを読み込めませんでした')).toBeNull()
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull()
  })

  test('再取得で直れば候補が出て入力済みの名前は残る', async () => {
    let fail = true
    fixture.memberList = async () => {
      if (fail) throw new Error('network down')
      return { success: true, data: MEMBERS }
    }
    await renderNew()
    await screen.findByText('ログインユーザーを読み込めませんでした')

    const name = screen.getByPlaceholderText('例: 田中 美咲') as HTMLInputElement
    fireEvent.change(name, { target: { value: '田中' } })

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))

    await screen.findByText('管理者（owner@example.com）')
    expect(screen.queryByText('ログインユーザーを読み込めませんでした')).toBeNull()
    expect((screen.getByPlaceholderText('例: 田中 美咲') as HTMLInputElement).value).toBe('田中')
  })
})
