import type { ReactNode } from 'react'
import styles from './code-block.module.css'

/** ：貼り付けるコードの共通の面。長いコードは中だけ安全に送って読む。 */
export default function CodeBlock({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  return <pre className={styles.box} data-code-block data-wrap={wrap || undefined} tabIndex={0}><code>{children}</code></pre>
}
