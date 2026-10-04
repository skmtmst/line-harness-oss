// @vitest-environment happy-dom
/*
 * 予約メニューの作成・編集（V8）の「その場で確かめる入力」。
 * 名前・かかる時間・後の空き時間の欄を離れたとき（blur）に直し方を
 * 欄の下へ出す。文は保存時と同じ。v7 は触らない。
 */
import React from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

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

const TAGS = [
  { id: 'tag-1', name: '予約済み', lineAccountId: 'account-a', status: 'active' },
]

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
      listStaff: async () => ({ staff: [] }),
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

async function renderForm() {
  render(<NewBookingMenuPage />)
  await screen.findByLabelText('予約後に付けるタグ')
}

describe('メニュー作成（V8）の欄を離れたときの確かめ', () => {
  test('空の名前欄を離れると保存前に欄の下へ直し方が出る', async () => {
    await renderForm()
    const name = screen.getByPlaceholderText('例: トリミング（小型犬）')

    fireEvent.change(name, { target: { value: '' } })
    fireEvent.blur(name)
    expect(await screen.findByText('メニュー名を入力してください')).toBeTruthy()
    expect(fixture.createMenu).not.toHaveBeenCalled()
  })

  test('名前を入れ直すと直し方が消える', async () => {
    await renderForm()
    const name = screen.getByPlaceholderText('例: トリミング（小型犬）')

    fireEvent.change(name, { target: { value: '' } })
    fireEvent.blur(name)
    await screen.findByText('メニュー名を入力してください')

    fireEvent.change(name, { target: { value: 'カット' } })
    expect(screen.queryByText('メニュー名を入力してください')).toBeNull()
  })

  test('かかる時間を空にして離れると直し方が出て直すと消える', async () => {
    await renderForm()
    const duration = screen.getByLabelText('かかる時間（分）')

    fireEvent.change(duration, { target: { value: '' } })
    fireEvent.blur(duration)
    expect(await screen.findByText('所要時間は1〜1440分の整数で入力してください')).toBeTruthy()

    fireEvent.change(duration, { target: { value: '60' } })
    expect(screen.queryByText('所要時間は1〜1440分の整数で入力してください')).toBeNull()
  })

  test('後の空き時間に変な値を入れて離れると直し方が出る', async () => {
    await renderForm()
    const buffer = screen.getByLabelText('後の空き時間（分）')

    fireEvent.change(buffer, { target: { value: '-1' } })
    fireEvent.blur(buffer)
    expect(await screen.findByText('後の空き時間は0〜1440分の整数で入力してください')).toBeTruthy()
    expect(fixture.createMenu).not.toHaveBeenCalled()
  })
})
