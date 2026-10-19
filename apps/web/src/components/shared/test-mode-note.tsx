import { PAYMENT_TEST_MODE_LABEL } from '@line-crm/shared'
import StatusBadge from './status-badge'
import styles from './test-mode-note.module.css'

/*
 * 試験モードの印。お金の数が出る所すべてに、決済が試験モードの間だけ置く。
 * 「試験モード」の札＋その場の言葉（例：本当の入金ではありません／本当の返金は起きません）。
 * 題の横など札だけ置く所は children={null}（FY8HC の「お支払いの記録」・T91bV の決済サービス）。
 */
export default function TestModeNote({ children = '本当の入金ではありません', size }: { children?: string | null; size?: 'default' | 'compact' }) {
  return (
    <span className={styles.root} data-shared-part="test-mode-note">
      <StatusBadge tone="warning" size={size}>{PAYMENT_TEST_MODE_LABEL}</StatusBadge>
      {children ? <span className={styles.text}>{children}</span> : null}
    </span>
  )
}
