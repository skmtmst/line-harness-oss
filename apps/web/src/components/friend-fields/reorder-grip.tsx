'use client'

import type { KeyboardEvent, ReactNode } from 'react'
import { GripVertical } from 'lucide-react'

/**
 * 並び替えのつまみ（N-049）。
 *
 * ドラッグだけの操作はキーボードでは動かせないため、つまみを
 * フォーカス可能なボタンにして ↑/↓ で1つずつ移動できるようにする。
 * ドラッグ用の draggable/onDrop は外側のセル側に残し、マウス操作の
 * 見た目と動きは変えない。
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
  if (disabled) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center justify-center text-ink-faint"
        title={disabledReason}
        aria-label={disabledReason}
      >
        {children ?? <GripVertical size={16} aria-hidden="true" />}
      </span>
    )
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      void onMove(-1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      void onMove(1)
    }
  }
  return (
    <button
      type="button"
      onKeyDown={handleKeyDown}
      aria-label={`${label}を並び替え。上下キーで移動`}
      title="ドラッグまたは上下キーで並び替え"
      className="inline-flex cursor-grab items-center justify-center rounded-control p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
    >
      {children ?? <GripVertical size={16} aria-hidden="true" />}
    </button>
  )
}
