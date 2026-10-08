// @vitest-environment happy-dom
/*
 * 監査 WEB062/063/064：予約メニューを作る・直す。
 * - 062：作れたあと担当の保存だけ失敗したら、やり直しは担当だけ（メニューを「直す」へ進めない・公開を戻さない）
 * - 063：直すときに設備を全部外したら、外した保存も送る
 * - 064：開いただけで「直しかけ」にしない（受付の日数・時間の欄）
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ menu: null as string | null, push: vi.fn() }))
const net = vi.hoisted(() => ({
  createMenu: vi.fn(), updateMenu: vi.fn(), putStaffMenus: vi.fn(), saveMenuResources: vi.fn(),
  menus: [] as unknown[],
  matrix: [] as unknown[],
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.menu ? `menu=${nav.menu}` : ''),
  usePathname: () => '/booking/menus/new',
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', selectedAccount: null }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('./lib/edit-permission', () => ({ useBookingEdit: () => true }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: vi.fn() }))
vi.mock('./menu-version-history', () => ({ default: () => null }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) } },
    bookingApi: {
      ...actual.bookingApi,
      listMenus: async () => ({ menus: net.menus }),
      listStaff: async () => ({ staff: [{ id: 's1', name: '高田', display_name: '高田', role: 'トリマー', is_active: 1, is_designation_optional: 0 }] }),
      getSettings: async () => ({ success: true, data: { exceptions: [], businessHours: [] } }),
      listResources: async () => ({ success: true, data: { resources: [{ id: 'r1', name: '台1', capacity: 1, isActive: true }] } }),
      listStaffMenusBulk: async () => ({ staff: [{ staff_id: 's1', matrix: net.matrix }] }),
      getStaffMenus: async () => ({ matrix: [] }),
      createMenu: (...args: unknown[]) => net.createMenu(...args),
      updateMenu: (...args: unknown[]) => net.updateMenu(...args),
      putStaffMenus: (...args: unknown[]) => net.putStaffMenus(...args),
      saveMenuResources: (...args: unknown[]) => net.saveMenuResources(...args),
    },
  }
})

const { default: MenuFormV8 } = await import('./menu-form')

const menu = (over: Record<string, unknown> = {}) => ({
  id: 'm1', name: 'カット', category_label: null, description: null, duration_minutes: 60, base_price: 3000,
  price_mode: 'fixed', concurrent_capacity: 1, buffer_after_minutes: 0, booking_window_days: 30,
  cutoff_hours_before: 2, cancel_deadline_hours_before: 24, intake_question: null, auto_tag_id: null,
  is_active: 1, sort_order: 1, version: 3, assigned_staff: [], assigned_resources: [], ...over,
})

beforeEach(() => {
  nav.menu = null
  net.menus = []
  net.matrix = []
  for (const fn of [net.createMenu, net.updateMenu, net.putStaffMenus, net.saveMenuResources, nav.push]) fn.mockReset()
})
afterEach(cleanup)

const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() }) }

describe('予約メニューを作る・直す（WEB062/063/064）', () => {
  it('062：作れたあと担当だけ失敗したら、やり直しは担当だけ（直す・公開の取り消しをしない）', async () => {
    net.createMenu.mockImplementation(async () => { net.menus = [menu({ id: 'new-1', version: 1 })]; return { id: 'new-1' } })
    net.putStaffMenus.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ ok: true })
    render(<MenuFormV8 />)
    await settle()
    fireEvent.change(screen.getByPlaceholderText('例: トリミング（小型犬）'), { target: { value: 'カット' } })
    fireEvent.click(screen.getByRole('button', { name: /高田/ }))
    const publish = () => screen.getAllByRole('button').find((b) => b.className.includes('primary') || b.textContent?.includes('公開')) as HTMLButtonElement
    await act(async () => { publish().click() })
    await settle()
    expect(net.createMenu).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/一部の担当・設備を保存できませんでした/)).toBeTruthy()
    await act(async () => { publish().click() })
    await settle()
    expect(net.createMenu).toHaveBeenCalledTimes(1)
    expect(net.updateMenu).not.toHaveBeenCalled()
    expect(net.putStaffMenus).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/booking/menus'))
  })

  it('063：直すときに設備を全部外したら、空の設備を保存する', async () => {
    nav.menu = 'm1'
    net.menus = [menu({ assigned_resources: [{ resourceId: 'r1', quantity: 1 }] })]
    net.matrix = [{ menu_id: 'm1', name: 'カット', is_offered: 1, override_duration_minutes: null, override_price: null }]
    net.updateMenu.mockResolvedValue({ version: 4 })
    net.saveMenuResources.mockResolvedValue({ data: { version: 5 } })
    render(<MenuFormV8 />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /台1/ }))
    await act(async () => { screen.getByRole('button', { name: /変更を保存する/ }).click() })
    await settle()
    expect(net.saveMenuResources).toHaveBeenCalledWith('a', 'm1', expect.objectContaining({ resources: [] }))
  })

  it('064：開いただけでは「直しかけ」にしない（ページを離れるときに止めない）', async () => {
    nav.menu = 'm1'
    net.menus = [menu()]
    net.matrix = [{ menu_id: 'm1', name: 'カット', is_offered: 1, override_duration_minutes: null, override_price: null }]
    render(<MenuFormV8 />)
    await settle()
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
