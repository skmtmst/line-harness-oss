import styles from './check-card.module.css'

/**
 * チェックのカード（Pencil ★V8 `w6uYMd`・`RRxK5`）。
 *
 * 「いくつか選ぶ」選択肢をカードで出す共通部品。radio-card と同じく
 * 本物の input[type=checkbox] を使い、押せる範囲はカード全体。
 * 選ぶと箱が緑に染まり、白いチェックが左下から右上へ描かれる（120ms）。
 */
export default function CheckCard({
  checked,
  onChange,
  title,
  note,
  disabled = false,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 選択肢の名前 */
  title: string
  /** 補足（任意） */
  note?: React.ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <label
      className={[
        styles.card,
        checked ? styles.checked : null,
        disabled ? styles.disabled : null,
        className,
      ].filter(Boolean).join(' ')}
    >
      <span className={styles.boxWrap}>
        <input
          type="checkbox"
          className={styles.box}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <svg viewBox="0 0 12 12" className={styles.mark} aria-hidden="true">
          <path d="M2.6 6.4 4.9 8.8 9.4 3.2" />
        </svg>
      </span>
      <span className={styles.body}>
        <span className={styles.title}>{title}</span>
        {note ? <span className={styles.note}>{note}</span> : null}
      </span>
    </label>
  )
}
