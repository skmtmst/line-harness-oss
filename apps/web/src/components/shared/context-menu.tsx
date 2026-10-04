'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ActionMenu from './action-menu'
import styles from './context-menu.module.css'

export type ContextMenuItem = {
  id: string
  label: string
  danger?: boolean
  disabled?: boolean
  onSelect: (id: string) => void
}

export type ContextMenuProps = {
  /** 出す項目（実データの行ごとに作る）。 */
  items: ContextMenuItem[]
  /** 右クリックされる範囲。押した位置に出る。 */
  children: React.ReactNode
  /** 読み上げ用の名前（「○○の操作」）。 */
  label: string
  /** 空の所の右クリックでは出さない、などの絞り。無ければどこでも出る。 */
  shouldOpen?: (event: React.MouseEvent) => boolean
}

const MENU_MIN_WIDTH = 224
const MENU_PAD = 8
const MENU_ROW_PX = 36

/**
 * 右クリックで ActionMenu を出す仕組み（V8「サクサク感」C③）。
 * 押した位置に出し、中身の動き（↑↓・Enter・Esc・外を押したら閉じる）は
 * ActionMenu の inline の扱いに任せる。画面の外には出さない。
 * キーボードだけの人用に Shift+F10 でも開く。
 */
export default function ContextMenu({ items, children, label, shouldOpen }: ContextMenuProps) {
  const [open, setOpen] = useState(false)
  const [point, setPoint] = useState({ x: 0, y: 0 })
  const areaRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<Element | null>(null)

  const close = () => {
    setOpen(false)
    // 右クリックでは的を外さないので、閉じたら元の場所へ戻す。
    if (returnFocusRef.current instanceof HTMLElement) returnFocusRef.current.focus()
  }

  // 開いたら最初の項目へ的を移す（↑↓・Enter・Esc がすぐ効く）。
  useEffect(() => {
    if (!open) return
    layerRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
  }, [open ])

  const place = (x: number, y: number) => {
    // 画面の外に出さない（右端・下端で折り返す）。
    const width = typeof window === 'undefined' ? 1024 : window.innerWidth
    const height = typeof window === 'undefined' ? 768 : window.innerHeight
    return {
      x: Math.max(MENU_PAD, Math.min(x, width - MENU_MIN_WIDTH - MENU_PAD)),
      y: Math.max(MENU_PAD, Math.min(y, height - MENU_PAD - items.length * MENU_ROW_PX - 16)),
    }
  }

  const openAt = (x: number, y: number) => {
    if (items.length === 0) return
    returnFocusRef.current = document.activeElement
    setPoint(place(x, y))
    setOpen(true)
  }

  return (
    <div
      ref={areaRef}
      className={styles.area}
      onContextMenu={(event) => {
        if (shouldOpen && !shouldOpen(event)) return
        event.preventDefault()
        openAt(event.clientX, event.clientY)
      }}
      onKeyDown={(event) => {
        // Shift+F10（Windows のメニューキー代わり）でも開く。
        if (event.shiftKey && event.key === 'F10') {
          event.preventDefault()
          const box = areaRef.current?.getBoundingClientRect()
          openAt(box ? box.left + 24 : 24, box ? box.top + 24 : 24)
        }
      }}
    >
      {children}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div ref={layerRef} data-context-menu="true" className={styles.layer} style={{ left: point.x, top: point.y }}>
              <ActionMenu
                open
                inline
                ariaLabel={label}
                onClose={close}
                items={items.map((item) => ({
                  id: item.id,
                  label: item.label,
                  tone: item.danger ? ('danger' as const) : undefined,
                  disabled: item.disabled,
                  onSelect: () => item.onSelect(item.id),
                }))}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
