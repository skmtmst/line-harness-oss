import type { ReactNode } from 'react'
import Link from './list-navigation'
import styles from './filter-link.module.css'

/** URLで分類を切り替える札。別タブ・再読込でも選んだ分類を保つ。 */
export default function FilterLink({ href, selected, children }: { href: string; selected: boolean; children: ReactNode }) {
  return <Link href={href} aria-current={selected ? 'true' : undefined} className={styles.chip}>{children}</Link>
}
