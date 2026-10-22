// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StyleSchedule, StyleSnapshot } from '@line-crm/shared'
import { toToday } from './adapter'
import { WeekCalendar } from './calendar'

const day = '2026-10-21', from = `${day}T00:00:00+09:00`, to = '2026-10-22T00:00:00+09:00'
const snapshot: StyleSnapshot = { style: 'salon', asOf: from, from, to, timeZone: 'Asia/Tokyo', dateBasis: 'visit', range: 'week', metrics: {}, previous: {}, items: [], newBookings: [], resultId: 'fixture' }
const slot = (columnId: string, start: string, end: string) => ({ columnId, menuId: 'm', date: day, startsAt: `${day}T${start}:00+09:00`, endsAt: `${day}T${end}:00+09:00`, remaining: 1 })
const schedule: StyleSchedule = {
  style: 'salon', asOf: from, from, to, timeZone: 'Asia/Tokyo', range: 'week', display: 'calendar', calendarView: 'week',
  columns: [{ id: 'selected-staff', kind: 'staff', name: '担当者' }], entries: [], days: [{ date: day, entryIds: [], bookings: 0, people: 0 }], closures: [],
  availability: { status: 'available', reason: null, resources: [], slots: [slot('selected-staff', '10:00', '10:15'), slot('selected-staff', '10:15', '10:45'), slot('selected-staff', '11:00', '11:30')], closedDates: [] },
}
afterEach(cleanup)

describe('APIの週間の空き時刻', () => {
  it('同日に返った15分・30分・後の空きをすべて保ち、それぞれの作成時刻を渡す', () => {
    const week = toToday('salon', snapshot, schedule, day, 'week').week!
    expect(week.free).toEqual([{ day, start: '10:00', end: '10:15' }, { day, start: '10:15', end: '10:45' }, { day, start: '11:00', end: '11:30' }])
    const onSlot = vi.fn()
    render(<WeekCalendar week={week} canWrite onSlot={onSlot} onOpen={() => {}} onMove={() => {}} />)
    for (const start of ['10:00', '10:15', '11:00']) fireEvent.click(screen.getByRole('button', { name: `${day} ${start}に予約を入れる` }))
    expect(onSlot.mock.calls).toEqual([[day, '10:00'], [day, '10:15'], [day, '11:00']])
  })

  it('別リソースの同時刻も落とさず、APIが絞り込んだ範囲をそのまま保つ', async () => {
    const simultaneous = { ...schedule, availability: { ...schedule.availability, slots: [...schedule.availability.slots, slot('other-returned-staff', '10:00', '10:15')] } }
    const week = toToday('salon', snapshot, simultaneous, day, 'week').week!
    expect(week.free).toHaveLength(4)
    expect(week.free.filter(s => s.start === '10:00')).toHaveLength(2)
    const onSlot = vi.fn()
    const view = render(<WeekCalendar week={week} canWrite onSlot={onSlot} onOpen={() => {}} onMove={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: `${day} 10:00からの空き2件を選ぶ` }))
    const dialog = await screen.findByRole('dialog')
    const starts = within(dialog).getAllByRole('button', { name: `${day} 10:00〜10:15に予約を入れる` })
    expect(starts).toHaveLength(2)
    fireEvent.click(starts[1])
    expect(onSlot).toHaveBeenCalledWith(day, '10:00')
    view.rerender(<WeekCalendar week={week} canWrite={false} onSlot={onSlot} onOpen={() => {}} onMove={() => {}} />)
    expect(screen.queryByRole('button', { name: /に予約を入れる|空き2件を選ぶ/ })).toBeNull()
    expect(onSlot).toHaveBeenCalledOnce()
  })
})

