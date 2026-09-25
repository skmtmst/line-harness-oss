'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { EntryRoute, NotificationCenterData, NotificationCenterItem } from '@line-crm/shared'
import { ApiError, api, bookingApi, type BookingRequest, type DashboardOverview } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { formatDurationMinutes, formatWaitRough } from '@/lib/format-duration'
import MetricValue from '@/components/ui/metric-value'
import PendingInboxCard, { type PendingInboxSummary } from '@/components/support/pending-inbox-card'
import ShipmentPanel, { type ShipmentSummary } from '@/components/dashboard/shipment-panel'
import QrDialog from '@/components/dashboard/qr-dialog'
import FriendTrendTable from '@/components/dashboard/friend-trend-table'
import DashboardFreshness, { dashboardLocalUpdatedAt, dashboardPeriodLabel } from '@/components/dashboard/freshness'
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
import HelpTip from '@/components/shared/help-tip'
import SelectField from '@/components/shared/select-field'
import StatusBadge from '@/components/shared/status-badge'
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

/* JSTの `YYYY-MM`。予約集計APIの month / last_month に渡す（A01-04）。 */
function monthKey(offset: number): string {
  const now = new Date(Date.now() + 9 * 3600_000)
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
  return d.toISOString().slice(0, 7)
}

/*
 * 「次回」の予約。同じ日なら時刻だけ、違う日なら日付を付ける（DASH-30）。
 * 時刻だけだと、深夜に見たとき「次回 09:00」が今日なのか明日なのか読めない。
 */
