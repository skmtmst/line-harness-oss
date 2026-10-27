'use client'

import type { ReactNode } from 'react'
import Button from './button'

/** 権限不足時もTabで止まれる共通ボタン。理由の吹き出しと押下防止はButtonへ委ねる。 */
export default function PermissionLockedButton({ reason, variant = 'primary', icon, children }: {
  reason: string
  variant?: 'primary' | 'secondary'
  icon?: ReactNode
  children: ReactNode
}) {
  return <Button type="button" variant={variant} icon={icon} disabled disabledReason={reason} disabledReasonPlacement="tooltip">{children}</Button>
}
