import type { ReactNode } from 'react'
import styles from './customer-info-panel.module.css'

/** 顧客情報の読み取り用の行。編集の状態と保存は呼び出し元が持つ。 */
export function CustomerInfoRows({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return <dl className={styles.rows}>{rows.map(({ label, value }) => <div className={styles.row} key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}
