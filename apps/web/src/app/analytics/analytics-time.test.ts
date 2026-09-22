import { describe, expect, it } from 'vitest'
import { analyticsWeekday, formatAnalyticsDate, formatAnalyticsDateTime } from './analytics-time'

describe('分析の日時表示', () => {
  it('UTCを日本時間へ変換する', () => {
    expect(formatAnalyticsDateTime('2026-08-25T11:00:00.000Z')).toBe('2026/08/25 20:00')
  })

  it('未取得と読めない値を日時らしく見せない', () => {
    expect(formatAnalyticsDateTime(null)).toBe('—')
    expect(formatAnalyticsDateTime('broken')).toBe('—')
  })
})

describe('分析の日付表示', () => {
  it('日付は日本時間の暦日で出す', () => {
    // UTCの8/25 11:00 は日本では8/25 20:00。日付だけなら同じ日。
    expect(formatAnalyticsDate('2026-08-25T11:00:00.000Z')).toBe('2026/8/25')
    // UTCの8/25 16:00 は日本では8/26 1:00。日本時間の暦日にそろえる。
    expect(formatAnalyticsDate('2026-08-25T16:00:00.000Z')).toBe('2026/8/26')
  })

  it('未取得と読めない値を日付らしく見せない', () => {
    expect(formatAnalyticsDate(null)).toBe('—')
    expect(formatAnalyticsDate('broken')).toBe('—')
  })
})

describe('分析の曜日', () => {
  it('日付列から曜日を出す', () => {
    expect(analyticsWeekday('2026-03-15')).toBe('日')
    expect(analyticsWeekday('2026-03-16')).toBe('月')
    expect(analyticsWeekday('2026-03-17')).toBe('火')
    expect(analyticsWeekday('2026-03-18')).toBe('水')
    expect(analyticsWeekday('2026-03-19')).toBe('木')
    expect(analyticsWeekday('2026-03-20')).toBe('金')
    expect(analyticsWeekday('2026-03-21')).toBe('土')
  })

  it('端末の地域ではなく暦日の曜日を返す', () => {
    // 月曜の日付は、日本より遅い地域(例: ハワイ)で開いても月曜。
    // getDay() なら前日(日曜)を返す環境がある。
    const monday = '2026-03-16'
    expect(analyticsWeekday(monday)).toBe(
      ['日', '月', '火', '水', '木', '金', '土'][new Date(`${monday}T00:00:00Z`).getUTCDay()],
    )
  })
})
