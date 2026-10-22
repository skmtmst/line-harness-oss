// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { EventBookingItem } from '@/lib/api/types/events'
import type { StyleToday } from './model'
import { useStyleDashboard } from './use-style-dashboard'
import { LessonRoster } from './lesson-roster'
import { isLiveLessonBooking, toLessonRosterMember } from './lesson-roster-state'

const calls = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), toast: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'lesson-account' }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'admin' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/v8/restaurant/dashboard/public/use-store-today/index', () => ({ useStoreToday: () => ({}) }))
vi.mock('@/components/shared/preparing-dialog', () => ({ PREPARING_TITLE: 'preparing', usePreparingDialog: () => ({ open: vi.fn() }) }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { summary: vi.fn().mockRejectedValue(new Error('unavailable')), schedule: vi.fn().mockRejectedValue(new Error('unavailable')) } }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: calls.toast }))
vi.mock('@/lib/api', () => ({ bookingApi: { getPaymentConfig: vi.fn().mockResolvedValue({ data: {} }) }, eventsApi: { listBookings: calls.list, updateBooking: calls.update } }))

const statuses = ['confirmed', 'cancelled', 'no_show', 'requested', 'rejected', 'expired', 'attended']
const bookings: EventBookingItem[] = statuses.map(status => ({
  id: `booking-${status}`, event_id: 'event-real', slot_id: 'slot-real', friend_id: `friend-${status}`, line_account_id: 'lesson-account', status,
  customer_note: null, internal_note: null, requested_at: '2026-10-15T00:00:00Z', decided_at: null,
  cancelled_at: null, cancelled_by: null, slot_starts_at: '2026-10-15T01:00:00Z', slot_ends_at: '2026-10-15T02:00:00Z',
  friend_display_name: `参加者-${status}`, friend_line_user_id: null,
}))
const today: StyleToday = { style: 'lesson', asOf: '2026-10-15T00:00:00Z', staff: [], kpis: [], rowsNote: '', side: [], rows: [{ id: 'class:slot-real', reservationId: 'event-real', name: '朝ヨガ', time: '10:00' }] }
const noop = () => {}
beforeEach(() => { vi.clearAllMocks(); calls.list.mockResolvedValue({ items: bookings, total: bookings.length, limit: 50, sort: [] }); calls.update.mockResolvedValue({}) })
afterEach(cleanup)
async function loadRoster(memberCount = 7) {
  const hook = renderHook(() => useStyleDashboard('lesson'))
  await act(async () => {})
  act(() => hook.result.current.setData(today))
  await waitFor(() => expect(hook.result.current.roster?.members).toHaveLength(memberCount))
  return hook
}

it('正規APIの取消・欠席・非確定を確定の出席操作へ変換せず、人数から取消・拒否・失効を除く', async () => {
  const { result } = await loadRoster()
  const roster = result.current.roster!
  expect(calls.list).toHaveBeenCalledWith('lesson-account', 'event-real', { slot_id: 'slot-real', limit: 50, page: 1 }, { signal: expect.any(AbortSignal) })
  expect(roster.meta).toContain('予約 4')
  expect(roster.members.map(member => member.attend)).toEqual(['button', 'cancel', 'absent', 'unavailable', 'unavailable', 'unavailable', 'done'])
  render(<LessonRoster roster={roster} canWrite onAttend={noop} onAbsent={noop} onClose={noop} onPay={noop} onLine={noop} onCancelClass={noop} />)
  expect(screen.getAllByRole('button', { name: '出席', exact: true })).toHaveLength(1)
  for (const status of statuses.filter(status => status !== 'confirmed')) {
    const row = screen.getByText(`参加者-${status}`).parentElement!.parentElement!
    expect(within(row).queryByRole('button', { name: '出席', exact: true })).toBeNull()
  }
})

it('全員出席でも実予約IDで確定だけを更新し、取消や欠席を再送しない', async () => {
  const { result } = await loadRoster()
  render(<LessonRoster roster={result.current.roster!} canWrite onAttend={name => { void result.current.attend(result.current.roster!, name) }} onAbsent={noop} onClose={noop} onPay={noop} onLine={noop} onCancelClass={noop} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '全員出席' })) })
  expect(calls.update).toHaveBeenCalledOnce()
  expect(calls.update).toHaveBeenCalledWith('lesson-account', 'event-real', 'booking-confirmed', { status: 'attended' })
})

it('閲覧のみは名簿の状態を見せて出欠・一括・送信操作を出さない', async () => {
  const { result } = await loadRoster()
  render(<LessonRoster roster={result.current.roster!} canWrite={false} onAttend={noop} onAbsent={noop} onClose={noop} onPay={noop} onLine={noop} onCancelClass={noop} />)
  expect(screen.getByText('✓ 出席')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /出席|欠席|LINE|支払い|休講/ })).toBeNull()
  expect(calls.update).not.toHaveBeenCalled()
})

it('古い取消日時がある確定応答と未知状態も出欠の対象にしない', () => {
  const legacy = { ...bookings[0], cancelled_at: '2026-10-15T00:30:00Z' }
  expect(toLessonRosterMember(legacy).attend).toBe('cancel')
  expect(isLiveLessonBooking(legacy)).toBe(false)
  const unknown = { ...bookings[0], status: 'unknown-future-state' }
  expect(toLessonRosterMember(unknown).attend).toBe('unavailable')
  expect(isLiveLessonBooking(unknown)).toBe(false)
})


it('51件を読み切った全員操作でも、取消を除き2ページ目の確定予約まで更新する', async () => {
  const items = Array.from({ length: 51 }, (_, index) => ({ ...bookings[0], id: `booking-${index}`, friend_display_name: '同じ名前', status: index === 0 || index === 50 ? 'confirmed' : 'cancelled' }));
  calls.list.mockImplementation((_accountId, _eventId, query) => Promise.resolve({ items: items.slice((query.page - 1) * 50, query.page * 50), total: items.length, limit: 50, sort: [] }));
  const { result } = await loadRoster(51);
  expect(result.current.roster!.meta).toContain('予約 2');
  render(<LessonRoster roster={result.current.roster!} canWrite onAttend={bookingId => { void result.current.attend(result.current.roster!, bookingId) }} onAbsent={noop} onClose={noop} onPay={noop} onLine={noop} onCancelClass={noop} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '全員出席' })) });
  expect(calls.update).toHaveBeenCalledTimes(2);
  expect(calls.update).toHaveBeenNthCalledWith(1, 'lesson-account', 'event-real', 'booking-0', { status: 'attended' });
  expect(calls.update).toHaveBeenNthCalledWith(2, 'lesson-account', 'event-real', 'booking-50', { status: 'attended' });
});
