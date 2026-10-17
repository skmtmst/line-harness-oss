import type { DashboardRange } from './model'



export function jstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}


export function shiftDate(ymd: string, range: DashboardRange, step: -1 | 1): string {
  const d = new Date(`${ymd}T00:00:00+09:00`)
  if (range === 'month') d.setUTCMonth(d.getUTCMonth() + step)
  else d.setUTCDate(d.getUTCDate() + (range === 'week' ? 7 : 1) * step)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
