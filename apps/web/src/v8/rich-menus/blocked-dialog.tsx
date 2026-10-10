'use client'

/*
 * ★V8 リッチメニュー「まだ消せません」の窓（Pencil `yOyCg`）。
 *
 * 共通の Dialog（q3DPdz：頭・中身・下を別の段、幅560）とは形が違う
 * （幅600・1枚の面に 題→説明→理由の行→ボタン を間14で積む・下に線なし）ため、
 * 面はここで組む。フォーカスの移動・Esc・背景を止めるのは共通の useOverlayFocus。
 */
import { type ReactNode } from 'react'
import Dialog from '@/components/shared/dialog'
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
  return <Dialog open title={title} description={description} onCancel={onClose} busy={busy} error={error ?? undefined}
    tone="destructive" confirmation designLayout="stacked" designWidth={720} designNode="yOyCg" footer={footer} footerAlign="center">
    <ol className={styles.rows}>{rows.map((row, index) => <li key={row.key} className={styles.row}>
      <span className={styles.rowText}>{`${index + 1} ${row.text}`}</span><span className={styles.spacer} aria-hidden="true" />
      {row.action ? <button type="button" className={styles.rowAction} onClick={row.action.onSelect} disabled={busy}>{row.action.label}</button> : null}
    </li>)}</ol>
  </Dialog>
}
