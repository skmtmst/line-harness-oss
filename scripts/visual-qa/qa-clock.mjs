/** 見本の日時を生成するサーバーと、撮影するブラウザが共有する時計。 */
export const QA_CLOCK = '2026-10-01T03:00:00.000Z'
export const QA_TIMEZONE = 'Asia/Tokyo'

export function storeYmd(value, timezone = QA_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

/** 店舗の暦の時刻をUTCへ変換する。端末のgetHours/setHoursには依存しない。 */
export function storeAt(hour, minute = 0, dayOffset = 0, timezone = QA_TIMEZONE) {
  const [y, m, d] = storeYmd(QA_CLOCK, timezone).split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d + dayOffset, hour, minute)
  let instant = wall
  for (let i = 0; i < 3; i += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant))
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
    const shown = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second))
    const next = instant + wall - shown
    if (next === instant) return new Date(instant).toISOString()
    instant = next
  }
  throw new Error(`店舗の時刻を決められません: ${timezone}`)
}

export function captureClockFor(route, override) {
  return override ?? (/^\/(?:restaurant-test|reminders)(?:[/?]|$)/.test(route) ? QA_CLOCK : null)
}
