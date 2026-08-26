import Link from 'next/link'
import type { ReactNode } from 'react'
import styles from './tabs.module.css'

export interface TabItem {
  /** タブの見出し。 */
  label: string
  /** 押したときの行き先。省くとボタンとして描く。 */
  href?: string
  /** 見出しの右に出す数。0 も出す（「0件ある」は情報なので隠さない）。 */
  count?: number
  /** いま開いているタブ。 */
  current?: boolean
  disabled?: boolean
  onClick?: () => void
}

/**
 * ページ内タブ。Pencil V5 の `VPn1F`（選択中）／`ISA1Q`（通常）。
 *
 * ★V5 227枚で 278回。共通メニューの次に多い部品。
 *
 * 形と色はここが持つ。**幅は持たない**。
 */
export function Tabs({ items, className }: { items: TabItem[]; className?: string }) {
  return (
    <nav className={[styles.list, className].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <Tab key={item.label} {...item} />
      ))}
    </nav>
  )
}

function Tab({ label, href, count, current, disabled, onClick }: TabItem) {
  const classes = [styles.tab, current && styles.current].filter(Boolean).join(' ')
  const body: ReactNode = (
    <>
      {label}
      {count === undefined ? null : <span className={styles.count}>{count}</span>}
    </>
  )

  if (href && !current && !disabled) {
    return (
      <Link href={href} className={classes} aria-current={current ? 'page' : undefined}>
        {body}
      </Link>
    )
  }

  return (
    <button
      type="button"
      className={classes}
      aria-current={current ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      onClick={onClick}
      disabled={disabled || (current && !onClick)}
    >
      {body}
    </button>
  )
}
