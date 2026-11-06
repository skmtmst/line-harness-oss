// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { bookingEmptyState, EmptyBookings } from './empty-bookings'
import type { StyleRow } from './model'
import { PERMISSION_LOCK_REASON } from '@/components/shared/permission-lock'

afterEach(cleanup)
it.each(['salon', 'consult'] as const)('%sの空日の主操作は1つで、権限がなければ表示も直接のhandlerも拒否する', style => {
  for (const role of ['admin', 'viewer', null]) {
    const canWrite = role === 'admin', onBook = vi.fn()
    const result = EmptyBookings({ style, today: { rows: [] }, canWrite, role, onBook, onCreateClass: vi.fn() })!
    const action = result.props.action as ReactElement<{ onClick: () => void; disabled: boolean; lockedReason?: string }>
    expect(action.props.disabled).toBe(role === null)
    expect(action.props.lockedReason).toBe(role === 'viewer' ? PERMISSION_LOCK_REASON.viewer : undefined)
    action.props.onClick()
    expect(onBook).toHaveBeenCalledTimes(canWrite ? 1 : 0)
    onBook.mockClear()
    const view = render(result)
    expect(screen.getAllByText('今日の予約はありません')).toHaveLength(1)
    const button = screen.getByRole('button', { name: '予約を入れる' })
    if (role === 'viewer') expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(onBook).toHaveBeenCalledTimes(canWrite ? 1 : 0)
    view.unmount()
  }
})
it('飲食にはサロン・面談の案内を出さない', () => {
  expect(EmptyBookings({ style: 'restaurant', today: { rows: [] }, canWrite: true, role: 'admin', onBook: vi.fn(), onCreateClass: vi.fn() })).toBeNull()
})

const classRow: StyleRow = { id: 'class:slot', time: '10:00', name: '朝のクラス', reservationId: 'event' }
it('教室はクラスと会員予約を分け、実集計の欠測を0にしない', () => {
  expect(bookingEmptyState('lesson', { rows: [] })).toBe('no-classes')
  expect(bookingEmptyState('lesson', { rows: [classRow], bookingCount: 0 })).toBe('no-bookings')
  expect(bookingEmptyState('lesson', { rows: [classRow], bookingCount: 2 })).toBe('has-bookings')
  for (const bookingCount of [undefined, null]) expect(bookingEmptyState('lesson', { rows: [classRow], bookingCount })).toBe('unknown')
  const booked = { ...classRow, reservationId: undefined, booking: { id: 'member-booking', kind: 'event', version: 1, updatedAt: null, price: 0, partySize: 1, startsAt: '2026-10-21T10:00:00+09:00' } }
  expect(bookingEmptyState('lesson', { rows: [booked], bookingCount: null })).toBe('has-bookings')
  expect(bookingEmptyState('lesson', { rows: [classRow, { ...booked, live: false }], bookingCount: 0 })).toBe('no-bookings')
})
it.each([false, true])('教室のクラスなし=%sでも主操作は1つで、権限と直接handlerの停止を守る', noClasses => {
  for (const role of ['admin', 'viewer', null]) {
    const onBook = vi.fn(), onCreateClass = vi.fn(), canWrite = role === 'admin'
    const result = EmptyBookings({ style: 'lesson', today: { rows: noClasses ? [] : [classRow], bookingCount: 0 }, canWrite, role, onBook, onCreateClass })!
    const action = result.props.action as ReactElement<{ onClick: () => void; disabled: boolean; lockedReason?: string }>
    expect(action.props.disabled).toBe(role === null)
    expect(action.props.lockedReason).toBe(role === 'viewer' ? PERMISSION_LOCK_REASON.viewer : undefined)
    action.props.onClick()
    expect(onBook).toHaveBeenCalledTimes(canWrite && !noClasses ? 1 : 0)
    expect(onCreateClass).toHaveBeenCalledTimes(canWrite && noClasses ? 1 : 0)
    onBook.mockClear(); onCreateClass.mockClear()
    const view = render(result)
    const button = screen.getByRole('button', { name: noClasses ? 'クラスを作る' : '会員を予約する', exact: true })
    expect(button.hasAttribute('disabled')).toBe(role === null)
    expect(button.hasAttribute('data-permission-locked')).toBe(role === 'viewer')
    fireEvent.click(button)
    expect(onBook).toHaveBeenCalledTimes(canWrite && !noClasses ? 1 : 0)
    expect(onCreateClass).toHaveBeenCalledTimes(canWrite && noClasses ? 1 : 0)
    view.unmount()
  }
})
it.each([null, 2])('予約数%sのクラスには予約なしの案内を出さない', bookingCount => {
  expect(EmptyBookings({ style: 'lesson', today: { rows: [classRow], bookingCount }, canWrite: true, role: 'admin', onBook: vi.fn(), onCreateClass: vi.fn() })).toBeNull()
})
