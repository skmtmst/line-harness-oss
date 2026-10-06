import { describe, expect, it } from 'vitest'
import { changeText, historyStamp, scheduleStamp } from './edit'

describe('共通情報の編集（AYc6O）の言葉', () => {
  it('予定の日時は「10/1 0:00」の形', () => {
    expect(scheduleStamp('2026-10-01T00:00')).toBe('10/1 0:00')
    expect(scheduleStamp('2026-12-24T18:30')).toBe('12/24 18:30')
    expect(scheduleStamp('2026-12-24')).toBe('12/24')
  })

  it('履歴の日時は日本時間の「9/01 10:00」の形', () => {
    expect(historyStamp('2026-09-01T10:00:00.000+09:00')).toBe('9/01 10:00')
    expect(historyStamp('2026-04-01T00:00:00.000Z')).toBe('4/01 09:00')
  })

  it('履歴の「前 → 後」は先頭の同じ言葉を後ろで繰り返さない', () => {
    expect(changeText('平日 10:00〜20:00', '平日 10:00〜19:00')).toBe('平日 10:00〜20:00 → 10:00〜19:00')
    expect(changeText('NEN', '株式会社NEN')).toBe('NEN → 株式会社NEN')
    expect(changeText('', 'a')).toBe('（空） → a')
  })
})
