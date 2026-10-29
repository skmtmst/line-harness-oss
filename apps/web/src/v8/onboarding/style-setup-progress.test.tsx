// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ACCOUNT_STYLES } from '@line-crm/shared'
import { loadStyleSetupProgress } from './style-setup-progress'
import { useStyleSetupProgress } from './use-style-setup-progress'
const net = vi.hoisted(() => ({ menus: vi.fn(), staff: vi.fn(), settings: vi.fn(), account: vi.fn(), events: vi.fn(), members: vi.fn(), snapshot: vi.fn(), hours: vi.fn(), connector: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: { lineAccounts: { get: net.account }, ecCommerce: { connector: net.connector } },
  bookingApi: { listMenus: net.menus, listStaff: net.staff, getSettings: net.settings }, eventsApi: { listEvents: net.events },
}))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { members: net.members } }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: { snapshot: net.snapshot, openingHours: net.hours } }))
vi.mock('@/hooks/use-account-style', () => ({ ACCOUNT_STYLE_UPDATED: 'account-style-updated' }))

beforeEach(() => {
  vi.resetAllMocks()
  net.menus.mockResolvedValue({ menus: [{ id: 'menu', is_active: 1, assigned_staff: [{ id: 'staff' }] }] })
  net.staff.mockResolvedValue({ staff: [{ id: 'staff', is_active: 1 }] })
  net.settings.mockImplementation((id: string) => Promise.resolve({ success: true, data: { lineAccountId: id, businessHoursConfigured: true, businessHours: [{ intervals: [{ start: '09:00', end: '18:00' }] }] } }))
  net.account.mockImplementation((id: string) => Promise.resolve({ success: true, data: { id, liffId: '123-booking' } }))
  net.events.mockResolvedValue({ items: [{ id: 'class', is_published: 1, lifecycle_status: 'published', next_slot_starts_at: '2099-10-28T10:00:00+09:00' }], total: 1 })
  net.members.mockResolvedValue({ success: true, data: [{ line_account_id: 'a', joined_at: '2026-10-28', ended_at: null, expires_at: null }] })
  net.snapshot.mockResolvedValue({ success: true, data: {
    stores: [{ id: 'store', line_account_id: 'a', status: 'active', line_status: 'connected' }],
    tables: [{ store_id: 'store', is_active: 1, max_capacity: 4 }], menuItems: [{ store_id: 'store', status: 'active' }],
    inventory: [{ store_id: 'store', line_capacity: 4, total_capacity: 4 }],
  } })
  net.hours.mockResolvedValue({ success: true, data: { hours: [{ periods: [{ opensAt: '09:00', closesAt: '18:00' }] }] } })
  net.connector.mockResolvedValue({ success: true, data: { configured: true, connector: { status: 'connected', secretConfigured: true, eventTypes: ['ec.order.confirmed'] }, health: { lastSucceededAt: '2026-10-28T00:00:00Z' } } })
})
afterEach(cleanup)
const values = (progress: Awaited<ReturnType<typeof loadStyleSetupProgress>>) => Object.values(progress.steps).map(step => step?.complete)

it.each(ACCOUNT_STYLES)('%sはその段の既存APIの実設定だけを使う', async style => {
  const progress = await loadStyleSetupProgress('a', style)
  expect(progress.style).toBe(style)
  expect(values(progress)).toEqual(style === 'standard' ? [] : style === 'ec' ? [true, null, true] : [true, true, true])
  if (style === 'standard') for (const method of Object.values(net)) expect(method).not.toHaveBeenCalled()
  if (style === 'ec') expect(progress.steps.friendAdd?.reason).toContain('商品を確認できる情報がまだありません')
})

it.each(['restaurant', 'salon', 'consult', 'lesson', 'ec'] as const)('%sの取得失敗を設定済みにせず、未確認の理由を渡す', async style => {
  for (const method of Object.values(net)) method.mockRejectedValue(new Error('offline'))
  const progress = await loadStyleSetupProgress('a', style)
  expect(values(progress)).toEqual([null, null, null])
  for (const step of Object.values(progress.steps)) expect(step?.reason).toBeTruthy()
})

