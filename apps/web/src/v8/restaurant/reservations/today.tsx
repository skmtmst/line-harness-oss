'use client'

/*
 * ★V8 予約台帳「今日」（時間×卓・板 `l9NlC0`、1152 は `xzCK6`）。
 *
 * 数4（今日の予約・承認待ち・未配席・押さえ）→ 日付の段（前後・今日・停止中の卓の注意・予約元）→
 * 左に時間×卓の表（列は卓、行は30分、予約は行をまたぐ箱）、右に次の予約・今日気をつけること・
 * 内訳・つながる先。1152 では右の欄が表の下に積まれる（CSS だけ）。
 * 箱は予約元の色（LINE・レストランボード＝緑、予約媒体＝赤、電話＝灰）、承認待ちは黄の枠、押さえは灰の枠。
 */
import { useMemo } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import type { RestaurantReservation, RestaurantTable } from '@/lib/restaurant-test-api'
import { Stat, StatRow } from '../booking-kit/shell'
import {
  INACTIVE_STATUSES, SOURCE_LABEL, dayShort, dayTitle, floorOrder, hm, isHold, mdWeek, minutesOf,
  sameDay, shortCourse, slotLabel, sourceKind, sourceName,
} from './format'
import styles from './reservations.module.css'

export type PhonePreset = { date?: Date; time?: string; tableId?: string; hold?: boolean }

const SLOT = 30
const ROW_START = 17 * 60
const ROW_END = 22 * 60

function Block({ item, onOpen }: { item: RestaurantReservation; onOpen: (id: string) => void }) {
  const hold = isHold(item)
  const pending = !hold && item.status === 'pending'
  const kind = sourceKind(item.source)
  return (
    <button
      type="button"
      className={`${styles.block} ${hold ? styles.blockHold : pending ? styles.blockPending : kind === 'line' ? styles.blockLine : kind === 'phone' ? styles.blockPhone : styles.blockMedia}`}
      onClick={() => onOpen(item.id)}
      aria-label={hold
        ? `押さえ ${hm(item.starts_at)}〜${hm(item.ends_at)}`
        : `${item.customer_name} ${item.guest_count}名 ${hm(item.starts_at)}〜${hm(item.ends_at)}`}
    >
      {hold ? (
        <>
          <span className={styles.holdName}>押さえ</span>
          <span className={styles.blockMeta}>{item.note || item.allergy_note || '仮押さえ'}</span>
          <span className={styles.holdTime}>{`🔒 ${hm(item.starts_at)}〜${hm(item.ends_at)}`}</span>
        </>
      ) : (
        <>
          <span className={styles.blockName}>{item.customer_name}</span>
          <span className={styles.blockMeta}>{`${item.guest_count}名・${shortCourse(item.course_name)}`}</span>
          <span className={`${styles.blockSource} ${pending ? styles.srcPending : kind === 'line' ? styles.srcLine : kind === 'phone' ? styles.srcPhone : styles.srcMedia}`}>{sourceName(item.source)}</span>
          {item.allergy_note ? <span className={styles.blockAlert}>{`⚠ ${item.allergy_note}`}</span> : null}
          {pending ? <span className={styles.blockPendingText}>承認待ち</span> : null}
        </>
      )}
    </button>
  )
}

