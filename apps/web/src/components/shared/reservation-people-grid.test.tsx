// @vitest-environment happy-dom
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ReservationBoardEntry } from '@line-crm/shared'
import ReservationBoard from './reservation-board'

const row: ReservationBoardEntry = { id: 'r1', kind: 'people', version: 7, scopeId: 'account', startsAt: '2026-10-15T00:30:00Z', endsAt: '2026-10-15T01:30:00Z', status: 'confirmed', customerName: '花子', resourceIds: ['a'], resourceLabel: '担当A', guestCount: 1, source: 'liff', courseName: 'カット', note: null, dining: null, holdExpiresAt: null }
const resources = [{ id: 'a', label: '担当A', active: true, capacity: 1 }, { id: 'b', label: '担当B', active: true, capacity: 1 }]
afterEach(() => { cleanup(); vi.restoreAllMocks() })

test.each([['counter', '店頭'], ['operator', '手入力'], ['import', '取り込み']])('%sの予約には電話の印でなく実際の経路を出す', (source, label) => {
  render(<ReservationBoard kind="people" timeDirection="vertical" dates={['2026-10-15']} entries={[{ ...row, source }]} resources={resources} onOpen={() => {}} />)
  expect(screen.getByRole('button', { name: /花子.*カット.*詳細/ }).textContent).toContain(label)
})

test('時刻が行、担当が列で、予約の詳細とAPIが返す空き枠だけを開ける', () => {
  const open = vi.fn()
  const slot = { resourceId: 'b', startsAt: '2026-10-15T02:00:00Z', href: '/booking/bookings/new?staff=b&time=11:00' }
  const { container } = render(<ReservationBoard kind="people" timeDirection="vertical" dates={['2026-10-15']} entries={[row]} resources={resources} slots={[slot, slot]} canWrite onOpen={open} />)
  const header = container.querySelector('[data-people-grid-head]')!
  expect(screen.getByRole('table', { name: /担当別予約/ })).toBeTruthy()
  expect(screen.getAllByRole('columnheader')).toHaveLength(3)
  expect(screen.getAllByRole('rowheader')).toHaveLength(9)
  expect(header.textContent).toContain('担当A'); expect(header.textContent).toContain('担当B')
  const hour = container.querySelector('[data-people-grid-hour="540"]')!
  expect(hour.textContent).toContain('9:00')
  expect(hour.querySelectorAll('[data-resource-id]').length).toBe(2)
  fireEvent.click(screen.getByRole('button', { name: /花子 09:30〜10:30 カットの詳細/ }))
  expect(open).toHaveBeenCalledWith('r1')
  expect(screen.getAllByRole('link', { name: /に予約を入れる/ })).toHaveLength(1)
  expect(screen.getByRole('link', { name: '担当B 11:00に予約を入れる' }).getAttribute('href')).toBe(slot.href)
})

test('縦方向の移動に読み取った版と担当を送り、失敗後は元の予約を読める', async () => {
  const move = vi.fn().mockRejectedValue(new Error('409'))
  const { container } = render(<ReservationBoard kind="people" timeDirection="vertical" dates={['2026-10-15']} entries={[row]} resources={resources} canWrite onOpen={() => {}} onMove={move} />)
  fireEvent.dragStart(screen.getByRole('button', { name: /花子 09:30/ }))
  const cell = container.querySelector('[data-people-grid-hour="600"] [data-resource-id="b"]')!
  vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 60 } as DOMRect)
  const drop = createEvent.drop(cell); Object.defineProperty(drop, 'clientY', { value: 145 }); fireEvent(cell, drop)
  await waitFor(() => expect(move).toHaveBeenCalledWith('r1', { kind: 'people', expectedVersion: 7, staffId: 'b', startsAt: '2026-10-15T01:30:00.000Z' }))
  expect(await screen.findByText(/予約は元のまま/)).toBeTruthy()
  expect(screen.getByRole('button', { name: /花子 09:30/ })).toBeTruthy()
})

test('閲覧のみでは空き枠の入口とドラッグを隠し、一覧と印刷は使える', async () => {
  const { container } = render(<ReservationBoard kind="people" timeDirection="vertical" dates={['2026-10-15']} entries={[row]} resources={resources} canWrite={false} slots={[{ resourceId: 'b', startsAt: row.startsAt, href: '/booking/bookings/new' }]} onOpen={() => {}} />)
  expect(screen.queryByRole('link', { name: /に予約を入れる/ })).toBeNull()
  expect(screen.getByRole('button', { name: /花子 09:30/ }).getAttribute('draggable')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: '一覧', exact: true }))
  expect(screen.getByRole('button', { name: '花子', exact: true })).toBeTruthy()
  expect(container.querySelector('[data-people-day-grid]')).toBeNull()
  expect(screen.getByRole('button', { name: '印刷', exact: true })).toBeTruthy()
})
