'use client'

/*
 * ★V8-B 予約台帳（板 `Z3FoM` 一覧・`l9NlC0` 今日（時間×卓）・1152 `xzCK6`）。
 *
 * v7（restaurant-console.tsx の Reservations）と同じ口（snapshot の取得・
 * 絞り込み・ページ送り・手動登録・受信の試し・変更・取消・復活）で、板の
 * 形に置く。集計の根拠は変えない（「見せ方だけ」の移し替え）。
 * 電話の予約を入れる（`rm92Y`）は `./reservation-phone` にある。
 *
 * 今の作りのままの所（口が無いので作らない）：
 * - 押さえの数・押さえの箱・「枠を押さえる」：押さえの口が無い。数は「—」、
 *   ボタンは理由付きで押せない形にする。
 * - 卓の自動配席・在庫連動：サーバ側が登録時に行う（口の応答が正）。
 * - 操作の可否：口自体が owner・admin・staff に開いている（v7 と同じ）。
 *   権限不足は口の 403 をそのまま帯に出す。黙って成功にしない。
 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { formatDateTime, formatTime } from '@/lib/format'
import {
  restaurantTestApi,
  type ReservationQuery,
  type RestaurantReservation,
} from '@/lib/restaurant-test-api'
import RestaurantShell, { Panel, Stat, Status, type RestaurantV8Context } from './shell'
import ReservationPhone, { type PhonePreset } from './reservation-phone'
import ledger from './reservations.module.css'

export type LedgerView = 'today' | 'week' | 'month' | 'list'

const PAGE_SIZE = 20

const sourceLabel: Record<string, string> = {
  restaurant_board: 'レストランボード', reszaiko: 'RESZAIKO', hotpepper: 'Hot Pepper',
  tabelog: '食べログ', gurunavi: 'ぐるなび', ikyu: '一休', retty: 'Retty',
  line: 'LINE', phone: '電話', manual: '手動', google_business_profile: 'Google',
}

const sourceTone: Record<string, string> = {
  restaurant_board: 'bg-success-bg text-success', reszaiko: 'bg-info-bg text-info',
  hotpepper: 'bg-danger-bg text-danger', tabelog: 'bg-warning-bg text-warning',
  gurunavi: 'bg-warning-bg text-warning', ikyu: 'bg-info-bg text-info',
  retty: 'bg-action-soft text-action', line: 'bg-accent-soft text-accent-deep',
  phone: 'bg-canvas-sunken text-ink-secondary', manual: 'bg-canvas-sunken text-ink-secondary',
}

const LEDGER_STATUS_OPTIONS = [
  { value: 'all', label: 'すべての状態' },
  { value: 'pending,confirmed,seated,visited', label: '有効のみ' },
  { value: 'cancelled,no_show', label: '取消・無断のみ' },
]

const INACTIVE_STATUSES = ['cancelled', 'no_show']

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDateTime(date)
}

function toLocalInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** JST のある日の始まりと終わり（口へ渡す ISO 文字列）。 */
function dayRange(day: Date): { from: string; to: string } {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0)
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0, 0)
  return { from: from.toISOString(), to: to.toISOString() }
}

function monthRange(day: Date): { from: string; to: string } {
  const from = new Date(day.getFullYear(), day.getMonth(), 1, 0, 0, 0, 0)
  const to = new Date(day.getFullYear(), day.getMonth() + 1, 1, 0, 0, 0, 0)
  return { from: from.toISOString(), to: to.toISOString() }
}

function weekRange(day: Date): { from: string; to: string } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7), 0, 0, 0, 0)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7, 0, 0, 0, 0)
  return { from: start.toISOString(), to: end.toISOString() }
}

function formatDayLabel(day: Date): string {
  const week = ['日', '月', '火', '水', '木', '金', '土'][day.getDay()]
  return `${day.getMonth() + 1}月${day.getDate()}日（${week}）`
}

function scoped<T extends { store_id: string }>(rows: T[], storeId: string): T[] {
  return storeId ? rows.filter((row) => row.store_id === storeId) : rows
}

/*
 * 未確定の form の中の選ぶ欄（v7 の DefaultSelect と同じ形）。
 * 共通 Select は確定式（value・onChange）なので、未確定の初期値を
 * 中で持つ。name を渡すと隠し入力になるので FormData で読める。
 */
function FormSelect({ name, ariaLabel, defaultValue, options, onPick }: {
  name: string
  ariaLabel: string
  defaultValue: string
  options: { value: string; label: string }[]
  onPick?: () => void
}) {
  const [value, setValue] = useState(defaultValue)
  return (
    <Select
      name={name}
      aria-label={ariaLabel}
      value={value}
      onChange={(next) => { setValue(next); onPick?.() }}
      size="full"
      className="mt-1"
      options={options}
    />
  )
}

