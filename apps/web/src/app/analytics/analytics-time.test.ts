import { describe, expect, it } from 'vitest'
import { formatAnalyticsDateTime } from './analytics-time'

describe('分析の日時表示', () => {
  it('UTCを日本時間へ変換する', () => {
    expect(formatAnalyticsDateTime('2026-08-25T11:00:00.000Z')).toBe('2026/08/25 20:00')
  })

  it('未取得と読めない値を日時らしく見せない', () => {
    expect(formatAnalyticsDateTime(null)).toBe('—')
    expect(formatAnalyticsDateTime('broken')).toBe('—')
  })
})
