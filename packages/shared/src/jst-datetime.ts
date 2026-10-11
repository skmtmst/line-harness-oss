/**
 * datetime-localの入力（タイムゾーンなし）を日本時間としてUTCへ直す。
 * ブラウザの地域に左右されず、JST固定で保存する。
 */
export function datetimeLocalJstToUtcIso(value: string): string {
  const trimmed = value.trim();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(trimmed)) return new Date(trimmed).toISOString();
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed}:00`
    : trimmed;
  return new Date(`${withSeconds}+09:00`).toISOString();
}

/** 日付の境目は、日本の午前0時。端末の地域に左右されない。 */
export function jstDate(date: Date = new Date()): string {
  return new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

/** 日本時間の日付と時刻から予約時刻を作る。存在しない日付・時刻は拒否する。 */
export function scheduledJstIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const parsed = new Date(`${date}T${time}:00+09:00`)
  if (Number.isNaN(parsed.getTime())) return null
  const shifted = new Date(parsed.getTime() + 9 * 3_600_000).toISOString()
  return shifted.slice(0, 16) === `${date}T${time}` ? parsed.toISOString() : null
}

/** 日本時間で、今日から指定した日数だけ前後の日付。 */
export function jstDateOffset(days: number, now: Date = new Date()): string {
  return jstDate(new Date(now.getTime() + days * 86_400_000))
}

/** 日本時間のカレンダーをUTCのgetterで読むための値。保存する瞬間には使わない。 */
export function jstCalendar(date: Date = new Date()): Date {
  return new Date(date.getTime() + 9 * 3_600_000)
}
export function jstMonthStart(now: Date = new Date()): string {
  return `${jstDate(now).slice(0, 7)}-01`
}
export function jstDayStartIso(now: Date = new Date(), offsetDays = 0): string {
  return new Date(`${jstDateOffset(offsetDays, now)}T00:00:00+09:00`).toISOString()
}
export function jstDateTimeLocal(now: Date = new Date()): string {
  return jstCalendar(now).toISOString().slice(0, 16)
}
export function jstTime(now: Date = new Date()): string {
  return jstDateTimeLocal(now).slice(11, 16)
}

/** 日本時間の当月。精算対象を端末の地域でずらさない。 */
export function jstMonthRange(now: Date = new Date()): { periodFrom: string; periodTo: string } {
  const calendar = jstCalendar(now)
  const start = Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth(), 1) - 9 * 3_600_000
  const next = Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, 1) - 9 * 3_600_000
  return { periodFrom: new Date(start).toISOString(), periodTo: new Date(next - 1).toISOString() }
}
