import type { ReactNode } from 'react'
import styles from './sticky-bar.module.css'

/**
 * 下部追従バー。作成・編集画面の最下段。Pencil V5 の `Ai3fq`。
 *
 * **保存はここにしか置かない。** ヘッダーにも置くと、どちらを押せば
 * よいか分からなくなる。
 *
 * ボタンは「やめる → 下書きに保存 → 実行」の順。実行がいちばん右。
 */
export default function StickyBar({
  status,
  actions,
  className,
}: {
  /** いまの状態。「下書き・最終保存 10:24」など。 */
  status: ReactNode
  actions: ReactNode
  className?: string
}) {
  return (
    <div className={[styles.bar, className].filter(Boolean).join(' ')}>
      <p className={styles.status}>{status}</p>
      <div className={styles.actions}>{actions}</div>
    </div>
  )
}
