/*
 * ★V8 イベント予約で使う決まりごと。src/v8 は古い画面（src/app）と共通部品の外の
 * 処理を import しない決まりなので、今の作り（components/events/event-draft-shared.ts・jst.ts）と
 * 同じ値・同じ計算をここに写す。値を変えるときは両方を直す。
 */
import type { EventDetail } from '@/lib/api'

/** 作成の下書きの初期値（event-draft-shared.ts の EVENT_DEFAULT_DRAFT と同じ）。 */
export const EVENT_DEFAULT_DRAFT: EventDetail = {
  id: '',
  name: '',
  venue_name: null,
  venue_url: null,
  image_url: null,
  description: null,
  description_centered: 0,
  max_bookings_per_friend: null,
  requires_approval: 0,
  approval_deadline_hours: 24,
  cancel_deadline_hours_before: null,
  reminder_day_before_enabled: 1,
  reminder_hours_before: null,
  is_published: 0,
  sort_order: 0,
  confirmation_message_extra: null,
  reminder_message_extra: null,
  og_title: null,
  og_description: null,
  og_image_url: null,
  visible_tag_id: null,
  waitlist_enabled: 0,
  entry_cutoff_hours_before: null,
  version: 1,
}

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
  const [h, m] = hhmm.split(':').map(Number)
  const [y, mo, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d) + (h * 60 + m - 9 * 60) * 60_000).toISOString()
}

/** 今日（日本時間）の YYYY-MM-DD。 */
export function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

/** UTC の ISO → 日本時間の「10/12（月）」。 */
export function jstDay(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return '—'
  const jst = new Date(time + 9 * 3600_000)
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}（${WEEK[jst.getUTCDay()]}）`
}

/** UTC の ISO → 日本時間の「10:00」。 */
export function jstTime(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return '—'
  return new Date(time + 9 * 3600_000).toISOString().slice(11, 16)
}

/** UTC の ISO → 日本時間の「10/3 12:00」。 */
export function jstShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return '—'
  const jst = new Date(time + 9 * 3600_000)
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${jst.toISOString().slice(11, 16)}`
}
