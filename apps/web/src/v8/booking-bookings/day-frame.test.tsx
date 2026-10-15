// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { BookingRequest } from '@/lib/api'
import PeopleDayFrame, { dayBookingSummary } from './day-frame'

afterEach(() => { cleanup(); vi.useRealTimers() })
const row = { id: 'r1', status: 'confirmed', source: 'liff', friend_name: '花子', menu_name: 'カット', staff_name: '担当A', starts_at: '2026-10-15T02:00:00Z', ends_at: '2026-10-15T03:00:00Z', price_at_booking: 5000 } as BookingRequest
const slot = { staffId: 'a', date: '2026-10-15', start: '14:00', remaining: 1, state: 'available' }

test('取消履歴を有効予約と売上から外し、同じ時刻のメニュー違いは1枠と数える', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T01:00:00Z'))
  const result = dayBookingSummary([row, { ...row, id: 'cancelled', status: 'cancelled' }, { ...row, id: 'pending', source: 'phone', status: 'requested' }], '2026-10-15', { status: 'ready', slots: [slot, slot, { ...slot, start: '15:00', remaining: 0 }] })
  expect(result).toMatchObject({ active: 2, line: 1, phone: 1, requested: 1, cancelled: 1, sales: 10000, available: 1 })
  expect(result.next?.id).toBe('r1')
  expect(dayBookingSummary([row], '2026-10-15', { status: 'error', slots: [] }).available).toBeNull()
  expect(dayBookingSummary([row], '2026-10-15', { status: 'unconfigured', slots: [] }).available).toBeNull()
})

test('次の予約は実データから詳細を開き、狭い板の入口からも同じ内容を読める', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T01:00:00Z'))
  const open = vi.fn()
  render(<PeopleDayFrame view="day" date="2026-10-15" rows={[row]} ready availability={{ status: 'ready', slots: [slot] }} actions={<button>電話の予約を入れる</button>} canWrite onOpen={open}>盤</PeopleDayFrame>)
  fireEvent.click(screen.getByRole('button', { name: '詳細を見る' }))
  expect(open).toHaveBeenCalledWith('r1')
  expect(screen.getByRole('link', { name: '日時を変える' }).getAttribute('href')).toBe('/booking/bookings/detail?id=r1')
  fireEvent.click(screen.getByRole('button', { name: '次の予約・内訳', exact: true }))
  expect(screen.getByRole('dialog', { name: '次の予約・内訳' }).textContent).toContain('花子')
})

test('未取得の一覧に前の数と次の予約を出さず、閲覧者の変更入口を隠す', () => {
  render(<PeopleDayFrame view="day" date="2026-10-15" rows={[row]} ready={false} availability={{ status: 'error', slots: [] }} actions={null} canWrite={false} onOpen={() => {}}>盤</PeopleDayFrame>)
  expect(screen.queryByRole('button', { name: '詳細を見る' })).toBeNull()
  expect(screen.queryByRole('link', { name: '日時を変える' })).toBeNull()
  expect(screen.getByText(/閲覧のみで見ています/)).toBeTruthy()
  expect(screen.getByText('読み込めませんでした')).toBeTruthy()
})
