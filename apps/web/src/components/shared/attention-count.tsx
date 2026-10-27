import StatusBadge from './status-badge'
import styles from './attention-count.module.css'

/** 困りごとの数。急ぐものだけ赤、0件には操作を置かない。 */
export function AttentionCount({ value, urgent = false, label, onClick }: { value: number; urgent?: boolean; label: string; onClick: () => void }) {
  return value === 0 ? <span className={styles.none} aria-label="なし">—</span> : <button type="button" className={styles.count} aria-label={label} onClick={onClick}>{urgent ? <StatusBadge tone="danger">{`${value} 件`}</StatusBadge> : `${value} 件`}</button>
}
