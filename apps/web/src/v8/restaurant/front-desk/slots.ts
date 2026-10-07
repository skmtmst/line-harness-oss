/*
 * 電話予約（E-2）とウォークイン（E-3）が共通で使う「空いている時刻・卓」の決まり。
 * 予約台帳の電話の予約（reservations/phone.tsx）と同じ決まり（2時間いる・期限切れの押さえは数えない・
 * 人数が入る卓のうち余る席がいちばん少ない卓）。口の自動配席（chooseRestaurantTable）とも同じ。
 */
import type { RestaurantOpeningDay } from '@line-crm/shared'
import type { RestaurantReservation, RestaurantTable } from '@/lib/restaurant-test-api'

export const STAY_MINUTES = 120
const FALLBACK_START = 17 * 60
const FALLBACK_END = 21 * 60
const INACTIVE = ['cancelled', 'no_show']

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function toYmd(day: Date): string {
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

export function slotLabel(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`
}

/** 卓の並び（コードの数の順）。 */
export function byCode(a: RestaurantTable, b: RestaurantTable): number {
  return a.code.localeCompare(b.code, 'ja', { numeric: true })
}

/** [start, end) とその卓の予約が重なるか。取消・無断と期限切れの押さえは数えない。 */
export function tableBusy(tableId: string, start: number, end: number, rows: RestaurantReservation[], now = Date.now()): boolean {
  return rows.some((r) => {
    if (r.table_id !== tableId || INACTIVE.includes(r.status)) return false
    if (r.status === 'pending' && r.hold_expires_at && Date.parse(r.hold_expires_at) <= now) return false
    return Date.parse(r.starts_at) < end && Date.parse(r.ends_at) > start
  })
}

/** その日・その時刻から2時間、人数が入る空いた卓（席の余りが少ない順）。 */
export function freeTables(tables: RestaurantTable[], guests: number, start: number, rows: RestaurantReservation[], now = Date.now()): RestaurantTable[] {
  const end = start + STAY_MINUTES * 60_000
  return tables
    .filter((t) => t.is_active && t.min_capacity <= guests && t.max_capacity >= guests && !tableBusy(t.id, start, end, rows, now))
    .sort((a, b) => (a.max_capacity - guests) - (b.max_capacity - guests) || byCode(a, b))
}

export function startOf(date: string, time: string): number {
  return new Date(`${date}T${time.padStart(5, '0')}:00`).getTime()
}

/**
 * 受けられる時刻：その曜日の開ける時間のうち、2時間いられる30分ごとの始まり。
 * 開ける時間が読めないときは 17:00〜21:00。今日は過ぎた時刻を出さない。
 */
export function openTimes(date: string, hours: RestaurantOpeningDay[] | null, now = new Date()): string[] {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = y && m && d ? new Date(y, m - 1, d).getDay() : -1
  const periods = hours?.find((day) => day.weekday === weekday)?.periods
  const list: number[] = []
  if (periods && periods.length > 0) {
    for (const period of periods) {
      for (let t = toMinutes(period.opensAt); t + STAY_MINUTES <= toMinutes(period.closesAt); t += 30) list.push(t)
    }
  } else if (!hours) {
    for (let t = FALLBACK_START; t <= FALLBACK_END; t += 30) list.push(t)
  }
  const today = toYmd(now) === date
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return list.filter((t) => !today || t > nowMinutes).map(slotLabel)
}

/** 卓の説明（「4名席・窓側」の形。窓側などの印は卓の名前から）。 */
export function tableNote(table: RestaurantTable): string {
  const seats = table.seat_type === 'counter' ? `カウンター ${table.max_capacity}席` : `${table.max_capacity}名席`
  return table.label && table.label !== table.code ? `${seats}・${table.label}` : seats
}
