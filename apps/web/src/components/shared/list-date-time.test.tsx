// @vitest-environment happy-dom
import { render, cleanup, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { formatListTimestamp } from '@/lib/format'
import ListDateTime from './list-date-time'

afterEach(cleanup)
const now = '2026-10-12T00:00:00Z'
it.each([
  ['2026-10-11T15:00:00Z', '10/12 00:00'],
  ['2025-10-01T09:00:00Z', '2025/10/01 18:00'],
  ['2027-10-01T09:00:00Z', '2027/10/01 18:00'],
  ['2026-10-01 09:00:00', '10/01 18:00'],
])('時刻を持つ記録は年によらず日付と時刻を残す', (value, text) => {
  expect(formatListTimestamp(value, { now })).toBe(text)
  const { container } = render(<ListDateTime value={value} now={now} />)
  expect(container.textContent).toBe(text)
  expect(container.querySelector('[data-list-date-time]')?.children.length).toBe(2)
})
it('店舗時間帯を保ち、無効値で画面を落とさない', () => {
  expect(formatListTimestamp('2026-10-11T15:00:00Z', { now, timeZone: 'America/New_York' })).toBe('10/11 11:00')
  expect(formatListTimestamp('bad', { now })).toBe('—')
  render(<ListDateTime value={null} fallback="未設定" />)
  expect(screen.getByText('未設定')).toBeTruthy()
})
