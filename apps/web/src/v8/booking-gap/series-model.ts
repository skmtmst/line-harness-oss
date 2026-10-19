import { jstCalendar as japanCalendar } from '@/lib/jst-datetime'
import type { RecurrenceFrequency as SeriesFreq, SeriesOccurrence } from '@line-crm/shared'

/** 繰り返しの予約の言葉と並べ方（言葉の表：繰り返す・毎週・隔週・毎月第 N 曜・飛ばす。「シリーズ」「定期」は使わない）。 */
export const FREQ_OPTIONS: { value: SeriesFreq; label: string }[] = [
  { value: 'weekly', label: '毎週' },
  { value: 'biweekly', label: '隔週' },
  { value: 'monthly_nth', label: '毎月' },
]
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const jst = (iso: string) => japanCalendar(new Date(iso))
export const weekdayOf = (iso: string) => jst(iso).getUTCDay()
export const timeOf = (iso: string) => { const d = jst(iso); return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
export const dayOf = (iso: string) => { const d = jst(iso); return `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, '0')}` }
export const dayWithWeekday = (iso: string) => `${dayOf(iso)}（${WEEK[weekdayOf(iso)]}）`
export const hm = (iso: string) => { const d = jst(iso); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
export const firstDay = (iso: string) => { const d = jst(iso); return `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, '0')}` }

/** 「毎週金曜 14:00」「隔週金曜 14:00」「毎月第 3 金曜 14:00」。 */
export function ruleLabel(freq: SeriesFreq, startsAt: string): string {
  const wd = `${WEEK[weekdayOf(startsAt)]}曜`
  if (freq === 'monthly_nth') return `毎月第 ${Math.floor((jst(startsAt).getUTCDate() - 1) / 7) + 1} ${wd} ${hm(startsAt)}`
  return `${freq === 'weekly' ? '毎週' : '隔週'}${wd} ${hm(startsAt)}`
}

export type Pick = 'keep' | 'alternative' | 'skip'
export const initialPick = (o: SeriesOccurrence): Pick => (o.available ? 'keep' : o.alternatives.length > 0 ? 'alternative' : 'skip')
/** 作る件数＝取れた回＋「別の時間」を選んだ回（飛ばす回は数えない）。 */
export function createdCount(list: SeriesOccurrence[], picks: Record<number, Pick>): number {
  return list.filter((o) => (o.available ? true : (picks[o.index] ?? 'skip') === 'alternative' && o.alternatives.length > 0)).length
}

/** 口が返す取れない理由の言葉。知らない理由は「空きがありません」。 */
export function reasonText(reason: string | null): string {
  if (reason === 'calendar_unreadable') return '空きを確かめられません'
  return '空きがありません'
}
