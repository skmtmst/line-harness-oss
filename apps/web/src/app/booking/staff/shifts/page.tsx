'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePageTitle } from '@/components/shell/page-chrome'
import StaffDetail from './staff-detail'
import LiffDateTimePreview, { type LiffPreviewStatus } from './liff-preview'
import {
  ApiError,
  bookingApi,
  type BookingAvailabilitySlot,
  type BookingException,
  type BookingMenu,
  type BookingResource,
  type BookingSettings,
  type BookingSlotBlockReason,
  type BookingSlotCheckResult,
  type BookingStaff,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { canEditFeature, canViewFeature } from '@/lib/staff-capability'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import SelectField from '@/components/shared/select-field'
import { shortDate } from '../../lib/format-time'

type LoadStatus = 'loading' | 'ready' | 'error'

const DAYS = [
  { weekday: 1, label: '月曜日' },
  { weekday: 2, label: '火曜日' },
  { weekday: 3, label: '水曜日' },
  { weekday: 4, label: '木曜日' },
  { weekday: 5, label: '金曜日' },
  { weekday: 6, label: '土曜日' },
  { weekday: 0, label: '日曜日' },
] as const

type BusinessHoursDay = BookingSettings['businessHours'][number]
type BusinessHourInterval = BusinessHoursDay['intervals'][number]

function initialBusinessHours(settings: BookingSettings): BusinessHoursDay[] {
  return DAYS.map(({ weekday }) => ({
    weekday,
    intervals: (settings.businessHours.find((day) => day.weekday === weekday)?.intervals ?? [])
      .map((interval) => ({ ...interval, capacity: interval.capacity ?? 1 })),
  }))
}

function validateBusinessHours(days: BusinessHoursDay[]): string | null {
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  for (const day of days) {
    if (day.intervals.length > 8) return '1曜日の営業時間は8区間までです。'
    const sorted = [...day.intervals].sort((a, b) => a.start.localeCompare(b.start))
    for (const interval of sorted) {
      if (!timePattern.test(interval.start) || !timePattern.test(interval.end) || interval.start >= interval.end) {
        return '営業時間は日ごとに分けて入力してください。終了は同じ日の開始より後にし、24:00は使えません。'
      }
      const capacity = Number(interval.capacity)
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) {
        return '同時に受け付ける数は1〜1000件で入力してください。'
      }
    }
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index - 1].end > sorted[index].start) {
        return '同じ曜日の営業時間は重ならないように入力してください。'
      }
    }
  }
  return null
}

function businessHoursSaveError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'ほかの担当者が先に保存しました。最新の内容を読み直してから、もう一度変更してください。'
  }
  if (error instanceof ApiError && error.status === 400) return error.message
  return '営業時間を保存できませんでした。入力内容を確かめて、もう一度お試しください。'
}

