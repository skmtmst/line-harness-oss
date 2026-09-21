'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { EntryRoute, NotificationCenterData, NotificationCenterItem } from '@line-crm/shared'
import { ApiError, api, bookingApi, type BookingRequest, type DashboardOverview } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { formatDurationMinutes, formatWaitRough } from '@/lib/format-duration'
import PendingInboxCard, { type PendingInboxSummary } from '@/components/support/pending-inbox-card'
import ShipmentPanel, { type ShipmentSummary } from '@/components/dashboard/shipment-panel'
import QrDialog from '@/components/dashboard/qr-dialog'
import FriendTrendTable from '@/components/dashboard/friend-trend-table'
import DashboardFreshness from '@/components/dashboard/freshness'
import {
  FriendStatusCard,
  SupportMarkStatusCard,
  MonthlyDeliveryCard,
  RecentResultsCard,
  UpcomingCard,
  activeUpcomingBookings,
  inactiveBookingStatuses,
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
import KpiCollapse from '@/components/ui/kpi-collapse'
import SelectField from '@/components/shared/select-field'
import { STATE_TEXT } from '@/components/shared/not-connected'
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

function dashboardStorageKey(accountId: string | null): string {
  return `lh_dashboard_v4:${accountId ?? 'default'}`
}

function jstDay(iso: string | number | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso)
  /*
    壊れた日付は空にする。そのまま toISOString() すると RangeError で
    画面全体が落ち、今日の数にも入らない。空は今日と一致しない。
  */
  if (Number.isNaN(date.getTime())) return ''
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
  statusTone = 'success',
}: {
  title: string
  href: string
  action: string
  value: number | null
  detail: string
  status: string
  /*
   * 「ポイント付与あり」のような業務状態の緑は、件数を正常に取得できた
   * ときだけ使う。権限不足・取得失敗・読込中に緑を出すと、できる状態と
   * 見間違うため（A01-01）。
   */
  statusTone?: 'success' | 'muted'
}) {
  return (
    <Card layout="vertical" padding="default" className="h-[116px] min-w-0">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-ink text-sm font-semibold">{title}</h3>
        <Link href={href} className="text-action shrink-0 text-xs font-medium hover:underline">{action}</Link>
      </div>
      <p className="text-ink mt-2 text-[28px] leading-none font-bold tabular-nums">
        {value === null ? '—' : value.toLocaleString('ja-JP')}<span className="ml-0.5 text-lg">件</span>
      </p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <span className="text-ink-faint truncate text-xs" title={detail}>{detail}</span>
        <span className={`${statusTone === 'muted' ? 'text-ink-faint' : 'text-success'} shrink-0 text-xs font-medium`}>{status}</span>
      </div>
    </Card>
  )
}

/** 友だち追加リンク。共有URLは計測とUUID紐づけができる正規の流入口を使う。 */
function FriendAddLinkCard({
  officialProfileUrl,
  visualQa,
}: {
  officialProfileUrl: string | null | undefined
  visualQa?: DashboardOverview['visualQa']
}) {
  const { selectedAccount, selectedAccountId } = useAccount()
  const router = useRouter()
  const params = useSearchParams()
  const [copied, setCopied] = useState(false)
  /* null は取得中。アカウントを切り替えた直後は前のアカウントの経路を残さない。 */
  const [routes, setRoutes] = useState<EntryRoute[] | null>(null)
  const [routeId, setRouteId] = useState('')
  /*
   * QRの表示状態はURLに残す（`?qr=base` または `?qr=<routeId>`）。
   * 印刷前に再読込しても同じQRが開いたままにするため。
   * 見え方はローカル状態が持ち、URLは初期値と書き戻し先にする。
   */
  const qrParam = params.get('qr')
  const [showQr, setShowQr] = useState(() => qrParam !== null)
  const [qrRouteId, setQrRouteId] = useState(() => (qrParam !== null && qrParam !== 'base' ? qrParam : ''))
  useEffect(() => {
    setShowQr(qrParam !== null)
    setQrRouteId(qrParam !== null && qrParam !== 'base' ? qrParam : '')
  }, [qrParam])
  const writeQr = (value: string | null) => {
    setShowQr(value !== null)
    setQrRouteId(value !== null && value !== 'base' ? value : '')
    const next = new URLSearchParams(params.toString())
    if (value === null) next.delete('qr')
    else next.set('qr', value)
    const text = next.toString()
    router.replace(text ? `/?${text}` : '/')
  }

  /*
   * 経路一覧は選択中のアカウントのものだけを取る（DASH-09）。
   * アカウントを指定しない一覧は権限内の他アカウントの経路を含み得るため、
   * 切替後に前のアカウントの /r/... を選んだままにしない。
   */
  useEffect(() => {
    let cancelled = false
    setRoutes(null)
    setRouteId('')
    if (!selectedAccountId) {
      return () => { cancelled = true }
    }
    void api.entryRoutes.list(selectedAccountId)
      .then((res) => {
        if (cancelled) return
        setRoutes(res.success ? res.data.filter((route) => route.isActive) : [])
      })
      .catch(() => {
        // 経路一覧だけが取れなくても、基本の追加URLは利用できる。
        if (!cancelled) setRoutes([])
      })
    return () => { cancelled = true }
  }, [selectedAccountId])

  const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  const baseLink = visualQa?.friendAddUrl ?? (selectedAccount
    ? `${base}/auth/line?account=${encodeURIComponent(selectedAccount.channelId)}`
    : `${base}/auth/line`)
  const route = (routes ?? []).find((entry) => entry.id === routeId)
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
          <label className="flex min-w-[220px] items-center gap-2">
            <span className="text-ink-faint shrink-0 text-[10px] font-medium">発行中</span>
            <SelectField
              value={routeId}
              onChange={(event) => setRouteId(event.target.value)}
              aria-label="発行中の追加URL"
              className="text-ink min-w-0 flex-1 bg-transparent text-xs font-medium focus:outline-none"
              options={[
                { value: '', label: '基本の追加URL' },
                ...(routes ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
              ]}
            />
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
        <button type="button" onClick={() => writeQr(routeId || 'base')} className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control shrink-0 border px-5 py-2.5 text-xs font-medium">QRを表示</button>
      </div>

      <QrDialog
        open={showQr}
        onClose={() => writeQr(null)}
        accountName={selectedAccount?.displayName ?? '然-NEN- 公式'}
        officialProfileUrl={visualQa?.officialProfileUrl ?? officialProfileUrl}
        accountBasicId={selectedAccount?.basicId ?? null}
        baseLink={baseLink}
        initialRouteId={showQr ? qrRouteId : routeId}
        onRouteIdChange={(id) => writeQr(id || 'base')}
        routes={routes ?? []}
        routesPending={routes === null}
        visualReferenceQr={visualQa?.referenceQr ?? false}
      />
    </Card>
  )
}

