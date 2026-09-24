'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { BookingRequest } from '@/lib/api'
import Button from '@/components/shared/button'

// BOOKING-01: 9〜18時の固定10マスは「空き枠」ではなく、空き枠APIの実績が
// まだ届いていないときの表示レンジ。実際に受け付けられる枠が届いたら、
// その枠の開始時刻ぶんだけ行を上下へ広げる（営業時間外を空きにしない）。
const BASE_HOURS = Array.from({ length: 10 }, (_, index) => index + 9)
const DAY_MS = 86_400_000

/**
 * BOOKING-01: 空き枠API `/api/booking/admin/availability` が返す1枠。
 * 営業時間・担当シフト・例外日・外部予定・既存予約・同時受付数を
 * サーバー側で考慮済み。`remaining > 0` のものだけが実際に取れる枠。
 */
export interface CalendarSlot {
  staffId: string
  staffName: string
  /** この枠を取れる予約メニュー。代理予約の入口がこのメニューを事前入力する。 */
  menuId: string
  date: string
  start: string
  end: string
  startUtc?: string | null
  endUtc?: string | null
  remaining: number
  state: 'available' | 'limited' | 'full' | 'closed'
}

export type CalendarAvailabilityStatus = 'loading' | 'ready' | 'error' | 'unconfigured'

export interface CalendarAvailability {
  status: CalendarAvailabilityStatus
  slots: CalendarSlot[]
}

function jstDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

function todayKey(): string {
  return jstDay(new Date().toISOString())
}

export function moveDay(day: string, amount: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date) + amount * DAY_MS).toISOString().slice(0, 10)
}

export function startOfWeek(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  const offset = (date.getUTCDay() + 6) % 7
  return moveDay(day, -offset)
}

function dateLabel(day: string, weekday = true): string {
  return new Date(`${day}T00:00:00+09:00`).toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: weekday ? 'short' : undefined,
    timeZone: 'Asia/Tokyo',
  })
}

function longDateLabel(day: string): string {
  return new Date(`${day}T00:00:00+09:00`).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'Asia/Tokyo',
  })
}

const sep = '\u0000'

function bookingHour(booking: BookingRequest): number {
  return new Date(new Date(booking.starts_at).getTime() + 9 * 3_600_000).getUTCHours()
}

