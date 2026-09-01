'use client'

import React, { type ReactNode } from 'react'
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
  /**
   * 押す前に読み合わせる中身。
   *
   * **確認は「はい／いいえ」だけでは足りないことがある。** 一斉配信の
   * 最終確認は、対象人数・配信日時・送る中身を並べてから決める
   * （設計 `FpgxH`）。`Dialog` はもともと受け取れるので、素通しにする。
   */
  children?: ReactNode
  /** この確認画面に対応するPencilの実Node。 */
  designNode?: string
  /**
   * `undefined` を渡すと**確認のボタンそのものが出ない**（`Dialog` の作り）。
   * 数えられていない人数のまま送らせない、といった止め方に使う。
   */
  onConfirm?: () => void
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
  children,
  designNode,
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
      designNode={designNode}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {children}
    </Dialog>
  )
}
