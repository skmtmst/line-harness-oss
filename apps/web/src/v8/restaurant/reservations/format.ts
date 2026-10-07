/*
 * 予約台帳（l9NlC0・Z3FoM・rm92Y・xzCK6）の表示の形。今の画面
 * （app/restaurant-test/v8/reservations.tsx・reservation-phone.tsx）から写し、絵の書き方に合わせた。
 */
import type { RestaurantReservation, RestaurantTable } from '@/lib/restaurant-test-api'

export type LedgerView = 'today' | 'week' | 'month' | 'list'

export const INACTIVE_STATUSES = ['cancelled', 'no_show']

export const SOURCE_LABEL: Record<string, string> = {
  restaurant_board: 'レストランボード', reszaiko: 'RESZAIKO', hotpepper: 'Hot Pepper',
  tabelog: '食べログ', gurunavi: 'ぐるなび', ikyu: '一休', retty: 'Retty',
  line: 'LINE', phone: '電話', manual: '手動', google_business_profile: 'Google',
}

/** 予約元の色の組。LINE・レストランボード＝緑、予約媒体＝赤、電話・手動＝灰。 */
export function sourceKind(source: string): 'line' | 'media' | 'phone' {
  if (source === 'line' || source === 'restaurant_board') return 'line'
  if (source === 'phone' || source === 'manual') return 'phone'
  return 'media'
}

export function sourceName(source: string): string {
  return SOURCE_LABEL[source] ?? source
}

/** 押さえ（期限付きの仮押さえ）か。 */
export function isHold(item: RestaurantReservation): boolean {
  return item.status === 'pending' && Boolean(item.hold_expires_at)
}

/** 「秋の鹿肉コース」→「秋の鹿肉」（箱と次の予約は短く）。 */
export function shortCourse(name: string | null): string {
  if (!name) return '席のみ'
  return name.replace(/コース$/, '')
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function toYmd(day: Date): string {
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`
}

export function hm(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getHours()}:${pad2(date.getMinutes())}`
}

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

/** 「10月2日（金）」 */
export function dayTitle(day: Date): string {
  return `${day.getMonth() + 1}月${day.getDate()}日（${WEEKDAY[day.getDay()]}）`
}

/** 「10月2日」 */
export function dayShort(day: Date): string {
  return `${day.getMonth() + 1}月${day.getDate()}日`
}

/** 「10/2 18:00」 */
export function mdhm(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1}/${date.getDate()} ${hm(date)}`
}

/** 「10/2（金）」 */
export function mdWeek(day: Date): string {
  return `${day.getMonth() + 1}/${day.getDate()}（${WEEKDAY[day.getDay()]}）`
}

/** 電話番号は真ん中を伏せる（「090-****-1234」）。 */
export function maskPhone(phone: string | null): string {
  if (!phone) return ''
  const parts = phone.split('-')
  if (parts.length === 3) return `${parts[0]}-****-${parts[2]}`
  return phone
}

export function dayRange(day: Date): { from: string; to: string } {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0)
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0, 0)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function monthRange(day: Date): { from: string; to: string } {
  const from = new Date(day.getFullYear(), day.getMonth(), 1, 0, 0, 0, 0)
  const to = new Date(day.getFullYear(), day.getMonth() + 1, 1, 0, 0, 0, 0)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function weekRange(day: Date): { from: string; to: string } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7), 0, 0, 0, 0)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7, 0, 0, 0, 0)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** 卓の並び：座席・卓管理のフロアの並び（行→列）。 */
export function floorOrder(a: RestaurantTable, b: RestaurantTable): number {
  return a.floor_y - b.floor_y || a.floor_x - b.floor_x || a.code.localeCompare(b.code, 'ja', { numeric: true })
}

export function minutesOf(value: string): number {
  const date = new Date(value)
  return date.getHours() * 60 + date.getMinutes()
}

export function slotLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${pad2(minutes % 60)}`
}
