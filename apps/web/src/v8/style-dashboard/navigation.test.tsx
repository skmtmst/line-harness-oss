// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStyleDashboard } from './use-style-dashboard'
import type { StyleRow } from './model'
import { toToday } from './adapter'
import type { StyleBooking, StyleSchedule, StyleSnapshot } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), role: 'admin', toast: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fixture.push, replace: fixture.replace }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'salon-account' }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => fixture.role }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/v8/restaurant/dashboard/public/use-store-today/index', () => ({ useStoreToday: () => ({}) }))
vi.mock('@/components/shared/preparing-dialog', () => ({ PREPARING_TITLE: 'preparing', usePreparingDialog: () => ({ open: vi.fn() }) }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { summary: vi.fn().mockRejectedValue(new Error('unavailable')), schedule: vi.fn().mockRejectedValue(new Error('unavailable')) } }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: fixture.toast }))
vi.mock('@/lib/api', () => ({ bookingApi: { getPaymentConfig: vi.fn().mockResolvedValue({ data: {} }) }, eventsApi: {} }))

const row: StyleRow = { id: 'booking:real-booking-id', time: '10:00', name: '予約者', booking: { id: 'real-booking-id', kind: 'booking', version: 1, updatedAt: null, price: 0, partySize: 1, startsAt: '2026-11-02T10:00:00+09:00' } }
beforeEach(() => { vi.clearAllMocks(); fixture.role = 'admin' })
afterEach(cleanup)

describe.each(['salon', 'consult'] as const)('%sの既存予約画面への接続', (style) => {
  it('台帳セルの担当と時刻、表示日を予約作成へ渡す', async () => {
    const { result } = renderHook(() => useStyleDashboard(style))
    await act(async () => { result.current.setDate('2026-11-02'); result.current.setStaff('filter-staff') })
    act(() => result.current.addNew({ staffId: 'cell-staff', time: '10:30' }))
    expect(fixture.push).toHaveBeenLastCalledWith('/booking/bookings/new?date=2026-11-02&staffId=cell-staff&time=10%3A30')
    act(() => result.current.addNew({ date: '2026-11-04', time: '11:00' }))
    expect(fixture.push).toHaveBeenLastCalledWith('/booking/bookings/new?date=2026-11-04&staffId=filter-staff&time=11%3A00')
    act(() => result.current.addNew())
    expect(fixture.push).toHaveBeenLastCalledWith('/booking/bookings/new?date=2026-11-02&staffId=filter-staff')
  })

  it('担当をすべてにしたときは架空の担当IDを付けない', async () => {
    const { result } = renderHook(() => useStyleDashboard(style))
    await act(async () => { result.current.setDate('2026-11-02') })
    act(() => result.current.addNew())
    expect(fixture.push).toHaveBeenLastCalledWith('/booking/bookings/new?date=2026-11-02')
  })

  it('台帳の予約IDではなく実予約IDで既存の詳細パネルを開く', async () => {
    const { result } = renderHook(() => useStyleDashboard(style))
    await act(async () => {})
    act(() => result.current.openRow(row))
    expect(fixture.push).toHaveBeenLastCalledWith('/booking/bookings?booking=real-booking-id')
    act(() => result.current.menuFor(row).find((item) => item.id === 'detail')?.onSelect?.())
    expect(fixture.push).toHaveBeenLastCalledWith('/booking/bookings?booking=real-booking-id')
  })

  it('閲覧のみでは詳細を開けるが作成には遷移しない', async () => {
    fixture.role = 'viewer'
    const { result } = renderHook(() => useStyleDashboard(style))
    await act(async () => {})
    expect(result.current.menuFor(row).map((item) => item.id)).toEqual(['detail'])
    act(() => result.current.addNew({ time: '10:30', staffId: 'cell-staff' }))
    expect(fixture.push).not.toHaveBeenCalled()
    act(() => result.current.openRow(row))
    expect(fixture.push).toHaveBeenCalledWith('/booking/bookings?booking=real-booking-id')
  })
})


