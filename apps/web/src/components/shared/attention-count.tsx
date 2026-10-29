import StatusAction from './status-action'
import StatusBadge from './status-badge'
import styles from './attention-count.module.css'

/** 困りごとの数。急ぐものだけ赤、0件には操作を置かない。 */
export function AttentionCount({ value, urgent = false, label, onClick }: { value: number; urgent?: boolean; label: string; onClick: () => void }) {
  if (value === 0) return <span className={styles.none} aria-label="なし">—</span>
  if (urgent) return <StatusAction aria-label={label} onClick={onClick}><StatusBadge tone="danger">{`${value} 件`}</StatusBadge></StatusAction>
  return <button type="button" className={styles.count} aria-label={label} onClick={onClick}>{`${value} 件`}</button>
}
