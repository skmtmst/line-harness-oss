import { describe, expect, it } from 'vitest'
import { isNightJst, schedulePresets, shortJst } from './schedule-presets'

describe('予約して送るの「すぐ選ぶ」（日本時間で数える）', () => {
  it('木曜 15:30（日本時間）からの候補', () => {
    // 2026-10-01 は木曜。15:30 JST = 06:30 UTC
    const presets = Object.fromEntries(schedulePresets(new Date('2026-10-01T06:30:00Z')).map((p) => [p.key, p.value]))
    expect(presets['tomorrow-9']).toBe('2026-10-02T09:00')
    expect(presets['tomorrow-13']).toBe('2026-10-02T13:00')
    expect(presets['monday-10']).toBe('2026-10-05T10:00')
    expect(presets.opening).toBe('2026-10-02T10:00')
    expect(presets['in-hour']).toBe('2026-10-01T16:30')
  })

  it('日本時間の朝（UTC では前の日）でも日本の暦で数える', () => {
    // 2026-10-05（月）07:00 JST = 2026-10-04 22:00 UTC
    const presets = Object.fromEntries(schedulePresets(new Date('2026-10-04T22:00:00Z')).map((p) => [p.key, p.value]))
    expect(presets['tomorrow-9']).toBe('2026-10-06T09:00')
    expect(presets.opening).toBe('2026-10-05T10:00')
    // 月曜当日なら次の月曜
    expect(presets['monday-10']).toBe('2026-10-12T10:00')
  })

  it('夜中（22時〜8時）を見分け、短い日時にする', () => {
    expect(isNightJst('2026-10-02T22:00')).toBe(true)
    expect(isNightJst('2026-10-02T07:59')).toBe(true)
    expect(isNightJst('2026-10-02T08:00')).toBe(false)
    expect(shortJst('2026-10-02T09:00')).toBe('10/2 9:00')
  })
})
