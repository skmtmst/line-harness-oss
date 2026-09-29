import type { EventLifecycleStatus, EventListItem } from '@/lib/api'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * U: 保存する状態が無い旧応答は is_published から読み替える
 * （公開済み=公開中、それ以外=下書き）。両書きしているので数は合う。
 */
export function lifecycleOf(item: Pick<EventListItem, 'is_published' | 'lifecycle_status'>): EventLifecycleStatus {
  if (item.lifecycle_status === 'draft' || item.lifecycle_status === 'published'
    || item.lifecycle_status === 'paused' || item.lifecycle_status === 'ended'
    || item.lifecycle_status === 'cancelled') {
    return item.lifecycle_status
  }
  return item.is_published === 1 ? 'published' : 'draft'
}

export interface EventAttentionSummary {
  upcoming: EventListItem[]
  applied: number
  capacity: number
  fillRate: number | null
  nearlyFull: EventListItem[]
  lowApplications: EventListItem[]
}

function startsAt(item: EventListItem): number | null {
  if (!item.next_slot_starts_at) return null
  const parsed = Date.parse(item.next_slot_starts_at)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 一覧がすでに持つ回ごとの定員と申込数だけで、次に声をかける回を決める。
 *
 * - あと少しで満席: 受付中で残り1〜3席
 * - 申し込みが少ない: 7日以内で、定員の半分未満
 *
 * 閾値を画面の中へ散らすと、札・絞り込み・試験で数が食い違うためここへ寄せる。
 */
export function summarizeEventAttention(
  items: EventListItem[],
  nowMs = Date.now(),
): EventAttentionSummary {
  const upcoming = items
    .filter((item) => lifecycleOf(item) === 'published')
    .filter((item) => {
      const start = startsAt(item)
      return start !== null && start >= nowMs
    })
    .sort((a, b) => (startsAt(a) ?? Number.MAX_SAFE_INTEGER) - (startsAt(b) ?? Number.MAX_SAFE_INTEGER))

  const withCapacity = upcoming.filter(
    (item) => item.total_capacity !== null && item.total_capacity > 0,
  )
  const applied = upcoming.reduce((sum, item) => sum + item.total_active, 0)
  const capacity = withCapacity.reduce((sum, item) => sum + (item.total_capacity ?? 0), 0)
  const filled = withCapacity.reduce((sum, item) => sum + item.total_active, 0)

  const nearlyFull = withCapacity.filter((item) => {
    const remaining = (item.total_capacity ?? 0) - item.total_active
    return remaining >= 1 && remaining <= 3
  })

  const lowApplications = withCapacity.filter((item) => {
    const start = startsAt(item)
    if (start === null || start > nowMs + 7 * DAY_MS) return false
    return item.total_active / (item.total_capacity ?? 1) < 0.5
  })

  return {
    upcoming,
    applied,
    capacity,
    fillRate: capacity > 0 ? Math.round((filled / capacity) * 100) : null,
    nearlyFull,
    lowApplications,
  }
}

export function daysUntilEvent(item: EventListItem, nowMs = Date.now()): number | null {
  return daysUntilIso(item.next_slot_starts_at, nowMs)
}

/** 開催日時の ISO 文字列までの日数。全体集計の日付にも使う。 */
export function daysUntilIso(iso: string | null, nowMs = Date.now()): number | null {
  if (!iso) return null
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.ceil((parsed - nowMs) / DAY_MS))
}

/**
 * U: 一覧・編集の状態印の決め方。保存する状態が正本で、「満席」だけが
 * 計算の札（R81: 公開中でも今後の枠が無ければ終了）。
 */
export type EventRowState = 'draft' | 'paused' | 'cancelled' | 'ended' | 'full' | 'open'

export function eventRowState(item: Pick<EventListItem, 'is_published' | 'lifecycle_status' | 'next_slot_starts_at' | 'total_capacity' | 'total_active'>): EventRowState {
  const lifecycle = lifecycleOf(item)
  if (lifecycle === 'draft') return 'draft'
  if (lifecycle === 'paused') return 'paused'
  if (lifecycle === 'cancelled') return 'cancelled'
  if (lifecycle === 'ended') return 'ended'
  if (!item.next_slot_starts_at) return 'ended'
  if (item.total_capacity != null && item.total_active >= item.total_capacity) return 'full'
  return 'open'
}

/**
 * U: 行ごとの「申し込みが少ない」札の決め方。一覧上部の集計
 * （summarizeEventAttention の lowApplications）と同じ値にすること。
 * 片方だけ変えると数が食い違う。
 */
export function isLowApplication(
  item: Pick<EventListItem, 'lifecycle_status' | 'is_published' | 'next_slot_starts_at' | 'total_capacity' | 'total_active'>,
  nowMs = Date.now(),
): boolean {
  if (lifecycleOf(item) !== 'published') return false
  if (item.total_capacity == null || item.total_capacity <= 0) return false
  if (item.total_active >= item.total_capacity) return false
  const parsed = item.next_slot_starts_at ? Date.parse(item.next_slot_starts_at) : NaN
  if (!Number.isFinite(parsed) || parsed > nowMs + 7 * DAY_MS) return false
  return item.total_active / item.total_capacity < 0.5
}

/**
 * 申込者一覧の帯で、定員の数を「次に何をするか」へ変える。
 * 一覧の「あと少しで満席」と同じく、残り1〜3席を声かけの目安にする。
 */
export function describeBookingCapacity(applied: number, capacity: number | null): string {
  if (capacity === null || capacity <= 0) return '定員なし'
  const remaining = Math.max(0, capacity - applied)
  if (remaining === 0) return `定員 ${capacity} ・ 満席です`
  if (remaining <= 3) return `あと${remaining}人で満席です。声をかけると埋まります`
  return `定員 ${capacity} ・ 残り${remaining}`
}
