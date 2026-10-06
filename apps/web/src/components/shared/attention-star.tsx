'use client'

import { Star } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import styles from './attention-star.module.css'

/** V8 zcGgI / w0R1PQ. The caller owns saving and permissions. */
export default function AttentionStar({ pressed, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed' | 'className'> & { pressed: boolean }) {
  return (
    <button type="button" {...props} data-part="attention-star" aria-pressed={pressed} className={styles.root}>
      <Star aria-hidden="true" size={18} />
    </button>
  )
}
