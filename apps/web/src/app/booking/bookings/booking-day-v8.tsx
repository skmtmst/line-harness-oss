'use client'

import { useMemo, useState } from 'react'
import ActionMenu from '@/components/shared/action-menu'
import styles from './booking-day-v8.module.css'
import Button from '@/components/shared/button'
import { notifyToast } from '@/components/shared/toast'
import type {
  BookingTodayRow,
  BookingVisitMark,
} from '@/lib/api'

/**
 * 予約管理の「日」（時刻順）（Pencil B-1 `AlwZz` 人・`V8TfD` 席）。
 *
 * V8 のときだけ使う。1本の時刻の帯に予約を並べ、その場で印を付ける。
 * - 来店した・遅れる：押すとすぐ印が付き、下の知らせの「元に戻す」で戻せる
 * - 来なかった：押し間違いを防ぐため「…」の中
 * - 右にキャンセル待ち（席は空き待ち）の列
 */
export interface DayWaitEntry {
  id: string
  startsAt: string
  title: string
  sub: string
  status: 'waiting' | 'invited'
  holdExpiresAt: string | null
  /** 同じ開始時刻の中での順番（1番目〜）。 */
  position: number
}

const LATE_OPTIONS = [5, 10, 15, 30]

function jstTime(iso: string): string {
  const date = new Date(iso)
  const jst = new Date(date.getTime() + 9 * 3_600_000)
  return `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
}

function jstNowTime(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 3_600_000)
  return `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
}

/** 仮押さえの残り分数。切れていたら null。 */
function holdLeftMinutes(holdExpiresAt: string | null, now: Date): number | null {
  if (!holdExpiresAt) return null
  const left = Math.ceil((Date.parse(holdExpiresAt) - now.getTime()) / 60_000)
  return left > 0 ? left : null
}

function rowSub(row: BookingTodayRow): string {
  if (row.kind === 'seat') {
    const table = row.table_label ?? '席の指定なし'
    const course = row.course_name ? `・${row.course_name}` : ''
    return `${row.guest_count}名・${table}${course}`
  }
  return `${row.menu_name}・担当 ${row.staff_name}`
}

function rowName(row: BookingTodayRow): string {
  return row.kind === 'seat' ? `${row.customer_name} 様` : (row.customer_name ?? '名前の登録なし')
}

function DayRow({
  row, busy, canMark, lateOpen, moreOpen, onLate, onCloseLate, onMore, onCloseMore, onMark, onUnmark,
}: {
  row: BookingTodayRow
  busy: boolean
  canMark: boolean
  lateOpen: boolean
  moreOpen: boolean
  onLate: () => void
  onCloseLate: () => void
  onMore: () => void
  onCloseMore: () => void
  onMark: (kind: 'visited' | 'late' | 'no_show', lateMinutes?: number) => void
  onUnmark: () => void
}) {
  const mark = row.visit_mark
  return (
    <li className={`${styles.row}${mark?.kind === 'late' ? ` ${styles.isLate}` : ''}`}>
      <span className={`${styles.time}`}>{jstTime(row.starts_at)}</span>
      <span className={`${styles.main}`}>
        <span className={`${styles.name}`}>
          {rowName(row)}
          {row.kind === 'seat' ? <span className={`${styles.kind}`}>席</span> : null}
        </span>
        <span className={`${styles.sub}`}>{rowSub(row)}</span>
      </span>
      {canMark ? (
      <span className={`${styles.ops}`}>
        {mark?.kind === 'visited' ? (
          <>
            <span className={`${styles.pill} ${styles.isDone}`}>✓来店した</span>
            <button type="button" className={`${styles.undo}`} disabled={busy} onClick={onUnmark}>取り消す</button>
          </>
        ) : mark?.kind === 'late' ? (
          <>
            <span className={`${styles.pill} ${styles.isLatePill}`}>{mark.late_minutes}分遅れる</span>
            <Button variant="primary" size="compact" disabled={busy} onClick={() => onMark('visited')}>来店した</Button>
          </>
        ) : mark?.kind === 'no_show' ? (
          <>
            <span className={`${styles.pill} ${styles.isMiss}`}>来なかった</span>
            <button type="button" className={`${styles.undo}`} disabled={busy} onClick={onUnmark}>取り消す</button>
          </>
        ) : (
          <>
            <Button variant="primary" size="compact" disabled={busy} onClick={() => onMark('visited')}>来店した</Button>
            <span className={`${styles.menuwrap}`}>
              <Button variant="secondary" size="compact" disabled={busy} onClick={onLate} aria-expanded={lateOpen}>遅れる</Button>
              <ActionMenu
                open={lateOpen}
                onClose={onCloseLate}
                ariaLabel="遅れる分数"
                items={LATE_OPTIONS.map((minutes) => ({
                  id: `late-${minutes}`,
                  label: `${minutes}分`,
                  onSelect: () => onMark('late', minutes),
                }))}
              />
            </span>
            <span className={`${styles.menuwrap}`}>
              <Button variant="secondary" size="compact" disabled={busy} onClick={onMore} aria-label="その他の操作" aria-expanded={moreOpen}>…</Button>
              <ActionMenu
                open={moreOpen}
                onClose={onCloseMore}
                ariaLabel="その他の操作"
                items={[{ id: 'no-show', label: '来なかった', onSelect: () => onMark('no_show') }]}
              />
            </span>
          </>
        )}
      </span>
      ) : null}
    </li>
  )
}

function markVerb(kind: BookingVisitMark['kind'], lateMinutes: number | null): string {
  if (kind === 'visited') return '来店しました'
  if (kind === 'no_show') return '来なかったにしました'
  return `${lateMinutes ?? 0}分遅れにしました`
}

