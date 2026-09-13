import { describe, expect, test } from 'vitest'
import { datetimeLocalJstToUtcIso } from './jst-datetime'

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
