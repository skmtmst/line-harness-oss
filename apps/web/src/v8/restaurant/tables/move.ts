/*
 * 卓を止めるときに、先の予約を移す先を選ぶ（板 `eY9F3`「同じ人数が入る別の卓へ自動で移す」）。
 * 自動配席ルールと同じ考え：人数が入る稼働中の卓のうち、余る席がいちばん少ない卓。
 * 同じ時間に重なる予約がある卓は外す（サーバも重なりを 409 で断る）。
 */
import type { RestaurantReservation, RestaurantTable } from '@/lib/restaurant-test-api'

const INACTIVE = new Set(['cancelled', 'no_show', 'completed', 'visited'])

export function overlaps(a: RestaurantReservation, b: RestaurantReservation): boolean {
  const aFrom = new Date(a.starts_at).getTime()
  const aTo = new Date(a.ends_at).getTime()
  const bFrom = new Date(b.starts_at).getTime()
  const bTo = new Date(b.ends_at).getTime()
  if ([aFrom, aTo, bFrom, bTo].some((value) => Number.isNaN(value))) return false
  return aFrom < bTo && bFrom < aTo
}

export function pickMoveTarget(
  reservation: RestaurantReservation,
  candidates: RestaurantTable[],
  taken: RestaurantReservation[],
): RestaurantTable | null {
  const fits = candidates
    .filter((table) => table.is_active && table.max_capacity >= reservation.guest_count && table.min_capacity <= reservation.guest_count)
    .filter((table) => !taken.some((item) => item.table_id === table.id && item.id !== reservation.id && !INACTIVE.has(item.status) && overlaps(item, reservation)))
    .sort((a, b) => (a.max_capacity - reservation.guest_count) - (b.max_capacity - reservation.guest_count) || a.code.localeCompare(b.code))
  return fits[0] ?? null
}

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

/** 「10/3（土）19:00 山田 花子 4名」 */
export function reservationLine(item: RestaurantReservation, timezone?: string): string {
  const date = new Date(item.starts_at)
  if (Number.isNaN(date.getTime())) return `${item.customer_name} ${item.guest_count}名`
  if (timezone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('ja-JP', { timeZone: timezone, month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(({ type, value }) => [type, value]))
    return `${Number(parts.month)}/${Number(parts.day)}（${parts.weekday}）${Number(parts.hour)}:${parts.minute} ${item.customer_name} ${item.guest_count}名`
  }
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${date.getMonth() + 1}/${date.getDate()}（${WEEKDAY[date.getDay()]}）${time} ${item.customer_name} ${item.guest_count}名`
}
