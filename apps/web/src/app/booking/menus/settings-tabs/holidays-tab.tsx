'use client'

/* ③ 休業日（KRgTQ）（settings-v8.tsx から分割。見た目・動きは変えない） */

import { useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import DateField from '@/components/shared/date-field'
import { ApiError, bookingApi, type BookingException, type BookingSettings } from '@/lib/api'
import {
  AccountIcon,
  Band,
  JST_OFFSET_MS,
  StateCard,
  SkeletonRows,
  WEEKDAY_JP,
  addDaysStr,
  useV8TabEdit,
  type LoadStatus,
} from './shared'
import styles from '../settings-v8.module.css'

function monthWeeks(month: string): string[][] {
  const first = new Date(`${month}-01T00:00:00Z`)
  const start = addDaysStr(`${month}-01`, -first.getUTCDay())
  const weeks: string[][] = []
  let cursor = start
  while (cursor.slice(0, 7) <= month) {
    const week = Array.from({ length: 7 }, (_, i) => addDaysStr(cursor, i))
    weeks.push(week)
    cursor = addDaysStr(cursor, 7)
  }
  return weeks
}

function shiftMonth(month: string, delta: number): string {
  const d = new Date(`${month}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + delta)
  return d.toISOString().slice(0, 7)
}

function jpDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAY_JP[d.getUTCDay()]}）`
}

export function HolidaysTabV8({ accountId, settings, status, error, exceptions, closedWeekdays, bookingCountOnClosed, canEdit, onSaved, onReload }: {
  accountId: string
  settings: BookingSettings | null
  status: LoadStatus
  error: string | null
  exceptions: BookingException[]
  closedWeekdays: number[]
  /** 休みにした日に入っている予約の件数。null は未集計。 */
  bookingCountOnClosed: number | null
  canEdit: boolean
  onSaved: (settings: BookingSettings) => void
  onReload: () => void
}) {
  const today = useMemo(() => new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10), [])
  const [month, setMonth] = useState(today.slice(0, 7))
  const [editing, setEditing] = useState<BookingException | 'new' | null>(null)
  const [editFrom, setEditFrom] = useState('')
  const [editTo, setEditTo] = useState('')
  const [editReason, setEditReason] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BookingException | null>(null)
  const inFlightRef = useRef(false)

  const closedExceptions = useMemo(
    () => exceptions.filter((item) => item.kind === 'closed').sort((a, b) => (a.dateFrom || '').localeCompare(b.dateFrom || '')),
    [exceptions],
  )
  /* 日付 → 例外。範囲の休みは日ごとに広げる。 */
  const exceptionByDate = useMemo(() => {
    const map = new Map<string, BookingException>()
    for (const item of closedExceptions) {
      const from = item.dateFrom || item.date || ''
      const to = item.dateTo || item.date || from
      for (let i = 0; i < 31; i += 1) {
        const day = addDaysStr(from, i)
        if (!day || day > to) break
        map.set(day, item)
      }
    }
    return map
  }, [closedExceptions])
  const closedDow = new Set(closedWeekdays)

  /* 窓の中の書きかけがある間は離脱確認だけ（保存帯は出さない）。 */
  const dialogDirty = editing !== null && (editFrom !== '' || editReason.trim() !== '')
  useV8TabEdit({
    dirty: dialogDirty,
    saving: busy,
    subject: '休業日への変更',
    showBar: false,
    onSave: () => {},
    onReset: () => setEditing(null),
  })

  function openNew(date?: string) {
    setEditing('new')
    setEditFrom(date ?? '')
    setEditTo(date ?? '')
    setEditReason('')
    setEditError(null)
  }
  function openEdit(item: BookingException) {
    setEditing(item)
    setEditFrom(item.dateFrom || item.date || '')
    setEditTo(item.dateTo || item.date || '')
    setEditReason(item.reason ?? item.note ?? '')
    setEditError(null)
  }

  async function save() {
    if (inFlightRef.current) return
    if (!editFrom || !editTo || editFrom > editTo) {
      setEditError('開始日と終了日を正しく入れてください。')
      return
    }
    inFlightRef.current = true
    setBusy(true)
    setEditError(null)
    try {
      if (editing === 'new') {
        const response = await bookingApi.createException(accountId, {
          scopeKind: 'store',
          dateFrom: editFrom,
          dateTo: editTo,
          kind: 'closed',
          intervals: [],
          reason: editReason.trim() || null,
        })
        if (!response.success) throw new Error(response.error)
        if (settings) onSaved({ ...settings, exceptions: [...settings.exceptions, response.data] })
      } else if (editing) {
        const response = await bookingApi.updateException(accountId, editing.id, {
          expectedVersion: editing.version,
          dateFrom: editFrom,
          dateTo: editTo,
          reason: editReason.trim() || null,
        })
        if (!response.success) throw new Error(response.error)
        if (settings) onSaved({ ...settings, exceptions: settings.exceptions.map((entry) => entry.id === editing.id ? response.data : entry) })
      }
      setEditing(null)
    } catch (cause) {
      setEditError(exceptionFailureMessage(cause, '保存'))
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  async function remove() {
    const target = deleteTarget
    if (!target || inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    try {
      await bookingApi.deleteException(accountId, target.id, target.version)
      if (settings) onSaved({ ...settings, exceptions: settings.exceptions.filter((entry) => entry.id !== target.id) })
      setDeleteTarget(null)
      setEditing(null)
    } catch (cause) {
      setEditError(exceptionFailureMessage(cause, '削除'))
      setDeleteTarget(null)
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  if (status === 'loading') return <SkeletonRows rows={6} />
  if (status === 'error' || !settings) {
    return (
      <StateCard
        icon={<AccountIcon />}
        title="休業日を読み込めませんでした"
        description={error ?? '通信状態を確認して、もう一度お試しください。'}
        action={<Button onClick={onReload}>読み直す</Button>}
      />
    )
  }

  const weeks = monthWeeks(month)
  const monthLabel = `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`

  return (
    <div data-design="Special">
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{monthLabel}</h2>
          <p className={styles.sectionDesc}>日にちを押すと休みにできます。定休日（毎週）は受付枠で決めます</p>
        </div>
        <div className={styles.calNav}>
          <button type="button" className={styles.calNavButton} aria-label="前の月" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <span className={styles.calMonth}>{monthLabel}</span>
          <button type="button" className={styles.calNavButton} aria-label="次の月" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
          {canEdit ? (
            <Button className={styles.calAdd} onClick={() => openNew()}>＋ 臨時休業を足す</Button>
          ) : null}
        </div>

      <div className={styles.calGrid} role="grid" aria-label={`${monthLabel}の休業日`}>
        {'日月火水木金土'.split('').map((day, index) => (
          <span key={day} className={`${styles.calWeekday} ${index === 0 ? styles.calWeekdaySun : ''} ${index === 6 ? styles.calWeekdaySat : ''}`}>{day}</span>
        ))}
        {weeks.flat().map((date) => {
          const d = new Date(`${date}T00:00:00Z`)
          const inMonth = date.slice(0, 7) === month
          const exception = exceptionByDate.get(date)
          const isRegularOff = settings.businessHoursConfigured && closedDow.has(d.getUTCDay())
          const isToday = date === today
          const mark = exception ? '臨時休業' : isRegularOff ? '定休' : null
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              disabled={!canEdit}
              aria-label={`${jpDate(date)}${mark ? `（${mark}）` : ''}`}
              className={[
                styles.calDay,
                !inMonth && styles.calDayOutside,
                mark && styles.calDayClosed,
                isToday && styles.calDayToday,
              ].filter(Boolean).join(' ')}
              onClick={() => { if (exception) openEdit(exception); else openNew(date) }}
            >
              <span>{d.getUTCDate()}</span>
              {mark ? (
                <span className={`${styles.calMark} ${exception ? styles.calMarkExtra : styles.calMarkRegular}`}>{mark}</span>
              ) : null}
            </button>
          )
        })}
      </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>臨時休業</h2>
        </div>
      {closedExceptions.length > 0 ? (
        <div>
          {closedExceptions.map((item) => {
            const from = item.dateFrom || item.date || ''
            const to = item.dateTo || item.date || ''
            return (
              <div key={item.id} className={styles.exceptionRow}>
                <button
                  type="button"
                  className={styles.exceptionDates}
                  onClick={() => openEdit(item)}
                  disabled={!canEdit}
                >
                  {from !== to ? `${jpDate(from)}・${jpDate(to)}` : jpDate(from)}
                </button>
                <span className={styles.exceptionReason}>{item.reason || item.note || '臨時休業'}</span>
                {canEdit ? (
                  <button
                    type="button"
                    className="text-danger text-xs font-semibold"
                    onClick={() => { setEditError(null); setDeleteTarget(item) }}
                  >
                    削除
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <p className={styles.noteText}>臨時休業はまだありません。</p>
      )}

      {bookingCountOnClosed !== null && bookingCountOnClosed > 0 ? (
        <Band tone="warn">すでに入っている予約は消えません。休みにした日に予約がある人には、お店から連絡してください（{bookingCountOnClosed}件）。</Band>
      ) : (
        <Band tone="warn">すでに入っている予約は消えません。休みにした日に予約がある人には、お店から連絡してください。</Band>
      )}
      </section>

      <Dialog
        open={editing !== null}
        title={editing === 'new' ? '臨時休業を足す' : '休業日を直す'}
        onCancel={() => { if (!busy) setEditing(null) }}
        busy={busy}
      >
        <div className="grid gap-3">
          <label className={styles.fieldLabel}>
            開始日
            <DateField aria-label="休業の開始日" value={editFrom} onChange={setEditFrom} disabled={busy} className="mt-1" />
          </label>
          <label className={styles.fieldLabel}>
            終了日
            <DateField aria-label="休業の終了日" value={editTo} onChange={setEditTo} disabled={busy} className="mt-1" />
          </label>
          <label className={styles.fieldLabel}>
            理由
            <input aria-label="休業の理由" value={editReason} onChange={(event) => setEditReason(event.target.value)} disabled={busy} placeholder="例: お盆・店舗の改装" className="border-hairline rounded-control focus:ring-accent mt-1 w-full border bg-canvas px-3 h-10 text-sm focus:outline-none focus:ring-2" />
          </label>
          {editError ? <p className="text-danger text-xs" role="alert">{editError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button onClick={() => { if (!busy) setEditing(null) }} disabled={busy}>キャンセル</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy} busy={busy}>休業日を保存する</Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="この休業日を消しますか？"
        description="消すと、その期間は曜日の決めごとどおりの受付に戻ります。すでに入っている予約はそのまま残ります。"
        confirmLabel="休業日を削除する"
        destructive
        busy={busy}
        onCancel={() => { if (!busy) setDeleteTarget(null) }}
        onConfirm={() => void remove()}
      />
    </div>
  )
}

function exceptionFailureMessage(error: unknown, action: '保存' | '削除'): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'ほかの担当者が先にこの休業日を変更しました。読み直してからもう一度お試しください。'
  }
  return action === '削除'
    ? '休業日を消せませんでした。もう一度お試しください。'
    : '休業日を保存できませんでした。入力内容を確かめて、もう一度お試しください。'
}
