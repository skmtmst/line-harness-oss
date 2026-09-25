import React, { type HTMLAttributes, type ReactNode } from 'react'
import HelpTip from './help-tip'
import styles from './status-badge.module.css'

export type StatusBadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

/** 色だけに頼らず、必ず状態を文字で伝える共通バッジ。 */
export default function StatusBadge({
  children,
  tone = 'neutral',
  size = 'default',
  className,
  help,
  helpLabel,
  helpHref,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  children: ReactNode
  tone?: StatusBadgeTone
  size?: 'default' | 'compact'
  /**
   * 札の意味（例：審査中・保留・期限切れの違い）。札のすぐ右の「？」へ入れる
   * （★V7・§2-1b）。札の列が並ぶ表では、見出しの「？」にまとめるのも可。
   */
  help?: ReactNode
  /** 「？」の見出し。省略時は札の文字。読み上げ名は「{見出し}の説明」。 */
  helpLabel?: string
  /** 長い説明がある場所。渡すと吹き出しに「くわしく」が出る。 */
  helpHref?: string
}) {
  const classes = [styles.badge, styles[tone], size === 'compact' ? styles.compact : null, className]
    .filter(Boolean)
    .join(' ')
  const hasHelp = help !== undefined && help !== null
  const heading = helpLabel ?? (typeof children === 'string' ? children : 'この状態')
  return (
    <span className={classes} data-design-node="xRvDB" {...props}>
      {children}
      {hasHelp ? (
        <HelpTip label={`${heading}の説明`}>
          {help}
          {helpHref ? <a href={helpHref}>くわしく</a> : null}
        </HelpTip>
      ) : null}
    </span>
  )
}
