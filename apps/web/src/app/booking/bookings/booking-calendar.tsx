'use client'

import { useMemo, useState } from 'react'
import type { BookingRequest } from '@/lib/api'

const HOURS = Array.from({ length: 10 }, (_, index) => index + 9)
const DAY_MS = 86_400_000

function jstDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

function todayKey(): string {
  return jstDay(new Date().toISOString())
}

function moveDay(day: string, amount: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date) + amount * DAY_MS).toISOString().slice(0, 10)
}

function startOfWeek(day: string): string {
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
      className={`w-full rounded-md border-l-[3px] px-2 py-1.5 text-left transition hover:brightness-95 ${
        phone
          ? 'border-blue-600 bg-blue-50 text-blue-800'
          : 'border-success bg-success-bg text-success'
      }`}
      aria-label={`${bookingTime(booking)} ${booking.friend_name ?? '電話予約のお客さま'} ${booking.menu_name}の詳細`}
    >
      {!compact && <p className="truncate text-[11px] font-semibold">{booking.menu_name}</p>}
      <p className="truncate text-[11px] font-medium">
        {compact ? `${bookingTime(booking)} ` : ''}{booking.friend_name ?? '電話予約のお客さま'}
        {!compact && ` ／ ${phone ? '電話' : 'LINE'}`}
      </p>
      {compact && <p className="truncate text-[10px] opacity-80">{booking.staff_name}</p>}
    </button>
  )
}

function EmptyCell() {
  return <span className="text-ink-faint text-[10px] opacity-50">あき</span>
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
    <section data-design="Calendar" className="rounded-card border-hairline bg-canvas min-w-0 overflow-hidden border shadow-sm">
      <div className="border-hairline flex min-h-12 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onPrevious} aria-label="前の期間" className="rounded-control border-hairline h-8 w-8 border">‹</button>
          <button type="button" onClick={onNext} aria-label="次の期間" className="rounded-control border-hairline h-8 w-8 border">›</button>
          <p className="text-ink text-sm font-semibold">{title}</p>
          <button type="button" onClick={onToday} className="rounded-pill bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">今日</button>
        </div>
        <p className="text-ink-secondary text-xs tabular-nums">{meta}</p>
      </div>
      {children}
    </section>
  )
}

