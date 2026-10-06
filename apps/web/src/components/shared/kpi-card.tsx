'use client'

import Link from 'next/link'
import { ArrowRight, ChartNoAxesColumn } from 'lucide-react'
import React from 'react'
import type { ReactNode } from 'react'
import HelpTip from './help-tip'
import { isCountableValue } from './not-connected'
import styles from './kpi-card.module.css'
import { formatNumber } from '@/lib/format'

export type KpiCardProps = {
  title: string
  /** 図柄。省略時は棒グラフ。`null` で図柄なし（X4STXS の絵どおり）。 */
  icon?: ReactNode
  /** V8: 数の右に出す増減の札。 */
  delta?: ReactNode
  /** V8: 指標の操作。呼び出し側が使える操作だけ渡す。 */
  menu?: ReactNode
  /**
   * 取れないときは「—」を表示する（D021）。
   * null だけでなく undefined・NaN も「—」にする。呼び出し側が
   * `x?.y` をそのまま渡しても画面ごと落ちない。**0 は 0 のまま出す。**
   */
  value: number | null | undefined
  unit: string
  /** 増減の数（差し引きなど）。true のとき、プラスの数に「+」を付ける（単位はそのまま出す）。 */
  signed?: boolean
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
  /** V8 は画面の絵に合わせてカードか線で区切るマスを選ぶ。 */
  presentation?: 'card' | 'band' | 'cell'
  density?: 'compact' | 'comfortable'
  className?: string
  hidden?: boolean
  id?: string
  'aria-label'?: string
  /** faint は「値を出せない」の見せ方。0 を薄くする用途には使わない。 */
  valueTone?: 'default' | 'warning' | 'faint'
}

/** 旧名。KpiCard に寄せたので、新しくは KpiCardProps を使う。 */
export type SummaryCardProps = KpiCardProps

/**
 * Pencil V5 の `XywGr` を基本に、V6のKPIと配信告知の差を名前付きvariantで固定したカード。
 *
 * 取れないときの出し方（★V7 `x63W5x`）。**0 とは別物。**
 * - 読み込み中：`loading` を渡す。数値は骨組み、3段目（`detail`）に
 *   「読み込んでいます」と書く。
 * - 取得失敗：`value`（または `valueText`）を `null` にして「—」を出し、
 *   3段目に「読み込めませんでした」と書く。やり直せるときは `onRetry` も渡す。
 */
export default function KpiCard({
  title,
  icon,
  delta,
  menu,
  value,
  unit,
  signed = false,
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
  variant = 'v6',
  presentation = 'card',
  density = 'comfortable',
  className,
  valueTone = 'default',
  valueText,
  ...cardProps
}: KpiCardProps) {
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
      data-kpi-presentation={presentation}
      data-kpi-density={density}
      aria-busy={loading || undefined}
      data-design-version={variant}
      {...cardProps}
    >
      <div className={styles.head}>
        {/*
          ★V8 G3：狭いマスで題がはみ出すときは CSS の「…」で受け、
          全文は title で読めるようにする（読み上げは変わらない）。
        */}
        <p
          className={[styles.label, labelVariantClass].filter(Boolean).join(' ')}
          title={title || undefined}
        >
          {icon === null ? null : (
            <span className={`${styles.icon} v8-only`} aria-hidden="true">
              {icon ?? <ChartNoAxesColumn size={14} />}
            </span>
          )}
          <span className={styles.labelText}>
            {title || (loading ? <span className={styles.labelSkeleton} aria-hidden="true" /> : null)}
          </span>
          {hasTip ? (
            <HelpTip label={descriptionLabel ?? `${helpLabel ?? title}の説明`} className={styles.tip}>
              {tip}
              {helpHref ? <a href={helpHref}>{helpHrefLabel ?? 'くわしく'}</a> : null}
            </HelpTip>
          ) : null}
        </p>
        {menu ? <span className={`${styles.menu} v8-only`}>{menu}</span> : null}
        {badge ? (
          <span className={[styles.badge, styles[`badge_${badgeTone}`]].filter(Boolean).join(' ')}>{badge}</span>
        ) : action ? (
          <Link href={action.href} className={`${styles.link} v7-only`}>
            {action.label}
          </Link>
        ) : null}
      </div>

      <div className={styles.valueRow}>
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
          <span data-kpi-number className={styles.number}>{valueText !== undefined ? valueText : isCountableValue(value) ? `${signed && value > 0 ? '+' : ''}${formatNumber(value)}` : '—'}</span>
          {valueText !== undefined ? null : <span className={styles.unit}>{unit}</span>}
        </p>
      )}

      {delta ? <span className={`${styles.delta} v8-only`}>{delta}</span> : null}
      </div>

      <p className={[styles.detail, detailVariantClass].filter(Boolean).join(' ')}>
        <span className={styles.detailText}>{detail}</span>
        {onRetry ? (
          <button type="button" className={styles.retry} onClick={onRetry}>
            {retryLabel ?? 'もう一度読み込む'}
          </button>
        ) : null}
        {action ? (
          <Link href={action.href} className={`${styles.link} v8-only`}>
            <span>{action.label}</span><ArrowRight size={12} aria-hidden="true" />
          </Link>
        ) : null}
      </p>
    </div>
  )
}
