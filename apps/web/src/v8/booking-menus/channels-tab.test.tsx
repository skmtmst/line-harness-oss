// @vitest-environment happy-dom
/*
 * ★V8-B 予約設定の予約経路の連携。
 * 絵のとおり、つながっている人は「予定を見る」（中身の窓からつなぎ直せる）、
 * つないでいない人は「つなぐ」、期限切れは「つなぎ直す」。閲覧のみは見るだけ。
 * 名前の下に担当スタッフの役割を出す。
 */
import React from 'react'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import type { BookingConflict, BookingConflictReservation } from '@line-crm/shared'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  channels: vi.fn(),
  conflicts: vi.fn(),
  calendarDetail: vi.fn(),
  connectCalendar: vi.fn(),
  reassign: vi.fn(),
}))

vi.mock('./lib/booking-channels', () => ({ bookingChannelsApi: api }))
vi.mock('@/components/shared/toast', () => ({ ...(() => { const notifyToast = vi.fn(); return { notifyToast, notifySaved: notifyToast } })() }))

import ChannelsTabV8 from './channels-tab'
import ChannelsSummaryBand from './channels-summary'
import type { BookingChannelsData } from './lib/booking-channels'

const channelsData = {
  timeZone: 'Asia/Tokyo',
  staff: [
    { staffId: 's1', displayName: '高田誠', status: 'connected', externalEventsThisWeek: 12, lastReadAt: '2026-10-02T18:40:00+09:00', readError: null },
    { staffId: 's2', displayName: '佐野直人', status: 'not_connected', externalEventsThisWeek: null, lastReadAt: null, readError: null },
    { staffId: 's3', displayName: '森涼太', status: 'expired', externalEventsThisWeek: null, lastReadAt: null, readError: null },
  ],
  autoAssign: true,
  channels: [{ key: 'line', status: 'active', todayCount: 14 }],
}
const staff = [{ id: 's1', name: '高田誠', display_name: '高田', role: 'トリマー', profile_image_url: null, bio: null, sort_order: 1, is_designation_optional: 0, is_active: 1 }]

beforeEach(() => {
  verifiedStaffRole('owner')
  for (const fn of Object.values(api)) fn.mockReset()
  api.channels.mockResolvedValue({ success: true, data: channelsData })
  api.conflicts.mockResolvedValue({ success: true, data: { conflicts: [] } })
  api.calendarDetail.mockResolvedValue({ connection: { calendar_id: 'takada@example.com' }, service_account: { configured: true, email: null } })
})
afterEach(() => { cleanup(); verifiedStaffRole(null) })

describe('予約経路の連携（ZyDd6）', () => {
  it('状態ごとの操作と名前の下の役割を出し、予定を見るの窓からつなぎ直せる', async () => {
    render(<ChannelsTabV8 accountId="account-a" canEdit staff={staff} />)
    expect(await screen.findByText('高田誠')).toBeTruthy()
    expect(screen.getByText('トリマー')).toBeTruthy()
    expect(screen.getByRole('button', { name: '予定を見る' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'つなぐ' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'つなぎ直す' })).toBeTruthy()
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: '予定を見る' }))
    expect(screen.getByText('高田誠の Google カレンダー')).toBeTruthy()
    expect(screen.getAllByText('takada@example.com').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'つなぎ直す' }).at(-1)!)
    expect(screen.getByText('高田誠の Google カレンダーをつなぐ')).toBeTruthy()
  })

  it('閲覧のみは行の連携操作を理由付きで残して拒み、予定を見る窓は読める', async () => {
    verifiedStaffRole('viewer')
    render(<ChannelsTabV8 accountId="account-a" canEdit={false} staff={staff} />)
    expect(await screen.findByText('高田誠')).toBeTruthy()
    for (const name of ['つなぐ', 'つなぎ直す']) {
      const action = screen.getByRole('button', { name })
      expect(action.getAttribute('aria-disabled')).toBe('true')
      fireEvent.click(action)
    }
    expect(api.connectCalendar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '予定を見る' }))
    expect(screen.getByText('高田誠の Google カレンダー')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'つなぎ直す' })).toHaveLength(1)
    expect(api.connectCalendar).not.toHaveBeenCalled()
  })
})

