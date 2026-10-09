'use client'

import { useContext, useEffect, useId, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import IconButton from './icon-button'
import { OverlayDepthContext, useOverlayFocus } from './overlay-utils'
import styles from './source-picker-dialog.module.css'

/** テンプレート・アカウントを選ぶ窓の共通の外側。大きさと頭、焦点、閉じ方を揃える。 */
export default function SelectionDialog({ title, description, search, initialFocusRef, busy = false, error, designNode, footer, children, onCancel }: {
  title: string; description: string; search: ReactNode
  initialFocusRef?: RefObject<HTMLInputElement | null>
  busy?: boolean; error?: string; designNode?: string
  footer: ReactNode; children: ReactNode; onCancel: () => void
}) {
  const id = useId()
  const depth = useContext(OverlayDepthContext)
  const [mounted, setMounted] = useState(false)
  const panelRef = useOverlayFocus(mounted, onCancel, busy, initialFocusRef ? () => initialFocusRef.current : undefined)
  useEffect(() => setMounted(true), [])
  return <OverlayDepthContext.Provider value={depth + 1}>{mounted ? createPortal(
    <div className={styles.overlay} onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel() }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy || undefined} tabIndex={-1} className={styles.panel} data-design-node={designNode}>
        <header className={styles.header}>
          <div className={styles.heading}><h2 id={`${id}-title`}>{title}</h2><p id={`${id}-description`}>{description}</p></div>
          {search}
          <IconButton aria-label="閉じる" title="閉じる" disabled={busy} onClick={onCancel}><X size={18} aria-hidden /></IconButton>
        </header>
        {children}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <footer className={styles.footer}>{footer}</footer>
      </div>
    </div>, document.body) : null}</OverlayDepthContext.Provider>
}
