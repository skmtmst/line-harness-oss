'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePageTitle } from '@/components/shell/page-chrome'
import StaffDetail from './staff-detail'
import StaffDetailV8, { OwnShiftEntryV8 } from './staff-detail-v8'
import { useAdminTheme } from '@/lib/use-admin-theme'
import LiffDateTimePreview, { type LiffPreviewStatus } from './liff-preview'
import {
  ApiError,
  bookingApi,
  type BookingAvailabilitySlot,
  type BookingException,
  type BookingMenu,
  type BookingResource,
  type BookingSettings,
  type BookingSlotCheckResult,
  type BookingStaff,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { canEditFeature, canViewFeature } from '@/lib/staff-capability'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import DateField from '@/components/shared/date-field'
import Notice from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'
import { TimeField } from '@/components/shared/date-time-field'
import ListState from '@/components/shared/list-state'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import Select from '@/components/shared/select'
import { formatDay, formatRange } from '@/lib/format'

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
  /*
   * R161 監査：曜日・時間を変えたまま別画面へ移ると、確認なく入力が
   * 消える。保存済みの設定との差を未保存とし、離れる操作では確認を出す。
   * 保存の成功後は設定が届き直して draft が戻るため、確認は出ない。
   */
  const businessHoursDirty = JSON.stringify(draft) !== JSON.stringify(initialBusinessHours(settings))
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: businessHoursDirty, busy: saving })
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
      notifyToast('営業時間を保存しました。')
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
          <Notice tone="warn" message="まだ週全体の営業時間を保存していません。入力済みの時間帯は適用されていますが、時間帯がない曜日は現在は担当者の勤務時間どおりに受け付けます。保存すると、その曜日は休業になります。" className="mt-3" />
        ) : null}
      </div>
      <fieldset disabled={!canEdit} className="contents">
      <div className="divide-hairline divide-y">
        {DAYS.map((day) => {
          const intervals = draft.find((item) => item.weekday === day.weekday)?.intervals ?? []
          const accepts = intervals.length > 0
          return (
            <div className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-6" key={day.weekday}>
              <Checkbox
                checked={accepts}
                onCheckedChange={(checked) => setAccepts(day.weekday, checked)}
                aria-label={`${day.label}を受け付ける`}
                className="font-semibold whitespace-nowrap lg:col-span-1"
              >{day.label}</Checkbox>
              {!accepts ? (
                <p className="text-ink-faint lg:col-span-5">{settings.businessHoursConfigured ? '休み（定休日）' : '未設定（現在は担当者の勤務時間どおり）'}</p>
              ) : (
                <div className="space-y-2 lg:col-span-5">
                  {intervals.map((interval, index) => (
                    <div className="flex flex-wrap items-end gap-2" key={`${day.weekday}-${index}`}>
                      <span className="text-ink-secondary text-xs">
                        開始
                        <TimeField aria-label={`${day.label} ${index + 1}件目の開始`} value={interval.start} onChange={(v) => updateInterval(day.weekday, index, { start: v })} className="mt-1" />
                      </span>
                      <span className="pb-2 text-xs">〜</span>
                      <span className="text-ink-secondary text-xs">
                        終了
                        <TimeField aria-label={`${day.label} ${index + 1}件目の終了`} value={interval.end} onChange={(v) => updateInterval(day.weekday, index, { end: v })} className="mt-1" />
                      </span>
                      <label className="text-ink-secondary text-xs">
                        同時受付数
                        <input aria-label={`${day.label} ${index + 1}件目の同時受付数`} type="number" min={1} max={1000} value={interval.capacity ?? 1} onChange={(event) => updateInterval(day.weekday, index, { capacity: Number(event.target.value) })} className="border-hairline rounded-control mt-1 block w-24 border bg-canvas px-2 py-1.5 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
                      </label>
                      <button type="button" className="text-danger mb-1.5 px-2 py-1 text-xs underline" onClick={() => updateDay(day.weekday, (current) => current.filter((_, currentIndex) => currentIndex !== index))}>この時間を削除する</button>
                    </div>
                  ))}
                  {intervals.length < 8 ? (
                    <button type="button" className="text-action text-xs font-semibold underline" onClick={() => updateDay(day.weekday, (current) => [...current, { start: '09:00', end: '18:00', capacity: 1 }])}>時間帯を追加する</button>
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
          <Notice
            tone="danger"
            message={saveError}
            onClose={() => setSaveError(null)}
            className="mt-3"
            action={saveError.includes('先に保存') ? <button type="button" onClick={onReload} className="font-semibold underline">最新の内容を読み直す</button> : undefined}
          />
        ) : null}
        {canEdit ? (
          <div className="mt-3 flex justify-end">
            <Button variant="primary" onClick={() => void submit()} disabled={saving} busy={saving}>営業時間を保存する</Button>
          </div>
        ) : <p className="text-ink-faint mt-3 text-xs">閲覧のみです。変更には予約設定の権限が必要です。</p>}
      </div>
      </fieldset>
      {/* R161 監査：営業時間の書きかけがある間の離脱確認。 */}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="営業時間への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
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
  const theme = useAdminTheme()
  const [isStaffRole] = useState(() =>
    typeof window !== 'undefined' && window.localStorage.getItem('lh_staff_role') === 'staff')
  usePageTitle('予約設定')
  if (theme === 'v8') {
    // ★V8：板 d5fmnM（管理者）・E3YDK（本人）・wvGke（ひも付けなし）。
    // 管理者が staff_id 無しで来たときは「受付枠」タブ（いつもの店の時間）へ送る。
    if (staffId) return <StaffDetailV8 staffId={staffId} />
    if (isStaffRole) return <OwnShiftEntryV8 />
    return <StoreShiftsRedirectV8 />
  }
  if (staffId) return <StaffDetail staffId={staffId} />
  if (isStaffRole) return <OwnShiftEntry />
  return <StoreShiftsView />
}

/** ★V8 では店舗の受付枠は予約設定の「受付枠」タブが同じ中身。 */
function StoreShiftsRedirectV8() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/booking/menus?tab=hours')
  }, [router])
  return null
}

// 自分に紐づく予約スタッフを /staff/me で解決し、自分の勤務画面へ送る。
// 紐づけが無い場合: 店舗の受付枠を見られる権限があれば従来どおり店舗ビュー、
// なければ「紐づけ待ち」の案内を出す（真っ白な403画面にしない）。
// R579: 2経路とも通信失敗したら「紐づけ無し」と断定しない。同画面での
// 再試行の口を出し、復旧後は本人勤務へ進める。
function OwnShiftEntry() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [resolved, setResolved] = useState<'loading' | 'store' | 'missing' | 'error'>('loading')
  const [loadError, setLoadError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // 選択中アカウント優先。見つからなければ紐づく全件の先頭を使う。
      // どちらか一方が成功すれば「取得できた」扱い。両方失敗のときだけ
      // 通信失敗として、空（紐づけ無し）とは別の案内にする。
      let firstError: unknown = null
      const scoped = selectedAccountId
        ? await bookingApi.listMyStaff(selectedAccountId).catch((error: unknown) => {
          firstError = error
          return null
        })
        : null
      const rows = scoped?.staff?.length
        ? scoped.staff
        : await bookingApi.listMyStaff().catch((error: unknown) => {
          // 選択中の取得が成功済み（空）なら、全体の失敗は通信失敗にしない。
          if (!scoped) firstError = error
          return null
        }).then((res) => res?.staff ?? [])
      if (cancelled) return
      if (rows.length > 0) {
        router.replace(`/booking/staff/shifts?staff_id=${rows[0].id}`)
        return
      }
      if (firstError !== null) {
        setLoadError(firstError)
        setResolved('error')
        return
      }
      const canSeeStore = canViewFeature('/booking/bookings')
        || canViewFeature('booking.settings')
        || canViewFeature('/booking/menus')
      setResolved(canSeeStore ? 'store' : 'missing')
    })()
    return () => { cancelled = true }
  }, [router, selectedAccountId, attempt])

  function retry() {
    setLoadError(null)
    setResolved('loading')
    setAttempt((value) => value + 1)
  }

  if (resolved === 'store') return <StoreShiftsView />
  if (resolved === 'error') {
    return (
      <div className="space-y-4 pb-8">
        <ListState
          kind="error"
          title="自分の勤務を読み込めませんでした"
          // m23m: 403・429は共通の1枚（権限の案内・待ち案内）へ切り替える。
          // それ以外は画面の文のまま。紐づけが無いとは限らないので断定しない。
          description={isForbiddenOrRateLimited(loadError) ? undefined : '通信の不具合などで担当者の情報を読み込めませんでした。紐づけが無いとは限りません。「もう一度読み込む」を押してください。'}
          error={loadError ?? undefined}
          onRetry={retry}
        />
      </div>
    )
  }
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
  const [deleting, setDeleting] = useState(false)
  /* R313: 削除は確認窓を挟む。確定するまで送らない。 */
  const [confirmDelete, setConfirmDelete] = useState(false)
  /*
   * R312: 停止・再開で書きかけがあるときの破棄確認。
   * 保存後は版が上がって窓が作り直され、下書きは消える。黙って消さず、
   * 破棄するか編集に戻るかを利用者に選ばせる。
   */
  const [confirmStop, setConfirmStop] = useState(false)
  /*
   * R161 監査：設備名などを変えたまま別画面へ移ると、確認なく入力が
   * 消える。読み込んだ設備との差を未保存とし、離れる操作では確認を出す。
   */
  const resourceDirty = name !== resource.name || type !== resource.type || capacity !== String(resource.capacity)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: resourceDirty, busy: saving })
  const [error, setError] = useState<string | null>(null)
  const activeRef = useRef(true)
  const inFlightRef = useRef(false)
  useEffect(() => () => { activeRef.current = false }, [])

  async function update() {
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
        isActive: resource.isActive,
      })
      if (activeRef.current) onSaved(response.data)
    } catch (cause) {
      if (activeRef.current) setError(resourceSaveError(cause))
    } finally {
      inFlightRef.current = false
      if (activeRef.current) setSaving(false)
    }
  }

  /*
   * R312: 受付の停止・再開は状態だけ変える。編集中の名前・種類・上限は
   * 送らない（Worker が保存済みの値で補う部分更新）。下書きが不正でも
   * 停止は進み、入力はそのまま残す。
   */
  async function setActive(nextActive: boolean) {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setSaving(true)
    setError(null)
    try {
      const response = await bookingApi.updateResource(accountId, resource.id, {
        expectedVersion: resource.version,
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
    setDeleting(true)
    setError(null)
    try {
      await bookingApi.deleteResource(accountId, resource.id, resource.version)
      if (activeRef.current) {
        setConfirmDelete(false)
        onDeleted(resource.id)
      }
    } catch (cause) {
      if (activeRef.current) setError(resourceSaveError(cause))
    } finally {
      inFlightRef.current = false
      if (activeRef.current) setDeleting(false)
    }
  }

  return (
    <div className="border-hairline rounded-control border p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-ink-secondary text-xs">設備名
          <input aria-label={`${resource.name}の設備名`} value={name} onChange={(event) => setName(event.target.value)} disabled={!canManage || saving} maxLength={100} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
        </label>
        <label className="text-ink-secondary text-xs">種類
          <input aria-label={`${resource.name}の種類`} value={type} onChange={(event) => setType(event.target.value)} disabled={!canManage || saving} maxLength={50} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
        </label>
        <label className="text-ink-secondary text-xs">受付上限
          <input aria-label={`${resource.name}の受付上限`} type="number" min={1} max={1000} value={capacity} onChange={(event) => setCapacity(event.target.value)} disabled={!canManage || saving} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
        </label>
      </div>
      <p className="text-ink-faint mt-2 text-xs">
        メニュー {resource.usage?.menuCount ?? '—'}件 ／ 予約 {resource.usage?.bookingCount ?? '—'}件 ／ 例外日 {resource.usage?.exceptionCount ?? '—'}件
      </p>
      {error ? <p className="text-danger mt-2 text-xs" role="alert">{error}</p> : null}
      {canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void update()} disabled={saving || deleting} busy={saving}>設備を保存する</Button>
          <Button onClick={() => {
            if (resourceDirty) { setError(null); setConfirmStop(true); return }
            void setActive(!resource.isActive)
          }} disabled={saving || deleting} busy={saving}>{resource.isActive ? '受付を停止' : '受付を再開'}</Button>
          {!resource.usage?.referenced ? <Button onClick={() => { setError(null); setConfirmDelete(true) }} disabled={saving || deleting}>設備を削除する</Button> : null}
        </div>
      ) : <p className="text-ink-faint mt-2 text-xs">閲覧のみです。変更はオーナーまたは管理者が行えます。</p>}
      <ConfirmDialog
        open={confirmStop}
        title={`編集中の変更を破棄して${resource.isActive ? '停止' : '再開'}しますか？`}
        description="名前・種類・上限の編集中の内容は保存されません。受付の状態だけ変わります。"
        confirmLabel={resource.isActive ? '破棄して停止' : '破棄して再開'}
        cancelLabel="編集に戻る"
        primaryAction="cancel"
        busy={saving}
        onCancel={() => { if (!saving) setConfirmStop(false) }}
        onConfirm={() => { setConfirmStop(false); void setActive(!resource.isActive) }}
      />
      {/* R161 監査：設備の書きかけがある間の離脱確認。 */}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="設備への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
      {/*
       * R313: 削除は共通の確認窓を挟む。消さずに受付だけ止める道も添える。
       * 休業日の削除（#953 E-09）と同じ形。
       */}
      <ConfirmDialog
        open={confirmDelete}
        title={`「${resource.name}」を削除しますか？`}
        description="削除すると元に戻せません。受付だけ止めたいときは「受付を停止」を使ってください。"
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        destructive
        busy={deleting}
        onCancel={() => { if (!deleting) setConfirmDelete(false) }}
        onConfirm={() => void remove()}
      />
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
  // R161 監査：設備の追加欄に入力が残ったまま別画面へ移ると、確認なく
  // 消える。何か入っている間は未保存とし、離れる操作では確認を出す。
  const newResourceDirty = name !== '' || type !== '' || capacity !== '1'
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: newResourceDirty, busy: saving })
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
          <input aria-label="新しい設備名" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} maxLength={100} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
        </label>
        <label className="text-ink-secondary text-xs">種類
          <input aria-label="新しい設備の種類" value={type} onChange={(event) => setType(event.target.value)} disabled={saving} maxLength={50} placeholder="例: 部屋・席・機器" className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
        </label>
        <label className="text-ink-secondary text-xs">受付上限
          <input aria-label="新しい設備の受付上限" type="number" min={1} max={1000} value={capacity} onChange={(event) => setCapacity(event.target.value)} disabled={saving} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
        </label>
      </div>
      {error ? <p className="text-danger mt-2 text-xs" role="alert">{error}</p> : null}
      <Button className="mt-3" variant="primary" onClick={() => void create()} disabled={saving} busy={saving} busyLabel="追加中…">設備を追加する</Button>
      {/* R161 監査：追加欄の書きかけがある間の離脱確認。 */}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した設備" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