it('実APIの早朝・深夜・翌日にまたがる予約を表示日へ分割し、IDと時刻の軸を保つ', () => {
  const nextDay = '2026-10-22'
  const late: StyleSchedule = { ...schedule, style: 'lesson', days: [...schedule.days, { date: nextDay, entryIds: [], bookings: 0, people: 0 }],
    entries: [
      { id: 'early', kind: 'class', columnIds: ['selected-staff'], startsAt: `${day}T07:15:00+09:00`, endsAt: `${day}T07:45:00+09:00`, title: '早朝', booking: null },
      { id: 'lesson', kind: 'class', columnIds: ['selected-staff'], startsAt: `${day}T20:45:00+09:00`, endsAt: `${day}T21:30:00+09:00`, title: '体験ヨガ', booking: null },
      { id: 'overnight', kind: 'class', columnIds: ['selected-staff'], startsAt: `${day}T23:30:00+09:00`, endsAt: `${nextDay}T00:30:00+09:00`, title: '日をまたぐ', booking: null },
      { id: 'midnight', kind: 'class', columnIds: ['selected-staff'], startsAt: `${day}T22:30:00+09:00`, endsAt: `${nextDay}T00:00:00+09:00`, title: '午前0時まで', booking: null },
    ], availability: { ...schedule.availability, slots: [] } }
  const week = toToday('lesson', { ...snapshot, style: 'lesson' }, late, day, 'week').week!
  expect(week.entries.filter(row => row.id === 'overnight')).toEqual([
    { id: 'overnight', day, start: '23:30', end: '24:00', title: '日をまたぐ', name: '' },
    { id: 'overnight', day: nextDay, start: '00:00', end: '00:30', title: '日をまたぐ', name: '' },
  ])
  expect(week.entries.filter(row => row.id === 'midnight')).toHaveLength(1)
  const onOpen = vi.fn()
  render(<WeekCalendar week={week} canWrite={false} onSlot={() => {}} onOpen={onOpen} onMove={() => {}} />)
  expect(screen.getByText('00:00')).toBeTruthy()
  expect(screen.getByText('23:00')).toBeTruthy()
  const lateButton = screen.getByRole('button', { name: '20:45〜21:30 体験ヨガ' })
  const grid = lateButton.closest('[style*="--calendar-hour-count"]') as HTMLElement
  expect(grid.style.getPropertyValue('--calendar-hour-count')).toBe('24')
  expect(lateButton.parentElement?.style.insetBlockStart).toContain('20.75')
  fireEvent.click(lateButton)
  for (const label of ['23:30〜24:00 日をまたぐ', '00:00〜00:30 日をまたぐ']) fireEvent.click(screen.getByRole('button', { name: label }))
  expect(onOpen.mock.calls).toEqual([['lesson'], ['overnight'], ['overnight']])
})

it('翌日にまたがる空きも日ごとに保持し、終了0時の空の区間を増やさない', () => {
  const nextDay = '2026-10-22'
  const crossing = { ...schedule, days: [...schedule.days, { date: nextDay, entryIds: [], bookings: 0, people: 0 }], availability: { ...schedule.availability, slots: [
    { ...slot('selected-staff', '23:30', '23:45'), endsAt: `${nextDay}T00:15:00+09:00` },
    { ...slot('selected-staff', '22:30', '23:45'), endsAt: `${nextDay}T00:00:00+09:00` },
  ] } }
  const week = toToday('salon', snapshot, crossing, day, 'week').week!
  expect(week.free).toEqual([{ day, start: '23:30', end: '24:00' }, { day: nextDay, start: '00:00', end: '00:15', bookingDay: day, bookingStart: '23:30' }, { day, start: '22:30', end: '24:00' }])
  const onSlot = vi.fn()
  render(<WeekCalendar week={week} canWrite onSlot={onSlot} onOpen={() => {}} onMove={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: `${day} 23:30に予約を入れる` }))
  expect(onSlot).toHaveBeenCalledWith(day, '23:30')
  expect(screen.queryByRole('button', { name: `${nextDay} 00:00に予約を入れる` })).toBeNull()
})
