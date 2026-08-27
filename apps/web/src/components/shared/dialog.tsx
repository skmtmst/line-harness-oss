'use client'

import React, { useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayFocus } from './overlay-utils'
import styles from './dialog.module.css'

export type DialogProps = {
  open: boolean
  title: string
  description?: string
  tone?: 'default' | 'destructive'
  busy?: boolean
  error?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm?: () => void
  onCancel: () => void
  children?: ReactNode
  footer?: ReactNode
  /** 参照画像の固定比較やページ内プレビューで、背景を付けず面だけ表示する。 */
  modal?: boolean
  /** 入力項目が少ない窓では、V6 の 620px 幅へ寄せる。 */
  size?: 'standard' | 'compact'
  /** V6の編集窓のように、右上から閉じられる場合だけ表示する。 */
  showCloseButton?: boolean
}

/** Pencil V5 `J6x4Q` と重要操作 `H2S1T4` を1つにした共通ダイアログ。 */
export default function Dialog({
  open,
  title,
  description,
  tone = 'default',
  busy = false,
  error,
  confirmLabel = '保存する',
  cancelLabel = 'キャンセル',
  onConfirm,
  onCancel,
  children,
  footer,
  modal = true,
  size = 'standard',
  showCloseButton = false,
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const [mounted, setMounted] = useState(false)
  const panelRef = useOverlayFocus(open && modal, onCancel, busy)

  useEffect(() => setMounted(true), [])
  if (!open) return null

  const heading = (
    <>
      <h2 id={titleId} className={`${styles.title} ${tone === 'destructive' ? styles.destructiveTitle : styles.standardTitle}`}>{title}</h2>
      {description ? <p id={descriptionId} className={styles.description}>{description}</p> : null}
    </>
  )
  const panel = (
    <div
      ref={panelRef}
      className={`${styles.panel} ${styles.standardPanel} ${size === 'compact' ? styles.compactPanel : ''}`}
      role={tone === 'destructive' ? 'alertdialog' : 'dialog'}
      aria-modal={modal || undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      tabIndex={-1}
      data-design-part="dialog"
      data-design-node={tone === 'destructive' ? 'H2S1T4' : 'J6x4Q'}
    >
      {showCloseButton ? (
        <button
          type="button"
          className={styles.closeButton}
          aria-label="閉じる"
          disabled={busy}
          onClick={onCancel}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      ) : null}
      {tone === 'destructive' ? <div className={styles.callout} data-qa-dialog-callout>{heading}</div> : heading}
      {children ? <div className={styles.content}>{children}</div> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {footer ?? (
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.designButton} ${styles.cancel}`} onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          {onConfirm ? (
            <button type="button" className={`${styles.button} ${styles.designButton} ${tone === 'destructive' ? styles.danger : styles.confirm}`} onClick={onConfirm} disabled={busy}>
              {busy ? '処理中…' : confirmLabel}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )

  if (!modal) return panel
  const overlay = (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => {
      if (!busy && event.target === event.currentTarget) onCancel()
    }}>
      {panel}
    </div>
  )
  return mounted && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay
}
