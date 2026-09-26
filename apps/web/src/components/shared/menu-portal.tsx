'use client'

import { createPortal } from 'react-dom'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import styles from './menu-portal.module.css'

export type MenuPortalAlign = 'start' | 'end'
export type MenuPortalPlacement = 'down' | 'up'

export type MenuPortalProps = {
  /** 開いている間だけ body へ出す。閉じたら何も描かない。 */
  open: boolean
  /** 位置の基準（開くボタン）。開くたび・動くたびに測り直す。 */
  getAnchor: () => HTMLElement | null
  /** 横の寄せ。既定は `end`（今までの `right-0` と同じく右寄せ）。 */
  align?: MenuPortalAlign
  /** ボタンとのすき間。★V7 メニューは4px。既定は 4。 */
  gap?: number
  /**
   * 欄の幅に合わせる（候補つき入力・単一選択）。
   * `true` は幅をそろえ、`'min'` は欄の幅を下限にする。既定は中身の幅。
   */
  matchWidth?: boolean | 'min'
  /** 外を押した・Esc で閉じるとき。開くボタンの押下は含まない。 */
  onClose: () => void
  children: ReactNode
}

type Geometry = {
  top: number
  left: number
  width: number | undefined
  minWidth: number | undefined
  placement: MenuPortalPlacement
}

/**
 * メニュー・候補を画面の最上層（`document.body` 直下・`position: fixed`）
 * に出す器。
 *
 * カード・表・ダイアログ・固定の帯の中にあっても、親の
 * `overflow: hidden` や重なり順（`z-index`）に切られない。
 * 下に場所が無ければ上へ開き、右に無ければ左へ寄せる。
 * 長い中身は子の側（`max-height`＋`overflow-y: auto`）でスクロールする。
 *
 * 見た目は持たない。白地・角丸・影は子が持つ。
 */
export default function MenuPortal({
  open,
  getAnchor,
  align = 'end',
  gap = 4,
  matchWidth = false,
  onClose,
  children,
}: MenuPortalProps) {
  const [mounted, setMounted] = useState(false)
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const anchorRef = useRef(getAnchor)
  anchorRef.current = getAnchor

  useLayoutEffect(() => {
    setMounted(true)
  }, [])

  useLayoutEffect(() => {
    if (!open || !mounted) return
    const measure = () => {
      const anchor = anchorRef.current()
      const panel = panelRef.current
      if (!anchor || !panel) return
      const anchorRect = anchor.getBoundingClientRect()
      const panelWidth = matchWidth === true ? anchorRect.width : panel.offsetWidth
      const minWidth = matchWidth === 'min' ? anchorRect.width : undefined
      const panelHeight = panel.offsetHeight
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const margin = 8
      const spaceBelow = viewportHeight - anchorRect.bottom - gap - margin
      const spaceAbove = anchorRect.top - gap - margin
      let top: number
      let placement: MenuPortalPlacement
      if (panelHeight <= spaceBelow || spaceBelow >= spaceAbove) {
        placement = 'down'
        top = anchorRect.bottom + gap
      } else {
        placement = 'up'
        top = anchorRect.top - gap - panelHeight
      }
      top = Math.max(margin, Math.min(top, viewportHeight - panelHeight - margin))
      const rawLeft = align === 'end' ? anchorRect.right - panelWidth : anchorRect.left
      const left = Math.max(margin, Math.min(rawLeft, viewportWidth - panelWidth - margin))
      setGeometry({
        top,
        left,
        width: matchWidth === true ? Math.max(0, panelWidth) : undefined,
        minWidth,
        placement,
      })
    }
    measure()
    window.addEventListener('resize', measure)
    // 表の中・ダイアログの中など、入れ物のスクロールにも追従する。
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, mounted, align, gap, matchWidth, children])

  useLayoutEffect(() => {
    if (!open || !mounted) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current()?.contains(target)) return
      closeRef.current()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, mounted])

  if (!open || !mounted || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={panelRef}
      className={styles.portal}
      data-menu-portal=""
      data-placement={geometry?.placement ?? 'down'}
      style={{
        top: geometry?.top ?? 0,
        left: geometry?.left ?? 0,
        width: geometry?.width,
        minWidth: geometry?.minWidth,
        // 測る前の一瞬だけ隠す（左上へのちらつき防止）。
        visibility: geometry ? undefined : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
