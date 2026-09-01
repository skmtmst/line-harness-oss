/**
 * 受付時間の格子（設計 `tksPc`）。
 *
 * 設計は曜日×時間の格子で見せる。いまは曜日ごとの1行で、
 * **「何曜の何時なら受け付けるか」を見比べられない。**
 *
 * **特別な日を「休業」と決めつけない。** 画面の見出しは
 * 「特別な休み・**営業**」で、開ける日も閉める日も同じ表に入る。
 * どちらかは口が言っていないので、格子では件数だけを示して一覧へ渡す。
 */

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
export type DayHours = { start: string; end: string } | null
export type WeeklyTemplate = Record<DayKey, DayHours>

export const GRID_DAYS: ReadonlyArray<{ key: DayKey; weekday: number; label: string }> = [
  { key: 'sun', weekday: 0, label: '日' },
  { key: 'mon', weekday: 1, label: '月' },
  { key: 'tue', weekday: 2, label: '火' },
  { key: 'wed', weekday: 3, label: '水' },
  { key: 'thu', weekday: 4, label: '木' },
  { key: 'fri', weekday: 5, label: '金' },
  { key: 'sat', weekday: 6, label: '土' },
]

function toMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * 格子に出す時間帯。**受け付ける時間が入っている幅だけを出す。**
 * 0時から23時まで並べると、ほとんど空の格子になって読みにくい。
 */
export function gridHours(template: WeeklyTemplate): number[] {
  const starts: number[] = []
  const ends: number[] = []
  for (const day of GRID_DAYS) {
    const hours = template[day.key]
    if (!hours) continue
    const s = toMinutes(hours.start)
    const e = toMinutes(hours.end)
    if (s === null || e === null || e <= s) continue
    starts.push(Math.floor(s / 60))
    ends.push(Math.ceil(e / 60))
  }
  if (starts.length === 0) return []
  const from = Math.min(...starts)
  const to = Math.max(...ends)
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i)
}

/** その曜日のその時間に受け付けるか。**開始ちょうどは入り、終了ちょうどは入らない。** */
export function isOpenAt(hours: DayHours, hour: number): boolean {
  if (!hours) return false
  const s = toMinutes(hours.start)
  const e = toMinutes(hours.end)
  if (s === null || e === null || e <= s) return false
  const cellStart = hour * 60
  const cellEnd = cellStart + 60
  return cellStart < e && cellEnd > s
}

/**
 * 曜日ごとの特別な日の件数。
 * **休みか営業かは言わない。** 口がどちらかを返していない。
 */
export function specialCountByDay(
  dates: ReadonlyArray<{ work_date: string }>,
): Record<DayKey, number> {
  const counts = Object.fromEntries(GRID_DAYS.map((d) => [d.key, 0])) as Record<DayKey, number>
  for (const row of dates) {
    /*
      **`getDay()` は見ている人の時計で曜日を出す。**
      この日付は暦の日（`YYYY-MM-DD`）で、時刻も時差も持っていない。
      時差のある場所から見ると1日ずれて、別の曜日に数えられる
      （開発機がUTC+7で、月曜が日曜に化けた）。
      暦日として読むために UTC で組み立てて UTC で曜日を取る。
    */
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.work_date.trim())
    if (!m) continue
    const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    if (Number.isNaN(at.getTime())) continue
    const day = GRID_DAYS.find((d) => d.weekday === at.getUTCDay())
    if (day) counts[day.key] += 1
  }
  return counts
}
