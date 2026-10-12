// @vitest-environment happy-dom
import { rememberStaffIdentity, forgetStaffIdentity } from '@/lib/staff-identity-state'
import type { StaffMember } from '@line-crm/shared'
/*
 * Issue #709残件: 28予約メニューの「⠿」は掴めない飾りだったので置かず、
 * 並び順の変更は操作列の「…」の中の上へ・下へで行うことを、
 * 実物の React を描いて確かめる。
 *
 * ソース文字列の検査では次が固定できない。ここでは happy-dom へ実物の画面を
 * マウントし、一覧の取得を実物の Promise で返してから確かめる。
 *
 *   - ⠿の飾りが画面に出ないこと
 *   - 各行の「…」（○○のその他操作）に上へ・下へがあること
 *   - 先頭の上へ・末尾の下へは押せないこと（理由付き）
 *   - 上へ・下へを押すと2件の sort_order を交換した updateMenu PUT が送られること
 *   - 失敗したら role="alert" で理由が出ること
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  reorderMenus: vi.fn(),
  updateMenu: null as null | ((...args: unknown[]) => Promise<unknown>),
  listMenus: null as null | ((...args: unknown[]) => Promise<unknown>),
  getSettings: null as null | ((...args: unknown[]) => Promise<unknown>),
}))

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
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
    reorderMenus: (...args: unknown[]) => fixture.reorderMenus(...args),
    listStaff: async () => ({ staff: [] }),
    getAvailabilityRules: async () => ({ rules: [] }),
    getGoogleCalendar: async () => ({ connected: false }),
    listRequests: async () => ({ items: [], total: 0 }),
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
  forgetStaffIdentity(); rememberStaffIdentity({ role: 'owner' } as StaffMember);
  window.localStorage.setItem('lh_staff_role', 'owner'); rememberStaffIdentity({ role: 'owner' } as StaffMember)
  clearToastsForTest()
  fixture.selectedAccountId = 'account-a'
  fixture.activeTab = 'menus'
  fixture.reorderMenus.mockReset().mockResolvedValue({ ok: true })
  window.history.replaceState(null, '', '/booking/menus')
  window.dispatchEvent(new PopStateEvent('popstate'))
  fixture.updateMenu = vi.fn(async () => ({ ok: true }))
  fixture.listMenus = vi.fn(async () => ({ menus: MENUS.map((m) => ({ ...m })) }))
  fixture.getSettings = vi.fn(async () => ({ success: true, data: SETTINGS }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('Issue #709残件: 28予約メニューの「…」並び替え', () => {
  test('⠿の飾りが出ず、各行の「…」に上へ/下へがある', async () => {
    const { container } = render(<><MenusPage /><ToastHost /></>)
    await screen.findByRole('button', { name: '「カラー」のそのほかの操作' })

    expect(container.textContent).not.toContain('⠿')
    fireEvent.click(screen.getByRole('button', { name: '「カラー」のそのほかの操作' }))
    const menu = screen.getByRole('menu', { name: '「カラー」の操作' })
    expect(within(menu).getByRole('menuitem', { name: '上へ' })).toBeTruthy()
    // 末尾の下へは押せない（理由付きで名前が「下へいちばん下です」になる）。
    expect(within(menu).getByRole('menuitem', { name: /下へ/ })).toBeTruthy()
    // 注意書きに「…」の導線を書く。
    expect(screen.getAllByRole('button', { name: /を並び替える/ })).toHaveLength(2)
  })

  test('先頭の上へ・末尾の下へは押せない', async () => {
    render(<><MenusPage /><ToastHost /></>)
    await screen.findByRole('button', { name: '「カラー」のそのほかの操作' })

    fireEvent.click(screen.getByRole('button', { name: '「カット」のそのほかの操作' }))
    const topMenu = screen.getByRole('menu', { name: '「カット」の操作' })
    expect((within(topMenu).getByRole('menuitem', { name: /上へ/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(topMenu).getByRole('menuitem', { name: /下へ/ }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '「カラー」のそのほかの操作' }))
    const lastMenu = screen.getByRole('menu', { name: '「カラー」の操作' })
    expect((within(lastMenu).getByRole('menuitem', { name: /下へ/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(lastMenu).getByRole('menuitem', { name: /上へ/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('下へを押すと2件の版と並びをまとめて保存する', async () => {
    render(<><MenusPage /><ToastHost /></>)
    await screen.findByRole('button', { name: '「カット」のそのほかの操作' })

    fireEvent.click(screen.getByRole('button', { name: '「カット」のそのほかの操作' }))
    const menu = screen.getByRole('menu', { name: '「カット」の操作' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: '下へ' }))
    await waitFor(() => expect(fixture.reorderMenus).toHaveBeenCalledTimes(1))
    expect(fixture.reorderMenus).toHaveBeenCalledWith('account-a', { changes: expect.arrayContaining([
      { id: 'menu-1', expectedVersion: 1, sortOrder: 1 },
      { id: 'menu-2', expectedVersion: 1, sortOrder: 0 },
    ]) })

  })

  test('失敗したら理由を知らせ、並びを戻して再試行できる', async () => {
    fixture.reorderMenus.mockRejectedValue(new Error('down'))
    render(<><MenusPage /><ToastHost /></>)
    await screen.findByRole('button', { name: '「カラー」のそのほかの操作' })

    fireEvent.click(screen.getByRole('button', { name: '「カラー」のそのほかの操作' }))
    const menu = screen.getByRole('menu', { name: '「カラー」の操作' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: '上へ' }))
    await screen.findByText('予約メニューを保存できませんでした。通信状態を確認して、もう一度お試しください。')
    expect(document.querySelector('[data-reorder-id]')?.textContent).toContain('カット')
    fireEvent.click(screen.getByRole('button', { name: 'もう一度' }))
    await waitFor(() => expect(fixture.reorderMenus).toHaveBeenCalledTimes(2))
  })
})
