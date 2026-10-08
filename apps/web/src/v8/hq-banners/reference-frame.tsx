'use client'

import type { DialogProps } from '@/components/shared/dialog'
import BannerDialogFrame from './frame'

/** 参照画像の選択ロジックは共有し、板 UcBQ5 の窓の寸法だけを選ぶ。 */
export default function ReferenceFrame({ open, title, description, onCancel, footer, children, error, busy }: DialogProps) {
  return <BannerDialogFrame open={open} kind="reference" title={title} description={description}
    onClose={onCancel} busy={busy} error={error} actions={footer} actionsAlign="split" designNode="UcBQ5">
    {children}
  </BannerDialogFrame>
}
