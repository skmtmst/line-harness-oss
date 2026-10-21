import { eventsApi, type EventBookingItem } from '@/lib/api'
import type { StyleRoster } from './model'

/** 展開表示と全員操作のため、表示用の7人に切らずページを読み切る。 */
export async function loadLessonBookings(accountId: string, eventId: string, slotId: string, signal: AbortSignal): Promise<EventBookingItem[]> {
  const items: EventBookingItem[] = []
  for (let page = 1; ; page += 1) {
    const response = await eventsApi.listBookings(accountId, eventId, { slot_id: slotId, limit: 50, page }, { signal })
    if (signal.aborted) throw new Error('名簿の読み込みを中止しました')
    items.push(...response.items)
    if (items.length >= response.total) return items
    if (response.items.length === 0) throw new Error('名簿の続きを読み込めませんでした')
  }
}

export function lessonRosterMembers(items: EventBookingItem[]): StyleRoster['members'] {
  return items.map(b => ({
    name: b.friend_display_name ?? b.friend_name ?? '名前なし',
    sub: b.is_first_time ? '初めて' : b.status === 'cancelled' ? '取消' : '会員',
    pay: { label: '—', tone: 'neutral' },
    attend: b.cancelled_at ? 'cancel' : b.status === 'attended' ? 'done' : b.status === 'no_show' ? 'absent' : 'button',
    bookingId: b.id,
    eventId: b.event_id,
  }))
}

/** 個別更新の識別子は予約ID。名前なし・同名の人も混ざらない。 */
export function attendanceTargets(roster: StyleRoster, bookingId: string | null) {
  return roster.members.filter(m => m.attend === 'button' && (bookingId === null || m.bookingId === bookingId) && m.bookingId && m.eventId)
}
