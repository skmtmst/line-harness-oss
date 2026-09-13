import { describe, expect, it } from 'vitest'
import {
  bookingWindowEnd,
  breakHours,
  businessHourSummary,
  openHours,
  shortDate,
} from './format-time'

describe('予約設定の日時整形', () => {
  it('営業時間と休けい時間を同じ時刻表記へ整える', () => {
    const intervals = [
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '18:00' },
    ]
    expect(openHours(intervals)).toBe('9:00 〜 18:00')
    expect(breakHours(intervals)).toBe('12:00 〜 13:00')
    expect(openHours([])).toBe('—')
    expect(breakHours([{ start: '09:00', end: '18:00' }])).toBe('なし')
  })

  it('一覧の営業時間要約と日付を整える', () => {
    expect(businessHourSummary([
      { weekday: 1, intervals: [{ start: '09:00', end: '18:00' }] },
      { weekday: 2, intervals: [{ start: '09:00', end: '18:00' }] },
      { weekday: 3, intervals: [] },
    ])).toEqual({ value: '9:00〜18:00', detail: '月・火' })
    expect(shortDate('2026-09-08')).toBe('9/8')
    expect(bookingWindowEnd(3, new Date('2026-09-08T03:00:00.000Z'))).toBe('9/10')
  })
})
