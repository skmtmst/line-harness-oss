import React, { type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import styles from './icon-button.module.css'

/** アイコンだけの操作。見える名前の代わりにaria-labelを必須にする。 */
export default function IconButton({
  children,
  className,
  type = 'button',
  'aria-label': ariaLabel,
  ref,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'aria-label'> & {
  children: ReactNode
  className?: string
  'aria-label': string
  /** React 19 の ref（「…」のメニューの位置の基準などに使う）。 */
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type={type}
      className={[styles.button, className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
      data-design-node="H0V8EK"
      {...props}
    >
      {children}
    </button>
  )
}
