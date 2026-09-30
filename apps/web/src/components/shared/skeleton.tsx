'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

/*
 * 骨組み（★V7 仕上げ `z97zZN` §3）。
 *
 * - 出来上がりと同じ大きさの灰色の面（`canvas-sunken`）。ずれがないので
 *   本物と入れ替わってもガタつかない（CLS 0）
 * - 明滅は不透明度 1↔0.55・1.2秒（globals.css で `.animate-pulse` を
 *   V7 の速さに揃えてある）。光が流れる演出は使わない
 * - 「0.3秒以内に来たら出さない・出したら最低0.4秒」は `DelayedSkeleton` が
 *   面倒を見る。瞬き防止のため骨組みを描く側は必ずこの判定を通す
 *   （`loading && <Skeleton/>` を直接書かない）
 * - 「読み込み中」の読み上げは入れ物の `aria-busy` で 1 回だけ伝える。
 *   骨組み 1 枚ずつに読み上げは付けない（`aria-hidden`）
 * - 動きを減らす設定では globals.css の決まりで明滅は止まる
 */

export function Skeleton({
  className,
  circle,
  width,
  height,
}: {
  className?: string
  /** 真円にする（アイコン・写真の場所）。 */
  circle?: boolean
  /** px 数か CSS の長さ。未指定は中身・CSS 側の大きさに従う。 */
  width?: number | string
  height?: number | string
}) {
  const style: CSSProperties = {}
  if (width !== undefined) style.width = typeof width === 'number' ? `${width}px` : width
  if (height !== undefined) style.height = typeof height === 'number' ? `${height}px` : height
  return (
    <span
      data-skeleton=""
      aria-hidden="true"
      className={[
        'inline-block animate-pulse bg-canvas-sunken',
        circle ? 'rounded-pill' : 'rounded-mini',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
    />
  )
}

const SHOW_DELAY_MS = 300 // 応答が 0.3 秒以内なら骨組みを出さない
const MIN_VISIBLE_MS = 400 // 出した骨組みは最低 0.4 秒残す

/**
 * 「0.3秒以内に来たら出さない・出したら最低0.4秒」の判定。
 * `loading` が立ち上がってから `SHOW_DELAY_MS` 経って初めて true になり、
 * `loading` が下がっても `MIN_VISIBLE_MS` は true のまま残る。
 */
export function useDelayedSkeleton(loading: boolean): boolean {
  const [visible, setVisible] = useState(false)
  const shownAtRef = useRef<number | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    if (loading) {
      if (shownAtRef.current === null && !visible) {
        timer = setTimeout(() => {
          shownAtRef.current = Date.now()
          setVisible(true)
        }, SHOW_DELAY_MS)
      }
    } else if (shownAtRef.current !== null) {
      const remaining = MIN_VISIBLE_MS - (Date.now() - shownAtRef.current)
      timer = setTimeout(() => {
        shownAtRef.current = null
        setVisible(false)
      }, Math.max(0, remaining))
    }
    return () => {
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [loading, visible])
  return visible
}

/**
 * 骨組みの瞬き防止つきの入れ替え。`loading` のあいだ `children`（本物の
 * 内容）の場所へ `skeleton`（`Skeleton` など）を出す。
 *
 * - 応答が 0.3 秒以内なら骨組みは出さず、その間は本物を不可視で置いて
 *   場所を取る（骨組みが出ても本物が来ても高さは動かない）。
 * - いったん骨組みが出たら、応答が来ても最低 0.4 秒は骨組みのままにする。
 * - 骨組み→本物の入れ替えは見た目の切り替えだけで、大きさは動かない。
 */
export function DelayedSkeleton({
  loading,
  skeleton,
  children,
}: {
  loading: boolean
  /** 待っているあいだに出す骨組み。 */
  skeleton: ReactNode
  /** 本物の内容（読み込みが済んでいなくても渡してよい。不可視で置かれる）。 */
  children?: ReactNode
}) {
  const visible = useDelayedSkeleton(loading)
  if (visible) return <>{skeleton}</>
  if (!loading) return <>{children}</>
  // まだ骨組みを出さない間は本物を不可視で置き、場所だけ取る。
  return (
    <span aria-hidden="true" className="invisible inline-block">
      {children}
    </span>
  )
}

/**
 * 「遅れてだけ見せる」判定（`sTJsh` §2 の「0.3秒より早く来たら薄めない」用）。
 * 骨組みと違って最低表示時間は無い。応答が来たらすぐ元に戻す。
 */
export function useDelayedShow(active: boolean, delayMs = SHOW_DELAY_MS): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!active) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(true), delayMs)
    return () => clearTimeout(timer)
  }, [active, delayMs])
  return visible
}
