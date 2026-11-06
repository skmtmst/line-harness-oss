'use client'

import { jstCalendar as japanCalendar } from '@/lib/jst-datetime'
import { requiredText } from '@/lib/form-requirement'
import { formatDate as polishFormatDate } from '@/lib/format'
import { jstDate } from '@/lib/jst-datetime'


export const b244Requirements = {
  changeReason: requiredText("変える理由を入力してください"),
  draft_date: requiredText("開始日を入れてください"),
}

/** 履歴の日時（ISO）を日本時間の「9/01 10:00」の形にする。 */
export function historyStamp(value: string): string {
  return polishFormatDate(value, { style: 'list', fallback: '—' })
}

/** 「いま」より前は予約できない。入れた瞬間に当たって、予約に見えない。 */
export function jstNowLocalInput(): { date: string; time: string } {
  const now = new Date()
  const jst = japanCalendar(now).toISOString()
  return { date: jstDate(now), time: jst.slice(11, 16) }
}

export function utcToJstLocalInput(value: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return ''
  return japanCalendar(parsed).toISOString().slice(0, 16)
}

/** 競合の帯の時刻。「14:02」の形（板 ）。 */
export function formatHourMinute(value: string): string | null {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  const jst = japanCalendar(parsed)
  return `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
}


/** 札の色。配信予約中は金、止めた・下書きは灰、期限切れは黄。 */
export function usageTone(status: string): 'warning' | 'neutral' | 'info' {
  if (/配信予約中|配信中/.test(status)) return 'warning'
  if (/停止中|止めた|下書き/.test(status)) return 'neutral'
  return 'info'
}
