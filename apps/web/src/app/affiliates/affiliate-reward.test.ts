import { describe, expect, it } from 'vitest'
import { calculateAffiliateReward } from './affiliate-reward'

describe('calculateAffiliateReward', () => {
  it('案件ごとの定額報酬は、割合が0%でも確定額を表示する', () => {
    expect(calculateAffiliateReward({
      commissionRate: 0,
      totalRevenue: 0,
      confirmedFixedReward: 162_000,
    })).toBe(162_000)
  })

  it('割合方式は売上と割合から報酬を計算する', () => {
    expect(calculateAffiliateReward({
      commissionRate: 10,
      totalRevenue: 860_000,
      confirmedFixedReward: 30_000,
    })).toBe(86_000)
  })

  it('成果がない定額方式は実値0を返す', () => {
    expect(calculateAffiliateReward({
      commissionRate: 0,
      totalRevenue: 0,
      confirmedFixedReward: 0,
    })).toBe(0)
  })
})
