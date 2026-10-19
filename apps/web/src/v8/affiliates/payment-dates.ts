import { jstCalendar as japanCalendar } from '@/lib/jst-datetime'
export function daysUntilClose(periodTo: string | null | undefined): number | null {
  if (!periodTo) return null
  const end = new Date(periodTo)
  if (Number.isNaN(end.getTime())) return null
  const nowJst = japanCalendar()
  const today = Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate())
  const endJst = japanCalendar(end)
  const closing = Date.UTC(endJst.getUTCFullYear(), endJst.getUTCMonth(), endJst.getUTCDate())
  return Math.round((closing - today) / 86_400_000)
}
