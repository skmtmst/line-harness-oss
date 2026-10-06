'use client'

/*
 * ★V8 リッチメニュー「まだ消せません」の窓（Pencil `yOyCg`）。
 *
 * 共通の Dialog（q3DPdz：頭・中身・下を別の段、幅560）とは形が違う
 * （幅600・1枚の面に 題→説明→理由の行→ボタン を間14で積む・下に線なし）ため、
 * 面はここで組む。フォーカスの移動・Esc・背景を止めるのは共通の useOverlayFocus。
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import IconButton from '@/components/shared/icon-button'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import styles from './blocked-dialog.module.css'

export type BlockedRow = {
  key: string
  text: string
  action: { label: string; onSelect: () => void } | null
}

export default function BlockedDeleteDialog({
  title,
  description,
  rows,
  busy,
  error,
  footer,
  onClose,
}: {
  title: string
  description: string
  rows: BlockedRow[]
  busy: boolean
  error: string | null
  footer: ReactNode
  onClose: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const panelRef = useOverlayFocus(mounted, onClose, busy)

  const overlay = (
    <div
      className={styles.overlay}
      role="presentation"
      data-design-node="yOyCg"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>{title}</h2>
          <IconButton aria-label="閉じる" title="閉じる" className={styles.close} onClick={onClose} disabled={busy}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
        <p id={descriptionId} className={styles.description}>{description}</p>
        <ol className={styles.rows}>
          {rows.map((row, index) => (
            <li key={row.key} className={styles.row}>
              <span className={styles.rowText}>{`${index + 1} ${row.text}`}</span>
              <span className={styles.spacer} aria-hidden="true" />
              {row.action ? (
                <button type="button" className={styles.rowAction} onClick={row.action.onSelect} disabled={busy}>
                  {row.action.label}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.footer}>{footer}</div>
      </div>
    </div>
  )
  return mounted && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay
}
