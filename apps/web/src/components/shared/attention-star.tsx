'use client'

import React from 'react'
import { Star } from 'lucide-react'

/*
 * 一覧の行の左に置く「注目の星」の共通部品（夕30）。
 * 友だち一覧・タグ一覧など、どの一覧でも同じ見た目・同じ動きにする。
 * v8 の色（消=枠だけの灰／付=黄色い地に濃い枠）と動き（v8-star-pop）は
 * globals.css の [data-part="attention-star"] 規定が担う。
 */
export default function AttentionStar({
  pressed,
  label,
  onToggle,
  className = '',
}: {
  pressed: boolean
  /* 押したとき何が起きるかまで含めた accessible 名（例「○○の注目を外す」）。 */
  label: string
  onToggle?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      data-part="attention-star"
      aria-pressed={pressed}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onToggle?.()
      }}
      className={`rounded-mini p-1 ${pressed ? 'text-status-warn-deep' : 'text-ink-faint'} hover:bg-status-warn-soft hover:text-status-warn-deep ${className}`}
    >
      <Star aria-hidden="true" className={`h-4 w-4 ${pressed ? 'fill-current' : ''}`} />
    </button>
  )
}
