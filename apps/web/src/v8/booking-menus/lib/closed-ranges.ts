/*
 * 休業日（範囲の休み）の日付の扱い（監査 WEB056）。
 *
 * 範囲を日ごとに広げて最大31日で打ち切ると、それより長い休み（年末年始・改装など）の
 * 32日目から先が、カレンダーの印からも「入っている予約」の数からも落ちる。
 * 日付は広げずに、範囲そのもので「その日が休みか」を調べる。
 */
import type { BookingException } from '@/lib/api'

export interface ClosedRange {
  from: string
  to: string
  item: BookingException
}

/** 休み（kind=closed）の範囲。日付の無いものは除く。from>to は from だけの1日に寄せる。 */
export function closedRanges(exceptions: BookingException[]): ClosedRange[] {
  const ranges: ClosedRange[] = []
  for (const item of exceptions) {
    if (item.kind !== 'closed') continue
    const from = item.dateFrom || item.date || ''
    if (!from) continue
    const rawTo = item.dateTo || item.date || from
    ranges.push({ from, to: rawTo < from ? from : rawTo, item })
  }
  return ranges.sort((a, b) => a.from.localeCompare(b.from))
}

/** その日（YYYY-MM-DD）を休みにしている例外。無ければ undefined。 */
export function closedOn(ranges: ClosedRange[], day: string): BookingException | undefined {
  return ranges.find((range) => range.from <= day && day <= range.to)?.item
}

/** すべての休みを覆う最初の日と最後の日。休みが無ければ null。 */
export function closedSpan(ranges: ClosedRange[]): { from: string; to: string } | null {
  if (ranges.length === 0) return null
  let from = ranges[0].from
  let to = ranges[0].to
  for (const range of ranges) {
    if (range.from < from) from = range.from
    if (range.to > to) to = range.to
  }
  return { from, to }
}
