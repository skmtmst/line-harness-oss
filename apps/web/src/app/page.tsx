'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { EntryRoute, NotificationCenterData, NotificationCenterItem } from '@line-crm/shared'
import { api, bookingApi, type BookingRequest, type DashboardOverview } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { formatDurationMinutes, formatWaitRough } from '@/lib/format-duration'
import PendingInboxCard, { type PendingInboxSummary } from '@/components/support/pending-inbox-card'
import ShipmentPanel, { type ShipmentSummary } from '@/components/dashboard/shipment-panel'
import QrDialog from '@/components/dashboard/qr-dialog'
import FriendTrendTable from '@/components/dashboard/friend-trend-table'
import {
  FriendStatusCard,
  SupportMarkStatusCard,
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
import Card, { CardHeader } from '@/components/shared/card'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import NotificationPanel from '@/components/shared/notification-panel'
import {
  hasInboundSupportMark,
  summarizeTwoFactor,
  type TwoFactorSummary,
} from '@/components/dashboard/live-summary'
import {
  dashboardNotificationDestination,
  dashboardNotificationFilters,
  dashboardNotificationItems,
  isDashboardNotificationData,
  markDashboardNotificationRead,
  type DashboardNotificationFilter,
} from '@/components/dashboard/notification-summary'

/** 共通トップバーの通知ベル。件数と一覧は選択中アカウントの通知センターから読む。 */
function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

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
    <Card layout="vertical" padding="default" className="h-[132px] min-w-0">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-ink text-sm font-semibold">{title}</h3>
        <Link href={href} className="text-action shrink-0 text-xs font-medium hover:underline">{action}</Link>
      </div>
      <p className="text-ink mt-2 text-[28px] leading-none font-bold tabular-nums">
        {value === null ? '—' : value.toLocaleString('ja-JP')}<span className="ml-0.5 text-lg">件</span>
      </p>
      <div className="mt-auto flex items-end justify-between gap-3 pt-2">
        <span className="text-ink-faint truncate text-xs" title={detail}>{detail}</span>
        <span className="text-success shrink-0 text-xs font-medium">{status}</span>
      </div>
    </Card>
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
    <Card padding="roomy">
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
        <button type="button" onClick={onCopy} className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control shrink-0 px-5 py-2.5 text-xs font-medium">
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
    </Card>
  )
}

function FriendTrendCard({ data, loading }: { data: DashboardOverview | null; loading: boolean }) {
  return (
    <Card overflow="hidden">
      <CardHeader
        size="roomy"
        title="友だち数の推移"
        action={<Link href="/analytics" className="hover:underline">さらに詳しく →</Link>}
        actionTone="info"
      />
      <FriendTrendTable trend={data?.trend ?? []} loading={loading} />
    </Card>
  )
}

function EmptyDataCard({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <Card overflow="hidden">
      <CardHeader
        size="roomy"
        title={title}
        action={<Link href={href} className="hover:underline">{linkLabel} →</Link>}
        actionTone="info"
      />
      <p className="text-ink-faint px-5 py-8 text-center text-sm">このカードで表示できるデータはまだありません。</p>
    </Card>
  )
}

function UnavailableDataCard({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Card overflow="hidden">
      <CardHeader size="roomy" title={title} />
      <div className="px-5 py-7 text-center">
        <p className="text-ink-faint text-sm">データを取得できませんでした。</p>
        <button type="button" onClick={onRetry} className="text-action mt-2 text-xs font-medium hover:underline">もう一度読み込む</button>
      </div>
    </Card>
  )
}

function LiveDataCard({
  title, href, linkLabel, value, unit = '件', detail,
}: {
  title: string; href: string; linkLabel: string; value: number | null; unit?: string; detail: string
}) {
  return (
    <Card padding="roomy">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-ink text-sm font-semibold">{title}</h2>
        <Link href={href} className="text-action text-xs hover:underline">{linkLabel} →</Link>
      </div>
      <p className="text-ink mt-4 text-2xl font-bold tabular-nums">
        {value === null ? '—' : value.toLocaleString('ja-JP')}<span className="ml-1 text-sm font-medium">{unit}</span>
      </p>
      <p className="text-ink-faint mt-2 truncate text-xs" title={detail}>{detail}</p>
    </Card>
  )
}

