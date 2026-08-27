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
  badgeTone?: 'accent' | 'neutral' | 'danger'
  action?: { label: string; href: string }
  loading?: boolean
  /** 対象画面にV6がある場合はv6、配信予定を強調するカードはbroadcastを使う。 */
  variant?: 'v5' | 'v6' | 'broadcast'
  className?: string
  hidden?: boolean
  id?: string
  'aria-label'?: string
}

/**
 * Pencil V5 の `XywGr` を基本に、V6のKPIと配信告知の差を名前付きvariantで固定したカード。
 */
export default function SummaryCard({
  title,
  value,
  unit,
  detail,
  badge,
  badgeTone = 'accent',
  action,
  loading = false,
  variant = 'v5',
  className,
  ...cardProps
}: SummaryCardProps) {
  const variantClass = {
    v5: undefined,
    v6: styles.cardV6,
    broadcast: styles.cardBroadcast,
  }[variant]
  const labelVariantClass = {
    v5: undefined,
    v6: styles.labelV6,
    broadcast: styles.labelBroadcast,
  }[variant]
  const detailVariantClass = variant === 'broadcast' ? styles.detailNotice : variant === 'v6' ? styles.detailV6 : undefined
  const classes = [styles.card, variantClass, className].filter(Boolean).join(' ')

  return (
    <div className={classes} aria-busy={loading || undefined} data-design-version={variant} {...cardProps}>
      <div className={styles.head}>
        <p className={[styles.label, labelVariantClass].filter(Boolean).join(' ')}>
          {title || (loading ? <span className={styles.labelSkeleton} aria-hidden="true" /> : null)}
        </p>
        {badge ? (
          <span className={[styles.badge, styles[`badge_${badgeTone}`]].filter(Boolean).join(' ')}>{badge}</span>
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

      <p className={[styles.detail, detailVariantClass].filter(Boolean).join(' ')}>{detail}</p>
    </div>
  )
}
