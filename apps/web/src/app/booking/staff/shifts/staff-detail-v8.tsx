'use client'

/*
 * ★V8「勤務とシフト」（板 d5fmnM・管理者用）と「自分の勤務」
 * （板 E3YDK・スタッフ本人）＋ひも付けなしの案内（板 wvGke）。
 *
 * 白い板1枚：頭（管理者は「←担当スタッフへ」・題・説明、本人は題・説明＋
 * ひも付けの案内帯）→ 中身（左＝担当者の切り替え・いつもの勤務時間・休憩・
 * この日だけ・何週分かのシフト・Google カレンダー、右＝LIFF の日時選択の
 * 見本）。
 *
 * 「この日だけ（休み・シフト・休憩）」は板どおり1つの段にまとめる：
 * 休み＝スタッフ単位の例外日（scopeKind: 'staff'・kind 'closed'、
 * メモは reason）、この日のシフト＝既存の shifts、
 * この日の休憩＝既存の break-dates。
 *
 * 動き（読み込み・保存・版の競合・権限での閲覧のみ化・失敗時の扱い）は
 * v7 の /booking/staff/shifts と同じ。テーマが v7 のときはこのファイルは
 * 読まれず、従来の見た目が出る。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePageTitle } from '@/components/shell/page-chrome'
import {
  ApiError,
  bookingApi,
  type BookingAvailabilitySlot,
  type BookingBreakConflict,
  type BookingException,
  type BookingMenu,
  type BookingShift,
  type BookingStaff,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { canEditFeature, canViewFeature } from '@/lib/staff-capability'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import DateField from '@/components/shared/date-field'
import { TimeField } from '@/components/shared/date-time-field'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import ListState from '@/components/shared/list-state'
import { formatDay } from '@/lib/format'
import { LiffPhoneDatetimeStep } from '../../menus/liff-phone-v8'
import shell from '../../menus/settings-v8.module.css'
import styles from './staff-detail-v8.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'

const STAFF_DAYS = [
  { weekday: 1, label: '月曜日', short: '月' },
  { weekday: 2, label: '火曜日', short: '火' },
  { weekday: 3, label: '水曜日', short: '水' },
  { weekday: 4, label: '木曜日', short: '木' },
  { weekday: 5, label: '金曜日', short: '金' },
  { weekday: 6, label: '土曜日', short: '土' },
  { weekday: 0, label: '日曜日', short: '日' },
] as const

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** 店舗の時間帯での「今日」(YYYY-MM-DD)。枠の範囲決めだけに使う。 */
function todayKey(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/** YYYY-MM-DDに日数を足す。UTC上の計算なので夏時間の影響を受けない。 */
function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

function staffErrorMessage(error: unknown, action: string): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return `担当者の設定を${action}する権限がありません。オーナーか管理者に頼んでください。`
    if (error.status === 404) return '担当者が見つかりませんでした。削除された可能性があります。一覧に戻って選び直してください。'
    if (error.status === 409) return 'ほかの変更と重なりました。最新の状態を読み直したので、確かめてからもう一度保存してください。'
  }
  return `担当者の設定を${action}できませんでした。入力はそのまま残しています。通信状態を確認して、もう一度お試しください。`
}

function asBreakConflict(data: unknown): BookingBreakConflict | null {
  if (!data || typeof data !== 'object') return null
  const candidate = data as { version?: unknown; breaks?: unknown }
  if (typeof candidate.version !== 'string' || !Array.isArray(candidate.breaks)) return null
  return candidate as BookingBreakConflict
}

type RuleDraft = { active: boolean; start: string; end: string }

const EMPTY_RULE_DRAFT: RuleDraft = { active: false, start: '09:00', end: '19:00' }

/** 「この日だけ」の行の足す種別。 */
type DayAddKind = 'closed' | 'shift' | 'break'

/** 「この日だけ」の行（休みの例外日・この日のシフト・この日の休憩を1列にまとめる）。 */
type DayRow =
  | { kind: 'exception'; date: string; item: BookingException }
  | { kind: 'shift'; date: string; item: BookingShift }
  | { kind: 'break'; date: string; item: { key: string; id: string | null; start: string; end: string } }

function exceptionBadge(item: BookingException): string {
  if (item.kind === 'closed') return '休み'
  const first = item.intervals[0]
  return first ? `${first.start}〜${first.end}` : '時間を変える'
}

