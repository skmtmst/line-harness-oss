import type { ReactNode } from 'react'
import styles from './dialog.module.css'

export function DialogFormRow({ children }: { children: ReactNode }) {
  return <div className={styles.formRow}>{children}</div>
}
