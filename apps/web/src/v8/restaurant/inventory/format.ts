/*
 * 予約枠・在庫（Y8SjT2 ほか）の表示の形。今の画面（app/restaurant-test/v8/inventory.tsx）から写し、
 * 絵の書き方（「19:00 の卓」「10/2・金」「T1〜T4」）に合わせた。
 */
import type { RestaurantTable } from '@/lib/restaurant-test-api'

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

export function slotTimeLabel(startsAt: string): string {
  const date = new Date(startsAt)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 「10/2・金」 */
export function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ''
  const date = new Date(y, m - 1, d)
  return `${m}/${d}・${WEEKDAY[date.getDay()]}`
}

/** 「10/2（金）」 */
export function dayLabelParen(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ''
  const date = new Date(y, m - 1, d)
  return `${m}/${d}（${WEEKDAY[date.getDay()]}）`
}

/** 「10/2 18:42」 */
export function formatAt(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 「14:02」 */
export function formatTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 「中川 由美」→「中川さん」 */
export function sanName(name: string | null | undefined): string {
  if (!name) return 'ほかの担当者'
  return `${name.split(/\s+/)[0]}さん`
}

const SEAT_ORDER: Record<string, number> = { private_room: 0, table: 1, counter: 2, terrace: 3 }

export function tableOrder(a: RestaurantTable, b: RestaurantTable): number {
  return (SEAT_ORDER[a.seat_type] ?? 9) - (SEAT_ORDER[b.seat_type] ?? 9) || a.code.localeCompare(b.code, 'ja', { numeric: true })
}

/**
 * 埋まっている卓の並び。個室→テーブル→カウンターの順。
 * 同じ頭の連番が3つ以上続くときは「T1〜T4」と縮める（2つまでは「T3・T4」）。
 */
export function joinTableCodes(tables: RestaurantTable[]): string {
  const sorted = [...tables].sort(tableOrder)
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    const head = /^(.*?)(\d+)$/.exec(sorted[i].code)
    let j = i
    if (head) {
      while (j + 1 < sorted.length) {
        const next = /^(.*?)(\d+)$/.exec(sorted[j + 1].code)
        const cur = /^(.*?)(\d+)$/.exec(sorted[j].code)
        if (!next || !cur || next[1] !== head[1] || Number(next[2]) !== Number(cur[2]) + 1) break
        j += 1
      }
    }
    if (j - i >= 2) {
      parts.push(`${sorted[i].code}〜${sorted[j].code}`)
      i = j + 1
    } else {
      parts.push(sorted[i].code)
      i += 1
    }
  }
  return parts.join('・')
}

/** 曜日の表示順（月〜日）。weekday は 0=日。 */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
export const WEEKDAY_LABEL = WEEKDAY