/*
 * 予約タイムラインの表（`Z3FoM` 予約タイムライン）。列と操作は板どおり：
 * 時刻・予約元・お客さま・人数・卓・コース・注意事項・状態・操作（変更／取消・復活）。
 */
function TimelineTable({ rows, busy, onEdit, onCancel, onRestore }: {
  rows: RestaurantReservation[]
  busy: boolean
  onEdit: (id: string) => void
  onCancel: (id: string) => void
  onRestore: (id: string) => void
}) {
  return (
    <DataTable className="rounded-none border-0">
      <colgroup>
        <col className="w-32" /><col className="w-28" /><col /><col className="w-16" />
        <col className="w-24" /><col className="w-24" /><col className="w-32" /><col className="w-24" /><col className="w-32" />
      </colgroup>
      <thead>
        <TableHeadRow>
          <Th>時刻</Th>
          <Th>予約元</Th>
          <Th>お客さま</Th>
          <Th align="right">人数</Th>
          <Th>卓</Th>
          <Th>コース</Th>
          <Th>注意事項</Th>
          <Th>状態</Th>
          <Th>操作</Th>
        </TableHeadRow>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.id}>
            <Td className="whitespace-nowrap font-semibold">{formatDate(r.starts_at)}</Td>
            <Td>
              <span className={`rounded-pill px-2 py-1 text-xs font-semibold ${sourceTone[r.source] || 'bg-canvas-sunken text-ink-secondary'}`}>
                {sourceLabel[r.source] || r.source}
              </span>
            </Td>
            <Td className="truncate font-semibold" title={`${r.customer_name} ${r.customer_phone || ''}`}>
              {r.customer_name}
              <p className="truncate text-xs font-normal text-ink-faint">{r.customer_phone || '電話未登録'}</p>
            </Td>
            <Td className="whitespace-nowrap text-right">{r.guest_count}名</Td>
            <Td className="truncate" title={r.table_label || undefined}>
              {r.table_label || <span className="text-warning">未配席</span>}
            </Td>
            <Td className="truncate" title={r.course_name || undefined}>{r.course_name || '席のみ'}</Td>
            <Td className="truncate text-xs text-danger" title={r.allergy_note || undefined}>{r.allergy_note || '—'}</Td>
            <Td><Status value={r.status} /></Td>
            <Td>
              <div className="flex gap-1">
                <Button size="compact" disabled={busy} onClick={() => onEdit(r.id)}>変更</Button>
                {INACTIVE_STATUSES.includes(r.status) ? (
                  <Button size="compact" disabled={busy} onClick={() => onRestore(r.id)}>復活</Button>
                ) : (
                  <Button variant="danger" size="compact" disabled={busy} onClick={() => onCancel(r.id)}>取消</Button>
                )}
              </div>
            </Td>
          </Tr>
        ))}
      </tbody>
    </DataTable>
  )
}

/*
 * 行の変更フォーム（v7 の InlineForm と同じ項目）。保存する確定式で、
 * 入力したら離脱の番兵の対象になる（この画面は GUARDED）。
 */
function ReservationEditPanel({ reservation, tables, courses, busy, onTouched, onClose, onSubmit }: {
  reservation: RestaurantReservation
  tables: { id: string; label: string; active: boolean }[]
  courses: { id: string; name: string }[]
  busy: boolean
  onTouched: () => void
  onClose: () => void
  onSubmit: (form: FormData) => void
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit(new FormData(event.currentTarget))
  }
  return (
    <Panel title={`${reservation.customer_name}の予約を変更`}>
      <form key={reservation.id} onSubmit={submit} onChange={onTouched}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-medium text-ink-secondary">お客様名
            <input name="customerName" defaultValue={reservation.customer_name} required aria-label="お客様名" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
          </label>
          <label className="text-xs font-medium text-ink-secondary">電話番号
            <input name="customerPhone" defaultValue={reservation.customer_phone || ''} aria-label="電話番号" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
          </label>
          <label className="text-xs font-medium text-ink-secondary">人数
            <input name="guestCount" type="number" min={1} max={100} defaultValue={String(reservation.guest_count)} required aria-label="人数" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
          </label>
          <label className="text-xs font-medium text-ink-secondary">アレルギー・特記事項
            <input name="allergyNote" defaultValue={reservation.allergy_note || ''} aria-label="アレルギー・特記事項" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
          </label>
          <label className="text-xs font-medium text-ink-secondary">開始日時
            <input name="startsAt" type="datetime-local" defaultValue={toLocalInput(reservation.starts_at)} required aria-label="開始日時" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
          </label>
          <label className="text-xs font-medium text-ink-secondary">終了日時
            <input name="endsAt" type="datetime-local" defaultValue={toLocalInput(reservation.ends_at)} required aria-label="終了日時" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
          </label>
          <label className="text-xs font-medium text-ink-secondary">卓
            <FormSelect name="tableId" ariaLabel="卓" defaultValue={reservation.table_id || ''} onPick={onTouched} options={[
              { value: '', label: '未配席' },
              ...tables.filter((t) => t.active || t.id === reservation.table_id).map((t) => ({ value: t.id, label: t.label })),
            ]} />
          </label>
          <label className="text-xs font-medium text-ink-secondary">コース
            <FormSelect name="courseId" ariaLabel="コース" defaultValue={reservation.course_id || ''} onPick={onTouched} options={[
              { value: '', label: '席のみ' },
              ...courses.map((m) => ({ value: m.id, label: m.name })),
            ]} />
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" onClick={onClose}>キャンセル</Button>
          <Button variant="primary" type="submit" disabled={busy}>保存する</Button>
        </div>
      </form>
    </Panel>
  )
}

