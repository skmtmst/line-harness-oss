'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { EntryRoute } from '@line-crm/shared'
import { api, bookingApi, type BookingRequest, type DashboardOverview } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import PendingInboxCard, { type PendingInboxSummary } from '@/components/support/pending-inbox-card'
import ShipmentPanel, { type ShipmentSummary } from '@/components/dashboard/shipment-panel'
import QrDialog from '@/components/dashboard/qr-dialog'
import FriendTrendTable from '@/components/dashboard/friend-trend-table'
import {
  FriendStatusCard,
  MonthlyDeliveryCard,
  RecentResultsCard,
  UpcomingCard,
  activeUpcomingBookings,
} from '@/components/dashboard/side-cards'
import DashboardEditor, {
  defaultDashboardPreferences,
  normalizeDashboardPreferences,
  type DashboardCardId,
  type DashboardPreferences,
} from '@/components/dashboard/dashboard-editor'

const PERIODS = [
  { key: 'today', label: '今日' },
  { key: 'last7', label: '過去7日' },
  { key: 'last28', label: '過去28日' },
] as const

type PeriodKey = (typeof PERIODS)[number]['key']
type HealthRisk = 'normal' | 'warning' | 'danger' | null

const inactiveBookingStatuses = new Set(['rejected', 'cancelled', 'canceled', 'completed', 'no_show'])

function dashboardStorageKey(accountId: string | null): string {
  return `lh_dashboard_v4:${accountId ?? 'default'}`
}

function jstDay(iso: string | number | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso)
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 5h12M7 10h9M4 15h12M7 3v4m5 1v4m-5 1v4" strokeLinecap="round" />
    </svg>
  )
}

function DashboardCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`bg-canvas rounded-card border-hairline border shadow-[1px_2px_0_rgba(26,28,26,0.10)] ${className}`}>
      {children}
    </section>
  )
}

function TodayTaskCard({
  title,
  href,
  action,
  value,
  detail,
  status,
}: {
  title: string
  href: string
  action: string
  value: number | null
  detail: string
  status: string
}) {
  return (
    <DashboardCard className="flex min-h-[138px] flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-ink text-sm font-semibold">{title}</h3>
        <Link href={href} className="text-action shrink-0 text-xs font-medium hover:underline">{action}</Link>
      </div>
      <p className="text-ink mt-4 text-3xl font-bold tabular-nums">
        {value === null ? '—' : value.toLocaleString('ja-JP')}<span className="ml-0.5 text-lg">件</span>
      </p>
      <div className="mt-auto flex items-end justify-between gap-3 pt-3">
        <span className="text-ink-faint truncate text-xs" title={detail}>{detail}</span>
        <span className="text-success shrink-0 text-xs font-medium">{status}</span>
      </div>
    </DashboardCard>
  )
}

