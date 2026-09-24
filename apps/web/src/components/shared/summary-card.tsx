'use client'

import Link from 'next/link'
import React, { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import styles from './summary-card.module.css'

export type SummaryCardProps = {
  title: string
  /** 取得できない場合は null を渡すと「—」を表示する。 */
  value: number | null
  unit: string
  /**
   * 数では表せない値（「1時間24分」「96.7%」など）をそのまま出す。
   * 渡したときは value と unit を使わない（★V6 37-6 の数値カード帯）。
   */
  valueText?: string
  /**
   * 見出し・数値に続く3段目。短い状態・短い補足だけを置く。
   * 「未計測」「集計不可」「取得失敗」などの状態自体はここに残し、
   * 長い定義・詳しい理由は description（説明アイコン）へ渡す。
   */
  detail: ReactNode
  /**
   * 指標の定義や取得できない詳しい理由などの長い説明。
   * 見出しの説明アイコンを押したときだけ開くポップオーバーへ入れるので、
   * カードの高さを理由の長さで伸ばさない。説明を開かないと異常が
   * 分からない形にしないため、状態の一言は必ず detail 側へ残す。
   */
  description?: ReactNode
  /** 説明アイコンの読み上げ名。省略時は「<title>の説明」。 */
  descriptionLabel?: string
  /**
   * 取得失敗など、その場でやり直せるときの再試行。
   * 短い状態のそばに出すので、説明を開かなくても辿れる。
   */
  onRetry?: () => void
  retryLabel?: string
  badge?: string
  /** warning は「見ておくとよい」。止まっている・壊れている（danger）ほど強くない注意に使う。 */
  badgeTone?: 'accent' | 'neutral' | 'warning' | 'danger'
  action?: { label: string; href: string }
  loading?: boolean
  /** 対象画面にV6がある場合はv6、配信予定を強調するカードはbroadcastを使う。 */
  variant?: 'v5' | 'v6' | 'broadcast'
  className?: string
  hidden?: boolean
  id?: string
  'aria-label'?: string
  /** faint は「値を出せない」の見せ方。0 を薄くする用途には使わない。 */
  valueTone?: 'default' | 'warning' | 'faint'
}

/**
 * Pencil V5 の `XywGr` を基本に、V6のKPIと配信告知の差を名前付きvariantで固定したカード。
 */
export default function SummaryCard({
  title,
  value,
  unit,
  detail,
  description,
  descriptionLabel,
  onRetry,
  retryLabel,
  badge,
  badgeTone = 'accent',
  action,
  loading = false,
  variant = 'v5',
  className,
  valueTone = 'default',
  valueText,
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

  /*
    説明の開閉。実ボタンなのでクリック・Enter・Space・タップはそのまま効く。
    Esc・外側のタップ・フォーカス離脱で閉じ、Escでは押したアイコンへ戻る。
    ポップオーバーはカード幅の内側に収めるので、画面の端で横にはみ出さない。
  */
  const rootRef = useRef<HTMLDivElement>(null)
  const infoButtonRef = useRef<HTMLButtonElement>(null)
  const descriptionId = useId()
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const hasDescription = description !== undefined && description !== null

  useEffect(() => {
    if (!descriptionOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setDescriptionOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setDescriptionOpen(false)
      infoButtonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [descriptionOpen])

  useEffect(() => {
    if (!hasDescription) setDescriptionOpen(false)
  }, [hasDescription])

  return (
    <div
      ref={rootRef}
      className={classes}
      aria-busy={loading || undefined}
      data-design-version={variant}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setDescriptionOpen(false)
      }}
      {...cardProps}
    >
      <div className={styles.head}>
        <p className={[styles.label, labelVariantClass].filter(Boolean).join(' ')}>
          {title || (loading ? <span className={styles.labelSkeleton} aria-hidden="true" /> : null)}
          {hasDescription ? (
            <button
              ref={infoButtonRef}
              type="button"
              className={styles.infoButton}
              aria-label={descriptionLabel ?? `${title}の説明`}
              aria-expanded={descriptionOpen}
              aria-controls={descriptionId}
              onClick={() => setDescriptionOpen((open) => !open)}
            >
              <Info className={styles.infoIcon} aria-hidden="true" />
            </button>
          ) : null}
        </p>
        {badge ? (
          <span className={[styles.badge, styles[`badge_${badgeTone}`]].filter(Boolean).join(' ')}>{badge}</span>
        ) : action ? (
          <Link href={action.href} className={styles.link}>
            {action.label}
          </Link>
        ) : null}
        {hasDescription && descriptionOpen ? (
          <div id={descriptionId} role="note" className={styles.popover}>
            {description}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className={styles.skeleton} aria-hidden="true" />
      ) : (
        <p
          className={[
            styles.value,
            valueTone === 'warning' ? styles.valueWarning : null,
            valueTone === 'faint' ? styles.valueFaint : null,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {valueText !== undefined ? valueText : value === null ? '—' : value.toLocaleString('ja-JP')}
          {valueText !== undefined ? null : unit}
        </p>
      )}

      <p className={[styles.detail, detailVariantClass].filter(Boolean).join(' ')}>
        {detail}
        {onRetry ? (
          <button type="button" className={styles.retry} onClick={onRetry}>
            {retryLabel ?? 'もう一度読み込む'}
          </button>
        ) : null}
      </p>
    </div>
  )
}
