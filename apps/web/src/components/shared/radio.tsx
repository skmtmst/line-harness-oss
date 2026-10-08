'use client'

import type { InputHTMLAttributes, ReactNode } from 'react'
import styles from './radio.module.css'

/** V8 の行内ラジオ（y4YQSB / gzxYf）。カード形式は RadioCardGroup を使う。 */
export default function Radio({
  children,
  className,
  size = 'medium',
  ...props
  /*
   * `size` は入力欄そのものの属性（数字）としても使えるが、この部品では
   * 文字の大きさを選ぶ名前として使うので、元の属性は外しておく。
   * 外さないと数字と名前が重なって型が合わなくなる。
   */
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children' | 'size'> & {
  children: ReactNode
  /**
   * 文字の大きさ。既定 'medium' は行内ラジオ（y4YQSB／gzxYf：文 13/20）。
   * 'small' は脇のパネル内（★BG-B `z14gEG` 人物2択：文 12/17）。
   * 丸の 18 と間隔 8 はどちらも同じ。v8 だけで効く。
   */
  size?: 'medium' | 'small'
}) {
  return (
    <label className={[styles.root, className].filter(Boolean).join(' ')} data-size={size}>
      <input type="radio" className={styles.input} {...props} />
      <span className={styles.label}>{children}</span>
    </label>
  )
}
