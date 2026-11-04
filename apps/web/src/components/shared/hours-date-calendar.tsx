'use client'
import { useRef, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import IconButton from './icon-button'
import CalendarPeriod from './calendar-period'
import { hoursDateAdd, hoursWeekday } from '@line-crm/shared'
import styles from './hours-date-calendar.module.css'

export default function HoursDateCalendar({ month, onMonth, selected, onSelect, min, max, disabled = false, describe }: { month: string; onMonth: (month: string) => void; selected: string[]; onSelect: (date: string) => void; min: string; max: string; disabled?: boolean; describe?: (date: string) => string }) {
  const ref = useRef<HTMLDivElement>(null)
  const first = `${month}-01`, [year, m] = month.split('-').map(Number)
  const start = hoursDateAdd(first, -(['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'].indexOf(hoursWeekday(first))))
  const last = hoursDateAdd(`${m === 12 ? year + 1 : year}-${String(m === 12 ? 1 : m + 1).padStart(2,'0')}-01`, -1)
  const count = Math.ceil((Number(last.slice(-2)) + (new Date(`${first}T12:00:00Z`).getUTCDay()+6)%7)/7)*7
  const previous = hoursDateAdd(first, -1).slice(0,7), next = hoursDateAdd(last,1).slice(0,7)
  const key = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const jump: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    if (!(event.key in jump)) return
    event.preventDefault()
    const target = hoursDateAdd(date, jump[event.key])
    ref.current?.querySelector<HTMLButtonElement>(`[data-date="${target}"]`)?.focus()
  }
  return <div className={styles.calendar}>
    <div className={styles.heading}><IconButton variant="plain" aria-label="前の月" disabled={previous < min.slice(0,7)} onClick={() => onMonth(previous)}><ChevronLeft size={18} /></IconButton><strong>{year}年{m}月</strong><IconButton variant="plain" aria-label="次の月" disabled={next > max.slice(0,7)} onClick={() => onMonth(next)}><ChevronRight size={18} /></IconButton></div>
    <CalendarPeriod period={month}><div ref={ref} role="grid" aria-label={`${year}年${m}月`} className={styles.grid} data-detailed={Boolean(describe) || undefined}>
      <div role="row" className={styles.weekdays}>{['月','火','水','木','金','土','日'].map((d,i)=><span role="columnheader" data-weekend={i === 5 ? 'sat' : i === 6 ? 'sun' : undefined} key={d}>{d}</span>)}</div>
      {Array.from({length:count/7},(_,week)=><div role="row" className={styles.week} key={week}>{Array.from({length:7},(_,i)=>{const date=hoursDateAdd(start,week*7+i),outside=date.slice(0,7)!==month;return <div role="gridcell" aria-selected={selected.includes(date)} key={date} className={styles.cell} data-outside={outside || undefined}>
        <button type="button" data-part="calendar-day" data-date={date} className={styles.day} aria-label={date} aria-pressed={selected.includes(date)} disabled={disabled || date<min || date>max} onClick={()=>onSelect(date)} onKeyDown={e=>key(e,date)}>{Number(date.slice(-2))}</button>{describe&&!outside?<span className={styles.detail}>{describe(date)}</span>:null}
      </div>})}</div>)}
    </div></CalendarPeriod>
  </div>
}

export function WeekdayButtons({ labels, selected, onChange, disabled }: { labels: string[]; selected: number[]; onChange: (values: number[]) => void; disabled?: boolean }) {
 return <div className={styles.weekdayButtons} role="group" aria-label="曜日">{labels.map((label,i)=><button key={label} type="button" data-part="weekday-choice" className={styles.weekdayChoice} aria-label={`${label}曜日`} aria-pressed={selected.includes(i)} disabled={disabled} onClick={()=>onChange(selected.includes(i)?selected.filter(n=>n!==i):[...selected,i].sort())}>{label}</button>)}</div>
}
