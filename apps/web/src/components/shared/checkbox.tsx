'use client'

import { Check, Minus } from 'lucide-react'
import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import styles from './checkbox.module.css'

/**
 * チェックボックス。Pencil ★V7 `gvjpx`「★ V7 共通 チェックボックス」。
 *
 * 一覧の選択・すぐ反映しない設定の ON/OFF に使う。すぐ反映する切替は `Toggle`。
 * 形の手本は kobra.systems の Checkbox（コードは写していない。docs/v7-reference-ui-adoption.md §5）。
 *
 * - 本物の `<input type="checkbox">` を四角の上に透明に重ねる。クリック・Space・読み上げは
 *   ブラウザの標準のまま。見た目だけを ★V7 に合わせる
 * - 未選択の枠は `$ink-faint`（白地と 4.8:1）。`$hairline` は 1.4:1 で、部品の見分けに要る 3:1 に届かない
 * - `indeterminate`（一部選択）は一覧の見出しの「表示中をすべて選ぶ」に使う
 * - 文字（children）を押しても切り替わる。文字が無いときは `aria-label` を必ず渡す
 */
export default function Checkbox({
  checked,
  onCheckedChange,
  indeterminate = false,
  invalid = false,
  description,
  error,
  children,
  className,
  id,
  ...rest
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** 一部選択（―）。checked より優先して見せる。 */
  indeterminate?: boolean
  invalid?: boolean
  /** 文字の下の補足（薄い字）。 */
  description?: ReactNode
  /** 誤りの文。指定すると invalid とみなす。 */
  error?: ReactNode
  /** 横に並べる文字。押しても切り替わる。 */
  children?: ReactNode
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange' | 'className' | 'children'>) {
  const ref = useRef<HTMLInputElement>(null)
  const autoId = useId()
  const inputId = id ?? autoId
  const noteId = `${inputId}-note`
  const hasNote = Boolean(error || description)
  const isInvalid = invalid || Boolean(error)

  useEffect(() => {
    // indeterminate は属性ではなく DOM のプロパティにしか無い。
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <span className={[styles.root, className].filter(Boolean).join(' ')} data-disabled={rest.disabled ? 'true' : undefined}>
      <label className={styles.line} htmlFor={inputId}>
        <span className={styles.control}>
          <input
            {...rest}
            ref={ref}
            id={inputId}
            type="checkbox"
            checked={checked}
            aria-invalid={isInvalid || undefined}
            aria-describedby={hasNote ? noteId : rest['aria-describedby']}
            onChange={(event) => onCheckedChange(event.target.checked)}
            className={styles.input}
          />
          <span aria-hidden="true" className={styles.box}>
            <Check className={styles.check} strokeWidth={3} />
            <Minus className={styles.minus} strokeWidth={3} />
          </span>
        </span>
        {children ? <span className={styles.label}>{children}</span> : null}
      </label>
      {hasNote ? (
        <span id={noteId} className={error ? styles.error : styles.description}>{error ?? description}</span>
      ) : null}
    </span>
  )
}
