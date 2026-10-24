import { jstDate as japanDate } from '@/lib/jst-datetime'
import { type BookingRequest } from '@/lib/api'

import { formatDate, formatDateTime, formatDay, formatTime } from '@/lib/format'

/**
 * 予約管理（設計 V2 8-1 / node EAYvf）。
 *
 * 設計は「見出し ＋ 4枚のKPI ＋ 左のメニュー棚 ＋ 検索の帯 ＋ 表 ＋ 注記 ＋ 件数と頁送り」。
 * 以前は青い帯で予約URLを見せ、状態のタブを上に並べていた。作りとしては
 * 動いていたが、設計のどこにも無い形だったので組み直した。
 *
 * 状態の絞り込みは「よく使う」の並びに移した。設計にある「変更依頼のみ」は
 * その状態そのものが bookings に無いので、実際にある状態を並べている。
 */

export const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'requested', label: '未承認' },
  { key: 'confirmed', label: '確定' },
  // N-398: 完了・来店なしも台帳の状態として絞れるようにする。
  { key: 'completed', label: '完了' },
  { key: 'no_show', label: '来店なし' },
  { key: 'rejected', label: '拒否' },
  { key: 'expired', label: '期限切れ' },
  { key: 'cancelled', label: 'キャンセル' },
  { key: 'all', label: '全件' },
]

/** 予約元の絞り込み。今読んでいる予約の source を LINE・電話・その他の3つへまとめる。 */
export const SOURCE_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: '予約元: すべて' },
  { key: 'line', label: 'LINE' },
  { key: 'phone', label: '電話' },
  { key: 'other', label: 'その他' },
]

export type LedgerSourceGroup = 'line' | 'phone' | 'other'

/** 予約1件の予約元。LINE は source が無い古い応答も friend_id で判別する。 */
export function ledgerSourceGroup(row: Pick<BookingRequest, 'source' | 'friend_id'>): LedgerSourceGroup {
  if (row.source === 'liff' || (!row.source && Boolean(row.friend_id))) return 'line'
  if (row.source === 'phone') return 'phone'
  return 'other'
}

/** 予約元の絞り込みに合うか。'all' は全部。 */
export function matchesLedgerSource(row: Pick<BookingRequest, 'source' | 'friend_id'>, source: string): boolean {
  return source === 'all' || ledgerSourceGroup(row) === source
}

/** 担当と予約元の両方の絞り込みに合うか。 */
export function matchesLedgerFilters(row: Pick<BookingRequest, 'source' | 'friend_id' | 'staff_id'>, staff: string, source: string): boolean {
  return (staff === 'all' || row.staff_id === staff) && matchesLedgerSource(row, source)
}

/** 表に出す予約元の言葉。 */
export const SOURCE_VALUE_LABELS: Record<string, string> = {
  liff: 'LINE',
  phone: '電話',
  counter: '店頭',
  operator: 'スタッフ入力',
  import: '取り込み',
}

export const statusBadgeColor: Record<string, string> = {
  requested: 'bg-warning-bg text-warning',
  confirmed: 'bg-success-bg text-success',
  rejected: 'bg-canvas-sunken text-ink-secondary',
  expired: 'bg-canvas-sunken text-ink-secondary',
  cancelled: 'bg-canvas-sunken text-ink-secondary',
  completed: 'bg-info-bg text-info',
  no_show: 'bg-danger-bg text-danger',
}

/** 表の予約経路（LINE 以外）。古い応答は「電話」。 */
export function sourceLabel(b: BookingRequest): string {
  return SOURCE_VALUE_LABELS[b.source ?? ''] ?? '電話'
}

/** 表の日時：MM/DD（曜）HH:mm（ の一覧の形）。 */
export function formatLedgerDateTime(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return '—'
  return `${formatDate(iso, { style: 'list-day-weekday' })} ${formatTime(iso)}`
}

export const statusLabel: Record<string, string> = {
  requested: '未承認',
  confirmed: '確定',
  rejected: '拒否',
  expired: '期限切れ',
  cancelled: 'キャンセル',
  completed: '完了',
  no_show: '無断',
}

export const actionLabel: Record<string, string> = {
  approve: '承認',
  reject: '拒否',
  cancel: 'キャンセル',
  no_show: '無断キャンセル',
  complete: '完了',
}

/** 1ページに出す件数。設計の「表示 20件」に合わせる。 */
export { DEFAULT_PAGE_SIZE as PAGE_SIZE } from '@/components/shared/page-size-options'

export function formatJpDateTime(iso: string): string {
  // 不正な日時が来たら Invalid Date を出さず「—」に逃がす(点検#516軽6)。
  if (Number.isNaN(new Date(iso).getTime())) return '—'
  return formatDateTime(iso)
}

export function formatJpTime(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return '—'
  return formatTime(iso)
}

/**
 * R316: 予約の日付（9/30(火)）。詳細パネルの見出しで使う。
 * 「今日」と固定すると、別の日の予約を開いても今日に見える。
 */
export function formatJpDay(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return '—'
  return formatDay(iso)
}

export function jstDay(iso: string): string {
  return japanDate(new Date(iso))
}

/**
 * R317: 台帳の状態をURLとタブ内の保存の両方へ残すための鍵。
 * 日付は `date`、検索語は `q`、ほかは一覧の絞り込み名そのまま。
 */
export const LEDGER_QUERY_KEYS = ['view', 'status', 'range', 'date', 'q', 'menu', 'staff', 'source', 'page'] as const

export const LEDGER_STORAGE_KEY = 'booking-ledger-state-v1'

export type LedgerSavedState = {
  view?: string | null
  status?: string | null
  range?: string | null
  date?: string | null
  q?: string | null
  menu?: string | null
  staff?: string | null
  source?: string | null
  page?: string | null
}

/** 同じタブで見ていた台帳の状態。無い・壊れているときは null。 */
export function readLedgerState(): LedgerSavedState | null {
  try {
    const raw = window.sessionStorage.getItem(LEDGER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LedgerSavedState
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}