function DayGrid({ items, staff, onOpen }: {
  items: BookingRequest[]
  staff: string[]
  onOpen: (id: string) => void
}) {
  const columns = `64px repeat(${Math.max(staff.length, 1)}, minmax(0, 1fr))`
  return (
    <div data-design="DayGrid" className="min-w-0">
      <div className="border-hairline grid border-b bg-canvas-sunken" style={{ gridTemplateColumns: columns }}>
        <div />
        {staff.map((name) => <div key={name} className="border-hairline border-l px-2 py-2 text-center text-xs font-semibold">{name}</div>)}
      </div>
      {HOURS.map((hour) => (
        <div key={hour} className="border-hairline grid min-h-[58px] border-b last:border-b-0" style={{ gridTemplateColumns: columns }}>
          <div className="text-ink-secondary px-2 py-2 text-xs font-semibold tabular-nums">{hour}:00</div>
          {staff.map((name) => {
            const cell = items.filter((booking) => booking.staff_name === name && bookingHour(booking) === hour)
            return (
              <div key={name} className="border-hairline flex min-w-0 items-center border-l p-1">
                {cell.length > 0
                  ? <div className="w-full space-y-1">{cell.map((booking) => <BookingCard key={booking.id} booking={booking} onOpen={onOpen} />)}</div>
                  : <div className="w-full text-center"><EmptyCell /></div>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function WeekGrid({ days, items, onOpen }: {
  days: string[]
  items: BookingRequest[]
  onOpen: (id: string) => void
}) {
  const columns = '64px repeat(7, minmax(0, 1fr))'
  return (
    <div data-design="WeekGrid" className="min-w-0">
      <div className="border-hairline grid border-b bg-canvas-sunken" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((day) => {
          const count = items.filter((booking) => jstDay(booking.starts_at) === day).length
          return (
            <div key={day} className="border-hairline border-l px-1 py-2 text-center">
              <p className="text-ink text-xs font-semibold">{dateLabel(day)}</p>
              <p className="text-success mt-0.5 text-[10px] font-semibold">{count}件</p>
            </div>
          )
        })}
      </div>
      {HOURS.map((hour) => (
        <div key={hour} className="border-hairline grid min-h-[58px] border-b last:border-b-0" style={{ gridTemplateColumns: columns }}>
          <div className="text-ink-secondary px-2 py-2 text-xs font-semibold tabular-nums">{hour}:00</div>
          {days.map((day) => {
            const cell = items.filter((booking) => jstDay(booking.starts_at) === day && bookingHour(booking) === hour)
            return (
              <div key={day} className="border-hairline flex min-w-0 items-center border-l p-1">
                {cell.length > 0
                  ? <div className="w-full space-y-1">{cell.map((booking) => <BookingCard key={booking.id} booking={booking} compact onOpen={onOpen} />)}</div>
                  : <div className="w-full text-center"><EmptyCell /></div>}
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

export default function BookingCalendar({ mode, items, onOpen }: {
  mode: 'day' | 'week'
  items: BookingRequest[]
  onOpen: (id: string) => void
}) {
  const [anchorDay, setAnchorDay] = useState(todayKey)
  const weekStart = startOfWeek(anchorDay)
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => moveDay(weekStart, index)), [weekStart])
  const dayItems = useMemo(() => items.filter((booking) => jstDay(booking.starts_at) === anchorDay), [anchorDay, items])
  const weekItems = useMemo(() => items.filter((booking) => days.includes(jstDay(booking.starts_at))), [days, items])
  const visible = mode === 'day' ? dayItems : weekItems
  const staff = useMemo(() => {
    const names = new Set(items.map((booking) => booking.staff_name).filter(Boolean))
    return Array.from(names)
  }, [items])
  const phoneCount = visible.filter(isPhoneBooking).length
  const lineCount = visible.length - phoneCount
  const sales = visible.reduce((sum, booking) => sum + booking.price_at_booking, 0)
  const requested = visible.filter((booking) => booking.status === 'requested').length
  const cancelled = visible.filter((booking) => ['cancelled', 'rejected', 'no_show'].includes(booking.status)).length
  const available = Math.max(0, (mode === 'day' ? staff.length * HOURS.length : 7 * HOURS.length) - visible.length)

  return (
    <div data-design-node={mode === 'day' ? 'TV2DI' : 'SbuUI'}>
      <div data-design="KPIs" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi title={mode === 'day' ? '今日の予約' : '今週の予約'} value={`${visible.length}件`} detail={`LINEから ${lineCount}・電話 ${phoneCount}`} />
        <Kpi title={mode === 'day' ? 'まだ空いている枠' : 'うまっている割合'} value={mode === 'day' ? `${available}枠` : `${Math.round((visible.length / Math.max(1, visible.length + available)) * 100)}%`} detail={mode === 'day' ? '時間と担当から確認できます' : `${visible.length + available}枠のうち ${visible.length}枠`} />
        <Kpi title={mode === 'day' ? '未承認・要対応' : 'あいている枠'} value={mode === 'day' ? `${requested}件` : `${available}枠`} detail={requested > 0 ? '確認が必要です' : '現在、確認待ちはありません'} />
        <Kpi title="キャンセル" value={`${cancelled}件`} detail={mode === 'day' ? '選んだ日' : 'この1週間'} />
      </div>

      <div data-design="Guide" className="mb-4 rounded-control bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-700">
        {mode === 'day'
          ? '今日の予約を、時間と担当で並べた台帳です。LINEからの予約（緑）と電話の予約（青）を同じところに並べます。'
          : '今週の予約を曜日ごとに並べています。空いているところと詰まっているところが1目で分かります。'}
      </div>

      <div data-design="Body" className="flex min-w-0 flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1">
          {mode === 'day' ? (
            <CalendarFrame
              title={longDateLabel(anchorDay)}
              meta={`${visible.length}件 ／ 売上見込み ${money(sales)}`}
              onPrevious={() => setAnchorDay((day) => moveDay(day, -1))}
              onNext={() => setAnchorDay((day) => moveDay(day, 1))}
              onToday={() => setAnchorDay(todayKey())}
            >
              <DayGrid items={dayItems} staff={staff} onOpen={onOpen} />
            </CalendarFrame>
          ) : (
            <CalendarFrame
              title={`${dateLabel(days[0], false)}〜${dateLabel(days[6])}`}
              meta={`${visible.length}件 ／ 売上見込み ${money(sales)}`}
              onPrevious={() => setAnchorDay((day) => moveDay(day, -7))}
              onNext={() => setAnchorDay((day) => moveDay(day, 7))}
              onToday={() => setAnchorDay(todayKey())}
            >
              <WeekGrid days={days} items={weekItems} onOpen={onOpen} />
            </CalendarFrame>
          )}
        </div>

        <aside data-design="Aside" className="w-full shrink-0 space-y-3 xl:w-[300px]">
          <SidePanel title={mode === 'day' ? '今日 気をつけること' : '今週 気をつけること'} tone={requested > 0 || phoneCount > 0 ? 'warning' : 'plain'}>
            {requested > 0 && <p>● 未承認の予約が {requested}件あります。内容を確認してください。</p>}
            {phoneCount > 0 && <p>● 電話予約が {phoneCount}件あります。LINE未連携の方には当日の連絡ができません。</p>}
            {requested === 0 && phoneCount === 0 && <p>いま確認が必要な予約はありません。</p>}
          </SidePanel>
          <SidePanel title={mode === 'day' ? '今日の流れ' : '今週の内訳'}>
            <p className="flex justify-between"><span>予約</span><strong>{visible.length}件</strong></p>
            <p className="flex justify-between"><span>うちLINEから</span><strong className="text-success">{lineCount}件</strong></p>
            <p className="flex justify-between"><span>うち電話</span><strong className="text-blue-700">{phoneCount}件</strong></p>
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