export default function TodayView({ rows, later, tables, day, isToday, busy, canWrite, source, onSource, onDay, onAdd, onOpen }: {
  /** その日の予約（取消・無断も含む。表と数では除く）。 */
  rows: RestaurantReservation[]
  /** 次の予約を探すための、その月の予約（その日の残りが無いとき、次の日以降から出す）。 */
  later: RestaurantReservation[]
  tables: RestaurantTable[]
  day: Date
  isToday: boolean
  busy: boolean
  canWrite: boolean
  source: string
  onSource: (value: string) => void
  onDay: (day: Date) => void
  onAdd: (preset: PhonePreset) => void
  onOpen: (id: string) => void
}) {
  const live = useMemo(() => rows.filter((item) => !INACTIVE_STATUSES.includes(item.status)), [rows])
  const shown = useMemo(() => (source === 'all' ? live : live.filter((item) => item.source === source)), [live, source])
  const bookings = useMemo(() => shown.filter((item) => !isHold(item)), [shown])
  const holds = useMemo(() => shown.filter(isHold), [shown])

  /* 停止中の卓は、その日に予約が入っていなければ出さない。 */
  const columns = useMemo(() => {
    const used = new Set(shown.map((item) => item.table_id).filter(Boolean) as string[])
    return tables.filter((table) => table.is_active || used.has(table.id)).sort(floorOrder)
  }, [tables, shown])
  const hidden = tables.filter((table) => !table.is_active && !columns.includes(table))

  const slots = useMemo(() => {
    let min = ROW_START
    let max = ROW_END
    for (const item of shown) {
      if (Number.isNaN(new Date(item.starts_at).getTime())) continue
      min = Math.min(min, Math.floor(minutesOf(item.starts_at) / SLOT) * SLOT)
      const end = new Date(item.ends_at)
      if (!Number.isNaN(end.getTime())) max = Math.max(max, Math.ceil(minutesOf(item.ends_at) / SLOT) * SLOT)
    }
    const list: number[] = []
    for (let m = min; m < max; m += SLOT) list.push(m)
    return list
  }, [shown])

  /* 卓ごとに、ある時間に始まる予約と、その予約がまたぐ行の数。 */
  const starts = useMemo(() => {
    const map = new Map<string, { item: RestaurantReservation; span: number }>()
    for (const item of shown) {
      if (!item.table_id) continue
      const start = Math.floor(minutesOf(item.starts_at) / SLOT) * SLOT
      const end = Math.max(start + SLOT, Math.ceil(minutesOf(item.ends_at) / SLOT) * SLOT)
      map.set(`${item.table_id}@${start}`, { item, span: Math.max(1, Math.round((end - start) / SLOT)) })
    }
    return map
  }, [shown])

  const now = new Date()
  const nowMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : -1

  /* 次の予約：その日の残りから。無ければ（営業の後など）次の日以降の予約から出し、日付も書く。 */
  const next = useMemo(() => {
    const nowMs = isToday ? Date.now() : new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
    const sorted = (list: RestaurantReservation[]) => list
      .filter((item) => !INACTIVE_STATUSES.includes(item.status) && !isHold(item) && new Date(item.starts_at).getTime() >= nowMs)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    return sorted(bookings)[0] ?? sorted(later.filter((item) => source === 'all' || item.source === source))[0] ?? null
  }, [bookings, later, isToday, day, source])
  const nextOtherDay = next ? !sameDay(new Date(next.starts_at), day) : false

  const pending = bookings.filter((item) => item.status === 'pending')
  const allergies = bookings.filter((item) => item.allergy_note).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const tableById = new Map(tables.map((table) => [table.id, table]))

  /* いちばん混む時間（始まる予約の人数がいちばん多い30分）に空いている卓。 */
  const peak = useMemo(() => {
    let best = -1
    let bestSeats = -1
    for (const slot of slots) {
      const seats = shown.filter((item) => minutesOf(item.starts_at) <= slot && minutesOf(item.ends_at) > slot).reduce((sum, item) => sum + item.guest_count, 0)
      if (seats > bestSeats) { best = slot; bestSeats = seats }
    }
    return best
  }, [slots, shown])
  const freeAtPeak = peak < 0 ? [] : columns.filter((table) => table.is_active && !shown.some((item) => item.table_id === table.id && minutesOf(item.starts_at) <= peak && minutesOf(item.ends_at) > peak))

  const guests = bookings.reduce((sum, item) => sum + item.guest_count, 0)
  const lineCount = bookings.filter((item) => item.source === 'line').length
  const phoneCount = bookings.filter((item) => item.source === 'phone' || item.source === 'manual').length
  const mediaCount = bookings.length - lineCount - phoneCount
  const unseated = bookings.filter((item) => !item.table_id).length
  const pendingSources = [...new Set(pending.map((item) => sourceName(item.source)))].join('・')

  return (
    <>
      <StatRow compact>
        <Stat label="今日の予約" value={`${bookings.length}件`} note={`${guests}名`} />
        <Stat label="承認待ち" value={`${pending.length}件`} note={pendingSources || 'ありません'} warning={pending.length > 0} />
        <Stat label="未配席" value={`${unseated}件`} note={unseated === 0 ? 'すべて卓に入っています' : '卓の割当が必要'} warning={unseated > 0} />
        <Stat label="押さえ" value={`${holds.length}枠`} note={holds[0]?.note || holds[0]?.allergy_note || '期限付きの仮押さえ'} />
      </StatRow>
      <div className={styles.dateBar}>
        <IconButton aria-label="前の日" className={styles.dateIcon} onClick={() => onDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1))}><ChevronLeft size={16} aria-hidden="true" /></IconButton>
        <h2 className={styles.dateTitle}>{dayTitle(day)}</h2>
        <IconButton aria-label="次の日" className={styles.dateIcon} onClick={() => onDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1))}><ChevronRight size={16} aria-hidden="true" /></IconButton>
        <Button onClick={() => onDay(new Date())} disabled={isToday}>今日</Button>
        <span className={styles.dateSpacer} />
        {hidden.length > 0 ? <span className={styles.dateNote}>{`${hidden.map((table) => table.code).join('・')} は停止中のため出していません`}</span> : null}
        <span className={styles.sourcePicker}>
          <Select
            aria-label="予約元"
            size="full"
            value={source}
            onChange={onSource}
            options={[{ value: 'all', label: '予約元：すべて' }, ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label: `予約元：${label}` }))]}
          />
        </span>
      </div>
      <div className={styles.todayColumns}>
        <div className={styles.calendarWrap} role="region" aria-label={`${dayTitle(day)}の時間×卓`}>
        <DataTable className={styles.calendar}>
          <thead>
            <TableHeadRow className={styles.calHead}>
              <Th className={`${styles.calTh} ${styles.calTimeHead}`}><span className={styles.srOnly}>時刻</span></Th>
              {columns.map((table) => (
                <Th key={table.id} className={styles.calTh} title={`${table.code}・${table.label}（${table.min_capacity}〜${table.max_capacity}名）`}>{`${table.code} ${table.max_capacity}名`}</Th>
              ))}
            </TableHeadRow>
          </thead>
          <tbody>
            {slots.map((slot) => {
              const current = nowMinutes >= slot && nowMinutes < slot + SLOT
              return (
                <Tr key={slot} className={styles.calRow}>
                  <Th scope="row" className={styles.calTime}>
                    {slotLabel(slot)}
                    {current ? (
                      <>
                        <span className={`${styles.nowLine} ${nowMinutes - slot >= SLOT / 2 ? styles.nowLate : ''}`} aria-hidden="true" />
                        <span className={`${styles.nowLabel} ${nowMinutes - slot >= SLOT / 2 ? styles.nowLate : ''}`}>いま</span>
                      </>
                    ) : null}
                  </Th>
                  {columns.map((table) => {
                    const covered = [...starts.values()].some(({ item, span }) => {
                      if (item.table_id !== table.id) return false
                      const start = Math.floor(minutesOf(item.starts_at) / SLOT) * SLOT
                      return slot > start && slot < start + span * SLOT
                    })
                    if (covered) return null
                    const found = starts.get(`${table.id}@${slot}`)
                    if (found) {
                      return (
                        <Td key={table.id} rowSpan={found.span} className={styles.calCell}>
                          <Block item={found.item} onOpen={onOpen} />
                        </Td>
                      )
                    }
                    return (
                      <Td key={table.id} className={styles.calCell}>
                        {canWrite && table.is_active ? (
                          <button
                            type="button"
                            className={styles.slotAdd}
                            disabled={busy}
                            aria-label={`${table.code} ${slotLabel(slot)} に予約を入れる`}
                            onClick={() => onAdd({ date: day, time: slotLabel(slot), tableId: table.id })}
                          >
                            ＋ 予約を入れる
                          </button>
                        ) : null}
                      </Td>
                    )
                  })}
                </Tr>
              )
            })}
          </tbody>
        </DataTable>
        </div>
        <div className={styles.side}>
          <section className={styles.sideCard} aria-labelledby="rs-next-title">
            <h3 id="rs-next-title" className={styles.sideTitle}>次の予約</h3>
            {next ? (
              <>
                <div className={styles.nextBox}>
                  <p className={styles.nextName}>{`${next.customer_name}さん・${next.guest_count}名`}</p>
                  <p className={styles.nextMeta}>{`${nextOtherDay ? `${mdWeek(new Date(next.starts_at))} ` : ''}${hm(next.starts_at)}〜${hm(next.ends_at)} ・ ${next.table_id ? tableById.get(next.table_id)?.code ?? next.table_label : '未配席'} ・ ${shortCourse(next.course_name)}`}</p>
                  <p className={`${styles.nextFrom} ${next.status === 'pending' ? styles.srcPending : sourceKind(next.source) === 'line' ? styles.srcLine : sourceKind(next.source) === 'phone' ? styles.srcPhone : styles.srcMedia}`}>{`${sourceName(next.source)} から`}</p>
                </div>
                <div className={styles.nextActions}>
                  <Button onClick={() => onOpen(next.id)}>詳細を見る</Button>
                  <Button onClick={() => onOpen(next.id)}>卓を変える</Button>
                </div>
              </>
            ) : (
              <p className={styles.sideText}>この日の残りの予約はありません。</p>
            )}
          </section>
          <section className={styles.sideCard} aria-labelledby="rs-care-title">
            <h3 id="rs-care-title" className={styles.sideTitle}>{isToday ? '今日 気をつけること' : '気をつけること'}</h3>
            <p className={styles.sideText}>
              {pending.length > 0
                ? `・承認待ちが ${pending.length} 件（${pending.map((item) => `${item.customer_name.split(/\s+/)[0]}さん・${sourceName(item.source)}`).join('、')}）`
                : '・承認待ちはありません'}
            </p>
            {allergies.length > 0 ? (
              <p className={`${styles.sideText} ${styles.sideAlert}`}>{`・アレルギーあり ${allergies.length} 件（${allergies.map((item) => (item.allergy_note ?? '').replace(/・/g, '')).join('・')}）`}</p>
            ) : null}
            {peak >= 0 ? (
              <p className={styles.sideText}>
                {freeAtPeak.length === 0
                  ? `・${slotLabel(peak)} に空いている卓はありません`
                  : `・${slotLabel(peak)} に空いているのは ${freeAtPeak.map((table) => `${table.code}（${table.label} ${table.max_capacity}名）`).join('・')}${freeAtPeak.length === 1 ? 'だけ' : ''}`}
              </p>
            ) : null}
          </section>
          <section className={styles.sideCard} aria-labelledby="rs-break-title">
            <h3 id="rs-break-title" className={styles.sideTitle}>{`${dayShort(day)}の内訳`}</h3>
            <p className={styles.breakRow}><span>予約</span><strong>{`${bookings.length} 件・${guests} 名`}</strong></p>
            <p className={styles.breakRow}><span>LINE から</span><strong>{`${lineCount} 件`}</strong></p>
            <p className={styles.breakRow}><span>予約媒体から</span><strong>{`${mediaCount} 件`}</strong></p>
            <p className={styles.breakRow}><span>電話</span><strong>{`${phoneCount} 件`}</strong></p>
            <p className={styles.breakRow}><span>押さえ</span><strong>{`${holds.length} 枠${holds.length > 0 ? `（${holds.map((item) => (item.table_id ? tableById.get(item.table_id)?.code : null) ?? '未配席').join('・')}）` : ''}`}</strong></p>
          </section>
          <section className={styles.sideCard} aria-labelledby="rs-links-title">
            <h3 id="rs-links-title" className={styles.sideTitle}>つながる先</h3>
            <Link className={styles.sideLink} href="/restaurant-test/inventory">予約枠・在庫 → 時間帯ごとの空き</Link>
            <Link className={styles.sideLink} href="/restaurant-test/tables">座席・卓管理 → 卓の結合・停止</Link>
            <Link className={styles.sideLink} href="/restaurant-test/line-followup">LINE来店フォロー → 前日・当日のご案内</Link>
          </section>
        </div>
      </div>
    </>
  )
}