function nextBookingLabel(iso: string, today: string): string {
  const time = new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  })
  const day = jstDay(iso)
  if (day === today) return `次回 ${time}`
  if (day === jstDay(Date.now() + 86_400_000)) return `次回 明日 ${time}`
  const [, month, date] = day.split('-')
  if (!month || !date) return `次回 ${time}`
  return `次回 ${Number(month)}/${Number(date)} ${time}`
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
  period,
  href,
  action,
  value,
  detail,
  status,
  statusTone = 'success',
  loading = false,
}: {
  title: string
  /*
   * 件数の対象期間（「現在」「今日」「今日・明日」）。見出しの脇へ小さく出す。
   * h3 の中には入れない。テスト・画面内の「見出し＝カード名」の対応を守るため。
   */
  period?: string
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
  statusTone?: 'success' | 'muted' | 'danger'
  /* true の間は件数の場所に骨組みを出す。失敗・未取得は「—」のまま（#673）。 */
  loading?: boolean
}) {
  return (
    /*
     * ★V7「ダッシュボードの見せ方」（V7 文書 fyR7V）。数字をいちばん大きく、状態は数字の横、
     * 操作は右下に1つ（→付き）。以前は右上の操作・数字・補足2つの3段で、目が上下に散っていた。
     */
    <Card layout="vertical" padding="default" className="h-[116px] min-w-0">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="text-ink-secondary min-w-0 truncate text-sm font-semibold" title={title}>{title}</h3>
        {period ? <span className="text-ink-faint whitespace-nowrap text-xs font-normal">{period}</span> : null}
      </div>
      <div className="mt-2 flex min-w-0 items-baseline gap-2">
        <p className="text-ink text-[28px] leading-none font-bold tabular-nums" aria-busy={loading || undefined}>
          {loading ? (
            <>
              {/* #673: 「—」は「取れなかった」にも読めるので、待っている間は形だけ残す */}
              <span className="bg-canvas-sunken inline-block h-7 w-16 animate-pulse rounded" aria-hidden="true" />
              <span className="sr-only">{STATE_TEXT.loading}</span>
            </>
          ) : (
            <>
              {value === null ? '—' : value.toLocaleString('ja-JP')}<span className="text-ink-secondary ml-0.5 text-sm font-semibold">件</span>
            </>
          )}
        </p>
        <span className={`${statusTone === 'muted' ? 'text-ink-faint' : statusTone === 'danger' ? 'text-danger' : 'text-success'} shrink-0 whitespace-nowrap text-xs font-semibold`}>{status}</span>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="text-ink-faint min-w-0 truncate text-xs" title={detail}>{detail}</span>
        <Link href={href} className="text-action inline-flex min-h-6 shrink-0 items-center gap-1 text-xs font-bold hover:underline">
          {action}
          <span aria-hidden="true">→</span>
        </Link>
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
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
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
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1200)
    } catch {
      /*
       * 権限拒否・安全なコンテキストでない環境では書けない（DASH-29）。
       * 黙って終わらせず失敗を出し、欄から手動で選べることを伝える。
       */
      setCopyState('failed')
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
          {copyState === 'copied' ? 'コピーしました ✓' : 'コピー'}
        </button>
        <button type="button" onClick={() => writeQr(routeId || 'base')} className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control shrink-0 border px-5 py-2.5 text-xs font-medium">QRを表示</button>
      </div>
      {copyState === 'failed' ? (
        <p role="alert" className="text-danger mt-2 text-xs">
          コピーできませんでした。上のURL欄を選択してコピーしてください。
        </p>
      ) : null}

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
        /* 集計は固定の直近7日。期間ボタンに連動しないことを見出し脇に書く（IDEA-01）。 */
        meta="直近7日"
        /* 「友だちの増減」タブが同じ系列を見る画面。既定タブでもあるが明示する。 */
        action={<Link href="/analytics?tab=friends" className="hover:underline">さらに詳しく →</Link>}
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

/*
 * 概要がまだ返っていない間のカード（DASH-11）。
 * 「表示できるデータはまだありません」は空データの言い方で、読み込み中に
 * 出すと「0件」と取り違える。読み込み中は読み込み中と言う。
 */
function LoadingDataCard({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <Card overflow="hidden">
      <CardHeader
        size="roomy"
        title={title}
        action={<Link href={href} className="hover:underline">{linkLabel} →</Link>}
        actionTone="info"
      />
      <div className="space-y-2 px-5 py-8" aria-label={`${title}を${STATE_TEXT.loading}`}>
        <div className="bg-canvas-sunken h-5 animate-pulse rounded" />
        <div className="bg-canvas-sunken h-5 w-2/3 animate-pulse rounded" />
      </div>
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
  title, period, href, linkLabel, value, unit = '件', detail, help, freshness, loading = false,
}: {
  title: string
  /* 数字の対象期間（「現在」・選択中の期間など）。見出しの脇へ小さく出す（IDEA-01）。 */
  period?: string
  href: string; linkLabel: string; value: number | null; unit?: string; detail: string
  /* 定義・分母・計算のしかた。見出しのすぐ右の「？」へ入れる（★V7・§2-1b）。 */
  help?: string
  freshness?: NonNullable<DashboardOverview['sections']>[keyof NonNullable<DashboardOverview['sections']>]
  /* true の間は数値の場所に骨組みを出す。失敗・未取得は「—」のまま（#673）。 */
  loading?: boolean
}) {
  return (
    <Card padding="roomy">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-ink min-w-0 truncate text-sm font-semibold" title={title}>{title}</h2>
        {help ? <HelpTip label={`${title}の説明`}>{help}</HelpTip> : null}
        {period ? <span className="text-ink-faint flex-1 whitespace-nowrap pt-0.5 text-[11px] font-normal">{period}</span> : null}
        <Link href={href} className="text-action shrink-0 text-xs hover:underline">{linkLabel} →</Link>
      </div>
      <p className="text-ink mt-4 text-2xl font-bold tabular-nums" aria-busy={loading || undefined}>
        {loading ? (
          <>
            {/* #673: 「—」は「取れなかった」にも読めるので、待っている間は形だけ残す */}
            <span className="bg-canvas-sunken inline-block h-7 w-20 animate-pulse rounded" aria-hidden="true" />
            <span className="sr-only">{STATE_TEXT.loading}</span>
          </>
        ) : (
          // 監査6 #674: 数字の見せ方は MetricValue に寄せる。
          // 値が無いときは「—」だけで単位を付けない（「—件」は数に見える）。
          <MetricValue value={value} unit={unit} />
        )}
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
  freshness,
  onRetry,
}: {
  delivery: DashboardOverview['delivery'] | null
  metric: NonNullable<DashboardOverview['metrics']>['monthlyQuota'] | undefined
  /* LINEの応答時刻・取得失敗。枠が「いつ時点」の数かを出す（IDEA-01）。 */
  freshness?: ReactNode
  onRetry: () => void
}) {
  const used = metric === undefined ? delivery?.quotaUsed ?? null : metric.value?.used ?? null
  const limit = metric === undefined ? delivery?.quotaLimit ?? null : metric.value?.limit ?? null
  /*
   * 「上限なし(type=none)」「未接続」「取得失敗」「確認中」を分ける（DASH-08）。
   * 以前は全部が同じ「残りを確認中」の緑で、障害も無制限契約も見分けられなかった。
   */
  const unlimited = metric?.value?.unlimited === true
  const notConnected = metric !== undefined && metric.state === 'unavailable' && metric.reason === 'not_connected'
  const failed = metric !== undefined && metric.state === 'unavailable' && metric.reason !== 'not_connected'
  const loading = metric === undefined && delivery === null
  const remaining = used !== null && limit !== null ? Math.max(0, limit - used) : null
  const remainingRate = remaining !== null && limit ? Math.max(0, Math.min(100, remaining / limit * 100)) : null
  /* 残りわずか・0件を緑のままにしない。10%を切ったら危険色にする。 */
  const low = remainingRate !== null && remainingRate <= 10
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
          {loading ? (
            <>
              <span className="bg-canvas-sunken inline-block h-6 w-44 animate-pulse rounded" aria-hidden="true" />
              <span className="sr-only">{STATE_TEXT.loading}</span>
            </>
          ) : unlimited
            ? `使用 ${used === null ? '—' : used.toLocaleString('ja-JP')}通（上限なし）`
            : remaining === null || limit === null
              ? '—'
              : `残り ${remaining.toLocaleString('ja-JP')} / 上限 ${limit.toLocaleString('ja-JP')}通`}
        </span>
      </span>
    </p>
    {unlimited ? (
      <p className="text-ink-faint mt-3 text-xs">上限なしの契約のため、残りの棒は出していません。</p>
    ) : (
      <div className="bg-hairline mt-3 h-1.5 overflow-hidden rounded-pill"><div className={`${low ? 'bg-danger' : 'bg-accent'} h-full rounded-pill`} style={{ width: `${remainingRate ?? 0}%` }} /></div>
    )}
    <div className="mt-2 flex items-center justify-between gap-3 text-xs">
      {notConnected ? (
        <span className="text-ink-faint">LINEアカウントが未接続です</span>
      ) : failed ? (
        <button type="button" onClick={onRetry} className="text-danger font-medium hover:underline">
          {`送信枠を${STATE_TEXT.error}。もう一度読み込む`}
        </button>
      ) : loading ? (
        <span className="bg-canvas-sunken inline-block h-4 w-24 animate-pulse rounded" aria-hidden="true" />
      ) : unlimited ? (
        <span className="text-ink-faint">契約種別：無制限</span>
      ) : (
        <span className={low ? 'text-danger' : 'text-success'}>
          {remainingRate === null ? '残りを確認中' : `残り ${remainingRate.toFixed(1)}%`}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-3">
        {freshness}
        <Link href="/accounts" className="text-action font-medium hover:underline">配信設定へ →</Link>
      </span>
    </div>
  </Card>
}

function OperationalAlertsCard({ risk, healthIssues, oldestWaitMinutes, twoFactor, referenceCount, failed, updatedAt }: { risk: HealthRisk; healthIssues: number | null; oldestWaitMinutes: number | null; twoFactor: { enabled: number; total: number } | null; referenceCount?: number; failed?: boolean; updatedAt?: Date | null }) {
  const currentHealthIssue = risk === 'warning' || risk === 'danger'
  // 未対応の長さは受信カードで管理する。ここへ重ねて警告扱いすると、
  // 接続も自動処理も正常なのに赤い「1件」が出てしまう。
  const count = referenceCount ?? (risk === null ? null : currentHealthIssue ? Math.max(1, healthIssues ?? 1) : 0)
  return <Card padding="roomy" className="min-h-[128px]">
    {/* 見出しを切らない（★V7）。状態の文が長いので、見出しと同じ行に並べず下の段へ回す。 */}
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h2 className="text-ink shrink-0 text-base font-bold">運用アラート</h2>
      {/* 現在時点の状態。数の対象期間が分かるよう見出し脇へ書く（IDEA-01）。 */}
      <span className="text-ink-faint flex-1 whitespace-nowrap pt-0.5 text-[11px] font-normal">現在</span>
      {/*
        #631: 件数の母集団は変えない（health issue だけを数える）。
        「最も古い未対応」と別のものを数えていることが、件数の脇の文言
        だけで分かるようにする。0件のときに「未対応が長引いている」の
        隣で緑の「0件」が出ても、別の指標だと読めるようにするのが狙い。
        取れていないときは 0件 ではなく「未取得」とする（IDEA-01）。
      */}
      <span className="flex flex-wrap items-center gap-2"><span className={failed || count === null ? 'text-ink-faint text-sm font-bold' : 'text-ink text-sm font-bold'}>{failed ? '未取得' : count === null ? '—' : `接続・自動処理 ${count}件`}</span>{!failed && count !== null ? <StatusBadge tone={count > 0 ? 'danger' : 'success'} size="compact">{count > 0 ? '要確認' : '正常'}</StatusBadge> : null}</span>
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
    <div className="mt-3 flex items-center justify-between gap-3">
      <Link href="/emergency" className="text-action inline-block text-xs font-medium hover:underline">運用状態を見る →</Link>
      {dashboardLocalUpdatedAt(updatedAt) ? (
        <span className="text-ink-faint shrink-0 text-xs font-medium">{dashboardLocalUpdatedAt(updatedAt)}</span>
      ) : null}
    </div>
  </Card>
}

function ConnectionStatusCard({ account, risk, activeFriends, healthFailed, updatedAt }: { account: ReturnType<typeof useAccount>['selectedAccount']; risk: HealthRisk; activeFriends: number | null; healthFailed?: boolean; updatedAt?: Date | null }) {
  const webhook = account?.webhook?.status
  const webhookLabel = webhook === 'matched' ? '正常' : webhook === 'mismatched' || webhook === 'unconfigured' ? '要確認' : '確認中'
  return <Card padding="roomy" className="min-h-[128px]">
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-ink min-w-0 truncate text-base font-bold" title="接続状態">接続状態</h2>
      {/* 現在時点の状態（IDEA-01）。 */}
      <span className="text-ink-faint flex-1 whitespace-nowrap text-[11px] font-normal">現在</span>
      {dashboardLocalUpdatedAt(updatedAt) ? (
        <span className="text-ink-faint shrink-0 text-xs font-medium">{dashboardLocalUpdatedAt(updatedAt)}</span>
      ) : null}
    </div>
    <dl className="mt-3 space-y-2 text-xs">
      <div className="flex justify-between gap-3"><dt className="text-ink-faint">LINE Webhook</dt><dd className={webhookLabel === '正常' ? 'text-success font-semibold' : webhookLabel === '要確認' ? 'text-danger font-semibold' : 'text-ink-faint'}>{webhookLabel}</dd></div>
      {/* 稼働チェックの取得に失敗したときは「確認中」ではなく「未取得」にする（IDEA-01）。 */}
      <div className="flex justify-between gap-3"><dt className="text-ink-faint">自動処理</dt><dd className={healthFailed ? 'text-ink-faint' : risk === 'normal' ? 'text-success font-semibold' : risk ? 'text-danger font-semibold' : 'text-ink-faint'}>{healthFailed ? '未取得' : risk === 'normal' ? '稼働中' : risk ? '要確認' : '確認中'}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-ink-faint">有効友だち</dt><dd className="text-ink font-semibold tabular-nums">{activeFriends === null ? '—' : `${activeFriends.toLocaleString('ja-JP')}人`}</dd></div>
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
  /* 受信箱の取得が失敗したか（IDEA-01）。0件と失敗を分けるための旗。 */
  const [inboxFailed, setInboxFailed] = useState(false)
  const [shipmentSummary, setShipmentSummary] = useState<ShipmentSummary | null>(null)
  const [shipmentState, setShipmentState] = useState<'loading' | 'ready' | 'error'>('loading')
  const shipmentEmpty = shipmentState === 'ready' && shipmentSummary !== null && shipmentSummary.today + shipmentSummary.soon + shipmentSummary.later === 0
  const [pendingPhotos, setPendingPhotos] = useState<number | null>(null)
  /*
   * 写真審査の件数が取れなかった理由。null のままだと「読み込み中」を
   * 出し続けてしまい、権限がない人にはいつまでも終わらない画面になる。
   */
  const [pendingPhotosState, setPendingPhotosState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading')
  const [bookings, setBookings] = useState<BookingRequest[] | null>(null)
  /*
   * 「今日の予約」の総数。明細は100件までしか取らないため、100件を
   * 越える日は明細からは数え切れない（A01-04）。集計APIの値を使い、
   * 段階配備中の旧Worker（todayActiveTotal 未返却）では明細数へ戻る。
   */
  const [todayActiveBookings, setTodayActiveBookings] = useState<number | null>(null)
  /* 明細の取得失敗。null だけだと「読込中」と「失敗」を区別できない（IDEA-01）。 */
  const [bookingsFailed, setBookingsFailed] = useState(false)
  /* 稼働チェックの取得失敗。同上（IDEA-01）。 */
  const [healthFailed, setHealthFailed] = useState(false)
  /* 補助取得（写真・予約・稼働・二段階・対応マーク）を最後に終えた時刻。 */
  const [supplementLoadedAt, setSupplementLoadedAt] = useState<Date | null>(null)
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
  /*
   * 子カードへの通知口は useCallback で固定する。毎描画で新しい関数を
   * 渡すと子の取得 effect が回り続け、30秒更新とは別に取り直しが
   * 止まらなくなる。
   */
  const handleShipmentSummary = useCallback(
    (summary: ShipmentSummary | null, state?: 'loading' | 'ready' | 'error') => {
      setShipmentSummary(summary)
      setShipmentState(state ?? (summary ? 'ready' : 'loading'))
    },
    [],
  )
  const handleInboxSummary = useCallback(
    (summary: PendingInboxSummary | null, ok?: boolean) => {
      if (ok === false) {
        /*
         * 失敗したら前回の件数を小カードへ残さない。古い数を
         * 最新の数と誤認させないため、失敗中は「未取得」に倒す。
         */
        setInboxSummary(null)
        setInboxFailed(true)
        return
      }
      if (summary) {
        setInboxSummary(summary)
        setInboxFailed(false)
      }
    },
    [],
  )
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

  /*
    V6R-S1-a: 補足データはカードごとに別の effect で取る。

    以前は5系統を1つの effect で取っていたため、どれか1つの「要る／要らない」が
    後から変わると全部を取り直していた。検証環境の実測では、対応マーク機能の
    有効が表示可否の到着で判明した瞬間に、写真・予約・予約集計・健全性・職員一覧まで
    2回目を取りに行っていた（ダッシュボードで28本中7種が2回）。

    - アカウントを切り替えたら、前のアカウントの値はすべて同じタイミングで消す（DASH-03）
    - 届いた順にカードへ反映する（PERF-01）。「最後に終えた時刻」はそれぞれの完了で刻む
  */
  const markSupplementLoaded = useCallback((isCancelled: () => boolean) => {
    if (!isCancelled()) setSupplementLoadedAt(new Date())
  }, [])

  useEffect(() => {
    // アカウントが替わったら、補足データの「最後に終えた時刻」を消す。各カードの値は各 effect が消す。
    setSupplementLoadedAt(null)
    setSupplementLoading(Boolean(selectedAccountId))
  }, [selectedAccountId])

  useEffect(() => {
    setPendingPhotos(null)
    setPendingPhotosState('loading')
    if (!selectedAccountId) return
    if (!needsPhotos) {
      setPendingPhotosState('ready')
      return
    }
    let cancelled = false
    const isCancelled = () => cancelled
    void api.nenMembers.photoReviewMetrics(selectedAccountId).then(
      (result) => {
        if (cancelled) return
        const photoCount = result?.success ? result.data.pendingCount : null
        setPendingPhotos(photoCount)
        setPendingPhotosState(photoCount !== null ? 'ready' : 'error')
        markSupplementLoaded(isCancelled)
      },
      /*
        取れなかった理由で出し分ける。403 は権限、それ以外は取得失敗。
        どちらも「読み込み中」のままにしない（#666 差し戻し）。
      */
      (reason) => {
        if (cancelled) return
        setPendingPhotos(null)
        setPendingPhotosState(reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error')
        markSupplementLoaded(isCancelled)
      },
    )
    return () => { cancelled = true }
  }, [markSupplementLoaded, needsPhotos, selectedAccountId])

  useEffect(() => {
    setBookings(null)
    setTodayActiveBookings(null)
    setBookingsFailed(false)
    if (!selectedAccountId) return
    if (!needsBookings) {
      setSupplementLoading(false)
      return
    }
    let cancelled = false
    const isCancelled = () => cancelled
    setSupplementLoading(true)
    /*
      予約の明細は今日以降だけ100件に区切って取る。終わった予約まで
      全部取ると、件数が増えたときに遅くなる。今日の数と直近の予定は
      この範囲でまかなえる。件数の表示は運用の集計(overview)を使う。
    */
    const now = new Date()
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    const jstMidnightUtc = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()) - 9 * 60 * 60 * 1000
    const todayStartIso = new Date(jstMidnightUtc).toISOString()
    const todayJst = jstDay(now)
    const bookingPromise = bookingApi.listRequests(selectedAccountId, 'all', { from: todayStartIso, limit: 100 })
    /*
      「今日の予約」の件数は明細とは別に集計APIから取る（A01-04）。
      明細は100件までしか来ないため、件数だけは上限に引っ張られない
      口を使う。
    */
    const bookingSummaryPromise = bookingApi.requestsSummary(selectedAccountId, {
      month: monthKey(0),
      lastMonth: monthKey(-1),
      today: todayJst,
      weekTo: jstDay(Date.now() + 6 * 86_400_000),
    })
    void bookingPromise.then(
      (result) => {
        if (cancelled) return
        /*
          器が違う返事(障害時の HTML など)が来ても、`undefined.requests` で
          落ちない。読めなかったら「確認待ち」に出す。
        */
        const bookingList = result && Array.isArray(result.requests) ? result.requests : null
        setBookings(bookingList)
        setBookingsFailed(bookingList === null)
        markSupplementLoaded(isCancelled)
      },
      () => {
        if (cancelled) return
        setBookings(null)
        setBookingsFailed(true)
        markSupplementLoaded(isCancelled)
      },
    )
    void bookingSummaryPromise.then(
      (result) => {
        if (cancelled) return
        /*
          旧Workerは todayActiveTotal を返さない。そのときは null のままにし、
          表示側で明細からの件数へ戻す。取りこぼした数字を本物に見せない。
        */
        setTodayActiveBookings(result && typeof result.todayActiveTotal === 'number' ? result.todayActiveTotal : null)
        markSupplementLoaded(isCancelled)
      },
      () => {
        if (cancelled) return
        setTodayActiveBookings(null)
        markSupplementLoaded(isCancelled)
      },
    )
    /*
      一覧側の「読み込み中」は、このカードが実際に待つ予約系の2本だけで
      下ろす。写真・健全性など無関係の取得が遅れても、届いた予約は
      その時点で表示へ出る。
    */
    void Promise.allSettled([bookingPromise, bookingSummaryPromise]).then(() => {
      if (!cancelled) setSupplementLoading(false)
    })
    return () => { cancelled = true }
  }, [markSupplementLoaded, needsBookings, selectedAccountId])

  useEffect(() => {
    setHealthRisk(null)
    setHealthIssueCount(null)
    setHealthFailed(false)
    if (!selectedAccountId || !needsHealth) return
    let cancelled = false
    const isCancelled = () => cancelled
    void api.health.getHealth(selectedAccountId).then(
      (result) => {
        if (cancelled) return
        const healthData = result?.success === true ? result.data : null
        setHealthRisk(healthData ? (healthData.riskLevel as HealthRisk) : null)
        setHealthIssueCount(
          healthData
            ? healthData.logs.filter((log) => log.riskLevel === 'warning' || log.riskLevel === 'danger').length
            : null,
        )
        setHealthFailed(healthData === null)
        markSupplementLoaded(isCancelled)
      },
      () => {
        if (cancelled) return
        setHealthRisk(null)
        setHealthIssueCount(null)
        setHealthFailed(true)
        markSupplementLoaded(isCancelled)
      },
    )
    return () => { cancelled = true }
  }, [markSupplementLoaded, needsHealth, selectedAccountId])

  useEffect(() => {
    setTwoFactorSummary(null)
    if (!selectedAccountId || !needsTwoFactor) return
    let cancelled = false
    const isCancelled = () => cancelled
    void api.staff.list().then(
      (result) => {
        if (cancelled) return
        setTwoFactorSummary(result?.success ? summarizeTwoFactor(result.data) : null)
        markSupplementLoaded(isCancelled)
      },
      () => {
        if (cancelled) return
        setTwoFactorSummary(null)
        markSupplementLoaded(isCancelled)
      },
    )
    return () => { cancelled = true }
  }, [markSupplementLoaded, needsTwoFactor, selectedAccountId])

  useEffect(() => {
    setSupportMarkAutoOnInbound(null)
    if (!selectedAccountId || !needsSupportMarks) return
    let cancelled = false
    const isCancelled = () => cancelled
    void api.supportMarks.list(selectedAccountId, { suppressFeatureDisabledEvent: true }).then(
      (result) => {
        if (cancelled) return
        setSupportMarkAutoOnInbound(result?.success ? hasInboundSupportMark(result.data) : null)
        markSupplementLoaded(isCancelled)
      },
      () => {
        if (cancelled) return
        setSupportMarkAutoOnInbound(null)
        markSupplementLoaded(isCancelled)
      },
    )
    return () => { cancelled = true }
  }, [markSupplementLoaded, needsSupportMarks, selectedAccountId])

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
  /*
   * 「対応が必要な受信」小カードの件数は、遷移先 `/chats?status=unread` と
   * 同じ口で数える（IDEA-01）:
   *   LINE … 選択中アカウントの未対応（overview.inbox.unanswered）
   *   MAIL … メールはアカウントを持たない。受信箱に同じ一覧で混ざる
   *          未対応メール（support/inbox の emailUnread、権限のある範囲）
   * 片方でも取れていない間は合計を出さず「—」にする。取れたぶんだけを
   * 足すと実際より少ない件数を本物の数字に見せてしまう。
   */
  const inboxSectionOk = data !== null && sectionAvailable('inbox')
  const lineUnread = inboxSectionOk ? data.inbox.unanswered : null
  const mailUnread = inboxSummary?.emailUnread ?? null
  const pendingTotal = lineUnread === null || mailUnread === null ? null : lineUnread + mailUnread
  const pendingDetail = lineUnread === null && mailUnread === null
    ? (data !== null || inboxFailed || error ? STATE_TEXT.error : STATE_TEXT.loading)
    : `LINE ${lineUnread === null ? '未取得' : lineUnread}・MAIL ${mailUnread === null ? '未取得' : mailUnread}`
  /*
   * 「最も古い未対応」は受信カードと同じ値を使う（要件 §6-1）。
   * 概要が取れているときは選択中アカウントの最古未対応、取れないときは
   * 受信箱カードの最古待ちへ退く。
   */
  const pendingOldest = inboxSectionOk
    ? (data.inbox.oldestUnansweredMinutes ?? null)
    : (inboxSummary?.oldestWaitMinutes ?? null)
  const renderMainCard = (id: DashboardCardId): ReactNode => {
    /* pending-inbox・shipment は非表示でも件数取得を続けるため、描画ループ側で別扱い。 */
    if (id === 'friend-trend') return data && !sectionAvailable('trend')
      ? <UnavailableDataCard title="友だち数の推移" section={data.sections?.trend} onRetry={() => void load()} />
      : <FriendTrendCard data={data} loading={loading} />
    if (id === 'friend-add') return <FriendAddLinkCard
      officialProfileUrl={data?.metrics === undefined ? undefined : data.metrics.officialProfileUrl.value}
      visualQa={data?.visualQa}
    />
    if (id === 'scenario-status') {
      const scenarios = sectionAvailable('operations') ? data?.operations?.scenarios : undefined
      return <LiveDataCard title="シナリオ配信状況" period="現在" href="/scenarios" linkLabel="シナリオを見る" value={scenarios?.active ?? null} detail={scenarios ? `一時停止 ${scenarios.paused}件` : data ? STATE_TEXT.error : STATE_TEXT.loading} freshness={data?.sections?.operations} loading={loading} />
    }
    if (id === 'uid-migration') {
      const migrations = sectionAvailable('operations') ? data?.operations?.migrations : undefined
      /*
       * 行き先は移行の画面そのもの（DASH-07）。/health は稼働状況の画面で、
       * 移行の進行は見られない。
       */
      return <LiveDataCard title="UID移行状況" period="現在" href="/accounts?tab=migration" linkLabel="移行状況を見る" value={migrations?.active ?? null} detail={migrations ? `完了 ${migrations.completed}件` : data ? STATE_TEXT.error : STATE_TEXT.loading} freshness={data?.sections?.operations} loading={loading} />
    }
    return null
  }

  const renderTodayCard = (id: DashboardCardId): ReactNode => {
    if (id === 'today-inbox') return <TodayTaskCard
      title="対応が必要な受信"
      period="現在"
      /* カードの件数（LINE未対応＋未対応メール）と同じ絞り込みで受信箱を開く。 */
      href="/chats?status=unread"
      action="受信箱を開く"
      value={pendingTotal}
      detail={pendingDetail}
      loading={pendingDetail === STATE_TEXT.loading}
      status={pendingTotal === null
        ? '未取得'
        : pendingOldest !== null ? `最長 ${formatWaitRough(pendingOldest)}` : '—'}
      /* 待っている人がいる時の「最長 ○日前」は注意の色。緑は「問題なし」に読める（★V7）。 */
      statusTone={pendingTotal === null ? 'muted' : pendingTotal > 0 ? 'danger' : 'success'}
    />
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
        period="現在"
        href={forbidden ? '/staff' : '/nen-members?tab=photos&status=pending_review'}
        action={forbidden ? '権限を確認する' : '審査する'}
        value={forbidden ? null : value}
        detail={detail}
        loading={state === 'loading'}
        status={forbidden ? '権限なし' : state === 'ready' ? 'ポイント付与あり' : '確認待ち'}
        statusTone={state === 'ready' ? 'success' : 'muted'}
      />
    }
    /*
      件数は集計APIの「今日の有効予約」を優先する（A01-04）。明細は100件で
      打ち切られるため、それを数えた値は101件以上の日に嘘をつく。
      集計が返らないときだけ明細の件数へ戻る。
    */
    if (id === 'today-bookings') {
      const bookingsValue = todayActiveBookings ?? (displayedBookings === null ? null : todayBookings.length)
      return <TodayTaskCard
        title="今日の予約"
        period="今日"
        /*
         * カードの件数は「今日の有効予約」。遷移先は今日の日カレンダー
         * （要件 §5-1: /booking/bookings?view=day）。
         */
        href="/booking/bookings?view=day"
        action="予約を見る"
        value={bookingsValue}
        detail={bookingsFailed && todayActiveBookings === null ? STATE_TEXT.error : '取消・完了を除く今日の予約'}
        loading={bookingsValue === null && !bookingsFailed}
        /*
         * 明細が取れていないのに「次回予定なし」と出すと、失敗を 0件 と
         * 見せることになる（IDEA-01）。失敗は「未取得」、読込中は「確認中」。
         */
        status={bookingsFailed ? '未取得'
          : bookings === null ? '確認中'
            : upcomingBookings.length > 0 ? nextBookingLabel(upcomingBookings[0].starts_at, today) : '次回予定なし'}
        statusTone={bookingsFailed ? 'muted' : 'success'}
      />
    }
    if (id === 'today-shipments') return <TodayTaskCard
      title="出荷予定"
      period="今日・明日"
      href="/ec-commerce"
      action="ECを見る"
      value={shipmentState === 'ready' ? (shipmentSummary?.today ?? null) : null}
      loading={shipmentState === 'loading'}
      detail={shipmentState === 'error'
        ? STATE_TEXT.error
        : shipmentState === 'ready'
          ? (shipmentSummary?.scanLimited ? `直近${shipmentSummary.scanLimit}件のEC通知から算出` : 'EC通知から算出')
          : STATE_TEXT.loading}
      /*
       * 失敗を「確認中」のままにしない（IDEA-01）。失敗は「未取得」、
       * 取れて0件なら「今日・明日 0件」。
       */
      status={reference?.shipmentStatus ?? (shipmentState === 'error' ? '未取得' : shipmentState === 'ready' ? `今日・明日 ${shipmentSummary?.soon ?? 0}件` : '確認中')}
      statusTone={shipmentState === 'error' ? 'muted' : 'success'}
    />
    return null
  }

  const renderRightCard = (id: DashboardCardId): ReactNode => {
    if (id === 'send-quota') return <SendQuotaCard
      delivery={sectionAvailable('quota') ? data?.delivery ?? null : null}
      metric={data?.metrics?.monthlyQuota}
      freshness={<DashboardFreshness freshness={data?.sections?.quota?.freshness} asOf={data?.sections?.quota?.asOf} reason={data?.sections?.quota?.reason} />}
      onRetry={() => void load()}
    />
    if (id === 'operational-alerts') return <OperationalAlertsCard risk={displayedHealthRisk} healthIssues={healthIssueCount} oldestWaitMinutes={pendingOldest} twoFactor={displayedTwoFactor} referenceCount={reference?.operationalAlerts} failed={healthFailed} updatedAt={supplementLoadedAt} />
    if (id === 'connection-status') return <ConnectionStatusCard account={selectedAccount} risk={displayedHealthRisk} activeFriends={activeFriends} healthFailed={healthFailed} updatedAt={supplementLoadedAt} />
    if (id === 'upcoming') return <UpcomingCard bookings={displayedBookings} loading={supplementLoading} updatedAt={bookingsFailed ? null : supplementLoadedAt} />
    if (id === 'monthly-delivery') return data && !sectionAvailable('delivery')
      ? <UnavailableDataCard title="今月の配信" section={data.sections?.delivery} onRetry={() => void load()} />
      : data ? <MonthlyDeliveryCard delivery={data.delivery} freshness={<DashboardFreshness freshness={data.sections?.delivery?.freshness} asOf={data.sections?.delivery?.asOf} reason={data.sections?.delivery?.reason} />} />
        : loading ? <LoadingDataCard title="今月の配信" href="/analytics?tab=reactions" linkLabel="アクセス解析へ" />
          : <UnavailableDataCard title="今月の配信" onRetry={() => void load()} />
    if (id === 'recent-results') return data && !sectionAvailable('conversions')
      ? <UnavailableDataCard title="最近の成果" section={data.sections?.conversions} onRetry={() => void load()} />
      : data ? <RecentResultsCard conversions={data.conversions} period={dashboardPeriodLabel(period) ?? 'この期間'} freshness={<DashboardFreshness freshness={data.sections?.conversions?.freshness} asOf={data.sections?.conversions?.asOf} reason={data.sections?.conversions?.reason} />} />
        : loading ? <LoadingDataCard title="最近の成果" href="/conversions" linkLabel="成果を見る" />
          : <UnavailableDataCard title="最近の成果" onRetry={() => void load()} />
    if (id === 'support-mark-status') return <SupportMarkStatusCard inbox={sectionAvailable('inbox') ? (data && reference?.supportInbox ? { ...data.inbox, ...reference.supportInbox } : data?.inbox ?? null) : null} autoOnInbound={supportMarkAutoOnInbound} freshness={<DashboardFreshness freshness={data?.sections?.inbox?.freshness} asOf={data?.sections?.inbox?.asOf} reason={data?.sections?.inbox?.reason} />} />
    if (id === 'friend-status') return data && !sectionAvailable('friends')
      ? <UnavailableDataCard title="友だちの状態" section={data.sections?.friends} onRetry={() => void load()} />
      : data ? <FriendStatusCard friends={data.friends} freshness={<DashboardFreshness freshness={data.sections?.friends?.freshness} asOf={data.sections?.friends?.asOf} reason={data.sections?.friends?.reason} />} />
        : loading ? <LoadingDataCard title="友だちの状態" href="/friends" linkLabel="友だちを見る" />
          : <UnavailableDataCard title="友だちの状態" onRetry={() => void load()} />
    if (id === 'booking-status') {
      const bookingsStatus = sectionAvailable('operations') ? data?.operations?.bookings : undefined
      /*
       * カードは「今後の予約・承認待ち」の数。遷移先は一覧を「未承認」で
       * 絞った形にし、副文の承認待ち件数と同じ行が並ぶ（IDEA-01）。
       */
      /*
       * 大きい数字は「承認待ち」にする。行き先の `?status=requested` が
       * 同じ母集団を出すので、カードと一覧の件数が一致する（IDEA-01）。
       * 「今後の予約」は補足として併記する。
       */
      return <LiveDataCard title="予約状況" period="現在" href="/booking/bookings?view=list&status=requested" linkLabel="予約を見る" value={bookingsStatus?.pending ?? null} detail={bookingsStatus ? `今後の予約 ${bookingsStatus.upcoming}件` : data ? STATE_TEXT.error : STATE_TEXT.loading} freshness={data?.sections?.operations} loading={loading} />
    }
    if (id === 'inflow-top') {
      const inflowTop = sectionAvailable('operations') ? data?.operations?.inflowTop : undefined
      /* 「経路と成果」タブが期間内の経路別の登録・成果を見る画面（IDEA-01）。 */
      return <LiveDataCard title="流入経路TOP3" period={dashboardPeriodLabel(period) ?? undefined} href="/analytics?tab=routes" linkLabel="経路別の内訳を見る" value={inflowTop?.[0]?.count ?? (inflowTop ? 0 : null)} detail={inflowTop ? inflowTop.map((item) => `${item.name ?? '—'} ${item.count}`).join('、') || '期間内の追加なし' : data ? STATE_TEXT.error : STATE_TEXT.loading} freshness={data?.sections?.operations} loading={loading} />
    }
    if (id === 'funnel-alert') return <LiveDataCard title="ファネル要注意" period={dashboardPeriodLabel(period) ?? undefined} href="/analytics?tab=funnel" linkLabel="ファネルを見る" value={sectionAvailable('operations') ? data?.operations?.funnelAlerts ?? null : null} detail="" help="3人以上追加され、成果が0件の経路です" freshness={data?.sections?.operations} loading={loading} />
    if (id === 'automation-failures') return <LiveDataCard title="オートメーション失敗" period={dashboardPeriodLabel(period) ?? undefined} href="/automations/runs?status=problems" linkLabel="実行状況を見る" value={sectionAvailable('operations') ? data?.operations?.automationFailures ?? null : null} detail="" help="期間内の失敗と一部失敗の合計です" freshness={data?.sections?.operations} loading={loading} />
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
                className={`rounded-pill border px-4 py-2 text-xs font-medium transition-colors ${period === item.key ? 'border-accent-deep bg-accent-deep text-on-accent' : 'border-hairline bg-canvas text-ink-secondary hover:bg-canvas-sunken'}`}
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

      {/*
        ★V7 `x63W5x`：ページ全体の失敗はピンクの箱ではなく、中立のカードで出す。
        赤は使わない（利用者の失敗ではないため）。読み直す口は残す。
      */}
      {error && (
        <div className="bg-canvas border-hairline rounded-card mb-5 flex flex-wrap items-center gap-3 border p-4 text-sm" role="alert">
          <span className="text-ink min-w-0 flex-1">{error}</span>
          <Button type="button" variant="secondary" onClick={() => void load()}>もう一度読み込む</Button>
        </div>
      )}
      {/*
        ★V7 `x63W5x`：一部のデータだけ取れないときは、その場所に小さく1行だけ。
        黄色の帯にしない。
      */}
      {data?.partialFailures?.length ? (
        <p className="text-ink-secondary mb-5 text-xs" role="status">
          一部のデータを{STATE_TEXT.error}（{data.partialFailures.join('、')}）。0件としては表示していません。
        </p>
      ) : null}

      {visibleToday.length > 0 ? <section data-design="TodayTasks" className="mb-6">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h2 className="text-ink text-lg font-bold">今日やること</h2>
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
            /*
             * 非表示にしても件数取得を止めないよう、OFFのときはその場所へ
             * 畳んだままマウントを維持する。受信箱は上部の小カードの件数・
             * 最長待ちの供給源でもあり、アンマウントすると小カードが「—」に
             * 戻る（DASH-21）。
             */
            if (item.id === 'shipment') {
              return (
                /*
                 * 出荷が0件の時は、上の小カード「出荷予定 0件」で足りるので大きな空の欄は出さない
                 * （★V7 ダッシュボードの見せ方）。件数は取り続けるので、隠すだけでマウントは保つ。
                 */
                <div key={item.id} data-design="Shipment" className={item.visible && !shipmentEmpty ? '' : 'hidden'} aria-hidden={!item.visible || shipmentEmpty}>
                  {/*
                    選択中アカウントの出荷だけを数える（IDEA-01）。
                    小カード「出荷予定」と遷移先 /ec-commerce は同じアカウント範囲。
                  */}
                  <ShipmentPanel
                    accountId={selectedAccountId}
                    onSummaryChange={handleShipmentSummary}
                  />
                </div>
              )
            }
            if (item.id === 'pending-inbox') {
              return (
                <div key={item.id} className={item.visible ? '' : 'hidden'} aria-hidden={!item.visible}>
                  {/*
                    上部の小カードの MAIL 件数・最長待ちはこのカードの取得結果から
                    取る（DASH-21）。失敗も一緒に知らせ、0件と取り違えない。
                  */}
                  <PendingInboxCard onSummaryChange={handleInboxSummary} />
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
