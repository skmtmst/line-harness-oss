import React, { type HTMLAttributes, type ReactNode } from 'react'
import styles from './status-badge.module.css'

export type StatusBadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

/** 色だけに頼らず、必ず状態を文字で伝える共通バッジ。 */
export default function StatusBadge({
  children,
  tone = 'neutral',
  size = 'default',
  className,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  children: ReactNode
  tone?: StatusBadgeTone
  size?: 'default' | 'compact'
}) {
  const classes = [styles.badge, styles[tone], size === 'compact' ? styles.compact : null, className]
    .filter(Boolean)
    .join(' ')
  return <span className={classes} data-design-node="xRvDB" {...props}>{children}</span>
}
