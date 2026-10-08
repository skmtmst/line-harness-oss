import React, { type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import styles from './icon-button.module.css'

/** アイコンだけの操作。見える名前の代わりにaria-labelを必須にする。 */
export default function IconButton({
  children,
  className,
  type = 'button',
  'aria-label': ariaLabel,
  ref,
  size,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'aria-label'> & {
  children: ReactNode
  className?: string
  'aria-label': string
  /** React 19 の ref（「…」のメニューの位置の基準などに使う）。 */
  ref?: Ref<HTMLButtonElement>
  /**
   * 'small' は行の中の 24×24（印 12・角丸 6。ダッシュボード編集 mcOqK の上下）。
   * 'row' は行の右端の「…」の 28×28（印 14・押せる所は 36。★V8 i0Ao0R ほか）。どちらも v8 だけで効く。
   */
  size?: 'small' | 'row'
}) {
  return (
    <button
      ref={ref}
      type={type}
      className={[styles.button, className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
      data-design-node="H0V8EK"
      data-size={size}
      {...props}
    >
      {children}
    </button>
  )
}
