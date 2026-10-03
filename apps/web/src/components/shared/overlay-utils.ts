'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

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
  const containerRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const initialFocusRef = useRef(initialFocus)

  useEffect(() => {
    onCloseRef.current = onClose
    initialFocusRef.current = initialFocus
  }, [onClose, initialFocus])

  useEffect(() => {
    if (!open) return
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
    const initialFocusFrame = requestAnimationFrame(() => (initialFocusRef.current?.() ?? focusable()[0])?.focus())

    const onKeyDown = (event: KeyboardEvent) => {
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
      document.body.style.overflow = previousOverflow
      previous?.focus()
    }
  }, [closeDisabled, open])

  return containerRef
}

/*
 * ★V8 仕上げ（M10）：窓・引き出しの「閉じるときは逆再生」。
 * V8 のときだけ閉じの印を残し（150ms の逆再生ぶん）、v7・試験
 * （v8 でない）は今までどおり即時に外す。開き直したら印を消す。
 */
export function useV8Leave(open: boolean, ms = 160): boolean {
  const [leaving, setLeaving] = useState(false)
  const wasOpenRef = useRef(open)
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true
      setLeaving(false)
      return
    }
    if (!wasOpenRef.current) return
    wasOpenRef.current = false
    if (typeof document === 'undefined' || document.documentElement?.dataset?.theme !== 'v8') return
    setLeaving(true)
    const timer = setTimeout(() => setLeaving(false), ms)
    return () => clearTimeout(timer)
  }, [ms, open ])
  return leaving
}
