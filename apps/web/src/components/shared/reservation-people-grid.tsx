'use client'

import { jstCalendar as japanCalendar } from '@/lib/jst-datetime'
import { jstDate as japanDate } from '@/lib/jst-datetime'

import { Fragment, useRef, type DragEvent } from 'react'
import type { ReservationBoardEntry, ReservationBoardMove, ReservationBoardResource } from '@line-crm/shared'
import { MessageCircle, Phone, TriangleAlert } from 'lucide-react'
import Button from './button'
import { GridTable } from './grid-table'
import Avatar from './avatar'
import { BookingBlock, BookingSlot } from './booking-controls'
import { formatDay, formatTime } from '@/lib/format'
import styles from './reservation-people-grid.module.css'

type Slot = { resourceId: string; startsAt: string; href?: string }
const civil = (iso: string) => japanCalendar(new Date(Date.parse(iso)))
const dayOf = (iso: string) => japanDate(new Date(iso))
const minuteOf = (iso: string) => civil(iso).getUTCHours() * 60 + civil(iso).getUTCMinutes()

/** 人の当日盤。移動の保存は共通盤の版付き契約に戻す。 */
export default function ReservationPeopleGrid({ entries, resources, date, slots = [], breaks, canWrite, busy, onOpen, onMove, onSlot, onError }: {
  entries: ReservationBoardEntry[]
  resources: ReservationBoardResource[]
  date: string
  slots?: Slot[]
  /** 担当ごとの毎週の休憩（曜日・開始・終了）。その日の曜日だけを休憩の枠として出す。 */
  breaks?: Record<string, ReadonlyArray<{ weekday: number; start_time: string; end_time: string }>>
  canWrite: boolean
  busy: boolean
  onOpen: (id: string) => void
  onMove?: (id: string, move: ReservationBoardMove) => Promise<void>
  onSlot?: (resourceId: string, startsAt: string) => void
  onError: (message: string) => void
}) {
  const rows = entries.filter(row => dayOf(row.startsAt) === date)
  const daySlots = [...new Map(slots.filter(slot => dayOf(slot.startsAt) === date).map(slot => [`${slot.resourceId}/${slot.startsAt}`, slot])).values()]
  const from = Math.min(9 * 60, ...rows.map(row => Math.floor(minuteOf(row.startsAt) / 60) * 60), ...daySlots.map(slot => Math.floor(minuteOf(slot.startsAt) / 60) * 60))
  const to = Math.max(18 * 60, ...rows.map(row => Math.ceil(minuteOf(row.startsAt) / 60) * 60 + 60), ...daySlots.map(slot => Math.floor(minuteOf(slot.startsAt) / 60) * 60 + 60))
  const hours = Array.from({ length: (to - from) / 60 }, (_, index) => from + index * 60)
  const staff = resources.filter(resource => resource.active || rows.some(row => row.resourceIds.includes(resource.id)))
  const columns = `var(--tpl-people-time-width) repeat(${Math.max(staff.length, 1)}, minmax(0, 1fr))`
  const dragged = useRef<ReservationBoardEntry | null>(null)
  // A ref is shared by every cell without causing a render during native drag.
  const startDrag = (row: ReservationBoardEntry, event: DragEvent) => {
    dragged.current = row
    event.dataTransfer?.setData('text/plain', row.id)
  }
  const drop = async (resourceId: string, minute: number, event: DragEvent) => {
    event.preventDefault()
    const row = dragged.current ?? rows.find(row => row.id === event.dataTransfer?.getData('text/plain'))
    dragged.current = null
    if (!row || !canWrite || busy || !onMove) return
    const rect = event.currentTarget.getBoundingClientRect()
    const offset = rect.height > 0 && Number.isFinite(event.clientY) ? Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) : 0
    const start = minute + (offset >= 0.5 ? 30 : 0)
    onError('')
    try {
      await onMove(row.id, { kind: 'people', expectedVersion: row.version, staffId: resourceId, startsAt: new Date(Date.parse(`${date}T00:00:00+09:00`) + start * 60000).toISOString() })
    } catch {
      onError('移動できませんでした。予約は元のままです。最新の予約を読み込んでください。')
    }
  }
  return <GridTable presentation="calendar" label={`${formatDay(`${date}T00:00:00+09:00`)}の担当別予約`} design={{ columns, gap: '0', rowPadding: '0', fontSize: 'var(--text-caption)' }} data-people-day-grid>
    <div role="row" className={styles.row} style={{ gridTemplateColumns: columns }} data-people-grid-head>
      <div role="columnheader" className={styles.head}>時刻</div>
      {staff.map(resource => <div role="columnheader" key={resource.id} className={styles.head} title={resource.label}><Avatar name={resource.label} size={24} /><strong>{resource.label}</strong>{resource.capacity ? <span className={styles.capacity}>{`受付${resource.capacity}人${resource.capacity === 1 ? 'ずつ' : 'まで'}`}</span> : null}</div>)}
    </div>
    {hours.map(minute => <div role="row" key={minute} className={styles.row} style={{ gridTemplateColumns: columns }} data-people-grid-hour={minute}>
      <div role="rowheader" className={styles.time}>{`${Math.floor(minute / 60)}:00`}</div>
      {staff.map(resource => {
        const bookings = rows.filter(row => row.resourceIds.includes(resource.id) && minuteOf(row.startsAt) >= minute && minuteOf(row.startsAt) < minute + 60)
        const dayWeekday = new Date(`${date}T12:00:00+09:00`).getUTCDay()
        const resting = (breaks?.[resource.id] ?? []).filter(item => item.weekday === dayWeekday && Number(item.start_time.slice(0, 2)) * 60 + Number(item.start_time.slice(3, 5)) >= minute && Number(item.start_time.slice(0, 2)) * 60 + Number(item.start_time.slice(3, 5)) < minute + 60)
        const available = daySlots.filter(slot => slot.resourceId === resource.id && minuteOf(slot.startsAt) >= minute && minuteOf(slot.startsAt) < minute + 60)
        return <div role="cell" key={resource.id} className={styles.cell} data-resource-id={resource.id} onDragOver={event => { if (canWrite && onMove && !busy) event.preventDefault() }} onDrop={event => void drop(resource.id, minute, event)}>
          {resting.map(item => <span key={`break-${item.start_time}`} className={styles.rest}>休憩</span>)}
          {bookings.map(row => {
            const overlapping = rows.filter(other => other.resourceIds.includes(resource.id) && other.startsAt < row.endsAt && other.endsAt > row.startsAt && ['confirmed', 'requested'].includes(other.status)).length
            const over = resource.capacity && overlapping > resource.capacity && ['confirmed', 'requested'].includes(row.status) && rows.filter(other => other.resourceIds.includes(resource.id) && other.startsAt < row.startsAt && other.endsAt > row.startsAt).length >= resource.capacity
            const line = ['line', 'liff'].includes(row.source), phone = ['phone', 'manual'].includes(row.source)
            const label = `${row.customerName} ${formatTime(row.startsAt)}〜${formatTime(row.endsAt)} ${row.courseName ?? '予約'}の詳細`
            return <Fragment key={row.id}><BookingBlock placement="cell" tone={over ? 'over' : phone ? 'phone' : line ? 'line' : 'confirmed'} aria-label={label} title={label} draggable={canWrite && !!onMove && !busy} onDragStart={event => startDrag(row, event)} onDragEnd={() => { dragged.current = null }} onClick={() => onOpen(row.id)}>
              <span className={styles.name}><strong>{row.customerName}</strong>{phone ? <Phone size={14} aria-hidden /> : line ? <MessageCircle size={14} aria-hidden /> : <span>{({ counter: '店頭', operator: '手入力', import: '取り込み' } as Record<string, string>)[row.source] ?? 'その他'}</span>}</span>
              <span className={styles.meta}>{`${row.courseName ?? '予約'}・${formatTime(row.startsAt)}〜${formatTime(row.endsAt)}`}</span>
              {row.status !== 'confirmed' ? <span className={styles.meta}>{({ requested: '承認待ち', cancelled: 'キャンセル', rejected: '拒否', expired: '期限切れ', completed: '完了', no_show: '来店なし' } as Record<string, string>)[row.status] ?? row.status}</span> : null}
            </BookingBlock>{over ? <span className={styles.over} role="alert"><TriangleAlert size={13} aria-hidden />受付数を超えています（{overlapping} / {resource.capacity}）</span> : null}</Fragment>
          })}
          {canWrite && !busy ? available.map(slot => <span key={slot.startsAt} className={styles.slot}>{slot.href ? <Button variant="text" href={slot.href} aria-label={`${resource.label} ${formatTime(slot.startsAt)}に予約を入れる`}>＋ 予約を入れる</Button> : onSlot ? <BookingSlot onClick={() => onSlot(resource.id, slot.startsAt)} aria-label={`${resource.label} ${formatTime(slot.startsAt)}に予約を入れる`}>＋ 予約を入れる</BookingSlot> : null}</span>) : null}
        </div>
      })}
    </div>)}
    {rows.filter(row => !row.resourceIds.some(id => staff.some(resource => resource.id === id))).map(row => <Button key={row.id} variant="text" onClick={() => onOpen(row.id)}>{row.customerName}・担当未設定</Button>)}
  </GridTable>
}
