import Link from 'next/link'
import { Fragment } from 'react'
import styles from './breadcrumb.module.css'

export interface Crumb {
  label: string
  /** 省くと押せない文字として描く。最後の1つは必ず省く。 */
  href?: string
}

/**
 * パンくず。Pencil V5 の `WNfXv`。★V5 227枚で111回。
 *
 * 最後の1つが「いま開いている場所」。ここにリンクを張らない。
 */
export default function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="現在の場所" className={[styles.list, className].filter(Boolean).join(' ')}>
      {items.map((item, index) => {
        const last = index === items.length - 1
        return (
          <Fragment key={`${item.label}-${index}`}>
            {index > 0 ? <ChevronRight /> : null}
            {item.href && !last ? (
              <Link href={item.href} className={styles.link}>
                {item.label}
              </Link>
            ) : (
              <span className={styles.current} aria-current={last ? 'page' : undefined}>
                {item.label}
              </span>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

function ChevronRight() {
  return (
    <svg className={styles.separator} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
