'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import styles from './skeleton.module.css'

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
 * 形の決まった骨組みの組み合わせ（V8「サクサク感」⑤・Aで各画面が使う）。
 * 出来上がりと同じ大きさで置くので、入れ替わっても高さは動かない
 * （CLS 0）。使い方は `DelayedSkeleton` の `skeleton` に渡すだけ。
 * 入れ物（表・一覧）の `aria-busy` は画面側が付ける。骨1本ずつは
 * `Skeleton` が `aria-hidden` のため読み上げに出ない。
 * V8 の光は `data-skeleton` に自動で付く。自前の動きは書かない。
 */

/**
 * 表の骨組み。見出しは画面の表に残し、tbody の場所へ置く。
 * 行の高さは出来上がりと同じ（V8 52・v7 は 58 を渡す）。
 * 列の骨の幅は出来上がりの列幅と同じ値を渡す。
 */
export function TableSkeleton({
  columns,
  rows = 5,
  rowHeight = 52,
}: {
  /** 列ごとの骨の幅（px 数か CSS の長さ。出来上がりの列幅と同じ）。 */
  columns: Array<number | string>
  /** 骨の行数。 */
  rows?: number
  /** 1 行の高さ（px）。 */
  rowHeight?: number
}) {
  return (
    <tbody aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} style={{ height: rowHeight }}>
          {columns.map((width, column) => (
            <td key={column}>
              <Skeleton height={14} width={width} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

/**
 * カードの骨組み。カードの大きさで並べる。
 */
export function CardsSkeleton({ count = 4, height = 112 }: { count?: number; height?: number }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} height={height} className="w-full rounded-card" />
      ))}
    </div>
  )
}

/**
 * 数のタイルの骨組み。題の骨＋数字の幅の骨を帯に並べる。
 */
export function StatTilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 sm:flex-row">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex-1 rounded-card border border-hairline bg-canvas px-4 py-3">
          <Skeleton height={12} width={64} />
          <div className="mt-2">
            <Skeleton height={28} width={96} />
          </div>
        </div>
      ))}
    </div>
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

/** 正本 jr5Nl：一覧の顔と4列の骨。幅は置き場所に従う。 */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={[styles.row, className].filter(Boolean).join(' ')} aria-hidden="true">
      <Skeleton circle width={32} height={32} className={styles.face} />
      <Skeleton height={10} className={styles.flexBone} />
      <Skeleton width={70} height={10} className={styles.bone} />
      <Skeleton height={10} className={styles.flexBone} />
      <Skeleton width={50} height={10} className={styles.bone} />
    </div>
  )
}