describe('旧Meet相談は実予約IDと混ぜない', () => {
  const meet: StyleRow = { ...row, id: 'meet:meet-only-id', booking: { ...row.booking!, id: 'meet-only-id', kind: 'meet', friendId: 'friend/123' } }
  it('詳細と日程・担当の操作は既存の友だち詳細へ渡す', async () => {
    const { result } = renderHook(() => useStyleDashboard('consult'))
    await act(async () => {})
    for (const id of ['detail', 'time', 'staff']) {
      act(() => result.current.menuFor(meet).find((item) => item.id === id)?.onSelect?.())
      expect(fixture.push).toHaveBeenLastCalledWith('/friends/detail?id=friend%2F123')
    }
  })
  it('閲覧のみでも友だち詳細は確認できる', async () => {
    fixture.role = 'viewer'
    const { result } = renderHook(() => useStyleDashboard('consult'))
    await act(async () => {})
    expect(result.current.menuFor(meet).map((item) => item.id)).toEqual(['detail'])
    act(() => result.current.openRow(meet))
    expect(fixture.push).toHaveBeenLastCalledWith('/friends/detail?id=friend%2F123')
  })
  it('相談者のIDが無い場合は架空の予約を開かず、失敗を知らせる', async () => {
    const { result } = renderHook(() => useStyleDashboard('consult'))
    await act(async () => {})
    const missing: StyleRow = { ...meet, booking: { ...meet.booking!, friendId: null } }
    act(() => result.current.openRow(missing))
    act(() => result.current.menuFor(missing).find((item) => item.id === 'copy')?.onSelect?.())
    expect(fixture.push).not.toHaveBeenCalled()
    expect(fixture.toast).toHaveBeenCalledWith(expect.stringContaining('相談者を確認できない'), { tone: 'error' })
  })
})


it('APIから受けた旧Meet相談の相談者IDを実画面の行へ引き継ぐ', async () => {
  const startsAt = '2026-11-02T10:00:00+09:00', endsAt = '2026-11-02T11:00:00+09:00'
  const booking: StyleBooking = {
    id: 'meet-only-id', kind: 'meet', friendId: 'friend-real', personKey: 'friend-real', name: '相談者',
    startsAt, endsAt, requestedAt: startsAt, status: 'confirmed', staffId: 'staff-real', version: null, updatedAt: startsAt,
    menuId: null, storeId: null, slotId: null, partySize: 1, price: 0, visited: false, attendance: null, held: false,
    meetingMode: 'online', meetingUrl: 'https://meet.google.com/fixture', location: null, outcome: null, source: 'calendar',
    entryPoint: null, refCode: null, designation: null, cancelledAt: null, confirmedResponse: null, participationMode: null,
  }
  const snapshot: StyleSnapshot = { style: 'consult', asOf: startsAt, timeZone: 'Asia/Tokyo', from: startsAt, to: endsAt, dateBasis: 'visit', range: 'today', metrics: {}, previous: {}, items: [], newBookings: [], resultId: 'fixture' }
  const schedule: StyleSchedule = {
    style: 'consult', asOf: startsAt, timeZone: 'Asia/Tokyo', range: 'today', display: 'board', calendarView: 'day', from: startsAt, to: endsAt,
    columns: [{ id: 'staff-real', kind: 'staff', name: '担当者' }],
    entries: [{ id: 'meet:meet-only-id', kind: 'meet', columnIds: ['staff-real'], startsAt, endsAt, title: '個別相談', booking }],
    days: [], closures: [], availability: { status: 'available', reason: null, resources: [], slots: [], closedDates: [] },
  }
  const converted = toToday('consult', snapshot, schedule, '2026-11-02', 'today')
  expect(converted.rows[0].booking?.friendId).toBe('friend-real')
  const { result } = renderHook(() => useStyleDashboard('consult'))
  await act(async () => {})
  act(() => result.current.openRow(converted.rows[0]))
  expect(fixture.push).toHaveBeenLastCalledWith('/friends/detail?id=friend-real')
})
