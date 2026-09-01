import { describe, expect, it } from 'vitest'
import { isRuleComplete, pruneCondition } from './segment-condition'

describe('行動スコアの共通絞り込み', () => {
  it('片側だけの整数境界を受け入れる', () => {
    expect(isRuleComplete({ type: 'score_range', value: { min: 70, max: null } })).toBe(true)
    expect(isRuleComplete({ type: 'score_range', value: { min: null, max: 29 } })).toBe(true)
  })

  it('空・小数・上下逆転を保存対象から外す', () => {
    expect(isRuleComplete({ type: 'score_range', value: { min: null, max: null } })).toBe(false)
    expect(isRuleComplete({ type: 'score_range', value: { min: 1.5, max: 29 } })).toBe(false)
    expect(isRuleComplete({ type: 'score_range', value: { min: 70, max: 30 } })).toBe(false)
    expect(pruneCondition({
      operator: 'AND',
      rules: [{ type: 'score_range', value: { min: 70, max: 30 } }],
    })).toBeNull()
  })
})