export default function BookingDayTimeline({
  rows,
  waitlist,
  waitlistTitle,
  waitlistNote,
  loading,
  now,
  showNowLine,
  busyId,
  canMark = true,
  onMark,
  onUnmark,
}: {
  rows: BookingTodayRow[]
  waitlist: DayWaitEntry[]
  waitlistTitle: string
  waitlistNote: string
  loading: boolean
  now: Date
  showNowLine: boolean
  busyId: string | null
  canMark?: boolean
  onMark: (row: BookingTodayRow, kind: 'visited' | 'late' | 'no_show', lateMinutes?: number) => Promise<boolean>
  onUnmark: (row: BookingTodayRow) => Promise<boolean>
}) {
  const [lateFor, setLateFor] = useState<string | null>(null)
  const [moreFor, setMoreFor] = useState<string | null>(null)

  const counts = useMemo(() => {
    let visited = 0
    let late = 0
    let noShow = 0
    for (const row of rows) {
      if (row.visit_mark?.kind === 'visited') visited += 1
      else if (row.visit_mark?.kind === 'late') late += 1
      else if (row.visit_mark?.kind === 'no_show') noShow += 1
    }
    return { total: rows.length, visited, late, noShow }
  }, [rows])

  const nowIso = now.toISOString()
  const nowIndex = rows.findIndex((row) => row.starts_at > nowIso)

  async function handleMark(row: BookingTodayRow, kind: 'visited' | 'late' | 'no_show', lateMinutes?: number) {
    setLateFor(null)
    setMoreFor(null)
    const ok = await onMark(row, kind, lateMinutes)
    if (!ok) return
    const undo = notifyToast(markVerb(kind, lateMinutes ?? null), {
      actionLabel: '元に戻す',
      onAction: () => { void onUnmark(row) },
    })
    void undo
  }

  async function handleUnmark(row: BookingTodayRow) {
    const ok = await onUnmark(row)
    if (ok) notifyToast('印を取り消しました')
  }

  return (
    <div className={`${styles.root}`}>
      <div className={`${styles.tiles}`} role="status" aria-label="今日の数">
        <div className={`${styles.tile}`}><span className={`${styles.tileTitle}`}>予約</span><span className={`${styles.tileNum}`}>{loading ? '—' : counts.total}</span></div>
        <div className={`${styles.tile}`}><span className={`${styles.tileTitle}`}>来店した</span><span className={`${styles.tileNum}`}>{loading ? '—' : counts.visited}</span></div>
        <div className={`${styles.tile}`}><span className={`${styles.tileTitle}`}>遅れる</span><span className={`${styles.tileNum}`}>{loading ? '—' : counts.late}</span></div>
        <div className={`${styles.tile}`}><span className={`${styles.tileTitle}`}>来なかった</span><span className={`${styles.tileNum}`}>{loading ? '—' : counts.noShow}</span></div>
        <div className={`${styles.tile}`}><span className={`${styles.tileTitle}`}>{waitlistTitle}</span><span className={`${styles.tileNum}`}>{loading ? '—' : waitlist.length}</span></div>
      </div>
      <div className={`${styles.cols}`}>
        <ol className={`${styles.timeline}`} aria-label="時刻順の予約">
          {loading ? (
            <li className={`${styles.row}`}><span className={`${styles.empty}`}>読み込んでいます</span></li>
          ) : rows.length === 0 ? (
            <li className={`${styles.row}`}><span className={`${styles.empty}`}>この日の予約はありません</span></li>
          ) : (
            rows.flatMap((row, index) => {
              const nodes = []
              if (showNowLine && index === nowIndex) {
                nodes.push(
                  <li key="now-line" className={`${styles.now}`} aria-hidden="true">
                    <span>いま {jstNowTime(now)}</span>
                  </li>,
                )
              }
              nodes.push(<DayRow key={row.id} row={row} busy={busyId === row.id} canMark={canMark} lateOpen={lateFor === row.id} moreOpen={moreFor === row.id} onLate={() => { setMoreFor(null); setLateFor(row.id) }} onCloseLate={() => setLateFor(null)} onMore={() => { setLateFor(null); setMoreFor(row.id) }} onCloseMore={() => setMoreFor(null)} onMark={(kind, lateMinutes) => void handleMark(row, kind, lateMinutes)} onUnmark={() => void handleUnmark(row)} />)
              return nodes
            })
          )}
        </ol>
        <aside className={`${styles.wait}`} aria-label={waitlistTitle}>
          <h3>{waitlistTitle} <span className={`${styles.waitCount}`}>{loading ? '' : `${waitlist.length}人`}</span></h3>
          {waitlist.length === 0 && !loading ? (
            <p className={`${styles.waitEmpty}`}>待っている人はいません</p>
          ) : (
            <ul>
              {waitlist.map((entry) => {
                const left = entry.status === 'invited' ? holdLeftMinutes(entry.holdExpiresAt, now) : null
                return (
                  <li key={entry.id} className={`${styles.waitRow}`}>
                    <p className={`${styles.waitTitle}`}>{jstTime(entry.startsAt)} {entry.title}</p>
                    <p className={`${styles.waitSub}`}>
                      {entry.position}番目{entry.status === 'invited' && left !== null ? `・知らせた（あと${left}分）` : ''}
                    </p>
                    <p className={`${styles.waitSub}`}>{entry.sub}</p>
                  </li>
                )
              })}
            </ul>
          )}
          <p className={`${styles.waitNote}`}>{waitlistNote}</p>
        </aside>
      </div>
    </div>
  )
}
