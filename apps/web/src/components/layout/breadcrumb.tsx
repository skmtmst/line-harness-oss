import Link from 'next/link'
import styles from './breadcrumb.module.css'

export interface BreadcrumbItem {
  label: string
  href?: string
}

export default function Breadcrumb({ items, maxItems = 4 }: { items: BreadcrumbItem[]; maxItems?: number }) {
  const visible = items.length <= maxItems
    ? items
    : [items[0], { label: '…' }, ...items.slice(-(maxItems - 2))]

  return (
    <nav aria-label="パンくず" className={styles.root} data-design-node="R098Z">
      {visible.map((item, index) => {
        const current = index === visible.length - 1
        return (
          <span key={`${item.label}-${index}`} className="contents">
            {index > 0 ? <span aria-hidden="true" className={styles.separator}>›</span> : null}
            {item.href && !current ? (
              <Link href={item.href} className={`${styles.item} ${styles.link}`}>{item.label}</Link>
            ) : (
              <span className={`${styles.item} ${current ? styles.current : ''}`} aria-current={current ? 'page' : undefined}>
                {item.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
