'use client'

import { ArrowUpRight } from 'lucide-react'
import React, { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import styles from './action-menu.module.css'

export type ActionMenuItem = {
  id: string
  label: string
  icon?: ReactNode
  /**
   * 補足（★V7）。渡すと項目が2行・高さ52pxになる。
   * 例：「テンプレートを送る」＋「受信箱で選んで送ります」。
   */
  description?: string
  tone?: 'default' | 'danger'
  /**
   * 別画面へ行く項目（★V7）。右端に ↗ を出す。
   * 同じ画面の中の操作（モーダル・タブ切替）には付けない。
   */
  external?: boolean
  disabled?: boolean
  /**
   * #985 LAY-18: 押せない理由（使用中・公開中など）。無効な項目の下に
   * 小さく出す。理由が書けない操作は無効のまま黙って置かない。
   */
  disabledReason?: string
  dividerBefore?: boolean
  /**
   * 小さな見出し（★V7）。この項目の前に出す。
   * 同じ見出しを2回出さないのは呼ぶ側の責任。
   */
  sectionBefore?: string
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

/** Pencil ★V7 `xifuV` を正本にした小型操作メニュー（V5 `hGpFq` から移行）。 */
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
      data-design-node="xifuV"
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.dividerBefore ? <hr className={styles.divider} /> : null}
          {item.sectionBefore ? (
            <p className={styles.section} role="presentation">
              {item.sectionBefore}
            </p>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={`${styles.item} ${item.description || (item.disabled && item.disabledReason) ? styles.itemTall : ''} ${item.tone === 'danger' ? styles.danger : ''}`}
            disabled={item.disabled}
            title={item.label}
            onClick={() => { item.onSelect(); onClose() }}
          >
            {item.icon ? <span className={styles.icon} aria-hidden="true">{item.icon}</span> : null}
            <span className={styles.itemBody}>
              <span className={styles.label}>{item.label}</span>
              {item.description ? (
                <span className={styles.description}>{item.description}</span>
              ) : null}
              {item.disabled && item.disabledReason ? (
                <span className={styles.reason}>{item.disabledReason}</span>
              ) : null}
            </span>
            {item.external ? (
              <ArrowUpRight size={14} aria-hidden="true" className={styles.externalIcon} />
            ) : null}
          </button>
        </div>
      ))}
      {note ? <p className={styles.note}>{note}</p> : null}
    </div>
  )
}
