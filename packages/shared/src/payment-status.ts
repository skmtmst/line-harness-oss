/**
 * 支払いの札の言葉と色（2026-10-16 オーナー「言葉を 4 つにそろえ、管理画面と LIFF を同じに」）。
 * 管理画面（apps/web/src/components/shared/payment-status.ts が読み直して使う）と LIFF の両方がここを読む。
 * 状態は 4 つ（未払い・支払い済み・返金済み・期限切れ）だけ。お店で払うは状態ではなく払い方の札。
 * 口の値（paid・pending・unpaid・failed・refunded・expired・onsite）もここで読み替える。
 */
export type PaymentState = 'unpaid' | 'paid' | 'refunded' | 'expired';
export type PaymentTone = 'warning' | 'success' | 'neutral' | 'danger' | 'info';

export const PAYMENT_STATUS: Record<PaymentState, { label: string; tone: PaymentTone }> = {
  unpaid: { label: '未払い', tone: 'warning' },
  paid: { label: '支払い済み', tone: 'success' },
  refunded: { label: '返金済み', tone: 'neutral' },
  expired: { label: '期限切れ', tone: 'danger' },
};

/** 払い方の札（状態ではない）。絵（FY8HC・nWby5）の言葉は「お店で払う」・青。 */
export const PAYMENT_METHOD_ONSITE: { label: string; tone: PaymentTone } = { label: 'お店で払う', tone: 'info' };

/** 試験モードの印の言葉。お金の数が出る所すべてに付ける。 */
export const PAYMENT_TEST_MODE_LABEL = '試験モード';

/** 口の支払いの値 → 札。知らない値は札を出さない（未払いと決めつけない）。失敗（failed）はまだ払える＝未払い。 */
export function paymentBadge(status: string | null | undefined): { label: string; tone: PaymentTone } | null {
  switch (status) {
    case 'paid': return PAYMENT_STATUS.paid;
    case 'pending': case 'unpaid': case 'failed': return PAYMENT_STATUS.unpaid;
    case 'refunded': return PAYMENT_STATUS.refunded;
    case 'expired': return PAYMENT_STATUS.expired;
    case 'onsite': return PAYMENT_METHOD_ONSITE;
    default: return null;
  }
}

/** 札の文に金額を添える（「支払い済み ¥8,800」）。 */
export function withAmount(label: string, amount?: number | null): string {
  return typeof amount === 'number' && Number.isFinite(amount) ? `${label} ¥${Math.round(amount).toLocaleString('ja-JP')}` : label;
}
