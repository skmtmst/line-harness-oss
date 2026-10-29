// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import ChannelsTables from './channels-tables'
import type { BookingChannelsData } from './lib/booking-channels'

const data: BookingChannelsData = {
  timeZone: 'Asia/Tokyo', autoAssign: false,
  staff: ['connected', 'not_connected', 'expired'].map((status, i) => ({
    staffId: `s${i}`, displayName: `担当${i}`, status: status as BookingChannelsData['staff'][number]['status'],
    externalEventsThisWeek: null, lastReadAt: null, readError: null,
  })),
  channels: ['line', 'manual', 'hot_pepper_beauty', 'epark', 'other'].map((key, i) => ({ key, status: i % 2 ? 'preparing' : 'active', todayCount: i === 0 ? 14 : null })),
}
const detail = vi.fn(), connect = vi.fn()
beforeEach(() => { verifiedStaffRole('owner'); detail.mockClear(); connect.mockClear() })
afterEach(() => { cleanup(); verifiedStaffRole(null) })
function show(canEdit = true) { return render(<ChannelsTables data={data} canEdit={canEdit} roles={{}} calendars={{}} onDetail={detail} onConnect={connect} />) }

it('状態や経路によらず行末は主操作1つとメニュー1つ、未知件数は未知のまま', () => {
  const view = show()
  const rows = [...view.container.querySelectorAll('tbody tr')]
  expect(rows).toHaveLength(8)
  for (const row of rows) {
    const actions = row.querySelector('[data-row-actions]')!
    expect(actions).toBeTruthy()
    expect(actions.querySelectorAll(':scope > button, :scope > a')).toHaveLength(2)
    expect(actions.querySelectorAll('[data-row-menu]')).toHaveLength(1)
  }
  expect(screen.getAllByRole('link', { name: '予約管理へ' })).toHaveLength(5)
  expect(screen.getByRole('columnheader', { name: '今日の予約' })).toBeTruthy()
  expect(screen.getByText('14件')).toBeTruthy()
  expect(screen.queryByText('0件')).toBeNull()
  expect(screen.queryByText(/Google カレンダーに書き出せない入り口は/)).toBeNull()
})

it('既存の予定表示と接続の対象をそのまま渡す', () => {
  show()
  fireEvent.click(screen.getByRole('button', { name: '予定を見る' }))
  expect(detail).toHaveBeenCalledWith(data.staff[0])
  fireEvent.click(screen.getByRole('button', { name: 'つなぐ' }))
  expect(connect).toHaveBeenLastCalledWith(data.staff[1])
  fireEvent.click(screen.getByRole('button', { name: 'つなぎ直す' }))
  expect(connect).toHaveBeenLastCalledWith(data.staff[2])
})

it('閲覧のみは接続を残して灰色・焦点の理由・実行拒否、予定は読める', async () => {
  verifiedStaffRole('viewer')
  show(false)
  const action = screen.getByRole('button', { name: 'つなぐ' })
  expect(action.getAttribute('aria-disabled')).toBe('true')
  expect((action as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(action)
  fireEvent.click(screen.getByRole('button', { name: '担当1のその他操作' }))
  const item = screen.getByRole('menuitem', { name: 'つなぐ' })
  expect(item.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(item)
  expect(await screen.findByRole('tooltip')).toHaveProperty('textContent', expect.stringContaining('閲覧のみ'))
  fireEvent.click(item)
  expect(connect).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '予定を見る' }))
  expect(detail).toHaveBeenCalledWith(data.staff[0])
})

it('予約経路の既存リンクとカレンダーへの移動を保つ', () => {
  const view = show()
  const heading = view.container.querySelector('#channels-calendar-heading')!
  const scroll = vi.fn()
  Object.defineProperty(heading, 'scrollIntoView', { value: scroll })
  fireEvent.click(screen.getByRole('button', { name: 'Hot Pepper Beautyのその他操作' }))
  const menu = screen.getByRole('menu')
  expect(within(menu).getByRole('menuitem', { name: '予約管理で見る' }).getAttribute('href')).toBe('/booking/bookings')
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'スタッフのカレンダーを確かめる' }))
  expect(scroll).toHaveBeenCalledWith({ block: 'start' })
})
