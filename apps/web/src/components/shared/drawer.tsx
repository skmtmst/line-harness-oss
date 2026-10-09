'use client'

import React, { useContext, useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { OverlayDepthContext, useOverlayFocus, useV8Leave } from './overlay-utils'
import styles from './drawer.module.css'
import Dialog from './dialog'
import { useFormInputDirty } from './form-input-dirty'
import { useOverlayDiscard } from './overlay-discard'

export type DrawerDetail = { label: string; value: ReactNode }

export type DrawerProps = {
  open: boolean
  title: string
  titleAccessory?: ReactNode
  description?: ReactNode
  dirty?: boolean
  busy?: boolean
  error?: string
  onClose: () => void
  children?: ReactNode
  details?: DrawerDetail[]
  footer?: ReactNode
  /** falseは参照画像と同じ面だけをページ内に描画する。 */
  modal?: boolean
  /**
   * 幅。省くと既定（660）。'narrow' は 480（E-2 電話予約 svUTk）。
   * 'editor' は 540 の編集の引き出し（ダッシュボード編集 mcOqK：頭 16/20・閉じるは枠つき 30・
   * 中 12/20・下 14/20・開くのは 200ms）。v8 だけで効く。
   */
  width?: 'narrow' | 'editor' | 'order' | 'composer'
  /** V8 の板ごとの幅。省くと既定の幅。 */
  designWidth?: number
  /** 620幅の紹介者の板など、全体に同じ余白がある型。 */
  layout?: 'inset'
  /** 題に状態の札を添える板。閉じる操作は共通のまま。 */
  heading?: ReactNode
  /** 頭の題の行の下に置くもの（タブ・説明の1行）。渡したときだけ頭を縦に積む。 */
  toolbar?: ReactNode
  /** 下の帯（footer）のすぐ上に置く知らせ（保存の失敗など）。中身の帯は呼び出し側の Notice。 */
  band?: ReactNode
}

/** Pencil V5 `VJKAT` を正本にした右詳細パネル。 */
export default function Drawer({
  open,
  title,
  titleAccessory,
  description,
  dirty,
  busy = false,
  error,
  onClose,
  children,
  details,
  footer,
  modal = true,
  width,
  designWidth,
  layout,
  heading,
  toolbar,
  band,
}: DrawerProps) {
  const formInput = useFormInputDirty(open)
  const isDirty = dirty ?? formInput.dirty
  const discard = useOverlayDiscard(open, isDirty, busy, onClose)
  const depth = useContext(OverlayDepthContext)
  const titleId = useId()
  const descriptionId = useId()
  const [mounted, setMounted] = useState(false)
  const panelRef = useOverlayFocus<HTMLElement>(open && modal, discard.requestClose, busy)
  /* ★V8 仕上げ（M10）：閉じるときは逆再生してから外す（v8 のみ）。 */
  const leaving = useV8Leave(open)

  useEffect(() => setMounted(true), [])
  if (!open && !leaving) return null

  const titleBlock = (
    <div>
      <div className={titleAccessory ? styles.titleRow : undefined}><h2 id={titleId} className={`${styles.title} ${modal ? '' : styles.inlineTitle}`}>{heading ?? title}{isDirty ? ' *' : ''}</h2>{titleAccessory}</div>
      {description ? <p id={descriptionId} className={styles.description}>{description}</p> : null}
    </div>
  )
  const closeButton = <button type="button" className={styles.close} onClick={discard.requestClose} disabled={busy} aria-label="閉じる"><X aria-hidden="true" size={18} /></button>

  const panel = (
    <aside
      ref={(element) => { panelRef.current = element; formInput.ref.current = element }}
      onChangeCapture={formInput.onChangeCapture}
      onInputCapture={formInput.onChangeCapture}
      onClickCapture={formInput.onClickCapture}
      className={`${styles.panel} ${modal ? '' : styles.inline}`}
      role="dialog"
      aria-modal={modal || undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      data-dirty={isDirty || undefined}
      data-width={width}
      data-layout={layout}
      data-design-width={designWidth ? '' : undefined}
      style={designWidth ? { '--drawer-design-width': `${designWidth}px` } as CSSProperties : undefined}
      tabIndex={-1}
      data-closing={leaving || undefined}
      data-design-part="drawer"
      data-design-node="VJKAT"
    >
      {toolbar ? (
        <header className={`${styles.header} ${styles.headerStack}`}>
          <div className={styles.headerRow}>
            {titleBlock}
            {closeButton}
          </div>
          {toolbar}
        </header>
      ) : (
        <header className={`${styles.header} ${modal ? '' : styles.inlineHeader}`}>
          {titleBlock}
          {closeButton}
        </header>
      )}
      <div className={`${styles.body} ${modal ? '' : styles.inlineBody}`}>
        {details ? <dl className={styles.rows}>{details.map((detail) => <div className={styles.row} key={detail.label}><dt>{detail.label}</dt><dd className={styles.rowValue}>{detail.value}</dd></div>)}</dl> : children}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {band ? <div className={styles.band}>{band}</div> : null}
      {footer ? <footer className={styles.footer} onClickCapture={(event) => {
        const button = (event.target as Element).closest?.('button')
        if (isDirty && button && /^(閉じる|キャンセル)$/.test(button.textContent?.trim() ?? '')) {
          event.preventDefault(); event.stopPropagation(); discard.requestClose()
        }
      }}>{footer}</footer> : null}
    </aside>
  )
  const discardDialog = discard.confirming ? <Dialog open title="入力を破棄しますか？" description="保存していない入力が消えます。" primaryAction="cancel" cancelLabel="編集を続ける" confirmLabel="破棄する" onCancel={discard.continueEditing} onConfirm={discard.discard} busy={busy} confirmation compact /> : null
  if (!modal) return <OverlayDepthContext.Provider value={depth + 1}>{panel}{discardDialog}</OverlayDepthContext.Provider>
  const overlay = <div className={styles.overlay} role="presentation" data-closing={leaving || undefined} onMouseDown={(event) => {
    if (!busy && event.target === event.currentTarget) discard.requestClose()
  }}>{panel}</div>
  return <OverlayDepthContext.Provider value={depth + 1}>{discardDialog}{mounted && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}</OverlayDepthContext.Provider>
}
