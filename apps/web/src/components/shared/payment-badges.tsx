'use client'

import { PAYMENT_METHOD_ONSITE, PAYMENT_STATUS, PAYMENT_TEST_MODE_LABEL, paymentStatusKey, paymentStatusText, type PaymentStatusKey } from '@line-crm/shared'
import StatusBadge from './status-badge'

/*
 * 支払いの札（B-338）。言葉と色は @line-crm/shared の payment-status が 1 か所で持つ（LIFF も同じ定義）。
 * 画面は PAYMENT_STATUS を直に書かず、ここの部品を使う。
 */

/** 状態の札（未払い・支払い済み・返金済み・期限切れ）。raw は口の状態の言葉（pending・failed も可）。 */
export function PaymentStatusBadge({ status, amount, size }: { status: PaymentStatusKey | string; amount?: number | null; size?: 'default' | 'compact' }) {
  const key = paymentStatusKey(status) ?? (status in PAYMENT_STATUS ? status as PaymentStatusKey : null)
  if (!key) return null
  return <StatusBadge tone={PAYMENT_STATUS[key].tone} size={size}>{paymentStatusText(key, amount)}</StatusBadge>
}

/** 払い方の札「お店で払う」（状態の札とは別）。 */
export function PaymentOnsiteBadge({ amount, size }: { amount?: number | null; size?: 'default' | 'compact' }) {
  const text = typeof amount === 'number' ? `${PAYMENT_METHOD_ONSITE.label} ¥${Math.round(amount).toLocaleString('ja-JP')}` : PAYMENT_METHOD_ONSITE.label
  return <StatusBadge tone={PAYMENT_METHOD_ONSITE.tone} size={size}>{text}</StatusBadge>
}

/** 試験モードの印。お金の数が出る所すべてに付ける（本当の請求・返金は起きない）。 */
export function TestModeBadge({ size = 'compact' }: { size?: 'default' | 'compact' }) {
  return <StatusBadge tone="warning" size={size} title="本当の請求・返金は起きません">{PAYMENT_TEST_MODE_LABEL}</StatusBadge>
}
