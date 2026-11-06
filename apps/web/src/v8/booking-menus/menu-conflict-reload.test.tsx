// @vitest-environment happy-dom
/* Isolated UI1-OPS-C01 fixture; initial scaffolding adapted from menu-form-followup.test.tsx. No real API calls. */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ menu: null as string | null, push: vi.fn() }))
const net = vi.hoisted(() => ({
  createMenu: vi.fn(), updateMenu: vi.fn(), putStaffMenus: vi.fn(), saveMenuResources: vi.fn(),
  bulk: vi.fn(), versions: vi.fn(), menus: [] as unknown[],
  matrix: [] as unknown[],
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.menu ? `menu=${nav.menu}` : ''),
  usePathname: () => '/booking/menus/new',
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', selectedAccount: null }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/v8/booking-menus/lib/edit-permission', () => ({ useBookingEdit: () => true }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: vi.fn(), notifySaved: vi.fn() }))
vi.mock('@/v8/booking-menus/menu-version-history', () => ({ default: () => null }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { mileage: { rules: async () => ({ success: true, data: [] }) }, tags: { list: async () => ({ success: true, data: [] }) } },
    bookingApi: {

      listMenus: async () => ({ menus: net.menus }),
      listStaff: async () => ({ staff: [{ id: 's1', name: '高田', display_name: '高田', role: 'トリマー', is_active: 1, is_designation_optional: 0 }] }),
      getSettings: async () => ({ success: true, data: { exceptions: [], businessHours: [] } }),
      listResources: async () => ({ success: true, data: { resources: [{ id: 'r1', name: '台1', capacity: 1, isActive: true }] } }),
      listStaffMenusBulk: (...args: unknown[]) => net.bulk(...args), listMenuVersions: (...args: unknown[]) => net.versions(...args),
      getStaffMenus: async () => ({ matrix: [] }),
      createMenu: (...args: unknown[]) => net.createMenu(...args),
      updateMenu: (...args: unknown[]) => net.updateMenu(...args),
      putStaffMenus: (...args: unknown[]) => net.putStaffMenus(...args),
      saveMenuResources: (...args: unknown[]) => net.saveMenuResources(...args),
    },
  }
})

const { default: MenuFormV8 } = await import('@/v8/booking-menus/menu-form')

const menu = (over: Record<string, unknown> = {}) => ({
  id: 'm1', name: 'カット', category_label: null, description: null, duration_minutes: 60, base_price: 3000,
  price_mode: 'fixed', concurrent_capacity: 1, buffer_after_minutes: 0, booking_window_days: 30,
  cutoff_hours_before: 2, cancel_deadline_hours_before: 24, intake_question: null, auto_tag_id: null,
  is_active: 1, sort_order: 1, version: 3, assigned_staff: [], assigned_resources: [], ...over,
})

beforeEach(() => {
  nav.menu = "m1"
  net.menus = [menu()]
  net.matrix = [{ menu_id: 'm1', is_offered: 1 }]
  net.bulk.mockReset().mockResolvedValue({staff:[{staff_id:'s1',matrix:net.matrix}]})
  net.versions.mockResolvedValue({versions:[]})
  Element.prototype.scrollIntoView = vi.fn()
  for (const fn of [net.createMenu, net.updateMenu, net.putStaffMenus, net.saveMenuResources, nav.push]) fn.mockReset()
})
afterEach(cleanup)

const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() }) }


it('UI1-OPS-C01 担当取得失敗時は選択を残し、読み直し成功と案内しない',async()=>{
 const {ApiError}=await import('@/lib/api');net.updateMenu.mockRejectedValue(new ApiError(409,'version_conflict','version_conflict'));
 render(<MenuFormV8/>);await settle();const staff=()=>screen.getByRole('checkbox',{name:/高田/}) as HTMLInputElement;expect(staff().checked).toBe(true);
 fireEvent.change(screen.getByPlaceholderText('例：トリミング（小型犬）'),{target:{value:'編集した名前'}});
 fireEvent.click(screen.getByRole('button',{name:'変更を保存する'}));await settle();net.bulk.mockRejectedValueOnce(new Error('fixture bulk unavailable'));
 fireEvent.click(screen.getByRole('button',{name:/最新.*読み込/}));await settle();expect(staff().checked).toBe(true);
 const {notifyToast}=await import('@/components/shared/toast');expect(notifyToast).not.toHaveBeenCalledWith('最新の内容を読み込みました');expect(screen.getByDisplayValue('編集した名前')).toBeTruthy();expect(net.putStaffMenus).not.toHaveBeenCalled();
});

it('担当の初回取得失敗も空の割当として編集可能にしない',async()=>{
 net.bulk.mockRejectedValueOnce(new Error('担当を読み込めませんでした'))
 render(<MenuFormV8/>)
 await settle()
 expect(screen.queryByRole('button',{name:'変更を保存する'})).toBeNull()
 expect(screen.getByRole('button',{name:/もう一度/})).toBeTruthy()
})
