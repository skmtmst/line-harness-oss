'use client'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Fragment, useState, type ReactNode } from 'react'
import { Calendar, Eye, Image as ImageIcon, Inbox, Package, Plus, SlidersHorizontal } from 'lucide-react'
import type { DashboardCardId } from '@line-crm/shared'
import { DashboardColumns, DashboardPage, DashboardRow } from '@/components/templates/dashboard-page'
import Button from '@/components/shared/button'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import SectionHeader from './head'
import SegmentedControl from '@/components/shared/segmented'
import { STATE_TEXT } from '@/components/shared/not-connected'
import ShipmentPanel from '@/components/dashboard/shipment-panel'
import { dashboardPeriodLabel, formatDashboardAsOf } from '@/components/dashboard/freshness'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatWaitRough } from '@/lib/format-duration'
import { formatNumber, formatTime } from '@/lib/format'
import { PERIODS, jstDay, useDashboard, type PeriodKey } from './use-dashboard'
import { FirstStepsCard, useFirstSteps } from './first-steps'
import { FriendTrend, trendRangeNote } from './trend'
import { InboxSection } from './inbox'
import { FriendAddLink } from './friend-add'
import {
  ConnectionStatus,
  DeliveryFailures,
  FriendStatus,
  Loading,
  Metric,
  MonthlyDelivery,
  OperationalAlerts,
  RecentActivity,
  RecentResults,
  SendQuota,
  SupportStatus,
  Tag,
  Unavailable,
  Upcoming,
} from './sections'
import styles from './dashboard.module.css'

/* 編集パネル（dnd-kit を含む重い部品）は開くまで読まない（v7 の V8 と同じ）。 */
const DashboardEditor = dynamic(() => import('@/components/dashboard/dashboard-editor').then((module) => module.default), {
  loading: () => <p className={styles.note}>編集パネルを読み込んでいます</p>,
})

/** 時間帯のあいさつ（日本時間）。 */
export function greeting(name: string | null, now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tokyo' }).format(now))
  const word = hour >= 4 && hour < 10 ? 'おはようございます' : hour >= 10 && hour < 18 ? 'こんにちは' : 'こんばんは'
  const first = name?.trim().split(/\s+/)[0]
  return first ? `${word}、${first} さん` : word
}

/** 見出しの下の1行：「更新 1月13日（火）9:30 ・ 正常に動いています」。 */
export function headline(asOf: string | null | undefined, risk: 'normal' | 'warning' | 'danger' | null): string {
  const time = formatDashboardAsOf(asOf)?.replace(/） /, '）')
  const health = risk === 'normal' ? '正常に動いています' : risk === 'warning' ? '確かめることがあります' : risk === 'danger' ? '止まっているところがあります' : '動きを確かめています'
  return time ? `更新 ${time} ・ ${health}` : health
}

/** 「…」のメニュー。数のマスごとに1つ。 */
function CellMenu({ title, items }: { title: string; items: ActionMenuItem[] }) {
  return <RowMenu className={styles.cellMenu} label={`${title}の操作`} items={items} />
}

/* 右の列の組み合わせ（WQmep）：どの本文の段の右に、どの右の列のカードを置くか。 */
const ASIDE_OF: Partial<Record<DashboardCardId, DashboardCardId[]>> = {
  'friend-trend': ['send-quota', 'operational-alerts'],
  'pending-inbox': ['support-mark-status', 'connection-status'],
  'friend-add': ['friend-status'],
}
const ROW_VARIANT: Partial<Record<DashboardCardId, 'trend' | 'inbox' | 'link'>> = {
  'friend-trend': 'trend',
  'pending-inbox': 'inbox',
  'friend-add': 'link',
}

