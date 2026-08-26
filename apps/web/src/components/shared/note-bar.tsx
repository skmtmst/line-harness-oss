import type { ReactNode } from 'react'
import styles from './note-bar.module.css'

export type NoteTone = 'info' | 'warn' | 'danger'

/**
 * 案内帯。「この画面は何をするところか」を一行で言う。
 *
 * **1画面に1本だけ。** 注意が要るときは `tone` を変えて差し替える。
 * 2本並べない。
 *
 * 一覧型・ボード型には必ず1本置く。作成型・詳細型には置かない
 * （右カラムの「つながる先」「気をつけること」が説明を担うため）。
 */
export default function NoteBar({
  tone = 'info',
  action,
  className,
  children,
}: {
  tone?: NoteTone
  /** 帯の右に置く操作。 */
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={[styles.note, styles[tone], className].filter(Boolean).join(' ')} role="note">
      {tone === 'info' ? <InfoIcon /> : <AlertIcon />}
      <span>{children}</span>
      {action ? <span className={styles.action}>{action}</span> : null}
    </div>
  )
}

function InfoIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M12 4l9 16H3l9-16z" strokeLinejoin="round" />
      <path d="M12 10v4M12 17h.01" strokeLinecap="round" />
    </svg>
  )
}
