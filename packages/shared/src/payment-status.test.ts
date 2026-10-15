import { describe, expect, it } from 'vitest';
import { PAYMENT_STATUS, paymentStatusKey, paymentStatusText } from './payment-status.js';

describe('支払いの札の共通の定義（B-338）', () => {
  it('言葉は 4 つだけ', () => {
    expect(Object.values(PAYMENT_STATUS).map((item) => item.label)).toEqual(['未払い', '支払い済み', '返金済み', '期限切れ']);
  });
  it('口の状態の言葉を 4 つへ寄せ、お店で払うは状態の札にしない', () => {
    expect(['pending', 'unpaid', 'failed'].map(paymentStatusKey)).toEqual(['unpaid', 'unpaid', 'unpaid']);
    expect(paymentStatusKey('paid')).toBe('paid');
    expect(paymentStatusKey('onsite')).toBeNull();
  });
  it('金額つきの文', () => {
    expect(paymentStatusText('paid', 8800)).toBe('支払い済み ¥8,800');
    expect(paymentStatusText('expired')).toBe('期限切れ');
  });
});
