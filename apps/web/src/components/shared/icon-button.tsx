import React, { type ButtonHTMLAttributes, type ReactNode } from 'react'
import styles from './icon-button.module.css'

/** アイコンだけの操作。見える名前の代わりにaria-labelを必須にする。 */
export default function IconButton({
  children,
  className,
  type = 'button',
  'aria-label': ariaLabel,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'aria-label'> & {
  children: ReactNode
  className?: string
  'aria-label': string
}) {
  return (
    <button
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