describe('予約経路の世代と閲覧のみ（WEB058/059）', () => {
  it('WEB059：閲覧のみには「重なりを解消する」を置かず、重なりの知らせは出す', async () => {
    const conflicts: BookingConflict[] = ['s1', 's2'].map((staffId, index) => {
      const reservation: BookingConflictReservation = {
        bookingId: `booking-${index}`, customerName: '花子さん', menuName: 'カット', staffId,
        staffName: index === 0 ? '高田誠' : '佐野直人', startsAt: '2026-10-03T04:00:00Z',
        endsAt: '2026-10-03T05:00:00Z', source: 'line', sourceLabel: 'LINE', version: 1,
      }
      return {
        staffId, staffName: reservation.staffName, bookingId: reservation.bookingId,
        otherBookingId: `other-${index}`, startsAt: reservation.startsAt, endsAt: reservation.endsAt,
        otherStartsAt: reservation.startsAt, otherEndsAt: reservation.endsAt, version: 1, otherVersion: 1,
        bookings: [reservation, { ...reservation, bookingId: `other-${index}` }],
        reasonCode: 'same_staff_time_overlap', reason: '同じ担当の予約時間が重なっています。',
        calendarConnected: false, guidance: null,
      }
    })
    api.conflicts.mockResolvedValue({ success: true, data: { conflicts } })
    render(<ChannelsTabV8 accountId="account-a" canEdit={false} staff={staff} />)
    await screen.findByText(/予約が 2 件重なっています/)
    expect(screen.queryByRole('button', { name: '重なりを解消する' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重なりを見る' }))
    expect(screen.getByText('同じ担当の予約時間が重なっています。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '移して知らせる' })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(api.reassign).not.toHaveBeenCalled()
  })

  it('WEB058：B に切り替えたあとに A の応答が届いても、B の一覧のまま', async () => {
    let releaseA: () => void = () => undefined
    api.channels.mockImplementation(async (accountId: string) => {
      if (accountId === 'account-a') await new Promise<void>((resolve) => { releaseA = resolve })
      return { success: true, data: { ...channelsData, staff: [{ ...channelsData.staff[1], displayName: accountId === 'account-a' ? 'Aの人' : 'Bの人' }] } }
    })
    const onSummaryChange = vi.fn()
    const view = render(<ChannelsTabV8 accountId="account-a" canEdit staff={staff} onSummaryChange={onSummaryChange} />)
    view.rerender(<ChannelsTabV8 accountId="account-b" canEdit staff={staff} onSummaryChange={onSummaryChange} />)
    await screen.findByText('Bの人')
    await act(async () => { releaseA() })
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText('Aの人')).toBeNull()
    expect(onSummaryChange.mock.calls.some(([summary]) => summary.accountId === 'account-b' && summary.data?.staff.some((person: { displayName: string }) => person.displayName === 'Aの人'))).toBe(false)
  })
})

it('取得済みのAからBへ切り替えても、Aの数をBの集計として渡さない', async () => {
  api.channels.mockImplementation(async (accountId: string) => ({ success: true, data: { ...channelsData, staff: [{ ...channelsData.staff[0], displayName: accountId === 'account-a' ? 'Aの担当' : 'Bの担当' }] } }))
  const onSummaryChange = vi.fn()
  const view = render(<ChannelsTabV8 accountId="account-a" canEdit onSummaryChange={onSummaryChange} />)
  await screen.findByText('Aの担当')
  view.rerender(<ChannelsTabV8 accountId="account-b" canEdit onSummaryChange={onSummaryChange} />)
  await screen.findByText('Bの担当')
  expect(onSummaryChange.mock.calls.some(([summary]) => summary.accountId === 'account-b' && summary.data?.staff.some((person: { displayName: string }) => person.displayName === 'Aの担当'))).toBe(false)
})

it('Google予約行が実データにあっても行・操作の入口を出さず、カレンダーは保つ', async () => {
  api.channels.mockResolvedValue({ success: true, data: { ...channelsData, channels: [...channelsData.channels, { key: 'google_reserve', status: 'active', todayCount: 100 }] } })
  render(<ChannelsTabV8 accountId="account-a" canEdit staff={staff} />)
  await screen.findByText('高田誠')
  expect(screen.queryByText('Google で予約')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Google で予約の操作' })).toBeNull()
  expect(screen.getByRole('heading', { name: 'スタッフの Google カレンダー' })).toBeTruthy()
})

it('非表示のGoogle予約を経路数と今日の件数に含めない', () => {
  const data = { ...channelsData, channels: [...channelsData.channels, { key: 'google_reserve', status: 'active', todayCount: 100 }] } as BookingChannelsData
  render(<ChannelsSummaryBand summary={{ accountId: 'account-a', status: 'ready', data, conflicts: 0 }} />)
  expect(screen.getByText('14')).toBeTruthy()
  expect(screen.queryByText('114')).toBeNull()
  expect(screen.getAllByText('1')).toHaveLength(2)
  expect(screen.queryByText('2')).toBeNull()
})
