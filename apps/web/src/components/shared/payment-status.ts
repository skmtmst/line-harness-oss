import { PAYMENT_METHOD_ONSITE as METHOD_ONSITE, PAYMENT_STATUS as STATUS, paymentBadge as badge, type PaymentState } from '@line-crm/shared'
import type { StatusBadgeTone } from './status-badge'

/*
 * 支払いの札の言葉と色（・2026-10-16 オーナー「おすすめで」）。管理画面・LIFF・確かめの窓で同じ 1 か所を使う。
 * 正本は @line-crm/shared の payment-status（LIFF も同じ物を読む）。ここは管理画面の StatusBadge の色の型で読み直すだけ。
 * 支払いの状態は 4 つ（未払い・支払い済み・返金済み・期限切れ）だけ。お店で払うのは状態ではなく払い方なので別の札。
 */
export type { PaymentState }
export { withAmount } from '@line-crm/shared'

export const PAYMENT_STATUS = STATUS as Record<PaymentState, { label: string; tone: StatusBadgeTone }>

/** 払い方の札（状態ではない）。 */
export const PAYMENT_METHOD_ONSITE = METHOD_ONSITE as { label: string; tone: StatusBadgeTone }

/** 口の支払いの値 → 札。知らない値は札を出さない（未払いと決めつけない）。 */
export function paymentBadge(status: string | null | undefined): { label: string; tone: StatusBadgeTone } | null {
  return badge(status) as { label: string; tone: StatusBadgeTone } | null
}
