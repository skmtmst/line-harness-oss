/**
 * 予約からの売上の期間と差分の言葉（B-1 X26oo）。
 * 今日は JST。to は含まない（明日の日付を渡す）。
 */

export type SalesPeriodKey = 'week' | 'month' | 'quarter'

function jstToday(): { year: number; month: number; date: number } {
  const now = new Date(Date.now() + 9 * 3600_000)
  return { year: now.getUTCFullYear(), month: now.getUTCMonth(), date: now.getUTCDate() }
}

function isoDay(year: number, month: number, date: number): string {
  return new Date(Date.UTC(year, month, date)).toISOString().slice(0, 10)
}

function tomorrowIso(year: number, month: number, date: number): string {
  return new Date(Date.UTC(year, month, date + 1)).toISOString().slice(0, 10)
}

/** 期間の from・to（to は含まない）。 */
export function salesPeriodRange(key: SalesPeriodKey): { from: string; to: string } {
  const today = jstToday()
  const to = tomorrowIso(today.year, today.month, today.date)
  if (key === 'week') {
    // 月曜始まり。
    const weekday = new Date(Date.UTC(today.year, today.month, today.date)).getUTCDay()
    const mondayOffset = (weekday + 6) % 7
    const from = isoDay(today.year, today.month, today.date - mondayOffset)
    return { from, to }
  }
  if (key === 'month') {
    return { from: isoDay(today.year, today.month, 1), to }
  }
  return { from: isoDay(today.year, today.month - 3, today.date), to }
}

/** 直前と比べる言葉（B-1 の「先月より」の段）。 */
export const SALES_PERIOD_COMPARE_LABEL: Record<SalesPeriodKey, string> = {
  week: '前の週より',
  month: '先月より',
  quarter: '前の3か月より',
}

/** 売上の増減（%）。前が0のときは出さない。 */
export function formatRevenueDelta(current: number, previous: number): string | null {
  if (previous <= 0 || current < 0) return null
  const percent = ((current - previous) / previous) * 100
  const oneDecimal = Math.round(percent * 10) / 10
  const sign = oneDecimal > 0 ? '+' : ''
  return `${sign}${oneDecimal}%`
}

/** 件数の増減（必ず出る）。 */
export function formatCountDelta(current: number, previous: number): string {
  const diff = current - previous
  const sign = diff > 0 ? '+' : ''
  return `${sign}${diff}件`
}

/** 率の増減（pt、必ず出る）。 */
export function formatPointDelta(currentRate: number, previousRate: number): string {
  const diff = Math.round((currentRate - previousRate) * 1000) / 10
  const sign = diff > 0 ? '+' : ''
  return `${sign}${diff}pt`
}
