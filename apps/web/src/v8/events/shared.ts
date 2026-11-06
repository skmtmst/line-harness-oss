import { jstCalendar as japanCalendar } from '@/lib/jst-datetime'

import { datetimeLocalJstToUtcIso, jstDate } from '@/lib/jst-datetime'
/** 作成・編集が同じ保存の既定値を使う。画面の見た目とは独立した契約。 */
export { EVENT_DEFAULT_DRAFT } from '@/components/events/event-draft-shared'

/** select で null（期限なし・制限なし）を表す値。 */
export const NONE = 'none'

/** 申込の締め切り（entry_cutoff_hours_before）。null = 開始まで受け付ける。 */
export const ENTRY_CUTOFF_OPTIONS = [
  { value: NONE, label: '開始まで受け付ける' },
  { value: '1', label: '開始の 1 時間前まで' },
  { value: '2', label: '開始の 2 時間前まで' },
  { value: '3', label: '開始の 3 時間前まで' },
  { value: '24', label: '開始の 1 日前まで' },
  { value: '48', label: '開始の 2 日前まで' },
  { value: '168', label: '開始の 1 週間前まで' },
]

/** 日本時間の日付（YYYY-MM-DD）と時刻（HH:MM）→ UTC の ISO。 */
export function jstToUtcIso(date: string, hhmm: string): string {
  return datetimeLocalJstToUtcIso(`${date}T${hhmm}`)
}

/** 今日（日本時間）の YYYY-MM-DD。 */
export function todayJst(): string {
  return jstDate()
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

/** UTC の ISO → 日本時間の「10/12（月）」。 */
export function jstDay(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return '—'
  const jst = japanCalendar(new Date(time))
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}（${WEEK[jst.getUTCDay()]}）`
}

/** UTC の ISO → 日本時間の「10:00」。 */
export function jstTime(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return '—'
  return japanCalendar(new Date(time)).toISOString().slice(11, 16)
}

/** UTC の ISO → 日本時間の「10/3 12:00」。 */
export function jstShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return '—'
  const jst = japanCalendar(new Date(time))
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${jst.toISOString().slice(11, 16)}`
}
