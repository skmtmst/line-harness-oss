// @vitest-environment happy-dom
/*
 * Issue #709残件: 28予約メニューの「⠿」は掴めない飾りだったので置かず、
 * 並び順の変更は操作列の↑↓ボタンで行うことを、実物の React を描いて確かめる。
 *
 * ソース文字列の検査では次が固定できない。ここでは happy-dom へ実物の画面を
 * マウントし、一覧の取得を実物の Promise で返してから確かめる。
 *
 *   - ⠿の飾りが画面に出ないこと
 *   - 各行の操作列に「○○を上へ」「○○を下へ」ボタンがあること
 *   - 先頭の上へ・末尾の下へは押せないこと
 *   - ↑↓を押すと2件の sort_order を交換した updateMenu PUT が送られること
 *   - 失敗したら role="alert" で理由が出ること
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'

const localStorageValues = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localStorageValues.set(key, String(value)) },
    removeItem: (key: string) => { localStorageValues.delete(key) },
    clear: () => { localStorageValues.clear() },
  },
})

const fixture = vi.hoisted(() => ({
  selectedAccountId: 'account-a' as string | null,
  activeTab: 'menus',
  updateMenu: null as null | ((...args: unknown[]) => Promise<unknown>),
  listMenus: null as null | ((...args: unknown[]) => Promise<unknown>),
  getSettings: null as null | ((...args: unknown[]) => Promise<unknown>),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.selectedAccountId }),
}))

vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => <nav aria-label="予約設定のタブ" />,
  useMergedTab: () => fixture.activeTab,
}))

vi.mock('@/app/booking/staff/page', () => ({
  default: () => <section>担当スタッフ</section>,
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    code: string | undefined
    constructor(status: number, message?: string, code?: string) {
      super(message || `API error: ${status}`)
      this.name = 'ApiError'
      this.status = status
      this.code = code
    }
  },
  api: {
    tags: { list: async () => ({ success: true, data: [] }) },
  },
  bookingApi: {
    updateMenu: (...args: unknown[]) => fixture.updateMenu!(...args),
    listMenus: (...args: unknown[]) => fixture.listMenus!(...args),
    patchMenu: async () => ({ ok: true }),
    getSettings: (...args: unknown[]) => fixture.getSettings!(...args),
    saveSettings: async () => ({ success: true, data: {} }),
    listResources: async () => ({ data: { resources: [] } }),
    saveMenuResources: async () => ({ success: true, data: { id: 'menu-1', version: 2, resources: [] } }),
  },
}))

import MenusPage from './page'

const SETTINGS = {
  id: null,
  lineAccountId: 'account-a',
  organizationName: '本店',
  version: 0,
  timeZone: 'Asia/Tokyo',
  bookingWindowDays: 60,
  cutoffMinutesBefore: 1440,
  cancelDeadlineMinutesBefore: 1440,
  maxActiveBookingsPerFriend: 1,
  approvalMode: 'automatic',
  holdMinutes: 15,
  slotGranularityMinutes: 15,
  menuCount: 2,
  activeMenuCount: 2,
  inactiveMenuCount: 0,
  businessHours: [],
  exceptions: [],
  updatedAt: '2026-09-01T00:00:00+09:00',
}

function menuBase(id: string, name: string, sortOrder: number) {
  return {
    id, name, category_label: null, description: null,
    duration_minutes: 60, buffer_after_minutes: 0, base_price: 8000,
    price_mode: 'fixed', sort_order: sortOrder, is_active: 1, auto_tag_id: null,
    concurrent_capacity: 1, booking_window_days: null, cutoff_hours_before: null,
    cancel_deadline_hours_before: null, intake_question: null,
    assigned_staff: [{ id: 'staff-a', display_name: '担当A' }],
    assigned_resources: [],
    version: 1,
  }
}

const MENUS = [menuBase('menu-1', 'カット', 0), menuBase('menu-2', 'カラー', 1)]

beforeEach(() => {
  window.localStorage.setItem('lh_staff_role', 'owner')
  clearToastsForTest()
  fixture.selectedAccountId = 'account-a'
  fixture.activeTab = 'menus'
  fixture.updateMenu = vi.fn(async () => ({ ok: true }))
  fixture.listMenus = vi.fn(async () => ({ menus: MENUS.map((m) => ({ ...m })) }))
  fixture.getSettings = vi.fn(async () => ({ success: true, data: SETTINGS }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('Issue #709残件: 28予約メニューの↑↓並び替え', () => {
  test('⠿の飾りが出ず、各行に上へ/下へボタンがある', async () => {
    const { container } = render(<><MenusPage /><ToastHost /></>)
    await screen.findByRole('button', { name: 'カラーを上へ' })

    expect(container.textContent).not.toContain('⠿')
    expect(screen.getByRole('button', { name: 'カットを下へ' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'カラーを下へ' })).toBeTruthy()
    // 注意書きに↑↓の導線を書く。
    expect(screen.getByText(/操作列の↑↓で変えられます/)).toBeTruthy()
  })

  test('先頭の上へ・末尾の下へは押せない', async () => {
    render(<><MenusPage /><ToastHost /></>)
    await screen.findByRole('button', { name: 'カラーを上へ' })

    expect((screen.getByRole('button', { name: 'カットを上へ' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'カラーを下へ' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'カラーを上へ' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'カットを下へ' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('下へを押すと2件のsort_orderを交換したPUTが送られる', async () => {
    render(<><MenusPage /><ToastHost /></>)
    await screen.findByRole('button', { name: 'カラーを上へ' })

    fireEvent.click(screen.getByRole('button', { name: 'カットを下へ' }))
    await waitFor(() => expect(fixture.updateMenu).toHaveBeenCalledTimes(2))
    expect(fixture.updateMenu).toHaveBeenNthCalledWith(
      1, 'account-a', 'menu-1', 1, expect.objectContaining({ sort_order: 1 }),
    )
    expect(fixture.updateMenu).toHaveBeenNthCalledWith(
      2, 'account-a', 'menu-2', 1, expect.objectContaining({ sort_order: 0 }),
    )
  })

  test('失敗したらalertで理由が出る', async () => {
    fixture.updateMenu = vi.fn(async () => { throw new Error('down') })
    render(<><MenusPage /><ToastHost /></>)
    await screen.findByRole('button', { name: 'カラーを上へ' })

    fireEvent.click(screen.getByRole('button', { name: 'カラーを上へ' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('保存できませんでした')
  })
})