function SendQuotaCard({ delivery }: { delivery: DashboardOverview['delivery'] | null }) {
  const used = delivery?.quotaUsed ?? null
  const limit = delivery?.quotaLimit ?? null
  const remaining = used !== null && limit !== null ? Math.max(0, limit - used) : null
  const remainingRate = remaining !== null && limit ? Math.max(0, Math.min(100, remaining / limit * 100)) : null
  return <Card padding="roomy" className="min-h-[128px]">
    <div className="flex items-start justify-between gap-3">
      <h2 className="text-ink text-base font-bold">今月の送信枠</h2>
      <span className="text-ink-faint text-xs">毎月1日リセット</span>
    </div>
    {/*
      設計（`vUXKb`）は数の前に「LINE公式」と置く。送信枠はLINE公式アカウント
      の枠で、メールには効かない。どちらの枠かが書いていないと、メールが
      止まったときにここを見てしまう。
    */}
    <p className="text-ink mt-3 flex items-baseline gap-2">
      <span className="text-ink-secondary text-xs font-medium">LINE公式</span>
      <span className="text-2xl font-bold tabular-nums">
        {/*
          **使用数か残りか読めない形にしない。**
          「197 / 200通」だけだと、197 が使ったぶんにも残りにも読める。
          この値は `limit - used` なので残り。言葉を付けて向きを固定する。
        */}
        {remaining === null || limit === null ? '—' : `残り ${remaining.toLocaleString('ja-JP')} / 上限 ${limit.toLocaleString('ja-JP')}通`}
      </span>
    </p>
    <div className="bg-hairline mt-3 h-1.5 overflow-hidden rounded-pill"><div className="bg-accent h-full rounded-pill" style={{ width: `${remainingRate ?? 0}%` }} /></div>
    <div className="mt-2 flex items-center justify-between gap-3 text-xs">
      <span className="text-success">{remainingRate === null ? '残りを確認中' : `残り ${remainingRate.toFixed(1)}%`}</span>
      <Link href="/accounts" className="text-action font-medium hover:underline">配信設定へ →</Link>
    </div>
  </Card>
}

function OperationalAlertsCard({ risk, healthIssues, oldestWaitMinutes, twoFactor }: { risk: HealthRisk; healthIssues: number | null; oldestWaitMinutes: number | null; twoFactor: { enabled: number; total: number } | null }) {
  const currentHealthIssue = risk === 'warning' || risk === 'danger'
  // 未対応の長さは受信カードで管理する。ここへ重ねて警告扱いすると、
  // 接続も自動処理も正常なのに赤い「1件」が出てしまう。
  const count = risk === null ? null : currentHealthIssue ? Math.max(1, healthIssues ?? 1) : 0
  return <Card padding="roomy" className="min-h-[128px]">
    <div className="flex items-start justify-between gap-3">
      <h2 className="text-ink text-base font-bold">運用アラート</h2>
      <span className={count === null ? 'text-ink-faint text-sm font-bold' : count > 0 ? 'text-danger text-sm font-bold' : 'text-success text-sm font-bold'}>{count === null ? '—' : `${count}件`}</span>
    </div>
    {/*
      設計（`vUXKb`）は「最も古い未対応」と「二段階認証」の2行。
      二段階認証は既存のログインユーザー一覧から、有効な人だけを数える。
      一覧を取得できなかったときだけ `—` にする。
    */}
    <div className="text-ink-secondary mt-3 space-y-2 text-xs">
      {/*
        **分のままにしない。** 9,110分前と書かれても、何日前か読み解けない。
        1時間未満は分、1日未満は時間、それ以上は日で言う。
      */}
      <p>・最も古い未対応：{oldestWaitMinutes === null ? '—' : formatWaitRough(oldestWaitMinutes)}</p>
      <p>・二段階認証：{twoFactor === null ? '—' : `${twoFactor.enabled} / ${twoFactor.total}人`}</p>
    </div>
    <Link href="/emergency" className="text-action mt-3 inline-block text-xs font-medium hover:underline">運用状態を見る →</Link>
  </Card>
}

