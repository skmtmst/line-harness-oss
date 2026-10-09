import { describe, expect, test } from 'vitest'
import { datetimeLocalJstToUtcIso, jstDate } from './jst-datetime'

describe('datetimeLocalJstToUtcIso（JST固定）', () => {
  test('datetime-localをJSTとしてUTCへ直す', () => {
    // 画面の「2026-09-10T10:00」はJSTの10時。UTCでは01:00。
    expect(datetimeLocalJstToUtcIso('2026-09-10T10:00')).toBe('2026-09-10T01:00:00.000Z')
  })

  test('秒付きもJSTとして扱う', () => {
    expect(datetimeLocalJstToUtcIso('2026-09-10T10:00:30')).toBe('2026-09-10T01:00:30.000Z')
  })

  test('タイムゾーン付きはそのままUTCへ直す', () => {
    expect(datetimeLocalJstToUtcIso('2026-09-10T10:00:00+09:00')).toBe('2026-09-10T01:00:00.000Z')
  })
})

// 決まり15：端末が日本時間以外でも、予約を日本時間として保存する。
test('統括の予約時刻を日本時間で保存し、存在しない日付を受け付けない', async () => {
  const { scheduledIso } = await import('@/v8/hq-broadcasts/model')
  expect(scheduledIso('2027-01-15', '11:00')).toBe('2027-01-15T02:00:00.000Z')
  expect(scheduledIso('2027-02-30', '11:00')).toBeNull()
})

test("今日の境目は日本の午前0時", () => {
  expect(jstDate(new Date("2026-10-09T14:59:59Z"))).toBe("2026-10-09")
  expect(jstDate(new Date("2026-10-09T15:00:00Z"))).toBe("2026-10-10")
})
