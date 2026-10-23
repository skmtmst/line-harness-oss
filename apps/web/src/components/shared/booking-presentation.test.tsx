// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReservationBoardEntry } from '@line-crm/shared'
import ReservationBoard from './reservation-board'
import ReservationMonth from './reservation-month'
import { BookingBlock } from './booking-controls'
import { BookingLegend, BookingNowLine, ReservationSource } from './booking-presentation'

const base: ReservationBoardEntry = { id: 'r', kind: 'seats', version: 1, scopeId: 's', startsAt: '2026-10-23T09:00:00Z', endsAt: '2026-10-23T10:00:00Z', status: 'confirmed', customerName: '予約のお客さま', guestCount: 2, resourceIds: ['t'], resourceLabel: '卓', source: 'line', courseName: null, note: null, dining: null, holdExpiresAt: null }
const resources = [{ id: 't', label: '卓', active: true, capacity: 2 }]
afterEach(() => { cleanup(); vi.useRealTimers() })

it.each([
  ['確定LINE', { source: 'line' }, 'confirmed'],
  ['確定電話', { source: 'phone' }, 'confirmed'],
  ['確定媒体', { source: 'tabelog' }, 'confirmed'],
  ['来店中', { status: 'seated' }, 'active'],
  ['来店済み退店前', { status: 'visited' }, 'active'],
  ['退店済み', { status: 'visited', departedAt: base.endsAt }, 'completed'],
  ['終了', { status: 'completed', kind: 'people' }, 'completed'],
  ['承認待ち', { status: 'requested' }, 'pending'],
  ['期限付きの仮押さえ', { status: 'pending', holdExpiresAt: base.startsAt }, 'hold'],
  ['仮押さえ', { holdExpiresAt: base.startsAt }, 'hold'],
  ['無断', { status: 'no_show' }, 'no_show'],
  ['遅れ', { status: 'late' }, 'warning'],
] as const)('%sは経路によらず状態の札を使い、読む操作を保つ', (_label, changes, expected) => {
  const entry = { ...base, ...changes }, open = vi.fn()
  render(<ReservationBoard entries={[entry]} resources={resources} dates={['2026-10-23']} onOpen={open} />)
  const button = screen.getByRole('button', { name: /予約のお客さま/ })
  expect(button.getAttribute('data-booking-state')).toBe(expected)
  expect(button.querySelector('strong')?.textContent).toBe(base.customerName)
  expect(button.textContent).toContain('18:00〜19:00')
  fireEvent.click(button)
  expect(open).toHaveBeenCalledWith(base.id)
  expect(screen.queryByRole('button', { name: /に予約を入れる/ })).toBeNull()
})

it('月の札にも同じ来店状態を渡し、詳細を開く', () => {
  const open = vi.fn()
  render(<ReservationMonth month="2026-10" entries={[{ ...base, status: 'seated' }]} onOpen={open} />)
  const button = screen.getByRole('button', { name: /予約のお客さま/ })
  expect(button.getAttribute('data-booking-state')).toBe('active')
  fireEvent.click(button)
  expect(open).toHaveBeenCalledWith(base.id)
})

it('凡例は同じ状態の面を使い、塗りと枠に文字の説明を付ける', () => {
  render(<BookingLegend />)
  const list = screen.getByRole('list', { name: '予約の状態' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(9)
  expect(list.querySelector('[data-booking-state="active"]')?.getAttribute('aria-hidden')).toBe('true')
  expect(list.textContent).toContain('要対応（承認待ち）')
  expect(list.textContent).toContain('仮押さえ')
  expect(list.textContent).toContain('無断キャンセル')
  expect(list.textContent).toContain('要対応')
})

it('種類は名前の前の装飾の丸だけに色を持ち、経路名を文字で残す', () => {
  const { container } = render(<ReservationSource value="line" />)
  const source = container.querySelector('[data-source="line"]')!
  expect(source.textContent).toBe('LINE')
  expect(source.querySelector('[aria-hidden="true"]')?.getAttribute('style')).toContain('background-color: var(--color-accent-deep)')
  expect(source.hasAttribute('style')).toBe(false)
  expect(source.querySelector('[role="img"]')).toBeNull()
})

it('上限を超えた札は要対応とし、従来の媒体の指定でも確定を塗らない', () => {
  render(<><BookingBlock tone="over">受付数超過</BookingBlock><BookingBlock tone="media">媒体予約</BookingBlock></>)
  expect(screen.getByRole('button', { name: '受付数超過' }).getAttribute('data-booking-state')).toBe('attention')
  expect(screen.getByRole('button', { name: '媒体予約' }).getAttribute('data-booking-state')).toBe('confirmed')
})

it('今の時刻は札と細い線の共通表示で伝える', () => {
  render(<BookingNowLine time="18:24" />)
  const line = screen.getByLabelText('今 18:24')
  expect(line.getAttribute('data-direction')).toBe('vertical')
  expect(line.textContent).toBe('18:24')
})

it('今日の表だけに現在時刻を示し、別の日には残さない', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T09:24:00Z'))
  const props = { entries: [base], resources, onOpen: vi.fn() }
  const view = render(<ReservationBoard {...props} dates={['2026-10-23']} />)
  expect(screen.getByLabelText('今 18:24')).toBeTruthy()
  view.rerender(<ReservationBoard {...props} dates={['2026-10-24']} />)
  expect(screen.queryByLabelText('今 18:24')).toBeNull()
})

it('同じ卓の重なりは要対応、次の実予約までの空きだけを分で示す', () => {
  const next = { ...base, id: 'next', customerName: '次のお客さま', startsAt: '2026-10-23T10:24:00Z', endsAt: '2026-10-23T11:00:00Z' }
  const props = { resources, dates: ['2026-10-23'], onOpen: vi.fn() }
  const view = render(<ReservationBoard {...props} entries={[base, next]} />)
  expect(screen.getByLabelText('次の予約まで空き24分').textContent).toBe('24分')
  view.rerender(<ReservationBoard {...props} entries={[base, { ...next, startsAt: '2026-10-23T09:30:00Z' }]} />)
  expect(screen.queryByLabelText('次の予約まで空き24分')).toBeNull()
  expect(screen.getByRole('button', { name: /次のお客さま/ }).getAttribute('data-booking-state')).toBe('attention')
  view.rerender(<ReservationBoard {...props} entries={[{ ...base, status: 'no_show' }, next]} />)
  expect(screen.getByRole('button', { name: /予約のお客さま/ }).getAttribute('data-booking-state')).toBe('no_show')
  expect(screen.getByRole('button', { name: /次のお客さま/ }).getAttribute('data-booking-state')).toBe('confirmed')
  expect(screen.queryByLabelText('次の予約まで空き24分')).toBeNull()
})
