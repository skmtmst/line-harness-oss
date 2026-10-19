import { jstDate } from '@/lib/jst-datetime'
import type { DashboardRange } from './model'



export function jstToday(): string {
  return jstDate()
}


export function shiftDate(ymd: string, range: DashboardRange, step: -1 | 1): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  if (range === 'month') d.setUTCMonth(d.getUTCMonth() + step)
  else d.setUTCDate(d.getUTCDate() + (range === 'week' ? 7 : 1) * step)
  return d.toISOString().slice(0, 10)
}