/* 理由文は別ファイル（ページは default 以外を export できない）。 */
import { slotReasonLabel } from './slot-reason'

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
          <Select size="full"
            aria-label="確認するメニュー"
            value={menuId}
            onChange={(value) => { setMenuId(value); setResult(null) }}
            className="mt-1"
            options={[
              ...(activeMenus.length === 0 ? [{ value: '', label: '受付中のメニューがありません' }] : []),
              ...activeMenus.map((menu) => ({ value: menu.id, label: menu.name })),
            ]}
          />
        </label>
        <span className="text-ink-secondary text-xs">
          日付
          <DateField aria-label="確認する日付" value={date} onChange={(v) => { setDate(v); setResult(null) }} className="mt-1" />
        </span>
        <span className="text-ink-secondary text-xs">
          開始時刻
          <TimeField aria-label="確認する開始時刻" value={time} onChange={(v) => { setTime(v); setResult(null) }} className="mt-1" />
        </span>
        {staffOptions.length > 0 ? (
          <label className="text-ink-secondary text-xs">
            担当
            <Select size="full"
              aria-label="確認する担当"
              value={staffId}
              onChange={(value) => { setStaffId(value); setResult(null) }}
              className="mt-1"
              options={[
                { value: '', label: '指定しない（誰かが取れれば可）' },
                ...staffOptions.map((staff) => ({ value: staff.id, label: staff.display_name })),
              ]}
            />
          </label>
        ) : null}
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={() => void run()} disabled={!canRun} busy={checking} busyLabel="確認中…">この日時を確かめる</Button>
      </div>
      {checkError ? <p className="text-danger mt-3 text-sm" role="alert">{checkError}</p> : null}
      {result ? (
        result.bookable ? (
          <Notice tone="success" className="mt-3">
            <p className="font-semibold">この日時は予約を受けられます。</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {result.per_staff.filter((staff) => staff.bookable).map((staff) => (
                <li key={staff.staff_id}>{staff.display_name}: 残り {staff.remaining}/{staff.capacity}</li>
              ))}
            </ul>
          </Notice>
        ) : (
          <Notice tone="warn" className="mt-3">
            <p className="font-semibold">この日時は予約できません。</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {result.reasons.map((reason) => <li key={reason}>{slotReasonLabel(reason, result.slotGranularityMinutes)}</li>)}
            </ul>
            {result.per_staff.length > 1 ? (
              <ul className="mt-2 space-y-0.5 border-t border-current/20 pt-2 text-xs">
                {result.per_staff.map((staff) => (
                  <li key={staff.staff_id}>
                    {staff.display_name}: {staff.bookable
                      ? '予約できます'
                      : staff.reasons.map((reason) => slotReasonLabel(reason, result.slotGranularityMinutes)).join('、')}
                  </li>
                ))}
              </ul>
            ) : null}
          </Notice>
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
    closedDates: string[]
  }>({ status: 'loading', staffName: null, slots: [], closedDates: [] })
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
  /*
   * R161 監査：休業日の追加・修正欄に書きかけがあるまま別画面へ移ると、
   * 確認なく入力が消える。欄が出ていて何か入っている間は未保存とし、
   * 離れる操作では確認を出す。保存の成功後は欄が閉じるため確認は出ない。
   */
  const exceptionFormDirty = (addingClosed && (closedFrom !== '' || closedTo !== '' || closedReason !== ''))
    || editingExceptionId !== null
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: exceptionFormDirty, busy: savingClosed || exceptionBusy })

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
      setPreview({ status: 'ready', staffName: null, slots: [], closedDates: [] })
      setLoadStatus('ready')
      return
    }
    if (loadedAccountRef.current !== selectedAccountId) setLoadStatus('loading')
    setPreview({ status: 'loading', staffName: null, slots: [], closedDates: [] })
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
        setPreview({ status: 'ready', staffName: null, slots: [], closedDates: [] })
        return
      }
      try {
        // (b): 見本はお客様と同じ店舗ルールで判定する。付けないと締切前の
        // 枠まで出て、空き確認の判定と食い違う。
        const availability = await bookingApi.getAvailability(selectedAccountId, {
          menuId: menu.id,
          from: range.from,
          to: range.to,
          applyStoreRules: true,
        })
        if (requestId !== requestRef.current) return
        // LIFF は by_staff[0]（担当一覧の先頭）の枠だけを画面に出す。
        // 全担当を合算すると実際の画面に無い時刻が混ざるので、先頭だけ使う。
        const first = availability.by_staff[0]
        setPreview({
          status: 'ready',
          staffName: first?.display_name ?? null,
          slots: first?.slots ?? [],
          closedDates: availability.closed_dates ?? [],
        })
      } catch {
        if (requestId !== requestRef.current) return
        setPreview({ status: 'error', staffName: null, slots: [], closedDates: [] })
      }
    }).catch(() => {
      if (requestId !== requestRef.current) return
      setSettings(null)
      setMenus([])
      setResources([])
      setPreview({ status: 'ready', staffName: null, slots: [], closedDates: [] })
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
        <Link href="/booking/menus" className="text-ink-faint rounded-t-mini px-4 py-2 text-sm hover:text-ink-secondary">メニュー {settings?.menuCount ?? '—'}</Link>
        <span className="border-accent text-ink rounded-t-mini border-b-2 px-4 py-2 text-sm font-medium">受付枠</span>
        <a href="#special" className="text-ink-faint rounded-t-mini px-4 py-2 text-sm hover:text-ink-secondary">休業日</a>
        <a href="#rules" className="text-ink-faint rounded-t-mini px-4 py-2 text-sm hover:text-ink-secondary">予約のルール</a>
      </div>

      <Notice data-design="Info" tone="info" message="何時から何時まで、どの曜日を受けるかです。右に、お客様のLINEに出る日時の選び方がそのまま出ます。" />

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
                  <span className="text-ink-secondary text-xs">
                    開始日
                    <DateField aria-label="休業の開始日" value={closedFrom} onChange={setClosedFrom} className="mt-1" />
                  </span>
                  <span className="text-ink-secondary text-xs">
                    終了日
                    <DateField aria-label="休業の終了日" value={closedTo} onChange={setClosedTo} className="mt-1" />
                  </span>
                  <label className="text-ink-secondary text-xs">
                    理由
                    <input aria-label="休業の理由" value={closedReason} onChange={(event) => setClosedReason(event.target.value)} placeholder="例: お盆" className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
                  </label>
                  {saveError ? <p className="text-danger text-xs sm:col-span-2">{saveError}</p> : <span className="sm:col-span-2" />}
                  <Button variant="primary" onClick={() => void saveClosedDay()} disabled={savingClosed} busy={savingClosed}>休業日を保存する</Button>
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
                          <span className="text-ink-secondary block text-xs">
                            開始日
                            <DateField aria-label="休業日の開始日" value={editFrom} onChange={setEditFrom} disabled={exceptionBusy} className="mt-1" />
                          </span>
                          <span className="text-ink-secondary block text-xs">
                            終了日
                            <DateField aria-label="休業日の終了日" value={editTo} onChange={setEditTo} disabled={exceptionBusy} className="mt-1" />
                          </span>
                          <label className="text-ink-secondary block text-xs">
                            理由
                            <input aria-label="休業日の理由" value={editReason} onChange={(event) => setEditReason(event.target.value)} disabled={exceptionBusy} placeholder="例: お盆" className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
                          </label>
                          {exceptionError ? <p className="text-danger text-xs" role="alert">{exceptionError}</p> : null}
                          <div className="flex flex-wrap gap-2">
                            <Button variant="primary" onClick={() => void saveExceptionEdit(item)} disabled={exceptionBusy} busy={exceptionBusy}>休業日を保存する</Button>
                            <Button onClick={() => { setEditingExceptionId(null); setExceptionError(null) }} disabled={exceptionBusy}>キャンセル</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-ink font-semibold tabular-nums">{from !== to ? formatRange(from, to) : formatDay(from)}</p>
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
                initialView={settings.liffDateView ?? 'list'}
                closedDates={preview.closedDates}
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
                <Link href="/booking/staff" className="text-action flex justify-between gap-3"><span>→ 予約の担当者</span><span className="text-ink-faint text-xs">担当できる人の追加と削除</span></Link>
                <Link href="/staff" className="text-action flex justify-between gap-3"><span>→ ログインユーザー</span><span className="text-ink-faint text-xs">ログイン権限の管理</span></Link>
              </div>
            </section>
          </aside>
        </div>
      )}
      {/* #953 E-09: 休業日の削除は元に戻せないため、確認を1枚挟む。 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="この休業日を消しますか？"
        description="削除すると、その期間は曜日の決めごとどおりの受付に戻ります。すでに入っている予約はそのまま残ります。"
        confirmLabel="休業日を削除する"
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
      {/* R161 監査：休業日の書きかけがある間の離脱確認。 */}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="休業日への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
