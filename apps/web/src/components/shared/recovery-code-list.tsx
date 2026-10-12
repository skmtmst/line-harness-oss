import Card from './card'
import styles from './recovery-code-list.module.css'

/** One-time recovery-code display. Values are supplied from component memory only. */
export default function RecoveryCodeList({ codes }: { codes: string[] }) {
  return <Card frame="inset" surface="inset" padding="compact"><ul className={styles.list} aria-label="8個の回復コード">{codes.map(code => <li key={code}>{code}</li>)}</ul></Card>
}
