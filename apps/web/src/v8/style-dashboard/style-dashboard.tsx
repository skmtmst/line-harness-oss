'use client'
import CalendarPeriod from '@/components/shared/calendar-period'
import { formatYen } from '@line-crm/shared';
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import { CancelClassDialog,CancelReservationDialog,RefundDialog } from '@/components/shared/booking-confirm-dialogs'
import Button from '@/components/shared/button'
import DateField from '@/components/shared/date-field'
import DeltaChip from '@/components/shared/delta-chip'
import Dialog from '@/components/shared/dialog'
import EntitySelect from '@/components/shared/entity-select'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { RadioCardGroup } from '@/components/shared/radio-card'
import Radio from '@/components/shared/radio'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import RestaurantFloorMap from '@/components/shared/restaurant-floor-map'
import { DetailColumns } from '@/components/templates/detail-columns'
import ListToolbar from '@/components/shared/list-toolbar'
import SegmentedControl from '@/components/shared/segmented'
import { Tabs } from '@/components/shared/tabs'
import TestModeNote from '@/components/shared/test-mode-note'
import { notifyToast } from '@/components/shared/toast'
import { DashboardPage } from '@/components/templates/dashboard-page'
import { styleApi } from '@/lib/api/helpers/styles'
import { formatDate } from '@/lib/format'
import { restaurantTestApi } from '@/lib/restaurant-test-api'
import { Armchair,BellRing,CalendarCheck,CalendarDays,CalendarX2,Check,CircleUserRound,ClipboardList,Clock3,Copy,CreditCard,Download,ExternalLink,Link2,Mail,MessageCircle,Plus,RefreshCw,Repeat2,SlidersHorizontal,Sparkles,UserPlus,UserRoundX,Users,Video } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo,useState } from 'react'
import { PhoneReservationDrawer } from '@/v8/restaurant/front-desk/public/phone-drawer/index'
import { WalkInDialog } from '@/v8/restaurant/front-desk/public/walk-in-dialog/index'
import { StyleAnalyticsView } from './analytics'
import { DayList,MonthCalendar,WeekCalendar } from './calendar'
import { RANGES,TAB_KEYS,TAB_PARAM,type DashboardTab,type DashboardView } from './config'
import { ANALYTICS_DAYS,COMPARE } from './dashboard-options'
import { jstToday,shiftDate } from './date-range'
import { LessonRoster } from './lesson-roster'
import type { IndustryStyle,StyleAlertAction,StyleKpi,StyleRow } from './model'
import { SideCard } from './parts'
import { SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import { ClosureDialog,ViewDrawer } from './settings-panels'
import { StaffBoard } from './staff-board'
import styles from './style-dashboard.module.css'
import { TodayList } from './today-list'
import { useStyleDashboard } from './use-style-dashboard'




/*
 * ★V8 業種ダッシュボード（・・・・。絵 XBkC2）。
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
  fill: <Clock3 size={13} aria-hidden="true" />, recall: <BellRing size={13} aria-hidden="true" />,
}

const ALERT_ICON: Record<NonNullable<StyleAlertAction['icon']>, ReactNode> = {
  external: <ExternalLink size={16} aria-hidden="true" />, check: <Check size={16} aria-hidden="true" />, refresh: <RefreshCw size={16} aria-hidden="true" />,
  link: <Link2 size={16} aria-hidden="true" />, people: <Users size={16} aria-hidden="true" />,
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
  const { cfg, router, tab, view, range, days, accountId, role, canWrite, date, setDate, staff, setStaff, compare, setCompare, search, setSearch, failed, analytics, analyticsFailed, layout, applyPresentation, metricSelectionFallback, reloadPresentation, defaultMetrics, viewOpen, setViewOpen, closureOpen, setClosureOpen, phoneOpen, setPhoneOpen, walkInOpen, setWalkInOpen, busy, setBusy, rosterId, setRosterId, asideOpen, setAsideOpen, floor, loadedAt, store, tables, setParam, load, loadAnalytics, setCardDefaults, roster, rosterRow, today, preparing, openPayment, reload, subtitle, openRow, markVisit, markNoShow, approve, undoVisit, cancelRow, setCancelRow, refundRow, setRefundRow, resultRow, setResultRow, classRow, setClassRow, menuFor, confirmCancel, saveResult, testMode, alertAction, attend, KIND, saveClosure, addNew } = useStyleDashboard(style)

  const viewErrors = useSaveFormErrors()
  const headActions = (
    <>
      {canWrite && cfg.walkIn && store.store ? <Button onClick={() => setWalkInOpen(true)}><UserPlus size={16} aria-hidden="true" />ウォークイン</Button> : null}
      {canWrite ? <Button href="/broadcasts"><MessageCircle size={16} aria-hidden="true" />LINE を送る</Button> : null}
      {canWrite ? <Button onClick={() => setClosureOpen(true)}><CalendarX2 size={16} aria-hidden="true" />休みを入れる</Button> : null}
      {canWrite ? <Button onClick={() => setViewOpen(true)}><SlidersHorizontal size={16} aria-hidden="true" />表示を変える</Button> : null}
      {canWrite ? <Button variant="primary" onClick={() => addNew()}><Plus size={16} aria-hidden="true" />{cfg.primary}</Button> : null}
    </>
  )

  const staffOptions = [{ value: 'all', label: 'すべて' }, ...(today?.staff ?? []).map((s) => ({ value: s.id, label: s.name }))]
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

  const side = (today?.side ?? []).map((card) => <SideCard key={card.id} card={card} canWrite={canWrite} onAction={(card) => (card.id === 'pay' ? openPayment() : ['care', 'waitlist', 'rebook'].includes(card.id) ? preparing.open(card.title) : router.push('/broadcasts'))}>{card.id === 'pay' && testMode ? <TestModeNote /> : null}</SideCard>)

  let body: ReactNode
  if (!today) {
    body = failed ? <ListState kind="error" title="ダッシュボードを読み込めませんでした" onRetry={() => void reload()} /> : <ListState kind="loading" />
  } else if (tab === 'analytics') {
    body = <StyleAnalyticsView data={analytics} error={analyticsFailed} onTab={(t) => setParam({ sub: t })} onRetry={() => void loadAnalytics()} onRowOpen={() => router.push(cfg.links.bookings)} />
  } else if (style === 'consult' && tab === 'bookings') {
    // 結果待ち（OJ4Vu）：実施した面談のうち、結果をまだ付けていない物。押すと結果を付ける窓。
    body = (
      <DetailColumns variant="style-dashboard" asideLabel="今日の動き" expanded={false} onExpandedChange={() => {}} showToggle={false} aside={side.length ? side : null}>
          <TodayList style={style} rows={resultRows} note={`${resultRows.length}件中 1〜${resultRows.length}件・結果を付けると、分析の成約率に入ります`} canWrite={canWrite} busyId={busy} menuFor={menuFor}
            onVisit={(r) => void markVisit(r)} onUndo={() => {}} onResult={(r) => setResultRow(r)}
            empty={<ListState kind="empty" title="結果待ちの面談はありません" description="実施した面談に結果を付けると、ここから消えます。" />} />
      </DetailColumns>
    )
  } else if (tab !== 'main') {
    body = <ListState kind="empty" title={`${cfg.tabs[tab]}は今の画面で見られます`} action={<Button href={tab === 'bookings' ? cfg.links.bookings : cfg.links.people}>{`${cfg.tabs[tab]}を開く`}</Button>} />
  } else {
    const rows = today.rows.filter((r) => !search || r.name.includes(search) || (r.sub ?? '').includes(search) || (r.course ?? '').includes(search))
    const shownRoster = style === 'lesson' && (rosterId === undefined ? view !== 'calendar' : rosterId !== null && roster?.rowId === rosterId) ? roster : null
    let main: ReactNode
    let aside: ReactNode = side.length ? side : null
    if (view === 'calendar') {
      if (range === 'month' && today.month) {
        main = <MonthCalendar month={today.month} onMove={(s) => setDate(s === 0 ? jstToday() : shiftDate(date, 'month', s))} onDay={(d) => setDate(d)} />
        aside = <DayList month={today.month} href={cfg.links.bookings} />
      } else if (today.week) {
        main = <WeekCalendar week={today.week} period={range === 'today' ? 'day' : 'week'} canWrite={canWrite} onMove={(s) => setDate(s === 0 ? jstToday() : shiftDate(date, range === 'today' ? 'today' : 'week', s))} onSlot={(day, time) => addNew({ date: day, time })} onOpen={(id) => { const row = today.rows.find((item) => item.id === id); if (row) openRow(row) }} />
        aside = null
      } else main = <ListState kind="empty" title="カレンダーに出す予約はまだありません" />
    } else if (view === 'floor') {
      main = floor ? <RestaurantFloorMap floor={floor} labels={tables.map((t) => ({ id: t.id, label: t.code, active: Boolean(t.is_active), capacity: t.max_capacity }))} onSelect={() => router.push('/restaurant-test/tables')} />
        : <ListState kind="empty" title="座席の図がまだありません" action={canWrite ? <Button href="/restaurant-test/tables">座席の図を作る</Button> : undefined} />
    } else if (view === 'board' && today.board) {
      main = <StaffBoard board={today.board} search={search} onSearch={setSearch} canWrite={canWrite} onSlot={(staffId, time) => addNew({ staffId, time })}
        entryItems={(e) => menuFor(today.rows.find((r) => r.id === e.id) ?? { id: e.id, time: e.start, name: e.name })} />
    } else {
      main = (
        <>
          {style !== 'lesson' ? <div className={styles.listTools}><span className={styles.grow} /><div className={styles.search}><ListToolbar search={{ value: search, onChange: setSearch, placeholder: cfg.search, width: 220 }} /></div></div> : null}
          <TodayList style={style} rows={rows} note={today.rowsNote} canWrite={canWrite} busyId={busy} menuFor={menuFor} onVisit={(r) => void markVisit(r)} onNoShow={(r) => void markNoShow(r)} onApprove={(r) => void approve(r)} onResult={(r) => setResultRow(r)} onUndo={(r) => void undoVisit(r)}
            empty={<ListState kind="empty" title={`${range === 'today' ? '今日' : range === 'week' ? '今週' : '今月'}の${style === 'consult' ? '面談' : style === 'lesson' ? 'クラス' : '予約'}はありません`} description={canWrite ? (style === 'consult' ? '予約の URL を案内すると、空いた時間に入ります。' : '空いている時間に予約を入れられます。') : undefined}
              action={canWrite ? (style === 'consult' ? <Button variant="primary" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/booking`).then(() => notifyToast('予約 URL をコピーしました。')) }}><Copy size={16} aria-hidden="true" />予約 URL をコピー</Button> : <Button variant="primary" onClick={() => addNew()}><Plus size={16} aria-hidden="true" />{cfg.primary}</Button>) : undefined} />}
            selectedId={style === 'lesson' ? (shownRoster ? shownRoster.rowId : null) : undefined} onSelect={style === 'lesson' ? (r) => setRosterId(r.id) : undefined} />
        </>
      )
    }
    if (shownRoster) aside = <LessonRoster roster={shownRoster} canWrite={canWrite} onClose={() => setRosterId(null)} onPay={openPayment} onAttend={(name) => void attend(shownRoster, name)} onAbsent={(name) => void attend(shownRoster, name, 'no_show')} onLine={() => router.push('/broadcasts')} onCancelClass={() => { if (canWrite && rosterRow?.id === shownRoster.rowId) setClassRow(rosterRow) }} />
    body = (
      <DetailColumns variant={shownRoster ? 'style-roster' : 'style-dashboard'} aside={aside} asideLabel="今日の動き" expanded={asideOpen} onExpandedChange={setAsideOpen}
        toggleLabel={asideOpen ? '右の列を畳む' : roster ? '名簿を見る' : '新着・お支払いを見る'}>{main}</DetailColumns>
    )
  }

  const alert = tab !== 'analytics' ? today?.alert : null

  return (
    <DashboardPage boardId={`style-${style}`} title={cfg.title} help={cfg.help} subtitle={subtitle} actions={headActions}>
      <div className={styles.head}>{filters}</div>
      <div className={styles.inset}>
        {!canWrite && role !== null ? <ReadOnlyNotice /> : null}
        {metricSelectionFallback ? <Notice tone="info" action={<Button onClick={reloadPresentation}>表示設定を読み直す</Button>}>保存した表示設定を確認できないため、業種の初期表示にしています。</Notice> : null}
        {today && today.kpis.length === 0 ? null : <KpiBand layout="link-row" maxColumns={5} data-style-dashboard={style}>
          {(today?.kpis ?? []).map((kpi) => <Kpi key={kpi.id} kpi={kpi} onPreparing={openPayment} />)}
        </KpiBand>}
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
      <div className={styles.content}><CalendarPeriod period={view === 'calendar' && today ? range === 'month' ? date.slice(0, 7) : today.week?.days[0]?.date ?? date : ''} scope={`${accountId}/${style}/${view}/${range}`}>{body}</CalendarPeriod></div>
      {style === 'restaurant' && store.store ? (
        <>
          <PhoneReservationDrawer open={phoneOpen} accountId={store.accountId} storeId={store.store.id} tables={tables} onClose={() => setPhoneOpen(false)}
            onSaved={({ lineFailed }) => { setPhoneOpen(false); notifyToast(lineFailed ? '予約は入れました。LINE の確認は送れていません。' : '予約を入れました。', lineFailed ? { tone: 'error' } : undefined); void reload() }} />
          <WalkInDialog open={walkInOpen} accountId={store.accountId} storeId={store.store.id} tables={tables} onClose={() => setWalkInOpen(false)}
            onSaved={({ seated }) => { setWalkInOpen(false); notifyToast(seated ? '入店にしました。' : '席は取りました。来店の印は付けられませんでした。表の［来店］を押してください。', seated ? undefined : { tone: 'error' }); void reload() }} />
        </>
      ) : null}
      <SaveErrorScope errors={viewErrors}><ViewDrawer open={viewOpen} layout={layout} industry={style} defaultMetrics={defaultMetrics} busy={busy === 'layout'} onClose={() => setViewOpen(false)}
        onChangeStyle={(next) => { if (!layout) return; setBusy('layout'); void styleApi.save(accountId, { expectedVersion: layout.version, style: next }).then(() => { notifyToast('型を変えました。'); window.location.assign('/') }).catch((e) => { if (!viewErrors.capture(e)) notifyToast(japaneseDetailOf(e) || '型を変えられませんでした。', { tone: 'error' }) }).finally(() => setBusy('')) }}
        onReset={() => { if (!layout) return; setBusy('layout'); void styleApi.resetCards(accountId, layout.version).then((r) => { if (!applyPresentation(r.data, true)) return; setCardDefaults(r.data.cards); notifyToast('型に戻しました。') }).catch((e) => notifyToast(japaneseDetailOf(e) || '型に戻せませんでした。', { tone: 'error' })).finally(() => setBusy('')) }}
        onSave={(next, metricIds) => { if (!layout) return; setBusy('layout'); void styleApi.saveCards(accountId, layout.version, next.map((c) => ({ id: c.id, visible: c.on })), metricIds).then((r) => { if (!applyPresentation(r.data)) return; setViewOpen(false); notifyToast('表示を保存しました。'); void load() }).catch((e) => { if (!viewErrors.capture(e)) notifyToast(japaneseDetailOf(e) || '表示を保存できませんでした。', { tone: 'error' }) }).finally(() => setBusy('')) }} /></SaveErrorScope>
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
          facts={[{ label: 'お支払い', value: cancelRow.booking?.price ? `${formatYen(cancelRow.booking.price * (style === 'restaurant' ? cancelRow.booking.partySize : 1))}（支払いの記録は決済の口から）` : 'お支払いなし' }]}
          fullAmount={cancelRow.booking?.price ? cancelRow.booking.price * (style === 'restaurant' ? cancelRow.booking.partySize : 1) : null} testMode={testMode} busy={busy === 'cancel'}
          messageFor={(i) => `${cancelRow.name}さま　${i.reason ? `${i.reason}で` : 'お店の都合で'} ${cancelRow.time} のご予約を取り消しました。申し訳ありません。${i.refund === 'full' ? 'お支払いは全額を返金します。' : ''}`}
          onClose={() => setCancelRow(null)} onConfirm={(i) => void confirmCancel(cancelRow, i)} />
      ) : null}
      {refundRow ? (
        <RefundDialog open subtitle={`${refundRow.name}さま・${refundRow.time}${refundRow.course ? ` ${refundRow.course}` : ''}${refundRow.people ? ` ${refundRow.people}名` : ''}`}
          facts={[{ label: '支払った額', value: refundRow.booking?.price ? `${formatYen(refundRow.booking.price * (style === 'restaurant' ? refundRow.booking.partySize : 1))}` : '—' }, { label: 'これまでの返金', value: 'なし' }]}
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
      <RadioCardGroup className={styles.resultChoices} legend="面談の結果">
        {OUTCOMES.map((o) => <Radio key={o.value} name="outcome" checked={value === o.value} onChange={() => setValue(o.value)}>{o.label}</Radio>)}
      </RadioCardGroup>
    </Dialog>
  )
}