/*
 * 受信データの試し（v7 の媒体受信シミュレーターと同じ）。外部への書戻しは
 * しない。窓を閉じると入力は戻るので、離脱の番兵の対象外。
 */
function InboundTrialPanel({ storeId, busy, onClose, onSubmit }: {
  storeId: string
  busy: boolean
  onClose: () => void
  onSubmit: (form: FormData) => void
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit(new FormData(event.currentTarget))
  }
  return (
    <Panel title="媒体受信シミュレーター（外部への書戻しなし）">
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-medium text-ink-secondary">受信元
            <FormSelect name="provider" ariaLabel="受信元" defaultValue="restaurant_board" options={[
              { value: 'restaurant_board', label: 'レストランボード' },
              { value: 'hotpepper', label: 'Hot Pepper' },
              { value: 'tabelog', label: '食べログ' },
            ]} />
          </label>
          <label className="text-xs font-medium text-ink-secondary">外部予約ID
            <input name="externalId" defaultValue={`DEMO-${Date.now()}`} required aria-label="外部予約ID" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
          </label>
          <label className="text-xs font-medium text-ink-secondary">お客様名
            <input name="customerName" required aria-label="お客様名" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
          </label>
          <label className="text-xs font-medium text-ink-secondary">人数
            <input name="guestCount" type="number" min={1} max={100} defaultValue="2" required aria-label="人数" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
          </label>
          <label className="text-xs font-medium text-ink-secondary">開始日時
            <input name="startsAt" type="datetime-local" required aria-label="開始日時" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" onClick={onClose}>閉じる</Button>
          <Button variant="primary" type="submit" disabled={busy || !storeId}>受信として取込</Button>
        </div>
      </form>
    </Panel>
  )
}

