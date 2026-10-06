'use client'

/*
 * ★V8 リマインダの確かめる窓（Pencil `RwVo5` 一時停止・`VsSyu` 削除）。
 *
 * 共通の Dialog（q3DPdz：頭・中身・下を別の段、幅560）とは形が違う
 * （幅600・上から260・1枚の面に 題→説明→帯→ボタン を間14で積む・下に線なし）ため、
 * 面はここで組む（リッチメニューの yOyCg と同じ作り）。フォーカスの移動・Esc・
 * 背景を止めるのは共通の useOverlayFocus。
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { TriangleAlert, X } from 'lucide-react'
import IconButton from '@/components/shared/icon-button'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import styles from './sheet-dialog.module.css'

export default function SheetDialog({
  open,
  title,
  description,
  band,
  bandTone = 'warning',
  busy = false,
  error,
  destructive,
  actions,
  designNode,
  onClose,
}: {
  open: boolean
  title: string
  description: string
  /** 説明の下の帯（影響・注意）。 */
  band?: ReactNode
  bandTone?: 'warning' | 'danger'
  busy?: boolean
  error?: string
  /** 左端に離して置く危ない操作（削除）。無ければボタンは真ん中に並ぶ。 */
  destructive?: ReactNode
  /** 真ん中に並べる操作。実行がいちばん右。 */
  actions: ReactNode
  designNode?: string
  onClose: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const panelRef = useOverlayFocus(open && mounted, onClose, busy)
  if (!open) return null

  const overlay = (
    <div
      className={styles.overlay}
      role="presentation"
      data-design-node={designNode}
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role={destructive ? 'alertdialog' : 'dialog'}
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
        {band ? (
          <div className={styles.band} data-tone={bandTone}>
            <TriangleAlert size={16} aria-hidden="true" className={styles.bandIcon} />
            <div className={styles.bandText}>{band}</div>
          </div>
        ) : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {destructive ? (
          <div className={styles.footerSplit}>
            <div className={styles.footerLead}>{destructive}</div>
            <div className={styles.footerCenter}>{actions}</div>
            <div className={styles.footerLead} aria-hidden="true" />
          </div>
        ) : (
          <div className={styles.footer}>{actions}</div>
        )}
      </div>
    </div>
  )
  return mounted && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay
}
