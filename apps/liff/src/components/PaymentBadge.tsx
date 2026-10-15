import { PAYMENT_METHOD_ONSITE, PAYMENT_STATUS, paymentStatusKey, paymentStatusText, type PaymentStatusTone } from '@line-crm/shared';

/**
 * お支払いの札（B-338）。言葉と色の意味は @line-crm/shared の payment-status が 1 か所で持つ
 * （管理画面と同じ「未払い・支払い済み・返金済み・期限切れ」。お店で払うは払い方の札）。
 */
const TONE_CLASS: Record<PaymentStatusTone | 'info', string> = {
  success: 'bg-liff-ok-bg text-liff-ok-ink',
  warning: 'bg-liff-wait-bg text-liff-wait-ink',
  neutral: 'bg-liff-chip text-liff-sub',
  danger: 'bg-liff-required-bg text-(--color-danger)',
  info: 'bg-(--color-info-bg) text-(--color-info-link)',
};

const base = 'inline-block h-fit w-fit shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap';

export default function PaymentBadge({ status, amount }: { status: string; amount?: number | null }) {
  const key = paymentStatusKey(status);
  if (!key) return null;
  return <span className={`${base} ${TONE_CLASS[PAYMENT_STATUS[key].tone]}`} data-payment-status={key}>{paymentStatusText(key, amount)}</span>;
}

export function PaymentOnsiteBadge({ amount }: { amount?: number | null }) {
  const text = typeof amount === 'number' ? `${PAYMENT_METHOD_ONSITE.label} ¥${Math.round(amount).toLocaleString('ja-JP')}` : PAYMENT_METHOD_ONSITE.label;
  return <span className={`${base} ${TONE_CLASS.info}`} data-payment-method="onsite">{text}</span>;
}
