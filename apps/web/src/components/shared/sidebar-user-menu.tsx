'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import ActionMenu, { type ActionMenuItem } from './action-menu'
import styles from '@/components/hq/account-menu.module.css'

/** 左下の本人カード。本人の取得と許可された行き先は呼び元が持つ。 */
export default function SidebarUserMenu({ name, role, items, collapsed = false, pathname }: {
  name: string
  role: string
  items: ActionMenuItem[]
  collapsed?: boolean
  pathname: string
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => setOpen(false), [pathname, collapsed])
  return (
    <div className={styles.root} data-shared-part="sidebar-user-menu" data-collapsed={collapsed ? '' : undefined}>
      <button ref={trigger} type="button" className={styles.trigger}
        aria-label="自分のメニュー" aria-haspopup="menu" aria-expanded={open} title={name}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
        }}>
        <span className={styles.face} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || '—'}</span>
        <span className={styles.text} aria-hidden="true"><span className={styles.name}>{name}</span><span className={styles.role}>{role}</span></span>
        <ChevronsUpDown className={styles.chevron} aria-hidden="true" />
      </button>
      <ActionMenu open={open} items={items} anchorRef={trigger} ariaLabel="自分の操作" onClose={() => setOpen(false)} />
    </div>
  )
}
