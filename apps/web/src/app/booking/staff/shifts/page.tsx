'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { usePageTitle } from '@/components/shell/page-chrome'
import {
  bookingApi,
  type BookingMenu,
  type BookingShift,
  type BookingStaff,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

type LoadStatus = 'loading' | 'ready' | 'error'
type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

const DAYS: Array<{ key: DayKey; weekday: number; label: string }> = [
  { key: 'mon', weekday: 1, label: '月曜日' },
  { key: 'tue', weekday: 2, label: '火曜日' },
  { key: 'wed', weekday: 3, label: '水曜日' },
  { key: 'thu', weekday: 4, label: '木曜日' },
  { key: 'fri', weekday: 5, label: '金曜日' },
  { key: 'sat', weekday: 6, label: '土曜日' },
  { key: 'sun', weekday: 0, label: '日曜日' },
]

type WeeklyTemplate = Record<DayKey, { start: string; end: string } | null>

const EMPTY_TEMPLATE: WeeklyTemplate = {
  mon: null,
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
  sun: null,
}

function sharedNumber(
  menus: BookingMenu[],
  pick: (menu: BookingMenu) => number | null | undefined,
): string {
  const values = [...new Set(menus.filter((menu) => menu.is_active).map(pick).filter((value): value is number => typeof value === 'number'))]
  if (values.length === 0) return '—'
  return values.length === 1 ? String(values[0]) : 'メニューごと'
}

function dateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return `${Number(match[2])}/${Number(match[3])}`
}

