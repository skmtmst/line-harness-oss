import type { HTMLAttributes, ReactNode } from 'react'
import styles from './setup-step-row.module.css'

/** 初期設定の手順と選んだ機能を、同じ高さ・余白で並べる。 */
export function SetupStepList({ columns = 1, children, ...props }: HTMLAttributes<HTMLUListElement> & { columns?: 1 | 3; children: ReactNode }) {
  return <ul {...props} className={styles.list} data-setup-step-list data-columns={columns}>{children}</ul>
}

export function SetupStepRow({ done = false, next = false, children, ...props }: HTMLAttributes<HTMLLIElement> & { done?: boolean; next?: boolean; children: ReactNode }) {
  return <li {...props} className={styles.row} data-setup-step-row data-done={done ? '' : undefined} data-next={next ? '' : undefined}>{children}</li>
}

export function SetupStepLabel({ children, note, title, help }: { children: ReactNode; note?: string; title?: string; help?: ReactNode }) {
  return <span className={styles.text}><span className={styles.titleLine}><span className={styles.title} title={title} data-setup-step-label>{children}</span>{help ? <span className={styles.help} data-setup-step-help>{help}</span> : null}</span>{note ? <span className={styles.note} title={note}>{note}</span> : null}</span>
}
