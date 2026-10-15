'use client'

import { useRef, type DragEvent } from 'react'
import type { ReservationBoardEntry, ReservationBoardMove, ReservationBoardResource } from '@line-crm/shared'
import { MessageCircle, Phone } from 'lucide-react'
import Button from './button'
import Card from './card'
import Avatar from './avatar'
import { BookingBlock, BookingSlot } from './booking-controls'
import { formatTime } from '@/lib/format'
import styles from './reservation-people-grid.module.css'

type Slot = { resourceId: string; startsAt: string; href?: string }
const civil = (iso: string) => new Date(Date.parse(iso) + 9 * 3600000)
const dayOf = (iso: string) => civil(iso).toISOString().slice(0, 10)
const minuteOf = (iso: string) => civil(iso).getUTCHours() * 60 + civil(iso).getUTCMinutes()

/** 人の当日盤。移動の保存は共通盤の版付き契約に戻す。 */
export default function ReservationPeopleGrid({ entries, resources, date, slots = [], canWrite, busy, onOpen, onMove, onSlot, onError }: {
  entries: ReservationBoardEntry[]
  resources: ReservationBoardResource[]
  date: string
  slots?: Slot[]
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
  return <Card frame="inset" contentPadding="0" overflow="hidden" data-people-day-grid>
    <div className={styles.row} style={{ gridTemplateColumns: columns }} data-people-grid-head>
      <div className={styles.head}>時刻</div>
      {staff.map(resource => <div key={resource.id} className={styles.head} title={resource.label}><Avatar name={resource.label} size={24} /><strong>{resource.label}</strong></div>)}
    </div>
    {hours.map(minute => <div key={minute} className={styles.row} style={{ gridTemplateColumns: columns }} data-people-grid-hour={minute}>
      <div className={styles.time}>{`${Math.floor(minute / 60)}:00`}</div>
      {staff.map(resource => {
        const bookings = rows.filter(row => row.resourceIds.includes(resource.id) && minuteOf(row.startsAt) >= minute && minuteOf(row.startsAt) < minute + 60)
        const available = daySlots.filter(slot => slot.resourceId === resource.id && minuteOf(slot.startsAt) >= minute && minuteOf(slot.startsAt) < minute + 60)
        return <div key={resource.id} className={styles.cell} data-resource-id={resource.id} onDragOver={event => { if (canWrite && onMove && !busy) event.preventDefault() }} onDrop={event => void drop(resource.id, minute, event)}>
          {bookings.map(row => {
            const phone = row.source !== 'line' && row.source !== 'liff'
            const label = `${row.customerName} ${formatTime(row.startsAt)}〜${formatTime(row.endsAt)} ${row.courseName ?? '予約'}の詳細`
            return <BookingBlock placement="cell" key={row.id} tone={phone ? 'phone' : 'line'} aria-label={label} title={label} draggable={canWrite && !!onMove && !busy} onDragStart={event => startDrag(row, event)} onDragEnd={() => { dragged.current = null }} onClick={() => onOpen(row.id)}>
              <span className={styles.name}><strong>{row.customerName}</strong>{phone ? <Phone size={14} aria-hidden /> : <MessageCircle size={14} aria-hidden />}</span>
              <span className={styles.meta}>{`${row.courseName ?? '予約'}・${formatTime(row.startsAt)}〜${formatTime(row.endsAt)}`}</span>
              {row.status !== 'confirmed' ? <span className={styles.meta}>{({ requested: '承認待ち', cancelled: 'キャンセル', rejected: '拒否', expired: '期限切れ', completed: '完了', no_show: '来店なし' } as Record<string, string>)[row.status] ?? row.status}</span> : null}
            </BookingBlock>
          })}
          {canWrite && !busy ? available.map(slot => <span key={slot.startsAt} className={styles.slot}>{slot.href ? <Button variant="text" href={slot.href} aria-label={`${resource.label} ${formatTime(slot.startsAt)}に予約を入れる`}>＋ 予約を入れる</Button> : onSlot ? <BookingSlot onClick={() => onSlot(resource.id, slot.startsAt)} aria-label={`${resource.label} ${formatTime(slot.startsAt)}に予約を入れる`}>＋ 予約を入れる</BookingSlot> : null}</span>) : null}
        </div>
      })}
    </div>)}
    {rows.filter(row => !row.resourceIds.some(id => staff.some(resource => resource.id === id))).map(row => <Button key={row.id} variant="text" onClick={() => onOpen(row.id)}>{row.customerName}・担当未設定</Button>)}
  </Card>
}
