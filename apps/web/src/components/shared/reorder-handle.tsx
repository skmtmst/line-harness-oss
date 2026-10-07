'use client'

import {
  useState,
  type ButtonHTMLAttributes,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { GripVertical } from 'lucide-react'
import type { ActionMenuItem } from './action-menu'
import { useLiveReorder } from '@/lib/use-live-reorder'
import styles from './row-actions.module.css'

/*
 * 並び替えの共通部品（つまみ1つ・動かし方3つ）。
 *
 * 決まり（オーナー点検 2026-10-08「並び替えの操作が画面ごとにばらばら」）:
 * - つまみが見えている所は、ドラッグ・上下キー・「…」の「上へ／下へ」が
 *   同じ結果になる。3つとも `useReorder` の1つの入口（onReorder）を通る。
 * - 動かせない時（保存中・検索中・権限が無い・並びが別の順・処理の優先順位で
 *   決まる並び）は、つまみを出さない。理由は title と読み上げで言う。
 * - 保存は画面ごとの今の API のまま。失敗したら画面側で元の位置へ戻して理由を出す。
 *
 * 以前の `DragHandle`（shared/row-actions）と `ReorderGrip`（friend-fields）は
 * この部品の別名として残す。v7 の画面の見た目を変えないため。
 */

export type ReorderDirection = -1 | 1

type HandleButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'type'>

export type ReorderHandleProps = HandleButtonProps & {
  /** 項目の名前。読み上げ「◯◯を並び替え。上下キーで移動」に使う。 */
  label: string
  /** 読み上げ全体を差し替えるとき（既存の画面の言い回しを保つ）。 */
  ariaLabel?: string
  /** 1つ上（-1）・1つ下（+1）。上下キーで呼ぶ。 */
  onMove?: (direction: ReorderDirection) => void | Promise<void>
  /**
   * 動かせない理由。渡すとつまみを出さず、同じ幅の空きに理由を
   * title と読み上げ（sr-only）で置く。
   */
  disabledReason?: string | null
  /** 理由の文言が無くても動かせない（v7 の旧 ReorderGrip の disabled だけが使う）。 */
  locked?: boolean
  /**
   * 見た目。`icon` は 32×32 の当たりに6点の図柄（Pencil `K65Uhe`、旧 DragHandle）。
   * `inline` は文字の高さのつまみ（旧 ReorderGrip）。図柄は children で差し替える。
   */
  look?: 'icon' | 'inline'
  /**
   * 動かせない時の出し方。V8 の画面は `hide`（つまみを出さない）。
   * `dim` は v7 の画面の見た目を変えないためだけに残す（薄いつまみ）。
   */
  disabledLook?: 'hide' | 'dim'
  children?: ReactNode
}

const SIX_DOTS = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="9" cy="6" r="1.6" />
    <circle cx="15" cy="6" r="1.6" />
    <circle cx="9" cy="12" r="1.6" />
    <circle cx="15" cy="12" r="1.6" />
    <circle cx="9" cy="18" r="1.6" />
    <circle cx="15" cy="18" r="1.6" />
  </svg>
)

const INLINE_CLASS = 'inline-flex cursor-grab items-center justify-center rounded-control p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action'

export default function ReorderHandle({
  label,
  ariaLabel,
  onMove,
  disabledReason,
  look = 'inline',
  disabledLook = 'hide',
  locked = false,
  className,
  children,
  title,
  onKeyDown,
  ...rest
}: ReorderHandleProps) {
  const glyph = children ?? (look === 'icon' ? SIX_DOTS : <GripVertical size={16} aria-hidden="true" />)
  if (disabledReason || locked) {
    if (disabledLook === 'dim') {
      return (
        <span
          className="inline-flex cursor-not-allowed items-center justify-center text-ink-faint"
          title={disabledReason ?? undefined}
          aria-label={disabledReason ?? undefined}
        >
          {glyph}
        </span>
      )
    }
    /* つまみは出さない。幅だけ同じに空け、理由は title と読み上げで言う。 */
    return (
      <span
        className={[look === 'icon' ? styles.action : 'inline-flex items-center justify-center p-0.5', className].filter(Boolean).join(' ')}
        style={look === 'icon' ? { cursor: 'default', background: 'none' } : undefined}
        title={disabledReason ?? undefined}
        data-reorder-disabled=""
      >
        <span aria-hidden="true" style={{ visibility: 'hidden', display: 'inline-flex' }}>{glyph}</span>
        <span className="sr-only">{`${label}は並び替えできません。${disabledReason ?? ''}`}</span>
      </span>
    )
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event)
    if (!onMove || event.defaultPrevented) return
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
      {...rest}
      onKeyDown={handleKeyDown}
      // 一覧の行の矢印移動（row-roving）に ↑↓ を取られないようにする。←→ は行の中の移動に使う。
      data-roving-own="vertical"
      data-reorder-handle=""
      aria-label={ariaLabel ?? `${label}を並び替え。上下キーで移動`}
      title={title ?? 'ドラッグまたは上下キーで並び替え'}
      className={[look === 'icon' ? `${styles.action} ${styles.grip}` : INLINE_CLASS, className].filter(Boolean).join(' ')}
    >
      {glyph}
    </button>
  )
}

