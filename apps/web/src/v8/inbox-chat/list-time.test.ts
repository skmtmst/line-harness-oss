import { describe, expect, it } from 'vitest'
import { formatInboxListTime } from './list-time'

// 2026-10-07 15:00 JST
const NOW = new Date('2026-10-07T06:00:00Z')

describe('受信箱の一覧の時刻（日本時間・曜日なし）', () => {
  it('今日は 分前・時間前', () => {
    expect(formatInboxListTime('2026-10-07T05:30:00Z', NOW)).toBe('30分前')
    expect(formatInboxListTime('2026-10-07T04:00:00Z', NOW)).toBe('2時間前')
  })
  it('日本時間の前の日は「昨日」（UTC では同じ日でも）', () => {
    // 2026-10-06 23:30 JST = 2026-10-06 14:30 UTC
    expect(formatInboxListTime('2026-10-06T14:30:00Z', NOW)).toBe('昨日')
    // 2026-10-07 00:30 JST = 2026-10-06 15:30 UTC は今日
    expect(formatInboxListTime('2026-10-06T15:30:00Z', NOW)).toBe('14時間前')
  })
  it('それより前は M月D日、年が違えば年を付ける', () => {
    expect(formatInboxListTime('2026-08-16T03:00:00Z', NOW)).toBe('8月16日')
    expect(formatInboxListTime('2025-12-31T03:00:00Z', NOW)).toBe('2025年12月31日')
    expect(formatInboxListTime(null, NOW)).toBe('—')
  })
})