it('読めた未登録はfalse、開催日時や商品の情報が足りない時はnullにする', async () => {
  net.events.mockResolvedValue({ items: [], total: 0 })
  net.members.mockResolvedValue({ success: true, data: [] })
  expect(values(await loadStyleSetupProgress('a', 'lesson'))).toEqual([false, false, false])
  net.events.mockResolvedValue({ items: [{ id: 'draft', is_published: 0, next_slot_starts_at: null }], total: 1 })
  expect(values(await loadStyleSetupProgress('a', 'lesson'))).toEqual([null, false, false])
  net.snapshot.mockResolvedValue({ success: true, data: { stores: [], tables: [], menuItems: [], inventory: [] } })
  expect(values(await loadStyleSetupProgress('a', 'restaurant'))).toEqual([false, false, false])
})

it('担当者がいてもメニューとの対応や営業時間を確かめないまま受付済みにしない', async () => {
  net.menus.mockResolvedValue({ menus: [{ id: 'menu', is_active: 1 }] })
  expect((await loadStyleSetupProgress('a', 'salon')).steps.scenario?.complete).toBeNull()
  net.menus.mockResolvedValue({ menus: [{ id: 'menu', is_active: 1, assigned_staff: [] }] })
  expect((await loadStyleSetupProgress('a', 'salon')).steps.scenario?.complete).toBe(false)
  net.settings.mockResolvedValue({ success: true, data: { lineAccountId: 'a', businessHoursConfigured: false, businessHours: [] } })
  expect((await loadStyleSetupProgress('a', 'consult')).steps.attributes?.complete).toBe(false)
})

it('別の店の店舗・会員・予約ページを済みの根拠にしない', async () => {
  expect((await loadStyleSetupProgress('other', 'restaurant')).steps.attributes?.complete).toBe(false)
  expect((await loadStyleSetupProgress('other', 'lesson')).steps.friendAdd?.complete).toBe(false)
  net.account.mockResolvedValue({ success: true, data: { id: 'other', liffId: '123-other' } })
  expect((await loadStyleSetupProgress('a', 'consult')).steps.friendAdd?.complete).toBeNull()
})

it('店を切り替えた直後に証拠をクリアし、遅い旧店舗の返事を捨てる', async () => {
  let resolveOld!: (value: unknown) => void
  net.menus.mockImplementation((id: string) => id === 'a' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ menus: [{ id: 'menu', is_active: 1, assigned_staff: [{ id: 'staff' }] }] }))
  const view = renderHook(({ id }) => useStyleSetupProgress(id, 'salon'), { initialProps: { id: 'a' } })
  view.rerender({ id: 'b' })
  expect(view.result.current.progress?.steps.attributes?.complete).toBeNull()
  await waitFor(() => expect(view.result.current.progress?.steps.attributes?.complete).toBe(true))
  await act(async () => resolveOld({ menus: [] }))
  expect(view.result.current.progress?.steps.attributes?.complete).toBe(true)
  expect(net.menus).toHaveBeenCalledWith('b')
})

it('同じ店でもスタイルが替わったら旧スタイルの遅い返事を流用しない', async () => {
  let resolveOld!: (value: unknown) => void
  net.menus.mockImplementation(() => new Promise(resolve => { resolveOld = resolve }))
  const view = renderHook(({ style }) => useStyleSetupProgress('a', style), { initialProps: { style: 'salon' as 'salon' | 'ec' } })
  view.rerender({ style: 'ec' })
  expect(view.result.current.progress?.style).toBe('ec')
  await waitFor(() => expect(view.result.current.progress?.steps.attributes?.complete).toBe(true))
  await act(async () => resolveOld({ menus: [] }))
  expect(view.result.current.progress?.style).toBe('ec')
  expect(view.result.current.progress?.steps.friendAdd?.complete).toBeNull()
})
