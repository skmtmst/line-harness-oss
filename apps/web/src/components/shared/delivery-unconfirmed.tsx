'use client'

import type { ReactNode } from 'react'
import Notice from './notice'
import StatusBadge from './status-badge'

export const DELIVERY_UNCONFIRMED_REASON = '届いたか確認できないため、二重送信を防ぐために止めています。'
export const DELIVERY_UNCONFIRMED_ACTION = 'この記録の日時・相手と、トークの送信記録を照合してください。記録だけで判断できない場合は、相手に到着を確認してから対応を決めてください。自動では送り直しません。'

export function DeliveryUnconfirmedBadge() {
  return <StatusBadge tone="warning" size="compact">要確認</StatusBadge>
}

/** : 不明な送信に再送の操作を付けず、理由と確認方法をそろえる。 */
export function DeliveryUnconfirmedNotice({ action }: { action?: ReactNode }) {
  return <Notice tone="warn" heading="要確認：届いたか分からない配信があります" action={action}>
    {DELIVERY_UNCONFIRMED_REASON} {DELIVERY_UNCONFIRMED_ACTION}
  </Notice>
}
