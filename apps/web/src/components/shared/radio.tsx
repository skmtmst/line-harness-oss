'use client'

import type { InputHTMLAttributes, ReactNode } from 'react'
import styles from './radio.module.css'

/** V8 の行内ラジオ（y4YQSB / gzxYf）。カード形式は RadioCardGroup を使う。 */
export default function Radio({ children, className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> & { children: ReactNode }) {
  return (
    <label className={[styles.root, className].filter(Boolean).join(' ')}>
      <input type="radio" className={styles.input} {...props} />
      <span className={styles.label}>{children}</span>
    </label>
  )
}
