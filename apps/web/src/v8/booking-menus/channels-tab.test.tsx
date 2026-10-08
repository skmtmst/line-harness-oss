// @vitest-environment happy-dom
/*
 * ★V8-B 予約設定の予約経路の連携（ZyDd6）。
 * 絵のとおり、つながっている人は「予定を見る」（中身の窓からつなぎ直せる）、
 * つないでいない人は「つなぐ」、期限切れは「つなぎ直す」。閲覧のみは見るだけ。
 * 名前の下に担当スタッフの役割を出す。
 */
import React from 'react'
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
vi.mock('@/components/shared/toast', () => ({ notifyToast: vi.fn() }))

import ChannelsTabV8 from './channels-tab'

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
  for (const fn of Object.values(api)) fn.mockReset()
  api.channels.mockResolvedValue({ success: true, data: channelsData })
  api.conflicts.mockResolvedValue({ success: true, data: { conflicts: [] } })
  api.calendarDetail.mockResolvedValue({ connection: { calendar_id: 'takada@example.com' }, service_account: { configured: true, email: null } })
})
afterEach(cleanup)

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

  it('閲覧のみはつなぐ・つなぎ直すを置かず、予定を見るの窓にもつなぎ直すを置かない', async () => {
    render(<ChannelsTabV8 accountId="account-a" canEdit={false} staff={staff} />)
    expect(await screen.findByText('高田誠')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'つなぐ' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'つなぎ直す' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '予定を見る' }))
    expect(screen.getByText('高田誠の Google カレンダー')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'つなぎ直す' })).toBeNull()
  })
})

describe('予約経路の世代と閲覧のみ（WEB058/059）', () => {
  it('WEB059：閲覧のみには「重なりを解消する」を置かず、重なりの知らせは出す', async () => {
    api.conflicts.mockResolvedValue({ success: true, data: { conflicts: [{ id: 'c1' }, { id: 'c2' }] } })
    render(<ChannelsTabV8 accountId="account-a" canEdit={false} staff={staff} />)
    await screen.findByText(/予約が 2 件重なっています/)
    expect(screen.queryByRole('button', { name: '重なりを解消する' })).toBeNull()
  })

  it('WEB058：B に切り替えたあとに A の応答が届いても、B の一覧のまま', async () => {
    let releaseA: () => void = () => undefined
    api.channels.mockImplementation(async (accountId: string) => {
      if (accountId === 'account-a') await new Promise<void>((resolve) => { releaseA = resolve })
      return { success: true, data: { ...channelsData, staff: [{ ...channelsData.staff[1], displayName: accountId === 'account-a' ? 'Aの人' : 'Bの人' }] } }
    })
    const view = render(<ChannelsTabV8 accountId="account-a" canEdit staff={staff} />)
    view.rerender(<ChannelsTabV8 accountId="account-b" canEdit staff={staff} />)
    await screen.findByText('Bの人')
    await act(async () => { releaseA() })
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText('Aの人')).toBeNull()
  })
})
