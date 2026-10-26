import type { ComponentType, ReactNode } from 'react'
import styles from './icon-label.module.css'

/** 色なしの小さな印＋文字（種類・所属など）。1 行の色の点はフォルダだけにするため、色で区別しない物はこれで出す。 */
export default function IconLabel({ icon: Icon, children, 'aria-label': ariaLabel }: {
  icon: ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean | 'true' }>
  children: ReactNode
  'aria-label'?: string
}) {
  return <span className={styles.label} aria-label={ariaLabel} data-icon-label=""><Icon size={14} aria-hidden="true" className={styles.icon} />{children}</span>
}
