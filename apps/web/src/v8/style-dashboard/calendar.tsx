'use client'
import { ChevronLeft, ChevronRight, Info, Plus } from 'lucide-react'
import type { CSSProperties } from 'react'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import StatusBadge from '@/components/shared/status-badge'
import type { StyleMonth, StyleWeek } from './model'
import styles from './style-dashboard.module.css'

/*
 * 1枚目のタブの「カレンダー」（B-318）。1週間＝週の形（UtmIg）、1か月＝月の形（R28Jqt）。
 * 予約を押すと詳細、空きを押すと予約を入れる、日を押すとその日の予約が右に出る。
 */

const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }
const FROM = '10:00'
const box = (start: string, end: string, day: number, days: number): CSSProperties => ({
  insetBlockStart: `calc(var(--tpl-sd-week-hour) * ${(toMin(start) - toMin(FROM)) / 60} + var(--tpl-sd-board-top))`,
  blockSize: `calc(var(--tpl-sd-week-hour) * ${(toMin(end) - toMin(start)) / 60} - var(--tpl-sd-entry-gap))`,
  insetInlineStart: `calc(var(--tpl-sd-time-col) + (100% - var(--tpl-sd-time-col)) / ${days} * ${day})`,
  inlineSize: `calc((100% - var(--tpl-sd-time-col)) / ${days})`,
})

function Pager({ title, todayLabel, onMove }: { title: string; todayLabel: string; onMove: (step: -1 | 0 | 1) => void }) {
  return (
    <div className={styles.calPager}>
      <IconButton aria-label="前へ" onClick={() => onMove(-1)}><ChevronLeft size={16} /></IconButton>
      <h3 className={styles.calTitle}>{title}</h3>
      <IconButton aria-label="次へ" onClick={() => onMove(1)}><ChevronRight size={16} /></IconButton>
      <Button onClick={() => onMove(0)}>{todayLabel}</Button>
    </div>
  )
}

export function WeekCalendar({ week, canWrite, onMove, onSlot, onOpen }: { week: StyleWeek; canWrite: boolean; onMove: (step: -1 | 0 | 1) => void; onSlot: (day: string, start: string) => void; onOpen: (id: string) => void }) {
  const hours: string[] = []
  for (let h = 10; h <= 19; h += 1) hours.push(`${h}:00`)
  const index = (day: string) => week.days.findIndex((d) => d.date === day)
  return (
    <section className={styles.calendar} aria-label="1週間のカレンダー">
      <div className={styles.calTools}>
        <Pager title={week.title} todayLabel="今週" onMove={onMove} />
        <span className={styles.grow} />
        <span className={styles.calLegend}><i data-k="booked" />予約<i data-k="free" />空き<i data-k="off" />休み</span>
      </div>
      <div className={styles.weekFrame}>
        <div className={styles.weekHead}>
          <span className={styles.boardTimeHead} />
          {week.days.map((d) => (
            <div key={d.date} className={styles.weekDay} data-today={d.today || undefined}>
              <strong>{d.label}</strong><span>{d.sub}</span>
            </div>
          ))}
        </div>
        <div className={styles.weekGrid}>
          {hours.map((h) => <div key={h} className={styles.boardLine} style={{ insetBlockStart: `calc(var(--tpl-sd-week-hour) * ${toMin(h) / 60 - 10} + var(--tpl-sd-board-top))` }}><span className={styles.boardHour}>{h.padStart(5, '0')}</span></div>)}
          {week.days.map((d, i) => <span key={d.date} className={styles.boardDivider} data-closed={d.closed || undefined} style={{ insetInlineStart: `calc(var(--tpl-sd-time-col) + (100% - var(--tpl-sd-time-col)) / ${week.days.length} * ${i})`, inlineSize: `calc((100% - var(--tpl-sd-time-col)) / ${week.days.length})` }}>{d.closed ? <span className={styles.closedLabel}>定休日</span> : null}</span>)}
          {week.entries.map((e) => {
            const i = index(e.day)
            return i < 0 ? null : (
              <button key={e.id} type="button" className={styles.weekEntry} style={box(e.start, e.end, i, week.days.length)} onClick={() => onOpen(e.id)}>
                <strong>{e.title}</strong><span>{e.name}</span>
              </button>
            )
          })}
          {canWrite ? week.free.map((f) => {
            const i = index(f.day)
            return i < 0 ? null : (
              <button key={`${f.day}-${f.start}`} type="button" className={styles.weekFree} style={box(f.start, f.end, i, week.days.length)} onClick={() => onSlot(f.day, f.start)}><Plus size={12} aria-hidden="true" />予約を入れる</button>
            )
          }) : null}
        </div>
      </div>
    </section>
  )
}

export function MonthCalendar({ month, onMove, onDay }: { month: StyleMonth; onMove: (step: -1 | 0 | 1) => void; onDay: (date: string) => void }) {
  return (
    <section className={styles.calendar} aria-label="1か月のカレンダー">
      <div className={styles.calTools}>
        <Pager title={month.title} todayLabel="今月" onMove={onMove} />
        <span className={styles.grow} />
        <span className={styles.calLegend}><i data-k="few" />満席に近い<i data-k="full" />満席<i data-k="off" />休み</span>
      </div>
      <div className={styles.monthFrame} role="grid" aria-label={month.title}>
        <div className={styles.monthWeekdays} role="row">
          {['月', '火', '水', '木', '金', '土', '日'].map((w, i) => <span key={w} role="columnheader" data-day={i === 5 ? 'sat' : i === 6 ? 'sun' : undefined}>{w}</span>)}
        </div>
        <div className={styles.monthCells}>
          {month.days.map((d) => (
            <button key={d.date} type="button" role="gridcell" className={styles.monthCell} data-out={!d.inMonth || undefined} data-closed={d.closed || undefined} data-today={d.today || undefined} onClick={() => onDay(d.date)}>
              <span className={styles.monthTop}><strong>{d.day}</strong><span className={styles.grow} />{d.mark ? <StatusBadge tone={d.mark.tone} dot={false} size="micro">{d.mark.label}</StatusBadge> : null}</span>
              {d.closed ? <span className={styles.monthNote}>定休日</span> : d.empty ? <span className={styles.monthNote}>予約なし</span> : d.groups !== undefined ? <><strong className={styles.monthGroups}>{d.groups}組</strong><span className={styles.monthNote}>{d.people}人</span></> : null}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

export function DayList({ month, href }: { month: StyleMonth; href: string }) {
  const s = month.selected
  return (
    <div className={styles.dayList}>
      <div className={styles.dayListHead}><h3 className={styles.sideTitle}>{s.title}</h3><span className={styles.grow} /><span className={styles.cellMuted}>{s.total}</span></div>
      <div className={styles.dayListCard}>
        {s.rows.map((r) => (
          <div key={`${r.time}-${r.name}`} className={styles.dayRow}>
            <strong className={styles.dayTime}>{r.time}</strong>
            <span className={styles.dayName}><a href={href}>{r.name}</a><span className={styles.cellSub}>{r.sub}</span></span>
            <span className={styles.grow} />
            <StatusBadge tone={r.state.tone}>{r.state.label}</StatusBadge>
          </div>
        ))}
      </div>
      <a className={styles.sideMore} href={href}>{s.moreLabel}</a>
      <p className={styles.dayHint}><Info size={14} aria-hidden="true" />日を押すと、その日の予約がここに出ます。休みは［休みを入れる］から。</p>
    </div>
  )
}
