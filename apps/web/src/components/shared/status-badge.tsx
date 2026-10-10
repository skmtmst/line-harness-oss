import React, { type HTMLAttributes, type ReactNode } from 'react'
import { statusLabel, type StandardStatus } from '@/lib/status-labels'
import HelpTip from './help-tip'
import TruncatedText from './truncated-text'
import styles from './status-badge.module.css'

export type StatusBadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

/** 色だけに頼らず、必ず状態を文字で伝える共通バッジ。 */
export default function StatusBadge({
  children,
  status,
  tone = 'neutral',
  size = 'default',
  className,
  help,
  helpLabel,
  helpHref,
  dot = true,
  surface = 'tinted',
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  children?: ReactNode
  status?: StandardStatus
  tone?: StatusBadgeTone
  size?: 'default' | 'compact' | 'micro' | 'annotation' | 'dining'
  /** 選んだ顧客の連携情報（rm92Y）だけ白地にする。 */
  surface?: 'tinted' | 'white'
  /**
   * 札の意味（例：審査中・保留・期限切れの違い）。札のすぐ右の「？」へ入れる
   * （★V7・§2-1b）。札の列が並ぶ表では、見出しの「？」にまとめるのも可。
   */
  help?: ReactNode
  /** 「？」の見出し。省略時は札の文字。読み上げ名は「{見出し}の説明」。 */
  helpLabel?: string
  /** 長い説明がある場所。渡すと吹き出しに「くわしく」が出る。 */
  helpHref?: string
  /**
   * ★V8 の色の点。既定は出す。「変わる」のように状態ではなく変化の印として使う札は false
   * （絵 `M4jS9` の「変わる」は点なしの札）。
   */
  dot?: boolean
}) {
  const label = status ? statusLabel(status) : typeof children === 'string' ? statusLabel(children) : children
  const classes = [styles.badge, styles[tone], size === 'compact' ? styles.compact : size === 'micro' ? styles.micro : size === 'annotation' ? styles.annotation : null, dot ? null : styles.noDot, className]
    .filter(Boolean)
    .join(' ')
  const hasHelp = help !== undefined && help !== null
  const heading = helpLabel ?? (typeof label === 'string' ? label : 'この状態')
  return (
    <span className={classes} data-size={size} data-tone={tone} data-design-node="xRvDB" data-surface={surface} {...props}>
      {typeof label === 'string' ? <TruncatedText value={label} /> : label}
      {hasHelp ? (
        <HelpTip label={`${heading}の説明`}>
          {help}
          {helpHref ? <a href={helpHref}>くわしく</a> : null}
        </HelpTip>
      ) : null}
    </span>
  )
}
