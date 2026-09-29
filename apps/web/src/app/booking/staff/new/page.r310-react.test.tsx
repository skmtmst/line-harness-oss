// @vitest-environment happy-dom
/*
 * R309/R310: スタッフ追加を実物の React で描いて確かめる。
 *
 * - R309: メニュー候補の料金は一覧と同じ言葉（お問い合わせ・¥）で出す。
 * - R310: 割当だけ失敗しても再試行でスタッフを作り直さない。
 *   控えたIDを使い回し、割当だけ送り直す。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  listMenus: null as null | (() => Promise<unknown>),
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
    api: { staff: { list: async () => ({ success: true, data: [] }) } },
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
  { id: 'menu-2', name: '相談', duration_minutes: 30, base_price: 0, price_mode: 'inquiry' },
]

beforeEach(() => {
  memStorage.setItem('lh_staff_role', 'owner')
  fixture.listMenus = async () => ({ menus: MENUS })
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
  await screen.findByText('予約を受けられるメニュー')
}

async function fillAndSave() {
  fireEvent.change(screen.getByPlaceholderText('例: 田中 美咲'), { target: { value: '田中' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /カット/ }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'スタッフを登録' }))
  })
}

describe('R309 メニュー候補の料金は一覧と同じ言葉', () => {
  test('お問い合わせは¥0と出さない', async () => {
    await renderNew()
    expect(screen.getByText('30分 / お問い合わせ')).toBeTruthy()
    expect(screen.getByText('60分 / ¥8,000')).toBeTruthy()
    expect(screen.queryByText(/¥0/)).toBeNull()
  })
})

describe('R310 割当だけ失敗してもスタッフを作り直さない', () => {
  test('再試行は控えたIDの割当だけ送り直す', async () => {
    let putShouldFail = true
    fixture.putStaffMenus = vi.fn(async () => {
      if (putShouldFail) throw new Error('network down')
      return { ok: true }
    })
    await renderNew()
    await fillAndSave()

    // 部分成功：何が済んで何が残っているかを出す。
    await screen.findByText('スタッフは登録できましたが、担当メニューの設定に失敗しました。入力は残っています。「割当をやり直す」を押してください。')
    expect(screen.getByText('スタッフは登録済みです。担当メニューの設定が残っています')).toBeTruthy()
    expect(fixture.createStaff).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '割当をやり直す' })).toBeTruthy()

    // やり直しは同じIDの割当だけ。スタッフは増やさない。
    putShouldFail = false
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '割当をやり直す' }))
    })
    await waitFor(() => { expect(fixture.push).toHaveBeenCalled() })
    expect(fixture.createStaff).toHaveBeenCalledTimes(1)
    expect(fixture.putStaffMenus).toHaveBeenCalledTimes(2)
    expect(fixture.putStaffMenus).toHaveBeenLastCalledWith('account-a', 'staff-new-1', [
      { menu_id: 'menu-1', is_offered: true, override_duration_minutes: null, override_price: null },
      { menu_id: 'menu-2', is_offered: false, override_duration_minutes: null, override_price: null },
    ])
    expect(fixture.push).toHaveBeenCalledWith(expect.stringContaining('/booking/menus?tab=staff'))
  })
})