/** 友だち追加リンク。共有URLは計測とUUID紐づけができる正規の流入口を使う。 */
function FriendAddLinkCard() {
  const { selectedAccount } = useAccount()
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [routes, setRoutes] = useState<EntryRoute[]>([])
  const [routeId, setRouteId] = useState('')

  useEffect(() => {
    let cancelled = false
    void api.entryRoutes.list()
      .then((res) => {
        if (!cancelled && res.success) setRoutes(res.data.filter((route) => route.isActive))
      })
      .catch(() => {
        // 経路一覧だけが取れなくても、基本の追加URLは利用できる。
      })
    return () => { cancelled = true }
  }, [])

  const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  const baseLink = selectedAccount
    ? `${base}/auth/line?account=${encodeURIComponent(selectedAccount.channelId)}`
    : `${base}/auth/line`
  const route = routes.find((entry) => entry.id === routeId)
  const link = route ? `${base}/r/${route.refCode}` : baseLink

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // コピーできない環境でも、読み取り専用欄から手動で取得できる。
    }
  }

  return (
    <DashboardCard className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-ink text-sm font-semibold">友だち追加リンク</h2>
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">このURLから追加された友だちは、流入元を記録して計測できます。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="border-hairline bg-canvas rounded-control flex min-w-[220px] items-center gap-2 border px-3 py-2">
            <span className="text-ink-faint shrink-0 text-[10px] font-medium">発行中</span>
            <select
              value={routeId}
              onChange={(event) => setRouteId(event.target.value)}
              aria-label="発行中の追加URL"
              className="text-ink min-w-0 flex-1 bg-transparent text-xs font-medium focus:outline-none"
            >
              <option value="">基本の追加URL</option>
              {routes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          <Link href="/inflow-links" className="border-hairline text-action hover:bg-action-soft rounded-control border px-3 py-2 text-xs font-medium">経路を分けて発行</Link>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <input
          readOnly
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          aria-label="友だち追加リンク"
          className="border-hairline bg-canvas-sunken text-ink-secondary rounded-control min-w-0 flex-1 truncate border px-3 py-2.5 font-mono text-xs"
        />
        <button type="button" onClick={onCopy} className="bg-accent text-on-accent hover:bg-accent-hover rounded-control shrink-0 px-5 py-2.5 text-xs font-medium">
          {copied ? 'コピーしました ✓' : 'コピー'}
        </button>
        <button type="button" onClick={() => setShowQr(true)} className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control shrink-0 border px-5 py-2.5 text-xs font-medium">QRを表示</button>
      </div>

      <QrDialog
        open={showQr}
        onClose={() => setShowQr(false)}
        accountName={selectedAccount?.displayName ?? '然-NEN- 公式'}
        accountBasicId={selectedAccount?.basicId ?? null}
        baseLink={baseLink}
        initialRouteId={routeId}
      />
    </DashboardCard>
  )
}

function FriendTrendCard({ data, loading }: { data: DashboardOverview | null; loading: boolean }) {
  return (
    <DashboardCard>
      <div className="border-hairline flex items-center justify-between border-b px-5 py-3.5">
        <h2 className="text-ink text-sm font-semibold">友だち数の推移</h2>
        <Link href="/analytics" className="text-action text-xs hover:underline">さらに詳しく →</Link>
      </div>
      <FriendTrendTable trend={data?.trend ?? []} loading={loading} />
    </DashboardCard>
  )
}

function EmptyDataCard({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <DashboardCard>
      <div className="border-hairline flex items-center justify-between border-b px-5 py-3.5">
        <h2 className="text-ink text-sm font-semibold">{title}</h2>
        <Link href={href} className="text-action text-xs hover:underline">{linkLabel} →</Link>
      </div>
      <p className="text-ink-faint px-5 py-8 text-center text-sm">このカードで表示できるデータはまだありません。</p>
    </DashboardCard>
  )
}