/** 30分刻みの時刻ラベル（`17:00` 形式）。 */
function slotLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${hour}:${minute === 0 ? '00' : '30'}`
}

function blockTone(source: string, pending: boolean): string {
  if (pending) return ledger.blockPending
  if (source === 'line' || source === 'restaurant_board') return ledger.blockSourceLine
  if (source === 'phone' || source === 'manual') return ledger.blockSourcePhone
  return ledger.blockSourceMedia
}

/*
 * 今日（時間×卓）（`l9NlC0`）。列は卓、行は30分刻み。箱は予約元の色・
 * 人数・コース・アレルギー（⚠）で、承認待ちは黄の枠。空きマスには
 * 「＋予約を入れる」。右に次の予約・気をつけること・内訳・つながる先。
 * 1152（`xzCK6`）では右の欄がカレンダーの下に積まれる（CSSだけ）。
 */
function TodayView({ rows, tables, busy, day, isToday, sideExtra, onAddPreset, onEdit }: {
  rows: RestaurantReservation[]
  tables: { id: string; code: string; label: string; capacity: string; active: boolean }[]
  busy: boolean
  day: Date
  isToday: boolean
  sideExtra: ReactNode
  onAddPreset: (preset: PhonePreset) => void
  onEdit: (id: string) => void
}) {
  const visibleTables = useMemo(() => {
    const used = new Set(rows.map((r) => r.table_id).filter(Boolean) as string[])
    const actives = tables.filter((t) => t.active)
    const hidden = tables.filter((t) => !t.active && !used.has(t.id))
    return { shown: [...actives, ...tables.filter((t) => !t.active && used.has(t.id))], hiddenCount: hidden.length }
  }, [rows, tables])

  const slots = useMemo(() => {
    let min = 17 * 60
    let max = 22 * 60
    for (const r of rows) {
      const start = new Date(r.starts_at)
      const end = new Date(r.ends_at)
      if (Number.isNaN(start.getTime())) continue
      min = Math.min(min, Math.floor((start.getHours() * 60 + start.getMinutes()) / 30) * 30)
      if (!Number.isNaN(end.getTime())) max = Math.max(max, Math.ceil((end.getHours() * 60 + end.getMinutes()) / 30) * 30)
    }
    const list: number[] = []
    for (let m = min; m < max; m += 30) list.push(m)
    return list
  }, [rows])

  const nowMinutes = isToday ? new Date().getHours() * 60 + new Date().getMinutes() : -1

  const reservationAt = useCallback((tableId: string, slot: number) => {
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0).getTime()
    return rows.find((r) => {
      if (r.table_id !== tableId) return false
      const start = new Date(r.starts_at).getTime()
      const slotStart = dayStart + slot * 60_000
      return start >= slotStart && start < slotStart + 30 * 60_000
    }) || null
  }, [rows, day])

  const next = useMemo(() => {
    const now = Date.now()
    const upcoming = [...rows].filter((r) => !INACTIVE_STATUSES.includes(r.status)).sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
    return upcoming.find((r) => +new Date(r.starts_at) >= now - 30 * 60_000) || upcoming[0] || null
  }, [rows])

  const pending = useMemo(() => rows.filter((r) => r.status === 'pending'), [rows])
  const allergies = useMemo(() => rows.filter((r) => r.allergy_note), [rows])

  const freeNote = useMemo(() => {
    const probe = isToday ? nowMinutes : 19 * 60
    const free = visibleTables.shown.filter((t) => !reservationAt(t.id, Math.floor(probe / 30) * 30))
    if (free.length === 0) return 'この時間に空いている卓はありません'
    const label = `${Math.floor(probe / 60)}:00`
    return `${label}に空いているのは${free.map((t) => `${t.code}（${t.capacity}）`).join('・')}だけ`
  }, [isToday, nowMinutes, reservationAt, visibleTables])

  const bySource = useMemo(() => ({
    line: rows.filter((r) => r.source === 'line').length,
    media: rows.filter((r) => !['line', 'phone', 'manual'].includes(r.source)).length,
    phone: rows.filter((r) => r.source === 'phone' || r.source === 'manual').length,
  }), [rows])

  const columns = `64px repeat(${Math.max(visibleTables.shown.length, 1)}, minmax(96px, 1fr))`

  return (
    <div className={ledger.todayBody}>
      <div>
      <div className={ledger.dayGrid} aria-label={`${formatDayLabel(day)}の時間×卓`}>
        <div className={ledger.dayGridInner} style={{ gridTemplateColumns: columns }}>
          <div className={ledger.timeHead}>時刻</div>
          {visibleTables.shown.map((t) => (
            <div key={t.id} className={ledger.tableHead} title={`${t.code}・${t.label}（${t.capacity}）`}>{t.code} {t.capacity}</div>
          ))}
          {slots.map((slot) => {
            const current = isToday && nowMinutes >= slot && nowMinutes < slot + 30
            return (
              <div key={`t-${slot}`} style={{ display: 'contents' }}>
                <div className={`${ledger.timeCell} ${current ? ledger.timeCellNow : ''}`}>
                  {slotLabel(slot)}{current ? ' いま' : ''}
                </div>
                {visibleTables.shown.map((t) => {
                  const found = reservationAt(t.id, slot)
                  return (
                    <div key={`${t.id}-${slot}`} className={ledger.slotCell}>
                      {found ? (
                        <button
                          type="button"
                          className={`${ledger.block} ${blockTone(found.source, found.status === 'pending')}`}
                          onClick={() => onEdit(found.id)}
                          title={`${found.customer_name} ${found.guest_count}名 ${found.course_name || '席のみ'}`}
                        >
                          <span className={ledger.blockName}>{found.customer_name}</span>
                          <span className={ledger.blockMeta}>{found.guest_count}名・{found.course_name || '席のみ'}</span>
                          <span className={ledger.blockMeta}>{sourceLabel[found.source] || found.source}</span>
                          {found.allergy_note ? <span className={ledger.blockAlert}>⚠ {found.allergy_note}</span> : null}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={ledger.slotAdd}
                          disabled={busy}
                          onClick={() => onAddPreset({ date: day, time: slotLabel(slot), tableId: t.id })}
                        >
                          ＋予約を入れる
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      {visibleTables.hiddenCount > 0 ? (
        <p className={ledger.inlineNote}>停止中の卓は出していません（{visibleTables.hiddenCount}卓）。</p>
      ) : null}
      </div>
      <div className={ledger.sideCol}>
        <section className={ledger.sideCard} aria-label="次の予約">
          <h3 className={ledger.sideCardTitle}>次の予約</h3>
          {next ? (
            <>
              <div className={ledger.nextCard}>
                <p className={ledger.nextName}>{next.customer_name}さん・{next.guest_count}名</p>
                <p className={ledger.nextMeta}>{formatTime(new Date(next.starts_at))}〜{formatTime(new Date(next.ends_at))} ・ {next.table_label || '未配席'} ・ {next.course_name || '席のみ'}</p>
                <p className={ledger.nextFrom}>{sourceLabel[next.source] || next.source}から</p>
              </div>
              <div className={ledger.sideButtons}>
                <Button size="compact" onClick={() => onEdit(next.id)}>開く</Button>
                <Button size="compact" onClick={() => onEdit(next.id)}>卓を変える</Button>
              </div>
            </>
          ) : (
            <p className={ledger.inlineNote}>この日の残りの予約はありません。</p>
          )}
        </section>
        <section className={ledger.sideCard} aria-label="今日気をつけること">
          <h3 className={ledger.sideCardTitle}>{isToday ? '今日気をつけること' : '気をつけること'}</h3>
          <ul className={ledger.careList}>
            {pending.length > 0 ? (
              <li>・承認待ちが{pending.length}件（{pending.map((r) => `${r.customer_name}さん・${sourceLabel[r.source] || r.source}`).join('、')}）</li>
            ) : <li>・承認待ちはありません</li>}
            {allergies.length > 0 ? (
              <li className={ledger.careAlert}>・アレルギーあり{allergies.length}件（{allergies.map((r) => r.allergy_note).join('・')}）</li>
            ) : null}
            <li>・{freeNote}</li>
          </ul>
        </section>
        <section className={ledger.sideCard} aria-label="内訳">
          <h3 className={ledger.sideCardTitle}>{formatDayLabel(day)}の内訳</h3>
          <div className={ledger.breakRow}><span>予約</span><strong>{rows.length}件・{rows.reduce((s, r) => s + r.guest_count, 0)}名</strong></div>
          <div className={ledger.breakRow}><span>LINEから</span><strong>{bySource.line}件</strong></div>
          <div className={ledger.breakRow}><span>予約媒体から</span><strong>{bySource.media}件</strong></div>
          <div className={ledger.breakRow}><span>電話</span><strong>{bySource.phone}件</strong></div>
          <div className={ledger.breakRow}><span>押さえ</span><strong>—</strong></div>
        </section>
        {sideExtra}
      </div>
    </div>
  )
}

/*
 * つながる先（`l9NlC0` 右の欄）。先の画面が無いものは出さない。
 */
function RelatedLinks() {
  return (
    <section className={ledger.sideCard} aria-label="つながる先">
      <h3 className={ledger.sideCardTitle}>つながる先</h3>
      <div className={ledger.sideLinks}>
        <a href="/restaurant-test/inventory">予約枠・在庫 → 時間帯ごとの空き</a>
        <a href="/restaurant-test/tables">座席・卓管理 → 卓の結合・停止</a>
        <a href="/restaurant-test/line-followup">LINE来店フォロー → 前日・当日のご案内</a>
      </div>
    </section>
  )
}

function ViewTabs({ view, counts, onChange }: {
  view: LedgerView
  counts: { today: number; week: number; month: number } | null
  onChange: (view: LedgerView) => void
}) {
  const tabs: { key: LedgerView; label: string; count: number | null }[] = [
    { key: 'today', label: '今日', count: counts?.today ?? null },
    { key: 'week', label: '今週', count: counts?.week ?? null },
    { key: 'month', label: '今月', count: counts?.month ?? null },
    { key: 'list', label: '一覧', count: null },
  ]
  return (
    <div className={ledger.viewTabs} role="tablist" aria-label="見方の切り替え">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={view === tab.key}
          className={ledger.viewTab}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}{tab.count !== null ? tab.count : ''}
        </button>
      ))}
    </div>
  )
}

/*
 * 予約台帳の器の中身。見方（今日・今週・今月・一覧）と電話の予約を
 * 切り替える。口への絞り込みは見方ごとに変える：
 * 今日・今週・今月は月の取り直しからその場で区切り、一覧は口の
 * ページ送りで区切る（v7 と同じ）。
 */
function LedgerBody({ ctx, view, day, period, status, page, source, phoneOpen, preset, onView, onDay, onPeriod, onStatus, onPage, onSource, onPhone }: {
  ctx: RestaurantV8Context
  view: LedgerView
  day: Date
  period: string
  status: string
  page: number
  source: string
  phoneOpen: boolean
  preset: PhonePreset
  onView: (view: LedgerView) => void
  onDay: (day: Date) => void
  onPeriod: (value: string) => void
  onStatus: (value: string) => void
  onPage: (page: number) => void
  onSource: (value: string) => void
  onPhone: (open: boolean, preset?: PhonePreset) => void
}) {
  const { data, store, selectedStoreId, busy, mutate, reload } = ctx
  const { selectedAccountId } = useAccount()
  const accountId = selectedAccountId || ''
  const [editingId, setEditingId] = useState('')
  const [editTouched, setEditTouched] = useState(false)
  const [cancelId, setCancelId] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [monthCounts, setMonthCounts] = useState<{ today: number; week: number; month: number } | null>(null)

  const dirty = editingId !== '' && editTouched
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })

  /* タブの件数（月の取り直し。遅い応答は捨てる）。 */
  const countRef = useRef(0)
  const monthKey = `${day.getFullYear()}-${day.getMonth()}`
  useEffect(() => {
    if (!accountId) { setMonthCounts(null); return }
    const id = ++countRef.current
    const m = monthRange(day)
    const t = dayRange(day)
    const w = weekRange(day)
    void restaurantTestApi.snapshot(accountId, { from: m.from, to: m.to, limit: 500, offset: 0 }).then((res) => {
      if (id !== countRef.current || !res.success) return
      const scopedRows = scoped(res.data.reservations, selectedStoreId)
      setMonthCounts({
        today: scopedRows.filter((r) => r.starts_at >= t.from && r.starts_at < t.to).length,
        week: scopedRows.filter((r) => r.starts_at >= w.from && r.starts_at < w.to).length,
        month: scopedRows.length,
      })
    }).catch(() => { /* 件数が出ないときはタブを数なしで出す */ })
  }, [accountId, selectedStoreId, monthKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const scopedRows = scoped(data.reservations, selectedStoreId)
    if (view === 'today') {
      const t = dayRange(day)
      return scopedRows.filter((r) => r.starts_at >= t.from && r.starts_at < t.to)
    }
    if (view === 'week') {
      const w = weekRange(day)
      return scopedRows.filter((r) => r.starts_at >= w.from && r.starts_at < w.to)
    }
    return scopedRows
  }, [data.reservations, selectedStoreId, view, day])

  const sourceRows = useMemo(
    () => (source === 'all' ? rows : rows.filter((r) => r.source === source)),
    [rows, source],
  )

  const tables = useMemo(() => {
    const list = data.tables.filter((t) => !store || t.store_id === store.id)
    return list.map((t) => ({
      id: t.id,
      code: t.code,
      label: `${t.code}・${t.label}`,
      capacity: `${t.min_capacity}〜${t.max_capacity}名`,
      min: t.min_capacity,
      max: t.max_capacity,
      active: t.is_active === 1,
    }))
  }, [data.tables, store])

  const courses = useMemo(() => {
    const list = data.menuItems.filter((m) => (!store || m.store_id === store.id) && m.status === 'active')
    return list.map((m) => ({ id: m.id, name: `${m.name}${m.price ? ` ${m.price.toLocaleString()}円` : ''}` }))
  }, [data.menuItems, store])

  const save = useCallback(async (action: () => Promise<unknown>, success: string) => {
    const ok = await mutate(action, success)
    /* 失敗時は取り直す（競合 409 の古い表示で残さない）。 */
    if (!ok) void reload()
    return ok
  }, [mutate, reload])

  const submitEdit = (editing: RestaurantReservation) => (form: FormData) => {
    const startsAt = new Date(String(form.get('startsAt'))).toISOString()
    const endsAt = new Date(String(form.get('endsAt'))).toISOString()
    const tableId = String(form.get('tableId') || '')
    void save(() => restaurantTestApi.updateReservation(accountId, editing.id, {
      customerName: form.get('customerName'), customerPhone: form.get('customerPhone') || null,
      guestCount: Number(form.get('guestCount')), startsAt, endsAt,
      tableId: tableId || null, courseId: String(form.get('courseId') || '') || null,
      allergyNote: form.get('allergyNote') || null,
    }), '予約を変更しました。').then((ok) => {
      if (ok) { setEditingId(''); setEditTouched(false) }
    })
  }

  const submitImport = (form: FormData) => {
    if (!store) return
    const startsAt = new Date(String(form.get('startsAt'))).toISOString()
    void save(() => restaurantTestApi.importReservation(accountId, {
      storeId: store.id, provider: form.get('provider'), eventId: `ui-${Date.now()}`,
      reservation: {
        externalId: String(form.get('externalId')), customerName: String(form.get('customerName')),
        guestCount: Number(form.get('guestCount')), startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + 120 * 60_000).toISOString(),
      },
    }), '受信専用データとして取り込みました。').then((ok) => { if (ok) setShowImport(false) })
  }

  const editing = rows.find((r) => r.id === editingId) || null
  const cancelling = rows.find((r) => r.id === cancelId) || null
  const storeId = store?.id || ''

  if (phoneOpen) {
    return (
      <ReservationPhone
        storeId={storeId}
        storeName={store?.name || ''}
        tables={tables}
        courses={courses}
        reservations={rows}
        busy={busy}
        preset={preset}
        onBack={() => onPhone(false)}
        onSaved={() => { void reload(); onPhone(false) }}
        onSave={(body) => save(() => restaurantTestApi.createReservation(accountId, body), '台帳に入れました。')}
      />
    )
  }

  const total = view === 'list' ? data.reservationTotal : rows.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const guests = rows.filter((r) => !INACTIVE_STATUSES.includes(r.status)).reduce((s, r) => s + r.guest_count, 0)
  const lineCount = rows.filter((r) => r.source === 'line').length
  const mediaCount = rows.filter((r) => !['line', 'phone', 'manual'].includes(r.source)).length
  const unseated = rows.filter((r) => !r.table_id && !INACTIVE_STATUSES.includes(r.status)).length

  const toolbar = (
    <div className={ledger.toolbar}>
      <div className={ledger.toolbarLeft}>
        <ViewTabs view={view} counts={monthCounts} onChange={onView} />
        {view === 'today' ? (
          <>
            <div className={ledger.dateNav}>
              <Button size="compact" aria-label="前の日" onClick={() => onDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1))}>‹</Button>
              <span className={ledger.dateLabel}>{formatDayLabel(day)}</span>
              <Button size="compact" aria-label="次の日" onClick={() => onDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1))}>›</Button>
              <Button size="compact" onClick={() => onDay(new Date())}>今日</Button>
            </div>
            <label className="text-xs font-medium text-ink-secondary">予約元
              <Select aria-label="予約元" value={source} onChange={onSource} size="full" className="mt-1" options={[
                { value: 'all', label: 'すべて' },
                ...Object.entries(sourceLabel).map(([value, label]) => ({ value, label })),
              ]} />
            </label>
          </>
        ) : (
          <>
            <label className="text-xs font-medium text-ink-secondary">期間
              <Select aria-label="期間" value={period} onChange={onPeriod} size="full" className="mt-1" options={[
                { value: 'upcoming', label: '今後の予約' },
                { value: 'all', label: 'すべての期間' },
                { value: 'past', label: '過去の予約' },
              ]} />
            </label>
            <label className="text-xs font-medium text-ink-secondary">状態
              <Select aria-label="状態" value={status} onChange={onStatus} size="full" className="mt-1" options={LEDGER_STATUS_OPTIONS} />
            </label>
          </>
        )}
      </div>
      <div className={ledger.toolbarActions}>
        {view === 'today' ? (
          <>
            <Button disabled title="枠を押さえる口が無いため、今は使えません">枠を押さえる</Button>
            <Button variant="primary" disabled={busy || !storeId} onClick={() => onPhone(true)}>＋ 電話の予約を入れる</Button>
          </>
        ) : (
          <>
            <Button disabled={busy} onClick={() => setShowImport((v) => !v)}>受信データを試す</Button>
            <Button variant="primary" disabled={busy || !storeId} onClick={() => onPhone(true)}>＋ 手動予約を登録する</Button>
          </>
        )}
      </div>
    </div>
  )

  return (
    <div className={ledger.ledgerBoard}>
      {toolbar}
      {view === 'today' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="今日の予約" value={`${sourceRows.length}件`} note={`${sourceRows.reduce((s, r) => s + r.guest_count, 0)}名`} />
            <Stat label="承認待ち" value={`${sourceRows.filter((r) => r.status === 'pending').length}件`} note={sourceRows.find((r) => r.status === 'pending') ? sourceLabel[sourceRows.find((r) => r.status === 'pending')!.source] || '' : '—'} warning={sourceRows.some((r) => r.status === 'pending')} />
            <Stat label="未配席" value={`${sourceRows.filter((r) => !r.table_id).length}件`} note="すべて卓に入っています" />
            <Stat label="押さえ" value="—" note="押さえの口はAPI待ち" />
          </div>
          <TodayView
            rows={sourceRows}
            tables={tables}
            busy={busy}
            day={day}
            isToday={dayRange(day).from.slice(0, 10) === dayRange(new Date()).from.slice(0, 10)}
            sideExtra={<RelatedLinks />}
            onAddPreset={(next) => onPhone(true, next)}
            onEdit={(id) => { setEditingId(id); setEditTouched(false) }}
          />
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="予約" value={`${total}件`} note={`表示中 ${rows.length}件`} />
            <Stat label="ご来店人数" value={`${guests}名`} note="表示中の合計・取消と無断欠席を除く" />
            <Stat label="LINE予約" value={`${lineCount}`} note="自社導線" />
            <Stat label="媒体予約" value={`${mediaCount}`} note="受信した予約" />
            <Stat label="未配席" value={`${unseated}`} note="卓の割当が必要" warning={unseated > 0} />
          </div>
          <Panel title="予約タイムライン" description="媒体別の色と、配席・コースを同時に確認します。" flush>
            {editing ? (
              <div className="p-4">
                <ReservationEditPanel
                  reservation={editing}
                  tables={tables}
                  courses={courses}
                  busy={busy}
                  onTouched={() => setEditTouched(true)}
                  onClose={() => { setEditingId(''); setEditTouched(false) }}
                  onSubmit={submitEdit(editing)}
                />
              </div>
            ) : null}
            <TimelineTable
              rows={rows}
              busy={busy}
              onEdit={(id) => { setEditingId(id); setEditTouched(false) }}
              onCancel={(id) => setCancelId(id)}
              onRestore={(id) => { void save(() => restaurantTestApi.updateReservation(accountId, id, { status: 'confirmed' }), '予約を有効に戻しました。') }}
            />
            {rows.length === 0 ? <p className="p-8 text-center text-sm text-ink-faint">条件に合う予約はありません。</p> : null}
            {view === 'list' ? (
              <div className="flex justify-center p-4">
                <Pagination page={page} pageCount={pageCount} onPageChange={onPage} ariaLabel="予約台帳のページ送り" />
              </div>
            ) : null}
          </Panel>
          <Panel title="顧客カルテ" description="電話番号またはLINE UIDで名寄せする設計です。">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.slice(0, 3).map((r) => (
                <div key={r.id} className="rounded-control border border-hairline p-4">
                  <p className="font-semibold">{r.customer_name}</p>
                  <p className="mt-1 text-xs text-ink-faint">{r.customer_phone || r.line_uid || '連絡先未登録'}</p>
                  <p className="mt-3 text-sm text-ink-secondary">直近: {formatDate(r.starts_at)} / {r.guest_count}名</p>
                </div>
              ))}
            </div>
          </Panel>
          {showImport ? (
            <InboundTrialPanel storeId={storeId} busy={busy} onClose={() => setShowImport(false)} onSubmit={submitImport} />
          ) : null}
          <ConfirmDialog
            open={cancelId !== ''}
            title="この予約を取り消しますか？"
            description={`台帳には取消として残ります。時間帯の在庫は人数分だけ戻ります。${cancelling ? `（${cancelling.customer_name}・${cancelling.guest_count}名）` : ''}`}
            confirmLabel="取り消す"
            destructive
            busy={busy}
            onCancel={() => setCancelId('')}
            onConfirm={() => {
              if (cancelling) void save(() => restaurantTestApi.updateReservation(accountId, cancelling.id, { status: 'cancelled' }), '予約を取り消しました。')
              setCancelId('')
            }}
          />
        </>
      )}
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

const BOARD_META = {
  today: { id: 'l9NlC0', title: '予約台帳', description: '予約媒体・LINE・電話の予約を、時間と卓で確認します。' },
  list: { id: 'Z3FoM', title: '予約台帳', description: '予約媒体・LINE・電話の予約を、一つの時間軸で確認します。' },
  phone: { id: 'rm92Y', title: '電話の予約を入れる', description: '電話・店頭で受けた予約を台帳に入れます。空いている卓は自動で選びます。' },
} as const

/*
 * ★V8-B 予約台帳。見方（今日・今週・今月・一覧）と電話の予約を切り替える。
 * 口への絞り込みは器（shell）へ渡す：今日・今週・今月は月の取り直し、
 * 一覧は期間・状態・ページ送り（v7 と同じ口）。
 */
export default function ReservationsV8() {
  const [view, setView] = useState<LedgerView>('today')
  const [day, setDay] = useState<Date>(() => new Date())
  const [period, setPeriod] = useState('upcoming')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [source, setSource] = useState('all')
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [preset, setPreset] = useState<PhonePreset>({})

  const query = useMemo<ReservationQuery>(() => {
    if (view === 'list') {
      const today = dayRange(new Date())
      const range = period === 'past'
        ? { from: undefined, to: today.from }
        : period === 'upcoming'
          ? { from: today.from, to: undefined }
          : { from: undefined, to: undefined }
      return { ...range, status: status === 'all' ? undefined : status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }
    }
    const m = monthRange(day)
    return { from: m.from, to: m.to, limit: 500, offset: 0 }
  }, [view, day, period, status, page])

  const board = phoneOpen ? BOARD_META.phone : view === 'today' ? BOARD_META.today : BOARD_META.list

  const changeView = (next: LedgerView) => {
    setView(next)
    setPage(1)
  }
  const changeDay = (next: Date) => {
    setDay(next)
  }
  const changePhone = (open: boolean, next?: PhonePreset) => {
    setPhoneOpen(open)
    if (next) setPreset(next)
    if (!open) setPreset({})
  }

  return (
    <RestaurantShell
      boardId={board.id}
      title={board.title}
      description={board.description}
      query={query}
    >
      {(ctx) => (
        <LedgerBody
          ctx={ctx}
          view={view}
          day={day}
          period={period}
          status={status}
          page={page}
          source={source}
          phoneOpen={phoneOpen}
          preset={preset}
          onView={changeView}
          onDay={changeDay}
          onPeriod={(value) => { setPeriod(value); setPage(1) }}
          onStatus={(value) => { setStatus(value); setPage(1) }}
          onPage={setPage}
          onSource={setSource}
          onPhone={changePhone}
        />
      )}
    </RestaurantShell>
  )
}
