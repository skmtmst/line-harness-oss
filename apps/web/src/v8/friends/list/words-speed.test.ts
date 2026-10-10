import { afterEach, describe, expect, it, vi } from 'vitest'
import { monthDay, monthDayTime } from './words'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('友だち一覧の日付を大量に表示する', () => {
  it('時差つき・うるう日・深夜の日付も従来の日本時間の表示と一致する', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
    const formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
    })
    for (const iso of ['2024-02-29T23:30:00Z', '2026-10-09T00:05:00+09:00', '2026-10-09T23:55:00-07:00', '2026-01-01T00:00:00Z']) {
      const parts = formatter.formatToParts(new Date(iso))
      const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
      const year = get('year')
      expect(monthDay(iso)).toBe(`${year === 2026 ? '' : `${year}年`}${get('month')}月${get('day')}日（${parts.find(part => part.type === 'weekday')?.value}）`)
    }
  })

  it('2,000行でも時刻帯の変換器を行ごとに作り直さない', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
    const construct = vi.spyOn(Intl, 'DateTimeFormat')
    for (let row = 0; row < 2000; row += 1) {
      expect(monthDay('2026-01-01T23:30:00Z')).toBe('1月2日（金）')
      expect(monthDayTime('2026-01-01T23:30:00Z')).toBe('01/01 23:30')
    }
    expect(construct.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('日本時間の年越しで年の省略を切り替え、受信の時刻は記録のまま残す', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-12-31T15:00:00Z'))
    expect(monthDay('2026-12-31T15:00:00Z')).toBe('1月1日（金）')
    expect(monthDay('2026-12-31T14:59:00Z')).toBe('2026年12月31日（木）')
    expect(monthDayTime('2026-12-31T15:00:00Z')).toBe('2026/12/31')
    expect(monthDay('壊れた値')).toBe('—')
    expect(monthDayTime('壊れた値')).toBe('—')
  })
})
