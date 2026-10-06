import type { HTMLAttributes } from 'react'
import styles from './route-badge.module.css'

/** V8 HNps2: delivery channel, without implying a status. */
export default function RouteBadge({ children, ...props }: Omit<HTMLAttributes<HTMLSpanElement>, 'className'>) {
  return <span {...props} className={styles.root}>{children}</span>
}
