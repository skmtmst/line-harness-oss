/**
 * 支払いの札の共通の定義（B-338・2026-10-16 オーナー「言葉を 4 つにそろえ、管理画面と LIFF を同じに」）。
 *
 * 状態の札は「未払い・支払い済み・返金済み・期限切れ」の 4 つだけ。画面ごとに言い換えない
 * （前は 支払い待ち／未払い／お支払い済み／未払いで流れた枠 がばらばらだった）。
 * 「お店で払う」は状態ではなく払い方の札として別に出す。
 * 色の名前（tone）は管理画面の StatusBadge と LIFF の札で同じ意味に読む。
 */
export type PaymentStatusKey = 'unpaid' | 'paid' | 'refunded' | 'expired';
export type PaymentStatusTone = 'warning' | 'success' | 'neutral' | 'danger';

export const PAYMENT_STATUS: Record<PaymentStatusKey, { label: string; tone: PaymentStatusTone }> = {
  unpaid: { label: '未払い', tone: 'warning' },
  paid: { label: '支払い済み', tone: 'success' },
  refunded: { label: '返金済み', tone: 'neutral' },
  expired: { label: '期限切れ', tone: 'danger' },
};

/** 払い方の札（状態とは別）。 */
export const PAYMENT_METHOD_ONSITE = { label: 'お店で払う', tone: 'info' as const };

/** 試験モードの印。お金の数が出る所すべてに付ける。 */
export const PAYMENT_TEST_MODE_LABEL = '試験モード';

/**
 * 口の状態の言葉（Worker の booking_payments.status・管理の記録の status）を 4 つの札へ寄せる。
 * 支払い待ち（pending）・失敗（failed）はまだ払える＝未払い。お店で払う（onsite）は状態の札を出さない＝null。
 */
export function paymentStatusKey(raw: string | null | undefined): PaymentStatusKey | null {
  switch (raw) {
    case 'paid': return 'paid';
    case 'refunded': return 'refunded';
    case 'expired': return 'expired';
    case 'unpaid':
    case 'pending':
    case 'failed': return 'unpaid';
    default: return null;
  }
}

/** 札の文（金額つき：「支払い済み ¥8,800」）。 */
export function paymentStatusText(key: PaymentStatusKey, amount?: number | null): string {
  const label = PAYMENT_STATUS[key].label;
  return typeof amount === 'number' && Number.isFinite(amount) ? `${label} ¥${Math.round(amount).toLocaleString('ja-JP')}` : label;
}
