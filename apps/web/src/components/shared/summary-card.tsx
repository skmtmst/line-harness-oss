import Link from 'next/link'
import React from 'react'
import type { ReactNode } from 'react'
import styles from './summary-card.module.css'

export type SummaryCardProps = {
  title: string
  /** 取得できない場合は null を渡すと「—」を表示する。 */
  value: number | null
  unit: string
  detail: ReactNode
  badge?: string
  action?: { label: string; href: string }
  loading?: boolean
  className?: string
  hidden?: boolean
  id?: string
  'aria-label'?: string
}

/**
 * Pencil V5 の `XywGr` を正本にした数値サマリーカード。
 * 文字列値と告知色を持つ `mNUQ3` は意味が異なるため、判断が終わるまで統合しない。
 */
export default function SummaryCard({
  title,
  value,
  unit,
  detail,
  badge,
  action,
  loading = false,
  className,
  ...cardProps
}: SummaryCardProps) {
  const classes = [styles.card, className].filter(Boolean).join(' ')

  return (
    <div className={classes} aria-busy={loading || undefined} {...cardProps}>
      <div className={styles.head}>
        <p className={styles.label}>{title}</p>
        {badge ? (
          <span className={styles.badge}>{badge}</span>
        ) : action ? (
          <Link href={action.href} className={styles.link}>
            {action.label}
          </Link>
        ) : null}
      </div>

      {loading ? (
        <div className={styles.skeleton} aria-hidden="true" />
      ) : (
        <p className={styles.value}>
          {value === null ? '—' : value.toLocaleString('ja-JP')}
          {unit}
        </p>
      )}

      <p className={styles.detail}>{detail}</p>
    </div>
  )
}