/* ------------------------------------------------------------ 並びの計算 */

/** id の並びから1つを toIndex へ動かした新しい並び。動かないときは null。 */
export function moveIdTo(ids: readonly string[], id: string, toIndex: number): string[] | null {
  const from = ids.indexOf(id)
  if (from < 0 || toIndex < 0 || toIndex >= ids.length || from === toIndex) return null
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export type ReorderVia = 'drag' | 'key' | 'menu'

export type ReorderChange = {
  /** 動かした項目。 */
  id: string
  from: number
  to: number
  /** 動かした後の全体の並び。 */
  ids: string[]
  via: ReorderVia
}

/**
 * 一覧の並び替え。ドラッグ・上下キー・「…」の上へ／下へを1つの入口
 * （onReorder）にまとめる。items は「今の全体の並び」を渡す（絞り込んだ一部は渡さない。
 * 絞り込み中は disabledReason で止める）。
 */
export function useReorder<T>({
  items,
  idOf,
  disabledReason,
  onReorder,
  onEdge,
}: {
  items: readonly T[]
  idOf: (item: T) => string
  /** 動かせない理由。null／空なら動かせる。 */
  disabledReason?: string | null
  onReorder: (change: ReorderChange) => void | Promise<void>
  /** 先頭で上・末尾で下を押した（キーのとき）。知らせを出す画面だけ渡す。 */
  onEdge?: (id: string, direction: ReorderDirection) => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const live = useLiveReorder(items, idOf, dragId)
  const blocked = Boolean(disabledReason)
  const ids = items.map(idOf)

  const commit = (id: string, to: number, via: ReorderVia) => {
    if (blocked) return false
    const next = moveIdTo(ids, id, to)
    if (!next) return false
    void onReorder({ id, from: ids.indexOf(id), to, ids: next, via })
    return true
  }

  const moveBy = (id: string, direction: ReorderDirection, via: ReorderVia = 'key') => {
    if (blocked) return
    const from = ids.indexOf(id)
    if (from < 0) return
    const to = from + direction
    if (to < 0 || to >= ids.length) {
      onEdge?.(id, direction)
      return
    }
    commit(id, to, via)
  }

  const canMoveBy = (id: string, direction: ReorderDirection) => {
    const from = ids.indexOf(id)
    const to = from + direction
    return !blocked && from >= 0 && to >= 0 && to < ids.length
  }

  const dropOn = (targetId: string) => {
    const from = dragId
    setDragId(null)
    live.reset()
    if (!from || from === targetId) return
    const to = ids.indexOf(targetId)
    if (to < 0) return
    commit(from, to, 'drag')
  }

  /** つまみ（またはつまみのある枠）に付ける。動かせない時は何も付けない。 */
  const handleProps = (id: string) => blocked
    ? { draggable: false as const }
    : {
        draggable: true as const,
        onDragStart: (event: DragEvent<HTMLElement>) => {
          event.dataTransfer?.setData('text/plain', id)
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
          setDragId(id)
        },
        onDragEnd: () => { setDragId(null); live.reset() },
      }

  /** 置き場所になる行に付ける。 */
  const rowProps = (id: string) => ({
    'data-reorder-id': id,
    onDragEnter: () => live.enter(id),
    onDragOver: dragId ? (event: DragEvent<HTMLElement>) => event.preventDefault() : undefined,
    onDrop: dragId
      ? (event: DragEvent<HTMLElement>) => { event.preventDefault(); dropOn(live.dropTarget(id)) }
      : undefined,
  })

  /** 「…」に入れる「上へ」「下へ」。つまみと同じ入口を通る。動かせない時は出さない。 */
  const menuItems = (id: string, onDone?: () => void): ActionMenuItem[] => {
    if (blocked) return []
    const from = ids.indexOf(id)
    return [
      {
        id: 'move-up',
        label: '上へ',
        disabled: from <= 0,
        disabledReason: from <= 0 ? 'いちばん上です' : undefined,
        onSelect: () => { moveBy(id, -1, 'menu'); onDone?.() },
      },
      {
        id: 'move-down',
        label: '下へ',
        disabled: from < 0 || from >= ids.length - 1,
        disabledReason: from >= ids.length - 1 ? 'いちばん下です' : undefined,
        onSelect: () => { moveBy(id, 1, 'menu'); onDone?.() },
      },
    ]
  }

  const handle = (id: string) => ({
    onMove: (direction: ReorderDirection) => moveBy(id, direction, 'key'),
    disabledReason: disabledReason || null,
  })

  return {
    /** ドラッグ中は置き場所を入れ替えて見せた並び。それ以外は items のまま。 */
    shown: live.shown,
    dragId,
    blocked,
    moveBy,
    canMoveBy,
    handleProps,
    rowProps,
    menuItems,
    /** ReorderHandle に渡す onMove・disabledReason。 */
    handle,
  }
}
