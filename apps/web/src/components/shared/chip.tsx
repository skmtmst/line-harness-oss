import type { ReactNode } from 'react'
import styles from './chip.module.css'

export type ChipTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger'

/**
 * 印（チップ）。状態や区分を1語で示す小さな札。
 *
 * 色は5つだけ。**緑（ok）は「オン・正常」専用**で、それ以外の意味に使わない。
 * 幅は持たない。
 */
export default function Chip({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: ChipTone
  className?: string
  children: ReactNode
}) {
  return <span className={[styles.chip, styles[tone], className].filter(Boolean).join(' ')}>{children}</span>
}
