import { describe, expect, it } from 'vitest';
import { paymentText, paymentView } from './booking-payment-view.js';
import { isNotReadyYet } from './not-ready.js';
import { entitlementDetail, entitlementSummary } from '../pages/my-page.js';
import type { BookingEntitlement, MenuItem } from './api.js';

const menu = (over: Partial<MenuItem> = {}): MenuItem => ({
  id: 'm', name: 'm', category_label: null, description: null, duration_minutes: 60,
  buffer_after_minutes: 0, base_price: 3300, sort_order: 1, ...over,
});

describe('予約の支払いの札（nWby5）', () => {
  it('5 つの状態を人の言葉にする', () => {
    expect(paymentText(paymentView({ id: 'p', status: 'paid', amount: 8800 }, undefined)!)).toBe('支払い済み ¥8,800');
    expect(paymentText(paymentView({ id: 'p', status: 'unpaid', amount: 1200 }, undefined)!)).toBe('未払い ¥1,200');
    expect(paymentText(paymentView({ id: 'p', status: 'refunded', amount: 4400 }, undefined)!)).toBe('返金済み ¥4,400');
    // 期限切れは払っていないので金額を出さない。
    expect(paymentText(paymentView({ id: 'p', status: 'expired', amount: 4400 }, undefined)!)).toBe('期限切れ');
    expect(paymentText(paymentView(null, menu({ payment_mode: 'onsite' }))!)).toBe('当日払う ¥3,300');
  });

  it('支払いの無い店では札を出さない', () => {
    expect(paymentView(null, menu())).toBeNull();
    expect(paymentView(null, undefined)).toBeNull();
  });

  it('領収書の URL は返ったときだけ持つ（無ければ準備中の案内）', () => {
    expect(paymentView({ id: 'p', status: 'paid', receipt_url: 'https://pay.stripe.com/r' }, undefined)!.receiptUrl).toBe('https://pay.stripe.com/r');
    expect(paymentView({ id: 'p', status: 'paid' }, undefined)!.receiptUrl).toBeNull();
  });
});

describe('口が無い機能は準備中', () => {
  it('404・501・503 だけを準備中にする', () => {
    expect(isNotReadyYet({ status: 404 })).toBe(true);
    expect(isNotReadyYet({ status: 503 })).toBe(true);
    expect(isNotReadyYet({ status: 500 })).toBe(false);
    expect(isNotReadyYet(new Error('x'))).toBe(false);
  });
});

describe('マイページの回数券（L5g75）', () => {
  const base: BookingEntitlement = {
    id: 'e', name: '10回券', kind: 'ticket', menuId: null, remaining: 9, monthlyLimit: null, monthAllowance: null,
    monthUsed: null, monthRemaining: null, validFrom: null, expiresAt: '2027-03-31T15:00:00Z', periodStart: null, periodEnd: null, usable: true,
  };
  it('残り・期限・月謝の今月の利用を出す', () => {
    expect(entitlementSummary([base])).toBe('残り 9 回');
    expect(entitlementDetail(base)).toBe('残り 9 回・2027/4/1 まで');
    const monthly = { ...base, kind: 'monthly' as const, remaining: null, monthAllowance: 4, monthUsed: 1, monthRemaining: 3, expiresAt: null };
    expect(entitlementSummary([monthly])).toBe('今月 あと 3 回');
    expect(entitlementDetail(monthly)).toBe('今月 1／4 回 利用');
    expect(entitlementSummary([])).toBeNull();
    expect(entitlementSummary([{ ...base, remaining: null }])).toBe('残り — 回');
    expect(entitlementDetail({ ...base, kind: 'monthly', monthUsed: null, monthAllowance: null, monthlyLimit: null })).toContain('今月 —／— 回 利用');
  });
});
