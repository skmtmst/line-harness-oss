import styles from './toggle.module.css'

/**
 * スイッチ。オン／オフを切り替える。
 *
 * `locked` は「消せない項目」。**オンのまま押せない**状態で描く。
 * オフに見せると、出ているのに消えていると読めてしまう。
 */
export default function Toggle({
  checked,
  locked,
  label,
  onChange,
  className,
}: {
  checked: boolean
  /** 消せない項目。オンのまま押せない。 */
  locked?: boolean
  /** 読み上げ用の名前。何のスイッチかを必ず渡す。 */
  label: string
  onChange?: (next: boolean) => void
  className?: string
}) {
  const on = locked || checked
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={locked}
      onClick={onChange ? () => onChange(!checked) : undefined}
      className={[styles.toggle, on && !locked && styles.on, locked && styles.locked, className]
        .filter(Boolean)
        .join(' ')}
    />
  )
}
