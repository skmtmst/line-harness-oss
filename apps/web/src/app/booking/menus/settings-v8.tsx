'use client'

/*
 * V8 予約設定（Pencil 板: owaS3 / P6EdLW / yRPxl / KRgTQ / x1OZS6 / VLEaj / xCoDe）。
 *
 * 白い1枚の板。頭に「← 予約へ」・題名・5タブ、左に設定、右にお客さまの
 * LINE 予約画面（LIFF）の写し、書きかけがある間だけ下に保存帯を出す。
 *
 * 動き（版つき保存・409 での読み直し・権限での閲覧のみ化・未保存の離脱
 * 確認）は v7 の /booking/menus と /booking/staff/shifts と同じ。
 * テーマが v7 のときはこのファイルは読まれず、従来の見た目が出る。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import DateField from '@/components/shared/date-field'
import { TimeField } from '@/components/shared/date-time-field'
import Toggle from '@/components/shared/toggle'
import { Tabs } from '@/components/shared/tabs'
import { DragHandle, MoreAction } from '@/components/shared/row-actions'
import Pagination from '@/components/shared/pagination'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import ListRange from '@/components/ui/list-range'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { notifyToast } from '@/components/shared/toast'
import { useAccount } from '@/contexts/account-context'
import { canEditFeature } from '@/lib/staff-capability'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import {
  api,
  ApiError,
  bookingApi,
  fetchApi,
  type BookingAvailabilitySlot,
  type BookingException,
  type BookingMenu,
  type BookingResource,
  type BookingSettings,
  type BookingSlotCheckResult,
  type BookingStaff,
  type StaffMenuMatrix,
} from '@/lib/api'
import type { StaffMember } from '@line-crm/shared'
import { formatHoursBeforeHint, formatMinutesLengthHint } from '@/lib/format-duration'
import { formatDateTime, formatNumber } from '@/lib/format'
import { bookingWindowEnd, minutesBeforeLabel } from '../lib/format-time'
import { menuPriceLabel } from '../lib/menu-price'
import { fetchAllPages } from '../bookings/fetch-all-pages'
import { slotReasonLabel } from '../staff/shifts/slot-reason'
import { bookingErrorMessage, bookingRulesErrorMessage } from './menu-validation'

import ChannelsTabV8 from './channels-tab-v8'
import MenuVersionHistory from './menu-version-history'
import { EMPTY_STAFF, StaffEditModal } from '../staff/staff-edit-dialog'
import { LiffPhoneDatetimeStep, LiffPhoneMenuStep, LiffPhoneStaffStep } from './liff-phone-v8'
import styles from './settings-v8.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'

const V8_TABS = [
  { key: 'menus', label: 'メニュー', node: 'owaS3' },
  { key: 'hours', label: '受付枠', node: 'yRPxl' },
  { key: 'holidays', label: '休業日', node: 'KRgTQ' },
  { key: 'rules', label: '予約のルール', node: 'x1OZS6' },
  { key: 'staff', label: '担当スタッフ', node: 'VLEaj' },
  { key: 'channels', label: '予約経路', node: 'ZyDd6' },
] as const
type V8TabKey = (typeof V8_TABS)[number]['key']
const V8_TAB_KEYS = new Set<string>(V8_TABS.map((tab) => tab.key))
const V8_TAB_NODE: Record<V8TabKey, string> = {
  menus: 'owaS3',
  hours: 'yRPxl',
  holidays: 'KRgTQ',
  rules: 'x1OZS6',
  staff: 'VLEaj',
  channels: 'ZyDd6',
}

const MENU_PAGE_SIZE = 6

const DAYS = [
  { weekday: 1, label: '月曜日' },
  { weekday: 2, label: '火曜日' },
  { weekday: 3, label: '水曜日' },
  { weekday: 4, label: '木曜日' },
  { weekday: 5, label: '金曜日' },
  { weekday: 6, label: '土曜日' },
  { weekday: 0, label: '日曜日' },
] as const
const WEEKDAY_JP = '日月火水木金土'

const JST_OFFSET_MS = 9 * 3600_000

// LIFF の日時選択（apps/liff DateTimePicker）と同じく JST の今日から14日分。
function previewRange(): { from: string; to: string } {
  const from = new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10)
  const end = new Date(`${from}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 13)
  return { from, to: end.toISOString().slice(0, 10) }
}

/** `YYYY-MM-DD` に n 日足す。 */
function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function sortedMenus(menus: BookingMenu[]): BookingMenu[] {
  return [...menus].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
}

type BusinessHoursDay = BookingSettings['businessHours'][number]
type BusinessHourInterval = BusinessHoursDay['intervals'][number]

function initialBusinessHours(settings: BookingSettings): BusinessHoursDay[] {
  return DAYS.map(({ weekday }) => ({
    weekday,
    intervals: (settings.businessHours.find((day) => day.weekday === weekday)?.intervals ?? [])
      .map((interval) => ({ ...interval, capacity: interval.capacity ?? 1 })),
  }))
}

// v7 /booking/staff/shifts の BusinessHoursEditor と同じ検査。
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

function exceptionFailureMessage(error: unknown, action: '保存' | '削除'): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'ほかの担当者が先にこの休業日を変更しました。読み直してからもう一度お試しください。'
  }
  return action === '削除'
    ? '休業日を消せませんでした。もう一度お試しください。'
    : '休業日を保存できませんでした。入力内容を確かめて、もう一度お試しください。'
}

function resourceSaveError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'ほかの担当者が先にこの設備を変更しました。読み直してからもう一度お試しください。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '設備を変更する権限がありません。'
  }
  return '設備を保存できませんでした。入力内容を確かめて、もう一度お試しください。'
}

/* ==================== タブの「書きかけ」をシェルへ渡す ==================== */

type V8TabEdit = {
  dirty: boolean
  saving: boolean
  /** 離脱確認の題名（「○○への変更」）。 */
  subject: string
  saveLabel?: string
  saveDisabled?: boolean
  /** false のとき保存帯は出さず、離脱確認だけ使う（休業日の窓など）。 */
  showBar?: boolean
  onSave: () => void
  onReset: () => void
}

const V8TabEditContext = createContext<(next: V8TabEdit | null) => void>(() => {})

/**
 * タブ内の書きかけ状態をシェルへ登録する。dirty / saving / subject の
 * 変わったときだけ登録し直すので、描画ごとの更新でループしない。
 */
function useV8TabEdit(input: V8TabEdit) {
  const register = useContext(V8TabEditContext)
  const ref = useRef(input)
  ref.current = input
  const { dirty, saving, subject, saveDisabled, showBar } = input
  useEffect(() => {
    register({
      dirty,
      saving,
      subject,
      saveLabel: ref.current.saveLabel,
      saveDisabled,
      showBar: showBar ?? true,
      onSave: () => ref.current.onSave(),
      onReset: () => ref.current.onReset(),
    })
    return () => register(null)
  }, [register, dirty, saving, subject, saveDisabled, showBar])
}

/* ==================== 小さな部品 ==================== */

function Band({ tone, children }: { tone: 'hint' | 'warn'; children: ReactNode }) {
  return (
    <p className={tone === 'warn' ? styles.warnBand : styles.hintBand}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="7" cy="7" r="5.6" />
        <path d="M7 6.2v3" strokeLinecap="round" />
        <circle cx="7" cy="4.1" r="0.9" fill="currentColor" stroke="none" />
      </svg>
      <span>{children}</span>
    </p>
  )
}

function StateCard({ icon, title, description, action }: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className={styles.stateCard} data-design-node="xCoDe">
      <span className={styles.stateIcon} aria-hidden="true">{icon}</span>
      <p className={styles.stateTitle}>{title}</p>
      <p className={styles.stateDesc}>{description}</p>
      {action ? <div className={styles.stateActions}>{action}</div> : null}
    </div>
  )
}

function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className={styles.skeletonRows} aria-label="読み込み中" role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <span className={styles.skeletonDot} />
          <span className={styles.skeletonBar} />
          <span className={`${styles.skeletonBar} ${styles.skeletonBarShort}`} />
        </div>
      ))}
    </div>
  )
}

/* ==================== 板（シェル） ==================== */

