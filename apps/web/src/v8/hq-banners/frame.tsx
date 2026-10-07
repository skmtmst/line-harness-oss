'use client'

/*
 * ★V8 バナー生成の窓の枠（W7Z57・AnwtH・I0w2e・B24oNg・rI5uh・UcBQ5）。
 *
 * 絵の窓は「余白 24 の1枚の面に、見出しの行（題＋閉じる）→ 4 下に説明 → 間 14 で中身 → 区切り線 → 真ん中にボタン」。
 * 共通の窓（Dialog）は見出しの行の上下の余白と説明の文字（13px）が違い、説明が 8 上・2行に折れて下の物が全部ずれる。
 * 共通の窓は変えず、同じ動き（フォーカスを閉じ込める・Esc と背景で閉じる・処理中は閉じない・本文を止める）を
 * 共通の `useOverlayFocus` で持たせた枠をここに置く。
 */
import { X } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import IconButton from '@/components/shared/icon-button'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import styles from './frame.module.css'

/** 窓の大きさと上からの位置（絵ごと）。値は globals.css の `--tpl-hb-dialog-*`。 */
export type BannerDialogKind = 'create' | 'upload' | 'confirm' | 'detail' | 'reference'

export default function BannerDialogFrame({
  open,
  kind,
  title,
  description,
  onClose,
  busy = false,
  error,
  actions,
  actionsAlign = 'center',
  designNode,
  role = 'dialog',
  children,
}: {
  open: boolean
  kind: BannerDialogKind
  title: string
  description?: ReactNode
  onClose: () => void
  busy?: boolean
  error?: string
  /** 区切り線の下のボタン。渡さなければ線も出さない。 */
  actions?: ReactNode
  /** ボタンの並び。絵は真ん中（確かめる窓・作る窓）か、左と右に分ける（画像の詳細）。 */
  actionsAlign?: 'center' | 'split'
  designNode: string
  /** 危ない操作の確かめは alertdialog。 */
  role?: 'dialog' | 'alertdialog'
  children?: ReactNode
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
      data-kind={kind}
      data-design-node={designNode}
      onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <div className={styles.head}>
          <div className={styles.titleRow}>
            <h2 id={titleId} className={styles.title}>{title}</h2>
            <IconButton aria-label="閉じる" title="閉じる" onClick={onClose} disabled={busy}>
              <X aria-hidden="true" className={styles.closeIcon} />
            </IconButton>
          </div>
          {description ? <p id={descriptionId} className={styles.description}>{description}</p> : null}
        </div>
        {children}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {actions ? <div className={actionsAlign === 'split' ? `${styles.actions} ${styles.actionsSplit}` : styles.actions}>{actions}</div> : null}
      </div>
    </div>
  )
  return mounted && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay
}
