import React, { forwardRef } from 'react'
import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react'
import styles from './form-controls.module.css'

/**
 * 入力欄まわりの共通部品。
 *
 * create-page.tsx から分けてある。あちらは作成画面の骨組み（Crumb / Head /
 * Body / Left / Right の data-design）を持っているので、入力欄だけ使いたい
 * 画面が import すると、その画面が骨組みも持っているように見えてしまい、
 * design-structure.test.ts が誤って落ちる。
 */

/** 1行の入力欄。ラベルと説明の付け方を全画面でそろえる。 */
export function Field({
  label,
  htmlFor,
  required,
  note,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  note?: ReactNode
  error?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor} className={styles.label}>
        {label}
        {/* 設計は「必須」と字で書いている。* だけだと、色が見えない人には
            何も伝わらない。 */}
        {required && (
          <span className={styles.required}>
            必須
          </span>
        )}
      </label>
      {children}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {!error && note ? <p className={styles.note}>{note}</p> : null}
    </div>
  )
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean
}

/** Pencil V5 `ytG7l` を正本にした1行入力。 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={[styles.control, styles.input, className].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      data-design-node="ytG7l"
      {...props}
    />
  )
})

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean
}

/** Pencil V5 `keKe3` を正本にした複数行入力。 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={[styles.control, styles.textarea, className].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      data-design-node="keKe3"
      {...props}
    />
  )
})

/** 入力欄の見た目。画面ごとに枠線の色が変わらないようにする。 */
export const inputClass =
  'border-hairline rounded-control focus-visible:ring-accent w-full border px-3 py-2 text-sm focus-visible:ring-2'
