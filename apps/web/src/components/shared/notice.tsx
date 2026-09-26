'use client'

import type { HTMLAttributes, ReactNode } from 'react'
import { CircleAlert, CircleCheck, CircleHelp, TriangleAlert, X } from 'lucide-react'
import HelpTip from './help-tip'
import styles from './notice.module.css'

/**
 * 帯（Notice）の種類。★V7 共通部品その2 §1 の4つ。
 *
 * - `info` 案内（青）／`success` うまくいった（緑）
 * - `warn` 注意（黄）／`danger` 危険（赤）
 *
 * `validation` と `error` は V5 時代の呼び名。同じ見た目（warn・danger）
 * として残してある。新しく書くときは4つの名前を使う。
 */
export type NoticeTone = 'info' | 'success' | 'warn' | 'danger' | 'validation' | 'error'

type CanonicalTone = 'info' | 'success' | 'warn' | 'danger'

const CANONICAL: Record<NoticeTone, CanonicalTone> = {
  info: 'info',
  success: 'success',
  warn: 'warn',
  danger: 'danger',
  validation: 'warn',
  error: 'danger',
}

const NODE_BY_TONE: Partial<Record<CanonicalTone, string>> = {
  success: 'ApbSZ',
  warn: 'zPRvi',
  danger: 'I5rKbM',
}

const ICON_BY_TONE: Record<CanonicalTone, typeof CircleCheck> = {
  info: CircleHelp,
  success: CircleCheck,
  warn: TriangleAlert,
  danger: CircleAlert,
}

export type NoticeProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  tone: NoticeTone
  /** 本文（1〜2文）。`children` があるときはそちらが勝つ。 */
  message?: string
  children?: ReactNode
  /** 帯の右に置く操作。1つまで。 */
  action?: ReactNode
  /** 閉じる印を出す。押すと呼ばれる。 */
  onClose?: () => void
  /**
   * 読まなくても操作できる定義だけの補足。文のすぐ右の「？」へ入れる
   * （★V7・§2-1b）。警告・失敗・操作の結果は入れない。
   */
  help?: ReactNode
  /** 「？」の見出し。省略時は「この案内」。 */
  helpLabel?: string
  /** 長い説明がある場所。渡すと吹き出しに「くわしく」が出る。 */
  helpHref?: string
}

/**
 * 帯（Notice）。`note-bar` と1本化した正本。見た目は CSS が持つ。
 *
 * 一時的な知らせ（「保存しました」など）はここに置かず Toast
 *（`./toast` の `notifyToast`）へ送る。帯は読み直しても残る内容だけ。
 */
export default function Notice({
  tone,
  message,
  children,
  action,
  onClose,
  className,
  help,
  helpLabel,
  helpHref,
  ...props
}: NoticeProps) {
  const canonical = CANONICAL[tone]
  const Icon = ICON_BY_TONE[canonical]
  const node = NODE_BY_TONE[canonical]
  const hasHelp = help !== undefined && help !== null
  return (
    <div
      {...props}
      className={[styles.notice, styles[canonical], className].filter(Boolean).join(' ')}
      role={canonical === 'danger' ? 'alert' : 'note'}
      data-design-part="notice"
      data-design-node={node}
    >
      <Icon className={styles.icon} aria-hidden="true" size={15} />
      <span className={styles.message}>
        {children ?? message}
        {hasHelp ? (
          <HelpTip label={`${helpLabel ?? 'この案内'}の説明`}>
            {help}
            {helpHref ? <a href={helpHref}>くわしく</a> : null}
          </HelpTip>
        ) : null}
      </span>
      {action ? <span className={styles.action}>{action}</span> : null}
      {onClose ? <button type="button" className={styles.close} onClick={onClose} aria-label="通知を閉じる"><X aria-hidden="true" size={16} /></button> : null}
    </div>
  )
}
