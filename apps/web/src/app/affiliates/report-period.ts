export type ReportPeriod = 'this_month' | 'last_month' | 'all'

/** 集計と表示の月境界を日本時間にそろえる。 */
export function reportMonthKey(shift: number, now = Date.now()): string {
  const jst = new Date(now + 9 * 3600_000)
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + shift, 1)).toISOString().slice(0, 7)
}

export function reportPeriodLabel(period: ReportPeriod, now = Date.now()): string {
  if (period === 'all') return 'すべての期間'
  const key = reportMonthKey(period === 'this_month' ? 0 : -1, now)
  const [year, month] = key.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${period === 'this_month' ? '今月' : '先月'}（${month}/1〜${month}/${lastDay}）`
}
