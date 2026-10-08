// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BookingConflict } from '@line-crm/shared'

const net = vi.hoisted(() => ({ reassign: vi.fn() }))
vi.mock('./lib/booking-channels', () => ({ bookingChannelsApi: net }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: vi.fn() }))
import { ConflictDialog } from './channels-tab'

const conflict: BookingConflict = {
  staffId: 's1', staffName: '佐野', bookingId: 'b1', otherBookingId: 'b2',
  startsAt: '2026-10-03T04:00:00Z', endsAt: '2026-10-03T05:00:00Z',
  otherStartsAt: '2026-10-03T04:00:00Z', otherEndsAt: '2026-10-03T04:45:00Z',
  version: 1, otherVersion: 1, reasonCode: 'same_staff_time_overlap',
  reason: '同じ担当の予約時間が重なっています。', calendarConnected: false,
  guidance: '担当のGoogleカレンダーをつなぎ、外の予約もカレンダーへ書き出すと、次から重なりを防げます。',
  bookings: [
    { bookingId: 'b1', customerName: '山田', menuName: 'トリミング', staffId: 's1', staffName: '佐野', startsAt: '2026-10-03T04:00:00Z', endsAt: '2026-10-03T05:00:00Z', source: 'liff', sourceLabel: 'LINE（musubo）', version: 1 },
    { bookingId: 'b2', customerName: '鈴木', menuName: 'シャンプー', staffId: 's1', staffName: '佐野', startsAt: '2026-10-03T04:00:00Z', endsAt: '2026-10-03T04:45:00Z', source: 'import', sourceLabel: '外部取り込み', version: 1 },
  ],
}
const staff = [
  { staffId: 's1', displayName: '佐野', status: 'not_connected' as const, externalEventsThisWeek: null, lastReadAt: null, readError: null },
  { staffId: 's2', displayName: '中川', status: 'connected' as const, externalEventsThisWeek: 0, lastReadAt: null, readError: null },
]
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('2件の名前・メニュー・受付経路と日本時間を返事どおりに表示する', () => {
  render(<ConflictDialog accountId="a" conflict={conflict} staff={staff} onClose={() => {}} onDone={() => {}} />)
  expect(screen.getByRole('heading').textContent).toContain('10/3（土） 13:00')
  expect(screen.getByText(/① LINE（musubo）・山田さん・トリミング・13:00〜14:00/)).toBeTruthy()
  expect(screen.getByText(/② 外部取り込み・鈴木さん・シャンプー・13:00〜13:45/)).toBeTruthy()
  expect(screen.getByText(conflict.guidance!)).toBeTruthy()
  expect(screen.getByText('①の予約を移す先のスタッフ')).toBeTruthy()
  expect(document.body.textContent).not.toContain('Hot Pepper Beauty')
  expect(document.body.textContent).not.toContain('13:00に空いている')
})

it('連携済みなら未連携の案内を出さず、失敗した移動は同じ窓からやり直せる', async () => {
  const done = vi.fn()
  net.reassign.mockRejectedValueOnce(new Error('空きがなくなりました')).mockResolvedValueOnce({ booking_id: 'b1', status: 'confirmed' })
  render(<ConflictDialog accountId="a" conflict={{ ...conflict, calendarConnected: true, guidance: null }} staff={staff} onClose={() => {}} onDone={done} />)
  expect(screen.queryByText(conflict.guidance!)).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '移して知らせる' })) })
  expect(done).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('空きを確かめてやり直してください')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '移して知らせる' })) })
  expect(net.reassign).toHaveBeenLastCalledWith('a', 'b1', { staffId: 's2', notifyCustomer: true })
  expect(done).toHaveBeenCalledTimes(1)
})
