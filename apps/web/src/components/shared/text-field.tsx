import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import styles from './text-field.module.css'

/**
 * 1行の入力欄。Pencil V5 の `ytG7l`。★V5 227枚で102回。
 *
 * 幅は持たない（`width: 100%` で親に合わせる）。列の幅は呼び出し側で決める。
 */
export function TextField({
  invalid,
  className,
  ...rest
}: { invalid?: boolean; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  return (
    <input
      type="text"
      aria-invalid={invalid || undefined}
      className={[styles.field, styles.single, invalid && styles.invalid, className].filter(Boolean).join(' ')}
      {...rest}
    />
  )
}

/**
 * 複数行の入力欄。Pencil V5 の `keKe3`。
 */
export function TextArea({
  invalid,
  className,
  ...rest
}: { invalid?: boolean; className?: string } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={[styles.field, styles.multi, invalid && styles.invalid, className].filter(Boolean).join(' ')}
      {...rest}
    />
  )
}
