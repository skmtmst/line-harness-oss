'use client'

import { createPortal } from 'react-dom'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

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
  /**
   * 位置だけ別の箱に合わせるとき（ベルの小窓は上の帯の右端から 8 内側・帯の下）。
   * 外を押したかの判定は getAnchor のまま（開くボタンの押下は外にしない）。
   */
  getPositionRect?: () => MenuPortalRect | null
  children: ReactNode
}

export type MenuPortalRect = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right' | 'width'>

type Geometry = {
  top: number
  left: number
  width: number | undefined
  minWidth: number | undefined
  placement: MenuPortalPlacement
  /** 開く方向に使える高さ（画面 − ボタン − 余白8px）。器の最大の高さ。 */
  maxHeight: number
}

/** 画面端の余白。上下左右とも 8px。 */
export const MENU_PORTAL_MARGIN = 8

/** 下に続きがあるか（1px の誤差は無視）。 */
export function hasMoreBelow({
  scrollHeight,
  scrollTop,
  clientHeight,
}: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}): boolean {
  return scrollHeight - scrollTop - clientHeight > 1
}

/**
 * メニュー・候補を画面の最上層（`document.body` 直下・`position: fixed`）
 * に出す器。
 *
 * カード・表・ダイアログ・固定の帯の中にあっても、親の
 * `overflow: hidden` や重なり順（`z-index`）に切られない。
 * 下に場所が無ければ上へ開き、右に無ければ左へ寄せる。
 * 高さは開く方向に使える分（画面 − ボタン − 余白8px）まで使い、
 * 入るなら全部出し、入りきらない時だけ器の中でスクロールする。
 * その時は下端に影（続きの目印）を付ける。
 *
 * 見た目は持たない。白地・角丸・浮きの影は子が持つ。
 * （下端の続きの影だけは器が付ける。）
 */
export default function MenuPortal({
  open,
  getAnchor,
  align = 'end',
  gap = 4,
  matchWidth = false,
  onClose,
  getPositionRect,
  children,
}: MenuPortalProps) {
  const [mounted, setMounted] = useState(false)
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const anchorRef = useRef(getAnchor)
  anchorRef.current = getAnchor
  const positionRef = useRef(getPositionRect)
  positionRef.current = getPositionRect

  useLayoutEffect(() => {
    setMounted(true)
  }, [])

  useLayoutEffect(() => {
    if (!open || !mounted) return
    const measure = () => {
      const anchor = anchorRef.current()
      const panel = panelRef.current
      if (!anchor || !panel) return
      const anchorRect = positionRef.current?.() ?? anchor.getBoundingClientRect()
      const panelWidth = matchWidth === true ? anchorRect.width : panel.offsetWidth
      const minWidth = matchWidth === 'min' ? anchorRect.width : undefined
      // 上限で切った後の高さではなく中身の全部の高さで開く向きを決める。
      const contentHeight = panel.scrollHeight || panel.offsetHeight
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const margin = MENU_PORTAL_MARGIN
      const spaceBelow = viewportHeight - anchorRect.bottom - gap - margin
      const spaceAbove = anchorRect.top - gap - margin
      let placement: MenuPortalPlacement
      if (contentHeight <= spaceBelow || spaceBelow >= spaceAbove) {
        placement = 'down'
      } else {
        placement = 'up'
      }
      // 開く方向に使える高さまで使う。入るなら全部、足りなければここで切る。
      const maxHeight = Math.max(0, placement === 'down' ? spaceBelow : spaceAbove)
      const shownHeight = Math.min(contentHeight || maxHeight, maxHeight)
      const top =
        placement === 'down'
          ? anchorRect.bottom + gap
          : Math.max(margin, anchorRect.top - gap - shownHeight)
      const rawLeft = align === 'end' ? anchorRect.right - panelWidth : anchorRect.left
      const left = Math.max(margin, Math.min(rawLeft, viewportWidth - panelWidth - margin))
      setGeometry({
        top,
        left,
        width: matchWidth === true ? Math.max(0, panelWidth) : undefined,
        minWidth,
        placement,
        maxHeight,
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

  // 下に続きがある間だけ下端の影を出す。入りきる時は影なし。
  useLayoutEffect(() => {
    if (!open || !mounted) return
    const panel = panelRef.current
    if (!panel) return
    const update = () => {
      setHasMore(
        hasMoreBelow({
          scrollHeight: panel.scrollHeight,
          scrollTop: panel.scrollTop,
          clientHeight: panel.clientHeight,
        }),
      )
    }
    update()
    panel.addEventListener('scroll', update, { passive: true })
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (observer) observer.observe(panel)
    window.addEventListener('resize', update)
    return () => {
      panel.removeEventListener('scroll', update)
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [open, mounted, geometry?.maxHeight, children])

  useLayoutEffect(() => {
    if (!open || !mounted) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current()?.contains(target)) return
      /*
       * R251: 別の器（MenuPortal）の中への押下は外側扱いにしない。
       * 時刻ダイアログの中の時・分 Select の候補は、body 直下の別の器に
       * 描かれる。外側扱いで先に閉じると click が届かず値が入らない。
       * 重なった器同士は、それぞれ自分の外への押下だけで閉じる。
       */
      const element = target as Partial<HTMLElement>
      if (typeof element.closest === 'function' && element.closest('[data-menu-portal]')) return
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
      // 静的に読める形にする（直書き借金の見張り）。重なりの数字と
      // 画面端の上限は style へ。見た目（白地・角丸・浮きの影）は子が持つ。
      // 高さの上限と続きの影だけは器が持つ（子は自分の上限を外す）。
      className="fixed min-w-0"
      data-menu-portal=""
      data-placement={geometry?.placement ?? 'down'}
      // 開く動きの起点（押した角）を部品の CSS が決めるための印。
      data-align={align}
      data-has-more={hasMore ? 'true' : 'false'}
      style={{
        top: geometry?.top ?? 0,
        left: geometry?.left ?? 0,
        width: geometry?.width,
        minWidth: geometry?.minWidth,
        zIndex: 120,
        maxWidth: 'calc(100vw - 16px)',
        // 開く方向に使える高さまで。入るなら全部、足りなければ中でスクロール。
        maxHeight: geometry?.maxHeight,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        // 下に続きがある間だけ下端の影（続きの目印）。
        boxShadow: hasMore ? 'inset 0 -16px 12px -12px rgb(0 0 0 / 22%)' : undefined,
        // 測る前の一瞬だけ隠す（左上へのちらつき防止）。
        visibility: geometry ? undefined : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
