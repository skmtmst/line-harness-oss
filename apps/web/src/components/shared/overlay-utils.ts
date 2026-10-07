'use client'

import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react'

export const OverlayDepthContext = createContext(0)
const activeOverlays = new Map<object, { depth: number; order: number }>()
let overlayOrder = 0
let originalOverflow = ''

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** モーダル系のフォーカス移動・Escape・背景スクロール停止を1か所にまとめる。 */
export function useOverlayFocus(
  open: boolean,
  onClose: () => void,
  closeDisabled = false,
  /**
   * 初回に寄せる要素。未指定なら先頭の操作へ寄せる従来どおり。
   * 未保存の離脱確認のように「残る方」を主にする窓で、主のボタンへ寄せる。
   */
  initialFocus?: () => HTMLElement | null,
): RefObject<HTMLDivElement | null> {
  const depth = useContext(OverlayDepthContext)
  const identity = useRef<object>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const initialFocusRef = useRef(initialFocus)

  useEffect(() => {
    onCloseRef.current = onClose
    initialFocusRef.current = initialFocus
  }, [onClose, initialFocus])

  useEffect(() => {
    if (!open) return
    const key = identity.current
    const order = ++overlayOrder
    if (activeOverlays.size === 0) originalOverflow = document.body.style.overflow
    activeOverlays.set(key, { depth, order })
    const isTop = () => {
      if (document.documentElement.dataset.theme !== 'v8') return true
      const top = [...activeOverlays.entries()].sort((a, b) => b[1].depth - a[1].depth || b[1].order - a[1].order)[0]
      return top?.[0] === key
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    /*
     * containerRef.current は効果の中で一度だけ読まず、使うたびに読む。
     * open=true で初回マウントした部品は、最初は通常DOMへ描き、effectで
     * portal へ移す（shared/dialog.tsx 等）。その切替で ref が別の要素へ
     * 付け替わるため、掴んだままの要素は外れたDOMを指してしまう（DEEP-15）。
     */
    const focusable = () =>
      Array.from(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    // 初回フォーカスの予約は cleanup で取消せるようにしておく。
    const initialFocusFrame = requestAnimationFrame(() => {
      if (isTop()) (initialFocusRef.current?.() ?? focusable()[0])?.focus()
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return
      if (event.key === 'Escape' && !closeDisabled) {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        containerRef.current?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(initialFocusFrame)
      document.removeEventListener('keydown', onKeyDown)
      const restoreFocus = isTop()
      activeOverlays.delete(key)
      if (document.documentElement.dataset.theme !== 'v8' || activeOverlays.size === 0) {
        document.body.style.overflow = document.documentElement.dataset.theme === 'v8' ? originalOverflow : previousOverflow
      }
      if (restoreFocus) previous?.focus()
    }
  }, [closeDisabled, open, depth])

  return containerRef
}

/**
 * 動きの変数（--motion-*）の長さを ms で読む。JS のタイマーを CSS の動きと
 * 同じ長さにそろえるため（数字を JS に直書きしない。動きの点検 18 番）。
 */
export function motionMs(name: string, fallback: number): number {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const value = parseFloat(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return raw.endsWith('ms') ? value : raw.endsWith('s') ? value * 1000 : value
}

/** 閉じる動きの長さ（--motion-exit）。読めなければ 150ms。 */
function exitMs(): number {
  return motionMs('--motion-exit', 150)
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 閉じる動きを付けてよいか。V8 の見た目で、動きを減らす設定でないときだけ。
 * v7・試験（v8 でない）・動きを減らす設定では即時に外す。
 */
export function shouldAnimateLeave(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement?.dataset?.theme === 'v8'
    && !prefersReducedMotion()
}

/*
 * ★V8 仕上げ（M10）：窓・引き出しの「閉じるときは逆再生」。
 * V8 のときだけ閉じの印を残し（--motion-exit ぶん）、v7・試験
 * （v8 でない）は今までどおり即時に外す。開き直したら印を消す。
 *
 * 閉じの印は「描画の中」で立てる（2026-10-07 動きの点検 1 番）。
 * 以前は effect の中で立てていたので、閉じた最初の描画では
 * open=false・leaving=false になり、窓が一度外れてから付け直され
 * （消える→ふわっと出る→消える）とちらついていた。
 * 前の open を state に持ち、変わった描画のうちに leaving を決めると、
 * React はその描画を捨てて同じ描画で leaving=true から描き直す。
 * 動きを減らす設定では逆再生しないので、印も立てずに即時に外す。
 */
export function useV8Leave(open: boolean, ms?: number): boolean {
  const [leaving, setLeaving] = useState(false)
  const [previousOpen, setPreviousOpen] = useState(open)
  if (previousOpen !== open) {
    setPreviousOpen(open)
    setLeaving(!open && shouldAnimateLeave())
  }
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setLeaving(false), ms ?? exitMs())
    return () => clearTimeout(timer)
  }, [leaving, ms])
  return leaving
}

/** 消えかけの1件。`leaving` が true の間は閉じる動きを見せてから外す。 */
export type LeavingEntry<T> = { item: T; leaving: boolean }

/*
 * 並ぶもの（知らせなど）の「消えかけ」（動きの点検 13 番）。
 * `useV8Leave` と同じく、外れた描画のうちに消えかけへ移し、
 * --motion-exit ぶん残してから外す。1件ずつ自分の期限で外すので、
 * 続けて消えても先の1件が長く残らない。
 * 動きを減らす設定・v8 でないときは今までどおり即時に外す。
 */
export function useV8LeaveList<T extends { id: number }>(items: readonly T[], ms?: number): LeavingEntry<T>[] {
  const [previous, setPrevious] = useState(items)
  const [leavingItems, setLeavingItems] = useState<{ item: T; until: number }[]>([])
  if (previous !== items) {
    setPrevious(items)
    const ids = new Set(items.map((item) => item.id))
    // 戻ってきたもの（同じ id）は消えかけから外す。
    const kept = leavingItems.filter((entry) => !ids.has(entry.item.id))
    const gone = shouldAnimateLeave()
      ? previous.filter((item) => !ids.has(item.id) && !kept.some((entry) => entry.item.id === item.id))
      : []
    if (gone.length > 0 || kept.length !== leavingItems.length) {
      const until = Date.now() + (ms ?? exitMs())
      setLeavingItems([...kept, ...gone.map((item) => ({ item, until }))])
    }
  }
  useEffect(() => {
    if (leavingItems.length === 0) return
    const next = Math.min(...leavingItems.map((entry) => entry.until))
    const timer = setTimeout(() => {
      const now = Date.now()
      setLeavingItems((current) => current.filter((entry) => entry.until > now))
    }, Math.max(0, next - Date.now()))
    return () => clearTimeout(timer)
  }, [leavingItems])
  return [
    ...items.map((item) => ({ item, leaving: false })),
    ...leavingItems.map((entry) => ({ item: entry.item, leaving: true })),
  ].sort((a, b) => a.item.id - b.item.id)
}
