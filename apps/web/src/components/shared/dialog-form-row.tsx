import type { HTMLAttributes, ReactNode } from 'react'
import styles from './dialog.module.css'
import rows from './dialog-content-row.module.css'

export function DialogFormRow({ children }: { children: ReactNode }) {
  return <div className={styles.formRow}>{children}</div>
}

/** 窓内のチェック・未設定情報の行。選択状態で面の色は変えない。 */
export function DialogContentRow({ children, tone, align, size, ...props }: { children: ReactNode; tone?: 'muted'; align?: 'start'; size?: 'account' } & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>) {
  return <div {...props} className={rows.row} data-dialog-content-row data-tone={tone} data-align={align} data-size={size}>{children}</div>
}
