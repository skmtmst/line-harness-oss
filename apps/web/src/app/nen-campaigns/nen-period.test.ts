import { describe, expect, it } from 'vitest'
import { defaultScheduleLocal, jstLongDateTime, jstMonthRange, jstShortDate, jstShortDateTime } from './nen-period'

describe('NEN配信の今月・先月（日本時間）', () => {
  it('今月は日本時間の月初0:00から翌月初0:00まで', () => {
    // 2026-09-18 03:00 JST（UTC では 9/17 18:00）。UTC で月をまたぐ端でも 9月 になる。
    const range = jstMonthRange(new Date('2026-08-31T15:30:00.000Z'))
    expect(range).toEqual({ from: '2026-08-31T15:00:00.000Z', to: '2026-09-30T15:00:00.000Z', label: '9月', year: 2026, month: 9 })
  })

  it('先月は年をまたいでも正しい', () => {
    const range = jstMonthRange(new Date('2026-01-10T00:00:00.000Z'), -1)
    expect(range.from).toBe('2025-11-30T15:00:00.000Z')
    expect(range.to).toBe('2025-12-31T15:00:00.000Z')
    expect(range.label).toBe('12月')
  })

  it('短い日付表記は日本時間で出す', () => {
    expect(jstShortDate('2026-09-19T15:30:00.000Z')).toBe('9/20')
    expect(jstShortDateTime('2026-09-20T01:00:00.000Z')).toBe('9/20 10:00')
    expect(jstLongDateTime('2026-09-20T01:00:00.000Z')).toBe('2026/09/20（日）10:00')
    expect(jstShortDate(null)).toBe('—')
    expect(jstShortDateTime('not a date')).toBe('—')
  })

  it('予約の初期値は日本時間の翌日10:00', () => {
    expect(defaultScheduleLocal(new Date('2026-09-18T14:00:00.000Z'))).toBe('2026-09-19T10:00')
    // 23:30 JST の翌日は 2日後の日付ではない（日本時間で日付を数える）。
    expect(defaultScheduleLocal(new Date('2026-09-18T14:30:00.000Z'))).toBe('2026-09-19T10:00')
    expect(defaultScheduleLocal(new Date('2026-09-18T15:30:00.000Z'))).toBe('2026-09-20T10:00')
  })
})
