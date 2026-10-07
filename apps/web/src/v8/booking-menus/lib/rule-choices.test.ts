import { describe, expect, it } from 'vitest'
import { BEFORE_MINUTE_CHOICES, beforeLabel, withCurrent } from './rule-choices'

describe('予約のルールの選ぶ欄', () => {
  it('締め切りは「直前まで」「分前まで」「時間前まで」で書く', () => {
    expect(beforeLabel(0)).toBe('直前まで')
    expect(beforeLabel(30)).toBe('30 分前まで')
    expect(beforeLabel(90)).toBe('90 分前まで')
    expect(beforeLabel(180)).toBe('3 時間前まで')
  })

  it('保存済みの値が候補に無くても消さずに並びの中へ足す', () => {
    expect(withCurrent(BEFORE_MINUTE_CHOICES, 45)).toEqual([0, 30, 45, 60, 120, 180, 360, 720, 1440, 2880, 4320])
    expect(withCurrent(BEFORE_MINUTE_CHOICES, 180)).toBe(BEFORE_MINUTE_CHOICES)
  })
})
