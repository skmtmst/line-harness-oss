'use client'

/*
 * ★V8 会員の小さな部品（金額の形・CSV のセル・ランクの札・型）。
 * 今の画面（app/nen/members の rank-view・friends の csv-export）から写した。
 * src/v8 は @/app を読めないので、同じ約束のまま持つ。
 */
import { formatNumber } from '@/lib/format'
import type { NenRankSettingsData } from '@/lib/nen-ranks-api'
import styles from './members.module.css'

export type MemberTab = 'members' | 'ranks' | 'lifetime'
export type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'
export type SavedHandler = (forAccountId: string, next: NenRankSettingsData) => void

/** 金額（円）。画面の数字はすべてこの形。 */
export function yen(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `¥${formatNumber(Math.round(value))}`
}

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

/**
 * ランクの印。上から2つを黒・金、いちばん下を緑、間を灰にする（今の画面と同じ決まり）。
 * rankOrder は低い順。
 */
export function rankTone(rankKey: string | null, rankOrder: string[]): 'top' | 'second' | 'middle' | 'base' | 'unknown' {
  const index = rankKey ? rankOrder.indexOf(rankKey) : -1
  if (index < 0) return 'unknown'
  if (rankOrder.length > 1 && index === rankOrder.length - 1) return 'top'
  if (rankOrder.length > 2 && index === rankOrder.length - 2) return 'second'
  if (index === 0) return 'base'
  return 'middle'
}

export function RankChip({ rankKey, name, rankOrder }: { rankKey: string | null; name: string; rankOrder: string[] }) {
  return <span className={styles.rankChip} data-tone={rankTone(rankKey, rankOrder)}>{name}</span>
}

/** ランクの決まりの4つの言葉（API の値は1種類ずつなので、言葉は画面が持つ）。 */
export const RULE_LABELS = {
  yearStartMonth: (month: number) => (month === 1 ? '1月1日〜12月31日' : `${month}月1日〜翌年${month - 1}月末`),
  applyOnReach: 'すぐに反映する',
  keepUntil: '翌年の12月末まで',
  countOrders: '入金済みの注文（キャンセル・返金は除く）',
} as const

const JST = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false })
const JST_TIME = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: 'numeric', minute: '2-digit', hour12: false })

/** 「9/30 10:12」（日本時間）。 */
export function shortDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = Object.fromEntries(JST.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}

/** 「14:02」（日本時間）。 */
export function shortTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return JST_TIME.format(date)
}