export default function DashboardV8() {
  const router = useRouter()
  const d = useDashboard()
  const role = useStaffRole()
  /* 役割が読めるまでは出し、閲覧のみと分かったら隠す（サーバの 403 が最後の守り）。 */
  const canManage = role === null || canManageRole(role)
  /* 修正案 D-3：はじめにやること（今の「はじめの設定」の帯の場所に置き換える）。 */
  const start = useFirstSteps(d.selectedAccountId, role)
  const [openDetail, setOpenDetail] = useState<DashboardCardId | null>(null)
  const data = d.data
  const reference = d.reference

  /* ── 数の帯（今日やること） ─────────────────────── */
  const todayCell = (id: DashboardCardId): { node: ReactNode; detail: ReactNode } | null => {
    const menu = (title: string, href: string, label: string) => (
      <CellMenu
        title={title}
        items={[
          { id: 'detail', label: openDetail === id ? '内訳を閉じる' : '内訳を見る', onSelect: () => setOpenDetail((current) => (current === id ? null : id)) },
          { id: 'go', label, external: true, onSelect: () => router.push(href) },
          { id: 'edit', label: 'ダッシュボード編集', dividerBefore: true, onSelect: d.openEditor },
        ]}
      />
    )
    if (id === 'today-inbox') {
      const total = d.pendingTotal
      return {
        node: <KpiCard
          key={id}
          presentation="band"
          title="対応が必要な受信"
          icon={<Inbox size={13} aria-hidden="true" />}
          menu={menu('対応が必要な受信', '/chats?status=unread', '受信箱を開く')}
          value={total}
          unit="件"
          loading={d.pendingDetailState === 'loading'}
          delta={total !== null && total > 0 && d.pendingOldest !== null ? <Tag>{`最長 ${formatWaitRough(d.pendingOldest)}`}</Tag> : null}
          detail={d.pendingDetailState === 'ready'
            ? `LINE ${d.lineUnread === null ? '未取得' : d.lineUnread}・メール ${d.mailUnread === null ? '未取得' : d.mailUnread}`
            : d.pendingDetailState === 'error' ? STATE_TEXT.error : STATE_TEXT.loading}
          action={{ label: '受信箱を開く', href: '/chats?status=unread' }}
        />,
        detail: <>
          <span>{`LINEの未対応：${d.lineUnread === null ? '未取得' : `${formatNumber(d.lineUnread)}件`}`}</span>
          <span>{`メールの未対応：${d.mailUnread === null ? '未取得' : `${formatNumber(d.mailUnread)}件`}`}</span>
          <span>{`最も古い未対応：${d.pendingOldest === null ? '—' : formatWaitRough(d.pendingOldest)}`}</span>
        </>,
      }
    }
    if (id === 'today-photo-review') {
      const override = reference?.pendingPhotos
      const value = override ?? d.pendingPhotos
      const state = override != null ? 'ready' : d.pendingPhotosState
      const forbidden = state === 'forbidden'
      const href = forbidden ? '/staff' : '/nen-members?tab=photos&status=pending_review'
      const action = forbidden ? '権限を確認する' : '審査する'
      return {
        node: <KpiCard
          key={id}
          presentation="band"
          title="写真審査"
          icon={<ImageIcon size={13} aria-hidden="true" />}
          menu={menu('写真審査', href, action)}
          value={forbidden ? null : value}
          unit="件"
          loading={state === 'loading'}
          delta={state === 'ready' ? <Tag>ポイント付与あり</Tag> : forbidden ? <Tag tone="danger">権限なし</Tag> : null}
          detail={forbidden ? '写真を見る権限がありません' : state === 'error' ? STATE_TEXT.error : value === null ? STATE_TEXT.loading : `確認待ち ${value}件`}
          action={{ label: action, href }}
        />,
        detail: <span>{forbidden
          ? '写真を見る権限がありません。権限を確認してください。'
          : state === 'ready' && value !== null && value > 0
            ? `確認待ちが${formatNumber(value)}件あります。審査するとポイントが付きます。`
            : '確認待ちの写真はありません。'}</span>,
      }
    }
    if (id === 'today-bookings') {
      const value = d.todayActiveBookings ?? (d.displayedBookings === null ? null : d.todayBookings.length)
      const next = d.upcomingBookings[0]
      const nextText = d.bookingsFailed ? STATE_TEXT.error
        : d.bookings === null ? STATE_TEXT.loading
          : next ? `次の予定 ${jstDay(next.starts_at) === d.today ? formatTime(next.starts_at) : `${jstDay(next.starts_at).slice(5).replace('-', '/').replace(/^0/, '')} ${formatTime(next.starts_at)}`}` : '次の予定はありません'
      return {
        node: <KpiCard
          key={id}
          presentation="band"
          title="今日の予約"
          icon={<Calendar size={13} aria-hidden="true" />}
          menu={menu('今日の予約', '/booking/bookings?view=day', '予約を見る')}
          value={value}
          unit="件"
          loading={value === null && !d.bookingsFailed}
          detail={nextText}
          action={{ label: '予約を見る', href: '/booking/bookings?view=day' }}
        />,
        detail: d.upcomingBookings.length === 0
          ? <span>{d.bookingsFailed ? STATE_TEXT.error : '直近の予約はありません。数は取消・完了を除く今日の予約です。'}</span>
          : <>{d.upcomingBookings.slice(0, 3).map((booking) => <span key={booking.id}>{`${formatTime(booking.starts_at)} ${booking.menu_name}`}</span>)}</>,
      }
    }
    if (id === 'today-shipments') {
      const s = d.shipmentSummary
      const state = d.shipmentState
      return {
        node: <KpiCard
          key={id}
          presentation="band"
          title="出荷予定（今日・明日）"
          icon={<Package size={13} aria-hidden="true" />}
          menu={menu('出荷予定', '/ec-commerce', 'ECを見る')}
          value={state === 'ready' ? (s?.soon ?? null) : null}
          unit="件"
          loading={state === 'loading'}
          detail={state === 'error' ? STATE_TEXT.error : state === 'ready' ? ((s?.soon ?? 0) > 0 ? `今日 ${s?.today ?? 0}件・明日 ${(s?.soon ?? 0) - (s?.today ?? 0)}件` : '未処理はありません') : STATE_TEXT.loading}
          action={{ label: 'ECを見る', href: '/ec-commerce' }}
        />,
        detail: <span>{state !== 'ready' || !s
          ? (state === 'error' ? STATE_TEXT.error : STATE_TEXT.loading)
          : `今日の出荷 ${formatNumber(s.today)}件・今日と明日 ${formatNumber(s.soon)}件（${s.scanLimited ? `直近${s.scanLimit}件のEC通知から算出` : 'EC通知から算出'}）`}</span>,
      }
    }
    return null
  }
  const todayCells = d.visibleToday.map((item) => ({ id: item.id, cell: todayCell(item.id) })).filter((entry) => entry.cell !== null)
  const openCell = todayCells.find((entry) => entry.id === openDetail)

  /* ── 右の列・段D のカード ──────────────────────── */
  const rightCard = (id: DashboardCardId): ReactNode => {
    const unavailable = (key: Parameters<typeof d.sectionAvailable>[0]) => data && !d.sectionAvailable(key)
    if (id === 'send-quota') return <SendQuota delivery={d.sectionAvailable('quota') ? data?.delivery ?? null : null} metric={data?.metrics?.monthlyQuota} section={data?.sections?.quota} onRetry={() => void d.load()} />
    if (id === 'operational-alerts') return <OperationalAlerts risk={d.displayedHealthRisk} healthIssues={d.healthIssueCount} oldestWaitMinutes={d.pendingOldest} twoFactor={d.displayedTwoFactor} referenceCount={reference?.operationalAlerts} failed={d.healthFailed} updatedAt={d.supplementLoadedAt} />
    if (id === 'support-mark-status') return <SupportStatus inbox={d.sectionAvailable('inbox') ? (data && reference?.supportInbox ? { ...data.inbox, ...reference.supportInbox } : data?.inbox ?? null) : null} autoOnInbound={d.supportMarkAutoOnInbound} />
    if (id === 'connection-status') return <ConnectionStatus webhook={d.selectedAccount?.webhook?.status} risk={d.displayedHealthRisk} activeFriends={d.activeFriends} healthFailed={d.healthFailed} />
    if (id === 'friend-status') return unavailable('friends')
      ? <><SectionHeader title="友だちの状態" /><Unavailable section={data?.sections?.friends} onRetry={() => void d.load()} /></>
      : data ? <FriendStatus friends={data.friends} /> : <><SectionHeader title="友だちの状態" /><Loading label="友だちの状態" /></>
    if (id === 'upcoming') return <Upcoming accountId={d.selectedAccountId} bookings={d.displayedBookings} loading={d.supplementLoading} today={d.today} jstDay={jstDay} startLoad={d.supplementGate} />
    if (id === 'delivery-failures') return <DeliveryFailures accountId={d.selectedAccountId} startLoad={d.supplementGate} />
    if (id === 'monthly-delivery') return unavailable('delivery')
      ? <><SectionHeader title="今月の配信" /><Unavailable section={data?.sections?.delivery} onRetry={() => void d.load()} /></>
      : data ? <MonthlyDelivery delivery={data.delivery} section={data.sections?.delivery} /> : <><SectionHeader title="今月の配信" /><Loading label="今月の配信" /></>
    if (id === 'recent-results') return unavailable('conversions')
      ? <><SectionHeader title="最近の成果" /><Unavailable section={data?.sections?.conversions} onRetry={() => void d.load()} /></>
      : data ? <RecentResults conversions={data.conversions} period={dashboardPeriodLabel(d.period) ?? 'この期間'} section={data.sections?.conversions} /> : <><SectionHeader title="最近の成果" /><Loading label="最近の成果" /></>
    const ops = d.sectionAvailable('operations') ? data?.operations : undefined
    const opsDetail = (text: string | null) => text ?? (data ? STATE_TEXT.error : STATE_TEXT.loading)
    if (id === 'booking-status') return <Metric title="予約状況" period="現在" href="/booking/bookings?view=list&status=requested" linkLabel="予約を見る" value={ops?.bookings?.pending ?? null} detail={opsDetail(ops?.bookings ? `今後の予約 ${ops.bookings.upcoming}件` : null)} section={data?.sections?.operations} loading={d.loading} />
    if (id === 'inflow-top') return <Metric title="流入経路TOP3" period={dashboardPeriodLabel(d.period) ?? undefined} href="/analytics?tab=routes" linkLabel="経路別の内訳を見る" value={ops?.inflowTop?.[0]?.count ?? (ops?.inflowTop ? 0 : null)} detail={opsDetail(ops?.inflowTop ? ops.inflowTop.map((item) => `${item.name ?? '—'} ${item.count}`).join('、') || '期間内の追加なし' : null)} section={data?.sections?.operations} loading={d.loading} />
    if (id === 'funnel-alert') return <Metric title="ファネル要注意" period={dashboardPeriodLabel(d.period) ?? undefined} href="/analytics?tab=funnel" linkLabel="ファネルを見る" value={ops?.funnelAlerts ?? null} detail="" help="3人以上追加され、成果が0件の経路です" section={data?.sections?.operations} loading={d.loading} />
    if (id === 'automation-failures') return <Metric title="オートメーション失敗" period={dashboardPeriodLabel(d.period) ?? undefined} href="/automations/runs?status=problems" linkLabel="実行状況を見る" value={ops?.automationFailures ?? null} detail="" help="期間内の失敗と一部失敗の合計です" section={data?.sections?.operations} loading={d.loading} />
    if (id === 'scenario-status') return <Metric title="シナリオ配信状況" period="現在" href="/scenarios" linkLabel="シナリオを見る" value={ops?.scenarios?.active ?? null} detail={opsDetail(ops?.scenarios ? `一時停止 ${ops.scenarios.paused}件` : null)} section={data?.sections?.operations} loading={d.loading} />
    if (id === 'uid-migration') return <Metric title="UID移行状況" period="現在" href="/accounts?tab=migration" linkLabel="移行状況を見る" value={ops?.migrations?.active ?? null} detail={opsDetail(ops?.migrations ? `完了 ${ops.migrations.completed}件` : null)} section={data?.sections?.operations} loading={d.loading} />
    return null
  }

  /* ── 本文の段（編集の並び順どおり） ───────────────── */
  const visibleRightIds = new Set(d.visibleRight.map((item) => item.id))
  const placedAside = new Set<DashboardCardId>()
  const rows: ReactNode[] = []
  const looseMain: DashboardCardId[] = []
  for (const item of d.preferences.main) {
    if (item.id === 'shipment') {
      /* 件数は隠していても取り続ける（v7 と同じ）。出荷があるときだけ段として出す。 */
      const show = item.visible && (d.shipmentSummary?.soon ?? 0) > 0
      rows.push(
        <div key={item.id} className={show ? styles.shipmentRow : styles.hidden} aria-hidden={!show}>
          <ShipmentPanel accountId={d.selectedAccountId} onSummaryChange={d.handleShipmentSummary} />
        </div>,
      )
      continue
    }
    if (item.id === 'pending-inbox' && !item.visible) {
      /* 隠していても、上の数の帯のメール件数のために取り続ける（DASH-21）。 */
      rows.push(<div key={item.id} className={styles.hidden} aria-hidden="true"><InboxSection onSummaryChange={d.handleInboxSummary} /></div>)
      continue
    }
    if (!item.visible) continue
    const variant = ROW_VARIANT[item.id]
    if (!variant) {
      looseMain.push(item.id)
      continue
    }
    const asideIds = (ASIDE_OF[item.id] ?? []).filter((id) => visibleRightIds.has(id))
    asideIds.forEach((id) => placedAside.add(id))
    const main = item.id === 'friend-trend' ? (
      unavailableTrend() ?? <>
        <SectionHeader
          title="友だち数の推移"
          note={trendRangeNote(trendOf())}
          help="集計は期間の切り替えにかかわらず、いつも直近7日です。"
          helpLabel="友だち数の推移の説明"
          href="/analytics?tab=friends"
          linkLabel="さらに詳しく"
        />
        <FriendTrend trend={trendOf()} loading={d.loading} />
      </>
    ) : item.id === 'pending-inbox' ? (
      <InboxSection onSummaryChange={d.handleInboxSummary} />
    ) : (
      <FriendAddLink
        officialProfileUrl={data?.metrics === undefined ? undefined : data.metrics.officialProfileUrl.value}
        visualQa={data?.visualQa}
        canManage={canManage}
      />
    )
    rows.push(
      <DashboardRow
        key={item.id}
        variant={variant}
        aside={asideIds.length > 0 ? (
          variant === 'link'
            ? <>{asideIds.map((id) => <Fragment key={id}>{rightCard(id)}</Fragment>)}</>
            : <div className={styles.asideStack}>{asideIds.map((id) => <Fragment key={id}>{rightCard(id)}</Fragment>)}</div>
        ) : undefined}
      >
        {main}
      </DashboardRow>,
    )
  }
  /*
   * 板が狭い（型が右の列を隠す幅）ときは、右の列のカードを段Dと同じ並びで出し直す。
   * 隠したまま数字を落とさないため。広い板では CSS で隠れている。
   */
  const placedList = [...placedAside]
  for (let index = 0; index < placedList.length; index += 4) {
    const chunk = placedList.slice(index, index + 4)
    rows.push(
      <div key={`narrow-${index}`} className={styles.narrowAside}>
        <DashboardColumns>{chunk.map((id) => <Fragment key={id}>{rightCard(id)}</Fragment>)}</DashboardColumns>
      </div>,
    )
  }
  const columnIds: DashboardCardId[] = [
    ...d.visibleRight.map((item) => item.id).filter((id) => !placedAside.has(id)),
    ...looseMain,
  ]
  for (let index = 0; index < columnIds.length; index += 4) {
    const chunk = columnIds.slice(index, index + 4)
    rows.push(<DashboardColumns key={`cols-${index}`}>{chunk.map((id) => <Fragment key={id}>{rightCard(id)}</Fragment>)}</DashboardColumns>)
  }

  function trendOf() {
    const metric = data?.metrics?.friendTrend
    return metric === undefined ? data?.trend ?? [] : metric.value ?? []
  }
  function unavailableTrend(): ReactNode | null {
    if (!data || d.sectionAvailable('trend')) return null
    return <><SectionHeader title="友だち数の推移" /><Unavailable section={data.sections?.trend} onRetry={() => void d.load()} /></>
  }

  const viewer = role !== null && !canManageRole(role)
  const notice = start.summary || viewer || d.error || data?.partialFailures?.length ? (
    <div className={styles.notices}>
      {viewer ? (
        <div className={styles.viewerBand} role="status">
          <Eye size={16} aria-hidden="true" />
          <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
        </div>
      ) : null}
      {start.summary ? <FirstStepsCard summary={start.summary} onDismiss={start.dismiss} /> : null}
      {d.error ? (
        <div className={styles.errorBand} role="alert">
          <span>{d.error}</span>
          <Button type="button" onClick={() => void d.load()}>もう一度読み込む</Button>
        </div>
      ) : null}
      {data?.partialFailures?.length ? (
        <p className={styles.note} role="status">{`一部のデータを${STATE_TEXT.error}（${data.partialFailures.join('、')}）。0件としては表示していません。`}</p>
      ) : null}
    </div>
  ) : undefined

  return (
    <DashboardPage
      boardId="WQmep"
      headingSize="compact"
      title={greeting(d.staffName)}
      description={headline(data?.asOf, d.displayedHealthRisk)}
      actions={<>
        <SegmentedControl<PeriodKey>
          aria-label="集計の期間"
          value={d.period}
          onChange={d.selectPeriod}
          options={PERIODS.map((item) => ({ value: item.key, label: item.label }))}
        />
        <Button type="button" onClick={d.openEditor}><SlidersHorizontal size={15} aria-hidden="true" />ダッシュボード編集</Button>
        {canManage ? <Button variant="primary" href="/broadcasts/new"><Plus size={15} aria-hidden="true" />配信を作る</Button> : null}
      </>}
      notice={notice}
      overlays={d.editorOpen ? <DashboardEditor
        open={d.editorOpen}
        preferences={d.preferences}
        saving={d.preferenceSaving}
        saveError={d.preferenceSaveError?.message ?? null}
        saveConflict={d.preferenceSaveError?.conflict ?? false}
        onReloadPreferences={d.reloadPreferences}
        onCancel={d.closeEditor}
        onApply={d.applyPreferences}
        onReset={d.resetPreferences}
      /> : null}
    >
      {todayCells.length > 0 ? (
        <KpiBand className={styles.todayBand} data-design="TodayTasks">
          {todayCells.map((entry) => entry.cell?.node)}
        </KpiBand>
      ) : null}
      {openCell?.cell ? (
        <div className={styles.cellDetail} role="region" aria-label="内訳">
          {openCell.cell.detail}
        </div>
      ) : null}
      {/* 本文の段が見えたら補足の口を叩く（速さ対応）。 */}
      <div ref={d.bodyRef} className={styles.body}>
        {rows}
        <RecentActivity items={d.notifications} failed={d.notificationFailed} />
      </div>
    </DashboardPage>
  )
}
