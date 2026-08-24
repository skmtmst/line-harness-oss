'use client'

import React, { useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useOverlayFocus } from './overlay-utils'
import styles from './drawer.module.css'

export type DrawerDetail = { label: string; value: ReactNode }

export type DrawerProps = {
  open: boolean
  title: string
  description?: string
  dirty?: boolean
  busy?: boolean
  error?: string
  onClose: () => void
  children?: ReactNode
  details?: DrawerDetail[]
  footer?: ReactNode
  /** falseは参照画像と同じ面だけをページ内に描画する。 */
  modal?: boolean
}

/** Pencil V5 `VJKAT` を正本にした右詳細パネル。 */
export default function Drawer({
  open,
  title,
  description,
  dirty = false,
  busy = false,
  error,
  onClose,
  children,
  details,
  footer,
  modal = true,
}: DrawerProps) {
  const titleId = useId()
  const descriptionId = useId()
  const [mounted, setMounted] = useState(false)
  const panelRef = useOverlayFocus(open && modal, onClose, busy)

  useEffect(() => setMounted(true), [])
  if (!open) return null

  const panel = (
    <aside
      ref={panelRef}
      className={`${styles.panel} ${modal ? '' : styles.inline}`}
      role="dialog"
      aria-modal={modal || undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      data-dirty={dirty || undefined}
      tabIndex={-1}
      data-design-part="drawer"
      data-design-node="VJKAT"
    >
      <header className={`${styles.header} ${modal ? '' : styles.inlineHeader}`}>
        <div>
          <h2 id={titleId} className={`${styles.title} ${modal ? '' : styles.inlineTitle}`}>{title}{dirty ? ' *' : ''}</h2>
          {description ? <p id={descriptionId} className={styles.description}>{description}</p> : null}
        </div>
        <button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label="閉じる"><X aria-hidden="true" size={18} /></button>
      </header>
      <div className={`${styles.body} ${modal ? '' : styles.inlineBody}`}>
        {details ? <dl className={styles.rows}>{details.map((detail) => <div className={styles.row} key={detail.label}><dt>{detail.label}</dt><dd className={styles.rowValue}>{detail.value}</dd></div>)}</dl> : children}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </aside>
  )
  if (!modal) return panel
  const overlay = <div className={styles.overlay} role="presentation" onMouseDown={(event) => {
    if (!busy && event.target === event.currentTarget) onClose()
  }}>{panel}</div>
  return mounted && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay
}
