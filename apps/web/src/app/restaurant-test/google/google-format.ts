import type { GoogleHoursPeriod, GoogleWeekday } from '@/lib/restaurant-google-api'
import { formatDay, formatTime } from '@/lib/format'
import { japaneseDetailOf } from '@/components/shared/api-error-message'

/** Googleビジネス画面で共通に使う表示用の小さな道具（第1段・第2段で共有）。 */

export const WEEKDAYS: GoogleWeekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
export const WEEKDAY_JA: Record<GoogleWeekday, string> = { MONDAY: '月', TUESDAY: '火', WEDNESDAY: '水', THURSDAY: '木', FRIDAY: '金', SATURDAY: '土', SUNDAY: '日' }

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  const time = formatTime(date)
  if (sameDay) return `今日 ${time}`
  return `${formatDay(date)} ${time}`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDay(date)
}

/**
 * 口コミの「受信」日時。
 * Googleは口コミが編集されても createTime（最初の投稿時刻）を変えず、updateTime だけを更新する。
 * createTime だけを出すと、最近書き直された口コミが何年も前の日付で並んでしまうため、
 * 新しい方を採用する。
 */
export function reviewReceivedAt(review: { createTime?: string | null; updateTime?: string | null }): string | null {
  const created = review.createTime ?? null
  const updated = review.updateTime ?? null
  const createdAt = created ? new Date(created).getTime() : Number.NaN
  const updatedAt = updated ? new Date(updated).getTime() : Number.NaN
  if (Number.isNaN(updatedAt)) return created
  if (Number.isNaN(createdAt)) return updated
  return updatedAt > createdAt ? updated : created
}

export function errorMessage(error: unknown, fallback: string): string {
  // 「API error: 500」のような内部の文は出さない。日本語の案内だけを出す。
  return japaneseDetailOf(error) || fallback
}

/** "YYYY-MM-DD" → 曜日。 */
export function weekdayOf(date: string): GoogleWeekday {
  const [y, m, d] = date.split('-').map((x) => Number.parseInt(x, 10))
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return WEEKDAYS[(dow + 6) % 7]
}

/** "2026-09-25" → "9月25日（金）" */
export function formatYmdJa(date: string, withYear = false): string {
  const [y, m, d] = date.split('-').map((x) => Number.parseInt(x, 10))
  if (!y || !m || !d) return date
  return `${withYear ? `${y}年` : ''}${m}月${d}日（${WEEKDAY_JA[weekdayOf(date)]}）`
}

/** "2026-09-25" → "9/25（金）" */
export function formatYmdShort(date: string): string {
  const [, m, d] = date.split('-').map((x) => Number.parseInt(x, 10))
  return `${m}/${d}（${WEEKDAY_JA[weekdayOf(date)]}）`
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map((x) => Number.parseInt(x, 10))
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

export function formatPeriods(periods: GoogleHoursPeriod[], closedLabel = '休業'): string {
  if (!periods.length) return closedLabel
  return periods.map((p) => `${p.open}–${p.close === '00:00' ? '24:00' : p.close}`).join(' / ')
}

export function samePeriods(a: GoogleHoursPeriod[], b: GoogleHoursPeriod[]): boolean {
  return formatPeriods(a, '-') === formatPeriods(b, '-')
}

/** 15分刻みの時刻一覧（00:00〜23:45）。終了用は 00:00 を「24:00」と表示する。 */
export const TIME_OPTIONS: string[] = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)
