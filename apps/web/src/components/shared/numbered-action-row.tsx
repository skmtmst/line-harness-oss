'use client'

import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import ConfirmDialog from './confirm-dialog'
import IconButton from './icon-button'
import styles from './numbered-action-row.module.css'

/** 実行順を番号で示す処理カード。既存の行内表示とは明示指定で使い分ける。 */
export default function NumberedActionRow({ number, title, summary, open, readOnly, onToggle, onMoveUp, onMoveDown, onRemove, reorderable, children }: {
  number: number
  title: string
  summary: string
  open: boolean
  readOnly: boolean
  reorderable: boolean
  onToggle: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onRemove?: () => void
  children: ReactNode
}) {
  const [removing, setRemoving] = useState(false)
  const content = <><span className={styles.number}>{number}</span><span className={styles.text}>
    <span className={styles.title}>{title}</span><span className={styles.summary} title={summary}>{summary}</span>
  </span></>
  return <div className={styles.card} data-action-row data-event-action-row data-action-appearance="numbered">
    <div className={styles.row}>
      {readOnly ? <div className={styles.content}>{content}</div> : <button type="button" className={styles.content} aria-expanded={open} onClick={onToggle}>{content}</button>}
      {readOnly ? null : <div className={styles.controls}>
        {reorderable ? <>
          <IconButton size="compact" aria-label={`${number}つ目の処理を上へ`} title={!onMoveUp ? '最初の処理です' : undefined} disabled={!onMoveUp} onClick={onMoveUp}><ArrowUp size={16} aria-hidden="true" /></IconButton>
          <IconButton size="compact" aria-label={`${number}つ目の処理を下へ`} title={!onMoveDown ? '最後の処理です' : undefined} disabled={!onMoveDown} onClick={onMoveDown}><ArrowDown size={16} aria-hidden="true" /></IconButton>
        </> : null}
        {onRemove ? <IconButton size="compact" aria-label={`${number}つ目の処理を削除する`} onClick={() => setRemoving(true)}><Trash2 size={16} aria-hidden="true" /></IconButton> : null}
      </div>}
    </div>
    {open && !readOnly ? <div className={styles.editor}>{children}</div> : null}
    <ConfirmDialog open={removing} title="行うことを削除しますか？" description={`${title}：${summary}`} confirmLabel="削除する" onCancel={() => setRemoving(false)} onConfirm={() => { setRemoving(false); onRemove?.() }} />
  </div>
}
