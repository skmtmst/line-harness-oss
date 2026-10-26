import { useId, type ReactNode } from 'react'
import { joinDescribedBy, useFieldContext } from './field-context'
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
  indeterminate = false,
  locked,
  disabled,
  label,
  labelledBy,
  describedBy,
  onChange,
  className,
}: {
  id?: string
  invalid?: boolean
  checked: boolean
  /** 一部だけオンのまとまり。押すと全部オンにする。 */
  indeterminate?: boolean
  /** 消せない項目。オンのまま押せない。 */
  locked?: boolean
  /** 一時的に押せない（保存中など）。見た目のオン・オフはそのまま。 */
  disabled?: boolean
  /** 読み上げ用の名前。何のスイッチかを必ず渡す。 */
  label: string
  labelledBy?: string
  describedBy?: string
  onChange?: (next: boolean) => void
  className?: string
}) {
  const field = useFieldContext()
  const bad = invalid || field?.invalid
  const on = locked || checked
  return (
    <button
      id={id ?? field?.controlId}
      aria-invalid={bad || undefined}
      aria-describedby={joinDescribedBy(describedBy, field?.describedBy)}
      style={bad ? { outline: '1px solid var(--color-danger)' } : undefined}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-description={locked ? 'この設定はいつもオンで変更できません' : indeterminate ? '一部だけオンです' : undefined}
      data-indeterminate={indeterminate || undefined}
      disabled={locked || disabled}
      onClick={onChange ? () => onChange(indeterminate ? true : !checked) : undefined}
      className={[styles.toggle, (on || indeterminate) && !locked && styles.on, locked && styles.locked, className]
        .filter(Boolean)
        .join(' ')}
    />
  )
}

/** 説明のある設定行。文字とスイッチの配置を全画面で共通にする。 */
export function ToggleField({ children, description, 'aria-label': label, title, className, ...props }: {
  children: ReactNode
  description?: ReactNode
  'aria-label'?: string
  title?: string
  className?: string
  checked: boolean
  disabled?: boolean
  locked?: boolean
  invalid?: boolean
  onChange?: (next: boolean) => void
}) {
  const id = useId()
  const field = useFieldContext()
  const switchId = field?.controlId ?? `${id}-switch`
  const descriptionId = `${id}-description`
  return <span className={[styles.field, className].filter(Boolean).join(' ')} title={title}>
    <span className={styles.fieldBody}><label id={id} htmlFor={switchId}>{children}</label>{description ? <span id={descriptionId} className={styles.description}>{description}</span> : null}</span>
    <Toggle {...props} id={switchId} label={label ?? ''} labelledBy={label ? undefined : id} describedBy={description ? descriptionId : undefined} />
  </span>
}
