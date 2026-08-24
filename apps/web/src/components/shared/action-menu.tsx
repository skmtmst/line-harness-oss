'use client'

import React, { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import styles from './action-menu.module.css'

export type ActionMenuItem = {
  id: string
  label: string
  icon?: ReactNode
  tone?: 'default' | 'danger'
  disabled?: boolean
  dividerBefore?: boolean
  onSelect: () => void
}

export type ActionMenuProps = {
  open: boolean
  items: ActionMenuItem[]
  note?: string
  onClose: () => void
  ariaLabel?: string
  /** 参照画像の固定比較用。 */
  inline?: boolean
}

/** Pencil V5 `hGpFq` を正本にした小型操作メニュー。 */
export default function ActionMenu({ open, items, note, onClose, ariaLabel = '操作', inline = false }: ActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    if (!inline) menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [inline, onClose, open])

  if (!open) return null

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
    if (buttons.length === 0) return
    event.preventDefault()
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length
    buttons[next].focus()
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className={`${styles.menu} ${inline ? styles.inline : ''}`}
      onKeyDown={moveFocus}
      data-design-part="action-menu"
      data-design-node="hGpFq"
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.dividerBefore ? <hr className={styles.divider} /> : null}
          <button
            type="button"
            role="menuitem"
            className={`${styles.item} ${item.tone === 'danger' ? styles.danger : ''}`}
            disabled={item.disabled}
            onClick={() => { item.onSelect(); onClose() }}
          >
            {item.icon ? <span className={styles.icon} aria-hidden="true">{item.icon}</span> : null}
            {item.label}
          </button>
        </div>
      ))}
      {note ? <p className={styles.note}>{note}</p> : null}
    </div>
  )
}
