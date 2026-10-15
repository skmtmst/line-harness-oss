import type { StatusBadgeTone } from './status-badge'

/*
 * 支払いの札の言葉と色（B-338・2026-10-16 オーナー「おすすめで」）。管理画面・LIFF・確かめの窓で同じ 1 か所を使う。
 * 支払いの状態は 4 つ（未払い・支払い済み・返金済み・期限切れ）だけ。お店で払うのは状態ではなく払い方なので別の札。
 * 口の値（API 組3：paid・pending・refunded・expired・onsite）からもここで読み替える。
 */
export type PaymentState = 'unpaid' | 'paid' | 'refunded' | 'expired'

export const PAYMENT_STATUS: Record<PaymentState, { label: string; tone: StatusBadgeTone }> = {
  unpaid: { label: '未払い', tone: 'warning' },
  paid: { label: '支払い済み', tone: 'success' },
  refunded: { label: '返金済み', tone: 'neutral' },
  expired: { label: '期限切れ', tone: 'danger' },
}

/** 払い方の札（状態ではない）。 */
export const PAYMENT_METHOD_ONSITE = { label: '店舗払い', tone: 'neutral' as StatusBadgeTone }

/** 口の支払いの値 → 札。知らない値は札を出さない（未払いと決めつけない）。 */
export function paymentBadge(status: string | null | undefined): { label: string; tone: StatusBadgeTone } | null {
  switch (status) {
    case 'paid': return PAYMENT_STATUS.paid
    case 'pending': case 'unpaid': return PAYMENT_STATUS.unpaid
    case 'refunded': return PAYMENT_STATUS.refunded
    case 'expired': return PAYMENT_STATUS.expired
    case 'onsite': return PAYMENT_METHOD_ONSITE
    default: return null
  }
}
