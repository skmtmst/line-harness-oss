/**
 * イベントの日時まわり。
 *
 * 枠の時刻は DB では UTC、画面では JST。変換をタブ側とウィザード側で
 * それぞれ書くと、片方だけ 9 時間ずれたときに気づけないので 1 か所に置く。
 */

/** 「2026-09-05」＋「14:00」（JST）→ UTC の ISO 文字列。 */
export function jstHHMMToUtcIso(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const totalMin = h * 60 + m - 9 * 60
  const [y, mo, d] = date.split('-').map(Number)
  const t = Date.UTC(y, mo - 1, d) + totalMin * 60_000
  return new Date(t).toISOString()
}

const WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土']

/**
 * UTC の ISO → 「9月5日(土) 14:00〜15:30」。設計の枠表とプレビューで使う。
 *
 * 日をまたぐ枠は終了側の日付も出す(DETAIL-10)。以前は「9月20日(日)
 * 23:30〜01:00」と終了日が読めず、翌日なのか当日の深夜なのか区別が
 * 付かなかった。同じ日なら従来どおり時刻だけにする。
 */
export function formatSlotJp(startsAt: string, endsAt: string): string {
  const s = new Date(new Date(startsAt).getTime() + 9 * 3600_000)
  const e = new Date(new Date(endsAt).getTime() + 9 * 3600_000)
  const hhmm = (d: Date) =>
    `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  const day = (d: Date) => `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEKDAY_JP[d.getUTCDay()]})`
  const sameDay =
    s.getUTCFullYear() === e.getUTCFullYear() &&
    s.getUTCMonth() === e.getUTCMonth() &&
    s.getUTCDate() === e.getUTCDate()
  return `${day(s)} ${hhmm(s)}〜${sameDay ? '' : `${day(e)} `}${hhmm(e)}`
}

/** 今日（JST）の YYYY-MM-DD。日付入力の初期値。 */
export function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}

/** 「14:00〜17:00 を 90 分ずつ」→ [14:00-15:30, 15:30-17:00]。端数は切り捨てる。 */
export function splitBand(
  start: string,
  end: string,
  minutes: number,
): Array<{ start: string; end: string }> {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
  }
  const toHHMM = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  const from = toMin(start)
  const to = toMin(end)
  const out: Array<{ start: string; end: string }> = []
  if (!Number.isFinite(from) || !Number.isFinite(to) || minutes <= 0) return out
  for (let t = from; t + minutes <= to; t += minutes) {
    out.push({ start: toHHMM(t), end: toHHMM(t + minutes) })
  }
  return out
}
