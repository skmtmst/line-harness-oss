'use client'

import StatusBadge from './status-badge'
import type { ComponentProps } from 'react'
import styles from './month-calendar.module.css'
import CalendarPeriod from './calendar-period'

export type MonthCalendarDay = { date: string; day: string | number; inMonth: boolean; closed?: boolean; today?: boolean; selected?: boolean; empty?: boolean; groups?: number; people?: number; mark?: { tone: ComponentProps<typeof StatusBadge>['tone']; label: string } | null }

/** 曜日7列・日ごとの件数と状態を出す月の盤。日付移動は呼び出し側が持つ。 */
export default function MonthCalendarGrid({ title, days, onDay }: { title: string; days: MonthCalendarDay[]; onDay: (date: string) => void }) {
  return (
      <CalendarPeriod period={days.find(day => day.inMonth)?.date.slice(0, 7) ?? ''}><div className={styles.monthFrame} role="grid" aria-label={title}>
        <div className={styles.monthWeekdays} role="row">
          {['月', '火', '水', '木', '金', '土', '日'].map((w, i) => <span key={w} role="columnheader" data-day={i === 5 ? 'sat' : i === 6 ? 'sun' : undefined}>{w}</span>)}
        </div>
        <div className={styles.monthCells}>
          {days.map((d) => (
            <button key={d.date} type="button" role="gridcell" className={styles.monthCell} data-out={!d.inMonth || undefined} data-closed={d.closed || undefined} data-today={d.today || undefined} data-selected={d.selected || undefined} aria-current={d.today ? 'date' : undefined} aria-selected={Boolean(d.selected)} aria-label={`${d.date}${d.today ? '・今日' : ''}${d.selected ? '・選択中' : ''}`} onClick={() => onDay(d.date)}>
              <span className={styles.monthTop}><strong>{d.day}</strong>{d.today ? <span className={styles.monthNote}>今日</span> : null}<span className={styles.grow} />{d.mark ? <StatusBadge tone={d.mark.tone} dot={false} size="micro">{d.mark.label}</StatusBadge> : null}</span>
              {d.closed ? <span className={styles.monthNote}>定休日</span> : d.empty ? <span className={styles.monthNote}>予約なし</span> : d.groups !== undefined ? <><strong className={styles.monthGroups}>{d.groups}組</strong><span className={styles.monthNote}>{d.people}人</span></> : null}
            </button>
          ))}
        </div>
      </div></CalendarPeriod>
  )
}
