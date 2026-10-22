// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { IndustryStyle, StyleBooking, StyleSchedule, StyleSnapshot } from '@line-crm/shared'
import type { eventsApi } from '@/lib/api'
import { toToday } from './adapter'
import StyleDashboard from './style-dashboard'

const state = vi.hoisted(() => ({ search: 'view=calendar', role: 'admin', push: vi.fn(), replace: vi.fn(), summary: vi.fn(), schedule: vi.fn(), bookings: vi.fn<typeof eventsApi.listBookings>() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push, replace: state.replace }), usePathname: () => '/', useSearchParams: () => new URLSearchParams(state.search) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'calendar-account' }) }))
vi.mock('@/lib/staff-role', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/staff-role')>(), useStaffRole: () => state.role }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/v8/restaurant/dashboard/public/use-store-today/index', () => ({ useStoreToday: () => ({}) }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { summary: state.summary, schedule: state.schedule } }))
vi.mock('@/components/shared/preparing-dialog', () => ({ PREPARING_TITLE: 'preparing', usePreparingDialog: () => ({ open: vi.fn(), dialog: null }) }))
vi.mock('./date-range', async importOriginal => ({ ...await importOriginal<typeof import('./date-range')>(), jstToday: () => '2026-10-21' }))
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, bookingApi: { ...actual.bookingApi, getPaymentConfig: vi.fn().mockResolvedValue({ data: {} }) }, eventsApi: { ...actual.eventsApi, listBookings: state.bookings } }
})

function fixture(style: IndustryStyle, date = '2026-10-21', range: 'today' | 'week' | 'month' = 'today') {
  const from = `${date}T00:00:00+09:00`, startsAt = `${date}T10:00:00+09:00`, endsAt = `${date}T11:00:00+09:00`
  const booking: StyleBooking = { id: 'real-booking', kind: 'booking', friendId: 'friend-real', personKey: 'friend-real', name: '予約者', startsAt, endsAt, requestedAt: startsAt, status: 'confirmed', staffId: 'staff-real', version: 3, updatedAt: startsAt, menuId: null, storeId: null, slotId: null, partySize: 2, price: 0, visited: false, attendance: null, held: false, meetingMode: null, meetingUrl: null, location: null, outcome: null, source: 'line', entryPoint: null, refCode: null, designation: null, cancelledAt: null, confirmedResponse: null, participationMode: null }
  const snapshot: StyleSnapshot = { style, asOf: startsAt, timeZone: 'Asia/Tokyo', from, to: `${date}T23:59:59+09:00`, dateBasis: 'visit', range, metrics: {}, previous: {}, items: [], newBookings: [], resultId: 'real-result' }
  const schedule: StyleSchedule = { style, asOf: startsAt, from, to: snapshot.to, timeZone: snapshot.timeZone, range, display: 'calendar', calendarView: range === 'today' ? 'day' : range,
    columns: [{ id: 'staff-real', kind: 'staff', name: '担当者' }],
    entries: [{ id: style === 'lesson' ? 'class:slot-real' : 'booking:real-booking', kind: style === 'lesson' ? 'class' : 'booking', ...(style === 'lesson' ? { classId: 'event-real' } : {}), columnIds: ['staff-real'], startsAt, endsAt, title: '朝の予約', booking: style === 'lesson' ? null : booking }],
    days: [{ date, entryIds: [style === 'lesson' ? 'class:slot-real' : 'booking:real-booking'], bookings: 1, people: 2 }], closures: [],
    availability: { status: 'available', reason: null, resources: [], slots: [{ columnId: 'staff-real', menuId: 'menu-real', date, startsAt: `${date}T12:00:00+09:00`, endsAt: `${date}T12:30:00+09:00`, remaining: 1 }], closedDates: [] },
  }
  return { snapshot, schedule }
}
beforeEach(() => {
  vi.clearAllMocks(); state.search = 'view=calendar'; state.role = 'admin'
  state.summary.mockImplementation((_account, query) => Promise.resolve({ data: fixture(query.style, query.date, query.range).snapshot }))
  state.schedule.mockImplementation((_account, query) => Promise.resolve({ data: fixture(query.style, query.date, query.range).schedule }))
  state.bookings.mockResolvedValue({ items: [], total: 0, limit: 50, sort: [] })
})
afterEach(cleanup)