function FriendTrendCard({ data, loading }: { data: DashboardOverview | null; loading: boolean }) {
  const metric = data?.metrics?.friendTrend
  const trend = metric === undefined ? data?.trend ?? [] : metric.value ?? []
  const section = data?.sections?.trend
  return (
    <Card overflow="hidden">
      <CardHeader
        size="roomy"
        title="友だち数の推移"
        action={<Link href="/analytics" className="hover:underline">さらに詳しく →</Link>}
        actionTone="info"
      />
      <FriendTrendTable trend={trend} loading={loading} />
      {section ? (
        <div className="border-hairline flex justify-end border-t px-5 py-2.5">
          <DashboardFreshness freshness={section.freshness} asOf={section.asOf} reason={section.reason} />
        </div>
      ) : null}
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

function UnavailableDataCard({ title, onRetry, section }: {
  title: string
  onRetry: () => void
  section?: NonNullable<DashboardOverview['sections']>[keyof NonNullable<DashboardOverview['sections']>]
}) {
  const partial = section?.status === 'partial'
  return (
    <Card overflow="hidden">
      <CardHeader size="roomy" title={title} />
      <div className="px-5 py-7 text-center">
        <p className="text-ink-faint text-sm">{partial ? `一部のデータを${STATE_TEXT.error}` : `データを${STATE_TEXT.error}`}</p>
        <div className="mt-1 flex justify-center">
          <DashboardFreshness freshness={section?.freshness} asOf={section?.asOf} reason={section?.reason} />
        </div>
        <button type="button" onClick={onRetry} className="text-action mt-2 text-xs font-medium hover:underline">もう一度読み込む</button>
      </div>
    </Card>
  )
}

function LiveDataCard({
  title, href, linkLabel, value, unit = '件', detail, freshness,
}: {
  title: string; href: string; linkLabel: string; value: number | null; unit?: string; detail: string
  freshness?: NonNullable<DashboardOverview['sections']>[keyof NonNullable<DashboardOverview['sections']>]
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
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-ink-faint min-w-0 truncate text-xs" title={detail}>{detail}</p>
        <DashboardFreshness freshness={freshness?.freshness} asOf={freshness?.asOf} reason={freshness?.reason} />
      </div>
    </Card>
  )
}

function SendQuotaCard({
  delivery,
  metric,
}: {
  delivery: DashboardOverview['delivery'] | null
  metric: NonNullable<DashboardOverview['metrics']>['monthlyQuota'] | undefined
}) {
  const used = metric === undefined ? delivery?.quotaUsed ?? null : metric.value?.used ?? null
  const limit = metric === undefined ? delivery?.quotaLimit ?? null : metric.value?.limit ?? null
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
    <p className="text-ink mt-3 flex items-baseline gap-2 whitespace-nowrap">
      <span className="text-ink-secondary text-sm font-semibold">LINE公式</span>
      <span className="text-metric leading-none font-bold tabular-nums">
        {/*
          **使用数か残りか読めない形にしない。**
          「197 / 200通」だけだと、197 が使ったぶんにも残りにも読める。
          この値は `limit - used` なので残り。言葉を付けて向きを固定する。
        */}
        <span className="text-base leading-tight">
          {remaining === null || limit === null ? '—' : `残り ${remaining.toLocaleString('ja-JP')} / 上限 ${limit.toLocaleString('ja-JP')}通`}
        </span>
      </span>
    </p>
    <div className="bg-hairline mt-3 h-1.5 overflow-hidden rounded-pill"><div className="bg-accent h-full rounded-pill" style={{ width: `${remainingRate ?? 0}%` }} /></div>
    <div className="mt-2 flex items-center justify-between gap-3 text-xs">
      <span className="text-success">{remainingRate === null ? '残りを確認中' : `残り ${remainingRate.toFixed(1)}%`}</span>
      <Link href="/accounts" className="text-action font-medium hover:underline">配信設定へ →</Link>
    </div>
  </Card>
}

function OperationalAlertsCard({ risk, healthIssues, oldestWaitMinutes, twoFactor, referenceCount }: { risk: HealthRisk; healthIssues: number | null; oldestWaitMinutes: number | null; twoFactor: { enabled: number; total: number } | null; referenceCount?: number }) {
  const currentHealthIssue = risk === 'warning' || risk === 'danger'
  // 未対応の長さは受信カードで管理する。ここへ重ねて警告扱いすると、
  // 接続も自動処理も正常なのに赤い「1件」が出てしまう。
  const count = referenceCount ?? (risk === null ? null : currentHealthIssue ? Math.max(1, healthIssues ?? 1) : 0)
  return <Card padding="roomy" className="min-h-[128px]">
    <div className="flex items-start justify-between gap-3">
      <h2 className="text-ink text-base font-bold">運用アラート</h2>
      {/*
        #631: 件数の母集団は変えない（health issue だけを数える）。
        「最も古い未対応」と別のものを数えていることが、件数の脇の文言
        だけで分かるようにする。0件のときに「未対応が長引いている」の
        隣で緑の「0件」が出ても、別の指標だと読めるようにするのが狙い。
      */}
      <span className={count === null ? 'text-ink-faint text-sm font-bold' : count > 0 ? 'text-danger text-sm font-bold' : 'text-success text-sm font-bold'}>{count === null ? '—' : `接続・自動処理 ${count}件`}</span>
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
      <p>・組織全体の二段階認証：{twoFactor === null ? '—' : `${twoFactor.enabled} / ${twoFactor.total}人`}</p>
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

function DashboardPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId, selectedAccount, loading: accountLoading } = useAccount()
  /*
   * 期間・編集中・QRの表示状態はURLに残す（`?period=&edit=1&qr=`）。
   * 再読込や共有リンクで同じ画面が開くようにするため。
   *
   * 見え方そのものはローカル状態が持ち、URLは初回の初期値と
   * 「あとから変わった値」の写し先。replace が返るまでの間にも
   * 操作が効くように、押した時点でローカルへも書く。
   */
  const periodParam = params.get('period')
  const editParam = params.get('edit')
  const [period, setPeriodState] = useState<PeriodKey>(() => (
    PERIODS.some((item) => item.key === periodParam) ? (periodParam as PeriodKey) : 'today'
  ))
  const [editorOpen, setEditorOpen] = useState(() => editParam === '1')
  useEffect(() => {
    setPeriodState(PERIODS.some((item) => item.key === periodParam) ? (periodParam as PeriodKey) : 'today')
  }, [periodParam])
  useEffect(() => { setEditorOpen(editParam === '1') }, [editParam])
  const updateQuery = useCallback((mutate: (query: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString())
    mutate(next)
    const text = next.toString()
    router.replace(text ? `/?${text}` : '/')
  }, [params, router])
  const selectPeriod = useCallback((key: PeriodKey) => {
    setPeriodState(key)
    updateQuery((query) => { if (key === 'today') query.delete('period'); else query.set('period', key) })
  }, [updateQuery])
  const openEditor = useCallback(() => {
    setPreferenceSaveError(null)
    setEditorOpen(true)
    updateQuery((query) => query.set('edit', '1'))
  }, [updateQuery])
  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    updateQuery((query) => query.delete('edit'))
  }, [updateQuery])
  /*
   * 概要の応答は「どのアカウントのどの期間か」を抱えて持つ（DASH-02）。
   * アカウント・期間の切替直後や取得失敗時に、前の対象の数値を
   * 表示し続けないため。読み直しが成功するまでは同じ対象の直前値だけを出す。
   */
  const [overview, setOverview] = useState<{ accountId: string; period: PeriodKey; value: DashboardOverview } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preferences, setPreferences] = useState<DashboardPreferences>(defaultDashboardPreferences)
  const [preferenceVersion, setPreferenceVersion] = useState(0)
  const [preferenceSaving, setPreferenceSaving] = useState(false)
  const preferenceSaveInFlight = useRef(false)
  /*
   * 配置の保存・初期化の失敗は編集パネルの中へ出す（DASH-05）。
   * 背景の概要エラーと混ぜると、パネルを開いたまま失敗が見えず、
   * 「もう一度読み込む」が配置ではなく概要の再取得になっていた。
   */
  const [preferenceSaveError, setPreferenceSaveError] = useState<{ message: string; conflict: boolean } | null>(null)
  const [inboxSummary, setInboxSummary] = useState<PendingInboxSummary | null>(null)
  const [shipmentSummary, setShipmentSummary] = useState<ShipmentSummary | null>(null)
  const [pendingPhotos, setPendingPhotos] = useState<number | null>(null)
  /*
   * 写真審査の件数が取れなかった理由。null のままだと「読み込み中」を
   * 出し続けてしまい、権限がない人にはいつまでも終わらない画面になる。
   */
  const [pendingPhotosState, setPendingPhotosState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading')
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
  // 表示中のアカウント・期間と一致する応答だけを画面へ出す（DASH-02）。
  const data = overview && overview.accountId === selectedAccountId && overview.period === period
    ? overview.value
    : null
  // 対応状況カードは support_marks の画面。オフのaccountではカードごと出さない。
  const supportMarksEnabled = useFeatureVisibility(selectedAccountId).enabled('support_marks')
  const visibleRight = preferences.right
    .filter((item) => item.visible)
    .filter((item) => item.id !== 'support-mark-status' || supportMarksEnabled)
  const visibleToday = preferences.today.filter((item) => item.visible)
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

  /*
   * アカウントが切り替わったら編集パネルを閉じる（DASH-04）。
   * 開きっぱなしだと、前のアカウントの配置を下書きのまま新しい
   * アカウントへ「ダッシュボードに反映」できてしまう。版番号・下書きは
   * アカウントごとのものなので、持ち越さず閉じてから開き直させる。
   */
  const editorAccountRef = useRef(selectedAccountId)
  useEffect(() => {
    if (editorAccountRef.current === selectedAccountId) return
    editorAccountRef.current = selectedAccountId
    closeEditor()
    setPreferenceSaveError(null)
  }, [selectedAccountId, closeEditor])

  const applyPreferences = async (next: DashboardPreferences) => {
    // 同じ描画内の連打も、状態の再描画を待たずに止める。
    if (preferenceSaveInFlight.current) return
    if (!selectedAccountId) {
      setPreferenceSaveError({ message: 'LINEアカウントを選択してください', conflict: false })
      return
    }
    /*
     * 保存を始めた時点のアカウントと版を固定する（DASH-04）。
     * 応答を待っている間に別アカウントへ切り替わっても、ここで掴んだ
     * accountId のキャッシュだけを更新し、表示中の配置・版・パネルは
     * 現在のアカウントのものとして触らない。
     */
    const accountId = selectedAccountId
    preferenceSaveInFlight.current = true
    setPreferenceSaving(true)
    setPreferenceSaveError(null)
    try {
      const normalized = normalizeDashboardPreferences(next)
      const response = await api.dashboard.preferences.save(accountId, {
        version: preferenceVersion,
        cards: normalized,
      })
      if (!response.success) throw new Error(response.error)
      try { window.localStorage.setItem(dashboardStorageKey(accountId), JSON.stringify({ version: response.data.version, cards: normalized })) } catch { /* cache unavailable */ }
      if (selectedAccountIdRef.current !== accountId) return
      setPreferences(normalized)
      setPreferenceVersion(response.data.version)
      closeEditor()
    } catch (caught) {
      if (selectedAccountIdRef.current !== accountId) return
      const conflict = caught instanceof Error && 'status' in caught && caught.status === 409
      setPreferenceSaveError({
        message: conflict
          ? '別の画面で配置が更新されました。再読み込みしてください'
          : 'ダッシュボードの配置を保存できませんでした',
        conflict,
      })
    } finally {
      preferenceSaveInFlight.current = false
      setPreferenceSaving(false)
    }
  }

  /*
   * 「初期状態に戻す」は個人配置の削除なので、パネル内の確認ステップを
   * 通してから実行する（A01-02）。完了応答も保存と同じくアカウント照合で
   * 保護し、切替後に別アカウントの画面・版を書き換えない（DASH-04）。
   */
  const resetPreferences = async () => {
    if (!selectedAccountId || preferenceSaveInFlight.current) return
    const accountId = selectedAccountId
    preferenceSaveInFlight.current = true
    setPreferenceSaving(true)
    setPreferenceSaveError(null)
    try {
      await api.dashboard.preferences.reset(accountId)
      const response = await api.dashboard.preferences.get(accountId)
      if (selectedAccountIdRef.current !== accountId) return
      const next = response.success ? normalizeDashboardPreferences(response.data.cards) : defaultDashboardPreferences()
      const nextVersion = response.success ? response.data.version : 0
      setPreferences(next)
      setPreferenceVersion(nextVersion)
      try { window.localStorage.setItem(dashboardStorageKey(accountId), JSON.stringify({ version: nextVersion, cards: next })) } catch { /* cache unavailable */ }
      closeEditor()
    } catch {
      if (selectedAccountIdRef.current === accountId) {
        setPreferenceSaveError({ message: 'ダッシュボードの配置を初期状態へ戻せませんでした', conflict: false })
      }
    } finally {
      preferenceSaveInFlight.current = false
      setPreferenceSaving(false)
    }
  }

  /*
   * 409（別画面での更新）のとき、パネル内から最新の配置を読み直す。
   * 取得成功時は返した配置をdraftの新しい起点にする（DASH-05）。
   */
  const reloadPreferences = async (): Promise<DashboardPreferences | null> => {
    const accountId = selectedAccountId
    if (!accountId) return null
    try {
      const response = await api.dashboard.preferences.get(accountId)
      if (!response.success || selectedAccountIdRef.current !== accountId) return null
      const next = normalizeDashboardPreferences(response.data.cards)
      setPreferences(next)
      setPreferenceVersion(response.data.version)
      try { window.localStorage.setItem(dashboardStorageKey(accountId), JSON.stringify({ version: response.data.version, cards: next })) } catch { /* cache unavailable */ }
      setPreferenceSaveError(null)
      return next
    } catch {
      return null
    }
  }

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current
    if (accountLoading) return
    if (!selectedAccountId) {
      setOverview(null)
      setLoading(false)
      setError('LINEアカウントを選択してください')
      return
    }
    const accountId = selectedAccountId
    const periodKey = period
    setLoading(true)
    setError('')
    try {
      const response = await api.dashboard.overview({ period: periodKey, accountId })
      if (requestId !== loadRequestId.current) return
      if (response.success) setOverview({ accountId, period: periodKey, value: response.data })
      else setError(response.error)
    } catch {
      if (requestId === loadRequestId.current) setError(`データを${STATE_TEXT.error}`)
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
    /* 行き先は必ずある(知らない種類はお知らせ一覧)。押して何も起きない tap にしない。 */
    const destination = dashboardNotificationDestination(item)
    setNotificationsOpen(false)
    router.push(destination)
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
      setPendingPhotosState('loading')
      setHealthRisk(null)
      setHealthIssueCount(null)
      setTwoFactorSummary(null)
      setSupportMarkAutoOnInbound(null)
      setSupplementLoading(false)
      return
    }
    let cancelled = false
    setSupplementLoading(true)
    /*
     * 勘定を切り替えたら前の勘定の件数を消す。新しい件数が来るまで古い数を
     * 出さない。写真だけでなく予約・健全性・二段階認証・対応マークの設定も
     * すべて前のアカウントの値なので、同じタイミングで失効させる（DASH-03）。
     */
    setPendingPhotos(null)
    setPendingPhotosState('loading')
    setBookings(null)
    setHealthRisk(null)
    setHealthIssueCount(null)
    setTwoFactorSummary(null)
    setSupportMarkAutoOnInbound(null)
    /*
      予約の明細は今日以降だけ100件に区切って取る。終わった予約まで
      全部取ると、件数が増えたときに遅くなる。今日の数と直近の予定は
      この範囲でまかなえる。件数の表示は運用の集計(overview)を使う。
    */
    const now = new Date()
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    const jstMidnightUtc = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()) - 9 * 60 * 60 * 1000
    const todayStartIso = new Date(jstMidnightUtc).toISOString()
    void Promise.allSettled([
      needsPhotos ? api.nenMembers.photoReviewMetrics(selectedAccountId) : Promise.resolve(null),
      needsBookings ? bookingApi.listRequests(selectedAccountId, 'all', { from: todayStartIso, limit: 100 }) : Promise.resolve(null),
      needsHealth ? api.health.getHealth(selectedAccountId) : Promise.resolve(null),
      needsTwoFactor ? api.staff.list() : Promise.resolve(null),
      needsSupportMarks ? api.supportMarks.list(selectedAccountId, { suppressFeatureDisabledEvent: true }) : Promise.resolve(null),
    ]).then(([photoResult, bookingResult, healthResult, staffResult, supportMarkResult]) => {
      if (cancelled) return
      const photoCount = photoResult.status === 'fulfilled' && photoResult.value?.success
        ? photoResult.value.data.pendingCount
        : null
      setPendingPhotos(photoCount)
      /*
        取れなかった理由で出し分ける。403 は権限、それ以外は取得失敗。
        どちらも「読み込み中」のままにしない（#666 差し戻し）。
      */
      setPendingPhotosState(
        !needsPhotos || photoCount !== null ? 'ready'
          : photoResult.status === 'rejected' && photoResult.reason instanceof ApiError && photoResult.reason.status === 403 ? 'forbidden'
            : 'error',
      )
      /*
        器が違う返事(障害時の HTML など)が来ても、`undefined.requests` で
        落ちない。読めなかったら「確認待ち」に出す。
      */
      setBookings(bookingResult.status === 'fulfilled' && bookingResult.value && Array.isArray(bookingResult.value.requests) ? bookingResult.value.requests : null)
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
  const reference = data?.visualQa
  const displayedBookings = reference?.hideBookings ? [] : bookings
  const todayBookings = (reference?.hideBookings ? [] : activeBookings).filter((booking) => jstDay(booking.starts_at) === today)
  const upcomingBookings = displayedBookings ? activeUpcomingBookings(displayedBookings) : []
  const displayedHealthRisk = reference?.healthRisk ?? healthRisk
  const displayedTwoFactor = reference?.twoFactor ?? twoFactorSummary
  const sectionAvailable = (section: keyof NonNullable<DashboardOverview['sections']>) =>
    data?.sections?.[section]?.status !== 'unavailable'
      && data?.sections?.[section]?.status !== 'partial'
  const activeFriends = data?.metrics === undefined
    ? sectionAvailable('friends') ? data?.friends.active ?? null : null
    : data.metrics.activeFriends.value
  const pendingTotal = inboxSummary?.total ?? (sectionAvailable('inbox') ? data?.inbox.unanswered : null) ?? null
  const pendingDetail = inboxSummary
    ? `LINE ${inboxSummary.line}・メール ${inboxSummary.email}`
    : data && sectionAvailable('inbox')
      ? `対応中 ${data.inbox.inProgress}`
      : data ? STATE_TEXT.error : STATE_TEXT.loading
  const renderMainCard = (id: DashboardCardId): ReactNode => {
    if (id === 'pending-inbox') return <PendingInboxCard onSummaryChange={setInboxSummary} />
    if (id === 'friend-trend') return data && !sectionAvailable('trend')
      ? <UnavailableDataCard title="友だち数の推移" section={data.sections?.trend} onRetry={() => void load()} />
      : <FriendTrendCard data={data} loading={loading} />
    if (id === 'friend-add') return <FriendAddLinkCard
      officialProfileUrl={data?.metrics === undefined ? undefined : data.metrics.officialProfileUrl.value}
      visualQa={data?.visualQa}
    />
    if (id === 'scenario-status') {
      const scenarios = sectionAvailable('operations') ? data?.operations?.scenarios : undefined
      return <LiveDataCard title="シナリオ配信状況" href="/scenarios" linkLabel="シナリオを見る" value={scenarios?.active ?? null} detail={scenarios ? `一時停止 ${scenarios.paused}件` : data ? STATE_TEXT.error : STATE_TEXT.loading} freshness={data?.sections?.operations} />
    }
    if (id === 'uid-migration') {
      const migrations = sectionAvailable('operations') ? data?.operations?.migrations : undefined
      return <LiveDataCard title="UID移行状況" href="/health" linkLabel="移行状況を見る" value={migrations?.active ?? null} detail={migrations ? `完了 ${migrations.completed}件` : data ? STATE_TEXT.error : STATE_TEXT.loading} freshness={data?.sections?.operations} />
    }
    return null
  }

  const renderTodayCard = (id: DashboardCardId): ReactNode => {
    if (id === 'today-inbox') return <TodayTaskCard title="対応が必要な受信" href="/chats" action="受信箱を開く" value={pendingTotal} detail={pendingDetail} status={inboxSummary?.oldestWaitMinutes != null ? `最長 ${formatWaitRough(inboxSummary.oldestWaitMinutes)}` : '確認待ち'} />
    if (id === 'today-photo-review') {
      const override = reference?.pendingPhotos
      const value = override ?? pendingPhotos
      /* 見た目確認用の差し替え値があるときは、読み込みの成否に関わらず出す。 */
      const state = override != null ? 'ready' : pendingPhotosState
      /*
       * 権限がないときは件数・緑の業務表示・「審査する」を出さず、
       * 権限を確認する画面へ誘導する（A01-01）。権限なし・取得失敗・
       * 0件・1件以上で、件数と説明と遷移先が矛盾しないようにする。
       */
      const forbidden = state === 'forbidden'
      const detail = forbidden ? '写真を見る権限がありません'
        : state === 'error' ? STATE_TEXT.error
          : value === null ? STATE_TEXT.loading
            : `確認待ち ${value}件`
      return <TodayTaskCard
        title="写真審査"
        href={forbidden ? '/staff' : '/nen-members?tab=photos&status=pending_review'}
        action={forbidden ? '権限を確認する' : '審査する'}
        value={forbidden ? null : value}
        detail={detail}
        status={forbidden ? '権限なし' : state === 'ready' ? 'ポイント付与あり' : '確認待ち'}
        statusTone={state === 'ready' ? 'success' : 'muted'}
      />
    }
    if (id === 'today-bookings') return <TodayTaskCard title="今日の予約" href="/booking/bookings" action="予約を見る" value={displayedBookings === null ? null : todayBookings.length} detail="変更・取消を含む予約一覧" status={upcomingBookings.length > 0 ? `次回 ${new Date(upcomingBookings[0].starts_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}` : '次回予定なし'} />
    if (id === 'today-shipments') return <TodayTaskCard title="出荷予定" href="/ec-commerce" action="ECを見る" value={shipmentSummary?.today ?? null} detail="EC通知から算出" status={reference?.shipmentStatus ?? (shipmentSummary ? `今日・明日 ${shipmentSummary.soon}件` : '確認中')} />
    return null
  }

  const renderRightCard = (id: DashboardCardId): ReactNode => {
    if (id === 'send-quota') return <SendQuotaCard
      delivery={sectionAvailable('quota') ? data?.delivery ?? null : null}
      metric={data?.metrics?.monthlyQuota}
    />
    if (id === 'operational-alerts') return <OperationalAlertsCard risk={displayedHealthRisk} healthIssues={healthIssueCount} oldestWaitMinutes={inboxSummary?.oldestWaitMinutes ?? (sectionAvailable('inbox') ? data?.inbox.oldestUnansweredMinutes : null) ?? null} twoFactor={displayedTwoFactor} referenceCount={reference?.operationalAlerts} />
    if (id === 'connection-status') return <ConnectionStatusCard account={selectedAccount} risk={displayedHealthRisk} activeFriends={activeFriends} />
    if (id === 'upcoming') return <UpcomingCard bookings={displayedBookings} loading={supplementLoading} />
    if (id === 'monthly-delivery') return data && !sectionAvailable('delivery')
      ? <UnavailableDataCard title="今月の配信" section={data.sections?.delivery} onRetry={() => void load()} />
      : data ? <MonthlyDeliveryCard delivery={data.delivery} /> : <EmptyDataCard title="今月の配信" href="/analytics" linkLabel="アクセス解析へ" />
    if (id === 'recent-results') return data && !sectionAvailable('conversions')
      ? <UnavailableDataCard title="最近の成果" section={data.sections?.conversions} onRetry={() => void load()} />
      : data ? <RecentResultsCard conversions={data.conversions} /> : <EmptyDataCard title="最近の成果" href="/conversions" linkLabel="成果を見る" />
    if (id === 'support-mark-status') return <SupportMarkStatusCard inbox={sectionAvailable('inbox') ? (data && reference?.supportInbox ? { ...data.inbox, ...reference.supportInbox } : data?.inbox ?? null) : null} autoOnInbound={supportMarkAutoOnInbound} />
    if (id === 'friend-status') return data && !sectionAvailable('friends')
      ? <UnavailableDataCard title="友だちの状態" section={data.sections?.friends} onRetry={() => void load()} />
      : data ? <FriendStatusCard friends={data.friends} /> : <EmptyDataCard title="友だちの状態" href="/friends" linkLabel="友だちを見る" />
    if (id === 'booking-status') {
      const bookingsStatus = sectionAvailable('operations') ? data?.operations?.bookings : undefined
      return <LiveDataCard title="予約状況" href="/booking/bookings" linkLabel="予約を見る" value={bookingsStatus?.upcoming ?? null} detail={bookingsStatus ? `承認待ち ${bookingsStatus.pending}件` : data ? STATE_TEXT.error : STATE_TEXT.loading} freshness={data?.sections?.operations} />
    }
    if (id === 'inflow-top') {
      const inflowTop = sectionAvailable('operations') ? data?.operations?.inflowTop : undefined
      return <LiveDataCard title="流入経路TOP3" href="/inflow-links" linkLabel="流入経路を見る" value={inflowTop?.[0]?.count ?? (inflowTop ? 0 : null)} detail={inflowTop ? inflowTop.map((item) => `${item.name ?? '—'} ${item.count}`).join('、') || '期間内の追加なし' : data ? STATE_TEXT.error : STATE_TEXT.loading} freshness={data?.sections?.operations} />
    }
    if (id === 'funnel-alert') return <LiveDataCard title="ファネル要注意" href="/analytics" linkLabel="分析を見る" value={sectionAvailable('operations') ? data?.operations?.funnelAlerts ?? null : null} detail="3人以上追加・成果0件の経路" freshness={data?.sections?.operations} />
    if (id === 'automation-failures') return <LiveDataCard title="オートメーション失敗" href="/automations" linkLabel="実行状況を見る" value={sectionAvailable('operations') ? data?.operations?.automationFailures ?? null : null} detail="期間内の失敗・一部失敗" freshness={data?.sections?.operations} />
    return null
  }

  const currentNotificationData = notificationAccountId === selectedAccountId ? notificationData : null
  const notificationItems = dashboardNotificationItems(
    currentNotificationData?.items ?? [],
    (item) => { void openNotification(item) },
  )
  const notificationFilters = dashboardNotificationFilters(currentNotificationData)
  const unreadNotificationCount = data?.visualQa?.notificationUnreadCount ?? currentNotificationData?.unreadCount ?? 0
  const healthLabel = displayedHealthRisk === 'normal' ? '正常稼働' : displayedHealthRisk === 'warning' ? '要確認' : displayedHealthRisk === 'danger' ? '障害あり' : '状態確認中'
  const healthClass = displayedHealthRisk === 'danger' ? 'text-danger' : displayedHealthRisk === 'warning' ? 'text-warning' : displayedHealthRisk === 'normal' ? 'text-success' : 'text-ink-faint'

  return (
    <div>
      {/* V6 `vUXKb/vwcM6`: 画面名は共通トップバーだけ。本文には操作だけを置く。 */}
      <div data-design="Head" className="mb-4.5 flex min-h-10 flex-wrap items-center justify-between gap-3">
        <Button onClick={openEditor}>
          <EditIcon />ダッシュボード編集
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <DashboardFreshness freshness={data?.freshness} asOf={data?.asOf} />
          <span className={`${healthClass} inline-flex items-center gap-1.5 text-xs font-medium`}><span className="h-2 w-2 rounded-full bg-current" />{healthLabel}</span>
          <div className="flex gap-2">
            {PERIODS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => selectPeriod(item.key)}
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
                /* パネル内は先頭100件まで。全件は通知一覧画面へ送る。 */
                setNotificationsOpen(false)
                router.push('/notifications')
              }}
              onOpenSettings={() => {
                setNotificationsOpen(false)
                router.push('/line-notifications')
              }}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-danger-bg text-danger rounded-card mb-5 flex flex-wrap items-center gap-3 p-4 text-sm" role="alert">
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="shrink-0 font-medium underline">もう一度読み込む</button>
        </div>
      )}
      {data?.partialFailures?.length ? (
        <div className="bg-warning-bg text-warning rounded-card mb-5 p-4 text-sm" role="status">
          一部のデータを{STATE_TEXT.error}（{data.partialFailures.join('、')}）。0件としては表示していません。
        </div>
      ) : null}

      {visibleToday.length > 0 ? <section data-design="TodayTasks" className="mb-6">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h2 className="text-ink text-lg font-bold">今日やること</h2>
          <span className="text-ink-faint text-xs">優先度が高い順</span>
        </div>
        {/* #975 U060: 390pxでは先頭2件だけ出し、残りは「集計を見る」で開く。 */}
        <KpiCollapse gridClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visibleToday.map((item) => <div key={item.id}>{renderTodayCard(item.id)}</div>)}
        </KpiCollapse>
      </section> : null}

      <div data-design="Middle" className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)]">
        <div data-design="Body" className="min-w-0 space-y-[18px]">
          {/*
            出荷予定を含め、メインのカードは編集パネルで決めた順番どおりに出す
            （DASH-06）。以前は出荷だけがメインの外へ固定され、並べ替えても
            先頭に居続けた。非表示にしても件数取得を止めないよう、OFFのときは
            その場所へ畳んだままマウントを維持する。
          */}
          {preferences.main.map((item) => {
            if (item.id === 'shipment') {
              return (
                <div key={item.id} data-design="Shipment" className={item.visible ? '' : 'hidden'} aria-hidden={!item.visible}>
                  <ShipmentPanel onSummaryChange={setShipmentSummary} />
                </div>
              )
            }
            if (!item.visible) return null
            return <div key={item.id}>{renderMainCard(item.id)}</div>
          })}
        </div>
        <aside className="min-w-0 space-y-3.5">
          {visibleRight.map((item) => <div key={item.id}>{renderRightCard(item.id)}</div>)}
        </aside>
      </div>

      <DashboardEditor
        open={editorOpen}
        preferences={preferences}
        saving={preferenceSaving}
        saveError={preferenceSaveError?.message ?? null}
        saveConflict={preferenceSaveError?.conflict ?? false}
        onReloadPreferences={reloadPreferences}
        onCancel={closeEditor}
        onApply={applyPreferences}
        onReset={resetPreferences}
      />
    </div>
  )
}

export default function DashboardPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={null}>
      <DashboardPageInner />
    </Suspense>
  )
}
