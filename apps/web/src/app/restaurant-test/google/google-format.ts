import { ApiError } from '@/lib/api'
import type { GoogleHoursPeriod, GoogleWeekday } from '@/lib/restaurant-google-api'

/** Googleビジネス画面で共通に使う表示用の小さな道具（第1段・第2段で共有）。 */

export const WEEKDAYS: GoogleWeekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
export const WEEKDAY_JA: Record<GoogleWeekday, string> = { MONDAY: '月', TUESDAY: '火', WEDNESDAY: '水', THURSDAY: '木', FRIDAY: '金', SATURDAY: '土', SUNDAY: '日' }

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  const time = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(date)
  if (sameDay) return `今日 ${time}`
  return `${new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(date)} ${time}`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
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
