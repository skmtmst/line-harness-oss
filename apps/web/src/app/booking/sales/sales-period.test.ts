import { describe, expect, it } from 'vitest'
import {
  formatCountDelta,
  formatPointDelta,
  formatRevenueDelta,
  salesPeriodRange,
} from './sales-period'

describe('売上の期間', () => {
  it('from < to の日付を返す', () => {
    for (const key of ['week', 'month', 'quarter'] as const) {
      const range = salesPeriodRange(key)
      expect(range.from < range.to).toBe(true)
      expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('今週は月曜始まり・7日以内', () => {
    const range = salesPeriodRange('week')
    const span = Date.parse(range.to) - Date.parse(range.from)
    expect(span).toBeGreaterThan(0)
    expect(span).toBeLessThanOrEqual(7 * 24 * 3600_000)
    expect(new Date(`${range.from}T00:00:00Z`).getUTCDay()).toBe(1)
  })
})

describe('差分の言葉', () => {
  it('売上は前が0なら出さない', () => {
    expect(formatRevenueDelta(100, 50)).toBe('+100%')
    expect(formatRevenueDelta(40, 50)).toBe('-20%')
    expect(formatRevenueDelta(0, 0)).toBeNull()
    expect(formatRevenueDelta(100, 0)).toBeNull()
  })

  it('件数と率は必ず出す', () => {
    expect(formatCountDelta(86, 79)).toBe('+7件')
    expect(formatCountDelta(79, 86)).toBe('-7件')
    expect(formatPointDelta(0.069, 0.081)).toBe('-1.2pt')
  })
})
