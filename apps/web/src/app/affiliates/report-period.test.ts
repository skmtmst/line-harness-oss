import { describe, expect, it } from 'vitest'
import { reportMonthKey, reportPeriodLabel } from './report-period'

describe('成果レポートの日本時間の月境界', () => {
  it('UTCでは前月でも、日本時間で月が変わったら新しい月を示す', () => {
    const now = Date.parse('2026-09-30T15:00:00Z')
    expect(reportMonthKey(0, now)).toBe('2026-10')
    expect(reportPeriodLabel('this_month', now)).toBe('今月（10/1〜10/31）')
    expect(reportPeriodLabel('last_month', now)).toBe('先月（9/1〜9/30）')
  })
  it('年をまたぐ先月と閏年の末日を扱う', () => {
    expect(reportMonthKey(-1, Date.parse('2026-01-01T00:00:00+09:00'))).toBe('2025-12')
    expect(reportPeriodLabel('last_month', Date.parse('2024-03-01T00:00:00+09:00'))).toBe('先月（2/1〜2/29）')
  })
})
