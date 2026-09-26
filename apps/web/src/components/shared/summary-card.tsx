'use client'

import Link from 'next/link'
import React from 'react'
import type { ReactNode } from 'react'
import HelpTip from './help-tip'
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
   * 見出しの「？」を押したときだけ開く吹き出しへ入れるので、
   * カードの高さを理由の長さで伸ばさない。説明を開かないと異常が
   * 分からない形にしないため、状態の一言は必ず detail 側へ残す。
   */
  description?: ReactNode
  /** 説明アイコンの読み上げ名。省略時は「<title>の説明」。 */
  descriptionLabel?: string
  /**
   * 定義・分母・計算のしかた・単位・いつ時点の数か・言葉の意味。
   * 見出しのすぐ右の「？」へ入れる（★V7・§2-1b）。
   * `description` と両方渡したときは `help` を使う。
   */
  help?: ReactNode
  /** 「？」の見出し。省略時は title。読み上げ名は「{見出し}の説明」。 */
  helpLabel?: string
  /** 長い説明がある場所。渡すと吹き出しに「くわしく」が出る。 */
  helpHref?: string
  /** 「くわしく」の代わりの文言。 */
  helpHrefLabel?: string
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
 *
 * 取れないときの出し方（★V7 `x63W5x`）。**0 とは別物。**
 * - 読み込み中：`loading` を渡す。数値は骨組み、3段目（`detail`）に
 *   「読み込んでいます」と書く。
 * - 取得失敗：`value`（または `valueText`）を `null` にして「—」を出し、
 *   3段目に「読み込めませんでした」と書く。やり直せるときは `onRetry` も渡す。
 */
export default function SummaryCard({
  title,
  value,
  unit,
  detail,
  description,
  descriptionLabel,
  help,
  helpLabel,
  helpHref,
  helpHrefLabel,
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
    補足は見出しの「？」（HelpTip）へ。開閉・Esc・外側・1つだけの
    扱いは HelpTip が持つので、カード側は中身を渡すだけにする。
  */
  const tip = help ?? description
  const hasTip = tip !== undefined && tip !== null

  return (
    <div
      className={classes}
      aria-busy={loading || undefined}
      data-design-version={variant}
      {...cardProps}
    >
      <div className={styles.head}>
        <p className={[styles.label, labelVariantClass].filter(Boolean).join(' ')}>
          {title || (loading ? <span className={styles.labelSkeleton} aria-hidden="true" /> : null)}
          {hasTip ? (
            <HelpTip label={descriptionLabel ?? `${helpLabel ?? title}の説明`}>
              {tip}
              {helpHref ? <a href={helpHref}>{helpHrefLabel ?? 'くわしく'}</a> : null}
            </HelpTip>
          ) : null}
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
