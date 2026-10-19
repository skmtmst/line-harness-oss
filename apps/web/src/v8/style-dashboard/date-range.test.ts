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