function bookingTime(booking: BookingRequest): string {
  return new Date(booking.starts_at).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

function isPhoneBooking(booking: BookingRequest): boolean {
  return !booking.friend_id
}

function money(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`
}

function Kpi({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-card border-hairline bg-canvas border px-4 py-3 shadow-sm">
      <p className="text-ink-secondary text-xs font-medium">{title}</p>
      <p className="text-ink mt-1 text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-ink-faint mt-1 text-xs">{detail}</p>
    </div>
  )
}

function BookingCard({ booking, compact = false, onOpen }: {
  booking: BookingRequest
  compact?: boolean
  onOpen: (id: string) => void
}) {
  const phone = isPhoneBooking(booking)
  return (
    <button
      type="button"
      onClick={() => onOpen(booking.id)}
      className={`w-full rounded-md border-l-4 px-2 py-1.5 text-left transition hover:brightness-95 ${
        phone
          ? 'border-action bg-action-soft text-action'
          : 'border-success bg-success-bg text-success'
      }`}
      aria-label={`${bookingTime(booking)} ${booking.friend_name ?? '電話予約のお客さま'} ${booking.menu_name}の詳細`}
    >
      {!compact && <p className="truncate text-xs font-semibold">{booking.menu_name}</p>}
      <p className="truncate text-xs font-medium">
        {compact ? `${bookingTime(booking)} ` : ''}{booking.friend_name ?? '電話予約のお客さま'}
        {!compact && ` ／ ${phone ? '電話' : 'LINE'}`}
      </p>
      {compact && <p className="truncate text-xs opacity-80">{booking.staff_name}</p>}
    </button>
  )
}

function EmptyCell({ href }: { href?: string }) {
  // N-399: 空きセルが代理予約の入口になる。操作権限がない人・遷移先が
  // 組み立てられないセルは押せる形に見せない。
  // BOOKING-01: カレンダーのマスそのものは「空き枠」と呼ばない。実際に
  // 受け付けられる枠だけが入口になり、取れないマス（営業時間外・休み・
  // 満席・まだ読み込み中）は「—」で示す。
  if (!href) {
    return <span className="text-ink-faint text-xs opacity-50" aria-label="受け付けていない時間">—</span>
  }
  return (
    <Link
      href={href}
      aria-label="この空き枠に予約を入れる"
      title="この空き枠に予約を入れる"
      className="text-ink-faint hover:bg-accent-soft hover:text-action inline-block rounded-control px-2 py-0.5 text-xs opacity-60 transition hover:opacity-100"
    >
      あき ＋
    </Link>
  )
}

/**
 * 空きセル→代理予約のURL。日付・実際に取れる開始時刻・担当・メニューを
 * 渡して事前入力する。BOOKING-01: メニュー候補のない入口へ遷移させない
 * ため、枠を出したメニューの id を必ず添える。
 */
function newBookingHref(input: { day: string; time: string; staffName?: string; menuId?: string }): string {
  const params = new URLSearchParams({
    date: input.day,
    time: input.time,
  })
  if (input.staffName) params.set('staff', input.staffName)
  if (input.menuId) params.set('menu', input.menuId)
  return `/booking/bookings/new?${params.toString()}`
}

function CalendarFrame({
  title,
  meta,
  onPrevious,
  onNext,
  onToday,
  children,
}: {
  title: string
  meta: string
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border-hairline bg-canvas min-w-0 overflow-hidden border shadow-sm">
      <div className="border-hairline flex min-h-12 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onPrevious} aria-label="前の期間" className="h-8 w-8">‹</Button>
          <Button variant="secondary" onClick={onNext} aria-label="次の期間" className="h-8 w-8">›</Button>
          <p className="text-ink text-sm font-semibold">{title}</p>
          <button type="button" onClick={onToday} className="rounded-pill bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-deep hover:brightness-95">今日</button>
        </div>
        <p className="text-ink-secondary text-xs tabular-nums">{meta}</p>
      </div>
      {children}
    </section>
  )
}

function DayGrid({ items, staff, day, hours, bookable, canCreate, onOpen }: {
  items: BookingRequest[]
  staff: string[]
  day: string
  /** 表示する時間の行。実際の空き枠・予約の開始時刻ぶんだけ上下へ広がる。 */
  hours: number[]
  /**
   * BOOKING-01: 実際に取れる枠の辞書（`時間 + 担当名` → 先着の枠）。
   * この辞書に無いマスは受け付けていないので「—」とし、入口にしない。
   */
  bookable: Map<string, CalendarSlot>
  /** N-399: 操作できる人だけ空きセルを代理予約の入口にする。 */
  canCreate: boolean
  onOpen: (id: string) => void
}) {
  const columns = `64px repeat(${Math.max(staff.length, 1)}, minmax(0, 1fr))`
  // 格子ごとにfilterし直さない。時間×担当の辞書へ1回で束ねる(点検#516の中1)。
  const cells = useMemo(() => {
    const map = new Map<string, BookingRequest[]>()
    for (const booking of items) {
      const key = String(bookingHour(booking)) + sep + booking.staff_name
      const list = map.get(key)
      if (list) list.push(booking)
      else map.set(key, [booking])
    }
    return map
  }, [items])
  return (
    <div className="min-w-0">
      <div className="border-hairline grid border-b bg-canvas-sunken" style={{ gridTemplateColumns: columns }}>
        <div />
        {staff.map((name) => <div key={name} className="border-hairline border-l px-2 py-2 text-center text-xs font-semibold">{name}</div>)}
      </div>
      {hours.map((hour) => (
        <div key={hour} className="border-hairline grid min-h-14 border-b last:border-b-0" style={{ gridTemplateColumns: columns }}>
          <div className="text-ink-secondary px-2 py-2 text-xs font-semibold tabular-nums">{hour}:00</div>
          {staff.map((name) => {
            const cell = cells.get(String(hour) + sep + name) ?? []
            const slot = bookable.get(String(hour) + sep + name)
            return (
              <div key={name} className="border-hairline flex min-w-0 items-center border-l p-1">
                {cell.length > 0
                  ? <div className="w-full space-y-1">{cell.map((booking) => <BookingCard key={booking.id} booking={booking} onOpen={onOpen} />)}</div>
                  : <div className="w-full text-center"><EmptyCell href={canCreate && slot ? newBookingHref({ day, time: slot.start, staffName: name, menuId: slot.menuId }) : undefined} /></div>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function WeekGrid({ days, items, hours, bookable, canCreate, onOpen }: {
  days: string[]
  items: BookingRequest[]
  hours: number[]
  /** BOOKING-01: `日付 + 時間` → どれかの担当で実際に取れる先着の枠。 */
  bookable: Map<string, CalendarSlot>
  canCreate: boolean
  onOpen: (id: string) => void
}) {
  const columns = '64px repeat(7, minmax(0, 1fr))'
  // 格子ごとにfilterし直さない。日×時間の辞書へ1回で束ねる(点検#516の中1)。
  const cells = useMemo(() => {
    const map = new Map<string, BookingRequest[]>()
    for (const booking of items) {
      const key = jstDay(booking.starts_at) + sep + String(bookingHour(booking))
      const list = map.get(key)
      if (list) list.push(booking)
      else map.set(key, [booking])
    }
    return map
  }, [items])
  const dayCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const booking of items) {
      const day = jstDay(booking.starts_at)
      map.set(day, (map.get(day) ?? 0) + 1)
    }
    return map
  }, [items])
  return (
    <div className="min-w-0">
      <div className="border-hairline grid border-b bg-canvas-sunken" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((day) => {
          const count = dayCounts.get(day) ?? 0
          return (
            <div key={day} className="border-hairline border-l px-1 py-2 text-center">
              <p className="text-ink text-xs font-semibold">{dateLabel(day)}</p>
              <p className="text-success mt-0.5 text-xs font-semibold">{count}件</p>
            </div>
          )
        })}
      </div>
      {hours.map((hour) => (
        <div key={hour} className="border-hairline grid min-h-14 border-b last:border-b-0" style={{ gridTemplateColumns: columns }}>
          <div className="text-ink-secondary px-2 py-2 text-xs font-semibold tabular-nums">{hour}:00</div>
          {days.map((day) => {
            const cell = cells.get(day + sep + String(hour)) ?? []
            const slot = bookable.get(day + sep + String(hour))
            return (
              <div key={day} className="border-hairline flex min-w-0 items-center border-l p-1">
                {cell.length > 0
                  ? <div className="w-full space-y-1">{cell.map((booking) => <BookingCard key={booking.id} booking={booking} compact onOpen={onOpen} />)}</div>
                  : <div className="w-full text-center"><EmptyCell href={canCreate && slot ? newBookingHref({ day, time: slot.start, staffName: slot.staffName, menuId: slot.menuId }) : undefined} /></div>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function SidePanel({ title, children, tone = 'plain' }: { title: string; children: React.ReactNode; tone?: 'plain' | 'warning' }) {
  return (
    <section className={`rounded-card border p-4 ${tone === 'warning' ? 'border-warning bg-warning-bg' : 'border-hairline bg-canvas'}`}>
      <h2 className="text-ink text-sm font-semibold">{title}</h2>
      <div className="text-ink-secondary mt-3 space-y-2 text-xs leading-5">{children}</div>
    </section>
  )
}

/** 時間を塞ぐ予約の状態。取消・拒否・期限切れは枠を使っていない。 */
const OCCUPIED_STATUSES = new Set(['requested', 'confirmed', 'completed', 'no_show'])

/** 枠の開始時刻（店舗タイムゾーンの壁時刻 HH:MM）から時間行の番号を取る。 */
function slotHour(slot: CalendarSlot): number | null {
  const hour = Number(slot.start.slice(0, 2))
  return Number.isFinite(hour) ? hour : null
}

function intervalMs(start: string | null | undefined, end: string | null | undefined): [number, number] | null {
  const s = new Date(start ?? '').getTime()
  const e = new Date(end ?? '').getTime()
  return Number.isFinite(s) && Number.isFinite(e) && s < e ? [s, e] : null
}

/** 重なりを潰した区間の合計ミリ秒。同じ時間を二重に数えない。 */
function unionMs(intervals: Array<[number, number]>): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  let total = 0
  let curStart = -1
  let curEnd = -1
  for (const [s, e] of sorted) {
    if (s > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart
      curStart = s
      curEnd = e
    } else if (e > curEnd) {
      curEnd = e
    }
  }
  if (curEnd > curStart) total += curEnd - curStart
  return total
}

function hoursText(ms: number): string {
  const hours = Math.round((ms / 3_600_000) * 10) / 10
  return `${hours}時間`
}

export default function BookingCalendar({ mode, items, onOpen, staffNames, canCreate = false, anchorDay, onAnchorChange, availability, onRetryAvailability }: {
  mode: 'day' | 'week'
  items: BookingRequest[]
  onOpen: (id: string) => void
  /** 稼働中の担当者名。予約がまだ無い担当も列に出す（その空きへ予約を入れられる）。 */
  staffNames?: string[]
  /** N-399/N-401: 操作できる人だけ空きセルを代理予約の入口にする。 */
  canCreate?: boolean
  /** 表示中の日・週の基点。親がこの範囲の予約と空き枠を取り直す。 */
  anchorDay: string
  onAnchorChange: (day: string) => void
  /**
   * BOOKING-01: 空き枠APIの実績。`unconfigured` は担当0・メニュー0、
   * `error` は取得不能、`loading` は読み込み中。カレンダーのマス数から
   * 空きを推測しない。実績が無い・取れないなら「—」を出す。
   */
  availability: CalendarAvailability
  /**
   * #634: 空き枠（と、その元になる集計・メニュー・担当）の取り直し。
   * 失敗の帯の中に置く。渡さないときは開き直しの案内だけを出す。
   */
  onRetryAvailability?: () => void
}) {
  const weekStart = startOfWeek(anchorDay)
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => moveDay(weekStart, index)), [weekStart])
  const rangeSet = useMemo(() => new Set(mode === 'day' ? [anchorDay] : days), [mode, anchorDay, days])
  const dayItems = useMemo(() => items.filter((booking) => jstDay(booking.starts_at) === anchorDay), [anchorDay, items])
  const weekItems = useMemo(() => items.filter((booking) => days.includes(jstDay(booking.starts_at))), [days, items])
  const visible = mode === 'day' ? dayItems : weekItems
  const staff = useMemo(() => {
    // まだ予約の入っていない担当も列に出す。空き列が代理予約の入口になる。
    const names = new Set(staffNames?.filter(Boolean) ?? [])
    for (const booking of items) {
      if (booking.staff_name) names.add(booking.staff_name)
    }
    return Array.from(names)
  }, [items, staffNames])
  const phoneCount = visible.filter(isPhoneBooking).length
  const lineCount = visible.length - phoneCount
  const sales = visible.reduce((sum, booking) => sum + booking.price_at_booking, 0)
  const requested = visible.filter((booking) => booking.status === 'requested').length
  const cancelled = visible.filter((booking) => ['cancelled', 'rejected', 'no_show'].includes(booking.status)).length

  /*
   * BOOKING-01: 「あいている枠」と「うまっている割合」はカレンダーのマス数
   * ではなく、空き枠APIが返した実績から計算する。
   * - あいている枠: remaining>0 の枠を担当×開始時刻で数える（メニュー違いの
   *   同一枠は1枠）。
   * - 受付可能時間: 担当ごとに「返ってきた枠の区間 ∪ 予約で塞がった区間」の
   *   和。予約が入っている時間は受付できた時間なので分母へ戻す。
   * - 塞がった時間: 担当ごとの予約区間の和。稼働率 = 塞がった÷受付可能。
   *   受付可能が0なら要件どおり「—」。
   * 残件: 外部予定だけで塞がり枠が返らなかった時間は分母に入らない
   * （APIが外部予定の区間を返さないため）。サーバー側が塞いだことは
   * 枠が出ないことで表れている。
   */
  const capacity = useMemo(() => {
    if (availability.status !== 'ready') return { acceptableMs: 0, bookedMs: 0, freeSlots: 0 }
    const perStaff = new Map<string, { slots: Array<[number, number]>; bookings: Array<[number, number]> }>()
    const bucket = (id: string) => {
      let found = perStaff.get(id)
      if (!found) {
        found = { slots: [], bookings: [] }
        perStaff.set(id, found)
      }
      return found
    }
    const freeKeys = new Set<string>()
    for (const slot of availability.slots) {
      if (!rangeSet.has(slot.date)) continue
      const interval = intervalMs(slot.startUtc, slot.endUtc)
      if (interval) bucket(slot.staffId).slots.push(interval)
      if (slot.remaining > 0) {
        freeKeys.add(slot.staffId + sep + (slot.startUtc ?? `${slot.date}T${slot.start}`))
      }
    }
    for (const booking of visible) {
      if (!OCCUPIED_STATUSES.has(booking.status)) continue
      const interval = intervalMs(booking.starts_at, booking.ends_at)
      if (interval) bucket(booking.staff_id || booking.staff_name).bookings.push(interval)
    }
    let acceptableMs = 0
    let bookedMs = 0
    for (const entry of perStaff.values()) {
      bookedMs += unionMs(entry.bookings)
      acceptableMs += unionMs([...entry.slots, ...entry.bookings])
    }
    return { acceptableMs, bookedMs, freeSlots: freeKeys.size }
  }, [availability, visible, rangeSet])

  // 日表示: 時間×担当の辞書。週表示: 日×時間で、誰かが取れる先着の枠。
  const bookableByHourStaff = useMemo(() => {
    const map = new Map<string, CalendarSlot>()
    if (availability.status !== 'ready') return map
    for (const slot of availability.slots) {
      if (slot.date !== anchorDay || slot.remaining <= 0) continue
      const hour = slotHour(slot)
      if (hour === null) continue
      const key = String(hour) + sep + slot.staffName
      const existing = map.get(key)
      if (!existing || slot.start < existing.start) map.set(key, slot)
    }
    return map
  }, [availability, anchorDay])
  const bookableByDayHour = useMemo(() => {
    const map = new Map<string, CalendarSlot>()
    if (availability.status !== 'ready') return map
    for (const slot of availability.slots) {
      if (!days.includes(slot.date) || slot.remaining <= 0) continue
      const hour = slotHour(slot)
      if (hour === null) continue
      const key = slot.date + sep + String(hour)
      const existing = map.get(key)
      // 週のマスは担当をまたぐ。一番早く取れる担当の枠を入口にする。
      if (!existing || slot.start < existing.start) map.set(key, slot)
    }
    return map
  }, [availability, days])

  // 実際の空き枠・予約の時刻ぶんだけ行を広げる。実績が無いときは基本レンジ。
  const hours = useMemo(() => {
    const set = new Set(BASE_HOURS)
    if (availability.status === 'ready') {
      for (const slot of availability.slots) {
        if (!rangeSet.has(slot.date)) continue
        const hour = slotHour(slot)
        if (hour !== null) set.add(hour)
      }
    }
    for (const booking of visible) {
      set.add(bookingHour(booking))
    }
    return Array.from(set).sort((a, b) => a - b)
  }, [availability, visible, rangeSet])

  const availabilityNote =
    availability.status === 'loading'
      ? '空き枠を読み込んでいます'
      : availability.status === 'error'
        ? '空き枠を読み込めませんでした'
        : availability.status === 'unconfigured'
          ? '担当者か予約メニューが未設定です'
          : '実際に受け付けられる枠を数えています'
  const weekRateValue =
    availability.status === 'ready' && capacity.acceptableMs > 0
      ? `${Math.round((capacity.bookedMs / capacity.acceptableMs) * 100)}%`
      : '—'
  const weekRateDetail =
    availability.status !== 'ready'
      ? availabilityNote
      : capacity.acceptableMs > 0
        ? `受付${hoursText(capacity.acceptableMs)}のうち${hoursText(capacity.bookedMs)}を使用中`
        : '受付可能な時間がありません'

  return (
    <div data-design-node={mode === 'day' ? 'TV2DI' : 'SbuUI'}>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi title={mode === 'day' ? '今日の予約' : '今週の予約'} value={`${visible.length}件`} detail={`LINEから ${lineCount}・電話 ${phoneCount}`} />
        <Kpi
          title={mode === 'day' ? 'まだ空いている枠' : 'うまっている割合'}
          value={mode === 'day' ? (availability.status === 'ready' ? `${capacity.freeSlots}枠` : '—') : weekRateValue}
          detail={mode === 'day' ? availabilityNote : weekRateDetail}
        />
        <Kpi
          title={mode === 'day' ? '未承認・要対応' : 'あいている枠'}
          value={mode === 'day' ? `${requested}件` : availability.status === 'ready' ? `${capacity.freeSlots}枠` : '—'}
          detail={mode === 'day' ? (requested > 0 ? '確認が必要です' : '現在、確認待ちはありません') : availabilityNote}
        />
        <Kpi title="キャンセル" value={`${cancelled}件`} detail={mode === 'day' ? '選んだ日' : 'この1週間'} />
      </div>

      <div className="bg-action-soft text-action mb-4 rounded-control px-4 py-3 text-xs font-semibold">
        {mode === 'day'
          ? '今日の予約を、時間と担当で並べた台帳です。LINEからの予約（緑）と電話の予約（青）を同じところに並べます。'
          : '今週の予約を曜日ごとに並べています。空いているところと詰まっているところが1目で分かります。'}
      </div>

      {/* BOOKING-01: 未設定・取得不能・空き0を区別して知らせる。
          未設定・取得不能のときの「—」は空き0とは別の意味なので理由を出す。 */}
      {availability.status === 'unconfigured' ? (
        <div className="bg-warning-bg text-warning mb-4 rounded-control px-4 py-3 text-xs font-semibold">
          担当者または予約メニューがまだ設定されていません。受け付けられる枠がないため、空きは「—」で表示しています。予約設定で登録すると空き枠が出ます。
        </div>
      ) : null}
      {availability.status === 'error' ? (
        <div className="bg-warning-bg text-warning mb-4 rounded-control px-4 py-3 text-xs font-semibold">
          空き枠を読み込めませんでした。予約の記録だけを表示しています。
          {/*
            * #634: 失敗の帯の中に読み直す口を出す。無いとページ全体を
            * 開き直す以外に直す道がない（集計側の帯と同じ導線）。
            */}
          {onRetryAvailability ? (
            <button type="button" className="ml-2 underline" onClick={onRetryAvailability}>もう一度読み込む</button>
          ) : (
            <span> 時間をおいて開き直してください。</span>
          )}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1">
          {mode === 'day' ? (
            <CalendarFrame
              title={longDateLabel(anchorDay)}
              meta={`${visible.length}件 ／ 売上見込み ${money(sales)}`}
              onPrevious={() => onAnchorChange(moveDay(anchorDay, -1))}
              onNext={() => onAnchorChange(moveDay(anchorDay, 1))}
              onToday={() => onAnchorChange(todayKey())}
            >
              <DayGrid items={dayItems} staff={staff} day={anchorDay} hours={hours} bookable={bookableByHourStaff} canCreate={canCreate} onOpen={onOpen} />
            </CalendarFrame>
          ) : (
            <CalendarFrame
              title={`${dateLabel(days[0], false)}〜${dateLabel(days[6])}`}
              meta={`${visible.length}件 ／ 売上見込み ${money(sales)}`}
              onPrevious={() => onAnchorChange(moveDay(anchorDay, -7))}
              onNext={() => onAnchorChange(moveDay(anchorDay, 7))}
              onToday={() => onAnchorChange(todayKey())}
            >
              <WeekGrid days={days} items={weekItems} hours={hours} bookable={bookableByDayHour} canCreate={canCreate} onOpen={onOpen} />
            </CalendarFrame>
          )}
        </div>

        <aside className="w-full shrink-0 space-y-3 xl:w-72">
          <SidePanel title={mode === 'day' ? '今日 気をつけること' : '今週 気をつけること'} tone={requested > 0 || phoneCount > 0 ? 'warning' : 'plain'}>
            {requested > 0 && <p>● 未承認の予約が {requested}件あります。内容を確認してください。</p>}
            {phoneCount > 0 && <p>● 電話予約が {phoneCount}件あります。LINE未連携の方には当日の連絡ができません。</p>}
            {requested === 0 && phoneCount === 0 && <p>いま確認が必要な予約はありません。</p>}
          </SidePanel>
          <SidePanel title={mode === 'day' ? '今日の流れ' : '今週の内訳'}>
            <p className="flex justify-between"><span>予約</span><strong>{visible.length}件</strong></p>
            <p className="flex justify-between"><span>うちLINEから</span><strong className="text-success">{lineCount}件</strong></p>
            <p className="flex justify-between"><span>うち電話</span><strong className="text-action">{phoneCount}件</strong></p>
            <p className="flex justify-between"><span>売上見込み</span><strong>{money(sales)}</strong></p>
          </SidePanel>
          <SidePanel title="つながる先">
            <p>→ 予約設定　メニューと受付枠</p>
            <p>→ リマインダ　前日・当日のお知らせ</p>
            <p>→ 友だち　来店の記録</p>
            <p>→ コンバージョン　予約が入った</p>
          </SidePanel>
        </aside>
      </div>
    </div>
  )
}
