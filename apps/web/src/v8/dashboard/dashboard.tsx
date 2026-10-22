'use client'
import { KpiValueMotionProvider } from '@/components/shared/kpi-value-motion'
import { dashboardPeriodLabel } from '@/components/dashboard/freshness'
import { partialFailureLabels,partialFailuresWithoutCard } from '@/components/dashboard/partial-failure-labels'
import ShipmentPanel from '@/components/dashboard/shipment-panel'
import { permissionDeniedMessage } from '@/components/shared/api-error-message'
import Button from '@/components/shared/button'
import { emptyValue } from '@/components/shared/empty-value'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import { STATE_TEXT } from '@/components/shared/not-connected'
import Notice from '@/components/shared/notice'
import PeriodPicker from '@/components/shared/period-picker'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { RetryLabel } from '@/components/shared/retry-label'
import { DashboardColumns,DashboardPage,DashboardRow } from '@/components/templates/dashboard-page'
import { useAccount } from '@/contexts/account-context'
import { formatNumber,formatTime } from '@/lib/format'
import { formatWaitRough } from '@/lib/format-duration'
import { canManageRole,useStaffRole } from '@/lib/staff-role'
import { SetupCard, SetupWarningBands, setupSummary } from '@/v8/onboarding/public/setup-card/index'
import ListState from '@/components/shared/list-state'
import { useStyleSetup } from '@/v8/onboarding/public/use-style-setup/index'
import type { DashboardCardId } from '@line-crm/shared'
import { Calendar,Image as ImageIcon,Inbox,Package,Plus,SlidersHorizontal } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { Fragment,useEffect,useRef,useState,type ReactNode } from 'react'
import { canEditDashboardLayout,greeting,headline } from './dashboard-heading'
import styles from './dashboard.module.css'
import { FirstStepsCard,useFirstSteps } from './first-steps'
import { FriendAddLink } from './friend-add'
import SectionHeader from './head'
import { InboxSection } from './inbox'
import { ConnectionStatus,DeliveryFailures,FriendStatus,Loading,Metric,MonthlyDelivery,OperationalAlerts,RecentActivity,RecentResults,SendQuota,SupportStatus,Tag,Unavailable,Upcoming } from './sections'
import { FriendTrend,trendRangeNote } from './trend'
import { PERIODS,jstDay,useDashboard } from './use-dashboard'
import { dashboardCardForStyle } from './style-cards'
export { canEditDashboardLayout,greeting,headline } from './dashboard-heading'


/* 編集の引き出し（・dnd-kit を含む重い部品）は開くまで読まない。V8 だけの作り（管理画面 の部品は使わない）。 */
/* はじめの質問の窓（xxpM9 ほか）も開くまで読まない。 */
const EcSummary = dynamic(() => import('./ec-summary'))

const StyleSetupWizard = dynamic(() => import('../onboarding/wizard/index').then((module) => module.default))

const DashboardEditor = dynamic(() => import('./dashboard-editor').then((module) => module.default), {
  loading: () => <p className={styles.note}>編集パネルを読み込んでいます</p>,
})

/* 右の列の組み合わせ：どの本文の段の右に、どの右の列のカードを置くか。 */
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

