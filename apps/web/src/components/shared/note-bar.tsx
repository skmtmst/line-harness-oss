import type { ReactNode } from 'react'
import HelpTip from './help-tip'
import styles from './note-bar.module.css'

export type NoteTone = 'info' | 'success' | 'warn' | 'danger'

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
  help,
  helpLabel,
  helpHref,
  children,
}: {
  tone?: NoteTone
  /** 帯の右に置く操作。 */
  action?: ReactNode
  className?: string
  /**
   * 読まなくても操作できる定義だけの補足。帯の文のすぐ右の「？」へ入れる
   * （★V7・§2-1b）。帯自体は残す。警告・失敗・操作の結果は入れない。
   */
  help?: ReactNode
  /** 「？」の見出し。省略時は「この案内」。 */
  helpLabel?: string
  /** 長い説明がある場所。渡すと吹き出しに「くわしく」が出る。 */
  helpHref?: string
  children: ReactNode
}) {
  const hasHelp = help !== undefined && help !== null
  return (
    <div className={[styles.note, styles[tone], className].filter(Boolean).join(' ')} role="note">
      {tone === 'info' || tone === 'success' ? <InfoIcon /> : <AlertIcon />}
      <span>
        {children}
        {hasHelp ? (
          <HelpTip label={`${helpLabel ?? 'この案内'}の説明`} moreHref={helpHref}>
            {help}
          </HelpTip>
        ) : null}
      </span>
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
