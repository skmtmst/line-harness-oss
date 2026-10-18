// @vitest-environment happy-dom
/*
 * 監査 R86・R87・R88（予約カレンダー）を実描画で固定する。
 * - R86: 取消済みは有効な件数・売上見込みから外し、カードに状態を出す。
 * - R87: 同じ時間のマスに予約があっても、重ならない空き枠の入口は残す。
 * - R88: 受付経路は source で分ける（担当者の代理入力をLINEにしない）。
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import BookingCalendar, { type CalendarSlot } from './booking-calendar'
import type { BookingRequest } from '@/lib/api'

function booking(over: Partial<BookingRequest> = {}): BookingRequest {
  return {
    id: 'b1',
    friend_id: 'f1',
    booking_customer_id: null,
    starts_at: '2026-09-28T10:00:00+09:00',
    ends_at: '2026-09-28T10:30:00+09:00',
    status: 'confirmed',
    customer_note: null,
    internal_note: null,
    price_at_booking: 5000,
    menu_name: 'カット',
    staff_name: '山田',
    friend_name: '花子',
    requested_at: '2026-09-27T00:00:00Z',
    decided_at: null,
    external_event_id: null,
    staff_id: 's1',
    source: 'liff',
    ...over,
  }
}

function slot(over: Partial<CalendarSlot> = {}): CalendarSlot {
  return {
    staffId: 's1',
    staffName: '山田',
    menuId: 'm1',
    date: '2026-09-28',
    start: '10:30',
    end: '11:00',
    startUtc: '2026-09-28T10:30:00+09:00',
    endUtc: '2026-09-28T11:00:00+09:00',
    remaining: 1,
    state: 'available',
    ...over,
  }
}

function show(items: BookingRequest[], slots: CalendarSlot[]) {
  return render(
    <BookingCalendar
      mode="day"
      items={items}
      onOpen={() => {}}
      staffNames={['山田']}
      canCreate
      anchorDay="2026-09-28"
      onAnchorChange={() => {}}
      availability={{ status: 'ready', slots }}
    />,
  )
}

afterEach(cleanup)

describe('監査 R88: 受付経路は source で分ける', () => {
  it('担当者の代理入力（source=operator＋friend_idあり）は電話に数える', () => {
    show(
      [
        booking({ id: 'op', source: 'operator', friend_id: 'f1' }),
        booking({ id: 'li', source: 'liff', friend_id: 'f2' }),
      ],
      [],
    )
    expect(screen.getByText('LINEから 1・電話 1')).toBeTruthy()
  })
})

describe('監査 R86: 取消済みは件数・売上見込みから外す', () => {
  it('取消済み5000円だけの日は売上見込み¥0でカードに状態が出る', () => {
    show([booking({ id: 'cx', status: 'cancelled', price_at_booking: 5000 })], [])
    expect(screen.getByText('0件 ／ 売上見込み ¥0')).toBeTruthy()
    expect(screen.getByText('（キャンセル）')).toBeTruthy()
  })
})

describe('監査 R87: 重ならない空き枠の入口は残す', () => {
  it('10:00の予約があっても10:30の空き枠に入口が出る', () => {
    show([booking({ status: 'confirmed' })], [slot()])
    // R315: 読み上げ名は日付・開始時刻・担当を含む（10:30 山田 空きあり）。
    expect(screen.getByLabelText(/10:30.*山田.*空きあり/)).toBeTruthy()
  })

  it('枠が予約と重なるときは入口を出さない', () => {
    show(
      [booking({ status: 'confirmed' })],
      [slot({ start: '10:00', end: '10:30', startUtc: '2026-09-28T10:00:00+09:00', endUtc: '2026-09-28T10:30:00+09:00' })],
    )
    expect(screen.queryByLabelText(/空きあり/)).toBeNull()
  })
})
it('空き枠0・未設定・取得失敗を同じ0枠とせず、失敗はその場で読み直す', () => {
  const retry = vi.fn()
  const props = { mode: 'day' as const, items: [], onOpen: vi.fn(), staffNames: ['山田'], canCreate: true, anchorDay: '2026-09-28', onAnchorChange: vi.fn(), onRetryAvailability: retry }
  const v = render(<BookingCalendar {...props} availability={{ status: 'unconfigured', slots: [] }} />)
  expect(screen.getByText(/担当者または予約メニューがまだ設定されていません/)).toBeTruthy()
  v.rerender(<BookingCalendar {...props} availability={{ status: 'error', slots: [] }} />)
  const button = screen.getByRole('button', { name: 'もう一度読み込む' })
  button.click()
  expect(retry).toHaveBeenCalledOnce()
  expect(screen.queryByText(/担当者または予約メニューがまだ設定されていません/)).toBeNull()
})
it('残り0の枠は予約入口を作らず、取れる枠のURLは担当・メニュー・実時刻を渡す', () => {
  const v = show([], [slot({ remaining: 0 })])
  expect(screen.queryByLabelText(/空きあり/)).toBeNull()
  v.unmount()
  show([], [slot()])
  const link = screen.getByLabelText(/10:30.*山田.*空きあり/)
  const url = new URL(link.getAttribute('href')!, 'http://localhost')
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ date: '2026-09-28', time: '10:30', staff: '山田', menu: 'm1' })
})
it('閲覧のみには取れる枠があっても予約入口を作らない', () => {
  render(<BookingCalendar mode="day" items={[]} onOpen={vi.fn()} staffNames={['山田']} canCreate={false} anchorDay="2026-09-28" onAnchorChange={vi.fn()} availability={{ status: 'ready', slots: [slot()] }} />)
  expect(document.querySelector('a[href*="/booking/bookings/new"]')).toBeNull()
})
it('週の稼働率は実際の予約30分と受付枠30分で50%、受付時間0は割合を出さない', () => {
  const props = { mode: 'week' as const, onOpen: vi.fn(), staffNames: ['山田'], canCreate: true, anchorDay: '2026-09-28', onAnchorChange: vi.fn() }
  const v = render(<BookingCalendar {...props} items={[booking()]} availability={{ status: 'ready', slots: [slot()] }} />)
  expect(screen.getByText('50%')).toBeTruthy()
  v.rerender(<BookingCalendar {...props} items={[]} availability={{ status: 'ready', slots: [] }} />)
  expect(screen.queryByText('50%')).toBeNull()
  expect(screen.getAllByText('受付可能な時間がありません').length).toBeGreaterThan(0)
})
