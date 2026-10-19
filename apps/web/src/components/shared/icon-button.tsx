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
  variant,
  pressed,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'aria-label'> & {
  children: ReactNode
  className?: string
  'aria-label': string
  /** React 19 の ref（「…」のメニューの位置の基準などに使う）。 */
  ref?: Ref<HTMLButtonElement>
  /**
   * 'small' は行の中の 24×24（印 12・角丸 6。ダッシュボード編集  の上下）。
   * 'row' は行の右端の「…」の 28×28（印 14・押せる所は 36。★V8  ほか）。
   * 'compact' は狭い道具の枠つき32角。通常の36角と行の「…」は保つ。
   */
  size?: 'small' | 'row' | 'compact'
  /** 枠のない行内操作。既定の枠つきボタンには効かない。 */
  variant?: 'plain'
  /** Controlled selection, for actions such as starring an item. */
  pressed?: boolean
}) {
  return (
    <button
      ref={ref}
      type={type}
      className={[styles.button, className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
      data-design-node="H0V8EK"
      data-size={size}
      data-variant={variant}
      aria-pressed={pressed}
      {...props}
    >
      {children}
    </button>
  )
}
