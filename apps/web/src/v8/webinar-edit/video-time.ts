import { jstCalendar as japanCalendar } from '@/lib/jst-datetime'
import { datetimeLocalJstToUtcIso } from '@/lib/jst-datetime'

/** datetime-local の字面を JST で（`2026-10-01T10:00`）。 */
export function localJst(value: string | null | undefined): string {
  if (!value) return ''
  const time = Date.parse(value)
  return Number.isNaN(time) ? '' : japanCalendar(new Date(time)).toISOString().slice(0, 16)
}
export function toJstIso(local: string): string {
  return datetimeLocalJstToUtcIso(local)
}
