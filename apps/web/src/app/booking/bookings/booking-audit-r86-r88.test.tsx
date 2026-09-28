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
