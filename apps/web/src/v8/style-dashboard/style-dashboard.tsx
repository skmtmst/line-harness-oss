'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarCheck, CalendarDays, CalendarX2, Check, CircleUserRound, Clock3, CreditCard, Download, ExternalLink, Link2, Mail, MessageCircle, Plus, RefreshCw, Repeat2, SlidersHorizontal, Sparkles, UserPlus, Users, Video, Armchair, BellRing, ClipboardList, UserRoundX } from 'lucide-react'
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
import { styleDashboardApi, type DashboardRange, type IndustryStyle, type StyleAlertAction, type StyleAnalytics, type StyleKpi, type StyleLayout, type StyleRow, type StyleToday } from '@/lib/api-style-dashboard'
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
import { restaurantToday } from './restaurant-today'
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

function Kpi({ kpi }: { kpi: StyleKpi }) {
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
      action={kpi.link ? { label: kpi.link.label, href: kpi.link.href } : undefined}
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

  const load = useCallback(async () => {
    if (!accountId) return
    try {
      const res = await styleDashboardApi.today(accountId, style, { range, date, staff: staff === 'all' ? undefined : staff, compare })
      setData(res.data); setFailed(false)
    } catch {
      setFailed(true)
    }
    setLoadedAt(new Date())
  }, [accountId, style, range, date, staff, compare])
  useEffect(() => { void load() }, [load])

  const loadAnalytics = useCallback(async () => {
    if (!accountId || tab !== 'analytics') return
    try {
      const res = await styleDashboardApi.analytics(accountId, style, { days, tab: subTab, staff: staff === 'all' ? undefined : staff, compare })
      setAnalytics(res.data); setAnalyticsFailed(false)
    } catch { setAnalyticsFailed(true) }
  }, [accountId, style, tab, days, subTab, staff, compare])
  useEffect(() => { void loadAnalytics() }, [loadAnalytics])

  useEffect(() => {
    if (!accountId || !viewOpen) return
    void styleDashboardApi.layout(accountId, style).then((r) => setLayout(r.data)).catch(() => setLayout(null))
  }, [accountId, style, viewOpen])

  // 飲食の「座席表」は今の座席の図（店の 1 枚目の図）を出す。
  useEffect(() => {
    if (style !== 'restaurant' || view !== 'floor' || !accountId || !store.store) return
    let active = true
    void reservationBoardApi.floors(accountId, store.store.id).then((r) => { if (active) setFloor(Array.isArray(r.data) ? r.data[0] ?? null : null) }).catch(() => { if (active) setFloor(null) })
    return () => { active = false }
  }, [style, view, accountId, store.store])

  // 業種の口が読めないとき：飲食は今の口から組み立てる。ほかは「読み込めませんでした」。
  const fallback = useMemo(() => (style === 'restaurant' && failed ? restaurantToday(store, tables, Date.now()) : null), [style, failed, store, tables])
  const today = data ?? fallback
  const reload = async () => { await Promise.all([load(), style === 'restaurant' ? store.reload() : Promise.resolve(), loadAnalytics()]) }

  const asOf = today ? formatDate(today.asOf, { style: 'time' }) : null
  const hours = today?.hoursLabel ? `営業 ${today.hoursLabel}` : null
  const subtitle = [formatDate(`${date}T00:00:00+09:00`, { style: 'day' }), hours, asOf ? `${asOf} 時点` : null].filter(Boolean).join('・')

  const openRow = (row: StyleRow) => {
    if (style === 'restaurant') router.push(`/restaurant-test/reservations?id=${encodeURIComponent(row.reservationId ?? row.id)}`)
    else if (style === 'lesson') setRosterId(row.id)
    else router.push(`/booking/bookings?id=${encodeURIComponent(row.id)}`)
  }
  const markVisit = async (row: StyleRow) => {
    if (style !== 'restaurant' || !row.reservationId) { openRow(row); return }
    setBusy(row.id)
    try {
      const version = store.today?.find((r) => r.id === row.reservationId)?.customer_version ?? 1
      await restaurantTestApi.postSeatVisitMark(accountId, row.reservationId, { kind: 'visited', expectedVersion: version, requestId: crypto.randomUUID() })
      notifyToast('来店にしました。')
    } catch (caught) {
      notifyToast(japaneseDetailOf(caught) || '来店にできませんでした。', { tone: 'error' })
    } finally { await reload(); setBusy('') }
  }
  const undoVisit = async (row: StyleRow) => {
    if (style !== 'restaurant' || !row.reservationId) return
    setBusy(row.id)
    try {
      const version = store.today?.find((r) => r.id === row.reservationId)?.customer_version ?? 1
      await restaurantTestApi.deleteSeatVisitMark(accountId, row.reservationId, version, crypto.randomUUID())
      notifyToast('来店の印を取り消しました。')
    } catch (caught) {
      notifyToast(japaneseDetailOf(caught) || '取り消せませんでした。', { tone: 'error' })
    } finally { await reload(); setBusy('') }
  }
  const menuFor = (row: StyleRow) => rowMenuItems(style, row, canWrite, {
    open: openRow,
    visit: (r) => void markVisit(r),
    line: () => router.push('/chats'),
    copy: (r) => { void navigator.clipboard?.writeText(`${window.location.origin}/booking/bookings?id=${encodeURIComponent(r.id)}`).then(() => notifyToast('予約 URL をコピーしました。')) },
    roster: (r) => setRosterId(r.id),
  })

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
      <div className={styles.dateBox} data-short><DateField value={date} onChange={setDate} displayFormat="short" /></div>
      <EntitySelect compact width={112} aria-label={cfg.staffNoun} valuePrefix={`${cfg.staffNoun}：`} value={staff} onChange={setStaff} options={staffOptions} />
      <span className={styles.grow} />
      <EntitySelect compact width={190} aria-label="比べる" valuePrefix="比べる：" value={compare} onChange={setCompare} options={COMPARE} />
      <Button disabled disabledReason="書き出しの口をつなぐと使えます。"><Download size={16} aria-hidden="true" />CSV で書き出す</Button>
      <Button disabled disabledReason="定期の送信の口をつなぐと使えます。"><Mail size={16} aria-hidden="true" />毎朝メールで送る</Button>
    </div>
  ) : (
    <div className={styles.filters}>
      <SegmentedControl aria-label="期間" value={range} onChange={(v) => setParam({ range: v === 'today' ? null : v })} options={RANGES} />
      <div className={styles.dateBox}><DateField value={date} onChange={setDate} displayFormat="full" /></div>
      <EntitySelect compact width={112} aria-label={cfg.staffNoun} valuePrefix={`${cfg.staffNoun}：`} value={staff} onChange={setStaff} options={staffOptions} />
      <span className={styles.grow} />
      <EntitySelect compact width={190} aria-label="比べる" valuePrefix="比べる：" value={compare} onChange={setCompare} options={COMPARE} />
      {loadedAt ? <span className={styles.updated}>更新 {formatDate(loadedAt, { style: 'time' })}</span> : null}
      <Button onClick={() => void reload()}><RefreshCw size={16} aria-hidden="true" />読み直す</Button>
    </div>
  )

  const tabItems = TAB_KEYS.map((key: DashboardTab) => ({
    label: cfg.tabs[key],
    current: key === tab,
    onClick: () => setParam({ tab: key === 'main' ? null : TAB_PARAM[key] }),
  }))
  const viewSwitch = tab === 'main' ? (
    <SegmentedControl aria-label="表示" appearance="track" size="small" fit="content" value={view} onChange={(v: DashboardView) => setParam({ view: v === cfg.defaultView ? null : v })} options={cfg.views} />
  ) : null

  const side = (today?.side ?? []).map((card) => <SideCard key={card.id} card={card} canWrite={canWrite} onAction={() => router.push('/broadcasts')} />)

  let body: ReactNode
  if (!today) {
    body = failed ? <ListState kind="error" title="ダッシュボードを読み込めませんでした" onRetry={() => void reload()} /> : <ListState kind="loading" />
  } else if (tab === 'analytics') {
    body = <StyleAnalyticsView data={analytics} error={analyticsFailed} onTab={(t) => setParam({ sub: t })} onRetry={() => void loadAnalytics()} onRowOpen={() => router.push(cfg.links.bookings)} />
  } else if (tab !== 'main') {
    body = <ListState kind="empty" title={`${cfg.tabs[tab]}は今の画面で見られます`} action={<Button href={tab === 'bookings' ? cfg.links.bookings : cfg.links.people}>{`${cfg.tabs[tab]}を開く`}</Button>} />
  } else {
    const rows = today.rows.filter((r) => !search || r.name.includes(search) || (r.sub ?? '').includes(search) || (r.course ?? '').includes(search))
    const roster = style === 'lesson' && rosterId !== null && today.roster && (rosterId === undefined || rosterId === today.roster.rowId) ? today.roster : null
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
      main = <StaffBoard board={today.board} search={search} onSearch={setSearch} view="board" onView={(v) => setParam({ view: v === cfg.defaultView ? null : v })} canWrite={canWrite} onSlot={() => addNew()}
        entryItems={(e) => rowMenuItems(style, { id: e.id, time: e.start, name: e.name }, canWrite, { open: () => router.push(cfg.links.bookings), visit: () => router.push(cfg.links.bookings), line: () => router.push('/chats'), copy: () => undefined, roster: (r) => setRosterId(r.id) })} />
    } else {
      main = (
        <>
          {style !== 'lesson' ? <div className={styles.listTools}><span className={styles.grow} /><div className={styles.search}><SearchField value={search} onChange={setSearch} placeholder={cfg.search} aria-label={cfg.search} /></div></div> : null}
          <TodayList style={style} rows={rows} note={today.rowsNote} canWrite={canWrite} busyId={busy} menuFor={menuFor} onVisit={(r) => void markVisit(r)} onUndo={(r) => void undoVisit(r)}
            selectedId={style === 'lesson' ? (roster ? roster.rowId : null) : undefined} onSelect={style === 'lesson' ? (r) => setRosterId(r.id) : undefined} />
        </>
      )
      if (roster) aside = <LessonRoster roster={roster} canWrite={canWrite} onClose={() => setRosterId(null)} onAttend={() => router.push('/events')} onLine={() => router.push('/broadcasts')} onCancelClass={() => router.push('/events')} />
    }
    body = (
      <div className={styles.columns} data-wide={!aside || undefined}>
        {aside ? <div className={styles.asideToggle}><Button aria-expanded={asideOpen} onClick={() => setAsideOpen(!asideOpen)}>{asideOpen ? '右の列を畳む' : roster ? '名簿を見る' : '新着・お支払いを見る'}</Button></div> : null}
        <div className={styles.mainColumn}>{main}</div>
        {aside ? <aside className={styles.sideColumn} data-roster={roster ? true : undefined} data-expanded={asideOpen || undefined} aria-label="今日の動き">{aside}</aside> : null}
      </div>
    )
  }

  const alert = tab !== 'analytics' ? today?.alert : null

  return (
    <DashboardPage boardId={`style-${style}`} title={cfg.title} help={cfg.help} subtitle={subtitle} actions={headActions}>
      <div className={styles.head}>{filters}</div>
      <div className={styles.inset}>
        <KpiBand layout="link-row" data-style-dashboard={style}>
          {(today?.kpis ?? []).map((kpi) => <Kpi key={kpi.id} kpi={kpi} />)}
        </KpiBand>
        {alert ? (
          <Notice tone="warn" role="status" heading={alert.title} className={styles.alert}
            action={canWrite ? <div className={styles.alertActions}>{alert.actions.map((a) => (
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
        onReset={() => { setBusy('layout'); void styleDashboardApi.resetLayout(accountId, style).then((r) => { setLayout(r.data); notifyToast('型に戻しました。') }).catch(() => notifyToast('型に戻せませんでした。', { tone: 'error' })).finally(() => setBusy('')) }}
        onSave={(next) => { setBusy('layout'); void styleDashboardApi.saveLayout(accountId, style, next).then((r) => { setLayout(r.data); setViewOpen(false); notifyToast('表示を保存しました。'); void load() }).catch(() => notifyToast('表示を保存できませんでした。', { tone: 'error' })).finally(() => setBusy('')) }} />
      <ClosureDialog open={closureOpen} date={date} busy={busy === 'closure'} seatNoun={style === 'restaurant' ? '卓' : style === 'lesson' ? '講師' : '担当者'}
        targets={{ staff: style === 'restaurant' ? [] : (today?.staff ?? []), seats: style === 'restaurant' ? (today?.staff ?? []) : [] }}
        affectedNote={style === 'restaurant' ? 'その時間の予約は取り消しません。連絡は次の画面で選べます。' : 'その時間の予約は取り消しません。連絡は次の画面で選べます。'}
        onClose={() => setClosureOpen(false)}
        onSave={(input) => { setBusy('closure'); void styleDashboardApi.addClosure(accountId, style, input).then((r) => { setClosureOpen(false); notifyToast(r.data.affected ? `休みを入れました。重なる予約が ${r.data.affected}件あります。` : '休みを入れました。'); void reload() }).catch(() => notifyToast('休みを入れられませんでした。', { tone: 'error' })).finally(() => setBusy('')) }} />
    </DashboardPage>
  )
}
