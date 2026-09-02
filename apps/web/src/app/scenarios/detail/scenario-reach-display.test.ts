import { describe, expect, it } from 'vitest'

import {
  scenarioReachBarWidth,
  scenarioReachCountLabel,
  scenarioReachPercent,
  scenarioReachPercentLabel,
} from './scenario-reach-display'

describe('シナリオの到達人数と到達率', () => {
  it('実値0を未取得と区別する', () => {
    expect(scenarioReachCountLabel(0)).toBe('0人')
    expect(scenarioReachPercentLabel(scenarioReachPercent(0))).toBe('0%')
    expect(scenarioReachBarWidth(scenarioReachPercent(0))).toBe('0%')
  })

  it('取得できた割合を百分率で表示する', () => {
    expect(scenarioReachPercentLabel(scenarioReachPercent(0.687))).toBe('69%')
  })

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1])(
    '取れない割合 %s は作り物の率にしない',
    (value) => {
      expect(scenarioReachPercent(value)).toBeNull()
      expect(scenarioReachPercentLabel(scenarioReachPercent(value))).toBe('—')
      expect(scenarioReachBarWidth(scenarioReachPercent(value))).toBeNull()
    },
  )

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    '取れない人数 %s は0人にしない',
    (value) => {
      expect(scenarioReachCountLabel(value)).toBe('—')
    },
  )
})
