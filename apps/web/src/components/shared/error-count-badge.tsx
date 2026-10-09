import styles from './error-count-badge.module.css'

/**
 * 隠れた所の誤りの数（B-139）。カード・タブ・閉じた段の札の右に置き、
 * 「この中に直す欄がある」ことを赤い丸で知らせる。0 のときは描かない。
 *
 * 数は `useFormErrors().countIn(束)` から渡す（保存を押すまでは 0）。
 */
export function ErrorCountBadge({ count, label }: { count: number; label?: string }) {
  if (count <= 0) return null
  return (
    <span className={styles.badge} data-design-part="error-count-badge" aria-label={`${label ? `${label}に` : ''}直す欄が${count}か所`} role="img">
      {count}
    </span>
  )
}

export default ErrorCountBadge
