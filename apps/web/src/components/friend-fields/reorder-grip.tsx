'use client'

import type { ReactNode } from 'react'
import ReorderHandle from '@/components/shared/reorder-handle'

/**
 * 並び替えのつまみ（N-049）。既存の呼び出しを保つための別名。
 *
 * 中身は共通の並び替え部品（components/shared/reorder-handle）。
 * V8 の画面はこれを使わず、ReorderHandle と useReorder を直接使う
 * （動かせない時はつまみを出さず、理由を title と読み上げで言う）。
 * 動かせない時は現役の共通部品と同じく隠す。
 */
export default function ReorderGrip({
  label,
  disabled = false,
  disabledReason,
  onMove,
  children,
}: {
  /** 「◯◯を並び替え」の aria-label につける項目名 */
  label: string
  /** 動かせない項目（共通項目など）は押せない形で出す */
  disabled?: boolean
  disabledReason?: string
  /** direction=-1 が1つ上、+1 が1つ下。押すたびに呼ばれる */
  onMove: (direction: -1 | 1) => void | Promise<void>
  /** 既定は lucide の grip-vertical。設計の別絵がある画面だけ差し替える */
  children?: ReactNode
}) {
  return (
    <ReorderHandle
      label={label}
      look="inline"
      disabledLook="hide"
      locked={disabled}
      disabledReason={disabled ? disabledReason : null}
      onMove={onMove}
    >
      {children}
    </ReorderHandle>
  )
}