function BusinessHoursEditor({ accountId, settings, canEdit, onSaved, onReload }: {
  accountId: string
  settings: BookingSettings
  /** false のとき閲覧のみ。入力を無効化し保存ボタンを出さない（APIも403で拒否）。 */
  canEdit: boolean
  onSaved: (settings: BookingSettings) => void
  onReload: () => void
}) {
  const [draft, setDraft] = useState(() => initialBusinessHours(settings))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const activeRef = useRef(true)
  const inFlightRef = useRef(false)

  useEffect(() => () => { activeRef.current = false }, [])
  useEffect(() => {
    setDraft(initialBusinessHours(settings))
  }, [settings])

  function updateDay(weekday: number, update: (intervals: BusinessHourInterval[]) => BusinessHourInterval[]) {
    setDraft((current) => current.map((day) => day.weekday === weekday
      ? { ...day, intervals: update(day.intervals) }
      : day))
    setSaved(false)
    setSaveError(null)
  }

  function setAccepts(weekday: number, accepts: boolean) {
    updateDay(weekday, (intervals) => accepts
      ? intervals.length > 0 ? intervals : [{ start: '09:00', end: '18:00', capacity: 1 }]
      : [])
  }

  function updateInterval(weekday: number, index: number, change: Partial<BusinessHourInterval>) {
    updateDay(weekday, (intervals) => intervals.map((interval, currentIndex) => (
      currentIndex === index ? { ...interval, ...change } : interval
    )))
  }

  async function submit() {
    if (inFlightRef.current) return
    const validationError = validateBusinessHours(draft)
    if (validationError) {
      setSaveError(validationError)
      return
    }
    inFlightRef.current = true
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const response = await bookingApi.saveSettings(accountId, {
        expectedVersion: settings.version,
        timeZone: settings.timeZone,
        bookingWindowDays: settings.bookingWindowDays,
        cutoffMinutesBefore: settings.cutoffMinutesBefore,
        cancelDeadlineMinutesBefore: settings.cancelDeadlineMinutesBefore,
        maxActiveBookingsPerFriend: settings.maxActiveBookingsPerFriend,
        approvalMode: settings.approvalMode,
        holdMinutes: settings.holdMinutes,
        slotGranularityMinutes: settings.slotGranularityMinutes,
        // 営業時間の保存で上書きしないよう、現在のリマインダ設定をそのまま送る。
        reminderDayBeforeTime: settings.reminderDayBeforeTime,
        reminderHoursBefore: settings.reminderHoursBefore,
        businessHours: draft,
      })
      if (!activeRef.current) return
      if (!response.success) throw new Error('booking_business_hours_save_failed')
      setSaved(true)
      onSaved(response.data)
    } catch (error) {
      if (activeRef.current) setSaveError(businessHoursSaveError(error))
    } finally {
      inFlightRef.current = false
      if (activeRef.current) setSaving(false)
    }
  }

  return (
    <section data-design="Week" className="bg-canvas border-hairline overflow-hidden rounded-card border">
      <div className="border-hairline border-b px-4 py-4">
        <h2 className="text-ink font-semibold">開ける時間</h2>
        <p className="text-ink-faint mt-1 text-xs">曜日ごとの受付時間と休けいを決めます。同時受付数は「1時間に受けられる数」ではなく、同じ時間に重ねられる予約数です。閉めた曜日は、お客様の画面に出ません。</p>
        {!settings.businessHoursConfigured ? (
          <p className="bg-warning-bg text-warning mt-3 rounded-control px-3 py-2 text-xs" role="note">
            まだ週全体の営業時間を保存していません。入力済みの時間帯は適用されていますが、時間帯がない曜日は現在は担当者の勤務時間どおりに受け付けます。保存すると、その曜日は休業になります。
          </p>
        ) : null}
      </div>
      <fieldset disabled={!canEdit} className="contents">
      <div className="divide-hairline divide-y">
        {DAYS.map((day) => {
          const intervals = draft.find((item) => item.weekday === day.weekday)?.intervals ?? []
          const accepts = intervals.length > 0
          return (
            <div className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-6" key={day.weekday}>
              <label className="flex items-center gap-2 font-semibold whitespace-nowrap lg:col-span-1">
                <input
                  aria-label={`${day.label}を受け付ける`}
                  type="checkbox"
                  checked={accepts}
                  onChange={(event) => setAccepts(day.weekday, event.target.checked)}
                />
                {day.label}
              </label>
              {!accepts ? (
                <p className="text-ink-faint lg:col-span-5">{settings.businessHoursConfigured ? '休み（定休日）' : '未設定（現在は担当者の勤務時間どおり）'}</p>
              ) : (
                <div className="space-y-2 lg:col-span-5">
                  {intervals.map((interval, index) => (
                    <div className="flex flex-wrap items-end gap-2" key={`${day.weekday}-${index}`}>
                      <label className="text-ink-secondary text-xs">
                        開始
                        <input aria-label={`${day.label} ${index + 1}件目の開始`} type="time" value={interval.start} onChange={(event) => updateInterval(day.weekday, index, { start: event.target.value })} className="border-hairline rounded-control mt-1 block border bg-canvas px-2 py-1.5 text-sm tabular-nums" />
                      </label>
                      <span className="pb-2 text-xs">〜</span>
                      <label className="text-ink-secondary text-xs">
                        終了
                        <input aria-label={`${day.label} ${index + 1}件目の終了`} type="time" value={interval.end} onChange={(event) => updateInterval(day.weekday, index, { end: event.target.value })} className="border-hairline rounded-control mt-1 block border bg-canvas px-2 py-1.5 text-sm tabular-nums" />
                      </label>
                      <label className="text-ink-secondary text-xs">
                        同時受付数
                        <input aria-label={`${day.label} ${index + 1}件目の同時受付数`} type="number" min={1} max={1000} value={interval.capacity ?? 1} onChange={(event) => updateInterval(day.weekday, index, { capacity: Number(event.target.value) })} className="border-hairline rounded-control mt-1 block w-24 border bg-canvas px-2 py-1.5 text-sm tabular-nums" />
                      </label>
                      <button type="button" className="text-danger mb-1.5 px-2 py-1 text-xs underline" onClick={() => updateDay(day.weekday, (current) => current.filter((_, currentIndex) => currentIndex !== index))}>この時間を削除</button>
                    </div>
                  ))}
                  {intervals.length < 8 ? (
                    <button type="button" className="text-action text-xs font-semibold underline" onClick={() => updateDay(day.weekday, (current) => [...current, { start: '09:00', end: '18:00', capacity: 1 }])}>時間帯を追加</button>
                  ) : null}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="border-hairline border-t px-4 py-4">
        <p className="text-ink-faint text-xs">日をまたぐ営業は、日ごとに分けて入力してください。終了時刻に24:00は使えません。</p>
        {saveError ? (
          <div className="bg-danger-bg text-danger mt-3 rounded-control p-3 text-sm" role="alert">
            <p>{saveError}</p>
            {saveError.includes('先に保存') ? <button type="button" onClick={onReload} className="mt-2 font-semibold underline">最新の内容を読み直す</button> : null}
          </div>
        ) : null}
        {saved ? <p className="text-success mt-3 text-sm font-semibold" role="status">営業時間を保存しました。</p> : null}
        {canEdit ? (
          <div className="mt-3 flex justify-end">
            <Button variant="primary" onClick={() => void submit()} disabled={saving}>{saving ? '保存中…' : '営業時間を保存'}</Button>
          </div>
        ) : <p className="text-ink-faint mt-3 text-xs">閲覧のみです。変更には予約設定の権限が必要です。</p>}
      </div>
      </fieldset>
    </section>
  )
}

const JST_OFFSET_MS = 9 * 3600_000

// LIFF の日時選択（apps/liff/src/components/DateTimePicker.tsx）と同じく、
// JST の今日から14日分を空き枠の取得期間にする（liff 側の jstToday/addDays と同じ計算）。
function previewRange(): { from: string; to: string } {
  const from = new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10)
  const end = new Date(`${from}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 13)
  return { from, to: end.toISOString().slice(0, 10) }
}

export default function StaffShiftsPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <StaffShiftsPageContent />
    </Suspense>
  )
}

// ?staff_id= があるときは担当者別の勤務・シフト画面、ないときは従来のお店全体の受付枠。
// staff ロールは「お店全体の受付枠」ではなく自分の勤務へ誘導する（N-411 本人勤務）。
// 店舗設定の閲覧権限が無い人がここへ来ても、権限外の画面ではなく自分の画面へ着く。
function StaffShiftsPageContent() {
  const staffId = useSearchParams().get('staff_id') ?? ''
  const [isStaffRole] = useState(() =>
    typeof window !== 'undefined' && window.localStorage.getItem('lh_staff_role') === 'staff')
  usePageTitle('予約設定')
  if (staffId) return <StaffDetail staffId={staffId} />
  if (isStaffRole) return <OwnShiftEntry />
  return <StoreShiftsView />
}

// 自分に紐づく予約スタッフを /staff/me で解決し、自分の勤務画面へ送る。
// 紐づけが無い場合: 店舗の受付枠を見られる権限があれば従来どおり店舗ビュー、
// なければ「紐づけ待ち」の案内を出す（真っ白な403画面にしない）。
function OwnShiftEntry() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [resolved, setResolved] = useState<'loading' | 'store' | 'missing'>('loading')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // 選択中アカウント優先。見つからなければ紐づく全件の先頭を使う。
      const scoped = selectedAccountId
        ? await bookingApi.listMyStaff(selectedAccountId).catch(() => null)
        : null
      const rows = scoped?.staff?.length
        ? scoped.staff
        : (await bookingApi.listMyStaff().catch(() => null))?.staff ?? []
      if (cancelled) return
      if (rows.length > 0) {
        router.replace(`/booking/staff/shifts?staff_id=${rows[0].id}`)
        return
      }
      const canSeeStore = canViewFeature('/booking/bookings')
        || canViewFeature('booking.settings')
        || canViewFeature('/booking/menus')
      setResolved(canSeeStore ? 'store' : 'missing')
    })()
    return () => { cancelled = true }
  }, [router, selectedAccountId])

  if (resolved === 'store') return <StoreShiftsView />
  if (resolved === 'missing') {
    return (
      <div className="space-y-4 pb-8">
        <ListState
          kind="empty"
          title="紐づく予約スタッフがありません"
          description="管理者が予約スタッフとログインユーザーの紐づけを設定すると、ここで自分の勤務を管理できます。"
        />
      </div>
    )
  }
  return (
    <div className="space-y-4 pb-8">
      <ListState kind="loading" title="自分の勤務を探しています" />
    </div>
  )
}

function resourceSaveError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return error.message
  if (error instanceof ApiError && error.status === 400) return error.message
  return '設備を保存できませんでした。入力内容は残っています。もう一度お試しください。'
}

function ResourceEditor({ accountId, resource, canManage, onSaved, onDeleted }: {
  accountId: string
  resource: BookingResource
  canManage: boolean
  onSaved: (resource: BookingResource) => void
  onDeleted: (id: string) => void
}) {
  const [name, setName] = useState(resource.name)
  const [type, setType] = useState(resource.type)
  const [capacity, setCapacity] = useState(String(resource.capacity))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeRef = useRef(true)
  const inFlightRef = useRef(false)
  useEffect(() => () => { activeRef.current = false }, [])

  async function update(nextActive = resource.isActive) {
    if (inFlightRef.current) return
    const parsedCapacity = Number(capacity)
    if (!name.trim() || name.trim().length > 100 || !type.trim() || type.trim().length > 50
      || !Number.isInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 1000) {
      setError('設備名は1〜100文字、種類は1〜50文字、受付上限は1〜1000の整数で入力してください。')
      return
    }
    inFlightRef.current = true
    setSaving(true)
    setError(null)
    try {
      const response = await bookingApi.updateResource(accountId, resource.id, {
        expectedVersion: resource.version,
        name: name.trim(),
        type: type.trim(),
        capacity: parsedCapacity,
        isActive: nextActive,
      })
      if (activeRef.current) onSaved(response.data)
    } catch (cause) {
      if (activeRef.current) setError(resourceSaveError(cause))
    } finally {
      inFlightRef.current = false
      if (activeRef.current) setSaving(false)
    }
  }

  async function remove() {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setSaving(true)
    setError(null)
    try {
      await bookingApi.deleteResource(accountId, resource.id, resource.version)
      if (activeRef.current) onDeleted(resource.id)
    } catch (cause) {
      if (activeRef.current) setError(resourceSaveError(cause))
    } finally {
      inFlightRef.current = false
      if (activeRef.current) setSaving(false)
    }
  }

  return (
    <div className="border-hairline rounded-control border p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-ink-secondary text-xs">設備名
          <input aria-label={`${resource.name}の設備名`} value={name} onChange={(event) => setName(event.target.value)} disabled={!canManage || saving} maxLength={100} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm disabled:opacity-60" />
        </label>
        <label className="text-ink-secondary text-xs">種類
          <input aria-label={`${resource.name}の種類`} value={type} onChange={(event) => setType(event.target.value)} disabled={!canManage || saving} maxLength={50} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm disabled:opacity-60" />
        </label>
        <label className="text-ink-secondary text-xs">受付上限
          <input aria-label={`${resource.name}の受付上限`} type="number" min={1} max={1000} value={capacity} onChange={(event) => setCapacity(event.target.value)} disabled={!canManage || saving} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm disabled:opacity-60" />
        </label>
      </div>
      <p className="text-ink-faint mt-2 text-xs">
        メニュー {resource.usage.menuCount}件 ／ 予約 {resource.usage.bookingCount}件 ／ 例外日 {resource.usage.exceptionCount}件
      </p>
      {error ? <p className="text-danger mt-2 text-xs" role="alert">{error}</p> : null}
      {canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void update()} disabled={saving}>{saving ? '保存中…' : '設備を保存'}</Button>
          <Button onClick={() => void update(!resource.isActive)} disabled={saving}>{resource.isActive ? '受付を停止' : '受付を再開'}</Button>
          {!resource.usage.referenced ? <Button onClick={() => void remove()} disabled={saving}>設備を削除</Button> : null}
        </div>
      ) : <p className="text-ink-faint mt-2 text-xs">閲覧のみです。変更はオーナーまたは管理者が行えます。</p>}
    </div>
  )
}

function NewResourceEditor({ accountId, onCreated }: {
  accountId: string
  onCreated: (resource: BookingResource) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [capacity, setCapacity] = useState('1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeRef = useRef(true)
  const inFlightRef = useRef(false)
  useEffect(() => () => { activeRef.current = false }, [])

  async function create() {
    if (inFlightRef.current) return
    const parsedCapacity = Number(capacity)
    if (!name.trim() || name.trim().length > 100 || !type.trim() || type.trim().length > 50
      || !Number.isInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 1000) {
      setError('設備名は1〜100文字、種類は1〜50文字、受付上限は1〜1000の整数で入力してください。')
      return
    }
    inFlightRef.current = true
    setSaving(true)
    setError(null)
    try {
      const response = await bookingApi.createResource(accountId, {
        name: name.trim(), type: type.trim(), capacity: parsedCapacity,
      })
      if (!activeRef.current) return
      onCreated(response.data)
      setName('')
      setType('')
      setCapacity('1')
    } catch (cause) {
      if (activeRef.current) setError(resourceSaveError(cause))
    } finally {
      inFlightRef.current = false
      if (activeRef.current) setSaving(false)
    }
  }

  return (
    <div className="border-hairline bg-canvas-sunken rounded-control border p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-ink-secondary text-xs">設備名
          <input aria-label="新しい設備名" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} maxLength={100} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
        </label>
        <label className="text-ink-secondary text-xs">種類
          <input aria-label="新しい設備の種類" value={type} onChange={(event) => setType(event.target.value)} disabled={saving} maxLength={50} placeholder="例: 部屋・席・機器" className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
        </label>
        <label className="text-ink-secondary text-xs">受付上限
          <input aria-label="新しい設備の受付上限" type="number" min={1} max={1000} value={capacity} onChange={(event) => setCapacity(event.target.value)} disabled={saving} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
        </label>
      </div>
      {error ? <p className="text-danger mt-2 text-xs" role="alert">{error}</p> : null}
      <Button className="mt-3" variant="primary" onClick={() => void create()} disabled={saving}>{saving ? '追加中…' : '設備を追加'}</Button>
    </div>
  )
}

/** IDEA-28: 予約できない理由コードを運用者向けの文へ。予定の件名や相手など詳細は API から返らない。 */
const SLOT_REASON_LABELS: Record<BookingSlotBlockReason, string> = {
  menu_inactive: 'このメニューは受付を止めているか、削除されています',
  staff_not_offered: 'このメニューを担当できるスタッフがいません',
  invalid_resource: 'このメニューが必要とする設備の設定に問題があります',
  booking_window: '受付期間（何日先まで取れるか）の外です',
  past_cutoff: '受付の締め切り（何時間前まで取れるか）を過ぎています',
  invalid_time: 'その時刻は存在しません',
  not_on_grid: '開始時刻が受付の刻み（30分）に合っていません',
  exception_closed: '休業日・例外日で閉めています',
  exception_invalid: '例外日の時間設定が壊れているため、安全のため閉めています',
  outside_working: '勤務・営業時間の外です',
  duration_overrun: '勤務・営業の終わりまでに所要時間が収まりません',
  other_booking: 'ほかの予約と重なっています',
  google_busy: '外部カレンダーの予定と重なっています',
  capacity_full: '担当の同時受付数がいっぱいです',
  store_full: '店舗全体の同時受付枠がいっぱいです',
  resource_shortage: '必要な設備がその時間に足りません',
  calendar_unavailable: '外部カレンダーを読めないため、安全のため閉めています',
  unavailable: 'この日時は受け付けられません',
}

function slotReasonLabel(reason: BookingSlotBlockReason): string {
  return SLOT_REASON_LABELS[reason] ?? 'この日時は受け付けられません'
}

// IDEA-28: 日時を指定して、予約できるか・だめならどの条件で閉まっているかを確かめる。
// 読み取りだけで予約は作らない。判定はお客様の予約画面と同じ条件。
function SlotCheckCard({ accountId, menus }: { accountId: string; menus: BookingMenu[] }) {
  const activeMenus = useMemo(() => menus.filter((menu) => menu.is_active), [menus])
  const [menuId, setMenuId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [staffId, setStaffId] = useState('')
  // 担当の絞り込みは予約スタッフ一覧の閲覧権限が要る。取れない場合は全担当まとめて判定する。
  const [staffOptions, setStaffOptions] = useState<BookingStaff[]>([])
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [result, setResult] = useState<BookingSlotCheckResult | null>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    void bookingApi.listStaff(accountId)
      .then((res) => {
        if (!cancelled) setStaffOptions(res.staff.filter((staff) => staff.is_active))
      })
      .catch(() => {
        if (!cancelled) setStaffOptions([])
      })
    return () => { cancelled = true }
  }, [accountId])

  useEffect(() => {
    if (!menuId && activeMenus.length > 0) setMenuId(activeMenus[0].id)
  }, [activeMenus, menuId])

  async function run() {
    if (!menuId || !date || !time) return
    const requestId = ++requestRef.current
    setChecking(true)
    setCheckError(null)
    try {
      const response = await bookingApi.checkAvailability(accountId, {
        menuId,
        staffId: staffId || undefined,
        date,
        time,
      })
      if (requestId !== requestRef.current) return
      setResult(response)
    } catch (error) {
      if (requestId !== requestRef.current) return
      setResult(null)
      setCheckError(error instanceof ApiError && error.status === 403
        ? 'このアカウントの予約を確かめる権限がありません。'
        : '空き状況を確かめられませんでした。もう一度お試しください。')
    } finally {
      if (requestId === requestRef.current) setChecking(false)
    }
  }

  const canRun = Boolean(menuId && date && time) && !checking

  return (
    <section className="bg-canvas border-hairline rounded-card border p-4">
      <h2 className="text-ink font-semibold">日時を指定して空きを確認</h2>
      <p className="text-ink-faint mt-1 text-xs">
        お客様の予約画面と同じ条件で、その日時に予約を受けられるか確かめます。受けられないときは、勤務・外部の予定・所要時間・定員・休業日のどの条件で閉まっているかを表示します。確認しても予約は作られません。
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-ink-secondary text-xs">
          メニュー
          <SelectField
            aria-label="確認するメニュー"
            value={menuId}
            onChange={(event) => { setMenuId(event.target.value); setResult(null) }}
            className="mt-1 w-full"
            options={[
              ...(activeMenus.length === 0 ? [{ value: '', label: '受付中のメニューがありません' }] : []),
              ...activeMenus.map((menu) => ({ value: menu.id, label: menu.name })),
            ]}
          />
        </label>
        <label className="text-ink-secondary text-xs">
          日付
          <input aria-label="確認する日付" type="date" value={date} onChange={(event) => { setDate(event.target.value); setResult(null) }} className="border-hairline rounded-control mt-1 block w-full border bg-canvas px-3 py-2 text-sm tabular-nums" />
        </label>
        <label className="text-ink-secondary text-xs">
          開始時刻
          <input aria-label="確認する開始時刻" type="time" value={time} onChange={(event) => { setTime(event.target.value); setResult(null) }} className="border-hairline rounded-control mt-1 block w-full border bg-canvas px-3 py-2 text-sm tabular-nums" />
        </label>
        {staffOptions.length > 0 ? (
          <label className="text-ink-secondary text-xs">
            担当
            <SelectField
              aria-label="確認する担当"
              value={staffId}
              onChange={(event) => { setStaffId(event.target.value); setResult(null) }}
              className="mt-1 w-full"
              options={[
                { value: '', label: '指定しない（誰かが取れれば可）' },
                ...staffOptions.map((staff) => ({ value: staff.id, label: staff.display_name })),
              ]}
            />
          </label>
        ) : null}
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={() => void run()} disabled={!canRun}>{checking ? '確認中…' : 'この日時を確かめる'}</Button>
      </div>
      {checkError ? <p className="text-danger mt-3 text-sm" role="alert">{checkError}</p> : null}
      {result ? (
        result.bookable ? (
          <div className="bg-success-bg text-success mt-3 rounded-control p-3 text-sm" role="status">
            <p className="font-semibold">この日時は予約を受けられます。</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {result.per_staff.filter((staff) => staff.bookable).map((staff) => (
                <li key={staff.staff_id}>{staff.display_name}: 残り {staff.remaining}/{staff.capacity}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="bg-warning-bg text-warning mt-3 rounded-control p-3 text-sm" role="status">
            <p className="font-semibold">この日時は予約できません。</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {result.reasons.map((reason) => <li key={reason}>{slotReasonLabel(reason)}</li>)}
            </ul>
            {result.per_staff.length > 1 ? (
              <ul className="mt-2 space-y-0.5 border-t border-current/20 pt-2 text-xs">
                {result.per_staff.map((staff) => (
                  <li key={staff.staff_id}>
                    {staff.display_name}: {staff.bookable
                      ? '予約できます'
                      : staff.reasons.map(slotReasonLabel).join('、')}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      ) : null}
    </section>
  )
}

function StoreShiftsView() {
  usePageTitle('予約設定')
  const { selectedAccountId, selectedAccount } = useAccount()
  const [settings, setSettings] = useState<BookingSettings | null>(null)
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [resources, setResources] = useState<BookingResource[]>([])
  // プレビューは実LIFF（DateTimePicker）と同じ取得物を使う:
  // 先頭の有効メニューについて、担当一覧の先頭（by_staff[0]）の空き枠。
  const [preview, setPreview] = useState<{
    status: LiffPreviewStatus
    staffName: string | null
    slots: BookingAvailabilitySlot[]
  }>({ status: 'loading', staffName: null, slots: [] })
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [addingClosed, setAddingClosed] = useState(false)
  const [closedFrom, setClosedFrom] = useState('')
  const [closedTo, setClosedTo] = useState('')
  const [closedReason, setClosedReason] = useState('')
  const [savingClosed, setSavingClosed] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // #953 E-09: 登録済みの休業日を直す・消す口。修正はカード内の小さい
  // 入力に切り替え、削除は確認ダイアログを挟む。どちらも版付きで送る。
  const [editingExceptionId, setEditingExceptionId] = useState<string | null>(null)
  const [editFrom, setEditFrom] = useState('')
  const [editTo, setEditTo] = useState('')
  const [editReason, setEditReason] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BookingException | null>(null)
  const [exceptionBusy, setExceptionBusy] = useState(false)
  const [exceptionError, setExceptionError] = useState<string | null>(null)
  const [canManageResources, setCanManageResources] = useState(false)
  // N-411: 受付枠・休業日・設備の変更はすべて 'booking.settings' の実効permission。
  // 閲覧のみの人には入力を無効化し、保存ボタンを出さない（API側も403で拒否）。
  const [canEditSettings, setCanEditSettings] = useState(false)
  const requestRef = useRef(0)
  const loadedAccountRef = useRef<string | null>(null)
  const activeAccountRef = useRef(selectedAccountId)
  activeAccountRef.current = selectedAccountId

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const previewUrl = selectedAccount?.liffId
    ? `${workerBase}/o?liffId=${encodeURIComponent(selectedAccount.liffId)}&page=salon-book`
    : null
  const range = useMemo(previewRange, [])

  useEffect(() => {
    const canEdit = canEditFeature('booking.settings')
    setCanManageResources(canEdit)
    setCanEditSettings(canEdit)
  }, [])

  useEffect(() => {
    const requestId = ++requestRef.current
    if (!selectedAccountId) {
      loadedAccountRef.current = null
      setSettings(null)
      setMenus([])
      setResources([])
      setPreview({ status: 'ready', staffName: null, slots: [] })
      setLoadStatus('ready')
      return
    }
    if (loadedAccountRef.current !== selectedAccountId) setLoadStatus('loading')
    setPreview({ status: 'loading', staffName: null, slots: [] })
    setSaveError(null)

    void Promise.all([
      bookingApi.getSettings(selectedAccountId),
      bookingApi.listMenus(selectedAccountId),
      bookingApi.listResources(selectedAccountId),
    ]).then(async ([settingsResult, menuResult, resourcesResult]) => {
      if (requestId !== requestRef.current) return
      if (!settingsResult.success) throw new Error(settingsResult.error)
      setSettings(settingsResult.data)
      setMenus(menuResult.menus)
      loadedAccountRef.current = selectedAccountId
      // 予約設定APIは {success,data:{resources}} を返す(撮影用APIも同じ器)。
      setResources(resourcesResult.data.resources)
      setLoadStatus('ready')

      const menu = menuResult.menus.find((item) => item.is_active)
      if (!menu) {
        setPreview({ status: 'ready', staffName: null, slots: [] })
        return
      }
      try {
        const availability = await bookingApi.getAvailability(selectedAccountId, {
          menuId: menu.id,
          from: range.from,
          to: range.to,
        })
        if (requestId !== requestRef.current) return
        // LIFF は by_staff[0]（担当一覧の先頭）の枠だけを画面に出す。
        // 全担当を合算すると実際の画面に無い時刻が混ざるので、先頭だけ使う。
        const first = availability.by_staff[0]
        setPreview({
          status: 'ready',
          staffName: first?.display_name ?? null,
          slots: first?.slots ?? [],
        })
      } catch {
        if (requestId !== requestRef.current) return
        setPreview({ status: 'error', staffName: null, slots: [] })
      }
    }).catch(() => {
      if (requestId !== requestRef.current) return
      setSettings(null)
      setMenus([])
      setResources([])
      setPreview({ status: 'ready', staffName: null, slots: [] })
      setLoadStatus('error')
    })

    return () => {
      requestRef.current += 1
    }
  }, [range, reloadKey, selectedAccountId])

  const storeExceptions = useMemo(
    () => (settings?.exceptions ?? []).filter((item) => !item.scopeKind || item.scopeKind === 'store'),
    [settings],
  )
  // プレビューに出すメニューは空き枠取得と同じ「先頭の有効メニュー」。
  const previewMenuName = menus.find((item) => item.is_active)?.name ?? null

  const closedWeekdays = settings?.businessHoursConfigured ? DAYS.filter((day) => (
    settings?.businessHours.find((entry) => entry.weekday === day.weekday)?.intervals.length === 0
  )).map((day) => day.label) : []

  async function saveClosedDay() {
    if (!selectedAccountId || !closedFrom || !closedTo || closedFrom > closedTo) {
      setSaveError('開始日と終了日を正しく入れてください。')
      return
    }
    setSavingClosed(true)
    setSaveError(null)
    try {
      const response = await bookingApi.createException(selectedAccountId, {
        scopeKind: 'store',
        dateFrom: closedFrom,
        dateTo: closedTo,
        kind: 'closed',
        intervals: [],
        reason: closedReason.trim() || null,
      })
      if (!response.success) throw new Error(response.error)
      setSettings((current) => current ? {
        ...current,
        exceptions: [...current.exceptions, response.data],
      } : current)
      setAddingClosed(false)
      setClosedFrom('')
      setClosedTo('')
      setClosedReason('')
    } catch {
      setSaveError('休業日を保存できませんでした。入力内容を確かめて、もう一度お試しください。')
    } finally {
      setSavingClosed(false)
    }
  }

  function exceptionFailureMessage(error: unknown, action: '保存' | '削除'): string {
    if (error instanceof ApiError && error.status === 409) {
      return 'ほかの担当者が先にこの休業日を変更しました。読み直してからもう一度お試しください。'
    }
    return action === '削除'
      ? '休業日を消せませんでした。もう一度お試しください。'
      : '休業日を保存できませんでした。入力内容を確かめて、もう一度お試しください。'
  }

  function startEditException(item: BookingException) {
    setEditingExceptionId(item.id)
    setEditFrom(item.dateFrom || item.date || '')
    setEditTo(item.dateTo || item.date || '')
    setEditReason(item.reason ?? item.note ?? '')
    setExceptionError(null)
  }

  async function saveExceptionEdit(item: BookingException) {
    if (!selectedAccountId || exceptionBusy) return
    if (!editFrom || !editTo || editFrom > editTo) {
      setExceptionError('開始日と終了日を正しく入れてください。')
      return
    }
    setExceptionBusy(true)
    setExceptionError(null)
    try {
      const response = await bookingApi.updateException(selectedAccountId, item.id, {
        expectedVersion: item.version,
        dateFrom: editFrom,
        dateTo: editTo,
        reason: editReason.trim() || null,
      })
      if (!response.success) throw new Error(response.error)
      setSettings((current) => current ? {
        ...current,
        exceptions: current.exceptions.map((entry) => entry.id === item.id ? response.data : entry),
      } : current)
      setEditingExceptionId(null)
    } catch (error) {
      setExceptionError(exceptionFailureMessage(error, '保存'))
    } finally {
      setExceptionBusy(false)
    }
  }

  async function removeException() {
    const target = deleteTarget
    if (!selectedAccountId || !target || exceptionBusy) return
    setExceptionBusy(true)
    setExceptionError(null)
    try {
      await bookingApi.deleteException(selectedAccountId, target.id, target.version)
      setSettings((current) => current ? {
        ...current,
        exceptions: current.exceptions.filter((entry) => entry.id !== target.id),
      } : current)
      setDeleteTarget(null)
    } catch (error) {
      setExceptionError(exceptionFailureMessage(error, '削除'))
    } finally {
      setExceptionBusy(false)
    }
  }

  return (
    <div data-design-node="tksPc" className="space-y-4 pb-8">
      <div data-design="Head" className="flex flex-wrap items-center gap-3">
        <nav aria-label="現在位置" className="text-ink-faint text-xs">
          <Link href="/booking/bookings" className="text-action hover:underline">予約</Link>
          <span className="mx-2">›</span>
          <Link href="/booking/menus" className="text-action hover:underline">予約設定</Link>
          <span className="mx-2">›</span>
          <span>受付枠</span>
        </nav>
        {previewUrl ? <Button className="ml-auto" href={previewUrl}>お客様に見える画面を確かめる</Button> : null}
      </div>

      <div data-design="Tabs" className="border-hairline flex flex-wrap gap-1 border-b">
        <Link href="/booking/menus" className="text-ink-faint rounded-t-md px-4 py-2 text-sm hover:text-ink-secondary">メニュー {settings?.menuCount ?? '—'}</Link>
        <span className="border-accent text-ink rounded-t-md border-b-2 px-4 py-2 text-sm font-medium">受付枠</span>
        <a href="#special" className="text-ink-faint rounded-t-md px-4 py-2 text-sm hover:text-ink-secondary">休業日</a>
        <a href="#rules" className="text-ink-faint rounded-t-md px-4 py-2 text-sm hover:text-ink-secondary">予約のルール</a>
      </div>

      <div data-design="Info" className="bg-info-bg text-ink-secondary rounded-card px-4 py-3 text-xs">
        何時から何時まで、どの曜日を受けるかです。右に、お客様のLINEに出る日時の選び方がそのまま出ます。
      </div>

      {!selectedAccountId ? (
        <ListState kind="empty" title="LINEアカウントを選んでください" description="受付枠を確認するアカウントを選びます。" />
      ) : loadStatus === 'error' || !settings && loadedAccountRef.current === selectedAccountId ? (
        <ListState
          kind="error"
          title="受付時間と休業日を表示できませんでした"
          description="保存済みの設定は消えていません。時間をおいて、もう一度読み込んでください。"
          action={<Button onClick={() => setReloadKey((value) => value + 1)}>受付時間と休業日を再読み込み</Button>}
        />
      ) : loadStatus === 'loading' || loadedAccountRef.current !== selectedAccountId || !settings ? (
        <ListState kind="loading" title="受付時間と休業日を読み込んでいます" />
      ) : (
        <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
          <div className="min-w-0 flex-1 space-y-4">
            <BusinessHoursEditor
              key={selectedAccountId}
              accountId={selectedAccountId}
              settings={settings}
              canEdit={canEditSettings}
              onReload={() => setReloadKey((value) => value + 1)}
              onSaved={(savedSettings) => {
                setSettings(savedSettings)
                setReloadKey((value) => value + 1)
              }}
            />

            <section id="special" data-design="Special" className="bg-canvas border-hairline rounded-card border p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div>
                  <h2 className="text-ink font-semibold">休業日</h2>
                  <p className="text-ink-faint mt-1 text-xs">この日は、曜日の決めごとより優先して閉めます。</p>
                </div>
                {canEditSettings ? (
                  <Button className="ml-auto" onClick={() => setAddingClosed((value) => !value)}>休業日を足す</Button>
                ) : null}
              </div>
              {addingClosed ? (
                <div className="border-hairline bg-canvas-sunken mt-4 grid gap-3 rounded-control border p-3 sm:grid-cols-3">
                  <label className="text-ink-secondary text-xs">
                    開始日
                    <input aria-label="休業の開始日" type="date" value={closedFrom} onChange={(event) => setClosedFrom(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
                  </label>
                  <label className="text-ink-secondary text-xs">
                    終了日
                    <input aria-label="休業の終了日" type="date" value={closedTo} onChange={(event) => setClosedTo(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
                  </label>
                  <label className="text-ink-secondary text-xs">
                    理由
                    <input aria-label="休業の理由" value={closedReason} onChange={(event) => setClosedReason(event.target.value)} placeholder="例: お盆" className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
                  </label>
                  {saveError ? <p className="text-danger text-xs sm:col-span-2">{saveError}</p> : <span className="sm:col-span-2" />}
                  <Button variant="primary" onClick={() => void saveClosedDay()} disabled={savingClosed}>{savingClosed ? '保存中…' : '休業日を保存'}</Button>
                </div>
              ) : null}
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {storeExceptions.filter((item) => item.kind === 'closed').length === 0 ? (
                  <p className="text-ink-faint text-sm">休業日はありません</p>
                ) : storeExceptions.filter((item) => item.kind === 'closed').map((item) => {
                  const from = item.dateFrom || item.date || ''
                  const to = item.dateTo || item.date || ''
                  return (
                    <div key={item.id || `${from}-${to}`} className="border-hairline rounded-control border p-3">
                      {editingExceptionId === item.id ? (
                        <div className="space-y-2">
                          <label className="text-ink-secondary block text-xs">
                            開始日
                            <input aria-label="休業日の開始日" type="date" value={editFrom} onChange={(event) => setEditFrom(event.target.value)} disabled={exceptionBusy} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
                          </label>
                          <label className="text-ink-secondary block text-xs">
                            終了日
                            <input aria-label="休業日の終了日" type="date" value={editTo} onChange={(event) => setEditTo(event.target.value)} disabled={exceptionBusy} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
                          </label>
                          <label className="text-ink-secondary block text-xs">
                            理由
                            <input aria-label="休業日の理由" value={editReason} onChange={(event) => setEditReason(event.target.value)} disabled={exceptionBusy} placeholder="例: お盆" className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
                          </label>
                          {exceptionError ? <p className="text-danger text-xs" role="alert">{exceptionError}</p> : null}
                          <div className="flex flex-wrap gap-2">
                            <Button variant="primary" onClick={() => void saveExceptionEdit(item)} disabled={exceptionBusy}>{exceptionBusy ? '保存中…' : '休業日を保存'}</Button>
                            <Button onClick={() => { setEditingExceptionId(null); setExceptionError(null) }} disabled={exceptionBusy}>やめる</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-ink font-semibold tabular-nums">{shortDate(from)}{from !== to ? `〜${shortDate(to)}` : ''}</p>
                          <p className="text-ink-secondary mt-1 text-sm">{item.reason || item.note || '休業日'}</p>
                          {canEditSettings ? (
                            <div className="mt-2 flex gap-3 text-xs">
                              <button type="button" className="text-action font-semibold underline" onClick={() => startEditException(item)}>修正する</button>
                              <button type="button" className="text-danger font-semibold underline" onClick={() => { setDeleteTarget(item); setExceptionError(null) }}>削除する</button>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            <section id="rules" data-design="Rules" className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink font-semibold">予約のルール</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['何日先まで取れるか', settings.bookingWindowDays, '日'],
                  ['何時間前まで取れるか', settings.cutoffMinutesBefore / 60, '時間'],
                  ['何時間前まで取り消せるか', settings.cancelDeadlineMinutesBefore / 60, '時間'],
                  ['同じ人が同時に持てる予約', settings.maxActiveBookingsPerFriend, '件まで'],
                ].map(([label, value, unit]) => (
                  <div key={label} className="border-hairline rounded-control border p-2.5">
                    <p className="text-ink-secondary text-xs font-medium">{label}</p>
                    <p className="text-ink mt-1 text-sm font-semibold tabular-nums">{value} <span className="text-ink-faint text-xs font-normal">{unit}</span></p>
                  </div>
                ))}
              </div>
            </section>

            <SlotCheckCard key={`check:${selectedAccountId}`} accountId={selectedAccountId} menus={menus} />
          </div>

          <aside className="space-y-3 xl:w-96 xl:flex-none">
            <section data-design="Preview" className="bg-canvas border-hairline rounded-card border p-4">
              <LiffDateTimePreview
                status={preview.status}
                slots={preview.slots}
                menuName={previewMenuName}
                staffName={preview.staffName}
              />
            </section>

            <details className="bg-canvas border-hairline rounded-card border p-3">
              <summary className="text-action cursor-pointer text-sm font-semibold">設備ごとの受付上限を管理</summary>
              <div className="mt-3 space-y-3 text-sm">
                {canManageResources ? <NewResourceEditor key={`new:${selectedAccountId}`} accountId={selectedAccountId} onCreated={(created) => {
                  if (activeAccountRef.current === selectedAccountId) setResources((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name, 'ja')))
                }} /> : null}
                {resources.length === 0 ? <p className="text-ink-faint">設備は登録されていません</p> : resources.map((resource) => (
                  <ResourceEditor
                    key={`${selectedAccountId}:${resource.id}:${resource.version}`}
                    accountId={selectedAccountId}
                    resource={resource}
                    canManage={canManageResources}
                    onSaved={(saved) => {
                      if (activeAccountRef.current === selectedAccountId) setResources((current) => current.map((item) => item.id === saved.id ? { ...item, ...saved, usage: item.usage } : item))
                    }}
                    onDeleted={(id) => {
                      if (activeAccountRef.current === selectedAccountId) setResources((current) => current.filter((item) => item.id !== id))
                    }}
                  />
                ))}
              </div>
            </details>

            <section data-design="Trouble" className="bg-warning-bg text-warning rounded-card p-4">
              <h2 className="font-semibold">よくある困りごと</h2>
              <dl className="mt-3 space-y-3 text-xs leading-5">
                <div>
                  <dt className="font-semibold">閉めている曜日</dt>
                  <dd>{!settings.businessHoursConfigured
                    ? '営業時間はまだ未設定です'
                    : closedWeekdays.length > 0 ? closedWeekdays.join('・') : 'ありません'}</dd>
                </div>
                <div>
                  <dt className="font-semibold">直前の予約が多くて準備できない</dt>
                  <dd>「何時間前まで取れるか」を長くすると減ります。</dd>
                </div>
              </dl>
            </section>

            <section data-design="Links" className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink font-semibold">つながる先</h2>
              <div className="mt-3 space-y-3 text-sm">
                <Link href="/booking/bookings" className="text-action flex justify-between gap-3"><span>→ 予約管理</span><span className="text-ink-faint text-xs">入った予約の台帳</span></Link>
                <Link href="/rich-menus" className="text-action flex justify-between gap-3"><span>→ リッチメニュー</span><span className="text-ink-faint text-xs">予約ボタンの飛び先</span></Link>
                <Link href="/reminders" className="text-action flex justify-between gap-3"><span>→ リマインダ</span><span className="text-ink-faint text-xs">前日・当日のお知らせ</span></Link>
                <Link href="/users" className="text-action flex justify-between gap-3"><span>→ ログインユーザー</span><span className="text-ink-faint text-xs">担当できる人</span></Link>
              </div>
            </section>
          </aside>
        </div>
      )}
      {/* #953 E-09: 休業日の削除は元に戻せないため、確認を1枚挟む。 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="この休業日を消しますか？"
        description="消すと、その期間は曜日の決めごとどおりの受付に戻ります。すでに入っている予約はそのまま残ります。"
        confirmLabel="休業日を消す"
        destructive
        busy={exceptionBusy}
        error={exceptionError ?? undefined}
        onCancel={() => {
          if (exceptionBusy) return
          setDeleteTarget(null)
          setExceptionError(null)
        }}
        onConfirm={() => void removeException()}
      />
    </div>
  )
}