export default function DashboardV8({ usageStyle }: { usageStyle?: 'standard' | 'ec' } = {}) {
  const router = useRouter()
  const d = useDashboard(usageStyle)
  const role = useStaffRole()
  const { refreshAccounts } = useAccount()
  /* 役割が読めるまでは出し、閲覧のみと分かったら隠す（サーバの 403 が最後の守り）。 */
  const canManage = canManageRole(role)
  const canEditLayout = canEditDashboardLayout(role)
  /* 修正案 D-3：はじめにやること（今の「はじめの設定」の帯の場所に置き換える）。 */
  const start = useFirstSteps(d.selectedAccountId, role)
  /* 〜：はじめの質問の答え・警告の帯・はじめにやること（スタイルの口が読めたときだけ）。 */
  const setup = useStyleSetup(d.selectedAccountId, role)
  const setupRest = setupSummary(setup.data)
  const params = useSearchParams()
  const setupParam = params.get('setup')
  const qrRequested = params.has('qr')
  const closedWizardAccount = useRef<string | null>(null)
  const [wizardStep, setWizardStep] = useState<number | 'summary' | null>(null)
  useEffect(() => {
    setWizardStep(null)
    closedWizardAccount.current = null
  }, [d.selectedAccountId])
  useEffect(() => {
    if (setupParam === 'summary') setWizardStep('summary')
    else if (setupParam !== null && /^\d+$/.test(setupParam)) setWizardStep(Number(setupParam))
  }, [setupParam, d.selectedAccountId])
  /* まだスタイルを選んでいない（あとでも選んでいない）アカウントは、最初に入ったとき 1 問目を開く。 */
  useEffect(() => {
    const state = setup.data?.state
    /* 新規の印だけで案内する。過去の曖昧な「あとで」には表示しない。 */
    if (!state || !canManage || state.styleSelected || !d.selectedAccountId || qrRequested || closedWizardAccount.current === d.selectedAccountId) return
    if (state.shouldPromptStyleSelection !== true) return
    setWizardStep((current) => current ?? 0)
  }, [setup.data, canManage, d.selectedAccountId, qrRequested])
  const openSetupStep = (step: string | number) => {
    if (typeof step === 'number') { setWizardStep(step); return }
    const names = setup.data ? ['style', 'image'] : []
    setWizardStep(step === 'summary' ? 'summary' : Math.max(0, names.indexOf(step)))
  }
  const closeWizard = (changed: boolean) => {
    // 読み直しても未選択の状態は変えず、この画面で閉じた窓を自動では開き直さない。
    closedWizardAccount.current = d.selectedAccountId
    setWizardStep(null)
    if (setupParam !== null) router.replace('/')
    if (changed) setup.reload()
  }
  const [openDetail, setOpenDetail] = useState<DashboardCardId | null>(null)
  const data = d.data
  const reference = d.reference

  /* ── 数の帯（今日やること） ─────────────────────── */
  const todayCell = (id: DashboardCardId): { node: ReactNode; detail: ReactNode } | null => {
    const valueAction = (title: string) => ({ label: `${title}の内訳${openDetail === id ? 'を閉じる' : 'を見る'}`, expanded: openDetail === id, onClick: () => setOpenDetail((current) => current === id ? null : id) })
    if (id === 'today-inbox') {
      const total = d.pendingTotal
      return {
        node: <KpiCard
          key={id}
          presentation="band"
          title="対応が必要な受信"
          icon={<Inbox size={13} aria-hidden="true" />}
          valueAction={valueAction('対応が必要な受信')}
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
          <span>{`最も古い未対応：${d.pendingOldest === null ? emptyValue('unknown') : formatWaitRough(d.pendingOldest)}`}</span>
        </>,
      }
    }
    if (id === 'today-photo-review') {
      const override = reference?.pendingPhotos
      const value = override ?? d.pendingPhotos
      const state = override != null ? 'ready' : d.pendingPhotosState
      const forbidden = state === 'forbidden'
      const href = forbidden ? '/staff' : '/nen-members?tab=photos&status=pending_review'
      const action = forbidden ? permissionDeniedMessage('store') : '審査する'
      return {
        node: <KpiCard
          key={id}
          presentation="band"
          title="写真審査"
          icon={<ImageIcon size={13} aria-hidden="true" />}
          valueAction={valueAction('写真審査')}
          value={forbidden ? null : value}
          unit="件"
          loading={state === 'loading'}
          delta={state === 'ready' ? <Tag>ポイント付与あり</Tag> : forbidden ? <Tag tone="danger">権限なし</Tag> : null}
          detail={forbidden ? permissionDeniedMessage('store') : state === 'error' ? STATE_TEXT.error : value === null ? STATE_TEXT.loading : `確認待ち ${value}件`}
          action={{ label: action, href }}
        />,
        detail: <span>{forbidden
          ? permissionDeniedMessage('store')
          : state === 'ready' && value !== null && value > 0
            ? `確認待ちが${formatNumber(value)} 件あります。審査するとポイントが付きます。`
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
          valueAction={valueAction('今日の予約')}
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
          valueAction={valueAction('出荷予定')}
          value={state === 'ready' ? (s?.soon ?? null) : null}
          unit="件"
          loading={state === 'loading'}
          detail={state === 'error' ? STATE_TEXT.error : state === 'ready' ? ((s?.soon ?? 0) > 0 ? `今日 ${s?.today ?? 0} 件・明日 ${(s?.soon ?? 0) - (s?.today ?? 0)} 件` : '未処理はありません') : STATE_TEXT.loading}
          action={{ label: 'ECを見る', href: '/ec-commerce' }}
        />,
        detail: <span>{state !== 'ready' || !s
          ? (state === 'error' ? STATE_TEXT.error : STATE_TEXT.loading)
          : `今日の出荷 ${formatNumber(s.today)} 件・今日と明日 ${formatNumber(s.soon)} 件（${s.scanLimited ? `直近${s.scanLimit} 件のEC通知から算出` : 'EC通知から算出'}）`}</span>,
      }
    }
    return null
  }
  const todayCells = d.visibleToday.map((item) => ({ id: item.id, cell: todayCell(item.id) })).filter((entry) => entry.cell !== null)
  const openCell = todayCells.find((entry) => entry.id === openDetail)

  const overviewFailed = !data && !d.loading && d.error !== ''
  /* ── 右の列・段D のカード ──────────────────────── */
  const rightCard = (id: DashboardCardId): ReactNode => {
    /* 概要が取れなかった（data なし）ときは骨組みを出し続けず、段ごとに「読み込めませんでした」を出す。 */
    const unavailable = (key: Parameters<typeof d.sectionAvailable>[0]) => overviewFailed || (data && !d.sectionAvailable(key))
    if (id === 'send-quota') return <SendQuota overviewFailed={overviewFailed} delivery={d.sectionAvailable('quota') ? data?.delivery ?? null : null} metric={data?.metrics?.monthlyQuota} section={data?.sections?.quota} onRetry={() => void d.load()} />
    if (id === 'operational-alerts') return <OperationalAlerts risk={d.displayedHealthRisk} healthIssues={d.healthIssueCount} oldestWaitMinutes={d.pendingOldest} twoFactor={d.displayedTwoFactor} referenceCount={reference?.operationalAlerts} failed={d.healthFailed} updatedAt={d.supplementLoadedAt} />
    if (id === 'support-mark-status') return <SupportStatus inbox={d.sectionAvailable('inbox') ? (data && reference?.supportInbox ? { ...data.inbox, ...reference.supportInbox } : data?.inbox ?? null) : null} autoOnInbound={d.supportMarkAutoOnInbound} />
    if (id === 'connection-status') return <ConnectionStatus account={d.selectedAccount} canCheck={role !== null && canManageRole(role)} onChecked={refreshAccounts} risk={d.displayedHealthRisk} activeFriends={d.activeFriends} healthFailed={d.healthFailed} />
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
    if (id === 'inflow-top') return <Metric title="流入経路TOP3" period={dashboardPeriodLabel(d.period) ?? undefined} href="/analytics?tab=routes" linkLabel="経路別の内訳を見る" value={ops?.inflowTop?.[0]?.count ?? (ops?.inflowTop ? 0 : null)} detail={opsDetail(ops?.inflowTop ? ops.inflowTop.map((item) => `${item.name ?? emptyValue('unknown')} ${item.count}`).join('、') || '期間内の追加なし' : null)} section={data?.sections?.operations} loading={d.loading} />
    if (id === 'funnel-alert') return <Metric title="ファネル要注意" period={dashboardPeriodLabel(d.period) ?? undefined} href="/analytics?tab=funnel" linkLabel="ファネルを見る" value={ops?.funnelAlerts ?? null} detail="" help="3人以上追加され、成果が0件の経路です" section={data?.sections?.operations} loading={d.loading} />
    if (id === 'automation-failures') return <Metric title="オートメーション失敗" period={dashboardPeriodLabel(d.period) ?? undefined} href="/automations/runs?status=problems" linkLabel="実行状況を見る" value={ops?.automationFailures ?? null} detail="" help="期間内の失敗と一部失敗の合計です" section={data?.sections?.operations} loading={d.loading} />
    if (id === 'scenario-status') return <Metric title="シナリオ配信状況" period="現在" href="/scenarios" linkLabel="シナリオを見る" value={ops?.scenarios?.active ?? null} detail={opsDetail(ops?.scenarios ? `一時停止 ${ops.scenarios.paused} 件` : null)} section={data?.sections?.operations} loading={d.loading} />
    if (id === 'uid-migration') return <Metric title="UID移行状況" period="現在" href="/accounts?tab=migration" linkLabel="移行状況を見る" value={ops?.migrations?.active ?? null} detail={opsDetail(ops?.migrations ? `完了 ${ops.migrations.completed} 件` : null)} section={data?.sections?.operations} loading={d.loading} />
    return null
  }

  /* ── 本文の段（編集の並び順どおり） ───────────────── */
  /* 右の列は上の数の帯の1マス分（帯が3・4マスのとき。帯が無い・2マス以下は4等分の1列）。 */
  const asideColumns = todayCells.length >= 3 ? todayCells.length : undefined
  const visibleRightIds = new Set(d.visibleRight.map((item) => item.id))
  const placedAside = new Set<DashboardCardId>()
  const rows: ReactNode[] = []
  const looseMain: DashboardCardId[] = []
  for (const item of d.preferences.main) {
    if (!dashboardCardForStyle(item.id, usageStyle, d.preferenceVersion > 0)) continue
    if (item.id === 'shipment') {
      if (usageStyle === 'standard') continue
      /* 件数は隠していても取り続ける（管理画面 と同じ）。出荷があるときだけ段として出す。 */
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
        asideSize="column"
        asideColumns={asideColumns}
        aside={asideIds.length > 0 ? (
          variant === 'link'
            ? <>{asideIds.map((id) => <Fragment key={id}>{rightCard(id)}</Fragment>)}</>
            : <div className={styles.asideStack} data-variant={variant}>{asideIds.map((id) => <Fragment key={id}>{rightCard(id)}</Fragment>)}</div>
        ) : undefined}
      >
        {main}
      </DashboardRow>,
    )
  }
  const columnIds: DashboardCardId[] = [
    ...d.visibleRight.map((item) => item.id).filter((id) => !placedAside.has(id)),
    ...looseMain,
  ]
  for (let index = 0; index < columnIds.length; index += 4) {
    const chunk = columnIds.slice(index, index + 4)
    rows.push(<DashboardColumns layout="overview" key={`cols-${index}`}>{chunk.map((id) => <Fragment key={id}>{rightCard(id)}</Fragment>)}</DashboardColumns>)
  }

  function trendOf() {
    const metric = data?.metrics?.friendTrend
    return metric === undefined ? data?.trend ?? [] : metric.value ?? []
  }
  function unavailableTrend(): ReactNode | null {
    if (!data && !overviewFailed) return null
    if (data && d.sectionAvailable('trend')) return null
    return <><SectionHeader title="友だち数の推移" /><Unavailable section={data?.sections?.trend} onRetry={() => void d.load()} /></>
  }

  const viewer = !canManageRole(role)
  /* 部品の中で自分のエラーを出すものは帯に重ねない。出し先の無いものだけ日本語の名前で帯に出す。 */
  const shownCardIds = new Set<string>([
    ...d.preferences.main.filter((item) => item.visible).map((item) => item.id),
    ...d.visibleRight.map((item) => item.id),
  ])
  const looseFailures = partialFailuresWithoutCard(data?.partialFailures ?? [], shownCardIds)
  const setupBands = setup.data && canManage ? <SetupWarningBands data={setup.data} /> : null
  const notice = start.error || setup.error || start.summary || setupRest || setup.data?.warnings.length || viewer || d.error || looseFailures.length ? (
    <div className={styles.notices}>
      {viewer ? (
        <ReadOnlyNotice />
      ) : null}
      {setupBands}
      {start.error && canManage ? <ListState kind="error" title="はじめの設定の状態を確認できませんでした" error={start.error} onRetry={start.reload} /> : start.summary ? <FirstStepsCard summary={start.summary} folded={start.folded} onToggle={start.toggle} /> : null}
      {setup.error && canManage ? <ListState kind="error" title="使い方の設定を確認できませんでした" error={setup.error} onRetry={setup.reload} /> : setupRest && canManage ? <SetupCard summary={setupRest} onOpenStep={openSetupStep} /> : null}
      {d.error ? (
        <Notice tone="danger" role="alert" action={<Button type="button" onClick={() => d.load()} busyLabel="処理中…"><RetryLabel /></Button>}>{d.error}</Notice>
      ) : null}
      {looseFailures.length ? (
        <Notice
          tone="warn"
          role="status"
          message={`${partialFailureLabels(looseFailures)}を${STATE_TEXT.error}。0件としては表示していません。`}
          action={<Button type="button" onClick={() => d.load()} busyLabel="処理中…"><RetryLabel /></Button>}
        />
      ) : null}
    </div>
  ) : undefined

  return (
    <KpiValueMotionProvider scope={d.selectedAccountId ? JSON.stringify([d.selectedAccountId, d.period, d.today]) : null}>
    <DashboardPage
      boardId="WQmep"
      headingSize="compact"
      title={usageStyle ? 'ダッシュボード' : greeting(d.staffName)}
      help={headline(data?.asOf, d.displayedHealthRisk)}
      actions={<>
        <PeriodPicker days={d.period === 'today' ? 1 : d.period === 'last7' ? 7 : 30} supportedDays={[1,7,30]} choices={PERIODS.map((item) => ({ days: item.key === 'today' ? 1 : item.key === 'last7' ? 7 : 30, label: item.label }))} onChange={(value) => d.selectPeriod(value === 1 ? 'today' : value === 7 ? 'last7' : 'last30')} />
        {canEditLayout ? <Button type="button" onClick={d.openEditor}><SlidersHorizontal size={15} aria-hidden="true" />表示を変える</Button> : null}
        {canManage ? <Button variant="primary" href="/broadcasts/new"><Plus size={15} aria-hidden="true" />配信を作る</Button> : null}
      </>}
      notice={notice}
      overlays={d.editorOpen && canEditLayout ? <DashboardEditor
        open={d.editorOpen}
        preferences={d.preferences}
        usageStyle={usageStyle}
        saving={d.preferenceSaving}
        saveError={d.preferenceSaveError?.message ?? null}
        saveConflict={d.preferenceSaveError?.conflict ?? false}
        onComparePreferences={d.comparePreferences}
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
        {usageStyle === 'ec' && d.selectedAccountId ? <EcSummary key={d.selectedAccountId} accountId={d.selectedAccountId} period={d.period} /> : null}
        {rows}
        <RecentActivity items={d.notifications} failed={d.notificationFailed} />
      </div>
      {/* はじめの質問の窓（B-313）。`?setup=0〜|summary` かスタイル未選択の最初の訪問で開く。 */}
      {wizardStep !== null && setup.data && d.selectedAccountId && canManage ? <StyleSetupWizard accountId={d.selectedAccountId} state={setup.data.state} initialStep={wizardStep} onClose={closeWizard} /> : null}
    </DashboardPage>
    </KpiValueMotionProvider>
  )
}
