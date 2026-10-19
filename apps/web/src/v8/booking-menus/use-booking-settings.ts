'use client'
import { jstDate } from '@/lib/jst-datetime'
import { useSamePageUrl } from '@/lib/use-same-page-url'
import { closedOn, closedRanges, closedSpan } from './lib/closed-ranges'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePageCrumbs, usePageTitle } from '../../components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useAccount } from '@/contexts/account-context'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { useBookingEdit } from './lib/edit-permission'
import { api, bookingApi, type BookingAvailabilitySlot, type BookingMenu, type BookingResource, type BookingSettings, type BookingStaff, type StaffMenuMatrix } from '@/lib/api'
import type { StaffMember } from '@line-crm/shared'
import { fetchAllPages } from './lib/fetch-all-pages'
import { mergeStaffSlots } from './lib/preview-slots'
import { bookingErrorMessage, bookingRulesErrorMessage } from './lib/menu-validation'
import { DAYS, WEEKDAY_JP, sortedMenus, type LoadStatus, type V8TabEdit } from './tabs/shared'
import { V8TabKey, V8_TAB_KEYS, V8_TAB_NODE, previewRange } from './settings-parts'

export function useBookingSettings(accountId: string | null) {
  usePageTitle('予約設定')
  // 左メニューの項目そのものの画面なので、上の帯は「ホーム › 予約設定」だけ。
  usePageCrumbs(null)
  const samePageUrl = useSamePageUrl()
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const rawTab = requestedTab === 'tickets' ? 'passes' : requestedTab
  useEffect(() => {
    if (requestedTab !== 'tickets') return
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'passes')
    samePageUrl.replace(`?${params.toString()}`)
  }, [requestedTab, searchParams, samePageUrl])
  const tab: V8TabKey = V8_TAB_KEYS.has(rawTab ?? '') ? (rawTab as V8TabKey) : 'menus'
  const tabRef = useRef(tab)
  tabRef.current = tab

  const { selectedAccount } = useAccount()
  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const previewUrl = selectedAccount?.liffId
    ? `${workerBase}/o?liffId=${encodeURIComponent(selectedAccount.liffId)}&page=salon-book`
    : null

  const narrow = useNarrowViewport()
  const tabNode = narrow && tab === 'menus' ? 'P6EdLW' : narrow && tab === 'hours' ? 'VFxWU' : V8_TAB_NODE[tab]
  const canEditMenus = useBookingEdit('/booking/menus')
  const canEditSettings = useBookingEdit('booking.settings')
  /* 開いているタブを変えられない人には、頭の下に「閲覧のみ」の帯を出す（板 ）。 */
  const tabReadOnly = tab === 'photos' ? !canEditMenus && !canEditSettings : tab === 'menus' ? !canEditMenus : !canEditSettings

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
  /** 板 （1152）：畳んだスマホの代わりに開く見え方窓。 */
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [members, setMembers] = useState<StaffMember[]>([])
  const [resources, setResources] = useState<BookingResource[] | null>(null)
  const [resourcesStatus, setResourcesStatus] = useState<LoadStatus>('loading')
  const [resourcesError, setResourcesError] = useState<string | null>(null)
  const [resourcesRevision, setResourcesRevision] = useState(0)
  const [preview, setPreview] = useState<{
    status: LoadStatus
    slots: BookingAvailabilitySlot[]
    closedDates: string[]
    staffName: string | null
  }>({ status: 'loading', slots: [], closedDates: [], staffName: null })
  const [closedBookingCount, setClosedBookingCount] = useState<number | null>(null)
  /* 設定・休業日・設備を保存したら、右の写しの空き枠も取り直す。 */
  const [previewRevision, setPreviewRevision] = useState(0)

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

    // 一覧・設定・担当者は、それぞれの返答だけで表示する（DEEP-26）。
    await Promise.all([
      bookingApi.listMenus(accountId).then((response) => {
        if (!alive()) return
        setMenus(response.menus)
        setMenusStatus('ready')
      }).catch((error: unknown) => {
        if (!alive()) return
        setMenusStatus('error')
        setMenusError(bookingErrorMessage(error, '読み込み'))
      }),
      bookingApi.getSettings(accountId).then((response) => {
        if (!alive()) return
        if (!response.success) throw new Error('settings_unavailable')
        setSettings(response.data)
        setSettingsStatus('ready')
      }).catch((error: unknown) => {
        if (!alive()) return
        setSettingsStatus('error')
        setSettingsError(bookingRulesErrorMessage(error, '読み込み'))
      }),
      bookingApi.listStaff(accountId).then((response) => {
        if (!alive()) return
        setStaff(response.staff)
        setStaffStatus('ready')
      }).catch((error: unknown) => {
        if (!alive()) return
        setStaffStatus('error')
        setStaffError(bookingErrorMessage(error, '読み込み'))
      }),
    ])
  }, [accountId])

  useEffect(() => {
    void loadCore()
  }, [loadCore])

  /* ---- 右の写し（LIFF）用の空き枠。日時に関係するタブでのみ取る。 ---- */
  const firstActiveMenu = useMemo(
    () => sortedMenus(menus).find((menu) => menu.is_active) ?? null,
    [menus],
  )
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
      .getAvailability(accountId, { menuId: firstActiveMenu.id, from: range.from, to: range.to, applyStoreRules: true })
      .then((response) => {
        if (cancelled) return
        setPreview({
          status: 'ready',
          slots: mergeStaffSlots(response.by_staff ?? []),
          closedDates: response.closed_dates ?? [],
          // 写しは「指名なし」で進んだときの見え方（全員の空きを合わせる）。
          staffName: null,
        })
      })
      .catch(() => {
        if (!cancelled) setPreview({ status: 'error', slots: [], closedDates: [], staffName: null })
      })
    return () => { cancelled = true }
  }, [needsPreview, accountId, firstActiveMenu?.id, previewRevision]) // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [tab, accountId, resources, resourcesRevision])

  /* ---- 休業日タブ: 休みにした日に入っている予約の件数 ---- */
  const storeExceptions = useMemo(
    () => (settings?.exceptions ?? []).filter((item) => !item.scopeKind || item.scopeKind === 'store'),
    [settings],
  )
  /* 長い休みも31日で打ち切らない。範囲で数える。 */
  const closedRangeList = useMemo(() => closedRanges(storeExceptions), [storeExceptions])
  useEffect(() => {
    const span = closedSpan(closedRangeList)
    if (tab !== 'holidays' || !accountId || !span) {
      setClosedBookingCount(null)
      return
    }
    let cancelled = false
    const { from, to } = span
    void fetchAllPages(
      (offset) => bookingApi.listRequests(accountId, 'all', { from, to, limit: 100, offset }),
      100,
      () => !cancelled,
    )
      .then((requests) => {
        if (cancelled || requests === null) return
        const count = requests.filter((request) => {
          if (request.status !== 'requested' && request.status !== 'confirmed') return false
          const jst = jstDate(new Date(request.starts_at))
          return closedOn(closedRangeList, jst) !== undefined
        }).length
        setClosedBookingCount(count)
      })
      .catch(() => { if (!cancelled) setClosedBookingCount(null) })
    return () => { cancelled = true }
  }, [tab, accountId, closedRangeList])

  /* ---- 書きかけの登録と離脱確認 ---- */
  const [tabEdit, setTabEdit] = useState<V8TabEdit | null>(null)
  const registerTabEdit = useCallback((next: V8TabEdit | null) => {
    setTabEdit(next)
  }, [])
  const [switchTarget, setSwitchTarget] = useState<V8TabKey | null>(null)
  /* 保存が終わったらボタンを「✓ 保存しました」にする。 */
  const [saveDone, setSaveDone] = useState(false)
  const prevSavingRef = useRef(false)
  useEffect(() => {
    const saving = tabEdit?.saving === true
    if (prevSavingRef.current && !saving && tabEdit && !tabEdit.dirty) {
      setSaveDone(true)
      const timer = setTimeout(() => setSaveDone(false), 1300)
      prevSavingRef.current = saving
      return () => clearTimeout(timer)
    }
    prevSavingRef.current = saving
  })

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
    samePageUrl.replace(next === 'menus' ? '/booking/menus' : `/booking/menus?tab=${next}`)
  }
  function confirmSwitch() {
    const next = switchTarget
    setSwitchTarget(null)
    if (!next) return
    tabEdit?.onReset()
    samePageUrl.replace(next === 'menus' ? '/booking/menus' : `/booking/menus?tab=${next}`)
  }

  /*
   * 速さのため、タブへ渡す手を固定する（毎回の作り直しで
   * タブの中まで描き直さない）。中身が変わったときだけ新しい手を渡す。
   */
  const reloadCore = useCallback(() => {
    void loadCore()
  }, [loadCore])
  const saveSettings = useCallback((next: BookingSettings) => {
    setSettings(next)
    setPreviewRevision((n) => n + 1)
  }, [])
  const saveResource = useCallback((saved: BookingResource) => {
    setPreviewRevision((n) => n + 1)
    setResources((current) => current?.map((item) => item.id === saved.id ? { ...item, ...saved, usage: item.usage } : item) ?? current)
  }, [])
  const createResource = useCallback((created: BookingResource) => {
    setPreviewRevision((n) => n + 1)
    setResources((current) => [...(current ?? []), created].sort((a, b) => a.name.localeCompare(b.name, 'ja')))
  }, [])
  const deleteResource = useCallback((id: string) => {
    setPreviewRevision((n) => n + 1)
    setResources((current) => current?.filter((item) => item.id !== id) ?? current)
  }, [])
  const retryResources = useCallback(() => {
    setResources(null)
    setResourcesRevision((n) => n + 1)
    setResourcesError(null)
  }, [])

  /* ---- 右の写し ---- */
  const closedWeekdays = useMemo(() => {
    if (!settings?.businessHoursConfigured) return []
    return DAYS.filter(({ weekday }) =>
      (settings.businessHours.find((day) => day.weekday === weekday)?.intervals.length ?? 0) === 0,
    ).map(({ weekday }) => weekday)
  }, [settings])
  const previewMenu = firstActiveMenu ?? menus[0] ?? null
  const designationFree = useMemo(
    () => staff.some((person) => person.is_active && person.is_designation_optional),
    [staff],
  )
  const phoneView = settings?.liffDateView ?? 'list'

  return { accountId, tab, previewUrl, tabNode, canEditMenus, canEditSettings, tabReadOnly, menus, menusStatus, menusError, settings, settingsStatus, settingsError, staff, staffStatus, staffError, staffMatrices, staffExtras, phoneOpen, setPhoneOpen, members, resources, resourcesStatus, resourcesError, closedBookingCount, storeExceptions, tabEdit, registerTabEdit, switchTarget, setSwitchTarget, leaveTarget, confirmLeave, cancelLeave, requestTab, confirmSwitch, reloadCore, saveSettings, saveResource, createResource, deleteResource, retryResources, closedWeekdays, previewMenu, designationFree, preview, phoneView, hasChanges: Boolean(tabEdit?.dirty), menuFormState: { dirty: false } }
}