function StaffShiftsPageContent() {
  usePageTitle('予約設定')
  const sp = useSearchParams()
  const { selectedAccountId, selectedAccount } = useAccount()
  const [pickedStaffId, setPickedStaffId] = useState('')
  const staffId = sp.get('staff_id') || pickedStaffId
  const [allStaff, setAllStaff] = useState<BookingStaff[]>([])
  const [staffMember, setStaffMember] = useState<BookingStaff | null>(null)
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [shifts, setShifts] = useState<BookingShift[]>([])
  const [template, setTemplate] = useState<WeeklyTemplate>(EMPTY_TEMPLATE)
  const [calendarId, setCalendarId] = useState('')
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null)
  const [serviceAccountConfigured, setServiceAccountConfigured] = useState(false)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [savingRules, setSavingRules] = useState(false)
  const [savingCalendar, setSavingCalendar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  const [deleteShiftTarget, setDeleteShiftTarget] = useState<{ id: string; date: string } | null>(null)
  const loadRequestRef = useRef(0)

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const previewUrl = selectedAccount?.liffId
    ? `${workerBase}/o?liffId=${encodeURIComponent(selectedAccount.liffId)}&page=salon-book`
    : null

  useEffect(() => {
    if (!selectedAccountId) {
      setAllStaff([])
      setMenus([])
      return
    }
    let alive = true
    void Promise.all([
      bookingApi.listStaff(selectedAccountId),
      bookingApi.listMenus(selectedAccountId),
    ]).then(([staffResult, menuResult]) => {
      if (!alive) return
      setAllStaff(staffResult.staff)
      setMenus(menuResult.menus)
      if (!sp.get('staff_id') && !pickedStaffId && staffResult.staff.length > 0) {
        setPickedStaffId(staffResult.staff[0].id)
      }
    }).catch(() => {
      if (!alive) return
      setAllStaff([])
      setMenus([])
    })
    return () => {
      alive = false
    }
    // 最初の取得で、URL指定が無いときだけ先頭の担当者を選ぶ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    if (!selectedAccountId || !staffId) {
      setLoadStatus('ready')
      return
    }
    setLoadStatus('loading')
    setError(null)
    try {
      const [staff, dated, rules, calendar] = await Promise.all([
        bookingApi.listStaff(selectedAccountId),
        bookingApi.getShifts(selectedAccountId, staffId),
        bookingApi.getAvailabilityRules(selectedAccountId, staffId),
        bookingApi.getGoogleCalendar(selectedAccountId, staffId),
      ])
      if (requestId !== loadRequestRef.current) return
      setStaffMember(staff.staff.find((item) => item.id === staffId) ?? null)
      setShifts(dated.shifts)
      const next: WeeklyTemplate = { ...EMPTY_TEMPLATE }
      for (const day of DAYS) {
        const rule = rules.rules.find((item) => item.weekday === day.weekday)
        if (rule) next[day.key] = { start: rule.start_time, end: rule.end_time }
      }
      setTemplate(next)
      setCalendarId(calendar.connection?.calendar_id ?? '')
      setCalendarConnected(Boolean(calendar.connection))
      setServiceAccountEmail(calendar.service_account.email)
      setServiceAccountConfigured(calendar.service_account.configured)
      setLoadStatus('ready')
    } catch {
      if (requestId !== loadRequestRef.current) return
      setStaffMember(null)
      setShifts([])
      setTemplate({ ...EMPTY_TEMPLATE })
      setLoadStatus('error')
    }
  }, [selectedAccountId, staffId])

  useEffect(() => {
    void load()
    return () => {
      loadRequestRef.current += 1
    }
  }, [load])

  async function saveRules() {
    if (!selectedAccountId || !staffId) return
    setSavingRules(true)
    setError(null)
    setSuccess(null)
    try {
      const rules = DAYS.flatMap((day) => {
        const value = template[day.key]
        return value ? [{ weekday: day.weekday, start_time: value.start, end_time: value.end }] : []
      })
      await bookingApi.putAvailabilityRules(selectedAccountId, staffId, rules)
      setSuccess('曜日ごとの受付時間を保存しました。')
    } catch {
      setError('受付時間を保存できませんでした。入力内容を確かめて、もう一度お試しください。')
    } finally {
      setSavingRules(false)
    }
  }

  async function connectCalendar() {
    if (!selectedAccountId || !staffId || !calendarId.trim()) return
    setSavingCalendar(true)
    setError(null)
    setSuccess(null)
    try {
      await bookingApi.putGoogleCalendar(selectedAccountId, staffId, calendarId.trim())
      setCalendarConnected(true)
      setSuccess('Googleカレンダーへ接続しました。予定のある時間は新しい予約を受け付けません。')
    } catch {
      setError('Googleカレンダーへ接続できませんでした。共有設定とカレンダーIDを確かめてください。')
    } finally {
      setSavingCalendar(false)
    }
  }

  async function disconnectCalendar() {
    if (!selectedAccountId || !staffId) return
    await bookingApi.deleteGoogleCalendar(selectedAccountId, staffId)
    setCalendarConnected(false)
    setCalendarId('')
    setUnlinkOpen(false)
    setSuccess('Googleカレンダー連携を解除しました。')
  }

  async function deleteShift(shiftId: string) {
    if (!selectedAccountId || !staffId) return
    await bookingApi.deleteShift(selectedAccountId, staffId, shiftId)
    setDeleteShiftTarget(null)
    await load()
  }

  const closedDays = useMemo(
    () => DAYS.filter((day) => template[day.key] === null).map((day) => day.label),
    [template],
  )
  const menuCount = menus.length
  const bookingWindow = sharedNumber(menus, (menu) => menu.booking_window_days)
  const cutoff = sharedNumber(menus, (menu) => menu.cutoff_hours_before)
  const cancelDeadline = sharedNumber(menus, (menu) => menu.cancel_deadline_hours_before)

  return (
    <div data-design-node="tksPc" className="space-y-4 pb-8">
      <div data-design="Head" className="flex flex-wrap items-center gap-3">
        <nav aria-label="現在位置" className="text-ink-faint text-xs">
          <Link href="/booking/bookings" className="text-accent hover:underline">予約</Link>
          <span className="mx-2">›</span>
          <Link href="/booking/menus" className="text-accent hover:underline">予約設定</Link>
          <span className="mx-2">›</span>
          <span>受付枠</span>
        </nav>
        {previewUrl ? <Button className="ml-auto" href={previewUrl}>お客様に見える画面を確かめる</Button> : null}
      </div>

      <div data-design="Tabs" className="border-hairline flex flex-wrap gap-1 border-b">
        <Link href="/booking/menus" className="text-ink-faint rounded-t-md px-4 py-2 text-sm hover:text-ink-secondary">メニュー {menuCount || '—'}</Link>
        <span className="border-accent text-ink rounded-t-md border-b-2 px-4 py-2 text-sm font-medium">受付枠</span>
        <a href="#special" className="text-ink-faint rounded-t-md px-4 py-2 text-sm hover:text-ink-secondary">休業日</a>
        <a href="#rules" className="text-ink-faint rounded-t-md px-4 py-2 text-sm hover:text-ink-secondary">予約のルール</a>
      </div>

      <div data-design="Info" className="bg-info-bg text-info rounded-card px-4 py-3 text-sm">
        何時から何時まで、どの曜日を受けるかです。右に、お客様のLINEに出るカレンダーの形を表示します。
      </div>

      <section data-design="Picker" className="bg-canvas border-hairline rounded-card border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-ink text-sm font-semibold">受付時間を編集する担当者</h2>
            <p className="text-ink-faint mt-1 text-xs">現在のAPIは担当者ごとの受付時間を保存します。</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {allStaff.map((staff) => (
              <button
                key={staff.id}
                type="button"
                onClick={() => setPickedStaffId(staff.id)}
                className={`rounded-pill px-3 py-1.5 text-xs font-medium ${staff.id === staffId ? 'bg-accent-deep text-on-accent' : 'bg-canvas-sunken text-ink-secondary'}`}
              >
                {staff.display_name || staff.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error ? <div className="bg-danger-bg text-danger rounded-card px-4 py-3 text-sm">{error}</div> : null}
      {success ? <div className="bg-success-bg text-success rounded-card px-4 py-3 text-sm">{success}</div> : null}

      {!selectedAccountId || !staffId ? (
        <ListState kind="empty" title="予約スタッフを選んでください" description="受付時間を設定する担当者を選んでください。" />
      ) : loadStatus === 'loading' ? (
        <ListState kind="loading" title="受付時間と休業日を読み込んでいます" />
      ) : loadStatus === 'error' ? (
        <ListState
          kind="error"
          title="受付時間と休業日を表示できませんでした"
          description="保存済みの設定は消えていません。時間をおいて、もう一度読み込んでください。"
          action={<Button onClick={() => void load()}>受付時間と休業日を再読み込み</Button>}
        />
      ) : (
        <div data-design="Body" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0 space-y-4">
            <section data-design="Week" className="bg-canvas border-hairline overflow-hidden rounded-card border">
              <div className="border-hairline border-b px-4 py-4">
                <h2 className="text-ink font-semibold">曜日ごとの受付時間</h2>
                <p className="text-ink-faint mt-1 text-xs">閉めた曜日は、お客様の画面に出ません。{staffMember ? `${staffMember.display_name || staffMember.name}の設定です。` : ''}</p>
              </div>
              <DataTable className="rounded-none border-0">
                <thead>
                  <TableHeadRow>
                    <Th>曜日</Th>
                    <Th>受け付ける</Th>
                    <Th>開ける時間</Th>
                    <Th>休けい</Th>
                    <Th>1時間に受けられる数</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {DAYS.map((day) => {
                    const current = template[day.key]
                    return (
                      <Tr key={day.key}>
                        <Td className="whitespace-nowrap font-medium">{day.label}</Td>
                        <Td>
                          <label className="inline-flex items-center gap-2 whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={current !== null}
                              onChange={(event) => setTemplate((previous) => ({
                                ...previous,
                                [day.key]: event.target.checked ? { start: '09:00', end: '19:00' } : null,
                              }))}
                            />
                            {current ? 'はい' : 'いいえ（定休日）'}
                          </label>
                        </Td>
                        <Td>
                          {current ? (
                            <div className="flex items-center gap-1 whitespace-nowrap">
                              <input
                                aria-label={`${day.label}の開始時間`}
                                type="time"
                                value={current.start}
                                onChange={(event) => setTemplate((previous) => ({ ...previous, [day.key]: { ...current, start: event.target.value } }))}
                                className="border-hairline rounded-control w-24 border px-2 py-1.5 text-sm tabular-nums"
                              />
                              <span className="text-ink-faint">〜</span>
                              <input
                                aria-label={`${day.label}の終了時間`}
                                type="time"
                                value={current.end}
                                onChange={(event) => setTemplate((previous) => ({ ...previous, [day.key]: { ...current, end: event.target.value } }))}
                                className="border-hairline rounded-control w-24 border px-2 py-1.5 text-sm tabular-nums"
                              />
                            </div>
                          ) : '—'}
                        </Td>
                        <Td title="休けい時間を保存するAPIは未接続です">—</Td>
                        <Td title="店舗・設備を含む受付上限APIは未接続です">—</Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </DataTable>
              <div className="border-hairline flex justify-end border-t p-4">
                <Button variant="primary" onClick={() => void saveRules()} disabled={savingRules}>
                  {savingRules ? '保存中…' : '受付時間を保存'}
                </Button>
              </div>
            </section>

            <section id="special" data-design="Special" className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink font-semibold">特別な休み・営業</h2>
              <p className="text-ink-faint mt-1 text-xs">この日は、曜日の決めごとより優先します。現在のAPIは特別営業の時間だけを返します。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {shifts.length === 0 ? <span className="text-ink-faint text-sm">特別な日はありません</span> : shifts.map((shift) => (
                  <span key={shift.id} className="border-hairline rounded-pill inline-flex items-center gap-2 border px-3 py-2 text-sm">
                    {dateLabel(shift.work_date)} {shift.start_time}〜{shift.end_time}
                    <button type="button" aria-label={`${shift.work_date}の特別営業を削除`} onClick={() => setDeleteShiftTarget({ id: shift.id, date: shift.work_date })} className="text-danger">×</button>
                  </span>
                ))}
              </div>
            </section>

            <section id="rules" data-design="Rules" className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink font-semibold">予約のルール</h2>
              <p className="text-ink-faint mt-1 text-xs">店舗共通の設定APIがないため、公開中メニューに保存された値をまとめて表示します。</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['何日先まで取れるか', bookingWindow, '日'],
                  ['何時間前まで取れるか', cutoff, '時間'],
                  ['何時間前まで取り消せるか', cancelDeadline, '時間'],
                  ['同じ人が同時に持てる予約', '—', 'API待ち'],
                ].map(([label, value, unit]) => (
                  <div key={label} className="border-hairline rounded-control border p-3">
                    <p className="text-ink-secondary text-xs font-medium">{label}</p>
                    <p className="text-ink mt-2 text-lg font-semibold tabular-nums">{value}</p>
                    <p className="text-ink-faint mt-1 text-xs">{unit}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <section data-design="Preview" className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink-secondary text-sm font-semibold">お客様のLINEではこう見えます</h2>
              <div className="bg-info mt-3 rounded-card p-3">
                <div className="bg-canvas rounded-control p-4">
                  <p className="text-ink text-sm font-semibold">ご希望の日をえらんでください</p>
                  <div className="text-ink-faint mt-3 grid grid-cols-7 gap-1 text-center text-xs">
                    {['月', '火', '水', '木', '金', '土', '日'].map((day) => <span key={day} className="font-medium">{day}</span>)}
                    {Array.from({ length: 14 }, (_, index) => <span key={index} className="bg-canvas-sunken rounded-control py-2">—</span>)}
                  </div>
                  <p className="text-ink-faint mt-3 text-xs leading-5">実際の空きと残数を返すプレビューAPIの接続後に、○・△・×・休を表示します。</p>
                </div>
              </div>
            </section>

            <section data-design="Trouble" className="bg-warning-bg text-warning rounded-card p-4">
              <h2 className="font-semibold">よくある困りごと</h2>
              <dl className="mt-3 space-y-3 text-xs leading-5">
                <div>
                  <dt className="font-semibold">閉めている曜日</dt>
                  <dd>{closedDays.length > 0 ? closedDays.join('・') : 'ありません'}</dd>
                </div>
                <div>
                  <dt className="font-semibold">外部予定との重なり</dt>
                  <dd>{calendarConnected ? 'Googleカレンダーを接続済みです。' : 'Googleカレンダーは未接続です。'}</dd>
                </div>
              </dl>
            </section>

            <section data-design="Links" className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink font-semibold">つながる先</h2>
              <div className="mt-3 space-y-3 text-sm">
                <Link href="/booking/bookings" className="text-accent flex justify-between gap-3"><span>→ 予約管理</span><span className="text-ink-faint text-xs">入った予約の台帳</span></Link>
                <Link href="/rich-menus" className="text-accent flex justify-between gap-3"><span>→ リッチメニュー</span><span className="text-ink-faint text-xs">予約ボタンの飛び先</span></Link>
                <Link href="/reminders" className="text-accent flex justify-between gap-3"><span>→ リマインダ</span><span className="text-ink-faint text-xs">前日・当日のお知らせ</span></Link>
                <Link href="/users" className="text-accent flex justify-between gap-3"><span>→ ログインユーザー</span><span className="text-ink-faint text-xs">担当できる人</span></Link>
              </div>
            </section>

            <details className="bg-canvas border-hairline rounded-card border p-4">
              <summary className="text-ink cursor-pointer text-sm font-semibold">Googleカレンダー連携</summary>
              <div className="mt-4 space-y-3">
                <p className="text-ink-faint text-xs">予定ありの時間を受付枠から外します。{calendarConnected ? '接続済みです。' : 'まだ接続していません。'}</p>
                {serviceAccountEmail ? <p className="text-ink-secondary break-all text-xs">共有先: {serviceAccountEmail}</p> : null}
                {!serviceAccountConfigured ? <p className="text-warning text-xs">Google連携の共通設定が必要です。</p> : null}
                <label className="block">
                  <span className="text-ink-secondary mb-1 block text-xs">カレンダーID</span>
                  <input value={calendarId} onChange={(event) => setCalendarId(event.target.value)} className="border-hairline rounded-control w-full border px-3 py-2 text-sm" />
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  {calendarConnected ? <Button onClick={() => setUnlinkOpen(true)}>連携を解除</Button> : null}
                  <Button variant="primary" onClick={() => void connectCalendar()} disabled={savingCalendar || !calendarId.trim() || !serviceAccountConfigured}>
                    {savingCalendar ? '確認中…' : '接続を確認'}
                  </Button>
                </div>
              </div>
            </details>
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={unlinkOpen}
        title="Googleカレンダー連携を解除しますか？"
        description="予定の取り込みを止めます。すでに入っている予約は残ります。"
        confirmLabel="連携を解除"
        destructive
        onCancel={() => setUnlinkOpen(false)}
        onConfirm={() => void disconnectCalendar()}
      />
      <ConfirmDialog
        open={deleteShiftTarget !== null}
        title={`${deleteShiftTarget?.date ?? ''} の特別営業を削除しますか？`}
        description="この日だけの受付時間を消し、曜日ごとの設定に戻します。すでに入っている予約は残ります。"
        confirmLabel="削除する"
        destructive
        onCancel={() => setDeleteShiftTarget(null)}
        onConfirm={() => { if (deleteShiftTarget) void deleteShift(deleteShiftTarget.id) }}
      />
    </div>
  )
}

export default function StaffShiftsPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <StaffShiftsPageContent />
    </Suspense>
  )
}
