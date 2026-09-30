import { formatDateTime, formatDay } from '@/lib/format'
/**
 * NEN配信の「今月・先月」と、日本時間の短い日付表記。★V6 37-6（`z4q1K`）。
 *
 * 数値カードは「今月 送った数（先月 N通）」のように月で区切る。実口は from/to を
 * 受けるので、ここで日本時間の月初〜翌月初を UTC の ISO 文字列にして渡す。
 * **端末の時差は使わない**（開発機が日本時間でないことがある）。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

export type MonthRange = { from: string; to: string; label: string; year: number; month: number }

/** `offset` が 0 なら今月、-1 なら先月。境界は日本時間の月初 0:00。 */
export function jstMonthRange(now: Date, offset = 0): MonthRange {
  const jst = new Date(now.getTime() + JST_OFFSET_MS)
  const year = jst.getUTCFullYear()
  const monthIndex = jst.getUTCMonth() + offset
  const from = new Date(Date.UTC(year, monthIndex, 1) - JST_OFFSET_MS)
  const to = new Date(Date.UTC(year, monthIndex + 1, 1) - JST_OFFSET_MS)
  const start = new Date(from.getTime() + JST_OFFSET_MS)
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: `${start.getUTCMonth() + 1}月`,
    year: start.getUTCFullYear(),
    month: start.getUTCMonth() + 1,
  }
}

function parse(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

/** 「9/12」。日時が読めなければ「—」。 */
export function jstShortDate(value: string | null | undefined): string {
  const date = parse(value)
  if (!date) return '—'
  return formatDay(date)
}

/** 「9/20 10:00」。 */
export function jstShortDateTime(value: string | null | undefined): string {
  const date = parse(value)
  if (!date) return '—'
  return formatDateTime(date)
}

/** 「9月20日（日）10:00」。予約日時の確認に使う。 */
export function jstLongDateTime(value: string | null | undefined): string {
  const date = parse(value)
  if (!date) return '—'
  return formatDateTime(date)
}

/** `datetime-local` の初期値。日本時間の「翌日 10:00」を `YYYY-MM-DDTHH:mm` で返す。 */
export function defaultScheduleLocal(now: Date): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS)
  const next = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 1, 10, 0))
  return next.toISOString().slice(0, 16)
}
