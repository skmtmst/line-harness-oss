import type { ReactNode } from 'react'
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
  invalid = false,
  describedBy,
  size = 'regular',
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 選択肢の名前（印＋名前のように、文字の前に印を置くときは要素で渡す） */
  title: ReactNode
  /** 補足（任意） */
  note?: React.ReactNode
  disabled?: boolean
  /** 必須の選択が足りないときだけ、共通の誤りの色を出す。 */
  invalid?: boolean
  describedBy?: string
  /**
   * 箱の大きさ。既定は高さ 68・余白 14。
   * `'compact'` は高さ 56・左右 12・間 10・角丸 10・題 13/600・補足 11（★V8 統括の一括配信「送るアカウント」J5DH6o）。
   * 3つ横に並べる小さな選択肢に使う。渡したときだけ効き、既定の見た目は変えない。
   */
  size?: 'regular' | 'compact'
  className?: string
}) {
  return (
    <label
      className={[
        styles.card,
        checked ? styles.checked : null,
        disabled ? styles.disabled : null,
        invalid ? styles.invalid : null,
        size === 'compact' ? styles.compact : null,
        className,
      ].filter(Boolean).join(' ')}
    >
      <span className={styles.boxWrap}>
        <input
          type="checkbox"
          className={styles.box}
          checked={checked}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
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
