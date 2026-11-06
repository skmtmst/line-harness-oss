'use client'

import type { ReactNode } from 'react'
import styles from './form.module.css'

/** 閲覧のみの人に、選ぶ欄・時刻の欄の代わりに見せる値（押せない部品を置かない）。 */
export function ReadValue({ children, compact = false, label }: { children: ReactNode; compact?: boolean; label?: string }) {
  return <span className={styles.readValue} data-compact={compact || undefined} aria-label={label}>{children}</span>
}
