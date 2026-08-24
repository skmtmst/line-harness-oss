'use client'

import React from 'react'
import Dialog from './dialog'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}

/** ブラウザ標準 confirm の代わりに使う、管理画面共通の確認ダイアログ。 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '実行する',
  cancelLabel = 'キャンセル',
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      tone={destructive ? 'destructive' : 'default'}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
