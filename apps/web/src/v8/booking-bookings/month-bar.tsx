'use client'

import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Link2 } from 'lucide-react'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import styles from './month-bar.module.css'

/*
 * 予約管理「今月」の数の帯の下の1段。
 * 左＝月送り（‹ › 年月 ［今日］）、右＝友だち予約URL・予約履歴URLをコピーする。
 * 下に「今月（2026年10月）の予約を「全件」で表示しています。」の1行。
 * 一覧（view=list）は月送りを出さず、URLの2つだけを右に置く。
 */
export function BookingMonthBar({ monthLabel, isThisMonth, onPrev, onNext, onToday, urls, caption }: {
  /** 「2026年10月」。渡さないと月送りを出さない（一覧）。 */
  monthLabel?: string
  isThisMonth?: boolean
  onPrev?: () => void
  onNext?: () => void
  onToday?: () => void
  /** URL をコピーする2つ（作れないときの案内も呼ぶ側が渡す）。 */
  urls: ReactNode
  caption?: ReactNode
}) {
  return (
    <div className={styles.bar} data-design="MonthBar">
      <div className={styles.row}>
        {monthLabel ? (
          <div className={styles.nav} role="group" aria-label="表示する月">
            <IconButton size="compact" aria-label="前の月" onClick={onPrev}><ChevronLeft size={16} aria-hidden="true" /></IconButton>
            <IconButton size="compact" aria-label="次の月" onClick={onNext}><ChevronRight size={16} aria-hidden="true" /></IconButton>
            <strong className={styles.month} aria-live="polite">{monthLabel}</strong>
            <Button size="compact" onClick={onToday} aria-current={isThisMonth ? 'date' : undefined}>今日</Button>
          </div>
        ) : <span />}
        <div className={styles.urls}>{urls}</div>
      </div>
      {caption ? <p className={styles.caption} role="status">{caption}</p> : null}
    </div>
  )
}

/** 「🔗 友だち予約URL ｜ コピーする」の1つ。押すとコピーし、済んだら「コピー済み」。 */
export function BookingUrlCopy({ label, copied, onCopy }: { label: string; copied: boolean; onCopy: () => void }) {
  return (
    <Button size="compact" onClick={onCopy} aria-label={`${label}をコピーする`}>
      <Link2 size={14} aria-hidden="true" />{label}<span className={styles.copyWord}>{copied ? 'コピー済み' : 'コピーする'}</span>
    </Button>
  )
}

/** 道具の2段目の頭の「よく使う」。 */
export function BookingChipsLabel() {
  return <span className={styles.chipsLabel}>よく使う</span>
}
