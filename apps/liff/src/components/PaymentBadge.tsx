import { PAYMENT_METHOD_ONSITE, paymentBadge, withAmount, type PaymentTone } from '@line-crm/shared';

/**
 * お支払いの札（B-338）。言葉と色の意味は @line-crm/shared の payment-status が 1 か所で持つ
 * （管理画面と同じ「未払い・支払い済み・返金済み・期限切れ」。お店で払うは払い方の札）。
 */
const TONE_CLASS: Record<PaymentTone, string> = {
  success: 'bg-liff-ok-bg text-liff-ok-ink',
  warning: 'bg-liff-wait-bg text-liff-wait-ink',
  neutral: 'bg-liff-chip text-liff-sub',
  danger: 'bg-liff-required-bg text-(--color-danger)',
  info: 'bg-(--color-info-bg) text-(--color-info-link)',
};

const base = 'inline-block h-fit w-fit shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap';

export default function PaymentBadge({ status, amount }: { status: string; amount?: number | null }) {
  const badge = paymentBadge(status);
  if (!badge) return null;
  return <span className={`${base} ${TONE_CLASS[badge.tone]}`} data-payment-status={status}>{withAmount(badge.label, amount)}</span>;
}

export function PaymentOnsiteBadge({ amount }: { amount?: number | null }) {
  return <span className={`${base} ${TONE_CLASS[PAYMENT_METHOD_ONSITE.tone]}`} data-payment-method="onsite">{withAmount(PAYMENT_METHOD_ONSITE.label, amount)}</span>;
}