function ConnectionStatusCard({ account, risk, activeFriends }: { account: ReturnType<typeof useAccount>['selectedAccount']; risk: HealthRisk; activeFriends: number | null }) {
  const webhook = account?.webhook?.status
  const webhookLabel = webhook === 'matched' ? '正常' : webhook === 'mismatched' || webhook === 'unconfigured' ? '要確認' : '確認中'
  return <Card padding="roomy" className="min-h-[128px]">
    <h2 className="text-ink text-base font-bold">接続状態</h2>
    <dl className="mt-3 space-y-2 text-xs">
      <div className="flex justify-between gap-3"><dt className="text-ink-faint">LINE Webhook</dt><dd className={webhookLabel === '正常' ? 'text-success font-semibold' : webhookLabel === '要確認' ? 'text-danger font-semibold' : 'text-ink-faint'}>{webhookLabel}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-ink-faint">自動処理</dt><dd className={risk === 'normal' ? 'text-success font-semibold' : risk ? 'text-danger font-semibold' : 'text-ink-faint'}>{risk === 'normal' ? '稼働中' : risk ? '要確認' : '確認中'}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-ink-faint">有効友だち</dt><dd className="text-success font-semibold">{activeFriends === null ? '—' : `${activeFriends.toLocaleString('ja-JP')}人`}</dd></div>
    </dl>
  </Card>
}

