import { describe, expect, it } from 'vitest';
import { formatJstMonthDay, planKeyForPrice, priceIdForPlan, resolveEntitlements } from './billing-plans.js';

const now = new Date('2026-09-13T00:00:00Z');

describe('プランと権利の判定', () => {
  it('課金対象外は何も止めず、上限は運営の既定（上書き可）', () => {
    const e = resolveEntitlements({ plan_key: null, plan_status: 'exempt', trial_ends_at: null }, { now });
    expect(e).toMatchObject({ state: 'exempt', canSend: true, canGenerate: true, monthlyImages: 150 });
    expect(resolveEntitlements(null, { now, exemptMonthlyImages: 300 }).monthlyImages).toBe(300);
  });

  it('トライアル中は全部使え、残り日数と月 20枚が出る', () => {
    const e = resolveEntitlements({ plan_key: null, plan_status: 'trialing', trial_ends_at: '2026-09-23T09:00:00.000' }, { now });
    expect(e.state).toBe('trialing');
    expect(e.canSend).toBe(true);
    expect(e.monthlyImages).toBe(20);
    expect(e.trialDaysLeft).toBe(10);
  });

  it('トライアルが過ぎたら配信と生成を止め、理由に「課金プラン」の案内が入る', () => {
    const e = resolveEntitlements({ plan_key: null, plan_status: 'trialing', trial_ends_at: '2026-09-01T09:00:00.000' }, { now });
    expect(e.state).toBe('trial_expired');
    expect(e.canSend).toBe(false);
    expect(e.canGenerate).toBe(false);
    expect(e.blockedReason).toContain('課金プラン');
  });

  it('契約中はプランの枚数。支払い遅れは止めない。解約は止める', () => {
    expect(resolveEntitlements({ plan_key: 'standard', plan_status: 'active', trial_ends_at: null }, { now })).toMatchObject({ state: 'active', monthlyImages: 150, canSend: true });
    expect(resolveEntitlements({ plan_key: 'light', plan_status: 'past_due', trial_ends_at: null }, { now })).toMatchObject({ state: 'past_due', monthlyImages: 50, canSend: true });
    expect(resolveEntitlements({ plan_key: 'pro', plan_status: 'canceled', trial_ends_at: null }, { now })).toMatchObject({ state: 'canceled', canSend: false, canGenerate: false });
  });

  it('価格 ID とプランの対応は env から引く（値は書かない）', () => {
    const env = { STRIPE_PRICE_LIGHT: 'price_l', STRIPE_PRICE_STANDARD: 'price_s', STRIPE_PRICE_PRO: 'price_p' };
    expect(planKeyForPrice(env, 'price_s')).toBe('standard');
    expect(planKeyForPrice(env, 'price_x')).toBeNull();
    expect(planKeyForPrice({}, 'price_l')).toBeNull();
    expect(priceIdForPlan(env, 'pro')).toBe('price_p');
    expect(priceIdForPlan({}, 'pro')).toBeNull();
  });

  it('期限の表示は日本時間の月/日', () => {
    expect(formatJstMonthDay('2026-10-12T00:00:00.000')).toBe('10/12');
    expect(formatJstMonthDay('2026-10-11T23:30:00Z')).toBe('10/12');
    expect(formatJstMonthDay(null)).toBeNull();
  });
});
