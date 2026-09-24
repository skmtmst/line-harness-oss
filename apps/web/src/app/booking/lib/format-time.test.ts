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

describe('分の期限の読み替え（#710）', () => {
  it('時間・日の単位へ自動で読み替える', async () => {
    const { minutesBeforeLabel } = await import('./format-time')
    expect(minutesBeforeLabel(1440)).toBe('24時間前')
    expect(minutesBeforeLabel(90)).toBe('1時間30分前')
    expect(minutesBeforeLabel(2880)).toBe('2日前')
    expect(minutesBeforeLabel(60)).toBe('1時間前')
  })

  it('60分未満は分のままが読みやすいので読み替えない', async () => {
    const { minutesBeforeLabel } = await import('./format-time')
    expect(minutesBeforeLabel(30)).toBeNull()
    expect(minutesBeforeLabel(0)).toBeNull()
  })
})
