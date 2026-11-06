import { describe, expect, it } from 'vitest';
import { PAYMENT_STATUS, paymentBadge, withAmount } from './payment-status.js';

describe('支払いの札の共通の定義', () => {
  it('状態の言葉は 4 つだけ', () => {
    expect(Object.values(PAYMENT_STATUS).map((item) => item.label)).toEqual(['未払い', '支払い済み', '返金済み', '期限切れ']);
  });
  it('口の値を札へ寄せる。お店で払うは払い方の札、知らない値は出さない', () => {
    expect(['pending', 'unpaid', 'failed'].map((value) => paymentBadge(value)?.label)).toEqual(['未払い', '未払い', '未払い']);
    expect(paymentBadge('onsite')).toEqual({ label: 'お店で払う', tone: 'info' });
    expect(paymentBadge('mystery')).toBeNull();
  });
  it('金額つきの文', () => {
    expect(withAmount(PAYMENT_STATUS.paid.label, 8800)).toBe('支払い済み ¥8,800');
  });
});
