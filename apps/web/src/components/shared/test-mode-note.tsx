import StatusBadge from './status-badge'
import styles from './test-mode-note.module.css'

/*
 * 試験モードの印（B-338）。お金の数が出る所すべてに、決済が試験モードの間だけ置く。
 * 「試験モード」の札＋その場の言葉（例：本当の入金ではありません／本当の返金は起きません）。
 */
export default function TestModeNote({ children = '本当の入金ではありません' }: { children?: string }) {
  return (
    <span className={styles.root} data-shared-part="test-mode-note">
      <StatusBadge tone="warning">試験モード</StatusBadge>
      <span className={styles.text}>{children}</span>
    </span>
  )
}
