'use client'

import { useId, type ReactNode } from 'react'
import Button from '@/components/shared/button'
import styles from './page-templates.module.css'

/** 詳細の本文と補助欄。狭い板では補助欄を畳み、操作は開いて使う。 */
export function DetailColumns({ children, aside, asideLabel, expanded, onExpandedChange }: {
  children: ReactNode
  aside: ReactNode
  asideLabel: string
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}) {
  const asideId = useId()
  return <div className={styles.detailColumns}>
    <div className={styles.detailColumnToggle}>
      <Button aria-expanded={expanded} aria-controls={asideId} onClick={() => onExpandedChange(!expanded)}>{asideLabel}</Button>
    </div>
    <div className={styles.detailColumnMain}>{children}</div>
    <aside id={asideId} className={styles.detailColumnAside} aria-label={asideLabel} data-expanded={expanded || undefined}>{aside}</aside>
  </div>
}