it.each<IndustryStyle>(['restaurant', 'salon', 'consult', 'lesson'])('%sの今日カレンダーに正規day予約を表示し、実予約・教室の名簿へ接続する', async style => {
  render(<StyleDashboard style={style} />)
  const calendar = await screen.findByRole('region', { name: '1日のカレンダー' })
  expect(screen.queryByText('カレンダーに出す予約はまだありません')).toBeNull()
  expect(within(calendar).getByRole('button', { name: '今日' })).toBeTruthy()
  expect(state.schedule).toHaveBeenCalledWith('calendar-account', expect.objectContaining({ style, range: 'today', calendar_view: 'day', display: 'calendar' }))
  const entry = within(calendar).getByRole('button', { name: style === 'lesson' ? '10:00〜11:00 朝の予約' : '10:00〜11:00 朝の予約 予約者' })
  if (style === 'lesson') expect(screen.queryByRole('region', { name: '朝の予約の名簿' })).toBeNull()
  fireEvent.click(entry)
  if (style === 'lesson') {
    expect(await screen.findByRole('region', { name: '朝の予約の名簿' })).toBeTruthy()
    expect(state.bookings).toHaveBeenCalledOnce()
    expect(state.bookings).toHaveBeenCalledWith('calendar-account', 'event-real', { slot_id: 'slot-real', limit: 50, page: 1 }, { signal: expect.any(AbortSignal) })
  } else expect(state.push).toHaveBeenCalledWith(style === 'restaurant' ? '/restaurant-test/reservations?id=real-booking' : '/booking/bookings?booking=real-booking')
})

it('日送りは1日、今日は当日に戻し、週間の送りは7日を保つ', async () => {
  const view = render(<StyleDashboard style="salon" />)
  const calendar = await screen.findByRole('region', { name: '1日のカレンダー' })
  fireEvent.click(within(calendar).getByRole('button', { name: '次へ', exact: true }))
  await waitFor(() => expect(state.schedule).toHaveBeenLastCalledWith('calendar-account', expect.objectContaining({ date: '2026-10-22', range: 'today' })))
  fireEvent.click(within(await screen.findByRole('region', { name: '1日のカレンダー' })).getByRole('button', { name: '今日', exact: true }))
  await waitFor(() => expect(state.schedule).toHaveBeenLastCalledWith('calendar-account', expect.objectContaining({ date: '2026-10-21' })))
  state.search = 'view=calendar&range=week'; view.rerender(<StyleDashboard style="salon" />)
  fireEvent.click(within(await screen.findByRole('region', { name: '1週間のカレンダー' })).getByRole('button', { name: '次へ', exact: true }))
  await waitFor(() => expect(state.schedule).toHaveBeenLastCalledWith('calendar-account', expect.objectContaining({ date: '2026-10-28', calendar_view: 'week' })))
})

it.each<IndustryStyle>(['restaurant', 'salon', 'consult', 'lesson'])('%sの閲覧のみは日予約を読め、空き枠作成を出さない', async style => {
  state.role = 'viewer'
  render(<StyleDashboard style={style} />)
  const calendar = await screen.findByRole('region', { name: '1日のカレンダー' })
  expect(within(calendar).getByRole('button', { name: /10:00〜11:00/ })).toBeTruthy()
  expect(within(calendar).queryByRole('button', { name: /に予約を入れる/ })).toBeNull()
})

it('日表示も実APIの取消記録ID・空き候補を落とさず、週/月のモデルはそのまま保つ', () => {
  const { snapshot, schedule } = fixture('salon')
  const cancelled = { ...schedule.entries[0], id: 'booking:cancelled-real', booking: { ...schedule.entries[0].booking!, status: 'cancelled' } }
  const data = toToday('salon', snapshot, { ...schedule, entries: [...schedule.entries, cancelled] }, '2026-10-21', 'today')
  expect(data.week?.days.map(day => day.date)).toEqual(['2026-10-21'])
  expect(data.week?.title).toBe('10月21日（水）')
  expect(data.week?.entries.map(entry => entry.id)).toEqual(['booking:real-booking', 'booking:cancelled-real'])
  expect(data.week?.free).toEqual([{ day: '2026-10-21', start: '12:00', end: '12:30' }])
  expect(data.month).toBeNull()
  const monthly = fixture('salon', '2026-10-01', 'month')
  expect(toToday('salon', monthly.snapshot, monthly.schedule, '2026-10-01', 'month').week).toBeNull()
  expect(toToday('salon', monthly.snapshot, monthly.schedule, '2026-10-01', 'month').month).toBeTruthy()
})
