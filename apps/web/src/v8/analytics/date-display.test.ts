import { expect, test } from 'vitest'
import { formatAnalyticsDate, formatAnalyticsDateTime, periodCaption } from './parts'
test('暦日の期間にUTC由来の09:00を足さない', () => {
  const text = periodCaption('2026-09-22', '2026-10-21', '2026-10-21')
  expect(text).toContain('9月22日')
  expect(text).toContain('10月21日')
  expect(text).not.toMatch(/\d{2}:\d{2}/)
  expect(formatAnalyticsDate('2026-10-21T03:00:00Z')).not.toContain('12:00')
})
test('実際の更新timestampは日本時間の時刻を残す', () => {
  expect(formatAnalyticsDateTime('2026-10-21T03:00:00Z')).toContain('12:00')
  expect(formatAnalyticsDateTime(null)).toBe('—')
})
