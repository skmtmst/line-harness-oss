// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { StyleBooking, StyleSchedule, StyleSnapshot } from '@line-crm/shared'
import { toToday } from './adapter'
import { TodayList } from './today-list'

afterEach(cleanup)
const booking: StyleBooking = {
  id: 'r', version: 1, updatedAt: null, kind: 'restaurant', friendId: null, personKey: 'r', name: '顧客 花子',
  startsAt: '2026-11-01T01:00:00Z', endsAt: '2026-11-01T02:00:00Z', requestedAt: '2026-10-30T00:00:00Z', status: 'confirmed',
  staffId: null, menuId: 'course', menuName: '季節のコース', storeId: 'store', slotId: 't1', partySize: 2, price: 0,
  visited: false, attendance: null, held: false, meetingMode: null, meetingUrl: null, location: null, outcome: null,
  source: 'line', entryPoint: null, refCode: null, designation: null, cancelledAt: null, confirmedResponse: null, participationMode: null,
}
const snapshot: StyleSnapshot = { style: 'restaurant', asOf: '2026-11-01T00:00:00Z', timeZone: 'Asia/Tokyo', range: 'today', from: '2026-11-01T00:00:00+09:00', to: '2026-11-02T00:00:00+09:00', dateBasis: 'visit', metrics: {}, previous: {}, items: [], newBookings: [], resultId: 'fixture' }
const schedule: StyleSchedule = {
  ...snapshot, display: 'list', calendarView: 'day',
  columns: [{ id: 'unassigned', name: '担当未定', kind: 'unassigned' }],
  entries: [{ id: 'restaurant:r', kind: 'restaurant', columnIds: ['unassigned'], tableNames: ['窓側2人卓', '奥の4人卓'], startsAt: booking.startsAt, endsAt: booking.endsAt, title: '季節のコース', booking }],
  days: [{ date: '2026-11-01', entryIds: ['restaurant:r'], bookings: 1, people: 2 }], closures: [], availability: { status: 'available', reason: null, resources: [], slots: [], closedDates: [] },
}
const today = (data = schedule, style = 'restaurant' as StyleSchedule['style']) => toToday(style, { ...snapshot, style }, { ...data, style }, '2026-11-01', 'today', new Date(snapshot.asOf))

it('実際の一覧で、名前・人数・卓・コースを各見出しの下に出す', () => {
  const data = today()
  render(<TodayList style="restaurant" rows={data.rows} note={data.rowsNote} canWrite={false} busyId="" menuFor={() => []} onVisit={() => {}} onUndo={() => {}} />)
  const rows = screen.getAllByRole('row')
  expect(within(rows[0]).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['時刻', '名前', '人数', '卓', 'コース', 'お支払い', '状態', '来店'])
  const cells = within(rows[1]).getAllByRole('cell')
  expect(cells[1].textContent).toContain('顧客 花子')
  expect(cells[2].textContent).toBe('2')
  expect(cells[3].textContent).toBe('窓側2人卓・奥の4人卓')
  expect(within(cells[3]).getByTitle('窓側2人卓・奥の4人卓')).toBeTruthy()
  expect(cells[4].textContent).toContain('季節のコース')
  expect(cells[3].textContent).not.toContain('担当')
  expect(cells[4].textContent).not.toContain('花子')
})

it.each(['restaurant', 'salon', 'consult', 'lesson'] as const)('%sの一覧・盤・カレンダーで顧客名をメニュー名に代用しない', style => {
  const data = today(schedule, style)
  expect(style === 'consult' ? data.rows[0].sub : data.rows[0].course).toBe('季節のコース')
  expect(data.board?.entries[0]).toMatchObject({ name: '顧客 花子', menu: '季節のコース' })
  expect(today({ ...schedule, display: 'calendar' }, style).week?.entries[0]).toMatchObject({ name: '顧客 花子', title: '季節のコース' })
})

it('古い応答でも担当名を卓にせず、顧客名と同じ題をコースにしない', () => {
  const data = today({ ...schedule, entries: [{ ...schedule.entries[0], title: booking.name, tableNames: undefined, booking: { ...booking, menuName: undefined } }] })
  expect(data.rows[0]).toMatchObject({ name: '顧客 花子', seat: '—', course: '—' })
  expect(data.board?.entries[0].menu).toBe('—')
  expect(today({ ...schedule, display: 'calendar', entries: [{ ...schedule.entries[0], title: booking.name, booking: { ...booking, menuName: undefined } }] }).week?.entries[0].title).toBe('—')
})

it('古い応答の卓軸は卓の列名だけ使い、コースなしは席のみと出す', () => {
  const data = today({ ...schedule, columns: [{ id: 't1', name: '窓側2人卓', kind: 'table' }], entries: [{ ...schedule.entries[0], columnIds: ['t1'], tableNames: undefined, title: booking.name, booking: { ...booking, menuId: null, menuName: null } }] })
  expect(data.rows[0]).toMatchObject({ seat: '窓側2人卓', course: '席のみ' })
})
