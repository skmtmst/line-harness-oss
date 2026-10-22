'use client'

import { useRef, type ReactNode } from 'react'
import MenuPortal from './menu-portal'
import styles from './menu-portal.module.css'
import selectStyles from './select-menu.module.css'

/** 絞り込みの浮く面。画面は入力と操作を渡し、位置・開閉・焦点は共通に任せる。 */
export function FilterPopover({ open, onClose, label, trigger, children, actions }: {
  open: boolean; onClose: () => void; label: string
  trigger: ReactNode; children: ReactNode; actions: ReactNode
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  return <>
    <span ref={anchor}>{trigger}</span>
    <MenuPortal open={open} getAnchor={() => anchor.current?.querySelector('button') ?? null} onClose={onClose} align="start" focusPanel className={`${selectStyles.surface} ${styles.filterSurface}`}>
      <div role="dialog" aria-label={label} className={styles.panel}>
        <p className={styles.heading}>{label}</p>
        {children}
        <div className={styles.actions}>{actions}</div>
      </div>
    </MenuPortal>
  </>
}
