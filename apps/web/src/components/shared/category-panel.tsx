'use client'
import styles from './category-panel.module.css'

/** スタイルなどの固定分類。フォルダを作る・変える操作を持たない。 */
export default function CategoryPanel({ heading = '分類', showHeading, rows, activeId, onSelect }: {
  heading?: string; showHeading?: boolean; rows: Array<{id:string;label:string;count:number|null}>; activeId:string; onSelect:(id:string)=>void
}) {
  return <nav className={styles.panel} aria-label={heading} data-shared-part="category-panel">
    {showHeading ? <p className={styles.heading}>{heading}</p> : null}
    {rows.map(row => <button type="button" key={row.id} className={styles.row} aria-current={row.id === activeId ? 'true' : undefined} onClick={() => onSelect(row.id)}>
      <span className={styles.label} title={row.label}>{row.label}</span>
      {row.count !== null ? <span className={styles.count}>{row.count}</span> : null}
    </button>)}
  </nav>
}
