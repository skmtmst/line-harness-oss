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

/**
 * 本文を画面へ渡さない状態のとき `ApiError` が自分で作る既定文（`api.ts` の
 * `new ApiError(...)`）。403・404・5xx は `extractApiErrorMessage` が
 * Workerの日本語本文を捨てるので、`message` がこの形のままになる。
 */
const INTERNAL_API_MESSAGE = /^API error: \d+$/

/**
 * 設定不足など、言い換えただけでは次の動きが分からない失敗に一言足す。
 *
 * `code` は状態コードに関係なく本文から取れる（`extractApiErrorCode`）ので、
 * 本文の日本語が捨てられる5xxでも、何が起きたかはここで伝えられる。
 */
const CODE_HINTS: Record<string, string> = {
  encryption_key_missing: 'この環境の設定が足りていません。運営へ連絡してください。',
  oauth_not_configured: 'この環境にはGoogle接続の設定がありません。運営へ連絡してください。',
  rate_limited: 'Googleの利用上限に達しました。しばらく待ってから、もう一度お試しください。',
  ai_unavailable: 'この環境ではこの機能を使えません。',
  unavailable: 'Googleに接続できませんでした。時間をおいて、もう一度お試しください。',
}

/**
 * Workerが書いた日本語の理由を画面へ出す。
 *
 * 本文が届かない状態では `API error: 503` のような内部文言しか残らない。
 * これをそのまま出すと利用者には何も分からないので（実際に本番のGoogle接続で
 * `API error: 503` だけが表示された）、呼び出し側が用意した日本語へ戻し、
 * 原因が設定側にあると分かる `code` のときだけ次の動きを添える。
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback
  if (error.message && !INTERNAL_API_MESSAGE.test(error.message)) return error.message
  const hint = error.code ? CODE_HINTS[error.code] : undefined
  return hint ? `${fallback}${hint}` : fallback
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
