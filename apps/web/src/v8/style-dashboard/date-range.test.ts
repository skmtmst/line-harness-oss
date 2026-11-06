import { afterEach, expect, test, vi } from 'vitest'
import { jstToday, shiftDate } from './date-range'

afterEach(() => vi.useRealTimers())

test.each(['2026-09-30T15:00:00Z', '2026-09-30T23:59:59Z'])('日本時間の月初の朝を今日として月移動する: %s', at => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(at))
  expect(jstToday()).toBe('2026-10-01')
  expect(shiftDate(jstToday(), 'month', 1)).toBe('2026-11-01')
  expect(shiftDate(jstToday(), 'month', -1)).toBe('2026-09-01')
  expect(shiftDate(jstToday(), 'week', -1)).toBe('2026-09-24')
  expect(shiftDate(jstToday(), 'today', -1)).toBe('2026-09-30')
})

test.each([
  ['2026-01-31', 1, '2026-02-01'],
  ['2026-03-31', -1, '2026-02-01'],
  ['2028-01-31', 1, '2028-02-01'],
  ['2026-12-31', 1, '2027-01-01'],
  ['2026-01-31', -1, '2025-12-01'],
] as const)('月末 %s から隣の月を飛ばさず移動する', (date, step, next) => {
  expect(shiftDate(date, 'month', step)).toBe(next)
})
