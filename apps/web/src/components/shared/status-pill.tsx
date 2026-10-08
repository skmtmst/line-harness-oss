import React, { type HTMLAttributes, type ReactNode } from 'react'
import type { StatusBadgeTone } from './status-badge'
import styles from './status-pill.module.css'

export type SupportStatus = 'unread' | 'in_progress' | 'on_hold' | 'resolved'
export const SUPPORT_STATUS_TONES: Record<SupportStatus, StatusBadgeTone> = {
  unread: 'danger', in_progress: 'warning', on_hold: 'neutral', resolved: 'success',
}

/** 色は点だけに付け、状態は必ず文字でも伝える。 */
export function StatusDot({ tone = 'neutral', color }: { tone?: StatusBadgeTone; color?: string | null }) {
  return <span className={styles.dot} data-tone={tone} style={color ? { backgroundColor: color } : undefined} aria-hidden="true" />
}

/** オーナー決定 2026-10-08：対応状況は白地・薄い枠の丸い札。 */
export default function StatusPill({ children, tone = 'neutral', color, ...props }: Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'color' | 'className'> & {
  children: ReactNode
  tone?: StatusBadgeTone
  color?: string | null
}) {
  return <span className={styles.pill} {...props}>
    <StatusDot tone={tone} color={color} />
    <span className={styles.name}>{children}</span>
  </span>
}