export default function BookingSettingsV8({ accountId }: { accountId: string | null }) {
  usePageTitle('予約設定')
  usePageCrumbs([{ label: '予約', href: '/booking/bookings' }, { label: '予約設定' }])
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab: V8TabKey = V8_TAB_KEYS.has(rawTab ?? '') ? (rawTab as V8TabKey) : 'menus'
  const tabRef = useRef(tab)
  tabRef.current = tab

  const { selectedAccount } = useAccount()
  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const previewUrl = selectedAccount?.liffId
    ? `${workerBase}/o?liffId=${encodeURIComponent(selectedAccount.liffId)}&page=salon-book`
    : null

  const canEditMenus = canEditFeature('/booking/menus')
  const canEditSettings = canEditFeature('booking.settings')
  /*
   * 狭い幅（1152）の板はメニューが `P6EdLW`・受付枠が `VFxWU`。
   * 畳み込み自体は入れ物の問い合わせが担い、ここでは板 ID だけを替える。
   */
  const narrow = useNarrowViewport()
  const tabNode = narrow && tab === 'menus' ? 'P6EdLW' : narrow && tab === 'hours' ? 'VFxWU' : V8_TAB_NODE[tab]

  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [menusStatus, setMenusStatus] = useState<LoadStatus>('loading')
  const [menusError, setMenusError] = useState<string | null>(null)
  const [settings, setSettings] = useState<BookingSettings | null>(null)
  const [settingsStatus, setSettingsStatus] = useState<LoadStatus>('loading')
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [staff, setStaff] = useState<BookingStaff[]>([])
  const [staffStatus, setStaffStatus] = useState<LoadStatus>('loading')
  const [staffError, setStaffError] = useState<string | null>(null)
  const [staffMatrices, setStaffMatrices] = useState<Record<string, StaffMenuMatrix[]>>({})
  const [staffExtras, setStaffExtras] = useState<Record<string, { work: string | null; calendar: 'loading' | 'connected' | 'none' | 'error' }>>({})
  /** 板 VFxWU（1152）：畳んだスマホの代わりに開く見え方窓。 */
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [members, setMembers] = useState<StaffMember[]>([])
  const [resources, setResources] = useState<BookingResource[] | null>(null)
  const [resourcesStatus, setResourcesStatus] = useState<LoadStatus>('loading')
  const [resourcesError, setResourcesError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    status: LoadStatus
    slots: BookingAvailabilitySlot[]
    closedDates: string[]
    staffName: string | null
  }>({ status: 'loading', slots: [], closedDates: [], staffName: null })
  const [closedBookingCount, setClosedBookingCount] = useState<number | null>(null)

  const generationRef = useRef(0)

  /* ---- 基本データ（メニュー・設定・スタッフ） ---- */
  const loadCore = useCallback(async () => {
    if (!accountId) {
      setMenusStatus('ready')
      setSettingsStatus('ready')
      setStaffStatus('ready')
      return
    }
    const generation = ++generationRef.current
    const alive = () => generationRef.current === generation
    setMenusStatus('loading')
    setSettingsStatus('loading')
    setStaffStatus('loading')
    setMenusError(null)
    setSettingsError(null)
    setStaffError(null)
    setStaffMatrices({})
    setStaffExtras({})
    setResources(null)
    setClosedBookingCount(null)
    setPreview((current) => ({ ...current, status: 'loading' }))

    const [menusResult, settingsResult, staffResult] = await Promise.allSettled([
      bookingApi.listMenus(accountId),
      bookingApi.getSettings(accountId),
      bookingApi.listStaff(accountId),
    ])
    if (!alive()) return
    if (menusResult.status === 'fulfilled') {
      setMenus(menusResult.value.menus)
      setMenusStatus('ready')
    } else {
      setMenusStatus('error')
      setMenusError(bookingErrorMessage(menusResult.reason, '読み込み'))
    }
    if (settingsResult.status === 'fulfilled' && settingsResult.value.success) {
      setSettings(settingsResult.value.data)
      setSettingsStatus('ready')
    } else {
      setSettingsStatus('error')
      setSettingsError(bookingRulesErrorMessage(
        settingsResult.status === 'rejected' ? settingsResult.reason : null,
        '読み込み',
      ))
    }
    if (staffResult.status === 'fulfilled') {
      setStaff(staffResult.value.staff)
      setStaffStatus('ready')
    } else {
      setStaffStatus('error')
      setStaffError(bookingErrorMessage(staffResult.reason, '読み込み'))
    }
  }, [accountId])

  useEffect(() => {
    void loadCore()
  }, [loadCore])

  /* ---- 右の写し（LIFF）用の空き枠。日時に関係するタブでのみ取る。 ---- */
  const firstActiveMenu = sortedMenus(menus).find((menu) => menu.is_active) ?? null
  const needsPreview = tab === 'hours' || tab === 'holidays' || tab === 'rules'
  useEffect(() => {
    if (!needsPreview || !accountId || !firstActiveMenu) {
      setPreview((current) => ({ ...current, status: firstActiveMenu ? 'loading' : 'ready', slots: [], staffName: null }))
      return
    }
    let cancelled = false
    const range = previewRange()
    setPreview((current) => ({ ...current, status: 'loading' }))
    bookingApi
      .getAvailability(accountId, { menuId: firstActiveMenu.id, from: range.from, to: range.to })
      .then((response) => {
        if (cancelled) return
        setPreview({
          status: 'ready',
          slots: response.by_staff?.[0]?.slots ?? [],
          closedDates: response.closed_dates ?? [],
          staffName: response.by_staff?.[0]?.display_name ?? null,
        })
      })
      .catch(() => {
        if (!cancelled) setPreview({ status: 'error', slots: [], closedDates: [], staffName: null })
      })
    return () => { cancelled = true }
  }, [needsPreview, accountId, firstActiveMenu?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- 担当スタッフタブの行の中身（担当数・今週の勤務・カレンダー） ---- */
  useEffect(() => {
    if (tab !== 'staff' || !accountId || staff.length === 0) return
    let cancelled = false
    void bookingApi
      .listStaffMenusBulk(accountId)
      .then((res) => {
        if (cancelled) return
        const next: Record<string, StaffMenuMatrix[]> = {}
        for (const entry of res.staff) next[entry.staff_id] = entry.matrix
        setStaffMatrices(next)
      })
      .catch(() => {})
    const extrasInit: Record<string, { work: string | null; calendar: 'loading' }> = {}
    for (const person of staff) extrasInit[person.id] = { work: null, calendar: 'loading' }
    setStaffExtras(extrasInit)
    void Promise.all(
      staff.map(async (person) => {
        const [rulesResult, calendarResult] = await Promise.allSettled([
          bookingApi.getAvailabilityRules(accountId, person.id),
          bookingApi.getGoogleCalendar(accountId, person.id),
        ])
        if (cancelled) return
        let work: string | null = null
        if (rulesResult.status === 'fulfilled') {
          /* 0 だけ止まり扱い。モック等で is_active が付かない応答も開き扱いにする。 */
          const rules = rulesResult.value.rules.filter((rule) => rule.is_active !== 0)
          if (rules.length > 0) {
            const days = [...new Set(rules.map((rule) => rule.weekday))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
            const dayLabel = days.map((day) => WEEKDAY_JP[day]).join('')
            const start = rules.map((rule) => rule.start_time).sort()[0]
            const end = rules.map((rule) => rule.end_time).sort().at(-1)
            work = `${dayLabel}　${start}〜${end}`
          } else {
            work = '—'
          }
        } else {
          work = '取得失敗'
        }
        const calendar = calendarResult.status === 'fulfilled'
          ? (calendarResult.value.connection && calendarResult.value.connection.is_active ? 'connected' as const : 'none' as const)
          : 'error' as const
        setStaffExtras((current) => ({ ...current, [person.id]: { work, calendar } }))
      }),
    )
    void api.staff
      .list()
      .then((res) => { if (!cancelled && res.success) setMembers(res.data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [tab, accountId, staff])

  /* ---- 受付枠タブの設備一覧（開いたときだけ読む） ---- */
  useEffect(() => {
    if (tab !== 'hours' || !accountId || resources !== null) return
    let cancelled = false
    setResourcesStatus('loading')
    bookingApi
      .listResources(accountId)
      .then((res) => {
        if (cancelled) return
        setResources(res.data.resources)
        setResourcesStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setResourcesStatus('error')
        setResourcesError('設備を読み込めませんでした。')
      })
    return () => { cancelled = true }
  }, [tab, accountId, resources])

  /* ---- 休業日タブ: 休みにした日に入っている予約の件数 ---- */
  const storeExceptions = useMemo(
    () => (settings?.exceptions ?? []).filter((item) => !item.scopeKind || item.scopeKind === 'store'),
    [settings],
  )
  const closedDates = useMemo(() => {
    const dates = new Set<string>()
    for (const item of storeExceptions.filter((entry) => entry.kind === 'closed')) {
      const from = item.dateFrom || item.date || ''
      const to = item.dateTo || item.date || from
      if (!from) continue
      // 長い休みも日ごとに広げる（上限31日で暴走だけ止める）。
      for (let i = 0; i < 31; i += 1) {
        const day = addDaysStr(from, i)
        dates.add(day)
        if (day >= to) break
      }
    }
    return dates
  }, [storeExceptions])
  useEffect(() => {
    if (tab !== 'holidays' || !accountId || closedDates.size === 0) {
      setClosedBookingCount(null)
      return
    }
    let cancelled = false
    const sorted = [...closedDates].sort()
    const from = sorted[0]
    const to = sorted[sorted.length - 1]
    void fetchAllPages(
      (offset) => bookingApi.listRequests(accountId, 'all', { from, to, limit: 100, offset }),
      100,
      () => !cancelled,
    )
      .then((requests) => {
        if (cancelled || requests === null) return
        const count = requests.filter((request) => {
          if (request.status !== 'requested' && request.status !== 'confirmed') return false
          const jst = new Date(new Date(request.starts_at).getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
          return closedDates.has(jst)
        }).length
        setClosedBookingCount(count)
      })
      .catch(() => { if (!cancelled) setClosedBookingCount(null) })
    return () => { cancelled = true }
  }, [tab, accountId, closedDates])

  /* ---- 書きかけの登録と離脱確認 ---- */
  const [tabEdit, setTabEdit] = useState<V8TabEdit | null>(null)
  const registerTabEdit = useCallback((next: V8TabEdit | null) => {
    setTabEdit(next)
  }, [])
  const [switchTarget, setSwitchTarget] = useState<V8TabKey | null>(null)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty: Boolean(tabEdit?.dirty),
    busy: tabEdit?.saving,
    samePage: (destination) => {
      if (destination.pathname !== '/booking/menus') return false
      const next = destination.searchParams.get('tab') ?? 'menus'
      return next === tabRef.current
    },
    onDiscard: () => tabEdit?.onReset(),
  })

  function requestTab(next: V8TabKey) {
    if (next === tab) return
    if (tabEdit?.dirty) {
      setSwitchTarget(next)
      return
    }
    router.push(next === 'menus' ? '/booking/menus' : `/booking/menus?tab=${next}`)
  }
  function confirmSwitch() {
    const next = switchTarget
    setSwitchTarget(null)
    if (!next) return
    tabEdit?.onReset()
    router.push(next === 'menus' ? '/booking/menus' : `/booking/menus?tab=${next}`)
  }

  /* ---- 右の写し ---- */
  const closedWeekdays = useMemo(() => {
    if (!settings?.businessHoursConfigured) return []
    return DAYS.filter(({ weekday }) =>
      (settings.businessHours.find((day) => day.weekday === weekday)?.intervals.length ?? 0) === 0,
    ).map(({ weekday }) => weekday)
  }, [settings])
  const previewMenu = firstActiveMenu ?? menus[0] ?? null
  const designationFree = staff.some((person) => person.is_active && person.is_designation_optional)
  const phone = (() => {
    if (tab === 'menus') return <LiffPhoneMenuStep menus={menus} status={menusStatus} />
    if (tab === 'staff') {
      return <LiffPhoneStaffStep menu={previewMenu} staff={staff} designationFree={designationFree} status={staffStatus} />
    }
    return (
      <LiffPhoneDatetimeStep
        menu={previewMenu}
        staffName={preview.staffName}
        slots={preview.slots}
        closedDates={preview.closedDates}
        closedWeekdays={closedWeekdays}
        view={settings?.liffDateView ?? 'list'}
        status={preview.status}
      />
    )
  })()

  return (
    <V8TabEditContext.Provider value={registerTabEdit}>
      <div className={styles.shell} data-design-node="owaS3">
        <header className={styles.boardHead} data-design="Head">
          <Link href="/booking/bookings" className={styles.backLink}>← 予約へ</Link>
          <h1 className={styles.headTitle}>予約設定</h1>
          <p className={styles.headNote}>お客さまの予約画面に出るメニュー・時間・ルールを決めます</p>
          <div data-design="Tabs">
            <Tabs
              label="予約設定のタブ"
              items={V8_TABS.map((item) => ({
                label: item.label,
                current: item.key === tab,
                onClick: () => requestTab(item.key),
              }))}
            />
          </div>
        </header>

        <div className={styles.body} data-design="Body">
          <div className={styles.main} data-design-node={tab === 'menus' && !canEditMenus ? 'C9fv7A' : tabNode}>
            {!accountId ? (
              <StateCard
                icon={<AccountIcon />}
                title="LINEアカウントを選んでください"
                description="共通メニューで、予約設定を開くLINEアカウントを選んでください。"
              />
            ) : tab === 'menus' ? (
              <MenusTabV8
                accountId={accountId}
                menus={menus}
                status={menusStatus}
                error={menusError}
                menuCount={settings?.menuCount}
                canEdit={canEditMenus}
                onReload={() => void loadCore()}
              />
            ) : tab === 'hours' ? (
              <HoursTabV8
                accountId={accountId}
                settings={settings}
                settingsStatus={settingsStatus}
                settingsError={settingsError}
                resources={resources}
                resourcesStatus={resourcesStatus}
                resourcesError={resourcesError}
                canEdit={canEditSettings}
                menus={menus}
                onSaved={(next) => setSettings(next)}
                onReload={() => void loadCore()}
                onResourceSaved={(saved) => setResources((current) => current?.map((item) => item.id === saved.id ? { ...item, ...saved, usage: item.usage } : item) ?? current)}
                onResourceCreated={(created) => setResources((current) => [...(current ?? []), created].sort((a, b) => a.name.localeCompare(b.name, 'ja')))}
                onResourceDeleted={(id) => setResources((current) => current?.filter((item) => item.id !== id) ?? current)}
                onResourcesRetry={() => { setResources(null); setResourcesError(null) }}
              />
            ) : tab === 'holidays' ? (
              <HolidaysTabV8
                accountId={accountId}
                settings={settings}
                status={settingsStatus}
                error={settingsError}
                exceptions={storeExceptions}
                closedWeekdays={closedWeekdays}
                bookingCountOnClosed={closedBookingCount}
                canEdit={canEditSettings}
                onSaved={(next) => setSettings(next)}
                onReload={() => void loadCore()}
              />
            ) : tab === 'rules' ? (
              <RulesTabV8
                accountId={accountId}
                settings={settings}
                status={settingsStatus}
                error={settingsError}
                staff={staff}
                staffReady={staffStatus === 'ready'}
                canEdit={canEditSettings}
                onSaved={(next) => setSettings(next)}
                onReload={() => void loadCore()}
              />
            ) : tab === 'staff' ? (
              <StaffTabV8
                accountId={accountId}
                staff={staff}
                status={staffStatus}
                error={staffError}
                matrices={staffMatrices}
                extras={staffExtras}
                members={members}
                canEdit={canEditSettings}
                onReload={() => void loadCore()}
              />
            ) : (
              <ChannelsTabV8
                accountId={accountId}
                canEdit={canEditSettings}
              />
            )}
          </div>

          <aside className={styles.side} data-design="Side">
            <div className={styles.sideActions}>
              <span className={styles.sidePhoneButton}>
                <Button onClick={() => setPhoneOpen(true)}>LINEでの見え方を見る</Button>
              </span>
              {previewUrl ? <Button href={previewUrl}>お客さまに見える画面を確かめる</Button> : null}
            </div>
            <p className={styles.sideTitle}>お客さまの予約画面</p>
            <div className={styles.sidePhone}>{phone}</div>
            {previewUrl ? null : (
              <p className={styles.sideLineLink}>このアカウントには予約画面のURLがまだありません</p>
            )}
          </aside>
        </div>

        {tabEdit?.dirty && tabEdit.showBar !== false ? (
          <div className={styles.saveBar} data-design="Savebar">
            <span className={styles.saveBarStatus}>
              <span className={styles.saveBarStatusDot} aria-hidden="true" />
              {tabEdit.subject}があります
            </span>
            <Button onClick={() => tabEdit.onReset()} disabled={tabEdit.saving}>元に戻す</Button>
            <Button
              variant="primary"
              onClick={() => tabEdit.onSave()}
              disabled={tabEdit.saving || tabEdit.saveDisabled}
              busy={tabEdit.saving}
            >
              {tabEdit.saveLabel ?? '保存する'}
            </Button>
          </div>
        ) : null}
      </div>

      {/* タブをまたぐときの破棄確認（タブ内のデータは外れると消える）。 */}
      <ConfirmDialog
        open={switchTarget !== null}
        title={`${tabEdit?.subject ?? '変更'}を捨てて移りますか？`}
        description="保存していない変更は消えます。"
        confirmLabel="捨てて移る"
        cancelLabel="編集に戻る"
        primaryAction="cancel"
        onCancel={() => setSwitchTarget(null)}
        onConfirm={confirmSwitch}
      />
      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject={tabEdit?.subject ?? '変更'}
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
      {/* 板 VFxWU（1152）：畳んだスマホの代わりに見せる窓。実行ボタンなしの参照窓。 */}
      <Dialog
        open={phoneOpen}
        title="お客さまの予約画面"
        onCancel={() => setPhoneOpen(false)}
      >
        {phone}
      </Dialog>
    </V8TabEditContext.Provider>
  )
}

function AccountIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="4" width="16" height="14" rx="2" />
      <path d="M3 8h16" />
    </svg>
  )
}

/* ==================== ① メニュー（owaS3） ==================== */

function MenusTabV8({ accountId, menus, status, error, menuCount, canEdit, onReload }: {
  accountId: string
  menus: BookingMenu[]
  status: LoadStatus
  error: string | null
  menuCount: number | undefined
  canEdit: boolean
  onReload: () => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [historyTarget, setHistoryTarget] = useState<BookingMenu | null>(null)
  const [visibilityTarget, setVisibilityTarget] = useState<BookingMenu | null>(null)
  const [visibilityError, setVisibilityError] = useState<string | null>(null)
  const [updatingVisibility, setUpdatingVisibility] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [reorderBusy, setReorderBusy] = useState(false)
  const [reorderError, setReorderError] = useState<string | null>(null)

  const shown = useMemo(() => {
    const ordered = sortedMenus(menus)
    const keyword = query.trim()
    return keyword
      ? ordered.filter((menu) => menu.name.toLowerCase().includes(keyword.toLowerCase()))
      : ordered
  }, [menus, query])
  const pageCount = Math.max(1, Math.ceil(shown.length / MENU_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const visible = shown.slice((safePage - 1) * MENU_PAGE_SIZE, safePage * MENU_PAGE_SIZE)

  /* 中身の直しはメニュー作成ページ（?menu=<id>、node QqER7）に集約する。 */
  function openMenuForm(menu: BookingMenu) {
    router.push(`/booking/menus/new?menu=${menu.id}`)
  }

  /* 「…」の上へ・下へ。2件の sort_order を版つき updateMenu で交換する（v7 と同じ）。 */
  async function moveMenu(menu: BookingMenu, delta: -1 | 1) {
    if (reorderBusy) return
    const ordered = sortedMenus(menus)
    const index = ordered.findIndex((item) => item.id === menu.id)
    const nextIndex = index + delta
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return
    const other = ordered[nextIndex]
    const version = menu.version
    const otherVersion = other.version
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1
      || typeof otherVersion !== 'number' || !Number.isInteger(otherVersion) || otherVersion < 1) {
      onReload()
      setReorderError('最新の状態を読み直しました。もう一度お試しください。')
      return
    }
    setReorderBusy(true)
    setReorderError(null)
    try {
      await bookingApi.updateMenu(accountId, menu.id, version, { ...menu, sort_order: other.sort_order })
      await bookingApi.updateMenu(accountId, other.id, otherVersion, { ...other, sort_order: menu.sort_order })
      onReload()
    } catch (cause) {
      setReorderError(bookingErrorMessage(cause, '保存'))
    } finally {
      setReorderBusy(false)
    }
  }

  async function toggleVisibility(menu: BookingMenu) {
    setUpdatingVisibility(true)
    setVisibilityError(null)
    try {
      const version = menu.version
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        onReload()
        setVisibilityError('最新の状態を読み直しました。もう一度お試しください。')
        return
      }
      await bookingApi.patchMenu(accountId, menu.id, version, { is_active: !menu.is_active })
      setVisibilityTarget(null)
      onReload()
    } catch (cause) {
      setVisibilityError(bookingErrorMessage(cause, '保存'))
    } finally {
      setUpdatingVisibility(false)
    }
  }

  if (status === 'loading') return <SkeletonRows rows={5} />
  if (status === 'error') {
    return (
      <StateCard
        icon={<AccountIcon />}
        title="メニューを読み込めませんでした"
        description={error ?? '通信状態を確認して、もう一度お試しください。'}
        action={<Button onClick={onReload}>読み直す</Button>}
      />
    )
  }

  const activeCount = menus.filter((menu) => menu.is_active).length

  return (
    <div data-design="Table">
      {!canEdit ? (
        <Band tone="hint">閲覧のみで見ています。変える操作は管理者に頼んでください。</Band>
      ) : null}
      <Band tone="hint">上から並んだ順に、お客さまの画面に出ます。つまみで並べ替えます。</Band>

      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <SearchField
            aria-label="メニュー名で探す"
            placeholder="メニュー名で探す"
            value={query}
            onChange={(value) => { setQuery(value); setPage(1) }}
          />
        </div>
        <span className={styles.toolbarSpacer} />
        {canEdit ? (
          <Button variant="primary" href="/booking/menus/new">＋ 予約メニューを作る</Button>
        ) : (
          <Button variant="primary" disabled title="閲覧のみのため作れません">＋ 予約メニューを作る</Button>
        )}
      </div>

      {reorderError ? <p className="text-danger mt-2 text-xs" role="alert">{reorderError}</p> : null}

      {menus.length === 0 ? (
        <StateCard
          icon={<AccountIcon />}
          title="メニューはまだありません"
          description="お客さまが予約するときに選ぶメニューを作ります。"
          action={canEdit ? <Button variant="primary" href="/booking/menus/new">予約メニューを作る</Button> : undefined}
        />
      ) : shown.length === 0 ? (
        <StateCard
          icon={<AccountIcon />}
          title="条件に合うメニューはありません"
          description="探す言葉を変えるか、絞り込みを外してください。"
        />
      ) : (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>メニュー</h2>
            <span className={styles.sectionDesc}>
              {menuCount ?? menus.length}件・出しているもの {activeCount}
            </span>
          </div>
          <div className={styles.tableHead} role="row" aria-hidden="true">
            <span className={styles.colOrder} />
            <span className={styles.colName}>メニュー</span>
            <span className={styles.colTime}>時間</span>
            <span className={styles.colPrice}>金額</span>
            <span className={styles.colStaff}>担当</span>
            <span className={styles.colCount}>30日</span>
            <span className={styles.colStatus}>状態</span>
            <span className={styles.colMenu} />
          </div>
          {visible.map((menu) => {
            const orderIndex = shown.findIndex((item) => item.id === menu.id)
            const canMoveUp = orderIndex > 0
            const canMoveDown = orderIndex >= 0 && orderIndex < shown.length - 1
            const staffNames = (menu.assigned_staff ?? []).map((person) => person.display_name)
            const menuItems: ActionMenuItem[] = [
              { id: 'history', label: '版の履歴', onSelect: () => setHistoryTarget(menu) },
              ...(canEdit ? [
                {
                  id: 'move-up',
                  label: '上へ',
                  disabled: reorderBusy || !canMoveUp,
                  disabledReason: !canMoveUp ? 'いちばん上です' : '並び替えを保存中です',
                  onSelect: () => void moveMenu(menu, -1),
                },
                {
                  id: 'move-down',
                  label: '下へ',
                  disabled: reorderBusy || !canMoveDown,
                  disabledReason: !canMoveDown ? 'いちばん下です' : '並び替えを保存中です',
                  onSelect: () => void moveMenu(menu, 1),
                },
                {
                  id: 'visibility',
                  label: menu.is_active ? '止める' : '出す',
                  dividerBefore: true,
                  onSelect: () => { setVisibilityError(null); setVisibilityTarget(menu) },
                },
              ] satisfies ActionMenuItem[] : []),
            ]
            return (
              <div key={menu.id} className={styles.menuRow}>
                <span className={styles.colOrder}>
                  <DragHandle
                    label={`「${menu.name}」を並び替える（↑↓キー）`}
                    disabled={reorderBusy || !canEdit}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' && canMoveUp) { event.preventDefault(); void moveMenu(menu, -1) }
                      if (event.key === 'ArrowDown' && canMoveDown) { event.preventDefault(); void moveMenu(menu, 1) }
                    }}
                    className={styles.grip}
                  />
                  <span className={styles.orderNum}>{orderIndex + 1}</span>
                </span>
                <span className={styles.colName}>
                  <span className={styles.nameLine}>
                    <button
                      type="button"
                      className={styles.menuName}
                      onClick={() => openMenuForm(menu)}
                    >
                      {menu.name}
                    </button>
                    {menu.category_label ? <span className={styles.tagChip}>{menu.category_label}</span> : null}
                  </span>
                  {menu.description ? <span className={styles.menuDesc}>{menu.description}</span> : null}
                </span>
                <span className={styles.colTime}>
                  <span className={styles.cellNum}>{menu.duration_minutes}分</span>
                </span>
                <span className={styles.colPrice}>
                  <span className={styles.cellNum}>{menuPriceLabel(menu)}</span>
                </span>
                <span className={styles.colStaff}>
                  {staffNames.length === 0 ? (
                    <span className={styles.cellWarn}>担当なし</span>
                  ) : (
                    <span className={styles.cellText}>{staffNames.join('・')}</span>
                  )}
                </span>
                <span className={styles.colCount}>
                  <span className={styles.cellNum}>{menu.booking_count_30_days ?? 0}件</span>
                </span>
                <span className={styles.colStatus}>
                  <span className={`${styles.statePill} ${menu.is_active ? styles.statePillOn : styles.statePillOff}`}>
                    <span className={styles.stateDot} aria-hidden="true" />
                    {menu.is_active ? '公開中' : '止めている'}
                  </span>
                </span>
                <span className={styles.colMenu}>
                  <MoreAction
                    label={`「${menu.name}」のそのほかの操作`}
                    aria-expanded={openMenuId === menu.id}
                    onClick={() => setOpenMenuId((current) => (current === menu.id ? null : menu.id))}
                    className={styles.rowMenuButton}
                  />
                  <ActionMenu
                    open={openMenuId === menu.id}
                    inline
                    ariaLabel={`「${menu.name}」の操作`}
                    onClose={() => setOpenMenuId(null)}
                    items={[
                      { id: 'edit', label: '中身を編集', onSelect: () => openMenuForm(menu) },
                      ...menuItems,
                    ]}
                  />
                </span>
              </div>
            )
          })}
          <div className="mt-3 flex items-center justify-between gap-3">
            <ListRange
              label="メニュー"
              total={shown.length}
              first={visible.length === 0 ? 0 : (safePage - 1) * MENU_PAGE_SIZE + 1}
              last={(safePage - 1) * MENU_PAGE_SIZE + visible.length}
            />
            <Pagination page={safePage} pageCount={pageCount} onPageChange={setPage} ariaLabel="予約メニューのページ送り" />
          </div>
        </section>
      )}

      {historyTarget ? (
        <MenuVersionHistory
          menuId={historyTarget.id}
          menuName={historyTarget.name}
          currentVersion={historyTarget.version ?? 1}
          accountId={accountId}
          canRevert={canEdit}
          onReverted={(version) => {
            setHistoryTarget((current) => current && current.id === historyTarget.id ? { ...current, version } : current)
            onReload()
          }}
          onClose={() => setHistoryTarget(null)}
        />
      ) : null}

      <ConfirmDialog
        open={visibilityTarget !== null}
        title={`「${visibilityTarget?.name ?? ''}」を${visibilityTarget?.is_active ? '止め' : '出し'}ますか？`}
        description={visibilityTarget?.is_active
          ? 'お客さまの画面から外し、新しい予約を止めます。すでに入っている予約はそのまま残ります。'
          : 'お客さまの画面へ出し、新しい予約を受け付けます。担当と受付枠を確認してから出してください。'}
        confirmLabel={visibilityTarget?.is_active ? '新しい予約を止める' : 'お客さまの画面へ出す'}
        destructive={Boolean(visibilityTarget?.is_active)}
        busy={updatingVisibility}
        error={visibilityError ?? undefined}
        onCancel={() => { setVisibilityTarget(null); setVisibilityError(null) }}
        onConfirm={() => { if (visibilityTarget) void toggleVisibility(visibilityTarget) }}
      />
    </div>
  )
}

/* ==================== ② 受付枠（yRPxl） ==================== */

function HoursTabV8({ accountId, settings, settingsStatus, settingsError, resources, resourcesStatus, resourcesError, canEdit, menus, onSaved, onReload, onResourceSaved, onResourceCreated, onResourceDeleted, onResourcesRetry }: {
  accountId: string
  settings: BookingSettings | null
  settingsStatus: LoadStatus
  settingsError: string | null
  resources: BookingResource[] | null
  resourcesStatus: LoadStatus
  resourcesError: string | null
  canEdit: boolean
  menus: BookingMenu[]
  onSaved: (settings: BookingSettings) => void
  onReload: () => void
  onResourceSaved: (resource: BookingResource) => void
  onResourceCreated: (resource: BookingResource) => void
  onResourceDeleted: (id: string) => void
  onResourcesRetry: () => void
}) {
  const [draft, setDraft] = useState<BusinessHoursDay[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [addingResource, setAddingResource] = useState(false)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (settings) setDraft(initialBusinessHours(settings))
  }, [settings])

  const dirty = draft !== null && settings !== null
    && JSON.stringify(draft) !== JSON.stringify(initialBusinessHours(settings))

  useV8TabEdit({
    dirty,
    saving,
    subject: '受付時間への変更',
    saveLabel: settings?.version === 0 ? '受付枠を作る' : '開ける時間を保存',
    saveDisabled: !canEdit,
    onSave: () => void submit(),
    onReset: () => { if (settings) { setDraft(initialBusinessHours(settings)); setSaveError(null) } },
  })

  function updateDay(weekday: number, update: (intervals: BusinessHourInterval[]) => BusinessHourInterval[]) {
    setDraft((current) => current?.map((day) => day.weekday === weekday
      ? { ...day, intervals: update(day.intervals) }
      : day) ?? current)
    setSaveError(null)
  }

  async function submit() {
    if (!settings || !draft || inFlightRef.current) return
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
        reminderDayBeforeTime: settings.reminderDayBeforeTime,
        reminderHoursBefore: settings.reminderHoursBefore,
        businessHours: draft,
      })
      if (!response.success) throw new Error('booking_business_hours_save_failed')
      notifyToast('受付時間を保存しました。')
      onSaved(response.data)
    } catch (error) {
      setSaveError(businessHoursSaveError(error))
    } finally {
      inFlightRef.current = false
      setSaving(false)
    }
  }

  if (settingsStatus === 'loading' || draft === null) return <SkeletonRows rows={7} />
  if (settingsStatus === 'error' || !settings) {
    return (
      <StateCard
        icon={<AccountIcon />}
        title="受付枠を読み込めませんでした"
        description={settingsError ?? '通信状態を確認して、もう一度お試しください。'}
        action={<Button onClick={onReload}>読み直す</Button>}
      />
    )
  }

  return (
    <div data-design="Week">
      <Band tone="hint">「同時」は1時間に受けられる数ではなく、同じ時間に重ねられる予約の数です。</Band>
      {!settings.businessHoursConfigured ? (
        <Band tone="warn">まだ週全体の営業時間を保存していません。時間帯がない曜日は現在は担当者の勤務時間どおりに受け付けます。保存すると、その曜日は休業になります。</Band>
      ) : null}
      {!canEdit ? (
        <Band tone="hint">閲覧のみです。変更には予約設定の権限が必要です。</Band>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>開ける時間</h2>
          <p className={styles.sectionDesc}>曜日ごとに受付の時間と休けいを決めます</p>
        </div>
        <fieldset disabled={!canEdit} className="contents">
          {DAYS.map(({ weekday, label }) => {
            const day = draft.find((entry) => entry.weekday === weekday)
            const intervals = day?.intervals ?? []
            const isOpen = intervals.length > 0
            const closedText = settings.businessHoursConfigured
              ? '休み（定休日）・お客さまの画面に出ません'
              : '未設定（現在は担当者の勤務時間どおり）'
            return (
              <div key={weekday} className={styles.dayRow}>
                <div className={styles.dayName}>
                  <Toggle
                    label={`${label}を${isOpen ? '休みにする' : '開ける'}`}
                    checked={isOpen}
                    onChange={(next) => updateDay(weekday, () => next ? [{ start: '09:00', end: '18:00', capacity: 1 }] : [])}
                  />
                  <span className={styles.dayLabel}>{label.replace('曜日', '')}</span>
                </div>
                <div className={styles.dayBody}>
                  {intervals.length === 0 ? (
                    <span className={styles.dayOff}>{closedText}</span>
                  ) : null}
                  {intervals.map((interval, index) => (
                  <div key={index} className={styles.intervalLine}>
                    <TimeField
                      aria-label={`${label}の開始時刻（${index + 1}区間目）`}
                      value={interval.start}
                      onChange={(value) => updateDay(weekday, (list) => list.map((entry, i) => i === index ? { ...entry, start: value } : entry))}
                      className={styles.timeInput}
                    />
                    <span className={styles.intervalTilde}>〜</span>
                    <TimeField
                      aria-label={`${label}の終了時刻（${index + 1}区間目）`}
                      value={interval.end}
                      onChange={(value) => updateDay(weekday, (list) => list.map((entry, i) => i === index ? { ...entry, end: value } : entry))}
                      className={styles.timeInput}
                    />
                    <span className={styles.sameTimeLabel}>同時</span>
                    <input
                      aria-label={`${label}の同時受付数（${index + 1}区間目）`}
                      type="number"
                      min={1}
                      max={1000}
                      value={interval.capacity ?? 1}
                      onChange={(event) => updateDay(weekday, (list) => list.map((entry, i) => i === index ? { ...entry, capacity: Number(event.target.value) } : entry))}
                      className={styles.numInput}
                    />
                    <button
                      type="button"
                      className={styles.iconRemove}
                      aria-label={`${label}の${index + 1}区間目を削除`}
                      onClick={() => updateDay(weekday, (list) => list.filter((_, i) => i !== index))}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                  ))}
                  {isOpen && intervals.length < 8 ? (
                    <button
                      type="button"
                      className={styles.addLine}
                      onClick={() => updateDay(weekday, (list) => [...list, { start: '09:00', end: '18:00', capacity: 1 }])}
                    >
                      ＋ 時間帯を足す
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </fieldset>
        {saveError ? <p className="text-danger mt-3 text-sm" role="alert">{saveError}</p> : null}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeadRow}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>設備</h2>
            <p className={styles.sectionDesc}>設備ごとに、同じ時間に使える数を決めます。</p>
          </div>
          {canEdit ? (
            <Button onClick={() => setAddingResource(true)}>＋ 設備を追加する</Button>
          ) : null}
        </div>
        {resourcesStatus === 'loading' ? <SkeletonRows rows={2} /> : null}
        {resourcesStatus === 'error' ? (
          <StateCard
            icon={<AccountIcon />}
            title="設備を読み込めませんでした"
            description={resourcesError ?? 'もう一度お試しください。'}
            action={<Button onClick={onResourcesRetry}>読み直す</Button>}
          />
        ) : null}
        {resourcesStatus === 'ready' && resources ? (
          <>
            <div className={styles.equipHead} aria-hidden="true">
              <span className={styles.equipName}>設備名</span>
              <span className={styles.equipType}>種類</span>
              <span className={styles.equipCap}>受付上限</span>
              <span className={styles.colMenu} />
            </div>
            {resources.length === 0 ? (
              <p className={styles.noteText}>設備はまだありません。</p>
            ) : resources.map((resource) => (
              <ResourceRowV8
                key={`${resource.id}:${resource.version}`}
                accountId={accountId}
                resource={resource}
                canEdit={canEdit}
                onSaved={onResourceSaved}
                onDeleted={onResourceDeleted}
              />
            ))}
          </>
        ) : null}
        <ResourceDialog
          open={addingResource}
          onClose={() => setAddingResource(false)}
          accountId={accountId}
          onSaved={(saved) => { setAddingResource(false); onResourceCreated(saved) }}
        />
      </section>

      <SlotCheckV8 accountId={accountId} menus={menus} />
    </div>
  )
}

/* 設備の1行。中身の編集は窓で、止める・消すは「…」の中。 */
function ResourceRowV8({ accountId, resource, canEdit, onSaved, onDeleted }: {
  accountId: string
  resource: BookingResource
  canEdit: boolean
  onSaved: (resource: BookingResource) => void
  onDeleted: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  async function setActive(nextActive: boolean) {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    setError(null)
    try {
      const response = await bookingApi.updateResource(accountId, resource.id, {
        expectedVersion: resource.version,
        isActive: nextActive,
      })
      onSaved(response.data)
    } catch (cause) {
      setError(resourceSaveError(cause))
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  async function remove() {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    setError(null)
    try {
      await bookingApi.deleteResource(accountId, resource.id, resource.version)
      setConfirmDelete(false)
      onDeleted(resource.id)
    } catch (cause) {
      setError(resourceSaveError(cause))
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  const menuItems: ActionMenuItem[] = canEdit ? [
    {
      id: 'edit',
      label: '中身を編集',
      disabled: busy,
      onSelect: () => setEditing(true),
    },
    {
      id: 'toggle',
      label: resource.isActive ? '受付を停止' : '受付を再開',
      disabled: busy,
      onSelect: () => void setActive(!resource.isActive),
    },
    ...(!resource.usage?.referenced ? [{
      id: 'delete',
      label: '設備を削除する',
      tone: 'danger' as const,
      dividerBefore: true,
      disabled: busy,
      onSelect: () => { setError(null); setConfirmDelete(true) },
    }] : []),
  ] : []

  return (
    <div className={styles.equipRow}>
      <span className={styles.equipName}>
        {resource.name}
        {!resource.isActive ? <span className={styles.cellWarn}>（受付停止中）</span> : null}
      </span>
      <span className={styles.equipType}>{resource.type}</span>
      <span className={styles.equipCap}>{resource.capacity}</span>
      <span className={styles.colMenu}>
        {menuItems.length > 0 ? (
          <>
            <MoreAction
              label={`「${resource.name}」のそのほかの操作`}
              aria-expanded={open}
              onClick={() => setOpen((current) => !current)}
              className={styles.rowMenuButton}
            />
            <ActionMenu
              open={open}
              inline
              ariaLabel={`「${resource.name}」の操作`}
              onClose={() => setOpen(false)}
              items={menuItems}
            />
          </>
        ) : null}
      </span>
      {error ? <p className="text-danger w-full text-xs" role="alert">{error}</p> : null}
      <ResourceDialog
        open={editing}
        onClose={() => setEditing(false)}
        accountId={accountId}
        resource={resource}
        onSaved={(saved) => { setEditing(false); onSaved(saved) }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={`「${resource.name}」を削除しますか？`}
        description="削除すると元に戻せません。受付だけ止めたいときは「受付を停止」を使ってください。"
        confirmLabel="削除する"
        destructive
        busy={busy}
        error={error ?? undefined}
        onCancel={() => { if (!busy) setConfirmDelete(false) }}
        onConfirm={() => void remove()}
      />
    </div>
  )
}

/* 設備の追加・編集の窓。版つき保存・409 は v7 の ResourceEditor と同じ。 */
function ResourceDialog({ open, onClose, accountId, resource, onSaved }: {
  open: boolean
  onClose: () => void
  accountId: string
  resource?: BookingResource
  onSaved: (resource: BookingResource) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [capacity, setCapacity] = useState('1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setName(resource?.name ?? '')
    setType(resource?.type ?? '')
    setCapacity(String(resource?.capacity ?? 1))
    setError(null)
  }, [open, resource])

  async function submit() {
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
      if (resource) {
        const response = await bookingApi.updateResource(accountId, resource.id, {
          expectedVersion: resource.version,
          name: name.trim(),
          type: type.trim(),
          capacity: parsedCapacity,
          isActive: resource.isActive,
        })
        onSaved(response.data)
      } else {
        const response = await bookingApi.createResource(accountId, {
          name: name.trim(), type: type.trim(), capacity: parsedCapacity,
        })
        onSaved(response.data)
      }
    } catch (cause) {
      setError(resourceSaveError(cause))
    } finally {
      inFlightRef.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      title={resource ? `「${resource.name}」を編集` : '設備を追加する'}
      onCancel={() => { if (!saving) onClose() }}
      busy={saving}
    >
      <div className="grid gap-3">
        <label className={styles.fieldLabel}>設備名
          <input aria-label="設備名" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} maxLength={100} className="border-hairline rounded-control focus:ring-accent mt-1 w-full border bg-canvas px-3 h-10 text-sm focus:outline-none focus:ring-2" />
        </label>
        <label className={styles.fieldLabel}>種類
          <input aria-label="種類" value={type} onChange={(event) => setType(event.target.value)} disabled={saving} maxLength={50} placeholder="例: 部屋・席・機器" className="border-hairline rounded-control focus:ring-accent mt-1 w-full border bg-canvas px-3 h-10 text-sm focus:outline-none focus:ring-2" />
        </label>
        <label className={styles.fieldLabel}>受付上限
          <input aria-label="受付上限" type="number" min={1} max={1000} value={capacity} onChange={(event) => setCapacity(event.target.value)} disabled={saving} className="border-hairline rounded-control focus:ring-accent mt-1 w-full border bg-canvas px-3 h-10 text-sm tabular-nums focus:outline-none focus:ring-2" />
        </label>
        {error ? <p className="text-danger text-xs" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={() => { if (!saving) onClose() }} disabled={saving}>キャンセル</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving} busy={saving}>保存する</Button>
        </div>
      </div>
    </Dialog>
  )
}

/* IDEA-28: 日時を指定して予約できるか確かめる。読み取りだけで予約は作らない。 */
function SlotCheckV8({ accountId, menus }: { accountId: string; menus: BookingMenu[] }) {
  const activeMenus = useMemo(() => menus.filter((menu) => menu.is_active), [menus])
  const [menuId, setMenuId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [staffId, setStaffId] = useState('')
  const [staffOptions, setStaffOptions] = useState<BookingStaff[]>([])
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [result, setResult] = useState<BookingSlotCheckResult | null>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    void bookingApi.listStaff(accountId)
      .then((res) => {
        if (!cancelled) setStaffOptions(res.staff.filter((person) => person.is_active))
      })
      .catch(() => { if (!cancelled) setStaffOptions([]) })
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
      const response = await bookingApi.checkAvailability(accountId, { menuId, staffId: staffId || undefined, date, time })
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
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>空きを確かめる</h2>
        <p className={styles.sectionDesc}>お客さまの画面と同じ条件で、その日時に受けられるか確かめます。確かめても予約は作られません。</p>
      </div>
      <div className={styles.checkGrid}>
        <Select size="full"
          aria-label="確かめるメニュー"
          value={menuId}
          onChange={(value) => { setMenuId(value); setResult(null) }}
          options={[
            ...(activeMenus.length === 0 ? [{ value: '', label: '受付中のメニューがありません' }] : []),
            ...activeMenus.map((menu) => ({ value: menu.id, label: menu.name })),
          ]}
        />
        <label className={styles.fieldLabel}>
          日付
          <DateField aria-label="確かめる日付" value={date} onChange={(value) => { setDate(value); setResult(null) }} className="mt-1" />
        </label>
        <label className={styles.fieldLabel}>
          開始時刻
          <TimeField aria-label="確かめる開始時刻" value={time} onChange={(value) => { setTime(value); setResult(null) }} className="mt-1" />
        </label>
        <Select size="full"
          aria-label="確かめる担当"
          value={staffId}
          onChange={(value) => { setStaffId(value); setResult(null) }}
          options={[
            { value: '', label: '担当：指名なし' },
            ...staffOptions.map((person) => ({ value: person.id, label: `担当：${person.display_name}` })),
          ]}
        />
      </div>
      <div className={`${styles.checkAction} mt-3`}>
        <Button variant="primary" onClick={() => void run()} disabled={!canRun} busy={checking}>確かめる</Button>
        {result ? (
          <div className={`${styles.checkResult} ${result.bookable ? styles.checkOk : styles.checkNg}`} role="status">
            {result.bookable ? (
              <p>空いています。{result.per_staff?.length ? `${result.per_staff.map((entry) => entry.display_name).join('・')}が受けられます。` : ''}</p>
            ) : (
              <div>
                <p>この日時は受けられません。</p>
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {result.reasons.map((reason) => <li key={reason}>{slotReasonLabel(reason)}</li>)}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </div>
      {checkError ? <p className="text-danger mt-2 text-xs" role="alert">{checkError}</p> : null}
    </section>
  )
}

/* ==================== ③ 休業日（KRgTQ） ==================== */

/** `YYYY-MM` の月を日曜はじまりの週ごとの日付（YYYY-MM-DD）に並べる。 */
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

function HolidaysTabV8({ accountId, settings, status, error, exceptions, closedWeekdays, bookingCountOnClosed, canEdit, onSaved, onReload }: {
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
        description="削除すると、その期間は曜日の決めごとどおりの受付に戻ります。すでに入っている予約はそのまま残ります。"
        confirmLabel="休業日を削除する"
        destructive
        busy={busy}
        onCancel={() => { if (!busy) setDeleteTarget(null) }}
        onConfirm={() => void remove()}
      />
    </div>
  )
}

/* ==================== ④ 予約のルール（x1OZS6） ==================== */

/* 候補は v7（/booking/menus の BookingRulesEditor）と同じ。 */
const TIME_ZONE_CHOICES = [
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Taipei',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Australia/Sydney',
  'Pacific/Auckland',
]

function isUnknownTimeZone(zone: string): boolean {
  if (TIME_ZONE_CHOICES.includes(zone)) return false
  try {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    if (typeof supportedValuesOf !== 'function') return false
    return !supportedValuesOf.call(Intl, 'timeZone').includes(zone)
  } catch {
    return false
  }
}

/** R311: 空欄を0にせず保存を止める数値欄（v7 の RuleNumberField と同じ動き）。 */
function RuleNumberFieldV8({ label, unit, min, max, value, onChange, trackEmpty, humanize }: {
  label: string
  unit: string
  min: number
  max: number
  value: number
  onChange: (value: number) => void
  trackEmpty?: (empty: boolean) => void
  humanize?: (value: number) => string | null
}) {
  const [text, setText] = useState<string | null>(null)
  const trackEmptyRef = useRef(trackEmpty)
  trackEmptyRef.current = trackEmpty
  const lastValueRef = useRef(value)
  useEffect(() => {
    if (lastValueRef.current !== value) {
      lastValueRef.current = value
      setText(null)
      trackEmptyRef.current?.(false)
    }
  }, [value])
  const shown = text ?? value
  const hintNumber = typeof shown === 'number'
    ? shown
    : typeof shown !== 'string' || shown.trim() === ''
      ? null
      : Number(shown)
  const hint = hintNumber === null || Number.isNaN(hintNumber) ? null : humanize?.(hintNumber)
  return (
    <label className={styles.fieldLabel}>
      {label}
      <span className="mt-1 flex items-center gap-2">
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          value={shown ?? ''}
          onChange={(event) => {
            const raw = event.target.value
            if (!trackEmpty) {
              onChange(Number(raw))
              return
            }
            setText(raw)
            trackEmpty(raw === '')
            if (raw !== '') onChange(Number(raw))
          }}
          className={styles.numInput}
        />
        <span className="text-ink-faint whitespace-nowrap text-xs">{unit}</span>
      </span>
      {hint ? <span className="text-ink-faint mt-1 block text-xs">＝{hint}</span> : null}
    </label>
  )
}

function RulesTabV8({ accountId, settings, status, error, staff, staffReady, canEdit, onSaved, onReload }: {
  accountId: string
  settings: BookingSettings | null
  status: LoadStatus
  error: string | null
  staff: BookingStaff[]
  /** スタッフ一覧の読み込みが終わっているか。「指名なし」の切替はスタッフに書く。 */
  staffReady: boolean
  canEdit: boolean
  onSaved: (settings: BookingSettings) => void
  onReload: () => void
}) {
  const [draft, setDraft] = useState<BookingSettings | null>(null)
  /* 「指名なし」を出すか。店舗の保存先は無く、スタッフの is_designation_optional に書く。 */
  const [noAssign, setNoAssign] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [cutoffEmpty, setCutoffEmpty] = useState(false)
  const [cancelEmpty, setCancelEmpty] = useState(false)
  const inFlightRef = useRef(false)

  const initialNoAssign = useMemo(
    () => staff.some((person) => person.is_active && person.is_designation_optional),
    [staff],
  )

  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])
  useEffect(() => {
    if (staffReady) setNoAssign(initialNoAssign)
  }, [staffReady, initialNoAssign])

  const dirty = draft !== null && settings !== null && (
    JSON.stringify(draft) !== JSON.stringify(settings)
    || cutoffEmpty
    || cancelEmpty
    || (noAssign !== null && noAssign !== initialNoAssign)
  )

  useV8TabEdit({
    dirty,
    saving,
    subject: '予約のルールへの変更',
    saveLabel: settings?.version === 0 ? 'ルールを作る' : 'ルールを保存',
    saveDisabled: !canEdit,
    onSave: () => void submit(),
    onReset: () => {
      if (settings) setDraft(settings)
      setNoAssign(initialNoAssign)
      setCutoffEmpty(false)
      setCancelEmpty(false)
      setSaveError(null)
    },
  })

  function set<K extends keyof BookingSettings>(key: K, value: BookingSettings[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current)
  }

  async function submit() {
    if (!draft || inFlightRef.current) return
    const emptyLabels = [
      cutoffEmpty ? '受付の締め切り' : null,
      cancelEmpty ? 'キャンセルの期限' : null,
    ].filter((label): label is string => label !== null)
    if (emptyLabels.length > 0) {
      setSaveError(`「${emptyLabels.join('」「')}」が空欄です。空欄のまま保存できません。直前まで可能にするときは0と入力してください。`)
      return
    }
    inFlightRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const response = await bookingApi.saveSettings(accountId, {
        expectedVersion: draft.version,
        timeZone: draft.timeZone.trim(),
        bookingWindowDays: draft.bookingWindowDays,
        cutoffMinutesBefore: draft.cutoffMinutesBefore,
        cancelDeadlineMinutesBefore: draft.cancelDeadlineMinutesBefore,
        maxActiveBookingsPerFriend: draft.maxActiveBookingsPerFriend,
        approvalMode: draft.approvalMode,
        holdMinutes: draft.holdMinutes,
        slotGranularityMinutes: draft.slotGranularityMinutes,
        liffDateView: draft.liffDateView ?? 'list',
        reminderDayBeforeTime: draft.reminderDayBeforeTime || null,
        reminderHoursBefore: draft.reminderHoursBefore,
      })
      if (!response.success) throw new Error('booking_settings_save_failed')
      /* 「指名なし」の切替は全スタッフの is_designation_optional を揃える。 */
      if (noAssign !== null && noAssign !== initialNoAssign) {
        const targets = staff.filter((person) => person.is_active && Boolean(person.is_designation_optional) !== noAssign)
        for (const person of targets) {
          await bookingApi.updateStaff(accountId, person.id, { is_designation_optional: noAssign ? 1 : 0 })
        }
      }
      setDraft(response.data)
      setCutoffEmpty(false)
      setCancelEmpty(false)
      notifyToast('予約のルールを保存しました。')
      onSaved(response.data)
      if (noAssign !== null && noAssign !== initialNoAssign) onReload()
    } catch (cause) {
      setSaveError(bookingRulesErrorMessage(cause, '保存'))
    } finally {
      inFlightRef.current = false
      setSaving(false)
    }
  }

  if (status === 'loading' || draft === null) return <SkeletonRows rows={5} />
  if (status === 'error' || !settings) {
    return (
      <StateCard
        icon={<AccountIcon />}
        title="予約のルールを読み込めませんでした"
        description={error ?? '通信状態を確認して、もう一度お試しください。'}
        action={<Button onClick={onReload}>読み直す</Button>}
      />
    )
  }

  return (
    <div data-design="Rules">
      {!canEdit ? <Band tone="hint">閲覧のみです。変更には予約設定の権限が必要です。</Band> : null}
      <fieldset disabled={!canEdit} className="contents">
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>いつまで予約を受けるか</h2>
          </div>
          <div className={styles.ruleFields}>
            <RuleNumberFieldV8 label="先の予約が取れる範囲" unit="日先まで" min={1} max={365} value={draft.bookingWindowDays} onChange={(value) => set('bookingWindowDays', value)} />
            <RuleNumberFieldV8 label="受付の締め切り" unit="分前まで" min={0} max={43200} value={draft.cutoffMinutesBefore} onChange={(value) => set('cutoffMinutesBefore', value)} trackEmpty={setCutoffEmpty} humanize={minutesBeforeLabel} />
            <RuleNumberFieldV8 label="キャンセルの期限" unit="分前まで" min={0} max={43200} value={draft.cancelDeadlineMinutesBefore} onChange={(value) => set('cancelDeadlineMinutesBefore', value)} trackEmpty={setCancelEmpty} humanize={minutesBeforeLabel} />
            <RuleNumberFieldV8 label="予約枠の間隔" unit="分" min={5} max={60} value={draft.slotGranularityMinutes} onChange={(value) => set('slotGranularityMinutes', value as BookingSettings['slotGranularityMinutes'])} />
            <RuleNumberFieldV8 label="仮押さえの保持時間" unit="分" min={1} max={1440} value={draft.holdMinutes} onChange={(value) => set('holdMinutes', value)} humanize={formatMinutesLengthHint} />
            <label className={styles.fieldLabel}>
              タイムゾーン
              <Select size="full"
                aria-label="タイムゾーン"
                value={draft.timeZone}
                onChange={(value) => set('timeZone', value)}
                className="mt-1"
                options={(TIME_ZONE_CHOICES.includes(draft.timeZone)
                  ? TIME_ZONE_CHOICES
                  : [draft.timeZone, ...TIME_ZONE_CHOICES]
                ).map((zone) => ({ value: zone, label: zone }))}
              />
              {isUnknownTimeZone(draft.timeZone) ? (
                <span className="text-danger mt-1 block text-xs">一覧にないタイムゾーンです。綴りを確認してください（よく使う値: Asia/Tokyo）。</span>
              ) : null}
            </label>
          </div>
          <p className={styles.noteText}>0分前は、開始直前まで受け付ける・キャンセルできる設定です。空欄のまま保存できません。今は {bookingWindowEnd(draft.bookingWindowDays)} まで受け付けます。</p>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>予約の受け方</h2>
          </div>
          <div className={styles.toggleRow}>
            <span className={styles.toggleRowLabel}>お店が承認してから確定する</span>
            <Toggle
              label="お店が承認してから確定する"
              checked={draft.approvalMode === 'manual'}
              onChange={(next) => set('approvalMode', next ? 'manual' : 'automatic')}
            />
          </div>
          <div className={styles.toggleRow}>
            <span className={styles.toggleRowLabel}>
              同じ人の予約は同時に{' '}
              <input
                aria-label="同じ人が同時に持てる予約の数"
                type="number"
                min={1}
                max={100}
                value={draft.maxActiveBookingsPerFriend}
                onChange={(event) => set('maxActiveBookingsPerFriend', Number(event.target.value))}
                className={styles.numInput}
              />{' '}
              件まで
            </span>
          </div>
          <div className={styles.toggleRow}>
            <span className={styles.toggleRowLabel}>
              「指名なし」を出す
              <span className="text-ink-faint block text-xs">オンにすると、受付中のスタッフ全員が「指名なし」での予約の対象になります。</span>
            </span>
            <Toggle
              label="「指名なし」を出す"
              checked={noAssign ?? initialNoAssign}
              onChange={(next) => setNoAssign(next)}
            />
          </div>
          <div className={styles.toggleRow}>
            <span className={styles.toggleRowLabel}>日時を選ぶ画面の最初の形</span>
            <Select
              aria-label="日時を選ぶ画面の最初の形"
              value={draft.liffDateView ?? 'list'}
              onChange={(value) => set('liffDateView', value as 'list' | 'calendar')}
              options={[
                { value: 'list', label: '週で見る（日付の横ならび）' },
                { value: 'calendar', label: 'カレンダー' },
              ]}
            />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>お知らせ</h2>
            <p className={styles.sectionDesc}>予約・変更・キャンセルをLINEで送ります</p>
          </div>
          <div className={styles.noticeRow}>
            <span className={styles.noticeWhen}>予約を受けたとき</span>
            <span className={styles.noticeWhat}>お客さまのLINEへ自動で送ります</span>
          </div>
          <div className={styles.noticeRow}>
            <span className={styles.noticeWhen}>承認したとき</span>
            <span className={styles.noticeWhat}>お客さまのLINEへ自動で送ります</span>
          </div>
          <div className={styles.noticeRow}>
            <span className={styles.noticeWhen}>前日</span>
            <span className="flex items-center gap-2">
              <TimeField
                aria-label="前日のお知らせを送る時刻"
                value={draft.reminderDayBeforeTime ?? ''}
                onChange={(value) => set('reminderDayBeforeTime', value || null)}
              />
              <span className="text-ink-faint whitespace-nowrap text-xs">空欄は24時間前</span>
            </span>
          </div>
          <div className={styles.noticeRow}>
            <span className={styles.noticeWhen}>当日</span>
            <span className="flex items-center gap-2">
              <input
                aria-label="当日のお知らせを送るタイミング"
                type="number"
                min={1}
                max={72}
                value={draft.reminderHoursBefore}
                onChange={(event) => set('reminderHoursBefore', Number(event.target.value))}
                className={styles.numInput}
              />
              <span className="text-ink-faint whitespace-nowrap text-xs">時間前{formatHoursBeforeHint(draft.reminderHoursBefore) ? `（${formatHoursBeforeHint(draft.reminderHoursBefore)}）` : ''}</span>
            </span>
          </div>
        </section>

        <p className={styles.noteText}>メニューごとに変えたいときは、メニューの中身から「このメニューだけ変える」。</p>
        {saveError ? (
          <p className="text-danger mt-3 text-sm" role="alert">
            {saveError}
            {saveError.includes('先に保存') ? (
              <button type="button" className="text-action ml-2 font-semibold underline" onClick={onReload}>最新の内容を読み直す</button>
            ) : null}
          </p>
        ) : null}
      </fieldset>
    </div>
  )
}

/* ==================== ⑤ 担当スタッフ（VLEaj） ==================== */

const STAFF_PAGE_SIZE = 4

const MEMBER_ROLE_LABEL: Record<string, string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: 'スタッフ',
}

function StaffTabV8({ accountId, staff, status, error, matrices, extras, members, canEdit, onReload }: {
  accountId: string
  staff: BookingStaff[]
  status: LoadStatus
  error: string | null
  matrices: Record<string, StaffMenuMatrix[]>
  extras: Record<string, { work: string | null; calendar: 'loading' | 'connected' | 'none' | 'error' }>
  members: StaffMember[]
  canEdit: boolean
  onReload: () => void
}) {
  const router = useRouter()
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Partial<BookingStaff> | null>(null)
  const [removeTarget, setRemoveTarget] = useState<BookingStaff | null>(null)
  const [removeError, setRemoveError] = useState('')
  const [removing, setRemoving] = useState(false)
  const [pauseTarget, setPauseTarget] = useState<BookingStaff | null>(null)
  const [pausing, setPausing] = useState(false)
  const [pauseError, setPauseError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const pageCount = Math.max(1, Math.ceil(staff.length / STAFF_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const visible = staff.slice((safePage - 1) * STAFF_PAGE_SIZE, safePage * STAFF_PAGE_SIZE)

  async function saveStaff(input: Partial<BookingStaff>) {
    if (input.id) {
      await bookingApi.updateStaff(accountId, input.id, input)
    } else {
      await bookingApi.createStaff(accountId, input)
    }
    setEditing(null)
    onReload()
  }

  async function setActive(person: BookingStaff, nextActive: boolean) {
    setPausing(true)
    setPauseError(null)
    try {
      await bookingApi.updateStaff(accountId, person.id, { is_active: nextActive ? 1 : 0 })
      setPauseTarget(null)
      onReload()
    } catch (cause) {
      setPauseError(cause instanceof ApiError && cause.status === 403
        ? 'スタッフの受付状態を変える権限がありません。'
        : '変更できませんでした。もう一度お試しください。')
    } finally {
      setPausing(false)
    }
  }

  async function remove() {
    const target = removeTarget
    if (!target) return
    setRemoving(true)
    setRemoveError('')
    try {
      await bookingApi.deleteStaff(accountId, target.id)
      setRemoveTarget(null)
      onReload()
    } catch (cause) {
      setRemoveError(cause instanceof ApiError && cause.status === 403
        ? 'スタッフを消す権限がありません。'
        : '消せませんでした。もう一度お試しください。')
    } finally {
      setRemoving(false)
    }
  }

  function memberLabel(person: BookingStaff): string {
    if (!person.staff_member_id) return 'ひも付けなし'
    const member = members.find((entry) => entry.id === person.staff_member_id)
    if (!member) return 'ひも付けあり'
    const role = MEMBER_ROLE_LABEL[member.role] ?? member.role
    return `${member.name}（${role}）`
  }

  if (status === 'loading') return <SkeletonRows rows={4} />
  if (status === 'error') {
    return (
      <StateCard
        icon={<AccountIcon />}
        title="スタッフを読み込めませんでした"
        description={error ?? '通信状態を確認して、もう一度お試しください。'}
        action={<Button onClick={onReload}>読み直す</Button>}
      />
    )
  }

  return (
    <div data-design="Table">
      <div className={styles.staffHeadRow}>
        <h2 className={styles.staffHeadTitle}>担当スタッフ <b>{staff.length}人</b></h2>
        <div className={styles.staffHeadActions}>
          <Button href="/booking/menus/staff">担当メニューをまとめて決める</Button>
          {canEdit ? <Button variant="primary" onClick={() => setEditing(EMPTY_STAFF)}>＋ スタッフを登録</Button> : null}
        </div>
      </div>

      {staff.length === 0 ? (
        <StateCard
          icon={<AccountIcon />}
          title="スタッフはまだいません"
          description="お客さまが予約するときに指名できる担当者を登録します。"
          action={canEdit ? <Button variant="primary" onClick={() => setEditing(EMPTY_STAFF)}>スタッフを登録</Button> : undefined}
        />
      ) : (
      <section className={styles.section}>
      <div className={`${styles.staffRow} ${styles.tableHead}`} aria-hidden="true">
        <span className={styles.staffName}>スタッフ</span>
        <span className={styles.staffColMenus}>担当メニュー</span>
        <span className={styles.staffColNoAssign}>指名なし</span>
        <span className={styles.staffColWork}>勤務（今週）</span>
        <span className={styles.staffColLink}>カレンダー・ログイン</span>
        <span className={styles.staffColStatus}>状態</span>
        <span className={styles.staffColMenu} />
      </div>

      {visible.map((person) => {
        const offered = (matrices[person.id] ?? []).filter((entry) => entry.is_offered).length
        const extra = extras[person.id]
        const menuItems: ActionMenuItem[] = [
          {
            id: 'shifts',
            label: '勤務とシフト',
            external: true,
            onSelect: () => router.push(`/booking/staff/shifts?staff_id=${person.id}`),
          },
          ...(canEdit ? [
            { id: 'edit', label: '中身を編集', onSelect: () => setEditing(person) },
            {
              id: 'pause',
              label: person.is_active ? '止める' : '再開する',
              onSelect: () => { setPauseError(null); setPauseTarget(person) },
            },
            {
              id: 'delete',
              label: '削除する',
              tone: 'danger' as const,
              dividerBefore: true,
              onSelect: () => { setRemoveError(''); setRemoveTarget(person) },
            },
          ] satisfies ActionMenuItem[] : []),
        ]
        return (
          <div key={person.id} className={styles.staffRow}>
            <span className={styles.staffName}>
              <Link href={`/booking/staff/shifts?staff_id=${person.id}`} className={styles.staffNameLink}>
                {person.name}
              </Link>
              {person.role ? <span className={styles.staffRole}>{person.role}</span> : null}
            </span>
            <span className={styles.staffColMenus}>
              {offered > 0 ? (
                <span className={styles.staffCellMain}>{offered}つ</span>
              ) : (
                <span className={styles.cellWarn}>
                  0<span className={styles.staffCellSub}>予約画面に出ません</span>
                </span>
              )}
            </span>
            <span className={styles.staffColNoAssign}>
              <span className={styles.staffCellMain}>{person.is_designation_optional ? '入る' : '—'}</span>
            </span>
            <span className={styles.staffColWork}>
              {extra?.work ? (() => {
                const [days, range] = extra.work.split('　')
                return (
                  <>
                    <span className={styles.staffCellMain}>{days}</span>
                    {range ? <span className={styles.staffCellSub}>{range}</span> : null}
                  </>
                )
              })() : <span className={styles.staffCellMain}>…</span>}
            </span>
            <span className={styles.staffColLink}>
              <span className={`${styles.linkState} ${extra?.calendar === 'connected' ? styles.linkStateOn : ''}`}>
                <span className={styles.linkStateDot} aria-hidden="true" />
                {extra?.calendar === 'connected' ? 'つながっている' : extra?.calendar === 'error' ? '確認できません' : 'つないでいない'}
              </span>
              <span className={styles.staffCellSub}>ログイン：{memberLabel(person)}</span>
            </span>
            <span className={styles.staffColStatus}>
              <span className={`${styles.statePill} ${person.is_active ? styles.statePillOn : styles.statePillOff}`}>
                <span className={styles.stateDot} aria-hidden="true" />
                {person.is_active ? '受付中' : '止めている'}
              </span>
            </span>
            <span className={styles.staffColMenu}>
              <MoreAction
                label={`${person.display_name}のそのほかの操作`}
                aria-expanded={openMenuId === person.id}
                onClick={() => setOpenMenuId((current) => (current === person.id ? null : person.id))}
                className={styles.rowMenuButton}
              />
              <ActionMenu
                open={openMenuId === person.id}
                inline
                ariaLabel={`${person.display_name}の操作`}
                onClose={() => setOpenMenuId(null)}
                items={menuItems}
              />
            </span>
          </div>
        )
      })}

      {staff.length > STAFF_PAGE_SIZE ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <ListRange
            label="スタッフ"
            total={staff.length}
            first={visible.length === 0 ? 0 : (safePage - 1) * STAFF_PAGE_SIZE + 1}
            last={(safePage - 1) * STAFF_PAGE_SIZE + visible.length}
          />
          <Pagination page={safePage} pageCount={pageCount} onPageChange={setPage} ariaLabel="担当スタッフのページ送り" />
        </div>
      ) : null}
      </section>
      )}

      <p className={`${styles.noteText} mt-4`}>
        行の「…」から 勤務とシフト・編集・止める。名前を押すと勤務とシフトが開きます。カレンダーにつないでいないスタッフは、ほかの予約サービスの予約で枠が埋まらないので、つなぐのをおすすめします。
      </p>

      {editing ? (
        <StaffEditModal staff={editing} onSave={saveStaff} onClose={() => setEditing(null)} />
      ) : null}

      <ConfirmDialog
        open={pauseTarget !== null}
        title={`${pauseTarget?.display_name ?? ''}の受付を${pauseTarget?.is_active ? '止め' : '再開し'}ますか？`}
        description={pauseTarget?.is_active
          ? 'お客さまの画面から外れ、新しい予約を受けなくなります。すでに入っている予約はそのまま残ります。'
          : 'お客さまの画面へ出し、新しい予約を受け付けます。'}
        confirmLabel={pauseTarget?.is_active ? '止める' : '再開する'}
        destructive={Boolean(pauseTarget?.is_active)}
        busy={pausing}
        error={pauseError ?? undefined}
        onCancel={() => { if (!pausing) setPauseTarget(null) }}
        onConfirm={() => { if (pauseTarget) void setActive(pauseTarget, !pauseTarget.is_active) }}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title={`「${removeTarget?.display_name ?? ''}」を削除しますか？`}
        description="削除すると元に戻せません。受付だけ止めたいときは「止める」を使ってください。"
        confirmLabel="削除する"
        destructive
        busy={removing}
        error={removeError || undefined}
        onCancel={() => { if (!removing) setRemoveTarget(null) }}
        onConfirm={() => void remove()}
      />

    </div>
  )
}

/* ==================== ⑥ 予約経路（ZyDd6・wJYQb） ==================== */

type BookingChannelStaff = {
  staffId: string
  displayName: string
  status: 'connected' | 'disconnected' | 'expired'
  externalEventsThisWeek: number | null
  lastReadAt: string | null
}

type BookingChannel = {
  key: string
  status: string
  todayCount: number | null
}

type BookingChannelsData = {
  timeZone: string
  staff: BookingChannelStaff[]
  autoAssign: boolean
  channels: BookingChannel[]
}

/** 予約経路の見せ方（板 ZyDd6）。受け取り方は見本どおりの固定文言。 */
const BOOKING_CHANNEL_META: Record<string, { name: string; sub: string; how: string }> = {
  line: { name: 'LINE（musubo の予約）', sub: '予約ページ・リッチメニュー', how: 'そのまま予約管理へ' },
  manual: { name: '電話・店頭', sub: 'スタッフが入れる', how: '予約管理で手入力' },
  hot_pepper_beauty: { name: 'Hot Pepper Beauty', sub: 'SALON BOARD', how: 'Google カレンダー経由（SALON BOARD が書き出せる場合・確認中）' },
  google_reserve: { name: 'Google で予約', sub: 'Google ビジネス プロフィール', how: '予約通知メールを読む（未対応）' },
  epark: { name: 'EPARK', sub: '予約通知メール', how: '予約通知メールを読む（未対応）' },
}

function channelStatusBadge(status: string): { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string } {
  if (status === 'active' || status === 'connected') {
    return status === 'active' ? { tone: 'success', label: '使っている' } : { tone: 'success', label: 'つながっている' }
  }
  if (status === 'expired') return { tone: 'danger', label: '期限切れ' }
  if (status === 'confirming') return { tone: 'warning', label: '確認中' }
  if (status === 'disconnected') return { tone: 'neutral', label: 'つないでいない' }
  return { tone: 'neutral', label: '未確認' }
}

function ChannelsTabV8({ accountId, canEdit }: { accountId: string; canEdit: boolean }) {
  const [data, setData] = useState<BookingChannelsData | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [autoAssign, setAutoAssign] = useState(false)
  const [saving, setSaving] = useState(false)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setStatus('loading')
    try {
      const response = await fetchApi<{ success: boolean; data: BookingChannelsData }>(
        `/api/booking/admin/channels?account_id=${encodeURIComponent(accountId)}`,
      )
      if (requestId !== requestRef.current) return
      setData(response.data)
      setAutoAssign(response.data.autoAssign)
      setStatus('ready')
    } catch {
      if (requestId !== requestRef.current) return
      setData(null)
      setStatus('error')
    }
  }, [accountId])

  useEffect(() => {
    void load()
    return () => {
      requestRef.current += 1
    }
  }, [load])

  async function saveAutoAssign(next: boolean) {
    if (!canEdit || saving) return
    const previous = autoAssign
    setAutoAssign(next)
    setSaving(true)
    try {
      await fetchApi<{ success: boolean }>(
        `/api/booking/admin/channels/settings?account_id=${encodeURIComponent(accountId)}`,
        { method: 'PUT', body: JSON.stringify({ autoAssign: next }) },
      )
      notifyToast(next ? '自動割り当てを入れました。' : '自動割り当てを止めました。')
    } catch {
      setAutoAssign(previous)
      notifyToast('自動割り当てを保存できませんでした。')
    } finally {
      setSaving(false)
    }
  }

  if (status === 'loading' || !data) {
    return status === 'error'
      ? (
        <ListState
          kind="error"
          title="予約経路を読み込めませんでした"
          description="入力内容は変わりません。もう一度お試しください。"
          action={<Button onClick={() => void load()}>もう一度読む</Button>}
        />
        )
      : (
        <ListState kind="loading" description="予約経路を読み込んでいます。" />
        )
  }

  const staffRows = data.staff
  const channelRows = data.channels.map((channel) => ({
    ...channel,
    meta: BOOKING_CHANNEL_META[channel.key] ?? { name: channel.key, sub: '', how: '' },
  }))

  return (
    <>
      <Band tone="hint">いちばん確かなのは「スタッフの Google カレンダー」です。ほかの予約サービスがスタッフの Google カレンダーへ予約を書き出せれば、その時間は自動で LINE の予約受付から外れます（いまの作りでできます）。</Band>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>スタッフの Google カレンダー</h2>
          <p className={styles.sectionDesc}>カレンダーの予定は「埋まっている時間」として扱います。LINE で入った予約は、そのスタッフのカレンダーに書き込みます。</p>
        </div>
        <div data-design="Table">
          <DataTable>
            <TableHeadRow>
              <Th>スタッフ</Th>
              <Th>状態</Th>
              <Th>外の予定（今週）</Th>
              <Th>最後に読んだ</Th>
              <Th>操作</Th>
            </TableHeadRow>
            {staffRows.map((person) => {
              const badge = channelStatusBadge(person.status)
              const operation = person.status === 'connected'
                ? { label: '予定を見る', href: `/booking/staff/shifts?staff_id=${encodeURIComponent(person.staffId)}` }
                : person.status === 'expired'
                  ? { label: 'つなぎ直す', href: `/booking/staff/shifts?staff_id=${encodeURIComponent(person.staffId)}` }
                  : { label: 'つなぐ', href: `/booking/staff/shifts?staff_id=${encodeURIComponent(person.staffId)}` }
              return (
                <Tr key={person.staffId}>
                  <Td>{person.displayName}</Td>
                  <Td><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></Td>
                  <Td>{person.externalEventsThisWeek == null ? '—' : `${formatNumber(person.externalEventsThisWeek)}件`}</Td>
                  <Td>{person.lastReadAt ? formatDateTime(person.lastReadAt, '—', undefined, data.timeZone) : '—'}</Td>
                  <ActionCell>
                    <Button size="compact" href={operation.href}>{operation.label}</Button>
                  </ActionCell>
                </Tr>
              )
            })}
          </DataTable>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>予約経路</h2>
          <p className={styles.sectionDesc}>どこから入った予約も「予約管理」に集めます。入り口ごとの受け取り方と、今日の件数です。</p>
        </div>
        <div data-design="Table">
          <DataTable>
            <TableHeadRow>
              <Th>予約経路</Th>
              <Th>受け取り方</Th>
              <Th>状態</Th>
              <Th>今日</Th>
              <Th>最後に届いた</Th>
              <Th>操作</Th>
            </TableHeadRow>
            {channelRows.map((channel) => {
              const badge = channelStatusBadge(channel.status)
              const active = channel.status === 'active'
              return (
                <Tr key={channel.key}>
                  <Td>
                    <span className={styles.cellText}>{channel.meta.name}</span>
                    {channel.meta.sub ? <span className={styles.cellSub}>{channel.meta.sub}</span> : null}
                  </Td>
                  <Td>{channel.meta.how}</Td>
                  <Td><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></Td>
                  <Td>{channel.todayCount == null ? '—' : `${formatNumber(channel.todayCount)}件`}</Td>
                  <Td>—</Td>
                  <ActionCell>
                    {active ? <Button size="compact" href="/booking/bookings">予約管理へ</Button> : null}
                  </ActionCell>
                </Tr>
              )
            })}
          </DataTable>
        </div>
        <p className={styles.noteText}>Google カレンダーに書き出せない入り口は、予約通知メールを取り込みアドレスへ転送して読み取ります（見本のメールがそろった媒体から順に）。</p>
      </section>

      <section className={styles.section} data-design-node="wJYQb" data-design="Rules">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>外から予約が入ったとき</h2>
          <p className={styles.sectionDesc}>どの入り口から入っても、同じ決まりでスタッフの空きを合わせます。</p>
        </div>
        <fieldset disabled={!canEdit} className="contents">
          <div className={styles.toggleRow}>
            <span className={styles.toggleRowLabel}>指名なしの予約は、その時間に空いているスタッフへ自動で割り当て</span>
            <Toggle
              label="指名なしの予約は、その時間に空いているスタッフへ自動で割り当て"
              checked={autoAssign}
              onChange={(next) => void saveAutoAssign(next)}
            />
          </div>
        </fieldset>
      </section>
    </>
  )
}
