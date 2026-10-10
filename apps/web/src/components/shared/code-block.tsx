import type { ReactNode } from 'react'
import styles from './code-block.module.css'

/** B-202：貼り付けるコードの共通の面。長いコードは中だけ安全に送って読む。 */
export default function CodeBlock({ children }: { children: ReactNode }) {
  return <pre className={styles.box} data-code-block tabIndex={0}><code>{children}</code></pre>
}
