'use client'

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { joinDescribedBy, useFieldContext } from './field-context'
import styles from './text-field.module.css'

/*
 * 入力欄の正本（★V8 共通部品 Ume2U「入力欄」・i5BW8b「入力欄/複数行」・fDAyI「入力欄/エラー」）。
 *
 * 入力欄はこのファイルの2つだけ。form-controls.tsx の TextInput・TextArea は
 * ここを呼ぶだけの薄い包み（v7 の見た目の差だけを足す）。
 *
 * `Field`（form-controls.tsx）の中に置くと、説明・誤りの文・文字数の id を
 * aria-describedby に、誤りの有無を aria-invalid に、必須を aria-required に
 * 自動で付ける。呼ぶ側が直接渡した値はそのまま残し、足し合わせる。
 */

type ControlOwnProps = { invalid?: boolean; className?: string }

function useControlA11y(props: {
  id?: string
  invalid?: boolean
  required?: boolean
  'aria-describedby'?: string
  'aria-invalid'?: InputHTMLAttributes<HTMLInputElement>['aria-invalid']
  'aria-required'?: InputHTMLAttributes<HTMLInputElement>['aria-required']
}) {
  const field = useFieldContext()
  const invalid = Boolean(props.invalid) || Boolean(field?.invalid)
  return {
    id: props.id ?? field?.controlId,
    'aria-describedby': joinDescribedBy(props['aria-describedby'], field?.describedBy),
    'aria-invalid': props['aria-invalid'] ?? (invalid || undefined),
    'aria-required': props['aria-required'] ?? (field?.required && !props.required ? true : undefined),
    invalid,
  }
}

/**
 * 1行の入力欄（Ume2U）。幅は持たない（`width: 100%` で親に合わせる）。
 * 列の幅は呼び出し側で決める。
 */
export const TextField = forwardRef<
  HTMLInputElement,
  ControlOwnProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>
>(function TextField({ invalid, className, id, required, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired, ...rest }, ref) {
  const a11y = useControlA11y({ id, invalid, required, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired })
  return (
    <input
      ref={ref}
      type="text"
      data-design-node="Ume2U"
      {...rest}
      id={a11y.id}
      required={required}
      aria-describedby={a11y['aria-describedby']}
      aria-invalid={a11y['aria-invalid']}
      aria-required={a11y['aria-required']}
      className={[styles.field, styles.single, a11y.invalid && styles.invalid, className].filter(Boolean).join(' ')}
    />
  )
})

/**
 * 複数行の入力欄（i5BW8b）。決まりは部品の中で持つ：
 * - 縦にだけ手で広げられる（横は広げられない）
 * - 最小の高さは 120px（★V8 の今の値）
 * 画面の側で resize を変えない。
 */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  ControlOwnProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>
>(function TextArea({ invalid, className, id, required, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired, ...rest }, ref) {
  const a11y = useControlA11y({ id, invalid, required, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired })
  return (
    <textarea
      ref={ref}
      data-design-node="i5BW8b"
      {...rest}
      id={a11y.id}
      required={required}
      aria-describedby={a11y['aria-describedby']}
      aria-invalid={a11y['aria-invalid']}
      aria-required={a11y['aria-required']}
      className={[styles.field, styles.multi, a11y.invalid && styles.invalid, className].filter(Boolean).join(' ')}
    />
  )
})
