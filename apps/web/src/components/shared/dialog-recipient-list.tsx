import type { ReactNode } from 'react'
import TruncatedText from './truncated-text'
import { Th } from './table'
import styles from './dialog-recipient-list.module.css'

export type DialogRecipient = { id: string; name: string; role: string; channel: ReactNode }

/** 公開前の宛先を、名前・役割・届く方法の順に確認する。 */
export default function DialogRecipientList({ rows }: { rows: readonly DialogRecipient[] }) {
  return <table className={styles.table} aria-label="受け取る人" data-dialog-recipients>
    <thead className="sr-only"><tr><Th>名前</Th><Th>役割</Th><Th>届く方法</Th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      <td className={styles.name}><TruncatedText value={row.name} /></td>
      <td className={styles.role} title={row.role}>{row.role || '—'}</td>
      <td className={styles.channel}>{row.channel}</td>
    </tr>)}</tbody>
  </table>
}
