// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { eventsApi, type EventBookingItem } from '@/lib/api'
import { LessonRoster } from './lesson-roster'
import { attendanceTargets, lessonRosterMembers, loadLessonBookings } from './lesson-roster-data'
import type { StyleRoster } from './model'

vi.mock('@/lib/api', () => ({ eventsApi: { listBookings: vi.fn() } }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const booking = (id: number, name = '同じ名前') => ({ id: `b${id}`, event_id: 'event', friend_display_name: name, status: 'confirmed', cancelled_at: null } as EventBookingItem)
const roster = (items: EventBookingItem[]): StyleRoster => ({ rowId: 'r', head: '10:00', title: '教室', pay: { label: '—', tone: 'neutral' }, meta: '', members: lessonRosterMembers(items), more: '', payLinkCount: 0 })
const noop = () => {}

test('同名の2名でも、押した予約だけが個別出席対象になる', () => {
  const value = roster([booking(1), booking(2)])
  const onAttend = vi.fn()
  render(<LessonRoster roster={value} canWrite onAttend={onAttend} onAbsent={noop} onClose={noop} onPay={noop} onLine={noop} onCancelClass={noop} />)
  fireEvent.click(screen.getAllByRole('button', { name: '出席', exact: true })[1])
  expect(onAttend).toHaveBeenCalledWith('b2')
  expect(attendanceTargets(value, onAttend.mock.calls[0][0]).map(m => m.bookingId)).toEqual(['b2'])
})

test('8人目を展開でき、全員出席には非表示の人も含まれる', () => {
  const value = roster(Array.from({ length: 8 }, (_, i) => booking(i, `生徒${i}`)))
  const onAttend = vi.fn()
  render(<LessonRoster roster={value} canWrite onAttend={onAttend} onAbsent={noop} onClose={noop} onPay={noop} onLine={noop} onCancelClass={noop} />)
  expect(screen.queryByText('生徒7')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /ほか 1人を表示する/ }))
  expect(screen.getByText('生徒7')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '全員出席' }))
  expect(attendanceTargets(value, onAttend.mock.calls[0][0])).toHaveLength(8)
})

test('出席済み・欠席・取消を全員出席で再更新しない', () => {
  const items = [booking(1), { ...booking(2), status: 'attended' }, { ...booking(3), status: 'no_show' }, { ...booking(4), cancelled_at: '2026-01-01' }]
  expect(attendanceTargets(roster(items), null).map(m => m.bookingId)).toEqual(['b1'])
})

test('51名の名簿を2ページ取得し、全員操作の対象を切り捨てない', async () => {
  vi.mocked(eventsApi.listBookings).mockResolvedValueOnce({ items: Array.from({ length: 50 }, (_, i) => booking(i)), total: 51, limit: 50, sort: [] }).mockResolvedValueOnce({ items: [booking(50)], total: 51, limit: 50, sort: [] })
  const controller = new AbortController()
  const items = await loadLessonBookings('a', 'e', 's', controller.signal)
  expect(items).toHaveLength(51)
  expect(eventsApi.listBookings).toHaveBeenLastCalledWith('a', 'e', { slot_id: 's', limit: 50, page: 2 }, { signal: controller.signal })
})

test('ページ途中の失敗を一部だけの全員名簿として返さない', async () => {
  vi.mocked(eventsApi.listBookings).mockResolvedValueOnce({ items: [booking(1)], total: 2, limit: 1, sort: [] }).mockRejectedValueOnce(new Error('失敗'))
  await expect(loadLessonBookings('a', 'e', 's', new AbortController().signal)).rejects.toThrow('失敗')
})
