'use client'
import { formatYen as yen } from '@line-crm/shared';

/*
 * ★V8 会員の小さな部品（金額の形・CSV のセル・ランクの札・型）。
 * 今の画面（app/nen/members の rank-view・friends の csv-export）から写した。
 * src/v8 は @/app を読めないので、同じ約束のまま持つ。
 */
import type { NenRankSettingsData } from '@/lib/nen-ranks-api'
import StatusBadge from '@/components/shared/status-badge'
import { formatDate as polishFormatDate } from '@/lib/format'


export type MemberTab = 'members' | 'ranks' | 'lifetime'
export type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'
export type SavedHandler = (forAccountId: string, next: NenRankSettingsData) => void

/** 金額（円）。画面の数字はすべてこの形。 */
export { yen };

/** 入力の「200000」「200,000」「¥200,000」を数へ。読めなければ NaN。 */
export function parseYen(value: string): number {
  const digits = value.replace(/[¥￥,，\s〜~]/g, '')
  return digits === '' ? Number.NaN : Number(digits)
}

/** 入力の「3」「3%」を数へ。読めなければ NaN。 */
export function parsePercent(value: string): number {
  const digits = value.replace(/[%％\s]/g, '')
  return digits === '' ? Number.NaN : Number(digits)
}

/**
 * CSV のセル守り（点検 #496-4 と同じ約束）。先頭が `=+-@` のセルには `'` を付け、
 * Excel で数式として動かないようにする。引用符は常に二重化する。
 */
export function csvCell(value: string | null | undefined): string {
  const raw = value ?? ''
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}

export function csvLine(values: Array<string | null | undefined>): string {
  return values.map((value) => csvCell(value)).join(',')
}

/** ランクは状態ではないので、共通の灰色の札で文字だけ示す（・）。 */
export function RankChip({ name }: { name: string }) {
  return <StatusBadge tone="neutral" dot={false}>{name}</StatusBadge>
}

/** ランクの決まりの4つの言葉（API の値は1種類ずつなので、言葉は画面が持つ）。 */
export const RULE_LABELS = {
  yearStartMonth: (month: number) => (month === 1 ? '1月1日〜12月31日' : `${month}月1日〜翌年${month - 1}月末`),
  applyOnReach: 'すぐに反映する',
  keepUntil: '翌年の12月末まで',
  countOrders: '入金済みの注文（キャンセル・返金は除く）',
} as const




/** 「9/30 10:12」（日本時間）。 */
export function shortDateTime(value: string | null | undefined): string {
  return polishFormatDate(value, { style: 'list', fallback: '—' })
}

/** 「14:02」（日本時間）。 */
export function shortTime(value: string | null | undefined): string {
  return polishFormatDate(value, { style: 'time', fallback: '—' })
}
