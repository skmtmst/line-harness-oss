'use client'
import { Fragment, useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { BookingBlock } from './booking-controls'
import Dialog from './dialog'
import { RowNameButton } from './table'
import TruncatedText from './truncated-text'
import { groupCalendarIntervals } from './calendar-overlap'
import { calendarInterval, calendarMinutes } from './calendar-time-range'
export { calendarTimeRange } from './calendar-time-range'
import styles from './calendar-parts.module.css'
export { useCalendarTimeScale } from './use-calendar-time-scale'

/** 時間盤の空き枠。媒体の取込欄とは別の予約操作。 */
export function CalendarSlotButton({ placement, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { placement?: 'calendar' }) {
  return <button {...props} type="button" data-placement={placement} data-calendar-slot={placement === 'calendar' ? '' : undefined} className={[styles.freeSlot, placement === 'calendar' ? styles.calendarFree : null].filter(Boolean).join(' ')} />
}
export function CalendarLegendItem({ state, children }: { state: string; children: ReactNode }) {
  return <span className={styles.legendItem} data-state={state}>{children}</span>
}
export function CalendarPerson({ href, name, secondary }: { href: string; name: string; secondary: ReactNode }) {
  return <span className={styles.dayName}><a href={href}>{name}</a>{secondary}</span>
}

type TimeEntry = { id: string; day: string; start: string; end: string; title: string; name: string }
type FreeTime = { day: string; start: string; end: string; bookingDay?: string; bookingStart?: string }
const minutes = (time: string) => calendarMinutes(time) ?? 0
const laneStyle = (lane: number, lanes: number, span = 1) => ({ '--calendar-lane': lane, '--calendar-lanes': lanes, '--calendar-span': span } as CSSProperties)

/** The host supplies time/day geometry. Placement and every reservation/available action stay shared. */
export function CalendarTimeEntries({ days, entries, free, canWrite, position, onOpen, onSlot, hourCount, children }: {
  days: string[]
  hourCount?: number
  children?: ReactNode
  entries: TimeEntry[]
  free: FreeTime[]
  canWrite: boolean
  position: (start: string, end: string, day: number, count: number) => CSSProperties
  onOpen: (id: string) => void
  onSlot: (day: string, start: string) => void
}) {
  const [expanded, setExpanded] = useState<TimeEntry[] | null>(null)
  const [expandedFree, setExpandedFree] = useState<FreeTime[] | null>(null)
  useEffect(() => { setExpanded(null); setExpandedFree(null) }, [entries, free])
  useEffect(() => { if (!canWrite) setExpandedFree(null) }, [canWrite])
  const grid = <>
    {children}
    {days.map((day, dayIndex) => {
      const groups = groupCalendarIntervals(entries.filter(entry => entry.day === day).flatMap(value => { const interval = calendarInterval(value); return interval ? [{ value, ...interval }] : [] }))
      const freeGroups = canWrite ? groupCalendarIntervals(free.filter(slot => slot.day === day).flatMap(value => { const interval = calendarInterval(value); return interval ? [{ value, ...interval }] : [] })) : []
      const bookingLanes = Math.min(2, Math.max(0, ...groups.map(group => group.peak)))
      const overflowLane = groups.some(group => group.peak >= 3) ? 1 : 0
      // Several overlapping availabilities share one lane and remain individually selectable in the list.
      const freeLanes = freeGroups.length ? 1 : 0
      const lanes = Math.max(1, bookingLanes + overflowLane + freeLanes)
      return <Fragment key={day}>
        {groups.map(group => {
          const all = group.entries.map(entry => entry.value)
          const visible = group.peak >= 3 ? group.entries.slice(0, 2) : group.entries
          return <Fragment key={all[0].id}>
            {visible.map(({ value: entry, lane }, index) => {
              const label = `${entry.start}〜${entry.end} ${entry.title} ${entry.name}`
              return <div key={entry.id} className={styles.calendarPosition} style={position(entry.start, entry.end, dayIndex, days.length)}>
                <BookingBlock placement="calendar" tone="confirmed" style={laneStyle(group.peak >= 3 ? index : lane, lanes, group.peak === 1 ? bookingLanes : 1)} title={label} aria-label={label} onClick={() => onOpen(entry.id)}>
                  <TruncatedText value={entry.title} /><TruncatedText value={entry.name} />
                </BookingBlock>
              </div>
            })}
            {group.peak >= 3 ? <div className={styles.calendarPosition} style={position(all[0].start, all.reduce((last, entry) => minutes(entry.end) > minutes(last) ? entry.end : last, all[0].end), dayIndex, days.length)}>
              <BookingBlock placement="calendar" tone="hold" style={laneStyle(bookingLanes, lanes)} aria-haspopup="dialog" title={`この時間帯の予約${all.length}件をすべて見る`} aria-label={`ほか${all.length - 2}件・この時間帯の予約${all.length}件をすべて見る`} onClick={() => setExpanded(all)}>
                <TruncatedText value={`+${all.length - 2}件`} />
              </BookingBlock>
            </div> : null}
          </Fragment>
        })}
        {freeGroups.map(group => {
          const slots = group.entries.map(entry => entry.value), slot = slots[0]
          const end = slots.reduce((last, item) => minutes(item.end) > minutes(last) ? item.end : last, slot.end)
          const label = slots.length === 1 ? `${slot.bookingDay ?? day} ${slot.bookingStart ?? slot.start}に予約を入れる` : `${day} ${slot.start}からの空き${slots.length}件を選ぶ`
          return <div key={`${slot.start}-${end}`} className={styles.calendarPosition} style={position(slot.start, end, dayIndex, days.length)}>
            <CalendarSlotButton placement="calendar" style={laneStyle(bookingLanes + overflowLane, lanes)} title={label} aria-label={label} aria-haspopup={slots.length > 1 ? 'dialog' : undefined} onClick={() => slots.length === 1 ? onSlot(slot.bookingDay ?? day, slot.bookingStart ?? slot.start) : setExpandedFree(slots)}>
              <Plus size={12} aria-hidden="true" /><TruncatedText value={slots.length === 1 ? '予約を入れる' : `空き${slots.length}件`} />
            </CalendarSlotButton>
          </div>
        })}
      </Fragment>
    })}
  </>
  return <>
    {hourCount ? <div className={styles.timeGrid} style={{ '--calendar-hour-count': hourCount } as CSSProperties}>{grid}</div> : grid}
    {expanded ? <Dialog open title={`この時間帯の予約（${expanded.length}件）`} onCancel={() => setExpanded(null)}>
      <div className={styles.calendarList}>{expanded.map(entry => <RowNameButton key={entry.id} title={`${entry.start}〜${entry.end} ${entry.title} ${entry.name}`} onClick={() => { setExpanded(null); onOpen(entry.id) }}>
        <TruncatedText value={`${entry.start}〜${entry.end} ${entry.title} ${entry.name}`} />
      </RowNameButton>)}</div>
    </Dialog> : null}
    {canWrite && expandedFree ? <Dialog open title={`予約を入れる時刻（${expandedFree.length}件）`} onCancel={() => setExpandedFree(null)}>
      <div className={styles.calendarList}>{expandedFree.map((slot, index) => <RowNameButton key={`${slot.day}-${slot.start}-${index}`} onClick={() => { setExpandedFree(null); onSlot(slot.bookingDay ?? slot.day, slot.bookingStart ?? slot.start) }}>
        <TruncatedText value={slot.bookingDay ? `${slot.bookingDay} ${slot.bookingStart}からの空きに予約を入れる` : `${slot.day} ${slot.start}〜${slot.end}に予約を入れる`} />
      </RowNameButton>)}</div>
    </Dialog> : null}
  </>
}
