import type { ReservationBoardEntry } from '@line-crm/shared'

export type BookingState = 'confirmed' | 'active' | 'completed' | 'pending' | 'attention' | 'warning' | 'closed'

export const bookingStateLabels: Record<BookingState, string> = {
  confirmed: '確定', active: '来店中・進行中', completed: '終了・来店済み',
  pending: '承認待ち・仮押さえ', attention: '要対応', warning: '注意', closed: '休み',
}

/** 経路や現在時刻から来店を推測せず、記録された状態を表示する。 */
export function reservationBookingState(entry: Pick<ReservationBoardEntry, 'status' | 'holdExpiresAt' | 'arrivedAt' | 'departedAt'>): BookingState {
  if (entry.status === 'no_show') return 'attention'
  if (entry.departedAt || ['completed', 'done', 'cancelled', 'rejected', 'expired'].includes(entry.status)) return 'completed'
  if (entry.holdExpiresAt || ['requested', 'pending'].includes(entry.status)) return 'pending'
  if (entry.arrivedAt || ['seated', 'visited', 'active', 'in_progress'].includes(entry.status)) return 'active'
  if (['late', 'expiring'].includes(entry.status)) return 'warning'
  return 'confirmed'
}

export function calendarBookingState(state: string): BookingState {
  return ({ booked: 'confirmed', done: 'completed', off: 'closed' } as Record<string, BookingState>)[state] ??
    (state in bookingStateLabels ? state as BookingState : 'confirmed')
}

/** 実在する次の予約の開始までの分数。重なる場合は0。 */
export function reservationGapMinutes(entry: Pick<ReservationBoardEntry, 'endsAt'>, next: Pick<ReservationBoardEntry, 'startsAt'>): number {
  return Math.max(0, Math.floor((Date.parse(next.startsAt) - Date.parse(entry.endsAt)) / 60000))
}
