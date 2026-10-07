/*
 * 「今日のお店」（E-1）と「枠を閉じる知らせ」（E-5）の数え方。画面から切り離して試験する。
 */
import type { RestaurantChannelCloseTask } from '@line-crm/shared'
import type { RestaurantReservation, RestaurantTable } from '@/lib/restaurant-test-api'
import { isWalkIn } from '../front-desk/walk-in'
import { pad2, tableBusy } from '../front-desk/slots'
import type { StoreMedium } from './use-store-today'

const INACTIVE = ['cancelled', 'no_show']

/** 予約の口は owner・admin・staff に開いている。それ以外（閲覧のみ）には押すボタンを置かない。 */
export function canWriteRole(role: string | null): boolean {
  return role === null || role === 'owner' || role === 'admin' || role === 'staff'
}

export type TodaySummary = {
  /** 取消・無断・押さえを除いた今日の予約の組数。 */
  groups: number
  /** その人数の合計。 */
  guests: number
  line: number
  phone: number
  walkIn: number
  media: number
  /** いちばん人が多い時（00分の1時間ごと）。予約が無ければ null。 */
  peak: { label: string; guests: number } | null
  /** いま空いている卓（動いている卓のうち、いま予約が重なっていない卓）。 */
  freeTables: number
  totalTables: number
  counterSeats: number
}

function isHold(r: RestaurantReservation): boolean {
  return r.status === 'pending' && Boolean(r.hold_expires_at)
}

export function liveReservations(rows: RestaurantReservation[]): RestaurantReservation[] {
  return rows.filter((r) => !INACTIVE.includes(r.status) && !isHold(r))
}

export function summarizeToday(rows: RestaurantReservation[], tables: RestaurantTable[], now: number): TodaySummary {
  const live = liveReservations(rows)
  const walkIn = live.filter(isWalkIn).length
  const line = live.filter((r) => r.source === 'line').length
  const phone = live.filter((r) => r.source === 'phone' || (r.source === 'manual' && !isWalkIn(r))).length
  const byHour = new Map<number, number>()
  for (const r of live) {
    const hour = new Date(r.starts_at).getHours()
    byHour.set(hour, (byHour.get(hour) ?? 0) + r.guest_count)
  }
  let peak: TodaySummary['peak'] = null
  for (const [hour, guests] of [...byHour.entries()].sort((a, b) => a[0] - b[0])) {
    if (!peak || guests > peak.guests) peak = { label: `${pad2(hour)}:00`, guests }
  }
  const active = tables.filter((t) => t.is_active)
  return {
    groups: live.length,
    guests: live.reduce((sum, r) => sum + r.guest_count, 0),
    line,
    phone,
    walkIn,
    media: live.length - line - phone - walkIn,
    peak,
    freeTables: active.filter((t) => !tableBusy(t.id, now, now + 1, rows, now)).length,
    totalTables: active.length,
    counterSeats: active.filter((t) => t.seat_type === 'counter').reduce((sum, t) => sum + t.max_capacity, 0),
  }
}

/** 予約の状態の札：来店済み・予約中・取消・無断キャンセル。 */
export function visitState(r: RestaurantReservation): { label: string; tone: 'success' | 'info' | 'neutral' | 'danger' | 'warning' } {
  if (r.status === 'seated' || r.status === 'visited') return { label: '来店済み', tone: 'success' }
  if (r.status === 'cancelled') return { label: '取消', tone: 'neutral' }
  if (r.status === 'no_show') return { label: '無断キャンセル', tone: 'danger' }
  if (isHold(r)) return { label: '押さえ', tone: 'neutral' }
  if (r.status === 'pending') return { label: '承認待ち', tone: 'warning' }
  return { label: '予約中', tone: 'info' }
}

/** 来店の印を付けられるか（口と同じ：承認待ち・予約確定だけ）。 */
export function canMarkVisited(r: RestaurantReservation): boolean {
  return (r.status === 'pending' || r.status === 'confirmed') && !isHold(r)
}

export type CloseGroupState = 'open' | 'partly' | 'reopen' | 'done'

export type CloseGroup = {
  slotId: string
  startsAt: string
  reason: RestaurantChannelCloseTask['reason']
  remainingSeats: number | null
  state: CloseGroupState
  items: Array<{ id: string; channel: string; name: string; status: RestaurantChannelCloseTask['status'] }>
}

/**
 * 知らせは「枠（時刻）×媒体」で1件。画面は枠ごとに1行へまとめ、媒体は札で並べる。
 * 状態：全部まだ＝open、一部閉じた＝partly、席が戻った＝reopen、全部閉じた＝done。
 */
export function groupCloseTasks(tasks: RestaurantChannelCloseTask[], media: StoreMedium[]): CloseGroup[] {
  const nameOf = (code: string) => media.find((m) => m.code === code)?.name ?? code
  /* 同じ枠の媒体は、媒体の一覧（予約サイト・グルメ媒体）と同じ並び。一覧に無い媒体は後ろ。 */
  const orderOf = (code: string) => { const index = media.findIndex((m) => m.code === code); return index < 0 ? media.length : index }
  const groups = new Map<string, CloseGroup>()
  for (const task of [...tasks].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || orderOf(a.channel) - orderOf(b.channel) || a.channel.localeCompare(b.channel))) {
    /* 臨時休業・貸切の知らせは枠を持たない（slotId が空）。その休みごとに1行にまとめる。 */
    const key = task.slotId ?? task.closureId ?? task.id
    const group = groups.get(key) ?? {
      slotId: key, startsAt: task.startsAt, reason: task.reason, remainingSeats: task.remainingSeats, state: 'open' as CloseGroupState, items: [] as CloseGroup['items'],
    }
    group.items.push({ id: task.id, channel: task.channel, name: nameOf(task.channel), status: task.status })
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    const statuses = group.items.map((item) => item.status)
    group.state = statuses.some((s) => s === 'reopen') ? 'reopen'
      : statuses.every((s) => s === 'done') ? 'done'
        : statuses.some((s) => s === 'done') ? 'partly'
          : 'open'
  }
  return [...groups.values()]
}

/** まだ閉じていない媒体（［閉じた］を押す相手）。 */
export function openItems(group: CloseGroup): CloseGroup['items'] {
  return group.items.filter((item) => item.status === 'close')
}

/** 枠の日時「1/13（火）19:00」。 */
export function slotTitle(iso: string): string {
  const day = new Date(iso)
  const week = '日月火水木金土'[day.getDay()]
  return `${day.getMonth() + 1}/${day.getDate()}（${week}）${pad2(day.getHours())}:${pad2(day.getMinutes())}`
}

export function reasonText(group: Pick<CloseGroup, 'reason' | 'remainingSeats'>): string {
  if (group.reason === 'full') return '満席になりました'
  if (group.reason === 'table_conflict') return '卓が重なる予約が届きました'
  if (group.reason === 'closure') return '臨時休業・貸切で閉じます'
  return `残り ${Math.max(0, group.remainingSeats ?? 0)}席になりました`
}
