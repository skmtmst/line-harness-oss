import type { ReactNode } from 'react'
import styles from './label-pill.module.css'

/** 種類などの短い分類名。色は分類の印として添え、名前でも伝える。 */
export default function LabelPill({ children, color }: { children: ReactNode; color?: string }) {
  return <span className={styles.pill}>
    <span className={styles.dot} style={color ? { backgroundColor: color } : undefined} aria-hidden="true" />
    <span>{children}</span>
  </span>
}
