import { describe, expect, it } from 'vitest'
import { billingBanner, billingChip, trialDaysLabel, yen, type BillingSummary } from './hq-billing'

const base: BillingSummary = {
  state: 'trialing', planKey: null, planName: null, planStatus: 'trialing', trialEndsAt: '2026-10-12T00:00:00.000', trialEndsLabel: '10/12',
  trialDaysLeft: 25, trialMonthlyImages: 20, currentPeriodEndsAt: null, currentPeriodEndsLabel: null, canSend: true, canGenerate: true,
  blockedReason: null, dataRetentionDays: 90, stripeReady: true, portalAvailable: false, plans: [],
}

describe('課金の札と帯', () => {
  it('左下の札は状態ごとに1語、課金対象外は出さない', () => {
    expect(billingChip(base)).toEqual({ label: '無料トライアル', tone: 'warn' })
    expect(billingChip({ ...base, state: 'active', planName: 'スタンダード' })).toEqual({ label: 'スタンダード', tone: 'ok' })
    expect(billingChip({ ...base, state: 'trial_expired' })?.tone).toBe('danger')
    expect(billingChip({ ...base, state: 'exempt' })).toBeNull()
    expect(trialDaysLabel(base)).toBe('残り25日')
    expect(trialDaysLabel({ ...base, state: 'active' })).toBeNull()
  })

  it('契約状況の帯は期限と残り日数、止まった理由と保持日数を言う', () => {
    expect(billingBanner(base).title).toBe('無料トライアル中（10/12 まで・残り25日）')
    expect(billingBanner(base).tone).toBe('warn')
    const expired = billingBanner({ ...base, state: 'trial_expired' })
    expect(expired.tone).toBe('danger')
    expect(expired.body).toContain('90日間')
    expect(billingBanner({ ...base, state: 'active', planName: 'ライト', currentPeriodEndsLabel: '11/1' }).title).toBe('ライトを契約中（次回の更新 11/1）')
    expect(billingBanner({ ...base, state: 'exempt' }).title).toBe('課金の対象外です')
  })

  it('金額は円の桁区切り', () => {
    expect(yen(29800)).toBe('¥29,800')
  })
})
