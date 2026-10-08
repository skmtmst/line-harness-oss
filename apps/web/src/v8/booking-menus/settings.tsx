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
import { closedOn, closedRanges, closedSpan } from './lib/closed-ranges'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Check, Smartphone } from 'lucide-react'
import StickyBar from '@/components/shared/sticky-bar'
import { notifyToast } from '@/components/shared/toast'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { Tabs } from '@/components/shared/tabs'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useAccount } from '@/contexts/account-context'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { useBookingEdit } from './lib/edit-permission'
import {
  api,
  bookingApi,
  type BookingAvailabilitySlot,
  type BookingMenu,
  type BookingResource,
  type BookingSettings,
  type BookingStaff,
  type StaffMenuMatrix,
} from '@/lib/api'
import type { StaffMember } from '@line-crm/shared'
import { fetchAllPages } from './lib/fetch-all-pages'
import { mergeStaffSlots } from './lib/preview-slots'
import { bookingErrorMessage, bookingRulesErrorMessage } from './lib/menu-validation'

/*
 * 右の「見え方」の写し3部品も、見えてから読む（動的 import）。
 * タブと同じく、読み待ちは骨組みで段を保つ。
 */
const LiffPhoneMenuStep = memo(dynamic(() => import('./liff-phone').then((module) => module.LiffPhoneMenuStep), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
const LiffPhoneDatetimeStep = memo(dynamic(() => import('./liff-phone').then((module) => module.LiffPhoneDatetimeStep), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
const LiffPhoneStaffStep = memo(dynamic(() => import('./liff-phone').then((module) => module.LiffPhoneStaffStep), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
import {
  DAYS,
  JST_OFFSET_MS,
  V8TabEditContext,
  WEEKDAY_JP,
  AccountIcon,
  StateCard,
  SkeletonRows,
  Band,
  sortedMenus,
  type LoadStatus,
  type V8TabEdit,
} from './tabs/shared'
import styles from './settings.module.css'
import ChannelsTabV8 from './channels-tab'

/*
 * 速さのため、使わないタブの中身は後から読む（動的 import）。
 * 開いているタブの束だけ先に読み、ほかは選ばれてから読む。
 * 読み待ちの間は骨組みを出し、段のずれは作らない。
 * memo で包み、殻の描き直し（写し・保存帯など）が
 * タブの中まで波及しないようにする。
 */
const MenusTabV8 = memo(dynamic(() => import('./tabs/menus-tab').then((module) => module.MenusTabV8), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
const HoursTabV8 = memo(dynamic(() => import('./tabs/hours-tab').then((module) => module.HoursTabV8), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
const HolidaysTabV8 = memo(dynamic(() => import('./tabs/holidays-tab').then((module) => module.HolidaysTabV8), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
const RulesTabV8 = memo(dynamic(() => import('./tabs/rules-tab').then((module) => module.RulesTabV8), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
const StaffTabV8 = memo(dynamic(() => import('./tabs/staff-tab').then((module) => module.StaffTabV8), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))


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


// LIFF の日時選択（apps/liff DateTimePicker）と同じく JST の今日から14日分。
function previewRange(): { from: string; to: string } {
  const from = new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10)
  const end = new Date(`${from}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 13)
  return { from, to: end.toISOString().slice(0, 10) }
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

  const narrow = useNarrowViewport()
  const tabNode = narrow && tab === 'menus' ? 'P6EdLW' : narrow && tab === 'hours' ? 'VFxWU' : V8_TAB_NODE[tab]
  const canEditMenus = useBookingEdit('/booking/menus')
  const canEditSettings = useBookingEdit('booking.settings')
  /* 開いているタブを変えられない人には、頭の下に「閲覧のみ」の帯を出す（板 C9fv7A）。 */
  const tabReadOnly = tab === 'menus' ? !canEditMenus : !canEditSettings

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
  /* WEB057：設定・休業日・設備を保存したら、右の写しの空き枠も取り直す。 */
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
  }, [tab, accountId, resources])

  /* ---- 休業日タブ: 休みにした日に入っている予約の件数 ---- */
  const storeExceptions = useMemo(
    () => (settings?.exceptions ?? []).filter((item) => !item.scopeKind || item.scopeKind === 'store'),
    [settings],
  )
  /* WEB056：長い休みも31日で打ち切らない。範囲で数える。 */
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
          const jst = new Date(new Date(request.starts_at).getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
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
  /* 保存が終わったらボタンを「✓ 保存しました」にする（B-17）。 */
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
    router.replace(next === 'menus' ? '/booking/menus' : `/booking/menus?tab=${next}`)
  }
  function confirmSwitch() {
    const next = switchTarget
    setSwitchTarget(null)
    if (!next) return
    tabEdit?.onReset()
    router.replace(next === 'menus' ? '/booking/menus' : `/booking/menus?tab=${next}`)
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
  const phone = useMemo(() => {
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
        view={phoneView}
        status={preview.status}
      />
    )
  }, [tab, menus, menusStatus, previewMenu, staff, designationFree, staffStatus, preview, closedWeekdays, phoneView])

  return (
    <V8TabEditContext.Provider value={registerTabEdit}>
      <div className={styles.shell} data-design-node="owaS3">
        <header className={styles.boardHead} data-design="Head">
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

        {accountId && tabReadOnly ? (
          <div className={styles.readOnlyRow} data-design="Bar">
            <Band tone="hint">閲覧のみで見ています。変える操作は管理者に頼んでください。</Band>
          </div>
        ) : null}

        <div className={styles.body} data-design="Body">
          <div className={tab === 'channels' ? `${styles.main} ${styles.mainChannels}` : styles.main} data-design-node={tab === 'menus' && !canEditMenus ? 'C9fv7A' : tabNode}>
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
                onReload={reloadCore}
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
                onSaved={saveSettings}
                onReload={reloadCore}
                onResourceSaved={saveResource}
                onResourceCreated={createResource}
                onResourceDeleted={deleteResource}
                onResourcesRetry={retryResources}
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
                onSaved={saveSettings}
                onReload={reloadCore}
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
                onSaved={saveSettings}
                onReload={reloadCore}
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
                onReload={reloadCore}
              />
            ) : (
              <ChannelsTabV8 accountId={accountId} canEdit={canEditSettings} staff={staff} />
            )}
          </div>

          {/* 予約経路の連携は横に広い表なので、右のスマホを出さず全幅にする（絵 ZyDd6）。 */}
          {tab === 'channels' ? null : (
          <aside className={styles.side} data-design="Side">
            <div className={styles.sideActions}>
              <span className={styles.sidePhoneButton}>
                <Button onClick={() => setPhoneOpen(true)}>LINEでの見え方を見る</Button>
              </span>
              {previewUrl ? <Button href={previewUrl}><Smartphone size={15} aria-hidden="true" />お客さまに見える画面を確かめる</Button> : null}
            </div>
            <p className={styles.sideTitle}>お客さまの予約画面</p>
            <div className={styles.sidePhone}>{phone}</div>
            {previewUrl ? null : (
              <p className={styles.sideLineLink}>このアカウントには予約画面のURLがまだありません</p>
            )}
          </aside>
          )}
        </div>

        {/* 下の帯（追従・常に画面の下）。キャンセル・保存は中央（絵 yRPxl・x1OZS6）。
            変えられない人（閲覧のみ）には押せないボタンを置かないので帯ごと出さない。 */}
        {tabEdit && tabEdit.showBar !== false && !tabEdit.saveDisabled ? (
          <div className={styles.saveBarWrap} data-design="Savebar">
            <StickyBar
              status={tabEdit.dirty ? (
                <span className={styles.saveBarStatus}>
                  <span className={styles.saveBarStatusDot} aria-hidden="true" />
                  {tabEdit.subject}があります
                </span>
              ) : undefined}
              actions={(
                <>
                  <Button onClick={() => tabEdit.onReset()} disabled={tabEdit.saving}>キャンセル</Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (!tabEdit.dirty) {
                        notifyToast('変更はありません。')
                        return
                      }
                      tabEdit.onSave()
                    }}
                    disabled={tabEdit.saving}
                    busy={tabEdit.saving}
                    done={saveDone}
                  >
                    <Check size={15} aria-hidden="true" />{tabEdit.saveLabel ?? '保存する'}
                  </Button>
                </>
              )}
            />
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


/* ==================== ① メニュー（owaS3） ==================== */


/* ==================== ② 受付枠（yRPxl） ==================== */


/* 設備の1行。中身の編集は窓で、止める・消すは「…」の中。 */

/* 設備の追加・編集の窓。版つき保存・409 は v7 の ResourceEditor と同じ。 */

/* IDEA-28: 日時を指定して予約できるか確かめる。読み取りだけで予約は作らない。 */

/* ==================== ③ 休業日（KRgTQ） ==================== */

/** `YYYY-MM` の月を日曜はじまりの週ごとの日付（YYYY-MM-DD）に並べる。 */




/* ==================== ④ 予約のルール（x1OZS6） ==================== */


/* ==================== ⑤ 担当スタッフ（VLEaj） ==================== */