export default function DashboardPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [period, setPeriod] = useState<PeriodKey>('today')
  const [data, setData] = useState<DashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [preferences, setPreferences] = useState<DashboardPreferences>(defaultDashboardPreferences)
  const [inboxSummary, setInboxSummary] = useState<PendingInboxSummary | null>(null)
  const [shipmentSummary, setShipmentSummary] = useState<ShipmentSummary | null>(null)
  const [pendingPhotos, setPendingPhotos] = useState<number | null>(null)
  const [bookings, setBookings] = useState<BookingRequest[] | null>(null)
  const [supplementLoading, setSupplementLoading] = useState(true)
  const [healthRisk, setHealthRisk] = useState<HealthRisk>(null)

  useEffect(() => {
    const key = dashboardStorageKey(selectedAccountId)
    try {
      const raw = window.localStorage.getItem(key)
      setPreferences(normalizeDashboardPreferences(raw ? JSON.parse(raw) : null))
    } catch {
      setPreferences(defaultDashboardPreferences())
    }
  }, [selectedAccountId])

  const applyPreferences = (next: DashboardPreferences) => {
    const normalized = normalizeDashboardPreferences(next)
    setPreferences(normalized)
    window.localStorage.setItem(dashboardStorageKey(selectedAccountId), JSON.stringify(normalized))
    setEditorOpen(false)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.dashboard.overview({ period, accountId: selectedAccountId ?? undefined })
      if (response.success) setData(response.data)
      else setError(response.error)
    } catch {
      setError('データの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [period, selectedAccountId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!selectedAccountId) {
      setBookings(null)
      setPendingPhotos(null)
      setHealthRisk(null)
      setSupplementLoading(false)
      return
    }
    let cancelled = false
    setSupplementLoading(true)
    void Promise.allSettled([
      api.nenMembers.overview(),
      bookingApi.listRequests(selectedAccountId, 'all'),
      api.health.getHealth(selectedAccountId),
    ]).then(([photoResult, bookingResult, healthResult]) => {
      if (cancelled) return
      setPendingPhotos(photoResult.status === 'fulfilled' && photoResult.value.success ? photoResult.value.data.pendingPhotos : null)
      setBookings(bookingResult.status === 'fulfilled' ? bookingResult.value.requests : null)
      setHealthRisk(
        healthResult.status === 'fulfilled' && healthResult.value.success
          ? (healthResult.value.data.riskLevel as HealthRisk)
          : null,
      )
      setSupplementLoading(false)
    })
    return () => { cancelled = true }
  }, [selectedAccountId])

  const activeBookings = useMemo(
    () => bookings?.filter((booking) => !inactiveBookingStatuses.has(booking.status)) ?? [],
    [bookings],
  )
  const today = jstDay(new Date())
  const todayBookings = activeBookings.filter((booking) => jstDay(booking.starts_at) === today)
  const upcomingBookings = bookings ? activeUpcomingBookings(bookings) : []
  const pendingTotal = inboxSummary?.total ?? data?.inbox.unanswered ?? null
  const pendingDetail = inboxSummary
    ? `LINE ${inboxSummary.line}・メール ${inboxSummary.email}`
    : data
      ? `対応中 ${data.inbox.inProgress}`
      : '読み込み中'
  const visibleMain = preferences.main.filter((item) => item.visible)
  const visibleRight = preferences.right.filter((item) => item.visible)
  const shipmentVisible = visibleMain.some((item) => item.id === 'shipment')
  const pendingInboxVisible = visibleMain.some((item) => item.id === 'pending-inbox')

  const renderMainCard = (id: DashboardCardId): ReactNode => {
    if (id === 'pending-inbox') return <PendingInboxCard onSummaryChange={setInboxSummary} />
    if (id === 'friend-trend') return <FriendTrendCard data={data} loading={loading} />
    if (id === 'friend-add') return <FriendAddLinkCard />
    if (id === 'scenario-status') return <EmptyDataCard title="シナリオ配信状況" href="/scenarios" linkLabel="シナリオを見る" />
    if (id === 'uid-migration') return <EmptyDataCard title="UID移行状況" href="/health" linkLabel="移行状況を見る" />
    return null
  }

  const renderRightCard = (id: DashboardCardId): ReactNode => {
    if (id === 'upcoming') return <UpcomingCard bookings={bookings} loading={supplementLoading} />
    if (id === 'monthly-delivery') return data ? <MonthlyDeliveryCard delivery={data.delivery} /> : <EmptyDataCard title="今月の配信" href="/analytics" linkLabel="アクセス解析へ" />
    if (id === 'recent-results') return data ? <RecentResultsCard conversions={data.conversions} /> : <EmptyDataCard title="最近の成果" href="/conversions" linkLabel="成果を見る" />
    if (id === 'friend-status' && data) return <FriendStatusCard friends={data.friends} />
    if (id === 'booking-status') return <EmptyDataCard title="予約状況" href="/booking/bookings" linkLabel="予約を見る" />
    if (id === 'inflow-top') return <EmptyDataCard title="流入経路TOP3" href="/inflow-links" linkLabel="流入経路を見る" />
    if (id === 'funnel-alert') return <EmptyDataCard title="ファネル要注意" href="/analytics" linkLabel="分析を見る" />
    if (id === 'automation-failures') return <EmptyDataCard title="オートメーション失敗" href="/automations" linkLabel="実行状況を見る" />
    return null
  }

  const healthLabel = healthRisk === 'normal' ? '正常稼働' : healthRisk === 'warning' ? '要確認' : healthRisk === 'danger' ? '障害あり' : '状態確認中'
  const healthClass = healthRisk === 'danger' ? 'text-danger' : healthRisk === 'warning' ? 'text-warning' : healthRisk === 'normal' ? 'text-success' : 'text-ink-faint'

  return (
    <div>
      <header data-design="Head" className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-ink text-2xl font-bold sm:text-3xl">ダッシュボード</h1>
            <p className="text-ink-faint mt-1 text-sm">{selectedAccount ? `${selectedAccount.displayName || selectedAccount.name} の運用状況です。` : '今日の運用状況です。'}</p>
          </div>
          <button type="button" onClick={() => setEditorOpen(true)} className="border-hairline bg-canvas text-ink-secondary hover:bg-canvas-sunken rounded-control mt-0.5 inline-flex items-center gap-2 border px-3 py-2 text-xs font-medium">
            <EditIcon />ダッシュボード編集
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className={`${healthClass} inline-flex items-center gap-1.5 text-xs font-medium`}><span className="h-2 w-2 rounded-full bg-current" />{healthLabel}</span>
          <div className="flex gap-2">
            {PERIODS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setPeriod(item.key)}
                aria-pressed={period === item.key}
                className={`rounded-pill border px-4 py-2 text-xs font-medium transition-colors ${period === item.key ? 'border-accent bg-accent text-on-accent' : 'border-hairline bg-canvas text-ink-secondary hover:bg-canvas-sunken'}`}
              >{item.label}</button>
            ))}
          </div>
        </div>
      </header>

      {error && <div className="bg-danger-bg text-danger rounded-card mb-5 p-4 text-sm">{error}</div>}

      <section data-design="TodayTasks" className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-ink text-lg font-bold">今日やること</h2>
          <span className="text-ink-faint text-xs">優先度順</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TodayTaskCard title="対応が必要な受信" href="/chats" action="受信箱を開く" value={pendingTotal} detail={pendingDetail} status={inboxSummary?.oldestWaitMinutes != null ? `最長 ${inboxSummary.oldestWaitMinutes}分` : '確認待ち'} />
          <TodayTaskCard title="写真審査" href="/nen-members?tab=photos" action="審査する" value={pendingPhotos} detail={pendingPhotos === null ? '読み込み中' : `確認待ち ${pendingPhotos}件`} status="ポイント付与あり" />
          <TodayTaskCard title="今日の予約" href="/booking/bookings" action="予約を見る" value={bookings === null ? null : todayBookings.length} detail="変更・取消を含む予約一覧" status={upcomingBookings.length > 0 ? `次回 ${new Date(upcomingBookings[0].starts_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}` : '次回予定なし'} />
          <TodayTaskCard title="出荷予定" href="/ec-commerce" action="ECを見る" value={shipmentSummary?.today ?? null} detail="EC通知から算出" status={shipmentSummary ? `今日・明日 ${shipmentSummary.soon}件` : '確認中'} />
        </div>
      </section>

      <div data-design="Shipment" className={shipmentVisible ? 'mb-6' : 'hidden'} aria-hidden={!shipmentVisible}>
        <ShipmentPanel onSummaryChange={setShipmentSummary} />
      </div>
      {!pendingInboxVisible && (
        <div className="hidden" aria-hidden="true">
          <PendingInboxCard onSummaryChange={setInboxSummary} />
        </div>
      )}

      <div data-design="Body" className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          {visibleMain.filter((item) => item.id !== 'shipment').map((item) => <div key={item.id}>{renderMainCard(item.id)}</div>)}
        </div>
        <aside className="min-w-0 space-y-5">
          {visibleRight.map((item) => <div key={item.id}>{renderRightCard(item.id)}</div>)}
        </aside>
      </div>

      {data && <p className="text-ink-faint mt-5 text-xs">{new Date(data.generatedAt).toLocaleString('ja-JP')} 時点 ・ 最新データへ更新</p>}

      <DashboardEditor open={editorOpen} preferences={preferences} onCancel={() => setEditorOpen(false)} onApply={applyPreferences} />
    </div>
  )
}
