// @vitest-environment happy-dom
/*
 * ★V8-B 予約設定の予約経路タブ（ZyDd6）と重なりの知らせ（DFl3Q）。
 * 表の中身は API の実データを出す。絵の例示の数は書かない。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  channels: vi.fn(),
  conflicts: vi.fn(),
  calendarDetail: vi.fn(),
  connectCalendar: vi.fn(),
  reassign: vi.fn(),
}))

vi.mock('../lib/booking-channels', () => ({ bookingChannelsApi: api }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: vi.fn() }))

import ChannelsTabV8, { ConflictDialog } from './channels-tab-v8'

const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  api.channels.mockReset()
  api.conflicts.mockReset()
  api.calendarDetail.mockReset()
  api.connectCalendar.mockReset()
  api.reassign.mockReset()
})
afterEach(cleanup)

const channelsData = {
  timeZone: 'Asia/Tokyo',
  staff: [
    { staffId: 's1', displayName: '高田誠', status: 'connected', externalEventsThisWeek: 12, lastReadAt: '2026-10-02T18:40:00+09:00', readError: null },
    { staffId: 's2', displayName: '佐野直人', status: 'not_connected', externalEventsThisWeek: null, lastReadAt: null, readError: null },
  ],
  autoAssign: true,
  channels: [
    { key: 'line', status: 'active', todayCount: 14 },
    { key: 'hot_pepper_beauty', status: 'confirm', todayCount: null },
  ],
}

describe('予約経路タブ', () => {
  it('スタッフと経路を実データで出す', async () => {
    api.channels.mockResolvedValue({ success: true, data: channelsData })
    api.conflicts.mockResolvedValue({ success: true, data: { conflicts: [] } })
    render(<ChannelsTabV8 accountId="account-a" canEdit />)
    expect(await screen.findByText('高田誠')).toBeTruthy()
    expect(screen.getByText('つながっている')).toBeTruthy()
    expect(screen.getByText('つなぐ')).toBeTruthy()
    expect(screen.getByText('LINE（musubo の予約）')).toBeTruthy()
    expect(screen.getByText('14件')).toBeTruthy()
    expect(screen.queryByText('重なりを解消する')).toBeNull()
  })

  it('受け取っていない経路に準備中と書かない', async () => {
    api.channels.mockResolvedValue({
      success: true,
      data: {
        ...channelsData,
        channels: [
          { key: 'line', status: 'active', todayCount: 1 },
          { key: 'google_reserve', status: 'preparing', todayCount: null },
          { key: 'epark', status: 'preparing', todayCount: null },
        ],
      },
    })
    api.conflicts.mockResolvedValue({ success: true, data: { conflicts: [] } })
    render(<ChannelsTabV8 accountId="account-a" canEdit />)
    await screen.findByRole('heading', { name: '予約経路' })
    // 実データの状態（preparing）は出すが、画面に「準備中」は置かない。
    expect(document.body.textContent ?? '').not.toContain('準備中')
    expect(screen.getAllByText('まだ届いていない')).toHaveLength(2)
  })

  it('重なりがあると知らせと窓を出す', async () => {
    api.channels.mockResolvedValue({ success: true, data: channelsData })
    api.conflicts.mockResolvedValue({
      success: true,
      data: { conflicts: [{ staffId: 's1', staffName: '佐野直人', bookingId: 'b1', otherBookingId: 'b2', startsAt: '2026-10-03T13:00:00+09:00', endsAt: '2026-10-03T14:00:00+09:00', otherStartsAt: '2026-10-03T13:00:00+09:00', otherEndsAt: '2026-10-03T13:45:00+09:00', version: 1, otherVersion: 1 }] },
    })
    render(<ChannelsTabV8 accountId="account-a" canEdit />)
    expect(await screen.findByText('重なりを解消する')).toBeTruthy()
  })

  it('移して知らせるで移し替え口を叩く', async () => {
    api.reassign.mockResolvedValue({ booking_id: 'b1', lock_version: 2, status: 'confirmed' })
    const conflict = { staffId: 's1', staffName: '佐野直人', bookingId: 'b1', otherBookingId: 'b2', startsAt: '2026-10-03T13:00:00+09:00', endsAt: '2026-10-03T14:00:00+09:00', otherStartsAt: '2026-10-03T13:00:00+09:00', otherEndsAt: '2026-10-03T13:45:00+09:00', version: 1, otherVersion: 1 }
    const staff = [
      { staffId: 's1', displayName: '佐野直人', status: 'connected', externalEventsThisWeek: 1, lastReadAt: null, readError: null },
      { staffId: 's2', displayName: '中川由美', status: 'connected', externalEventsThisWeek: 0, lastReadAt: null, readError: null },
    ] as const
    let done = false
    render(<ConflictDialog accountId="account-a" conflict={conflict} staff={[...staff]} onClose={() => {}} onDone={() => { done = true }} />)
    expect(document.querySelector('[data-design-node="DFl3Q"]')).toBeTruthy()
    const buttons = [...document.querySelectorAll('button')]
    const confirm = buttons.find((b) => b.textContent?.includes('移して知らせる'))
    await act(async () => { confirm?.click() })
    expect(api.reassign).toHaveBeenCalledWith('account-a', 'b1', expect.objectContaining({ notifyCustomer: true }))
    expect(done).toBe(true)
  })
})
