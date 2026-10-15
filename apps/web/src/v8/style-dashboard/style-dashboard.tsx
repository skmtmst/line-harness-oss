'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Copy, CalendarCheck, CalendarDays, CalendarX2, Check, CircleUserRound, Clock3, CreditCard, Download, ExternalLink, Link2, Mail, MessageCircle, Plus, RefreshCw, Repeat2, SlidersHorizontal, Sparkles, UserPlus, Users, Video, Armchair, BellRing, ClipboardList, UserRoundX } from 'lucide-react'
import type { ReactNode } from 'react'
import { DashboardPage } from '@/components/templates/dashboard-page'
import Button from '@/components/shared/button'
import DateField from '@/components/shared/date-field'
import DeltaChip from '@/components/shared/delta-chip'
import EntitySelect from '@/components/shared/entity-select'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
import SegmentedControl from '@/components/shared/segmented'
import { Tabs } from '@/components/shared/tabs'
import { notifyToast } from '@/components/shared/toast'
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { formatDate } from '@/lib/format'
import { restaurantTestApi } from '@/lib/restaurant-test-api'
import type { DashboardRange, IndustryStyle, StyleAlertAction, StyleAnalytics, StyleClosureInput, StyleKpi, StyleLayout, StyleRoster, StyleRow, StyleToday } from './model'
import { styleApi } from '@/lib/api-styles'
import { bookingApi, eventsApi } from '@/lib/api'
import { CancelClassDialog, CancelReservationDialog, RefundDialog, type CancelReservationInput } from '@/components/shared/booking-confirm-dialogs'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import TestModeNote from '@/components/shared/test-mode-note'
import Dialog from '@/components/shared/dialog'
import Radio from '@/components/shared/radio'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import type { RestaurantClosureKind, StyleCard } from '@line-crm/shared'
import { analyticsWindow, toAnalytics, toLayout, toToday } from './adapter'
import { useStaffRole } from '@/lib/staff-role'
import { reservationBoardApi } from '@/lib/api-reservation-board'
import RestaurantFloorMap from '@/components/shared/restaurant-floor-map'
import type { RestaurantFloor } from '@line-crm/shared'
import PhoneReservationDrawer from '../restaurant/front-desk/phone-drawer'
import WalkInDialog from '../restaurant/front-desk/walk-in-dialog'
import { canWriteRole } from '../restaurant/dashboard/summarize'
import { useStoreToday } from '../restaurant/dashboard/use-store-today'
import { StyleAnalyticsView } from './analytics'
import { DayList, MonthCalendar, WeekCalendar } from './calendar'
import { RANGES, STYLE_CONFIG, TAB_KEYS, TAB_PARAM, rangeFromParam, tabFromParam, viewFromParam, type DashboardTab, type DashboardView } from './config'
import { LessonRoster } from './lesson-roster'
import { SideCard, rowMenuItems } from './parts'
import { restaurantAlert, restaurantToday } from './restaurant-today'
import { ClosureDialog, ViewDrawer } from './settings-panels'
import { StaffBoard } from './staff-board'
import { TodayList } from './today-list'
import styles from './style-dashboard.module.css'

/*
 * ★V8 業種ダッシュボード（B-294・B-304・B-309・B-318・B-319。絵 XBkC2）。
 * 4 業種（飲食・サロン・面談・教室）で同じ骨組み：
 *   頭（題＝業種の名前・日付と営業時間・すぐ使う操作）→ 日付の段（今日｜1週間｜1か月・日付・担当・比べる・読み直す）
 *   → 数の帯（5・「？」・前との比べ）→ 異常の帯 → タブ（1枚目・…・分析）＋表示の切り替え（盤｜一覧｜カレンダー）
 *   → 本文｜右の列（新着予約・お支払い・業種のカード）。
 * 動きは BEHAVIOR.md。
 */

const KPI_ICON: Record<string, ReactNode> = {
  today: <CalendarCheck size={13} aria-hidden="true" />, waiting: <BellRing size={13} aria-hidden="true" />, free: <Armchair size={13} aria-hidden="true" />,
  noshow: <UserRoundX size={13} aria-hidden="true" />, new: <Sparkles size={13} aria-hidden="true" />, rebook: <Repeat2 size={13} aria-hidden="true" />,
  income: <CreditCard size={13} aria-hidden="true" />, meetings: <Video size={13} aria-hidden="true" />, results: <ClipboardList size={13} aria-hidden="true" />,
  week: <CalendarDays size={13} aria-hidden="true" />, classes: <CalendarCheck size={13} aria-hidden="true" />, attendance: <ClipboardList size={13} aria-hidden="true" />,
  fill: <Clock3 size={13} aria-hidden="true" />,
}

const ALERT_ICON: Record<NonNullable<StyleAlertAction['icon']>, ReactNode> = {
  external: <ExternalLink size={16} aria-hidden="true" />, check: <Check size={16} aria-hidden="true" />, refresh: <RefreshCw size={16} aria-hidden="true" />,
  link: <Link2 size={16} aria-hidden="true" />, people: <Users size={16} aria-hidden="true" />,
}

const COMPARE = [{ value: 'last_week', label: '先週の同じ曜日' }, { value: 'previous', label: '前の期間' }, { value: 'last_year', label: '前年の同じ時期' }]
const ANALYTICS_DAYS = [{ value: '7', label: '7日' }, { value: '30', label: '30日' }, { value: '90', label: '90日' }]

function jstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function shiftDate(ymd: string, range: DashboardRange, step: -1 | 1): string {
  const d = new Date(`${ymd}T00:00:00+09:00`)
  if (range === 'month') d.setUTCMonth(d.getUTCMonth() + step)
  else d.setUTCDate(d.getUTCDate() + (range === 'week' ? 7 : 1) * step)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function Kpi({ kpi, onPreparing }: { kpi: StyleKpi; onPreparing: () => void }) {
  return (
    <KpiCard
      presentation="band"
      title={kpi.title}
      icon={KPI_ICON[kpi.id] ?? <CircleUserRound size={13} aria-hidden="true" />}
      help={kpi.help}
      helpDisplay="question"
      value={kpi.value}
      valueText={kpi.valueText}
      unit={kpi.unit}
      delta={kpi.delta ? <DeltaChip tone={kpi.delta.tone}>{kpi.delta.text}</DeltaChip> : undefined}
      detail={kpi.detail}
      detailLayout="single"
      action={kpi.link ? kpi.link.href === '#preparing-payment' ? { label: kpi.link.label, onClick: onPreparing } : { label: kpi.link.label, href: kpi.link.href } : undefined}
    />
  )
}

export default function StyleDashboard({ style }: { style: IndustryStyle }) {
  const cfg = STYLE_CONFIG[style]
  usePageTitle(cfg.title)
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const tab = tabFromParam(params.get('tab'))
  const view = viewFromParam(style, params.get('view'))
  const range = rangeFromParam(params.get('range'))
  const subTab = params.get('sub') ?? cfg.analyticsDefault
  const days = params.get('days') ?? '30'
  const { selectedAccountId } = useAccount()
  const accountId = selectedAccountId ?? ''
  const role = useStaffRole()
  const canWrite = canWriteRole(role)
  const [date, setDate] = useState(jstToday)
  const [staff, setStaff] = useState('all')
  const [compare, setCompare] = useState(COMPARE[0].value)
  const [search, setSearch] = useState('')
  const [data, setData] = useState<StyleToday | null>(null)
  const [failed, setFailed] = useState(false)
  const [analytics, setAnalytics] = useState<StyleAnalytics | null>(null)
  const [analyticsFailed, setAnalyticsFailed] = useState(false)
  const [layout, setLayout] = useState<StyleLayout | null>(null)
  const [viewOpen, setViewOpen] = useState(false)
  const [closureOpen, setClosureOpen] = useState(false)
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [walkInOpen, setWalkInOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [rosterId, setRosterId] = useState<string | null | undefined>(undefined)
  const [asideOpen, setAsideOpen] = useState(false)
  const [floor, setFloor] = useState<RestaurantFloor | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  // 飲食だけは今の飲食の口（今日の予約・卓・知らせ）も読む。業種の口が無いときはここから組み立てる。
  const store = useStoreToday(style === 'restaurant' ? selectedAccountId : null)
  const tables = useMemo(() => (store.snapshot?.tables ?? []).filter((t) => t.store_id === store.store?.id), [store.snapshot, store.store])

  const setParam = useCallback((next: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) { if (v === null) q.delete(k); else q.set(k, v) }
    router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false })
  }, [params, pathname, router])

  const staffId = staff === 'all' ? undefined : staff
  const compareParam = compare as 'previous' | 'last_year' | 'last_week'
  const load = useCallback(async () => {
    if (!accountId) return
    try {
      // 数は summary、盤・一覧・日週月は schedule（API-CONTRACT-4 §10）。
      const query = { style, range, date, staff_id: staffId }
      const [summary, schedule] = await Promise.all([
        styleApi.summary(accountId, { ...query, compare: compareParam }),
        styleApi.schedule(accountId, { ...query, display: view === 'calendar' ? 'calendar' : view === 'list' ? 'list' : 'board', calendar_view: range === 'month' ? 'month' : range === 'week' ? 'week' : 'day', ...(style === 'restaurant' && view === 'board' ? { axis: 'table' as const } : {}) }),
      ])
      setData(toToday(style, summary.data, schedule.data, date, range)); setFailed(false)
    } catch {
      setFailed(true)
    }
    setLoadedAt(new Date())
  }, [accountId, style, range, date, staffId, compareParam, view])
  useEffect(() => { void load() }, [load])

  const loadAnalytics = useCallback(async () => {
    if (!accountId || tab !== 'analytics') return
    try {
      const res = await styleApi.analytics(accountId, { style, ...analyticsWindow(date, Number(days) || 30), staff_id: staffId, compare: compareParam === 'last_week' ? 'previous' : compareParam })
      const names = Object.fromEntries((data?.staff ?? []).map((x) => [x.id, x.name]))
      setAnalytics(toAnalytics(style, res.data, subTab, names)); setAnalyticsFailed(false)
    } catch { setAnalyticsFailed(true) }
  }, [accountId, style, tab, days, subTab, staffId, compareParam, date, data?.staff])
  useEffect(() => { void loadAnalytics() }, [loadAnalytics])

  const [cardDefaults, setCardDefaults] = useState<StyleCard[] | undefined>(undefined)
  useEffect(() => {
    if (!accountId || !viewOpen) return
    void styleApi.get(accountId).then((r) => setLayout(toLayout(style, r.data.cards, r.data.version, cardDefaults))).catch(() => setLayout(null))
  }, [accountId, style, viewOpen, cardDefaults])

  // 教室の名簿は今のイベント予約の一覧から読む（API-CONTRACT-4 §9）。
  const [roster, setRoster] = useState<StyleRoster | null>(null)
  const rosterRow = style === 'lesson' && data ? (rosterId === undefined ? data.rows[0] : data.rows.find((r) => r.id === rosterId)) ?? null : null
  useEffect(() => {
    if (!rosterRow?.reservationId || !accountId) { setRoster(null); return }
    let active = true
    const slotId = rosterRow.id.replace(/^class:/, '')
    void eventsApi.listBookings(accountId, rosterRow.reservationId, { slot_id: slotId, limit: 50 }).then((res) => {
      if (!active) return
      const items = res.items ?? []
      const live = items.filter((b) => !b.cancelled_at)
      setRoster({
        rowId: rosterRow.id, head: `${rosterRow.time}${rosterRow.endTime ?? ''}・${rosterRow.sub ?? ''}`, title: rosterRow.name, pay: { label: '払い方は決済をつないでから', tone: 'neutral' },
        meta: `予約 ${live.length}・待ち ${rosterRow.waiting ?? '—'}`, payLinkCount: 0, more: items.length > 7 ? `ほか ${items.length - 7}人` : '',
        members: items.slice(0, 7).map((b) => ({ name: b.friend_display_name ?? b.friend_name ?? '名前なし', sub: b.is_first_time ? '初めて' : b.status === 'cancelled' ? '取消' : '会員', pay: { label: '—', tone: 'neutral' }, attend: b.cancelled_at ? 'cancel' : b.status === 'attended' ? 'done' : 'button', bookingId: b.id, eventId: b.event_id })),
      })
    }).catch(() => { if (active) setRoster(null) })
    return () => { active = false }
  }, [accountId, rosterRow?.id, rosterRow?.reservationId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 飲食の「座席表」は今の座席の図（店の 1 枚目の図）を出す。
  useEffect(() => {
    if (style !== 'restaurant' || view !== 'floor' || !accountId || !store.store) return
    let active = true
    void reservationBoardApi.floors(accountId, store.store.id).then((r) => { if (active) setFloor(Array.isArray(r.data) ? r.data[0] ?? null : null) }).catch(() => { if (active) setFloor(null) })
    return () => { active = false }
  }, [style, view, accountId, store.store])

  // 業種の口が読めないとき：飲食は今の口から組み立てる。ほかは「読み込めませんでした」。
  const fallback = useMemo(() => (style === 'restaurant' && failed ? restaurantToday(store, tables, Date.now()) : null), [style, failed, store, tables])
  // 異常の帯：飲食は今の「枠を閉じる知らせ」（媒体の知らせは必ず出す）。ほかは口に帯の中身が無いので出さない。
  const restaurantBand = useMemo(() => (style === 'restaurant' ? restaurantAlert(store) : null), [style, store])
  const today = data ? { ...data, alert: restaurantBand } : fallback
  const preparing = usePreparingDialog()
  const openPayment = () => preparing.open('お支払い')
  const reload = async () => { await Promise.all([load(), style === 'restaurant' ? store.reload() : Promise.resolve(), loadAnalytics()]) }

  const asOf = today ? formatDate(today.asOf, { style: 'time' }) : null
  const hours = today?.hoursLabel ? `営業 ${today.hoursLabel}` : null
  const subtitle = [formatDate(`${date}T00:00:00+09:00`, { style: 'day' }), hours, asOf ? `${asOf} 時点` : null].filter(Boolean).join('・')

  const openRow = (row: StyleRow) => {
    if (style === 'restaurant') router.push(`/restaurant-test/reservations?id=${encodeURIComponent(row.reservationId ?? row.id)}`)
    else if (style === 'lesson') setRosterId(row.id)
    else router.push(`/booking/bookings?id=${encodeURIComponent(row.id)}`)
  }
  const version = (row: StyleRow) => row.booking?.version ?? store.today?.find((r) => r.id === row.reservationId)?.customer_version ?? 1
  const run = async (row: StyleRow, fn: () => Promise<unknown>, ok: string, fail: string) => {
    setBusy(row.id)
    try { await fn(); notifyToast(ok) } catch (caught) { notifyToast(japaneseDetailOf(caught) || fail, { tone: 'error' }) } finally { await reload(); setBusy('') }
  }
  const bookingId = (row: StyleRow) => row.booking?.id ?? row.reservationId ?? row.id
  const markVisit = (row: StyleRow) => {
    if (style === 'restaurant' && row.reservationId) return run(row, () => restaurantTestApi.postSeatVisitMark(accountId, row.reservationId!, { kind: 'visited', expectedVersion: version(row), requestId: crypto.randomUUID() }), '来店にしました。', '来店にできませんでした。')
    if (row.booking?.kind === 'meet' && row.booking.updatedAt) return run(row, () => styleApi.saveMeetResult(accountId, row.booking!.id, { expectedUpdatedAt: row.booking!.updatedAt!, attendance: 'visited' }), '実施にしました。', '実施にできませんでした。')
    if (row.booking) return run(row, () => bookingApi.postVisitMark(accountId, bookingId(row), { kind: 'visited' }), '来店にしました。', '来店にできませんでした。')
    openRow(row)
  }
  /** 無断・欠席の印（開始の時刻を過ぎた予約だけ。あとで戻せる）。 */
  const markNoShow = (row: StyleRow) => {
    if (!row.past) return
    if (style === 'restaurant' && row.reservationId) return run(row, () => restaurantTestApi.postSeatVisitMark(accountId, row.reservationId!, { kind: 'no_show', expectedVersion: version(row), requestId: crypto.randomUUID() }), '無断にしました。来店の印の取り消しで戻せます。', '無断にできませんでした。')
    if (row.booking?.kind === 'meet' && row.booking.updatedAt) return run(row, () => styleApi.saveMeetResult(accountId, row.booking!.id, { expectedUpdatedAt: row.booking!.updatedAt!, attendance: 'no_show' }), '欠席にしました。', '欠席にできませんでした。')
    return run(row, () => bookingApi.postVisitMark(accountId, bookingId(row), { kind: 'no_show' }), style === 'consult' ? '欠席にしました。' : '無断にしました。', '印を付けられませんでした。')
  }
  const approve = (row: StyleRow) => run(row, () => bookingApi.decideRequest(accountId, bookingId(row), 'approve'), '承認しました。お客さまに確定の LINE が届きます。', '承認できませんでした。')
  const undoVisit = (row: StyleRow) => {
    if (style !== 'restaurant' || !row.reservationId) return
    return run(row, () => restaurantTestApi.deleteSeatVisitMark(accountId, row.reservationId!, version(row), crypto.randomUUID()), '来店の印を取り消しました。', '取り消せませんでした。')
  }
  const [cancelRow, setCancelRow] = useState<StyleRow | null>(null)
  const [refundRow, setRefundRow] = useState<StyleRow | null>(null)
  const [resultRow, setResultRow] = useState<StyleRow | null>(null)
  const [classRow, setClassRow] = useState<StyleRow | null>(null)
  const menuFor = (row: StyleRow) => rowMenuItems(style, row, canWrite, {
    open: openRow,
    visit: (r) => void markVisit(r),
    line: () => router.push('/chats'),
    pay: openPayment,
    copy: (r) => { void navigator.clipboard?.writeText(`${window.location.origin}/booking/bookings?id=${encodeURIComponent(r.id)}`).then(() => notifyToast('予約 URL をコピーしました。')) },
    roster: (r) => setRosterId(r.id),
    noShow: (r) => void markNoShow(r),
    cancel: (r) => setCancelRow(r),
    refund: (r) => setRefundRow(r),
    cancelClass: (r) => { setRosterId(r.id); setClassRow(r) },
  })
  /** 取り消す（h2lHCH）。理由は口の cancellationReason へ。返金は決済の口（組3）の一部返金・理由つきが要る。 */
  const confirmCancel = async (row: StyleRow, input: CancelReservationInput) => {
    setBusy('cancel')
    try {
      if (style === 'restaurant' && row.reservationId) await restaurantTestApi.updateReservation(accountId, row.reservationId, { status: 'cancelled', expectedVersion: version(row), cancellationReason: input.reason })
      else {
        if (row.booking?.version != null) await styleApi.saveBooking(accountId, bookingId(row), { expectedVersion: row.booking.version, cancellationReason: input.reason })
        await bookingApi.decideRequest(accountId, bookingId(row), 'cancel')
      }
      setCancelRow(null)
      notifyToast('予約を取り消しました。')
      if (input.refund !== 'none' || input.notify) openPayment()
    } catch (caught) { notifyToast(japaneseDetailOf(caught) || '取り消せませんでした。', { tone: 'error' }) } finally { setBusy(''); void reload() }
  }
  /** 面談の結果（検討中・成約・見送り）。予約ごとに持つ（B-304 追記 4 ⑤）。 */
  const saveResult = async (row: StyleRow, outcome: 'considering' | 'won' | 'lost') => {
    setBusy('result')
    try {
      if (row.booking?.kind === 'meet' && row.booking.updatedAt) await styleApi.saveMeetResult(accountId, row.booking.id, { expectedUpdatedAt: row.booking.updatedAt, outcome })
      else await styleApi.saveBooking(accountId, bookingId(row), { expectedVersion: row.booking?.version ?? 1, outcome })
      setResultRow(null)
      notifyToast('結果を付けました。分析の成約率に入ります。')
    } catch (caught) { notifyToast(japaneseDetailOf(caught) || '結果を付けられませんでした。', { tone: 'error' }) } finally { setBusy(''); void reload() }
  }
  const [testMode, setTestMode] = useState(false)
  useEffect(() => { if (accountId) void bookingApi.getPaymentConfig(accountId).then((r) => setTestMode(Boolean(r.data?.testMode))).catch(() => setTestMode(false)) }, [accountId])

  const alertAction = async (action: StyleAlertAction) => {
    if (action.taskId && style === 'restaurant') {
      setBusy(action.id)
      try { await restaurantTestApi.completeChannelCloseTask(accountId, action.taskId); notifyToast('枠を閉じた印を付けました。') } catch (caught) {
        notifyToast(japaneseDetailOf(caught) || '印を付けられませんでした。', { tone: 'error' })
      } finally { await reload(); setBusy('') }
      return
    }
    if (action.href) router.push(action.href)
  }

  const attend = async (r: StyleRoster, name: string | null, status: 'attended' | 'no_show' = 'attended') => {
    const targets = r.members.filter((m) => m.attend === 'button' && (name === null || m.name === name) && m.bookingId && m.eventId)
    setBusy('attend')
    let failedCount = 0
    for (const m of targets) {
      try { await eventsApi.updateBooking(accountId, m.eventId!, m.bookingId!, { status }) } catch { failedCount += 1 }
    }
    setBusy('')
    const word = status === 'attended' ? '出席' : '欠席'
    notifyToast(failedCount ? `${failedCount}人を${word}にできませんでした。` : `${word}にしました。`, failedCount ? { tone: 'error' } : undefined)
    setRosterId(r.rowId)
    void load()
  }

  const KIND: Record<string, RestaurantClosureKind> = { 貸切: 'private_event', 臨時休業: 'temporary_closed' }
  const saveClosure = async (input: StyleClosureInput, overlap?: { mode: 'ask' | 'cancel'; message: string }) => {
    setBusy('closure')
    try {
      if (style === 'restaurant' && store.store) {
        const res = await restaurantTestApi.createClosure(accountId, { storeId: store.store.id, startDate: input.date, endDate: input.date, allDay: input.allDay, startTime: input.from ?? null, endTime: input.to ?? null, kind: KIND[input.reason] ?? 'other', memo: input.reason, tableIds: input.target === 'seat' ? input.ids : [] })
        notifyToast(res.data.reservations.length ? `休みを入れました。重なる予約が ${res.data.reservations.length}件あります（取り消していません）。` : '休みを入れました。')
      } else {
        // 人の口は担当 1 人ずつ。途中で失敗した人をまとめて成功にしない。
        const ids = input.target === 'staff' ? input.ids : [null]
        const failedNames: string[] = []
        for (const id of ids) {
          try { await styleApi.closeHours(accountId, { date: input.date, target: id ? 'staff' : 'store', ...(id ? { staffId: id } : {}), allDay: input.allDay, startTime: input.from, endTime: input.to, reason: input.reason }) } catch (caught) {
            failedNames.push(id ? today?.staff.find((x) => x.id === id)?.name ?? id : '店全体'); if (ids.length === 1) throw caught
          }
        }
        notifyToast(failedNames.length ? `休みを入れました。${failedNames.join('・')}は入れられませんでした。` : '休みを入れました。予約は取り消していません。', failedNames.length ? { tone: 'error' } : undefined)
      }
      setClosureOpen(false)
      // 重なる予約への LINE・取り消しの口はまだ無い（口が要る）。休みだけ入れて、連絡は準備中の窓で伝える。
      if (overlap) preparing.open('重なる予約への連絡')
      void reload()
    } catch (caught) {
      notifyToast(japaneseDetailOf(caught) || '休みを入れられませんでした。', { tone: 'error' })
    } finally { setBusy('') }
  }

  const addNew = () => {
    if (style === 'restaurant' && store.store) setPhoneOpen(true)
    else if (style === 'lesson') router.push('/events')
    else router.push('/booking/bookings?new=1')
  }

  const headActions = (
    <>
      {canWrite && cfg.walkIn && store.store ? <Button onClick={() => setWalkInOpen(true)}><UserPlus size={16} aria-hidden="true" />ウォークイン</Button> : null}
      {canWrite ? <Button href="/broadcasts"><MessageCircle size={16} aria-hidden="true" />LINE を送る</Button> : null}
      {canWrite ? <Button onClick={() => setClosureOpen(true)}><CalendarX2 size={16} aria-hidden="true" />休みを入れる</Button> : null}
      {canWrite ? <Button onClick={() => setViewOpen(true)}><SlidersHorizontal size={16} aria-hidden="true" />表示を変える</Button> : null}
      {canWrite ? <Button variant="primary" onClick={addNew}><Plus size={16} aria-hidden="true" />{cfg.primary}</Button> : null}
    </>
  )

  const staffOptions = [{ value: 'all', label: '全て' }, ...(today?.staff ?? []).map((s) => ({ value: s.id, label: s.name }))]
  const filters = tab === 'analytics' ? (
    <div className={styles.filters}>
      <SegmentedControl aria-label="期間" value={days} onChange={(v) => setParam({ days: v })} options={ANALYTICS_DAYS} />
      <div className={styles.dateBox} data-short><DateField value={date} onChange={setDate} displayFormat="short" clearable={false} /></div>
      <EntitySelect compact width={112} aria-label={cfg.staffNoun} valuePrefix={`${cfg.staffNoun}：`} value={staff} onChange={setStaff} options={staffOptions} />
      <span className={styles.grow} />
      <EntitySelect compact width={190} aria-label="比べる" valuePrefix="比べる：" value={compare} onChange={setCompare} options={COMPARE} />
      <Button disabled disabledReason="書き出しの口をつなぐと使えます。"><Download size={16} aria-hidden="true" />CSV で書き出す</Button>
      <Button disabled disabledReason="定期の送信の口をつなぐと使えます。"><Mail size={16} aria-hidden="true" />毎朝メールで送る</Button>
      {loadedAt ? <span className={styles.updated}>更新 {formatDate(loadedAt, { style: 'time' })}</span> : null}
    </div>
  ) : (
    <div className={styles.filters}>
      <SegmentedControl aria-label="期間" value={range} onChange={(v) => setParam({ range: v === 'today' ? null : v })} options={RANGES} />
      <div className={styles.dateBox}><DateField value={date} onChange={setDate} displayFormat="day" clearable={false} /></div>
      <EntitySelect compact width={112} aria-label={cfg.staffNoun} valuePrefix={`${cfg.staffNoun}：`} value={staff} onChange={setStaff} options={staffOptions} />
      <span className={styles.grow} />
      <EntitySelect compact width={190} aria-label="比べる" valuePrefix="比べる：" value={compare} onChange={setCompare} options={COMPARE} />
      {loadedAt ? <span className={styles.updated}>更新 {formatDate(loadedAt, { style: 'time' })}</span> : null}
      <Button onClick={() => void reload()}><RefreshCw size={16} aria-hidden="true" />読み直す</Button>
    </div>
  )

  const resultRows = useMemo(() => (style === 'consult' ? (today?.rows ?? []).filter((r) => r.action === 'result') : []), [style, today?.rows])
  const tabItems = TAB_KEYS.map((key: DashboardTab) => ({
    label: cfg.tabs[key],
    ...(style === 'consult' && key === 'bookings' && resultRows.length ? { count: resultRows.length, countTone: 'warning' as const } : {}),
    current: key === tab,
    onClick: () => setParam({ tab: key === 'main' ? null : TAB_PARAM[key] }),
  }))
  const viewSwitch = tab === 'main' ? (
    <SegmentedControl aria-label="表示" appearance="track" size="small" fit="content" value={view} onChange={(v: DashboardView) => setParam({ view: v === cfg.defaultView ? null : v })} options={cfg.views} />
  ) : null

  const side = (today?.side ?? []).map((card) => <SideCard key={card.id} card={card} canWrite={canWrite} onAction={(card) => (card.id === 'pay' ? openPayment() : router.push('/broadcasts'))}>{card.id === 'pay' && testMode ? <TestModeNote /> : null}</SideCard>)

  let body: ReactNode
  if (!today) {
    body = failed ? <ListState kind="error" title="ダッシュボードを読み込めませんでした" onRetry={() => void reload()} /> : <ListState kind="loading" />
  } else if (tab === 'analytics') {
    body = <StyleAnalyticsView data={analytics} error={analyticsFailed} onTab={(t) => setParam({ sub: t })} onRetry={() => void loadAnalytics()} onRowOpen={() => router.push(cfg.links.bookings)} />
  } else if (style === 'consult' && tab === 'bookings') {
    // 結果待ち（OJ4Vu）：実施した面談のうち、結果をまだ付けていない物。押すと結果を付ける窓。
    body = (
      <div className={styles.columns}>
        <div className={styles.mainColumn}>
          <TodayList style={style} rows={resultRows} note={`${resultRows.length}件中 1〜${resultRows.length}件・結果を付けると、分析の成約率に入ります`} canWrite={canWrite} busyId={busy} menuFor={menuFor}
            onVisit={(r) => void markVisit(r)} onUndo={() => {}} onResult={(r) => setResultRow(r)}
            empty={<ListState kind="empty" title="結果待ちの面談はありません" description="実施した面談に結果を付けると、ここから消えます。" />} />
        </div>
        {side.length ? <aside className={styles.sideColumn} aria-label="今日の動き">{side}</aside> : null}
      </div>
    )
  } else if (tab !== 'main') {
    body = <ListState kind="empty" title={`${cfg.tabs[tab]}は今の画面で見られます`} action={<Button href={tab === 'bookings' ? cfg.links.bookings : cfg.links.people}>{`${cfg.tabs[tab]}を開く`}</Button>} />
  } else {
    const rows = today.rows.filter((r) => !search || r.name.includes(search) || (r.sub ?? '').includes(search) || (r.course ?? '').includes(search))
    const shownRoster = style === 'lesson' && rosterId !== null ? roster : null
    let main: ReactNode
    let aside: ReactNode = side.length ? side : null
    if (view === 'calendar') {
      if (range === 'month' && today.month) {
        main = <MonthCalendar month={today.month} onMove={(s) => setDate(s === 0 ? jstToday() : shiftDate(date, 'month', s))} onDay={(d) => setDate(d)} />
        aside = <DayList month={today.month} href={cfg.links.bookings} />
      } else if (today.week) {
        main = <WeekCalendar week={today.week} canWrite={canWrite} onMove={(s) => setDate(s === 0 ? jstToday() : shiftDate(date, 'week', s))} onSlot={() => addNew()} onOpen={() => router.push(cfg.links.bookings)} />
        aside = null
      } else main = <ListState kind="empty" title="カレンダーに出す予約はまだありません" />
    } else if (view === 'floor') {
      main = floor ? <RestaurantFloorMap floor={floor} labels={tables.map((t) => ({ id: t.id, label: t.code, active: Boolean(t.is_active), capacity: t.max_capacity }))} onSelect={() => router.push('/restaurant-test/tables')} />
        : <ListState kind="empty" title="座席の図がまだありません" action={canWrite ? <Button href="/restaurant-test/tables">座席の図を作る</Button> : undefined} />
    } else if (view === 'board' && today.board) {
      main = <StaffBoard board={today.board} search={search} onSearch={setSearch} canWrite={canWrite} onSlot={() => addNew()}
        entryItems={(e) => menuFor(today.rows.find((r) => r.id === e.id) ?? { id: e.id, time: e.start, name: e.name })} />
    } else {
      main = (
        <>
          {style !== 'lesson' ? <div className={styles.listTools}><span className={styles.grow} /><div className={styles.search}><SearchField value={search} onChange={setSearch} placeholder={cfg.search} aria-label={cfg.search} /></div></div> : null}
          <TodayList style={style} rows={rows} note={today.rowsNote} canWrite={canWrite} busyId={busy} menuFor={menuFor} onVisit={(r) => void markVisit(r)} onNoShow={(r) => void markNoShow(r)} onApprove={(r) => void approve(r)} onResult={(r) => setResultRow(r)} onUndo={(r) => void undoVisit(r)}
            empty={<ListState kind="empty" title={`${range === 'today' ? '今日' : range === 'week' ? '今週' : '今月'}の${style === 'consult' ? '面談' : style === 'lesson' ? 'クラス' : '予約'}はありません`} description={canWrite ? (style === 'consult' ? '予約の URL を案内すると、空いた時間に入ります。' : '空いている時間に予約を入れられます。') : undefined}
              action={canWrite ? (style === 'consult' ? <Button variant="primary" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/booking`).then(() => notifyToast('予約 URL をコピーしました。')) }}><Copy size={16} aria-hidden="true" />予約 URL をコピー</Button> : <Button variant="primary" onClick={addNew}><Plus size={16} aria-hidden="true" />{cfg.primary}</Button>) : undefined} />}
            selectedId={style === 'lesson' ? (shownRoster ? shownRoster.rowId : null) : undefined} onSelect={style === 'lesson' ? (r) => setRosterId(r.id) : undefined} />
        </>
      )
      if (shownRoster) aside = <LessonRoster roster={shownRoster} canWrite={canWrite} onClose={() => setRosterId(null)} onPay={openPayment} onAttend={(name) => void attend(shownRoster, name)} onAbsent={(name) => void attend(shownRoster, name, 'no_show')} onLine={() => router.push('/broadcasts')} onCancelClass={() => router.push('/events')} />
    }
    body = (
      <div className={styles.columns} data-wide={!aside || undefined}>
        {aside ? <div className={styles.asideToggle}><Button aria-expanded={asideOpen} onClick={() => setAsideOpen(!asideOpen)}>{asideOpen ? '右の列を畳む' : roster ? '名簿を見る' : '新着・お支払いを見る'}</Button></div> : null}
        <div className={styles.mainColumn}>{main}</div>
        {aside ? <aside className={styles.sideColumn} data-roster={shownRoster ? true : undefined} data-expanded={asideOpen || undefined} aria-label="今日の動き">{aside}</aside> : null}
      </div>
    )
  }

  const alert = tab !== 'analytics' ? today?.alert : null

  return (
    <DashboardPage boardId={`style-${style}`} title={cfg.title} help={cfg.help} subtitle={subtitle} actions={headActions}>
      <div className={styles.head}>{filters}</div>
      <div className={styles.inset}>
        {!canWrite && role !== null ? <ReadOnlyNotice /> : null}
        <KpiBand layout="link-row" data-style-dashboard={style}>
          {(today?.kpis ?? []).map((kpi) => <Kpi key={kpi.id} kpi={kpi} onPreparing={openPayment} />)}
        </KpiBand>
        {alert ? (
          <Notice tone="warn" role="status" heading={alert.title} className={styles.alert}
            action={alert.actions.some((a) => canWrite || a.icon === 'external') ? <div className={styles.alertActions}>{alert.actions.filter((a) => canWrite || a.icon === 'external').map((a) => (
              <Button key={a.id} size="compact" href={a.taskId ? undefined : a.href} external={a.icon === 'external'} busy={busy === a.id} onClick={a.taskId || !a.href ? () => void alertAction(a) : undefined}>{a.icon ? ALERT_ICON[a.icon] : null}{a.label}</Button>
            ))}</div> : undefined}>
            {alert.detail}
          </Notice>
        ) : null}
      </div>
      <div className={styles.tabRow}>
        <Tabs items={tabItems} label={`${cfg.title}のタブ`} size="compact" actions={viewSwitch} />
      </div>
      <div className={styles.content}>{body}</div>
      {style === 'restaurant' && store.store ? (
        <>
          <PhoneReservationDrawer open={phoneOpen} accountId={store.accountId} storeId={store.store.id} tables={tables} onClose={() => setPhoneOpen(false)}
            onSaved={({ lineFailed }) => { setPhoneOpen(false); notifyToast(lineFailed ? '予約は入れました。LINE の確認は送れていません。' : '予約を入れました。', lineFailed ? { tone: 'error' } : undefined); void reload() }} />
          <WalkInDialog open={walkInOpen} accountId={store.accountId} storeId={store.store.id} tables={tables} onClose={() => setWalkInOpen(false)}
            onSaved={({ seated }) => { setWalkInOpen(false); notifyToast(seated ? '入店にしました。' : '席は取りました。来店の印は付けられませんでした。表の［来店］を押してください。', seated ? undefined : { tone: 'error' }); void reload() }} />
        </>
      ) : null}
      <ViewDrawer open={viewOpen} layout={layout} busy={busy === 'layout'} onClose={() => setViewOpen(false)}
        onChangeStyle={(next) => { if (!layout) return; setBusy('layout'); void styleApi.save(accountId, { expectedVersion: layout.version, style: next }).then(() => { notifyToast('型を変えました。'); window.location.assign('/') }).catch((e) => notifyToast(japaneseDetailOf(e) || '型を変えられませんでした。', { tone: 'error' })).finally(() => setBusy('')) }}
        onReset={() => { if (!layout) return; setBusy('layout'); void styleApi.resetCards(accountId, layout.version).then((r) => { setCardDefaults(r.data.cards); setLayout(toLayout(style, r.data.cards, r.data.version, r.data.cards)); notifyToast('型に戻しました。') }).catch((e) => notifyToast(japaneseDetailOf(e) || '型に戻せませんでした。', { tone: 'error' })).finally(() => setBusy('')) }}
        onSave={(next) => { if (!layout) return; setBusy('layout'); void styleApi.saveCards(accountId, layout.version, next.map((c) => ({ id: c.id, visible: c.on }))).then((r) => { setLayout(toLayout(style, r.data.cards, r.data.version, cardDefaults)); setViewOpen(false); notifyToast('表示を保存しました。'); void load() }).catch((e) => notifyToast(japaneseDetailOf(e) || '表示を保存できませんでした。', { tone: 'error' })).finally(() => setBusy('')) }} />
      <ClosureDialog open={closureOpen} date={date} busy={busy === 'closure'} seatNoun={style === 'restaurant' ? '卓' : style === 'lesson' ? '講師' : '担当者'}
        targets={{ staff: style === 'restaurant' ? [] : (today?.staff ?? []), seats: style === 'restaurant' ? (today?.staff ?? []) : [] }}
        affectedNote={style === 'restaurant' ? 'その時間の予約は取り消しません。連絡は次の画面で選べます。' : 'その時間の予約は取り消しません。連絡は次の画面で選べます。'}
        onClose={() => setClosureOpen(false)}
        onSave={(input, overlap) => void saveClosure(input, overlap)}
        preview={async (input) => {
          const inRange = (t: string) => input.allDay || ((input.from ?? '00:00') <= t && t < (input.to ?? '24:00'))
          if (style === 'restaurant' && store.store) {
            const res = await restaurantTestApi.previewClosure(accountId, { storeId: store.store.id, startDate: input.date, endDate: input.date, allDay: input.allDay, startTime: input.from ?? null, endTime: input.to ?? null, kind: KIND[input.reason] ?? 'other', memo: input.reason, tableIds: input.target === 'seat' ? input.ids : [] })
            return res.data.reservations.map((r) => ({ time: formatDate(r.startsAt, { style: 'time' }), name: `${r.customerName}さま`, sub: `${r.guestCount}名`, pay: null }))
          }
          return input.date !== date ? [] : (today?.rows ?? []).filter((r) => r.live !== false && r.booking && inRange(r.time) && (input.target === 'store' || input.ids.length === 0 || input.ids.some((id) => r.staff === today?.staff.find((x) => x.id === id)?.name))).map((r) => ({ time: r.time, name: `${r.name}さま`, sub: [r.people ? `${r.people}名` : null, r.course].filter(Boolean).join('・'), pay: null }))
        }}
        overlapMessage={(input) => `〇〇さま　${input.date.slice(5).replace('-', '/')} はお店の都合でお休みをいただくことになりました。ご予約の日を変えるか、取り消すかを選んでください。`}
        mediaNote={style === 'restaurant' ? '他の予約サイトの同じ時間の枠は、それぞれの管理画面で閉じてください。' : null} />
      {preparing.dialog}
      {cancelRow ? (
        <CancelReservationDialog open title={`${cancelRow.name}さまの予約を取り消しますか？`} subtitle={[cancelRow.time, cancelRow.people ? `${cancelRow.people}名` : null, cancelRow.seat ?? cancelRow.staff, cancelRow.course].filter(Boolean).join('・')}
          facts={[{ label: 'お支払い', value: cancelRow.booking?.price ? `¥${(cancelRow.booking.price * (style === 'restaurant' ? cancelRow.booking.partySize : 1)).toLocaleString('ja-JP')}（支払いの記録は決済の口から）` : 'お支払いなし' }]}
          fullAmount={cancelRow.booking?.price ? cancelRow.booking.price * (style === 'restaurant' ? cancelRow.booking.partySize : 1) : null} testMode={testMode} busy={busy === 'cancel'}
          messageFor={(i) => `${cancelRow.name}さま　${i.reason ? `${i.reason}で` : 'お店の都合で'} ${cancelRow.time} のご予約を取り消しました。申し訳ありません。${i.refund === 'full' ? 'お支払いは全額を返金します。' : ''}`}
          onClose={() => setCancelRow(null)} onConfirm={(i) => void confirmCancel(cancelRow, i)} />
      ) : null}
      {refundRow ? (
        <RefundDialog open subtitle={`${refundRow.name}さま・${refundRow.time}${refundRow.course ? ` ${refundRow.course}` : ''}${refundRow.people ? ` ${refundRow.people}名` : ''}`}
          facts={[{ label: '支払った額', value: refundRow.booking?.price ? `¥${(refundRow.booking.price * (style === 'restaurant' ? refundRow.booking.partySize : 1)).toLocaleString('ja-JP')}` : '—' }, { label: 'これまでの返金', value: 'なし' }]}
          paidAmount={refundRow.booking?.price ? refundRow.booking.price * (style === 'restaurant' ? refundRow.booking.partySize : 1) : 0} testMode={testMode}
          onClose={() => setRefundRow(null)} onConfirm={() => { setRefundRow(null); openPayment() }} />
      ) : null}
      {classRow ? (
        <CancelClassDialog open subtitle={`${classRow.name}・${classRow.time}${classRow.endTime ?? ''}・${classRow.sub ?? ''}`}
          facts={[{ label: '予約', value: roster && roster.rowId === classRow.id ? `${roster.members.filter((m) => m.attend !== 'cancel').length}人` : '名簿を開くと人数が出ます' }, { label: 'キャンセル待ち', value: classRow.waiting !== undefined ? `${classRow.waiting}人（待ちは終わりにします）` : '—' }]}
          counts={{ members: roster && roster.rowId === classRow.id ? roster.members.filter((m) => m.attend !== 'cancel').length : 0, paid: 0, paidAmount: 0, tickets: 0, unpaid: 0 }} testMode={testMode}
          messageFor={(i) => `〇〇さま　本日 ${classRow.time} の${classRow.name}は、${i.reason || '〇〇'}のため休講になりました。`}
          onClose={() => setClassRow(null)} onConfirm={() => { setClassRow(null); preparing.open('休講') }} />
      ) : null}
      {resultRow ? <ResultDialog row={resultRow} busy={busy === 'result'} onClose={() => setResultRow(null)} onSave={(outcome) => void saveResult(resultRow, outcome)} /> : null}
    </DashboardPage>
  )
}

const OUTCOMES = [{ value: 'considering', label: '検討中' }, { value: 'won', label: '成約' }, { value: 'lost', label: '見送り' }] as const

/** 面談の［結果を付ける］の窓。結果は予約ごと。人の段階のタグも口が同じ時に直す。 */
function ResultDialog({ row, busy, onClose, onSave }: { row: StyleRow; busy: boolean; onClose: () => void; onSave: (outcome: 'considering' | 'won' | 'lost') => void }) {
  const [value, setValue] = useState<'considering' | 'won' | 'lost'>('considering')
  return (
    <Dialog open title="結果を付ける" description={`${row.name}さま・${row.time}${row.endTime ?? ''}・${row.sub ?? ''}`} designWidth={480} busy={busy} confirmLabel="結果を付ける" onCancel={onClose} onConfirm={() => onSave(value)}>
      <div className={styles.resultChoices} role="radiogroup" aria-label="面談の結果">
        {OUTCOMES.map((o) => <Radio key={o.value} name="outcome" checked={value === o.value} onChange={() => setValue(o.value)}>{o.label}</Radio>)}
      </div>
    </Dialog>
  )
}
