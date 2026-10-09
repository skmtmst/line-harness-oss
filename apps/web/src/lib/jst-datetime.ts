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
