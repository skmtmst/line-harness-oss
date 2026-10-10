import React, { type HTMLAttributes, type ReactNode } from 'react'
import type { StatusBadgeTone } from './status-badge'
import styles from './status-pill.module.css'
import { normalizeStatusWord } from './status-words'

export type SupportStatus = 'unread' | 'in_progress' | 'on_hold' | 'resolved'
export const SUPPORT_STATUS_TONES: Record<SupportStatus, StatusBadgeTone> = {
  unread: 'danger', in_progress: 'warning', on_hold: 'neutral', resolved: 'success',
}

/** 状態は色の点と文字の両方で伝える。 */
export function StatusDot({ tone = 'neutral', color }: { tone?: StatusBadgeTone; color?: string | null }) {
  return <span className={styles.dot} data-tone={tone} style={color ? { backgroundColor: color } : undefined} aria-hidden="true" />
}

/** B-71③：対応状況は色の点・薄い地・濃い文字の丸い札。 */
export default function StatusPill({ children, tone = 'neutral', color, ...props }: Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'color' | 'className'> & {
  children: ReactNode
  tone?: StatusBadgeTone
  color?: string | null
}) {
  return <span className={styles.pill} {...props} data-tone={tone}>
    <StatusDot tone={tone} color={color} />
    <span className={styles.name}>{typeof children === 'string' ? normalizeStatusWord(children) : children}</span>
  </span>
}
