import { useFieldContext } from './field-context'
import styles from './toggle.module.css'

/**
 * スイッチ。オン／オフを切り替える。
 *
 * `locked` は「消せない項目」。**オンのまま押せない**状態で描く。
 * オフに見せると、出ているのに消えていると読めてしまう。
 */
export default function Toggle({
  id,
  invalid,
  checked,
  locked,
  disabled,
  label,
  onChange,
  className,
}: {
  id?: string
  invalid?: boolean
  checked: boolean
  /** 消せない項目。オンのまま押せない。 */
  locked?: boolean
  /** 一時的に押せない（保存中など）。見た目のオン・オフはそのまま。 */
  disabled?: boolean
  /** 読み上げ用の名前。何のスイッチかを必ず渡す。 */
  label: string
  onChange?: (next: boolean) => void
  className?: string
}) {
  const field = useFieldContext()
  const bad = invalid || field?.invalid
  const on = locked || checked
  return (
    <button
      id={id}
      aria-invalid={bad || undefined}
      aria-describedby={field?.describedBy}
      style={bad ? { outline: '1px solid var(--color-danger)' } : undefined}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={locked || disabled}
      onClick={onChange ? () => onChange(!checked) : undefined}
      className={[styles.toggle, on && !locked && styles.on, locked && styles.locked, className]
        .filter(Boolean)
        .join(' ')}
    />
  )
}