export default function StaffDetailV8({ staffId }: { staffId: string }) {
  usePageTitle('予約設定')
  const router = useRouter()
  const { selectedAccountId, selectedAccount } = useAccount()
  const [staffList, setStaffList] = useState<BookingStaff[]>([])
  const [staffMissing, setStaffMissing] = useState(false)
  // N-411 本人勤務: staff ロールは自分に紐づく予約スタッフだけを対象にする。
  // 他人の staff_id を直指定しても Worker 側が 403 で拒否するが、
  // 画面側でも「見せない」に揃える。
  const [isStaffRole] = useState(() =>
    typeof window !== 'undefined' && window.localStorage.getItem('lh_staff_role') === 'staff')
  const [ownStaffId, setOwnStaffId] = useState<string | null>(null)
  const [canEditOwn] = useState(() =>
    typeof window === 'undefined' ? true : canEditFeature('booking.staff.own'))
  /*
   * 「この日だけの休み」は例外日の口（booking.settings 権限）。
   * 権限が無い人には選ばせない（選んでも 403 で止まる）。
   */
  const [canEditExceptions] = useState(() =>
    typeof window === 'undefined' ? true : canEditFeature('booking.settings'))
  const [timeZone, setTimeZone] = useState('Asia/Tokyo')
  const [storeExceptions, setStoreExceptions] = useState<Array<{ dateFrom: string; dateTo: string; kind: string }>>([])
  const [staffExceptions, setStaffExceptions] = useState<BookingException[]>([])
  const [closedWeekdays, setClosedWeekdays] = useState<number[]>([])
  const [liffDateView, setLiffDateView] = useState<'list' | 'calendar'>('list')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [previewMenu, setPreviewMenu] = useState<BookingMenu | null>(null)
  const [hasActiveMenu, setHasActiveMenu] = useState(true)
  const [rules, setRules] = useState<Record<number, { start: string; end: string }>>({})
  const [draft, setDraft] = useState<Record<number, RuleDraft>>({})
  const [shifts, setShifts] = useState<BookingShift[]>([])
  const [shiftRows, setShiftRows] = useState<Record<string, { start: string; end: string }>>({})
  const [calendarId, setCalendarId] = useState<string | null>(null)
  const [calendarVerifiedAt, setCalendarVerifiedAt] = useState<string | null>(null)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [serviceConfigured, setServiceConfigured] = useState(true)
  const [slots, setSlots] = useState<BookingAvailabilitySlot[]>([])
  const [previewError, setPreviewError] = useState(false)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [ruleError, setRuleError] = useState<string | null>(null)
  const [savingRules, setSavingRules] = useState(false)
  const [rulesSavedAt, setRulesSavedAt] = useState<string | null>(null)
  const [breakRows, setBreakRows] = useState<Array<{ key: string; id: string | null; weekday: number; start: string; end: string }>>([])
  const [breaksVersion, setBreaksVersion] = useState('')
  const [breakError, setBreakError] = useState<string | null>(null)
  const [savingBreaks, setSavingBreaks] = useState(false)
  const [breaksSavedAt, setBreaksSavedAt] = useState<string | null>(null)
  const [dateRows, setDateRows] = useState<Array<{ key: string; id: string | null; date: string; start: string; end: string }>>([])
  const [breakDatesVersion, setBreakDatesVersion] = useState('')
  const [shiftError, setShiftError] = useState<string | null>(null)
  const [savingShift, setSavingShift] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<DayRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [genFrom, setGenFrom] = useState('')
  const [genWeeks, setGenWeeks] = useState('4')
  const [genError, setGenError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generatedCount, setGeneratedCount] = useState<number | null>(null)
  const [calendarInput, setCalendarInput] = useState('')
  const [calendarFormError, setCalendarFormError] = useState<string | null>(null)
  const [savingCalendar, setSavingCalendar] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  /* 「この日を足す」の内側の入力。休みは時間を持たない。 */
  const [dayAddOpen, setDayAddOpen] = useState(false)
  const [dayAddKind, setDayAddKind] = useState<DayAddKind>('shift')
  const [dayAddDate, setDayAddDate] = useState('')
  const [dayAddStart, setDayAddStart] = useState('09:00')
  const [dayAddEnd, setDayAddEnd] = useState('19:00')
  const [dayAddMemo, setDayAddMemo] = useState('')
  const [dayAddBusy, setDayAddBusy] = useState(false)
  /* この日だけの行の時間を直すとき、開いている行（シフトのID／休憩のkey）。 */
  const [editingDayRow, setEditingDayRow] = useState<string | null>(null)
  const requestRef = useRef(0)

  const staff = useMemo(
    () => staffList.find((item) => item.id === staffId) ?? null,
    [staffList, staffId],
  )

  const loadAvailability = useCallback(async (
    accountId: string,
    activeMenuId: string,
    zone: string,
    requestId: number,
  ) => {
    const from = todayKey(zone)
    try {
      const availability = await bookingApi.getAvailability(accountId, {
        menuId: activeMenuId,
        staffId,
        from,
        to: addDays(from, 13),
      })
      if (requestId !== requestRef.current) return
      setSlots(availability.by_staff.flatMap((item) => item.slots))
      setPreviewError(false)
    } catch {
      if (requestId !== requestRef.current) return
      setSlots([])
      setPreviewError(true)
    }
  }, [staffId])

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    if (!selectedAccountId) {
      setStaffList([])
      setLoadStatus('ready')
      return
    }
    setLoadStatus('loading')
    setStaffMissing(false)
    setPreviewError(false)
    setRuleError(null)
    setShiftError(null)
    try {
      const [staffRes, settingsRes, menuRes, exceptionsRes] = await Promise.all([
        // staff ロールは本人の予約スタッフだけを /staff/me から解決する。
        // 一覧口は '/booking/bookings' 権限が要るため、本人勤務だけの人は通らない。
        isStaffRole
          ? bookingApi.listMyStaff(selectedAccountId)
          : bookingApi.listStaff(selectedAccountId),
        bookingApi.getSettings(selectedAccountId).catch(() => null),
        bookingApi.listMenus(selectedAccountId).catch(() => null),
        // この日だけの休み。閲覧権限が無い人は null で、行が無いだけの表示にする。
        bookingApi.listExceptions(selectedAccountId).catch(() => null),
      ])
      if (requestId !== requestRef.current) return
      // 管理者経路は従来どおり設定取得失敗をエラーとして扱う。
      // staff ロール（本人勤務）は設定閲覧権限が無くても自分の勤務を見られるよう
      // 取得失敗を許容し、プレビュー関連だけ既定値へ落とす。
      if (!isStaffRole && (!settingsRes || !settingsRes.success)) {
        throw new Error(settingsRes?.success === false ? settingsRes.error : 'settings_load_failed')
      }
      const found = staffRes.staff.find((item) => item.id === staffId) ?? null
      if (!found) {
        setStaffList(staffRes.staff)
        // staff ロールは /staff/me が本人分だけ返すので、不一致は「権限外」として扱う。
        if (isStaffRole && staffRes.staff.length > 0) setOwnStaffId(staffRes.staff[0].id)
        setStaffMissing(true)
        setLoadStatus('ready')
        return
      }
      const zone = settingsRes?.success ? (settingsRes.data.timeZone || 'Asia/Tokyo') : 'Asia/Tokyo'
      const activeMenu = menuRes?.menus.find((item) => item.is_active) ?? null
      setStaffList(staffRes.staff)
      setTimeZone(zone)
      const allExceptions = settingsRes?.success ? settingsRes.data.exceptions ?? [] : []
      setStoreExceptions(allExceptions
        .filter((item) => !item.scopeKind || item.scopeKind === 'store')
        .map((item) => ({
          dateFrom: item.dateFrom || item.date || '',
          dateTo: item.dateTo || item.date || '',
          kind: item.kind,
        })))
      setStaffExceptions((exceptionsRes?.data?.items ?? [])
        .filter((item) => item.scopeKind === 'staff' && item.scopeId === staffId))
      setClosedWeekdays(settingsRes?.success && settingsRes.data.businessHoursConfigured
        ? STAFF_DAYS.filter(({ weekday }) =>
          (settingsRes.data.businessHours.find((day) => day.weekday === weekday)?.intervals.length ?? 0) === 0,
        ).map(({ weekday }) => weekday)
        : [])
      setLiffDateView(settingsRes?.success ? settingsRes.data.liffDateView : 'list')
      setMenuId(activeMenu ? activeMenu.id : null)
      setPreviewMenu(activeMenu)
      setHasActiveMenu(activeMenu !== null)
      setGenFrom((current) => current || todayKey(zone))
      const [rulesRes, shiftsRes, breaksRes, breakDatesRes, calendarRes] = await Promise.all([
        bookingApi.getAvailabilityRules(selectedAccountId, staffId),
        bookingApi.getShifts(selectedAccountId, staffId),
        bookingApi.getBreaks(selectedAccountId, staffId),
        bookingApi.getBreakDates(selectedAccountId, staffId),
        bookingApi.getGoogleCalendar(selectedAccountId, staffId),
      ])
      if (requestId !== requestRef.current) return
      const savedRules: Record<number, { start: string; end: string }> = {}
      const nextDraft: Record<number, RuleDraft> = {}
      for (const day of STAFF_DAYS) {
        const rule = rulesRes.rules.find((item) => item.weekday === day.weekday)
        if (rule) {
          savedRules[day.weekday] = { start: rule.start_time, end: rule.end_time }
          nextDraft[day.weekday] = { active: true, start: rule.start_time, end: rule.end_time }
        } else {
          nextDraft[day.weekday] = { ...EMPTY_RULE_DRAFT }
        }
      }
      setRules(savedRules)
      setDraft(nextDraft)
      setRulesSavedAt(null)
      setBreakRows(breaksRes.breaks.map((item) => ({
        key: item.id,
        id: item.id,
        weekday: item.weekday,
        start: item.start_time,
        end: item.end_time,
      })))
      setBreaksVersion(breaksRes.version)
      setBreaksSavedAt(null)
      setBreakError(null)
      setDateRows(breakDatesRes.breaks.map((item) => ({
        key: item.id,
        id: item.id,
        date: item.work_date,
        start: item.start_time,
        end: item.end_time,
      })))
      setBreakDatesVersion(breakDatesRes.version)
      setShifts(shiftsRes.shifts)
      const rows: Record<string, { start: string; end: string }> = {}
      for (const shift of shiftsRes.shifts) {
        rows[shift.id] = { start: shift.start_time, end: shift.end_time }
      }
      setShiftRows(rows)
      setGeneratedCount(null)
      setCalendarId(calendarRes.connection?.calendar_id ?? null)
      setCalendarVerifiedAt(calendarRes.connection?.last_verified_at ?? null)
      setCalendarError(calendarRes.connection?.last_error ?? null)
      setServiceConfigured(calendarRes.service_account.configured)
      setCalendarInput('')
      setCalendarFormError(null)
      setLoadStatus('ready')
      if (activeMenu) {
        await loadAvailability(selectedAccountId, activeMenu.id, zone, requestId)
      } else {
        setSlots([])
      }
    } catch (error) {
      if (requestId !== requestRef.current) return
      if (error instanceof ApiError && error.status === 404) {
        setStaffMissing(true)
        setLoadStatus('ready')
        return
      }
      setLoadStatus('error')
    }
  }, [selectedAccountId, staffId, isStaffRole, loadAvailability])

  useEffect(() => {
    void load()
    return () => {
      requestRef.current += 1
    }
  }, [load, reloadKey])

  /** 保存が効いたあとは、保存した口を読み直して予約枠も取り直す。 */
  async function refreshAfterSave() {
    if (!selectedAccountId) return
    const requestId = requestRef.current
    try {
      const [rulesRes, shiftsRes, breaksRes, breakDatesRes, exceptionsRes] = await Promise.all([
        bookingApi.getAvailabilityRules(selectedAccountId, staffId),
        bookingApi.getShifts(selectedAccountId, staffId),
        bookingApi.getBreaks(selectedAccountId, staffId),
        bookingApi.getBreakDates(selectedAccountId, staffId),
        bookingApi.listExceptions(selectedAccountId).catch(() => null),
      ])
      if (requestId !== requestRef.current) return
      const savedRules: Record<number, { start: string; end: string }> = {}
      const nextDraft: Record<number, RuleDraft> = {}
      for (const day of STAFF_DAYS) {
        const rule = rulesRes.rules.find((item) => item.weekday === day.weekday)
        if (rule) {
          savedRules[day.weekday] = { start: rule.start_time, end: rule.end_time }
          nextDraft[day.weekday] = { active: true, start: rule.start_time, end: rule.end_time }
        } else {
          nextDraft[day.weekday] = { ...EMPTY_RULE_DRAFT }
        }
      }
      setRules(savedRules)
      setDraft(nextDraft)
      setBreakRows(breaksRes.breaks.map((item) => ({
        key: item.id,
        id: item.id,
        weekday: item.weekday,
        start: item.start_time,
        end: item.end_time,
      })))
      setBreaksVersion(breaksRes.version)
      setDateRows(breakDatesRes.breaks.map((item) => ({
        key: item.id,
        id: item.id,
        date: item.work_date,
        start: item.start_time,
        end: item.end_time,
      })))
      setBreakDatesVersion(breakDatesRes.version)
      if (exceptionsRes) {
        setStaffExceptions(exceptionsRes.data.items
          .filter((item) => item.scopeKind === 'staff' && item.scopeId === staffId))
      }
      setShifts(shiftsRes.shifts)
      const rows: Record<string, { start: string; end: string }> = {}
      for (const shift of shiftsRes.shifts) {
        rows[shift.id] = { start: shift.start_time, end: shift.end_time }
      }
      setShiftRows(rows)
      if (menuId) {
        await loadAvailability(selectedAccountId, menuId, timeZone, requestId)
      }
    } catch {
      if (requestId !== requestRef.current) return
      setPreviewError(true)
    }
  }

  function updateDraft(weekday: number, patch: Partial<RuleDraft>) {
    setDraft((current) => ({ ...current, [weekday]: { ...EMPTY_RULE_DRAFT, ...current[weekday], ...patch } }))
  }

  async function saveRules() {
    if (!selectedAccountId) return
    const payload: Array<{ weekday: number; start_time: string; end_time: string }> = []
    for (const day of STAFF_DAYS) {
      const row = draft[day.weekday] ?? EMPTY_RULE_DRAFT
      if (!row.active) continue
      if (!HHMM.test(row.start) || !HHMM.test(row.end) || row.start >= row.end) {
        setRuleError(`${day.label}の時間を正しく入れてください（終わりは始まりより後にします）。入力はそのまま残しています。`)
        return
      }
      payload.push({ weekday: day.weekday, start_time: row.start, end_time: row.end })
    }
    setSavingRules(true)
    setRuleError(null)
    try {
      // 2回目以降の保存も同じ週全体を置き換えるので、古い曜日が残らない。
      await bookingApi.putAvailabilityRules(selectedAccountId, staffId, payload)
      setRulesSavedAt(new Date().toISOString())
      setRuleError(null)
      await refreshAfterSave()
    } catch (error) {
      // 保存に失敗しても入力(draft)は消さない。
      setRuleError(staffErrorMessage(error, '保存'))
    } finally {
      setSavingRules(false)
    }
  }

  function weekdayName(weekday: number): string {
    return STAFF_DAYS.find((day) => day.weekday === weekday)?.label ?? '不明な曜日'
  }

  function updateBreakRow(key: string, patch: Partial<{ weekday: number; start: string; end: string }>) {
    setBreakRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  /*
   * ★V8 の「休憩を足す」は欄なしで1行増えるだけ（板の「＋休憩を足す」）。
   * 足した行は下書きで、「保存」でまとめて確定する（v7 と同じ置き換え口）。
   */
  function addBreakRow() {
    setBreakError(null)
    setBreakRows((current) => [
      ...current,
      { key: `new-${Date.now()}-${current.length}`, id: null, weekday: 1, start: '12:00', end: '13:00' },
    ])
  }

  async function saveBreaks() {
    if (!selectedAccountId) return
    for (const row of breakRows) {
      if (!validRange(row.start, row.end)) {
        setBreakError(`${weekdayName(row.weekday)}の時間を正しく入れてください（終わりは始まりより後にします）。入力はそのまま残しています。`)
        return
      }
    }
    setSavingBreaks(true)
    setBreakError(null)
    try {
      // 版付きで週全体を置き換える。消した行は残らず、2回目の保存も残る。
      const result = await bookingApi.putBreaks(
        selectedAccountId,
        staffId,
        breaksVersion,
        breakRows.map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          weekday: row.weekday,
          start_time: row.start,
          end_time: row.end,
        })),
      )
      setBreakRows(result.breaks.map((item) => ({
        key: item.id,
        id: item.id,
        weekday: item.weekday,
        start: item.start_time,
        end: item.end_time,
      })))
      setBreaksVersion(result.version)
      setBreaksSavedAt(new Date().toISOString())
    } catch (error) {
      // 409のときだけ最新の状態へ描き直す。それ以外は入力(breakRows)を消さない。
      const conflict = error instanceof ApiError && error.status === 409
        ? asBreakConflict(error.data)
        : null
      if (conflict) {
        setBreakRows(conflict.breaks
          .filter((item) => item.weekday != null)
          .map((item) => ({
            key: item.id,
            id: item.id,
            weekday: item.weekday ?? 1,
            start: item.start_time,
            end: item.end_time,
          })))
        setBreaksVersion(conflict.version)
      }
      setBreakError(staffErrorMessage(error, '保存'))
    } finally {
      setSavingBreaks(false)
    }
  }

  function updateDateRow(key: string, patch: Partial<{ date: string; start: string; end: string }>) {
    setDateRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  /**
   * ★V8 では「この日だけの休憩」は「この日だけ」の段に入り、足したり
   * 消したりした時点で版付きの全体置き換えを即時に送る（下書きを持たない）。
   */
  async function saveBreakDates(nextRows: Array<{ key: string; id: string | null; date: string; start: string; end: string }>) {
    if (!selectedAccountId) return
    for (const row of nextRows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !validRange(row.start, row.end)) {
        setShiftError(`${formatDay(row.date)}の日時を正しく入れてください。入力はそのまま残しています。`)
        return
      }
    }
    setSavingShift(true)
    setShiftError(null)
    try {
      const result = await bookingApi.putBreakDates(
        selectedAccountId,
        staffId,
        breakDatesVersion,
        nextRows.map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          work_date: row.date,
          start_time: row.start,
          end_time: row.end,
        })),
      )
      setDateRows(result.breaks.map((item) => ({
        key: item.id,
        id: item.id,
        date: item.work_date,
        start: item.start_time,
        end: item.end_time,
      })))
      setBreakDatesVersion(result.version)
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409
        ? asBreakConflict(error.data)
        : null
      if (conflict) {
        setDateRows(conflict.breaks
          .filter((item) => item.work_date != null)
          .map((item) => ({
            key: item.id,
            id: item.id,
            date: item.work_date ?? '',
            start: item.start_time,
            end: item.end_time,
          })))
        setBreakDatesVersion(conflict.version)
      }
      setShiftError(staffErrorMessage(error, '保存'))
    } finally {
      setSavingShift(false)
    }
  }

  function updateShiftRow(id: string, patch: Partial<{ start: string; end: string }>) {
    setShiftRows((current) => {
      const prev = current[id] ?? { start: '', end: '' }
      return { ...current, [id]: { ...prev, ...patch } }
    })
  }

  function validRange(start: string, end: string): boolean {
    return HHMM.test(start) && HHMM.test(end) && start < end
  }

  async function saveShiftRow(shift: BookingShift) {
    if (!selectedAccountId) return
    const row = shiftRows[shift.id] ?? { start: shift.start_time, end: shift.end_time }
    if (!validRange(row.start, row.end)) {
      setShiftError(`${formatDay(shift.work_date)}の時間を正しく入れてください（終わりは始まりより後にします）。入力はそのまま残しています。`)
      return
    }
    setSavingShift(true)
    setShiftError(null)
    try {
      // 同じ日は上書きになるので、2回目の保存が残る。
      await bookingApi.putShifts(selectedAccountId, staffId, [
        { work_date: shift.work_date, start_time: row.start, end_time: row.end },
      ])
      setEditingDayRow(null)
      await refreshAfterSave()
    } catch (error) {
      setShiftError(staffErrorMessage(error, '保存'))
    } finally {
      setSavingShift(false)
    }
  }

  /** 「この日を足す」の確定。種別ごとに既存の口へ送る。 */
  async function addDayEntry() {
    if (!selectedAccountId) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayAddDate)) {
      setShiftError('日付をカレンダーから選んでください。入力はそのまま残しています。')
      return
    }
    if (dayAddKind !== 'closed' && !validRange(dayAddStart, dayAddEnd)) {
      setShiftError('時間を正しく入れてください（終わりは始まりより後にします）。入力はそのまま残しています。')
      return
    }
    setDayAddBusy(true)
    setShiftError(null)
    try {
      if (dayAddKind === 'closed') {
        const res = await bookingApi.createException(selectedAccountId, {
          scopeKind: 'staff',
          scopeId: staffId,
          dateFrom: dayAddDate,
          dateTo: dayAddDate,
          kind: 'closed',
          intervals: [],
          reason: dayAddMemo.trim() || null,
        })
        if (!res.success) throw new Error('exception_save_failed')
        setStaffExceptions((current) => [...current, res.data])
      } else if (dayAddKind === 'shift') {
        await bookingApi.putShifts(selectedAccountId, staffId, [
          { work_date: dayAddDate, start_time: dayAddStart, end_time: dayAddEnd },
        ])
        await refreshAfterSave()
      } else {
        await saveBreakDates([
          ...dateRows,
          { key: `new-${Date.now()}`, id: null, date: dayAddDate, start: dayAddStart, end: dayAddEnd },
        ])
      }
      setDayAddOpen(false)
      setDayAddDate('')
      setDayAddMemo('')
    } catch (error) {
      setShiftError(staffErrorMessage(error, '追加'))
    } finally {
      setDayAddBusy(false)
    }
  }

  /** この日だけの行の削除。種別ごとに既存の口を使う。 */
  async function removeDayEntry() {
    if (!selectedAccountId || !removeTarget) return
    setDeleting(true)
    try {
      if (removeTarget.kind === 'shift') {
        await bookingApi.deleteShift(selectedAccountId, staffId, removeTarget.item.id)
      } else if (removeTarget.kind === 'exception') {
        const res = await bookingApi.deleteException(selectedAccountId, removeTarget.item.id, removeTarget.item.version)
        if (!res.success) throw new Error('exception_delete_failed')
      } else {
        await saveBreakDates(dateRows.filter((row) => row.key !== removeTarget.item.key))
      }
      setRemoveTarget(null)
      await refreshAfterSave()
    } catch (error) {
      setShiftError(staffErrorMessage(error, '削除'))
    } finally {
      setDeleting(false)
    }
  }

  async function generateFromRules() {
    if (!selectedAccountId) return
    const weeks = Number.parseInt(genWeeks, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(genFrom) || !Number.isInteger(weeks) || weeks < 1 || weeks > 12) {
      setGenError('開始日と週の数（1〜12）を正しく入れてください。')
      return
    }
    const template: Record<string, { start: string; end: string } | null> = {}
    const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
    for (const [index, key] of keys.entries()) {
      const saved = rules[index]
      template[key] = saved ? { start: saved.start, end: saved.end } : null
    }
    if (Object.values(template).every((item) => item === null)) {
      setGenError('いつもの勤務時間が空なので作れません。先に曜日ごとの時間を保存してください。')
      return
    }
    setGenerating(true)
    setGenError(null)
    try {
      // すでにある日は残す（上書きしない）ので、直したシフトが消えない。
      const result = await bookingApi.generateShifts(selectedAccountId, staffId, {
        from_date: genFrom,
        weeks,
        weekly_template: template,
      })
      setGeneratedCount(result.inserted)
      await refreshAfterSave()
    } catch (error) {
      setGenError(staffErrorMessage(error, '作成'))
    } finally {
      setGenerating(false)
    }
  }

  async function connectCalendar() {
    if (!selectedAccountId) return
    const trimmed = calendarInput.trim()
    if (!trimmed) {
      setCalendarFormError('カレンダーのIDを入れてください。')
      return
    }
    setSavingCalendar(true)
    setCalendarFormError(null)
    try {
      const result = await bookingApi.putGoogleCalendar(selectedAccountId, staffId, trimmed)
      setCalendarId(result.calendar_id)
      setCalendarVerifiedAt(result.last_verified_at)
      setCalendarError(null)
      setCalendarInput('')
      if (menuId) {
        await loadAvailability(selectedAccountId, menuId, timeZone, requestRef.current)
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setCalendarFormError('Googleの接続設定がまだなのでつなげません。管理者に連絡してください。入力はそのまま残しています。')
      } else if (error instanceof ApiError && error.status === 422) {
        setCalendarFormError('そのカレンダーに届きませんでした。IDを確かめてください。入力はそのまま残しています。')
      } else {
        setCalendarFormError(staffErrorMessage(error, '保存'))
      }
    } finally {
      setSavingCalendar(false)
    }
  }

  async function disconnectCalendar() {
    if (!selectedAccountId) return
    setDisconnecting(true)
    try {
      await bookingApi.deleteGoogleCalendar(selectedAccountId, staffId)
      setConfirmDisconnect(false)
      setCalendarId(null)
      setCalendarVerifiedAt(null)
      setCalendarError(null)
      if (menuId) {
        await loadAvailability(selectedAccountId, menuId, timeZone, requestRef.current)
      }
    } catch (error) {
      setCalendarFormError(staffErrorMessage(error, '削除'))
    } finally {
      setDisconnecting(false)
    }
  }

  const previewDates = useMemo(() => {
    const from = todayKey(timeZone)
    return Array.from({ length: 14 }, (_, index) => addDays(from, index))
  }, [timeZone])

  const previewMarks = useMemo(() => {
    const closed = new Set(
      storeExceptions.filter((item) => item.kind === 'closed').flatMap((item) => {
        const days: string[] = []
        for (let d = item.dateFrom; d <= item.dateTo && days.length < 40; d = addDays(d, 1)) days.push(d)
        return days
      }),
    )
    return previewDates.map((date) => {
      if (closed.has(date)) return { date, mark: '休' as const }
      const daySlots = slots.filter((slot) => slot.date === date)
      if (daySlots.length === 0) return { date, mark: '×' as const }
      return { date, mark: daySlots.some((slot) => slot.remaining > 0) ? '○' as const : '×' as const }
    })
  }, [previewDates, slots, storeExceptions])

  /** 「この日だけ」の行（例外日の休み・日ごとのシフト・この日だけの休憩を日付順で1列に）。 */
  const dayRows = useMemo<DayRow[]>(() => {
    const rows: DayRow[] = [
      ...staffExceptions.map((item) => ({
        kind: 'exception' as const,
        date: item.dateFrom,
        item,
      })),
      ...shifts.map((item) => ({ kind: 'shift' as const, date: item.work_date, item })),
      ...dateRows.map((item) => ({ kind: 'break' as const, date: item.date, item })),
    ]
    return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }, [staffExceptions, shifts, dateRows])

  const closedDates = useMemo(
    () => storeExceptions
      .filter((item) => item.kind === 'closed')
      .flatMap((item) => {
        const days: string[] = []
        for (let d = item.dateFrom; d <= item.dateTo && days.length < 40; d = addDays(d, 1)) days.push(d)
        return days
      }),
    [storeExceptions],
  )

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const previewUrl = selectedAccount?.liffId
    ? `${workerBase}/o?liffId=${encodeURIComponent(selectedAccount.liffId)}&page=salon-book`
    : null

  const headTitle = isStaffRole ? '自分の勤務' : '勤務とシフト'
  const headDesc = isStaffRole
    ? 'あなたの出勤・休憩・この日だけのシフトと、Google カレンダーのつながりを決めます。ほかの人の勤務は管理者だけが開けます。'
    : '担当スタッフの出勤・休憩・この日だけのシフトと、Google カレンダーのつながりを決めます。'

  const boardHead = (node: string) => (
    <header className={shell.boardHead} data-design="Head">
      {isStaffRole ? null : (
        <Link href="/booking/menus?tab=staff" className={shell.backLink}>← 担当スタッフへ</Link>
      )}
      <h1 className={shell.headTitle}>{node === 'wvGke' ? '自分の勤務' : headTitle}</h1>
      <p className={shell.headNote}>{headDesc}</p>
    </header>
  )

  if (!selectedAccountId) {
    return (
      <div className={shell.shell} data-design-node={isStaffRole ? 'E3YDK' : 'd5fmnM'}>
        {boardHead('')}
        <div className={shell.body} data-design="Body">
          <div className={shell.main}>
            <div className={shell.stateCard}>
              <p className={shell.stateTitle}>LINEアカウントを選んでください</p>
              <p className={shell.stateDesc}>勤務とシフトを確認するアカウントを選びます。</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (loadStatus === 'loading') {
    return (
      <div className={shell.shell} data-design-node={isStaffRole ? 'E3YDK' : 'd5fmnM'}>
        {boardHead('')}
        <div className={shell.body} data-design="Body">
          <div className={shell.main}>
            <div className={shell.stateCard}>
              <p className={shell.stateTitle}>読み込み中</p>
              <p className={shell.stateDesc}>担当者の勤務とシフトを読み込んでいます。</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (loadStatus === 'error') {
    return (
      <div className={shell.shell} data-design-node={isStaffRole ? 'E3YDK' : 'd5fmnM'}>
        {boardHead('')}
        <div className={shell.body} data-design="Body">
          <div className={shell.main}>
            <div className={shell.stateCard}>
              <p className={shell.stateTitle}>担当者の勤務とシフトを表示できませんでした</p>
              <p className={shell.stateDesc}>保存済みの内容は消えていません。時間をおいて、もう一度読み込んでください。</p>
              <div className={shell.stateActions}>
                <Button onClick={() => setReloadKey((value) => value + 1)}>勤務とシフトを再読み込み</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (staffMissing || !staff) {
    // N-411: staff ロールで本人の予約スタッフ以外が指定された場合。
    if (isStaffRole) {
      return (
        <div className={shell.shell} data-design-node="wvGke">
          {boardHead('wvGke')}
          <div className={shell.body} data-design="Body">
            <div className={shell.main}>
              <div className={shell.stateCard}>
                <p className={shell.stateTitle}>{ownStaffId ? '自分の勤務だけを表示できます' : 'ひも付いた予約スタッフがありません'}</p>
                <p className={shell.stateDesc}>{ownStaffId
                  ? 'ほかの担当者の勤務は管理者だけが開けます。自分の勤務へ移動してください。'
                  : '管理者が予約スタッフとログインユーザーをひも付けると、ここで自分の勤務を決められます。'}</p>
                <div className={shell.stateActions}>
                  {ownStaffId
                    ? <Button href={`/booking/staff/shifts?staff_id=${ownStaffId}`}>自分の勤務を開く</Button>
                    : <Button href="/booking/bookings">予約の一覧へ戻る</Button>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className={shell.shell} data-design-node="d5fmnM">
        {boardHead('')}
        <div className={shell.body} data-design="Body">
          <div className={shell.main}>
            <div className={shell.stateCard}>
              <p className={shell.stateTitle}>担当者が見つかりませんでした</p>
              <p className={shell.stateDesc}>削除されたか、別のアカウントの担当者です。一覧から選び直してください。</p>
              <div className={shell.stateActions}>
                <Button href="/booking/menus?tab=staff">担当スタッフの一覧に戻る</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={shell.shell} data-design-node={isStaffRole ? 'E3YDK' : 'd5fmnM'}>
      {boardHead('')}

      <div className={shell.body} data-design="Body">
        <div className={shell.main}>
          {isStaffRole ? (
            <p className={shell.hintBand} data-design="Info">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>
                {staff.display_name}{staff.role ? `（${staff.role}）` : ''}としてひも付いています。ひも付けを変えるときは管理者に頼んでください。
              </span>
            </p>
          ) : (
            <div className={styles.switcherRow}>
              <label className={styles.switcherField}>
                <span className={styles.switcherLabel}>担当者を切り替える</span>
                <Select
                  aria-label="担当者を切り替える"
                  size="full"
                  value={staffId}
                  onChange={(value) => router.push(`/booking/staff/shifts?staff_id=${value}`)}
                  options={staffList.map((item) => ({ value: item.id, label: item.display_name }))}
                />
              </label>
              <p className={styles.switcherNote}>保存すると、右の予約画面にすぐ出ます。</p>
            </div>
          )}

          {/* N-411: 本人勤務が閲覧のみのときは全編集部品をまとめて無効化する。
              fieldset disabled で配下の入力・ボタンを一括で止める（API 側も 403 で拒否）。 */}
          <fieldset disabled={!canEditOwn} className="contents">
            {/* いつもの勤務時間 */}
            <section className={shell.section} data-design="Week">
              <div className={shell.sectionHeadRow}>
                <div className={shell.sectionHead}>
                  <h2 className={shell.sectionTitle}>いつもの勤務時間</h2>
                  <p className={shell.sectionDesc}>曜日ごとの出勤時間です。空けた曜日は枠が出ません。日ごとのシフトがある日はそちらが優先されます。</p>
                </div>
                <Button variant="primary" onClick={() => void saveRules()} disabled={savingRules} busy={savingRules}>保存</Button>
              </div>
              <div className={styles.dayList}>
                {STAFF_DAYS.map((day) => {
                  const row = draft[day.weekday] ?? EMPTY_RULE_DRAFT
                  return (
                    <div className={styles.dayRow} key={day.weekday}>
                      <strong className={styles.dayName}>{day.label.slice(0, 1)}</strong>
                      <Toggle
                        label={`${day.label}は出勤する`}
                        checked={row.active}
                        onChange={(checked) => updateDraft(day.weekday, { active: checked })}
                      />
                      {row.active ? (
                        <>
                          <span className={styles.dayState}>出る</span>
                          <TimeField
                            aria-label={`${day.label}の始まり`}
                            value={row.start}
                            onChange={(v) => updateDraft(day.weekday, { start: v })}
                          />
                          <span className={styles.dayTilde}>〜</span>
                          <TimeField
                            aria-label={`${day.label}の終わり`}
                            value={row.end}
                            onChange={(v) => updateDraft(day.weekday, { end: v })}
                          />
                        </>
                      ) : (
                        <>
                          <span className={styles.dayStateOff}>休み</span>
                          <span className={styles.dayOffNote}>この曜日は予約枠が出ません</span>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className={styles.footNote}>
                {rulesSavedAt ? <span className={styles.savedNote}>保存しました。右の予約画面に反映されています。</span> : null}
                {ruleError ? <p className={styles.fieldError} role="alert">{ruleError}</p> : null}
              </div>
            </section>

            {/* 休憩 */}
            <section className={shell.section} data-design="Breaks">
              <div className={shell.sectionHeadRow}>
                <div className={shell.sectionHead}>
                  <h2 className={shell.sectionTitle}>休憩</h2>
                  <p className={shell.sectionDesc}>いつもの勤務時間の中の休み時間です。休憩の時間は予約枠から除きます。</p>
                </div>
                <Button variant="primary" onClick={() => void saveBreaks()} disabled={savingBreaks} busy={savingBreaks}>保存</Button>
              </div>
              <div className={styles.rowList}>
                {breakRows.length === 0 ? (
                  <p className={shell.sectionDesc}>休憩はありません。</p>
                ) : breakRows.map((row) => (
                  <div key={row.key} className={styles.listRow}>
                    <Select
                      aria-label="休憩の曜日"
                      value={String(row.weekday)}
                      onChange={(value) => updateBreakRow(row.key, { weekday: Number(value) })}
                      options={STAFF_DAYS.map((day) => ({ value: String(day.weekday), label: day.label }))}
                      size="page-size"
                    />
                    <TimeField
                      aria-label="休憩の始まり"
                      value={row.start}
                      onChange={(v) => updateBreakRow(row.key, { start: v })}
                    />
                    <span className={styles.dayTilde}>〜</span>
                    <TimeField
                      aria-label="休憩の終わり"
                      value={row.end}
                      onChange={(v) => updateBreakRow(row.key, { end: v })}
                    />
                    <button
                      type="button"
                      onClick={() => setBreakRows((current) => current.filter((item) => item.key !== row.key))}
                      className={styles.trashButton}
                      aria-label={`${weekdayName(row.weekday)} ${row.start}〜${row.end} の休憩を削除`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className={styles.addRowButton} onClick={addBreakRow}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M7 3v8M3 7h8" /></svg>
                休憩を足す
              </button>
              <div className={styles.footNote}>
                {breaksSavedAt ? <span className={styles.savedNote}>保存しました。</span> : null}
                {breakError ? <p className={styles.fieldError} role="alert">{breakError}</p> : null}
              </div>
            </section>

            {/* この日だけ（休み・シフト・休憩） */}
            <section className={shell.section} data-design="Special">
              <div className={shell.sectionHead}>
                <h2 className={shell.sectionTitle}>この日だけ（休み・シフト・休憩）</h2>
                <p className={shell.sectionDesc}>その日だけ休む・時間を変える・休憩を足すときに使います。いつもの勤務時間より優先されます。</p>
              </div>
              <div className={styles.rowList}>
                {dayRows.length === 0 ? (
                  <p className={shell.sectionDesc}>この日だけの休み・シフト・休憩はありません。いつもの勤務時間どおりに枠が出ます。</p>
                ) : dayRows.map((row) => {
                  const rowKey = row.kind === 'shift' ? `shift-${row.item.id}` : row.kind === 'exception' ? `ex-${row.item.id}` : `br-${row.item.key}`
                  const isEditing = editingDayRow === rowKey
                  return (
                    <div key={rowKey} className={styles.dayEntry}>
                      <div className={styles.dayEntryRow}>
                        <span className={styles.dayEntryDate}>{formatDay(row.date)}</span>
                        {row.kind === 'exception' ? (
                          <span className={`${styles.dayBadge} ${styles.dayBadgeOff}`}>{exceptionBadge(row.item)}</span>
                        ) : row.kind === 'shift' ? (
                          <button
                            type="button"
                            className={`${styles.dayBadge} ${styles.dayBadgeShift} ${styles.dayBadgeButton}`}
                            onClick={() => setEditingDayRow(isEditing ? null : rowKey)}
                            aria-expanded={isEditing}
                            title="押すとこの日の時間を直せます"
                          >
                            {(shiftRows[row.item.id]?.start ?? row.item.start_time)}〜{(shiftRows[row.item.id]?.end ?? row.item.end_time)}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`${styles.dayBadge} ${styles.dayBadgeBreak} ${styles.dayBadgeButton}`}
                            onClick={() => setEditingDayRow(isEditing ? null : rowKey)}
                            aria-expanded={isEditing}
                            title="押すとこの日の休憩の時間を直せます"
                          >
                            休憩 {row.item.start}〜{row.item.end}
                          </button>
                        )}
                        <span className={styles.dayEntryMemo}>
                          {row.kind === 'exception' ? (row.item.reason ?? '') : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => setRemoveTarget(row)}
                          className={styles.trashButton}
                          aria-label={`${formatDay(row.date)} の${row.kind === 'exception' ? '休み' : row.kind === 'shift' ? 'シフト' : '休憩'}を削除`}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                      {isEditing && row.kind === 'shift' ? (
                        <div className={styles.dayEntryEdit}>
                          <TimeField
                            aria-label={`${formatDay(row.item.work_date)}の始まり`}
                            value={shiftRows[row.item.id]?.start ?? row.item.start_time}
                            onChange={(v) => updateShiftRow(row.item.id, { start: v })}
                          />
                          <span className={styles.dayTilde}>〜</span>
                          <TimeField
                            aria-label={`${formatDay(row.item.work_date)}の終わり`}
                            value={shiftRows[row.item.id]?.end ?? row.item.end_time}
                            onChange={(v) => updateShiftRow(row.item.id, { end: v })}
                          />
                          <Button variant="secondary" onClick={() => void saveShiftRow(row.item)} disabled={savingShift} busy={savingShift}>更新する</Button>
                        </div>
                      ) : null}
                      {isEditing && row.kind === 'break' ? (
                        <div className={styles.dayEntryEdit}>
                          <TimeField
                            aria-label={`${formatDay(row.date)}の休憩の始まり`}
                            value={row.item.start}
                            onChange={(v) => updateDateRow(row.item.key, { start: v })}
                          />
                          <span className={styles.dayTilde}>〜</span>
                          <TimeField
                            aria-label={`${formatDay(row.date)}の休憩の終わり`}
                            value={row.item.end}
                            onChange={(v) => updateDateRow(row.item.key, { end: v })}
                          />
                          <Button variant="secondary" onClick={() => { setEditingDayRow(null); void saveBreakDates(dateRows) }} disabled={savingShift} busy={savingShift}>更新する</Button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              {dayAddOpen ? (
                <div className={styles.dayAddForm}>
                  <Select
                    aria-label="足す種別"
                    value={dayAddKind}
                    onChange={(value) => setDayAddKind(value as DayAddKind)}
                    options={[
                      { value: 'shift', label: 'この日だけのシフト' },
                      { value: 'break', label: 'この日だけの休憩' },
                      ...(canEditExceptions ? [{ value: 'closed', label: 'この日だけの休み' }] : []),
                    ]}
                  />
                  <DateField aria-label="この日の日付" value={dayAddDate} onChange={setDayAddDate} />
                  {dayAddKind !== 'closed' ? (
                    <>
                      <TimeField aria-label="この日の始まり" value={dayAddStart} onChange={setDayAddStart} />
                      <span className={styles.dayTilde}>〜</span>
                      <TimeField aria-label="この日の終わり" value={dayAddEnd} onChange={setDayAddEnd} />
                    </>
                  ) : (
                    <input
                      type="text"
                      value={dayAddMemo}
                      onChange={(e) => setDayAddMemo(e.target.value)}
                      placeholder="理由（任意・例: 研修のため）"
                      aria-label="休みの理由"
                      className={styles.input}
                    />
                  )}
                  <Button variant="primary" onClick={() => void addDayEntry()} disabled={dayAddBusy || savingShift} busy={dayAddBusy}>足す</Button>
                </div>
              ) : null}
              <button type="button" className={styles.addRowButton} onClick={() => setDayAddOpen((open) => !open)} aria-expanded={dayAddOpen}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M7 3v8M3 7h8" /></svg>
                この日を足す
              </button>
              {shiftError ? <p className={styles.fieldError} role="alert">{shiftError}</p> : null}
            </section>

            {/* 何週分かのシフトを作る */}
            <section className={shell.section}>
              <div className={shell.sectionHead}>
                <h2 className={shell.sectionTitle}>何週分かのシフトを作る</h2>
                <p className={shell.sectionDesc}>いつもの勤務時間から、日ごとのシフトをまとめて作ります。作ったあと1日ずつ直せます。</p>
              </div>
              <div className={styles.genRow}>
                <span className={styles.fieldLabel}>
                  開始日
                  <DateField aria-label="まとめて作り始める日" value={genFrom} onChange={setGenFrom} className="mt-1" />
                </span>
                <label className={styles.fieldLabel}>
                  週の数（1〜12）
                  <input aria-label="まとめて作る週の数" type="number" min={1} max={12} value={genWeeks} onChange={(event) => setGenWeeks(event.target.value)} className={`${styles.input} mt-1`} />
                </label>
                <div className={styles.genAction}>
                  <Button variant="primary" onClick={() => void generateFromRules()} disabled={generating} busy={generating} busyLabel="作成中…">作る</Button>
                </div>
              </div>
              {genError ? <p className={styles.fieldError} role="alert">{genError}</p> : null}
              {generatedCount !== null && !genError ? <p className={styles.savedNote}>{generatedCount}日分作りました。</p> : null}
            </section>

            {/* Google カレンダー */}
            <section className={shell.section}>
              <div className={shell.sectionHead}>
                <h2 className={shell.sectionTitle}>Google カレンダー</h2>
                <p className={shell.sectionDesc}>予定がある時間は、予約枠から自動で外れます。LINE で入った予約は、このカレンダーに書き込みます。ほかの予約サービスがこのカレンダーへ書き出せば、そちらの予約でも自動で枠が埋まります。</p>
              </div>
              {!serviceConfigured ? (
                <p className={shell.warnBand} role="status">Googleの接続設定がまだなのでつなげません。管理者に連絡してください。</p>
              ) : null}
              <div className={styles.calendarRow}>
                <label className={styles.calendarField}>
                  <span className={styles.fieldLabel}>カレンダーの ID</span>
                  <input
                    aria-label="カレンダーのID"
                    value={calendarId ? (calendarInput || calendarId) : calendarInput}
                    onChange={(event) => {
                      if (calendarId) {
                        setCalendarId(null)
                        setCalendarInput(event.target.value)
                      } else {
                        setCalendarInput(event.target.value)
                      }
                    }}
                    placeholder="例: example@example.invalid"
                    className={styles.input}
                  />
                </label>
                {calendarId ? (
                  <span className={styles.connectedBadge}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="5" /><path d="M3.8 6.2l1.4 1.4 3-3.2" /></svg>
                    つながっている
                  </span>
                ) : null}
              </div>
              {calendarId ? (
                <p className={styles.calendarMeta}>
                  最後に読んだ {calendarVerifiedAt ? formatDay(calendarVerifiedAt) : '—'}
                  {calendarError ? <span className={styles.fieldError}>　最新の確認で失敗しています：{calendarError}</span> : null}
                </p>
              ) : null}
              <div className={styles.calendarActions}>
                {calendarId ? (
                  <Button variant="secondary" onClick={() => setConfirmDisconnect(true)} disabled={disconnecting}>外す</Button>
                ) : null}
                <Button variant="primary" onClick={() => void connectCalendar()} disabled={savingCalendar || !serviceConfigured} busy={savingCalendar} busyLabel="確認中…">
                  {calendarId ? '保存' : 'つなげる'}
                </Button>
              </div>
              {calendarFormError ? <p className={styles.fieldError} role="alert">{calendarFormError}</p> : null}
            </section>
          </fieldset>
        </div>

        <aside className={shell.side} data-design="Side">
          <div className={shell.sideActions}>
            {previewUrl ? <Button href={previewUrl}>お客さまに見える画面を確かめる</Button> : null}
          </div>
          <p className={shell.sideTitle}>
            お客さまの予約画面（{isStaffRole ? 'あなた' : `${staff.display_name}さん`}を指名したとき）
          </p>
          <div className={shell.sidePhone}>
            <LiffPhoneDatetimeStep
              menu={previewMenu}
              staffName={staff.display_name}
              slots={slots}
              closedDates={closedDates}
              closedWeekdays={closedWeekdays}
              view={liffDateView}
              status={previewError ? 'error' : 'ready'}
            />
          </div>
          <p className={shell.sideLineLink}>
            {previewUrl
              ? <a href={previewUrl} target="_blank" rel="noreferrer">実際の画面で確かめる ↗</a>
              : 'このアカウントには予約画面のURLがまだありません'}
          </p>
          {!hasActiveMenu ? (
            <p className={styles.sideNote}>公開中のメニューがないため、枠は出ません。</p>
          ) : null}
          <p className={styles.sideNote}>日ごとのシフトがある日はそちらが優先、ない日はいつもの勤務時間どおりです。外の予定は枠を閉じます。</p>
          {/* 14日の見取り（○×休）。スマホが畳まれる狭い画面でも残す。 */}
          <div className={styles.previewGrid} aria-label={`${staff.display_name}の予約枠（14日分）`}>
            {previewMarks.map((item) => {
              const day = Number(item.date.slice(8, 10))
              return (
                <span key={item.date} className={styles.previewCell} title={formatDay(item.date)}>
                  <span className={styles.previewDay}>{day}</span>
                  <span className={item.mark === '○' ? styles.previewOk : item.mark === '休' ? styles.previewOff : styles.previewNg}>{item.mark}</span>
                </span>
              )
            })}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        title={removeTarget
          ? `「${formatDay(removeTarget.date)}」の${removeTarget.kind === 'exception' ? '休み' : removeTarget.kind === 'shift' ? 'シフト' : '休憩'}を消しますか？`
          : ''}
        description={removeTarget?.kind === 'exception'
          ? 'この日の休みを削除と、いつもの勤務時間どおりに枠が出ます。この操作は取り消せません。'
          : removeTarget?.kind === 'break'
            ? 'この日だけの休憩を消します。この操作は取り消せません。'
            : 'この日のシフトを削除と、いつもの勤務時間どおりに枠が出ます。この操作は取り消せません。'}
        confirmLabel="削除する"
        destructive
        busy={deleting}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void removeDayEntry()}
      />
      <ConfirmDialog
        open={confirmDisconnect}
        title="外の予定とのつながりを切りますか？"
        description="切ると、カレンダーの予定があっても枠が閉じなくなります。つなぎ直すといつでも戻せます。"
        confirmLabel="つながりを切る"
        destructive
        busy={disconnecting}
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={() => void disconnectCalendar()}
      />
    </div>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

/**
 * ★V8「自分の勤務」の入口。staff ロールが /booking/staff/shifts へ
 * staff_id なしで来たとき、紐づく予約スタッフを /staff/me で解決して
 * 本人の勤務画面へ送る。紐づけが無いときは板 wvGke の案内を出す。
 * （動きは v7 の OwnShiftEntry と同じ。R579 の再試行も同じ。）
 */
export function OwnShiftEntryV8() {
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

  // 店舗の受付枠を見られる権限がある人は、★V8 では予約設定の「受付枠」タブが同じ中身。
  useEffect(() => {
    if (resolved === 'store') router.replace('/booking/menus?tab=hours')
  }, [resolved, router])

  function retry() {
    setLoadError(null)
    setResolved('loading')
    setAttempt((value) => value + 1)
  }

  if (resolved === 'store') return null

  const head = (
    <header className={shell.boardHead} data-design="Head">
      <h1 className={shell.headTitle}>自分の勤務</h1>
      <p className={shell.headNote}>あなたの出勤・休憩・この日だけのシフトを決めます。</p>
    </header>
  )

  if (resolved === 'error') {
    return (
      <div className={shell.shell} data-design-node="wvGke">
        {head}
        <div className={shell.body} data-design="Body">
          <div className={shell.main}>
            <ListState
              kind="error"
              title="自分の勤務を読み込めませんでした"
              description={isForbiddenOrRateLimited(loadError) ? undefined : '通信の不具合などで担当者の情報を読み込めませんでした。紐づけが無いとは限りません。「もう一度読み込む」を押してください。'}
              error={loadError ?? undefined}
              onRetry={retry}
            />
          </div>
        </div>
      </div>
    )
  }
  if (resolved === 'missing') {
    return (
      <div className={shell.shell} data-design-node="wvGke">
        {head}
        <div className={shell.body} data-design="Body">
          <div className={shell.main}>
            <div className={shell.stateCard}>
              <span className={shell.stateIcon} aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="17" y1="8" x2="22" y2="13" /><line x1="22" y1="8" x2="17" y2="13" /></svg>
              </span>
              <p className={shell.stateTitle}>ひも付いた予約スタッフがありません</p>
              <p className={shell.stateDesc}>管理者が予約スタッフとログインユーザーをひも付けると、ここで自分の勤務を決められます。</p>
              <div className={shell.stateActions}>
                <Button href="/booking/bookings">予約の一覧へ戻る</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className={shell.shell} data-design-node="wvGke">
      {head}
      <div className={shell.body} data-design="Body">
        <div className={shell.main}>
          <div className={shell.stateCard}>
            <p className={shell.stateTitle}>読み込み中</p>
            <p className={shell.stateDesc}>自分の勤務を探しています。</p>
          </div>
        </div>
      </div>
    </div>
  )
}