export default function DashboardPage() {
  const router = useRouter()
  const { selectedAccountId, selectedAccount, loading: accountLoading } = useAccount()
  const [period, setPeriod] = useState<PeriodKey>('today')
  const [data, setData] = useState<DashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [preferences, setPreferences] = useState<DashboardPreferences>(defaultDashboardPreferences)
  const [preferenceVersion, setPreferenceVersion] = useState(0)
  const [inboxSummary, setInboxSummary] = useState<PendingInboxSummary | null>(null)
  const [shipmentSummary, setShipmentSummary] = useState<ShipmentSummary | null>(null)
  const [pendingPhotos, setPendingPhotos] = useState<number | null>(null)
  const [bookings, setBookings] = useState<BookingRequest[] | null>(null)
  const [supplementLoading, setSupplementLoading] = useState(true)
  const [healthRisk, setHealthRisk] = useState<HealthRisk>(null)
  const [healthIssueCount, setHealthIssueCount] = useState<number | null>(null)
  const [twoFactorSummary, setTwoFactorSummary] = useState<TwoFactorSummary | null>(null)
  const [supportMarkAutoOnInbound, setSupportMarkAutoOnInbound] = useState<boolean | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationFilter, setNotificationFilter] = useState<DashboardNotificationFilter>('all')
  const [notificationData, setNotificationData] = useState<NotificationCenterData | null>(null)
  const [notificationAccountId, setNotificationAccountId] = useState<string | null>(null)
  const [notificationLoading, setNotificationLoading] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const loadRequestId = useRef(0)
  const notificationRequestId = useRef(0)
  const selectedAccountIdRef = useRef(selectedAccountId)
  const notificationFilterRef = useRef(notificationFilter)
  selectedAccountIdRef.current = selectedAccountId
  notificationFilterRef.current = notificationFilter
  const visibleMain = preferences.main.filter((item) => item.visible)
  const visibleRight = preferences.right.filter((item) => item.visible)
  const visibleToday = preferences.today.filter((item) => item.visible)
  const shipmentVisible = visibleMain.some((item) => item.id === 'shipment')
  const needsPhotos = visibleToday.some((item) => item.id === 'today-photo-review')
  const needsBookings = visibleToday.some((item) => item.id === 'today-bookings')
    || visibleRight.some((item) => item.id === 'upcoming')
  const needsHealth = visibleRight.some((item) => item.id === 'operational-alerts' || item.id === 'connection-status')
  const needsTwoFactor = visibleRight.some((item) => item.id === 'operational-alerts')
  const needsSupportMarks = visibleRight.some((item) => item.id === 'support-mark-status')

  useEffect(() => {
    if (!selectedAccountId) {
      setPreferences(defaultDashboardPreferences())
      setPreferenceVersion(0)
      return
    }
    let cancelled = false
    const key = dashboardStorageKey(selectedAccountId)
    try {
      const raw = window.localStorage.getItem(key)
      const cached = raw ? JSON.parse(raw) as { cards?: unknown; version?: unknown } : null
      setPreferences(normalizeDashboardPreferences(cached?.cards ?? cached))
      setPreferenceVersion(Number.isInteger(cached?.version) ? Number(cached?.version) : 0)
    } catch {
      setPreferences(defaultDashboardPreferences())
    }
    void api.dashboard.preferences.get(selectedAccountId)
      .then((response) => {
        if (cancelled || !response.success) return
        const next = normalizeDashboardPreferences(response.data.cards)
        setPreferences(next)
        setPreferenceVersion(response.data.version)
        try { window.localStorage.setItem(key, JSON.stringify({ version: response.data.version, cards: next })) } catch { /* cache unavailable */ }
      })
      .catch(() => {
        // The last server-confirmed cache remains visible; a later save still checks its version.
      })
    return () => { cancelled = true }
  }, [selectedAccountId])

  const applyPreferences = async (next: DashboardPreferences) => {
    if (!selectedAccountId) {
      setError('LINEアカウントを選択してください')
      return
    }
    const normalized = normalizeDashboardPreferences(next)
    try {
      const response = await api.dashboard.preferences.save(selectedAccountId, {
        version: preferenceVersion,
        cards: normalized,
      })
      if (!response.success) throw new Error(response.error)
      setPreferences(normalized)
      setPreferenceVersion(response.data.version)
      setError('')
      try { window.localStorage.setItem(dashboardStorageKey(selectedAccountId), JSON.stringify({ version: response.data.version, cards: normalized })) } catch { /* cache unavailable */ }
      setEditorOpen(false)
    } catch (caught) {
      setError(caught instanceof Error && 'status' in caught && caught.status === 409
        ? '別の画面で配置が更新されました。再読み込みしてください'
        : 'ダッシュボードの配置を保存できませんでした')
    }
  }

  const resetPreferences = async () => {
    if (!selectedAccountId) return
    try {
      await api.dashboard.preferences.reset(selectedAccountId)
      const response = await api.dashboard.preferences.get(selectedAccountId)
      const next = response.success ? normalizeDashboardPreferences(response.data.cards) : defaultDashboardPreferences()
      setPreferences(next)
      setPreferenceVersion(0)
      setError('')
      try { window.localStorage.setItem(dashboardStorageKey(selectedAccountId), JSON.stringify({ version: 0, cards: next })) } catch { /* cache unavailable */ }
      setEditorOpen(false)
    } catch {
      setError('ダッシュボードの配置を初期状態へ戻せませんでした')
    }
  }

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current
    if (accountLoading) return
    if (!selectedAccountId) {
      setData(null)
      setLoading(false)
      setError('LINEアカウントを選択してください')
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await api.dashboard.overview({ period, accountId: selectedAccountId })
      if (requestId !== loadRequestId.current) return
      if (response.success) setData(response.data)
      else setError(response.error)
    } catch {
      if (requestId === loadRequestId.current) setError('データの読み込みに失敗しました')
    } finally {
      if (requestId === loadRequestId.current) setLoading(false)
    }
  }, [accountLoading, period, selectedAccountId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    notificationRequestId.current += 1
    setNotificationsOpen(false)
    setNotificationData(null)
    setNotificationAccountId(null)
    setNotificationError('')
  }, [selectedAccountId])

  const loadNotificationCenter = useCallback(async (limit = 20) => {
    const requestId = ++notificationRequestId.current
    if (!selectedAccountId) {
      setNotificationData(null)
      setNotificationAccountId(null)
      setNotificationError('')
      setNotificationLoading(false)
      return
    }
    setNotificationAccountId(selectedAccountId)
    setNotificationLoading(true)
    setNotificationError('')
    try {
      const response = await api.notifications.center.list(selectedAccountId, {
        category: notificationFilter,
        limit,
      })
      if (requestId !== notificationRequestId.current) return
      if (!response.success) throw new Error(response.error)
      if (!isDashboardNotificationData(response.data)) throw new Error('invalid notification center response')
      setNotificationData(response.data)
    } catch {
      if (requestId !== notificationRequestId.current) return
      setNotificationData(null)
      setNotificationError('通知を読み込めませんでした。もう一度お試しください。')
    } finally {
      if (requestId === notificationRequestId.current) setNotificationLoading(false)
    }
  }, [notificationFilter, selectedAccountId])

  useEffect(() => { void loadNotificationCenter() }, [loadNotificationCenter])

  const openNotification = async (item: NotificationCenterItem) => {
    if (!selectedAccountId) return
    const accountId = selectedAccountId
    if (!item.isRead) {
      try {
        const response = await api.notifications.center.markRead(item.id, accountId)
        if (selectedAccountIdRef.current !== accountId) return
        if (!response.success) throw new Error(response.error)
        setNotificationData((current) => current ? markDashboardNotificationRead(current, item.id) : current)
      } catch {
        if (selectedAccountIdRef.current !== accountId) return
        setNotificationError('通知を既読にできませんでした。')
        return
      }
    }
    const destination = dashboardNotificationDestination(item)
    if (destination) {
      setNotificationsOpen(false)
      router.push(destination)
    }
  }

  const markAllNotificationsRead = async () => {
    const currentNotificationData = notificationAccountId === selectedAccountId ? notificationData : null
    if (!selectedAccountId || !currentNotificationData || currentNotificationData.unreadCount === 0) return
    const accountId = selectedAccountId
    const filter = notificationFilter
    try {
      const response = await api.notifications.center.markAllRead(accountId, filter)
      if (selectedAccountIdRef.current !== accountId || notificationFilterRef.current !== filter) return
      if (!response.success) throw new Error(response.error)
      // updated は新規既読数ではなく対象総数。既読済みを
      // 重ねて引かないよう、未読数はサーバーから取り直す。
      await loadNotificationCenter()
    } catch {
      if (selectedAccountIdRef.current !== accountId || notificationFilterRef.current !== filter) return
      setNotificationError('通知をまとめて既読にできませんでした。')
    }
  }

  useEffect(() => {
    if (!selectedAccountId) {
      setBookings(null)
      setPendingPhotos(null)
      setHealthRisk(null)
      setHealthIssueCount(null)
      setTwoFactorSummary(null)
      setSupportMarkAutoOnInbound(null)
      setSupplementLoading(false)
      return
    }
    let cancelled = false
    setSupplementLoading(true)
    void Promise.allSettled([
      needsPhotos ? api.nenMembers.overview() : Promise.resolve(null),
      needsBookings ? bookingApi.listRequests(selectedAccountId, 'all') : Promise.resolve(null),
      needsHealth ? api.health.getHealth(selectedAccountId) : Promise.resolve(null),
      needsTwoFactor ? api.staff.list() : Promise.resolve(null),
      needsSupportMarks ? api.supportMarks.list(selectedAccountId) : Promise.resolve(null),
    ]).then(([photoResult, bookingResult, healthResult, staffResult, supportMarkResult]) => {
      if (cancelled) return
      setPendingPhotos(photoResult.status === 'fulfilled' && photoResult.value?.success ? photoResult.value.data.pendingPhotos : null)
      setBookings(bookingResult.status === 'fulfilled' && bookingResult.value ? bookingResult.value.requests : null)
      setHealthRisk(
        healthResult.status === 'fulfilled' && healthResult.value?.success
          ? (healthResult.value.data.riskLevel as HealthRisk)
          : null,
      )
      setHealthIssueCount(
        healthResult.status === 'fulfilled' && healthResult.value?.success
          ? healthResult.value.data.logs.filter((log) => log.riskLevel === 'warning' || log.riskLevel === 'danger').length
          : null,
      )
      setTwoFactorSummary(
        staffResult.status === 'fulfilled' && staffResult.value?.success
          ? summarizeTwoFactor(staffResult.value.data)
          : null,
      )
      setSupportMarkAutoOnInbound(
        supportMarkResult.status === 'fulfilled' && supportMarkResult.value?.success
          ? hasInboundSupportMark(supportMarkResult.value.data)
          : null,
      )
      setSupplementLoading(false)
    })
    return () => { cancelled = true }
  }, [needsBookings, needsHealth, needsPhotos, needsSupportMarks, needsTwoFactor, selectedAccountId])

  const activeBookings = useMemo(
    () => bookings?.filter((booking) => !inactiveBookingStatuses.has(booking.status)) ?? [],
    [bookings],
  )
  const today = jstDay(new Date())
  const todayBookings = activeBookings.filter((booking) => jstDay(booking.starts_at) === today)
  const upcomingBookings = bookings ? activeUpcomingBookings(bookings) : []
  const sectionAvailable = (section: keyof NonNullable<DashboardOverview['sections']>) =>
    data?.sections?.[section]?.status !== 'unavailable'
  const pendingTotal = inboxSummary?.total ?? (sectionAvailable('inbox') ? data?.inbox.unanswered : null) ?? null
  const pendingDetail = inboxSummary
    ? `LINE ${inboxSummary.line}・メール ${inboxSummary.email}`
    : data && sectionAvailable('inbox')
      ? `対応中 ${data.inbox.inProgress}`
      : data ? '取得できません' : '読み込み中'
  const renderMainCard = (id: DashboardCardId): ReactNode => {
    if (id === 'pending-inbox') return <PendingInboxCard onSummaryChange={setInboxSummary} />
    if (id === 'friend-trend') return data && !sectionAvailable('trend')
      ? <UnavailableDataCard title="友だち数の推移" onRetry={() => void load()} />
      : <FriendTrendCard data={data} loading={loading} />
    if (id === 'friend-add') return <FriendAddLinkCard />
    if (id === 'scenario-status') {
      const scenarios = sectionAvailable('operations') ? data?.operations?.scenarios : undefined
      return <LiveDataCard title="シナリオ配信状況" href="/scenarios" linkLabel="シナリオを見る" value={scenarios?.active ?? null} detail={scenarios ? `一時停止 ${scenarios.paused}件` : data ? '取得できません' : '読み込み中'} />
    }
    if (id === 'uid-migration') {
      const migrations = sectionAvailable('operations') ? data?.operations?.migrations : undefined
      return <LiveDataCard title="UID移行状況" href="/health" linkLabel="移行状況を見る" value={migrations?.active ?? null} detail={migrations ? `完了 ${migrations.completed}件` : data ? '取得できません' : '読み込み中'} />
    }
    return null
  }

  const renderTodayCard = (id: DashboardCardId): ReactNode => {
    if (id === 'today-inbox') return <TodayTaskCard title="対応が必要な受信" href="/chats" action="受信箱を開く" value={pendingTotal} detail={pendingDetail} status={inboxSummary?.oldestWaitMinutes != null ? `最長 ${formatWaitRough(inboxSummary.oldestWaitMinutes)}` : '確認待ち'} />
    if (id === 'today-photo-review') return <TodayTaskCard title="写真審査" href="/nen-members?tab=photos" action="審査する" value={pendingPhotos} detail={pendingPhotos === null ? '読み込み中' : `確認待ち ${pendingPhotos}件`} status="ポイント付与あり" />
    if (id === 'today-bookings') return <TodayTaskCard title="今日の予約" href="/booking/bookings" action="予約を見る" value={bookings === null ? null : todayBookings.length} detail="変更・取消を含む予約一覧" status={upcomingBookings.length > 0 ? `次回 ${new Date(upcomingBookings[0].starts_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}` : '次回予定なし'} />
    if (id === 'today-shipments') return <TodayTaskCard title="出荷予定" href="/ec-commerce" action="ECを見る" value={shipmentSummary?.today ?? null} detail="EC通知から算出" status={shipmentSummary ? `今日・明日 ${shipmentSummary.soon}件` : '確認中'} />
    return null
  }

  const renderRightCard = (id: DashboardCardId): ReactNode => {
    if (id === 'send-quota') return <SendQuotaCard delivery={sectionAvailable('quota') ? data?.delivery ?? null : null} />
    if (id === 'operational-alerts') return <OperationalAlertsCard risk={healthRisk} healthIssues={healthIssueCount} oldestWaitMinutes={inboxSummary?.oldestWaitMinutes ?? (sectionAvailable('inbox') ? data?.inbox.oldestUnansweredMinutes : null) ?? null} twoFactor={twoFactorSummary} />
    if (id === 'connection-status') return <ConnectionStatusCard account={selectedAccount} risk={healthRisk} activeFriends={sectionAvailable('friends') ? data?.friends.active ?? null : null} />
    if (id === 'upcoming') return <UpcomingCard bookings={bookings} loading={supplementLoading} />
    if (id === 'monthly-delivery') return data && !sectionAvailable('delivery')
      ? <UnavailableDataCard title="今月の配信" onRetry={() => void load()} />
      : data ? <MonthlyDeliveryCard delivery={data.delivery} /> : <EmptyDataCard title="今月の配信" href="/analytics" linkLabel="アクセス解析へ" />
    if (id === 'recent-results') return data && !sectionAvailable('conversions')
      ? <UnavailableDataCard title="最近の成果" onRetry={() => void load()} />
      : data ? <RecentResultsCard conversions={data.conversions} /> : <EmptyDataCard title="最近の成果" href="/conversions" linkLabel="成果を見る" />
    if (id === 'support-mark-status') return <SupportMarkStatusCard inbox={sectionAvailable('inbox') ? data?.inbox ?? null : null} autoOnInbound={supportMarkAutoOnInbound} />
    if (id === 'friend-status') return data && !sectionAvailable('friends')
      ? <UnavailableDataCard title="友だちの状態" onRetry={() => void load()} />
      : data ? <FriendStatusCard friends={data.friends} /> : <EmptyDataCard title="友だちの状態" href="/friends" linkLabel="友だちを見る" />
    if (id === 'booking-status') {
      const bookingsStatus = sectionAvailable('operations') ? data?.operations?.bookings : undefined
      return <LiveDataCard title="予約状況" href="/booking/bookings" linkLabel="予約を見る" value={bookingsStatus?.upcoming ?? null} detail={bookingsStatus ? `承認待ち ${bookingsStatus.pending}件` : data ? '取得できません' : '読み込み中'} />
    }
    if (id === 'inflow-top') {
      const inflowTop = sectionAvailable('operations') ? data?.operations?.inflowTop : undefined
      return <LiveDataCard title="流入経路TOP3" href="/inflow-links" linkLabel="流入経路を見る" value={inflowTop?.[0]?.count ?? (inflowTop ? 0 : null)} detail={inflowTop ? inflowTop.map((item) => `${item.name} ${item.count}`).join('、') || '期間内の追加なし' : data ? '取得できません' : '読み込み中'} />
    }
    if (id === 'funnel-alert') return <LiveDataCard title="ファネル要注意" href="/analytics" linkLabel="分析を見る" value={sectionAvailable('operations') ? data?.operations?.funnelAlerts ?? null : null} detail="3人以上追加・成果0件の経路" />
    if (id === 'automation-failures') return <LiveDataCard title="オートメーション失敗" href="/automations" linkLabel="実行状況を見る" value={sectionAvailable('operations') ? data?.operations?.automationFailures ?? null : null} detail="期間内の失敗・一部失敗" />
    return null
  }

  const currentNotificationData = notificationAccountId === selectedAccountId ? notificationData : null
  const notificationItems = dashboardNotificationItems(
    currentNotificationData?.items ?? [],
    (item) => { void openNotification(item) },
  )
  const notificationFilters = dashboardNotificationFilters(currentNotificationData)
  const unreadNotificationCount = currentNotificationData?.unreadCount ?? 0
  const healthLabel = healthRisk === 'normal' ? '正常稼働' : healthRisk === 'warning' ? '要確認' : healthRisk === 'danger' ? '障害あり' : '状態確認中'
  const healthClass = healthRisk === 'danger' ? 'text-danger' : healthRisk === 'warning' ? 'text-warning' : healthRisk === 'normal' ? 'text-success' : 'text-ink-faint'

  return (
    <div>
      {/* V6 `vUXKb/vwcM6`: 画面名は共通トップバーだけ。本文には操作だけを置く。 */}
      <div data-design="Head" className="mb-4.5 flex min-h-10 flex-wrap items-center justify-between gap-3">
        <Button onClick={() => setEditorOpen(true)}>
          <EditIcon />ダッシュボード編集
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
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
          {/* 選択中のLINEアカウントの通知だけを表示し、未取得を0件に見せない。 */}
          <div className="relative">
            <IconButton
              aria-label={unreadNotificationCount > 0 ? `通知、未読${unreadNotificationCount}件` : '通知'}
              aria-expanded={notificationsOpen}
              onClick={() => {
                if (!notificationsOpen) void loadNotificationCenter()
                setNotificationsOpen((current) => !current)
              }}
            >
              <BellIcon />
            </IconButton>
            {unreadNotificationCount > 0 ? (
              <span
                aria-hidden="true"
                className="bg-danger text-on-accent pointer-events-none absolute -top-1.5 -right-1.5 min-w-5 rounded-full px-1 text-center text-xs leading-5 font-bold tabular-nums"
              >{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>
            ) : null}
            <NotificationPanel
              open={notificationsOpen}
              items={notificationItems}
              filters={notificationFilters}
              activeFilter={notificationFilter}
              unreadCount={unreadNotificationCount}
              loading={notificationAccountId === selectedAccountId && notificationLoading}
              error={notificationAccountId === selectedAccountId && notificationError ? notificationError : undefined}
              onFilterChange={(id) => {
                if (id === 'all' || id === 'error' || id === 'update') setNotificationFilter(id)
              }}
              onMarkAllRead={() => { void markAllNotificationsRead() }}
              onClose={() => setNotificationsOpen(false)}
              onViewAll={() => {
                void loadNotificationCenter(100)
              }}
              onOpenSettings={() => {
                setNotificationsOpen(false)
                router.push('/line-notifications')
              }}
            />
          </div>
        </div>
      </div>

      {error && <div className="bg-danger-bg text-danger rounded-card mb-5 p-4 text-sm">{error}</div>}
      {data?.partialFailures?.length ? (
        <div className="bg-warning-bg text-warning rounded-card mb-5 p-4 text-sm" role="status">
          一部のデータを取得できませんでした（{data.partialFailures.join('、')}）。0件としては表示していません。
        </div>
      ) : null}

      {visibleToday.length > 0 ? <section data-design="TodayTasks" className="mb-6">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h2 className="text-ink text-lg font-bold">今日やること</h2>
          <span className="text-ink-faint text-xs">優先度が高い順</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visibleToday.map((item) => <div key={item.id}>{renderTodayCard(item.id)}</div>)}
        </div>
      </section> : null}

      <div data-design="Shipment" className={shipmentVisible ? 'mb-6' : 'hidden'} aria-hidden={!shipmentVisible}>
        <ShipmentPanel onSummaryChange={setShipmentSummary} />
      </div>

      <div data-design="Middle" className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)]">
        <div data-design="Body" className="min-w-0 space-y-[18px]">
          {visibleMain.filter((item) => item.id !== 'shipment').map((item) => <div key={item.id}>{renderMainCard(item.id)}</div>)}
        </div>
        <aside className="min-w-0 space-y-3.5">
          {visibleRight.map((item) => <div key={item.id}>{renderRightCard(item.id)}</div>)}
        </aside>
      </div>

      {data && <p className="text-ink-faint mt-5 text-xs">{new Date(data.generatedAt).toLocaleString('ja-JP')} 時点 ・ 最新データへ更新</p>}

      <DashboardEditor open={editorOpen} preferences={preferences} onCancel={() => setEditorOpen(false)} onApply={applyPreferences} onReset={resetPreferences} />
    </div>
  )
}
