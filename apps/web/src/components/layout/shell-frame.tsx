import type { ReactNode } from 'react'
import styles from './shell-frame.module.css'

/** zUg8S / Yw24X: 認証や取得を持たず、既存のメニュー・帯・中身を受ける外側。 */
export default function ShellFrame({ navigation, topBar, children, collapsed = false }: {
  navigation: ReactNode
  topBar: ReactNode
  children?: ReactNode
  collapsed?: boolean
}) {
  return (
    <div className={styles.shell}>
      <aside className={styles.navigation} data-collapsed={collapsed || undefined}>{navigation}</aside>
      <div className={styles.side}>
        <div className={styles.topBar}>{topBar}</div>
        <div className={styles.board}>{children}</div>
      </div>
    </div>
  )
}
