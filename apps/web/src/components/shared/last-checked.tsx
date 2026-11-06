import { formatDateTime } from '@/lib/format'
import EmptyValue from './empty-value'
import styles from './last-checked.module.css'

/** 成功した時刻だけを受け取る。取得・失敗時の保持は呼ぶ側が担当する。 */
export default function LastChecked({ at, inSession = false, busy = false }: {
  at?: string | null
  inSession?: boolean
  busy?: boolean
}) {
  const text = formatDateTime(at, '')
  return <span className={styles.root} role="status">
    <span className={styles.value}>最後に確かめた時刻：{text || <EmptyValue kind="unknown" />}</span>
    {inSession && <span>{text ? '（この画面での確認）' : '（この画面ではまだ確認していません）'}</span>}
    {busy && <span>確認中…</span>}
  </span>
}
