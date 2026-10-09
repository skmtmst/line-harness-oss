'use client'

import { statusLabel } from '@/lib/status-labels'


/* ★V8 分析の見かたで共通に使う小さな部品（期間の切り替え・数の帯の「…」・日時の短い形）。 */
import SharedStatusPill from '@/components/shared/status-pill'
import { type ReactNode } from 'react'
import SegmentedControl from '@/components/shared/segmented'
import PeriodPicker from '@/components/shared/period-picker'
import styles from './analytics.module.css'
import { formatDate as polishFormatDate } from '@/lib/format'


/** 集計期間は共通部品へ。 */
export const RangePickerV8 = PeriodPicker

const JST = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const JST_DAY = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })
/** 「9/30 19:00」（日本時間）。 */
export function shortDateTime(value: string | null): string {
  return polishFormatDate(value, { style: 'list', fallback: '—' })
}
/** 日付だけ（YYYY-MM-DD）なら「9/30」、日時なら「9/30 19:00」。 */
export function shortWhen(value: string | null): string {
  return polishFormatDate(value, { style: /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? 'list-day' : 'list' })
}
/** 「9/30」（日本時間）。YYYY-MM-DD も日時も受ける。 */
export function shortDay(value: string | null): string {
  return polishFormatDate(value, { style: 'list-day' })
}
/** 道具の段の「9/2〜10/1・10/1 6:00 までのデータ」。 */
export function dataRangeCaption(from: string, to: string, cutoffAt: string): string {
  return `${shortDay(from)}〜${shortDay(to)}・${shortDateTime(cutoffAt)} までのデータ`
}

/** 表の状態の札（点＋文字・丸い地）。緑＝動いている・灰＝止めている・青＝案内。 */
export function StatePill({ tone, children }: { tone: 'ok' | 'neutral' | 'info' | 'warn'; children: ReactNode }) {
  return <SharedStatusPill tone={tone === 'ok' ? 'success' : tone === 'warn' ? 'warning' : tone}>{typeof children === 'string' ? statusLabel(children) : children}</SharedStatusPill>
}
