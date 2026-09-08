'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePageTitle } from '@/components/shell/page-chrome'
import {
  ApiError,
  bookingApi,
  type BookingAvailabilitySlot,
  type BookingBreakConflict,
  type BookingShift,
  type BookingStaff,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import { shortDate } from '../../lib/format-time'
import type { ButtonHTMLAttributes } from 'react'

/*
 * 共通Buttonは使わない。利用先一覧(design-impact-baseline.txt)の
 * 変更許可が司令塔から出ていないため(#655)。許可が出たら共通へ戻す。
 * 見た目は隣の担当スタッフ画面の素のボタンと同じ寸法。
 */
function Btn({ primary, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={primary
        ? 'bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium transition-colors hover:brightness-92 disabled:opacity-50'
        : 'border-hairline rounded-control border bg-canvas px-4 py-2 text-sm disabled:opacity-50'}
    />
  )
}

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

const WEEKDAY_SHORT = ['日', '月', '火', '水', '木', '金', '土'] as const

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 日付文字列から曜日を求める。保存値(YYYY-MM-DD・HH:MM)は
 * 文字列のまま扱い、Dateへの変換は曜日表示のためだけにUTCで行う。
 * 店舗の時間帯や夏時間の影響を受けない。
 */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

function weekdayLabel(date: string): string {
  return WEEKDAY_SHORT[weekdayOf(date)] ?? ''
}

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

export default function StaffDetail({ staffId }: { staffId: string }) {
  usePageTitle('予約設定')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [staffList, setStaffList] = useState<BookingStaff[]>([])
  const [staffMissing, setStaffMissing] = useState(false)
  const [timeZone, setTimeZone] = useState('Asia/Tokyo')
  const [storeExceptions, setStoreExceptions] = useState<Array<{ dateFrom: string; dateTo: string; kind: string }>>([])
  const [menuId, setMenuId] = useState<string | null>(null)
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
  const [newBreakWeekday, setNewBreakWeekday] = useState('1')
  const [newBreakStart, setNewBreakStart] = useState('12:00')
  const [newBreakEnd, setNewBreakEnd] = useState('13:00')
  const [dateRows, setDateRows] = useState<Array<{ key: string; id: string | null; date: string; start: string; end: string }>>([])
  const [breakDatesVersion, setBreakDatesVersion] = useState('')
  const [dateError, setDateError] = useState<string | null>(null)
  const [savingDates, setSavingDates] = useState(false)
  const [datesSavedAt, setDatesSavedAt] = useState<string | null>(null)
  const [newDateBreak, setNewDateBreak] = useState('')
  const [newDateStart, setNewDateStart] = useState('12:00')
  const [newDateEnd, setNewDateEnd] = useState('13:00')
  const [shiftError, setShiftError] = useState<string | null>(null)
  const [savingShift, setSavingShift] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newStart, setNewStart] = useState('09:00')
  const [newEnd, setNewEnd] = useState('19:00')
  const [removeTarget, setRemoveTarget] = useState<BookingShift | null>(null)
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
      const [staffRes, settingsRes, menuRes] = await Promise.all([
        bookingApi.listStaff(selectedAccountId),
        bookingApi.getSettings(selectedAccountId),
        bookingApi.listMenus(selectedAccountId),
      ])
      if (requestId !== requestRef.current) return
      if (!settingsRes.success) throw new Error(settingsRes.error)
      const found = staffRes.staff.find((item) => item.id === staffId) ?? null
      if (!found) {
        setStaffList(staffRes.staff)
        setStaffMissing(true)
        setLoadStatus('ready')
        return
      }
      const zone = settingsRes.data.timeZone || 'Asia/Tokyo'
      const activeMenu = menuRes.menus.find((item) => item.is_active) ?? null
      setStaffList(staffRes.staff)
      setTimeZone(zone)
      setStoreExceptions((settingsRes.data.exceptions ?? [])
        .filter((item) => !item.scopeKind || item.scopeKind === 'store')
        .map((item) => ({
          dateFrom: item.dateFrom || item.date || '',
          dateTo: item.dateTo || item.date || '',
          kind: item.kind,
        })))
      setMenuId(activeMenu ? activeMenu.id : null)
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
      setDatesSavedAt(null)
      setDateError(null)
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
  }, [selectedAccountId, staffId, loadAvailability])

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
      const [rulesRes, shiftsRes, breaksRes, breakDatesRes] = await Promise.all([
        bookingApi.getAvailabilityRules(selectedAccountId, staffId),
        bookingApi.getShifts(selectedAccountId, staffId),
        bookingApi.getBreaks(selectedAccountId, staffId),
        bookingApi.getBreakDates(selectedAccountId, staffId),
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

  function addBreakRow() {
    const weekday = Number.parseInt(newBreakWeekday, 10)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      setBreakError('曜日を選んでください。')
      return
    }
    if (!validRange(newBreakStart, newBreakEnd)) {
      setBreakError('時間を正しく入れてください（終わりは始まりより後にします）。入力はそのまま残しています。')
      return
    }
    setBreakError(null)
    setBreakRows((current) => [
      ...current,
      { key: `new-${Date.now()}-${current.length}`, id: null, weekday, start: newBreakStart, end: newBreakEnd },
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

  function addDateRow() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDateBreak)) {
      setDateError('日付をカレンダーから選んでください。入力はそのまま残しています。')
      return
    }
    if (!validRange(newDateStart, newDateEnd)) {
      setDateError('時間を正しく入れてください（終わりは始まりより後にします）。入力はそのまま残しています。')
      return
    }
    setDateError(null)
    setDateRows((current) => [
      ...current,
      { key: `new-${Date.now()}-${current.length}`, id: null, date: newDateBreak, start: newDateStart, end: newDateEnd },
    ])
    setNewDateBreak('')
  }

  async function saveBreakDates() {
    if (!selectedAccountId) return
    for (const row of dateRows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !validRange(row.start, row.end)) {
        setDateError(`${shortDate(row.date)}の日時を正しく入れてください。入力はそのまま残しています。`)
        return
      }
    }
    setSavingDates(true)
    setDateError(null)
    try {
      const result = await bookingApi.putBreakDates(
        selectedAccountId,
        staffId,
        breakDatesVersion,
        dateRows.map((row) => ({
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
      setDatesSavedAt(new Date().toISOString())
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
      setDateError(staffErrorMessage(error, '保存'))
    } finally {
      setSavingDates(false)
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
      setShiftError(`${shortDate(shift.work_date)}の時間を正しく入れてください（終わりは始まりより後にします）。入力はそのまま残しています。`)
      return
    }
    setSavingShift(true)
    setShiftError(null)
    try {
      // 同じ日は上書きになるので、2回目の保存が残る。
      await bookingApi.putShifts(selectedAccountId, staffId, [
        { work_date: shift.work_date, start_time: row.start, end_time: row.end },
      ])
      await refreshAfterSave()
    } catch (error) {
      setShiftError(staffErrorMessage(error, '保存'))
    } finally {
      setSavingShift(false)
    }
  }

  async function addShift() {
    if (!selectedAccountId) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      setShiftError('日付をカレンダーから選んでください。入力はそのまま残しています。')
      return
    }
    if (!validRange(newStart, newEnd)) {
      setShiftError('時間を正しく入れてください（終わりは始まりより後にします）。入力はそのまま残しています。')
      return
    }
    setSavingShift(true)
    setShiftError(null)
    try {
      await bookingApi.putShifts(selectedAccountId, staffId, [
        { work_date: newDate, start_time: newStart, end_time: newEnd },
      ])
      setNewDate('')
      await refreshAfterSave()
    } catch (error) {
      setShiftError(staffErrorMessage(error, '保存'))
    } finally {
      setSavingShift(false)
    }
  }

  async function removeShift() {
    if (!selectedAccountId || !removeTarget) return
    setDeleting(true)
    try {
      await bookingApi.deleteShift(selectedAccountId, staffId, removeTarget.id)
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

  const previewMarks = useMemo(() => previewDates.map((date) => {
    const exception = storeExceptions.find((item) => item.dateFrom <= date && date <= item.dateTo)
    if (exception?.kind === 'closed') return { date, mark: '休' as const }
    const daySlots = slots.filter((slot) => slot.date === date)
    if (daySlots.length === 0) return { date, mark: '×' as const }
    return { date, mark: daySlots.some((slot) => slot.remaining > 0) ? '○' as const : '×' as const }
  }), [previewDates, slots, storeExceptions])

  const sortedShifts = useMemo(
    () => [...shifts].sort((a, b) => (a.work_date < b.work_date ? -1 : a.work_date > b.work_date ? 1 : 0)),
    [shifts],
  )

  if (!selectedAccountId) {
    return (
      <div data-design-node="tksPcStaff" className="space-y-4 pb-8">
        <nav aria-label="現在位置" className="text-ink-faint text-xs">
          <Link href="/booking/bookings" className="text-accent hover:underline">予約</Link>
          <span className="mx-2">›</span>
          <Link href="/booking/staff" className="text-accent hover:underline">担当スタッフ</Link>
          <span className="mx-2">›</span>
          <span>勤務とシフト</span>
        </nav>
        <ListState kind="empty" title="LINEアカウントを選んでください" description="勤務とシフトを確認するアカウントを選びます。" />
      </div>
    )
  }

  if (loadStatus === 'loading') {
    return (
      <div data-design-node="tksPcStaff" className="space-y-4 pb-8">
        <ListState kind="loading" title="担当者の勤務とシフトを読み込んでいます" />
      </div>
    )
  }

  if (loadStatus === 'error') {
    return (
      <div data-design-node="tksPcStaff" className="space-y-4 pb-8">
        <ListState
          kind="error"
          title="担当者の勤務とシフトを表示できませんでした"
          description="保存済みの内容は消えていません。時間をおいて、もう一度読み込んでください。"
          action={<Btn primary onClick={() => setReloadKey((value) => value + 1)}>勤務とシフトを再読み込み</Btn>}
        />
      </div>
    )
  }

  if (staffMissing || !staff) {
    return (
      <div data-design-node="tksPcStaff" className="space-y-4 pb-8">
        <nav aria-label="現在位置" className="text-ink-faint text-xs">
          <Link href="/booking/bookings" className="text-accent hover:underline">予約</Link>
          <span className="mx-2">›</span>
          <Link href="/booking/staff" className="text-accent hover:underline">担当スタッフ</Link>
          <span className="mx-2">›</span>
          <span>勤務とシフト</span>
        </nav>
        <ListState
          kind="empty"
          title="担当者が見つかりませんでした"
          description="削除されたか、別のアカウントの担当者です。一覧から選び直してください。"
          action={<Link href="/booking/staff" className="bg-accent-deep text-on-accent rounded-control inline-block px-4 py-2 text-sm font-medium">担当スタッフの一覧に戻る</Link>}
        />
      </div>
    )
  }

  return (
    <div data-design-node="tksPcStaff" className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="現在位置" className="text-ink-faint text-xs">
          <Link href="/booking/bookings" className="text-accent hover:underline">予約</Link>
          <span className="mx-2">›</span>
          <Link href="/booking/staff" className="text-accent hover:underline">担当スタッフ</Link>
          <span className="mx-2">›</span>
          <span>{staff.display_name}の勤務とシフト</span>
        </nav>
        <label className="text-ink-secondary ml-auto flex items-center gap-2 text-xs">
          担当者を切り替える
          <select
            aria-label="担当者を切り替える"
            value={staffId}
            onChange={(event) => router.push(`/booking/staff/shifts?staff_id=${event.target.value}`)}
            className="border-hairline rounded-control border bg-canvas px-3 py-2 text-sm"
          >
            {staffList.map((item) => (
              <option key={item.id} value={item.id}>{item.display_name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="bg-info-bg text-info rounded-card px-4 py-3 text-sm">
        {staff.display_name}の出る時間と外の予定です。下の予約枠にすぐ反映されます。時間は店舗の時間（{timeZone}）で入れます。
      </div>

      <div className="flex flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <section className="bg-canvas border-hairline overflow-hidden rounded-card border">
            <div className="border-hairline border-b px-4 py-4">
              <h2 className="text-ink font-semibold">いつもの勤務時間</h2>
              <p className="text-ink-faint mt-1 text-xs">曜日ごとの出勤時間です。空けた曜日は枠が出ません。日ごとのシフトがある日はそちらが優先されます。</p>
            </div>
            <div className="divide-hairline divide-y">
              {STAFF_DAYS.map((day) => {
                const row = draft[day.weekday] ?? EMPTY_RULE_DRAFT
                return (
                  <div className="flex min-h-10 flex-wrap items-center gap-3 px-4 py-2 text-sm" key={day.weekday}>
                    <strong className="w-24 shrink-0 whitespace-nowrap">{day.label}</strong>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        aria-label={`${day.label}は出勤する`}
                        checked={row.active}
                        onChange={(event) => updateDraft(day.weekday, { active: event.target.checked })}
                        className="rounded"
                      />
                      <span>出る</span>
                    </label>
                    {row.active ? (
                      <>
                        <label className="flex items-center gap-1 text-xs">
                          始め
                          <input
                            type="time"
                            aria-label={`${day.label}の始まり`}
                            value={row.start}
                            onChange={(event) => updateDraft(day.weekday, { start: event.target.value })}
                            className="border-hairline rounded-control border bg-canvas px-2 py-1 text-sm tabular-nums"
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          終わり
                          <input
                            type="time"
                            aria-label={`${day.label}の終わり`}
                            value={row.end}
                            onChange={(event) => updateDraft(day.weekday, { end: event.target.value })}
                            className="border-hairline rounded-control border bg-canvas px-2 py-1 text-sm tabular-nums"
                          />
                        </label>
                      </>
                    ) : (
                      <span className="text-ink-faint text-xs">休み</span>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="border-hairline flex flex-wrap items-center gap-3 border-t px-4 py-3">
              <Btn primary onClick={() => void saveRules()} disabled={savingRules}>
                {savingRules ? '保存中…' : 'いつもの勤務時間を保存'}
              </Btn>
              {rulesSavedAt ? <span className="text-success text-xs">保存しました。下の予約枠に反映されています。</span> : null}
              {ruleError ? <p className="text-danger w-full text-xs">{ruleError}</p> : null}
            </div>
          </section>

          <section className="bg-canvas border-hairline rounded-card border p-4">
            <h2 className="text-ink font-semibold">休憩</h2>
            <p className="text-ink-faint mt-1 text-xs">いつもの勤務時間の中での休み時間です。保存はできますが、まだ予約枠には反映されません。</p>
            <div className="mt-4 space-y-2">
              {breakRows.length === 0 ? (
                <p className="text-ink-faint text-sm">休憩はありません。</p>
              ) : breakRows.map((row) => (
                <div key={row.key} className="border-hairline flex flex-wrap items-center gap-3 rounded-control border p-3 text-sm">
                  <label className="flex items-center gap-1 text-xs">
                    曜日
                    <select
                      aria-label="休憩の曜日"
                      value={row.weekday}
                      onChange={(event) => updateBreakRow(row.key, { weekday: Number(event.target.value) })}
                      className="border-hairline rounded-control border bg-canvas px-2 py-1 text-sm"
                    >
                      {STAFF_DAYS.map((day) => (
                        <option key={day.weekday} value={day.weekday}>{day.short}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1 text-xs">
                    始め
                    <input
                      type="time"
                      aria-label="休憩の始まり"
                      value={row.start}
                      onChange={(event) => updateBreakRow(row.key, { start: event.target.value })}
                      className="border-hairline rounded-control border bg-canvas px-2 py-1 text-sm tabular-nums"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs">
                    終わり
                    <input
                      type="time"
                      aria-label="休憩の終わり"
                      value={row.end}
                      onChange={(event) => updateBreakRow(row.key, { end: event.target.value })}
                      className="border-hairline rounded-control border bg-canvas px-2 py-1 text-sm tabular-nums"
                    />
                  </label>
                  <button
                    onClick={() => setBreakRows((current) => current.filter((item) => item.key !== row.key))}
                    className="text-danger hover:underline text-xs"
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
            <div className="border-hairline bg-canvas-sunken mt-4 grid gap-3 rounded-control border p-3 sm:grid-cols-4">
              <label className="text-ink-secondary text-xs">
                曜日
                <select aria-label="足す休憩の曜日" value={newBreakWeekday} onChange={(event) => setNewBreakWeekday(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm">
                  {STAFF_DAYS.map((day) => (
                    <option key={day.weekday} value={day.weekday}>{day.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-ink-secondary text-xs">
                始め
                <input aria-label="足す休憩の始まり" type="time" value={newBreakStart} onChange={(event) => setNewBreakStart(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm tabular-nums" />
              </label>
              <label className="text-ink-secondary text-xs">
                終わり
                <input aria-label="足す休憩の終わり" type="time" value={newBreakEnd} onChange={(event) => setNewBreakEnd(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm tabular-nums" />
              </label>
              <div className="flex items-end">
                <Btn onClick={addBreakRow}>休憩を足す</Btn>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Btn primary onClick={() => void saveBreaks()} disabled={savingBreaks}>
                {savingBreaks ? '保存中…' : '休憩を保存'}
              </Btn>
              {breaksSavedAt ? <span className="text-success text-xs">保存しました。</span> : null}
              {breakError ? <p className="text-danger w-full text-xs">{breakError}</p> : null}
            </div>

            <h3 className="text-ink mt-6 text-sm font-semibold">この日だけの休憩</h3>
            <p className="text-ink-faint mt-1 text-xs">その日だけ休むときに足します。その日の出る時間の中に入れてください。</p>
            <div className="mt-4 space-y-2">
              {dateRows.length === 0 ? (
                <p className="text-ink-faint text-sm">この日だけの休憩はありません。</p>
              ) : [...dateRows]
                .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : 1))
                .map((row) => (
                  <div key={row.key} className="border-hairline flex flex-wrap items-center gap-3 rounded-control border p-3 text-sm">
                    <span className="font-semibold tabular-nums">{shortDate(row.date)}（{weekdayLabel(row.date)}）</span>
                    <label className="flex items-center gap-1 text-xs">
                      始め
                      <input
                        type="time"
                        aria-label={`${shortDate(row.date)}の休憩の始まり`}
                        value={row.start}
                        onChange={(event) => updateDateRow(row.key, { start: event.target.value })}
                        className="border-hairline rounded-control border bg-canvas px-2 py-1 text-sm tabular-nums"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      終わり
                      <input
                        type="time"
                        aria-label={`${shortDate(row.date)}の休憩の終わり`}
                        value={row.end}
                        onChange={(event) => updateDateRow(row.key, { end: event.target.value })}
                        className="border-hairline rounded-control border bg-canvas px-2 py-1 text-sm tabular-nums"
                      />
                    </label>
                    <button
                      onClick={() => setDateRows((current) => current.filter((item) => item.key !== row.key))}
                      className="text-danger hover:underline text-xs"
                    >
                      削除
                    </button>
                  </div>
                ))}
            </div>
            <div className="border-hairline bg-canvas-sunken mt-4 grid gap-3 rounded-control border p-3 sm:grid-cols-4">
              <label className="text-ink-secondary text-xs">
                日付
                <input aria-label="足す休憩の日付" type="date" value={newDateBreak} onChange={(event) => setNewDateBreak(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
              </label>
              <label className="text-ink-secondary text-xs">
                始め
                <input aria-label="足す休憩の始まり" type="time" value={newDateStart} onChange={(event) => setNewDateStart(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm tabular-nums" />
              </label>
              <label className="text-ink-secondary text-xs">
                終わり
                <input aria-label="足す休憩の終わり" type="time" value={newDateEnd} onChange={(event) => setNewDateEnd(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm tabular-nums" />
              </label>
              <div className="flex items-end">
                <Btn onClick={addDateRow}>休憩を足す</Btn>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Btn primary onClick={() => void saveBreakDates()} disabled={savingDates}>
                {savingDates ? '保存中…' : 'この日だけの休憩を保存'}
              </Btn>
              {datesSavedAt ? <span className="text-success text-xs">保存しました。</span> : null}
              {dateError ? <p className="text-danger w-full text-xs">{dateError}</p> : null}
            </div>
          </section>

          <section className="bg-canvas border-hairline rounded-card border p-4">
            <h2 className="text-ink font-semibold">日ごとのシフト</h2>
            <p className="text-ink-faint mt-1 text-xs">この日だけ変えたいときに足します。ある日は、いつもの勤務時間よりこちらが優先されます。</p>
            <div className="border-hairline bg-canvas-sunken mt-4 grid gap-3 rounded-control border p-3 sm:grid-cols-4">
              <label className="text-ink-secondary text-xs">
                日付
                <input aria-label="シフトの日付" type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
              </label>
              <label className="text-ink-secondary text-xs">
                始め
                <input aria-label="シフトの始まり" type="time" value={newStart} onChange={(event) => setNewStart(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm tabular-nums" />
              </label>
              <label className="text-ink-secondary text-xs">
                終わり
                <input aria-label="シフトの終わり" type="time" value={newEnd} onChange={(event) => setNewEnd(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm tabular-nums" />
              </label>
              <div className="flex items-end">
                <Btn primary onClick={() => void addShift()} disabled={savingShift}>{savingShift ? '保存中…' : 'シフトを足す'}</Btn>
              </div>
            </div>
            {shiftError ? <p className="text-danger mt-3 text-xs">{shiftError}</p> : null}
            <div className="mt-4 space-y-2">
              {sortedShifts.length === 0 ? (
                <p className="text-ink-faint text-sm">日ごとのシフトはありません。いつもの勤務時間どおりに枠が出ます。</p>
              ) : sortedShifts.map((shift) => {
                const row = shiftRows[shift.id] ?? { start: shift.start_time, end: shift.end_time }
                return (
                  <div key={shift.id} className="border-hairline flex flex-wrap items-center gap-3 rounded-control border p-3 text-sm">
                    <span className="font-semibold tabular-nums">{shortDate(shift.work_date)}（{weekdayLabel(shift.work_date)}）</span>
                    <label className="flex items-center gap-1 text-xs">
                      始め
                      <input
                        type="time"
                        aria-label={`${shortDate(shift.work_date)}の始まり`}
                        value={row.start}
                        onChange={(event) => updateShiftRow(shift.id, { start: event.target.value })}
                        className="border-hairline rounded-control border bg-canvas px-2 py-1 text-sm tabular-nums"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      終わり
                      <input
                        type="time"
                        aria-label={`${shortDate(shift.work_date)}の終わり`}
                        value={row.end}
                        onChange={(event) => updateShiftRow(shift.id, { end: event.target.value })}
                        className="border-hairline rounded-control border bg-canvas px-2 py-1 text-sm tabular-nums"
                      />
                    </label>
                    <span className="inline-flex gap-2 text-xs">
                      <button onClick={() => void saveShiftRow(shift)} disabled={savingShift} className="text-accent hover:underline disabled:opacity-50">更新</button>
                      <button onClick={() => setRemoveTarget(shift)} className="text-danger hover:underline">削除</button>
                    </span>
                  </div>
                )
              })}
            </div>
            <details className="mt-4 text-sm">
              <summary className="text-accent cursor-pointer text-sm font-semibold">いつもの勤務時間からまとめて作る</summary>
              <div className="border-hairline bg-canvas-sunken mt-3 grid gap-3 rounded-control border p-3 sm:grid-cols-3">
                <label className="text-ink-secondary text-xs">
                  始める日
                  <input aria-label="まとめて作り始める日" type="date" value={genFrom} onChange={(event) => setGenFrom(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
                </label>
                <label className="text-ink-secondary text-xs">
                  週の数（1〜12）
                  <input aria-label="まとめて作る週の数" type="number" min={1} max={12} value={genWeeks} onChange={(event) => setGenWeeks(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm tabular-nums" />
                </label>
                <div className="flex items-end">
                  <Btn onClick={() => void generateFromRules()} disabled={generating}>{generating ? '作成中…' : 'まとめて作る'}</Btn>
                </div>
              </div>
              <p className="text-ink-faint mt-2 text-xs">すでにある日は残します（上書きしません）。</p>
              {genError ? <p className="text-danger mt-2 text-xs">{genError}</p> : null}
              {generatedCount !== null && !genError ? <p className="text-success mt-2 text-xs">{generatedCount}日分作りました。</p> : null}
            </details>
          </section>
        </div>

        <aside className="space-y-4 xl:w-96 xl:flex-none">
          <section className="bg-canvas border-hairline rounded-card border p-4">
            <h2 className="text-ink font-semibold">外の予定</h2>
            <p className="text-ink-faint mt-1 text-xs">Googleカレンダーの予定がある時間は、予約枠を閉じます。</p>
            {!serviceConfigured ? (
              <p className="bg-warning-bg text-warning mt-3 rounded-control p-3 text-xs">Googleの接続設定がまだなのでつなげません。管理者に連絡してください。</p>
            ) : null}
            {calendarId ? (
              <div className="mt-3 space-y-2 text-sm">
                <p className="text-ink break-all tabular-nums">{calendarId}</p>
                <p className="text-ink-faint text-xs">つながっています{calendarVerifiedAt ? `（最終確認 ${shortDate(calendarVerifiedAt.slice(0, 10))}）` : ''}</p>
                {calendarError ? <p className="text-danger text-xs">最新の確認で失敗しています：{calendarError}</p> : null}
                <Btn onClick={() => setConfirmDisconnect(true)} disabled={disconnecting}>つながりを切る</Btn>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <label className="text-ink-secondary block text-xs">
                  カレンダーのID
                  <input
                    aria-label="カレンダーのID"
                    value={calendarInput}
                    onChange={(event) => setCalendarInput(event.target.value)}
                    placeholder="例: example@example.invalid"
                    className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm"
                  />
                </label>
                <Btn primary onClick={() => void connectCalendar()} disabled={savingCalendar || !serviceConfigured}>
                  {savingCalendar ? '確認中…' : 'つなげる'}
                </Btn>
                {calendarFormError ? <p className="text-danger text-xs">{calendarFormError}</p> : null}
              </div>
            )}
            {calendarId && calendarFormError ? <p className="text-danger mt-2 text-xs">{calendarFormError}</p> : null}
          </section>

          <section className="bg-canvas border-hairline rounded-card border p-4">
            <h2 className="text-ink-secondary text-sm font-semibold">{staff.display_name}の予約枠（14日分）</h2>
            {!hasActiveMenu ? (
              <p className="text-ink-faint mt-3 text-xs">公開中のメニューがないため、枠は出ません。</p>
            ) : (
              <div className="text-ink-faint mt-3 grid grid-cols-7 gap-1 text-center text-xs">
                {['月', '火', '水', '木', '金', '土', '日'].map((day) => <span key={day} className="font-medium">{day}</span>)}
                {previewMarks.map((item) => (
                  <span key={item.date} className="bg-canvas-sunken rounded-control py-1" title={item.date}>
                    <span className="block tabular-nums">{Number(item.date.slice(8, 10))}</span>
                    <span className={item.mark === '○' ? 'text-success' : item.mark === '休' ? 'text-ink-faint' : 'text-danger'}>{item.mark}</span>
                  </span>
                ))}
              </div>
            )}
            {previewError ? <p className="text-danger mt-3 text-xs">予約枠だけ読み込めませんでした。</p> : null}
            <p className="text-ink-faint mt-3 text-xs">日ごとのシフトがある日はそちらが優先、ない日はいつもの勤務時間どおりです。外の予定は枠を閉じます。</p>
          </section>

          <section className="bg-canvas border-hairline rounded-card border p-4">
            <h2 className="text-ink font-semibold">つながる先</h2>
            <div className="mt-3 space-y-3 text-sm">
              <Link href="/booking/staff" className="text-accent flex justify-between gap-3"><span>→ 担当スタッフ</span><span className="text-ink-faint text-xs">人の追加と削除</span></Link>
              <Link href="/booking/staff/shifts" className="text-accent flex justify-between gap-3"><span>→ 受付枠</span><span className="text-ink-faint text-xs">お店全体の時間と休業日</span></Link>
            </div>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        title={`「${removeTarget ? shortDate(removeTarget.work_date) : ''}」のシフトを消しますか？`}
        description="この日のシフトを消すと、いつもの勤務時間どおりに枠が出ます。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void removeShift()}
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
