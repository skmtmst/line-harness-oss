'use client'

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import type { AdConversionLog, AdPlatform } from '@/lib/api'
import type { EntryRoute } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Chip from '@/components/shared/chip'
import Disclosure from '@/components/shared/disclosure'
import KpiCard from '@/components/shared/kpi-card'
import PageHeader from '@/components/shared/page-header'
import SectionHeader from '@/components/shared/section-header'
import ActionMenu from '@/components/shared/action-menu'
import { MoreAction } from '@/components/shared/row-actions'
import { RefreshCw } from 'lucide-react'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import Dialog from '@/components/shared/dialog'
import DateField from '@/components/shared/date-field'
import { TextField } from '@/components/shared/text-field'
import { TableHeadRow, Th } from '@/components/shared/table'
import { formatNumber } from '@/lib/format'

type AdView = 'metrics' | 'connections' | 'history'

/** #514-6: 送信履歴を一度に描く件数。これを超えるぶんはページ送りで見る。 */
const LOG_PAGE_SIZE = 20

const PROVIDERS = [
  { key: 'google', label: 'Google広告', clickId: 'gclid' },
  { key: 'meta', label: 'Meta広告', clickId: 'fbclid' },
  { key: 'tiktok', label: 'TikTok', clickId: 'ttclid' },
  { key: 'x', label: 'X（旧Twitter）', clickId: 'twclid' },
] as const

const STATUS_LABEL: Record<string, string> = {
  sent: '送れました',
  success: '送れました',
  pending: '待っています',
  failed: '断られました',
  skipped: '送っていません',
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'すべての状態' },
  { value: 'sent', label: '送れたもの' },
  { value: 'pending', label: '待っているもの' },
  { value: 'failed', label: '断られたもの' },
]

/** #818: /api/ad-costs が返す1行。 */
type AdCostRow = {
  sourceLabel: string
  adPlatformId: string | null
  entryRouteId: string | null
  source: 'import' | 'manual'
  totals: Array<{ currency: string; amountMinor: number }>
  friendAdds: number | null
  costPerFriendMinor: number | null
  lastImportedAt: string | null
}

/** R275: 手で入れた費用の1行。取消しても履歴に残る。 */
type ManualCostEntry = {
  id: string
  sourceLabel: string
  day: string
  amountMinor: number
  currency: string
  entryRouteId: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
}

/** #818: 媒体ごとの取込状況。 */
type AdCostPlatformStatus = {
  id: string
  name: string
  displayName: string | null
  lastSuccessAt: string | null
  lastRunStatus: 'success' | 'failed' | null
  lastRunAt: string | null
  lastError: string | null
}

/** 費用の表示。最小通貨単位で来るので通貨に合わせて戻す。 */
function formatMinor(amountMinor: number, currency: string): string {
  const zeroDecimal = currency === 'JPY'
  const major = zeroDecimal ? amountMinor : amountMinor / 100
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency }).format(major)
}

function formatCostTotals(totals: Array<{ currency: string; amountMinor: number }>): ReactNode {
  if (totals.length === 0) return '—'
  return (
    <span className="flex flex-wrap gap-x-2">
      {totals.map((total) => <span key={total.currency}>{formatMinor(total.amountMinor, total.currency)}</span>)}
    </span>
  )
}

/** 取込日時の短い表示(9/25 06:00)。 */
function shortDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function currencyCode(platform: AdPlatform): string | null {
  const value = platform.config.currency
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value.trim().toUpperCase())) return null
  return value.trim().toUpperCase()
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency }).format(value)
}

function platformCost(platform: AdPlatform | undefined): string {
  if (!platform || typeof platform.config.monthly_cost !== 'number' || !Number.isFinite(platform.config.monthly_cost)) return '未設定'
  const currency = currencyCode(platform)
  return currency ? formatCurrency(platform.config.monthly_cost, currency) : '通貨を確認'
}

function platformLabel(platform: AdPlatform): string {
  return PROVIDERS.find((provider) => provider.key === platform.name)?.label
    ?? platform.displayName
    ?? platform.name
}

function accountLabel(platform: AdPlatform): string | null {
  for (const key of ['customer_id', 'pixel_id', 'pixel_code', 'account_id']) {
    const value = platform.config[key]
    if (typeof value === 'string' && value) return value
  }
  return null
}

/**
 * #514-8: 送信履歴の口が返すのは id・adPlatformId・friendId・eventName・
 * clickId(clickIdType)・status・errorMessage・createdAt だけ。口の返さない
 * friendName・conversionName・nextRetryAt は読まない(本番で常に空になる)。
 */
function syncLabel(platform: AdPlatform): string | null {
  const syncedAt = platform.config.synced_at
  if (typeof syncedAt !== 'string' || !syncedAt) return null
  const date = new Date(syncedAt)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

/** #514-8: 次の予定は口に無い。取れない時刻は書かず状態だけ出す。 */
function nextScheduleText(log: AdConversionLog): string {
  if (log.status === 'pending') return '送信待ちです'
  if (log.status === 'failed') return '予定はありません'
  return '—'
}

function safeCsv(logs: AdConversionLog[]): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
  const rows = logs.map((log) => [
    log.createdAt,
    log.eventName,
    log.clickIdType ?? '経路不明',
    STATUS_LABEL[log.status] ?? '状態不明',
  ].map((value) => quote(value)).join(','))
  return ['"日時","成果","クリックの種類","状態"', ...rows].join('\n')
}

export default function AdIntegration({
  view,
  onPlatformCountsChange,
}: {
  view: AdView
  /**
   * #980: 「広告連携」「広告とのつなぎ」タブの件数をホストへ渡す。
   * この画面が一覧に使う `platforms` と同じ集計（選択中アカウントの
   * 広告設定の総数と、そのうち動いている数）で、読み込み前・失敗時・
   * アカウント未選択は null。数字を出せないときに0を書かない。
   */
  onPlatformCountsChange?: (counts: { total: number; connected: number } | null) => void
}) {
  const { selectedAccountId } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  const loadGenerationRef = useRef(0)
  latestAccountRef.current = selectedAccountId
  const [platforms, setPlatforms] = useState<AdPlatform[]>([])
  const [logs, setLogs] = useState<AdConversionLog[]>([])
  const [logTotal, setLogTotal] = useState(0)
  // R278: 30日の送信結果は一覧の口が返す集計を使う。ページ・絞り込みで
  // 変わらない全アカウント範囲の数で、口が返さない時は「—」とし、表示中の行から推測しない。
  const [logSummary, setLogSummary] = useState<{ sentLast30Days: number; pendingLast30Days: number; failedLast30Days: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [platformFilter, setPlatformFilter] = useState<{ accountId: string | null; id: string }>({ accountId: selectedAccountId, id: '' })
  const adPlatformId = platformFilter.accountId === selectedAccountId ? platformFilter.id : ''
  // #514-6: 媒体横断の共通一覧口から20件ずつ取得する。
  const [logPage, setLogPage] = useState(1)
  // #514-13: 失敗理由は口の errorMessage を開いて見せる(「理由を見る」を効かせる)。
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
  // #818: 広告費の台帳。取込分と手入力分を同じ一覧で見せる。
  const [costRows, setCostRows] = useState<AdCostRow[]>([])
  const [costPlatforms, setCostPlatforms] = useState<AdCostPlatformStatus[]>([])
  const [costFailed, setCostFailed] = useState(false)
  // R275: 手で入れた費用を1行ずつ持つ。間違えた記録はここから取消す。
  const [manualEntries, setManualEntries] = useState<ManualCostEntry[]>([])
  const [canManage, setCanManage] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<ManualCostEntry | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualBusy, setManualBusy] = useState(false)
  const [manualError, setManualError] = useState('')
  const [manualLabel, setManualLabel] = useState('')
  const [manualRouteId, setManualRouteId] = useState('')
  const [manualDay, setManualDay] = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const [entryRoutes, setEntryRoutes] = useState<EntryRoute[]>([])
  const [importingId, setImportingId] = useState<string | null>(null)
  const [importError, setImportError] = useState('')
  const [manualMenuId, setManualMenuId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setPlatforms([])
      setLogs([])
      setLogTotal(0)
      setLogSummary(null)
      setCostRows([])
      setCostPlatforms([])
      setFailed(false)
      setLoading(false)
      return
    }
    const isCurrent = () => generation === loadGenerationRef.current && accountAtRequest === latestAccountRef.current
    setLoading(true)
    setFailed(false)
    try {
      const [platformResponse, logResponse, costResponse] = await Promise.all([
        api.adPlatforms.list(accountAtRequest),
        api.adPlatforms.logsPage({ page: logPage, limit: LOG_PAGE_SIZE, status, query, lineAccountId: accountAtRequest, adPlatformId }),
        api.adCosts.list({ accountId: accountAtRequest }),
      ])
      if (!isCurrent()) return
      if (!platformResponse.success || !logResponse.success) {
        setFailed(true)
        return
      }
      setPlatforms(platformResponse.data)
      setLogs(logResponse.data.items)
      setLogTotal(logResponse.data.total)
      setLogSummary(logResponse.data.summary ?? null)
      if (costResponse.success) {
        setCostRows(costResponse.data.rows ?? [])
        setCostPlatforms(costResponse.data.platforms ?? [])
        setManualEntries(costResponse.data.manualEntries ?? [])
        setCostFailed(false)
      } else {
        setCostRows([])
        setCostPlatforms([])
        setManualEntries([])
        setCostFailed(true)
      }
    } catch {
      if (!isCurrent()) return
      setFailed(true)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [adPlatformId, logPage, query, selectedAccountId, status])

  useEffect(() => {
    // 切替直後は前accountの金額を残さず、遅れて届いた旧応答もgenerationで捨てる。
    setPlatforms([])
    setLogs([])
    setLogTotal(0)
    setLogSummary(null)
    void load()
    return () => { loadGenerationRef.current += 1 }
  }, [load])

  // R275: 手入力の取消は owner/admin だけ。staff は閲覧まで。
  // アカウント未選択では権限も取りにいかない（画面が通信しない約束）。
  useEffect(() => {
    if (!selectedAccountId) { setCanManage(false); return }
    let active = true
    void api.staff.me().then((response) => {
      if (!active) return
      setCanManage(response.success && (response.data.role === 'owner' || response.data.role === 'admin'))
    }).catch(() => undefined)
    return () => { active = false }
  }, [selectedAccountId])

  const openCancelDialog = useCallback((entry: ManualCostEntry) => {
    setCancelTarget(entry)
    setCancelReason('')
    setCancelError('')
  }, [])

  const submitCancel = useCallback(async () => {
    if (!cancelTarget || cancelBusy) return
    const reason = cancelReason.trim()
    if (!reason) { setCancelError('取り消す理由を入れてください'); return }
    setCancelBusy(true)
    setCancelError('')
    try {
      const res = await api.adCosts.cancel(cancelTarget.id, reason)
      if (!res.success) { setCancelError(res.error ?? '取り消せませんでした'); return }
      setCancelTarget(null)
      void load()
    } catch {
      setCancelError('取り消せませんでした。通信状態を確かめて、もう一度お試しください。')
    } finally {
      setCancelBusy(false)
    }
  }, [cancelTarget, cancelBusy, cancelReason, load])

  const connected = platforms.filter((platform) => platform.isActive)
  /*
    #980: タブの件数は、この画面が一覧に使う platforms と同じ集計から出す。
    「広告連携」は設定の総数、「広告とのつなぎ」は動いているつなぎの数。
    読み込み前・失敗時は null を渡して数字を出さない。
  */
  useEffect(() => {
    onPlatformCountsChange?.(
      loading || failed || !selectedAccountId
        ? null
        : {
            total: platforms.length,
            connected: platforms.filter((platform) => platform.isActive).length,
          },
    )
  }, [onPlatformCountsChange, loading, failed, selectedAccountId, platforms])
  const sentCount = logSummary?.sentLast30Days ?? null
  const pendingCount = logSummary?.pendingLast30Days ?? null
  const failedCount = logSummary?.failedLast30Days ?? null
  // 再送成功数の集計は口が返さない。設定値や表示中の行から推測しない。
  const retrySuccessCount = null
  const visibleLogs = logs
  const logPageCount = Math.max(1, Math.ceil(logTotal / LOG_PAGE_SIZE))
  const safeLogPage = Math.min(logPage, logPageCount)

  // #818: 手入力の窓を開くときに、そのアカウントの流入元を取る。
  // 既に取ってあれば取り直さない。
  const openManualEntry = useCallback(() => {
    setManualError('')
    setManualOpen(true)
    if (entryRoutes.length === 0 && selectedAccountId) {
      void api.entryRoutes.list(selectedAccountId)
        .then((res) => { if (res.success) setEntryRoutes(res.data) })
        .catch(() => {})
    }
  }, [entryRoutes.length, selectedAccountId])

  const submitManualEntry = useCallback(async () => {
    if (!selectedAccountId || manualBusy) return
    if (!manualLabel.trim()) { setManualError('流入元の名前を入れてください'); return }
    if (!manualDay) { setManualError('費用の日付を選んでください'); return }
    if (!manualAmount.trim()) { setManualError('費用を入力してください'); return }
    const amount = Number(manualAmount)
    if (!Number.isInteger(amount) || amount < 0) { setManualError('費用は0以上の整数(円)で入れてください'); return }
    setManualBusy(true)
    setManualError('')
    try {
      const res = await api.adCosts.create({
        lineAccountId: selectedAccountId,
        sourceLabel: manualLabel.trim(),
        entryRouteId: manualRouteId || undefined,
        day: manualDay,
        amountMinor: amount,
        currency: 'JPY',
      })
      if (!res.success) { setManualError(res.error ?? '記録できませんでした'); return }
      setManualOpen(false)
      setManualLabel('')
      setManualRouteId('')
      setManualDay('')
      setManualAmount('')
      void load()
    } catch {
      setManualError('記録できませんでした。通信状態を確かめて、もう一度お試しください。')
    } finally {
      setManualBusy(false)
    }
  }, [selectedAccountId, manualBusy, manualLabel, manualDay, manualAmount, manualRouteId, load])

  const runImportNow = useCallback(async (platformId: string) => {
    if (importingId) return
    setImportingId(platformId)
    setImportError('')
    try {
      const res = await api.adPlatforms.importCost(platformId)
      if (!res.success) setImportError(res.error ?? '取り込めませんでした')
      void load()
    } catch {
      setImportError('取り込めませんでした。接続設定を確かめて、もう一度お試しください。')
    } finally {
      setImportingId(null)
    }
  }, [importingId, load])

  const exportLogs = () => {
    const blob = new Blob([`\uFEFF${safeCsv(visibleLogs)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `広告への送信履歴_${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (!selectedAccountId) {
    return (
      <ListState
        kind="empty"
        title="LINEアカウントを選択してください"
        description="選んだLINEアカウントの広告費だけを表示します。"
      />
    )
  }

  if (loading) {
    return <ListState kind="loading" title="広告との接続状況を読み込んでいます" />
  }

  if (failed) {
    return (
      <ListState
        kind="error"
        title="広告との接続状況を表示できませんでした"
        description="接続設定は消えていません。状態を読み直して、もう一度お試しください。"
        action={<Button variant="secondary" onClick={() => void load()}>広告の状態を再読み込み</Button>}
      />
    )
  }

  if (view === 'history') {
    return (
      <div className="space-y-4" data-design-node="p0kA3">
        <PageHeader title="広告への送信履歴" titleDisplay="always"
          breadcrumb={[{ label: '← 広告とのつなぎへ戻る', href: '/inflow-links?tab=connections' }]}
          description="成果と広告のクリックが結びつき、送信処理が始まるとここに並びます。"
          actions={<Button variant="secondary" onClick={exportLogs} disabled={visibleLogs.length === 0}>CSVで書き出す</Button>} />
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            value={query}
            onChange={(value) => { setQuery(value); setLogPage(1) }}
            onClear={() => { setQuery(''); setLogPage(1) }}
            placeholder="成果・クリックの種類で探す"
            aria-label="成果・クリックの種類で探す"
            className="w-full sm:w-80"
          />
          <Select value={status} onChange={(value) => { setStatus(value); setLogPage(1) }} options={STATUS_OPTIONS} aria-label="送信状態" />
          <Select value={adPlatformId} onChange={(id) => { setPlatformFilter({ accountId: selectedAccountId, id }); setLogPage(1) }} options={[{ value: '', label: 'すべての媒体' }, ...platforms.map((platform) => ({ value: platform.id, label: platformLabel(platform) }))]} aria-label="媒体" />
          <span className="ml-auto text-xs tabular-nums text-ink-secondary">{formatNumber(logTotal)}件中 {formatNumber(visibleLogs.length)}件</span>
        </div>

        {visibleLogs.length === 0 ? (
          <ListState
            kind="empty"
            title="条件に合う送信履歴はありません"
            description="成果と広告のクリックが結びつき、送信処理が始まるとここに並びます。"
          />
        ) : (
          <section className="overflow-hidden rounded-card border border-hairline bg-canvas">
            <table className="w-full table-fixed text-xs">
              <colgroup><col /><col className="w-1/6" /><col className="w-1/6" /><col className="w-28" /><col className="w-28" /><col className="w-32" /></colgroup>
              <thead className="border-b border-hairline bg-canvas-sunken text-ink-faint">
                <TableHeadRow>
                  <Th>いつ・何の成果</Th>
                  <Th>媒体</Th>
                  <Th>流入元</Th>
                  <Th>状態</Th>
                  <Th>次の予定</Th>
                  <Th align="right">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody className="divide-y divide-hairline">
                {visibleLogs.map((log) => {
                  const platform = platforms.find((item) => item.id === log.adPlatformId)
                  const expanded = expandedLogId === log.id
                  return (
                    <Fragment key={log.id}>
                    <tr>
                      <td className="px-4 py-3 text-ink">
                        <span className="block truncate font-semibold" title={log.eventName}>{log.eventName}</span>
                        <span className="mt-0.5 block whitespace-nowrap text-ink-faint">{shortDateTime(log.createdAt)}</span>
                      </td>
                      <td className="truncate px-4 py-3 text-ink-secondary" title={platform ? platformLabel(platform) : undefined}>{platform ? platformLabel(platform) : '—'}</td>
                      <td className="px-4 py-3 text-ink-secondary">—</td>
                      <td className="px-4 py-3">
                        <Chip tone={log.status === 'failed' ? 'danger' : log.status === 'pending' ? 'info' : log.status === 'sent' || log.status === 'success' ? 'ok' : 'neutral'}>{STATUS_LABEL[log.status] ?? '状態不明'}</Chip>
                      </td>
                      <td className="px-4 py-3 text-ink-faint">
                        {nextScheduleText(log)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {log.status === 'failed'
                          ? <Button variant="secondary" onClick={() => setExpandedLogId(expanded ? null : log.id)}>{expanded ? '理由を閉じる' : '理由を見る'}</Button>
                          : <span className="text-ink-faint">—</span>}
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={6} className="bg-canvas-sunken px-4 py-3 text-xs leading-relaxed text-ink-secondary">
                          失敗理由: {log.errorMessage || '理由の記録がありません。広告側の接続設定を確かめてください。'}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-end gap-2 border-t border-hairline px-4 py-3 text-xs">
              <span className="text-ink-faint tabular-nums">全 {logTotal} 件</span>
              <Pagination page={safeLogPage} pageCount={logPageCount} onPageChange={setLogPage} />
            </div>
          </section>
        )}

      </div>
    )
  }

  if (view === 'connections') {
    return (
      <div className="space-y-4" data-design-node="FDBsG">
        <PageHeader title="広告とのつなぎ" titleDisplay="always"
          breadcrumb={[{ label: '← 流入と計測へ', href: '/inflow-links' }]}
          description="LINEで出た成果を広告へ返し、広告の配信を賢くします。お客様の名前やメールアドレスは広告へ送りません。"
          actions={<Button variant="secondary" href="/inflow-links?tab=connections&view=history">送信履歴を見る</Button>} />
        <SectionHeader title="返すしくみ" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            ['1', 'クリックの目印を持ち帰る', '中継リンクを通った人だけ広告と結びつきます。'],
            ['2', '成果が出たら順に送る', '成果地点で数えたら、待ち行列に入れてから広告へ送ります。'],
            ['3', '同じ成果は2回送らない', 'やり直しても同じ目印を使います。広告側で二重に数えられません。'],
          ].map(([step, title, description]) => <Card key={step} padding="default"><SectionHeader title={`${step}. ${title}`} /><p className="mt-2 text-xs text-ink-secondary">{description}</p></Card>)}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="送った件数" value={sentCount} detail="この30日" />
          <Metric label="待っている" value={pendingCount} detail="送信処理を待っています" />
          <Metric label="断られた" value={failedCount} detail="理由を確認してください" />
          <Metric label="やり直して成功" value={retrySuccessCount} detail="同じ成果は二重に数えません" />
        </div>
        <Disclosure title="つないでいる広告" size="compact">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {PROVIDERS.map((provider) => {
              const platform = platforms.find((item) => item.name === provider.key)
              const active = platform?.isActive === true
              // #514-13: 同期日時は直書きしない。口の synced_at が無ければ出さない。
              const synced = platform ? syncLabel(platform) : null
              return (
                <div key={provider.key} className="rounded-control border border-hairline p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{provider.label}</p>
                      <p className="mt-1 text-xs text-ink-faint">クリックの目印 {provider.clickId}</p>
                      {platform && accountLabel(platform) && (
                        <p className="mt-1 text-xs text-ink-faint">広告アカウント {accountLabel(platform)}</p>
                      )}
                    </div>
                    <span className={`rounded-pill px-2 py-1 text-xs font-semibold ${active ? 'bg-accent-soft text-accent-deep' : 'bg-canvas-sunken text-ink-faint'}`}>
                      {active ? 'つながっています' : 'つないでいません'}
                    </span>
                  </div>
                  {!platform && (
                    <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                      まだ接続されていません。
                    </p>
                  )}
                  {/*
                    #514-13: 設定・接続の操作画面は無い。効かないボタンは出さず、
                    状態の文だけにする。
                  */}
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-faint">
                    <span>{active ? (synced ? `${synced} に同期` : '同期日時は取得できません') : platform?.config.connection_error === '権限が足りません' ? 'もう一度つなぎ直してください' : '接続すると成果を返せます'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </Disclosure>
      </div>
    )
  }

  // #818: 広告費の一覧。流入元ごとに友だち追加と1人あたりを足す。
  // 取れていない日は費用を「—」にして、最後に取れた日時を残す。
  const totalCostByCurrency = new Map<string, number>()
  for (const row of costRows) {
    for (const total of row.totals) {
      totalCostByCurrency.set(total.currency, (totalCostByCurrency.get(total.currency) ?? 0) + total.amountMinor)
    }
  }
  const linkedJpyRows = costRows.filter((row) => row.entryRouteId && row.totals.some((total) => total.currency === 'JPY'))
  const addsByRoute = new Map<string, number>()
  for (const row of linkedJpyRows) {
    if (row.entryRouteId && !addsByRoute.has(row.entryRouteId)) addsByRoute.set(row.entryRouteId, row.friendAdds ?? 0)
  }
  const linkedFriendAdds = [...addsByRoute.values()].reduce((sum, count) => sum + count, 0)
  const linkedJpyCost = linkedJpyRows.reduce((sum, row) => sum + (row.totals.find((total) => total.currency === 'JPY')?.amountMinor ?? 0), 0)
  const avgCostPerFriend = linkedFriendAdds > 0 ? Math.round(linkedJpyCost / linkedFriendAdds) : null

  return (
    <div className="space-y-4" data-design-node="qSTVR">
      <PageHeader
        title="広告連携" titleDisplay="always"
        breadcrumb={[{ label: '← 流入と計測へ', href: '/inflow-links' }]}
        description="広告をつなぐと毎日自動で費用を取り込みます。取り込めない分は「費用を手で入れる」から足せます。"
        actions={canManage ? <Button variant="secondary" onClick={openManualEntry}>費用を手で入れる</Button> : undefined}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="この30日の広告費" value={null} unit="" valueText={costFailed ? '—' : [...totalCostByCurrency].map(([currency, amount]) => formatMinor(amount, currency)).join('・') || '—'} detail={costFailed ? '広告費を読み込めませんでした' : '選んだLINEアカウントの分だけ'} help="取込分と手入力分の合計です。通貨ごとに分け、換算せずに表示します。" />
        <KpiCard title="つないだ広告" value={connected.length} unit="件" detail={connected.length > 0 ? connected.map(platformLabel).join('・') : 'まだ接続がありません'} />
        <KpiCard title="友だち1人あたり" value={null} unit="" valueText={costFailed || avgCostPerFriend == null ? '—' : `¥${formatNumber(avgCostPerFriend)}`} detail={costFailed ? '広告費を読み込めませんでした' : `友だち追加 ${formatNumber(linkedFriendAdds)}人`} help="経路がある円の費用だけを合計し、同じ経路の追加人数は1回だけ数えます。経路なし・追加0人・他通貨は計算に含めません。" />
        <KpiCard title="成果1件あたり" value={null} unit="" detail="成果件数を取得できません" help="同じ期間の広告費を、認めた成果の件数で割った額です。" />
      </div>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="広告の接続状態">
        {PROVIDERS.map((provider) => {
          const platform = platforms.find((item) => item.name === provider.key)
          const costPlatform = platform ? costPlatforms.find((item) => item.id === platform.id) : undefined
          const synced = costPlatform?.lastSuccessAt ? shortDateTime(costPlatform.lastSuccessAt) : platform ? syncLabel(platform) : null
          return <Card key={provider.key} padding="default">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-semibold text-ink" title={provider.label}>{provider.label}</span>
              <Chip tone={platform?.isActive ? 'ok' : 'neutral'}>{platform?.isActive ? 'つないでいる' : '未接続'}</Chip>
            </div>
            <p className="mt-2 text-xs text-ink-secondary">{platform?.isActive ? synced ? `最後の取り込み ${synced}` : '取り込み日時は取得できません' : 'つなぐと費用とクリックを取り込みます'}</p>
            {platform?.isActive && canManage ? <Button className="mt-2" variant="secondary" disabled={importingId !== null} busy={importingId === platform.id} busyLabel="取り込んでいます…" onClick={() => void runImportNow(platform.id)}><RefreshCw className="h-4 w-4" aria-hidden="true" />広告の状態を再読み込み</Button> : null}
            {costPlatform?.lastRunStatus === 'failed' ? <p className="mt-2 text-xs text-ink-secondary">直近は取り込めませんでした。{costPlatform.lastError}</p> : null}
            <Disclosure title="月額予算" size="compact" className="mt-2"><span className="text-xs text-ink-secondary">{platformCost(platform)}</span></Disclosure>
          </Card>
        })}
      </section>
      {importError ? <Notice tone="warn" message={importError} /> : null}
      <section className="overflow-hidden rounded-card border border-hairline bg-canvas">
        <div className="px-4 py-3"><SectionHeader title="流入元ごとの費用" help="取り込んだ費用と手入力分です。費用を取得できない日は「—」になります。" helpLabel="流入元ごとの費用の説明" /></div>
        {costFailed ? (
          <ListState
            kind="error"
            title="広告費を読み込めませんでした"
            description="記録は消えていません。もう一度読み込んでください。"
            action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
          />
        ) : costRows.length === 0 ? (
          <ListState
            kind="empty"
            title="まだ費用の記録がありません"
            description="広告をつなぐと毎日自動で取り込みます。取り込めない分は「費用を手で入れる」から足せます。"
          />
        ) : (
          <table className="w-full table-fixed text-xs">
            <colgroup><col /><col className="w-1/6" /><col className="w-1/6" /><col className="w-1/6" /><col className="w-24" /><col className="w-24" /><col className="w-24" /></colgroup>
            <thead className="border-b border-hairline bg-canvas-sunken text-ink-faint"><TableHeadRow>
              <Th>流入元</Th><Th>媒体</Th><Th>計測リンク</Th><Th align="right">この30日の費用</Th><Th align="right">友だち追加</Th><Th align="right">1人あたり</Th><Th>取り込み</Th>
            </TableHeadRow></thead>
            <tbody className="divide-y divide-hairline">
              {costRows.map((row) => (
                <tr key={`${row.sourceLabel}|${row.adPlatformId ?? ''}|${row.entryRouteId ?? ''}`}>
                  <td className="truncate px-4 py-3 font-semibold text-ink" title={row.sourceLabel}>
                    {row.sourceLabel}
                  </td>
                  <td className="truncate px-4 py-3 text-ink-secondary" title={row.source === 'manual' ? '手入力' : platforms.find((item) => item.id === row.adPlatformId)?.displayName ?? '—'}>{row.source === 'manual' ? '手入力' : platforms.find((item) => item.id === row.adPlatformId) ? platformLabel(platforms.find((item) => item.id === row.adPlatformId)!) : '—'}</td>
                  <td className="px-4 py-3">{row.entryRouteId ? <Button variant="secondary" href={`/inflow-links/detail?id=${encodeURIComponent(row.entryRouteId)}`}>リンクを見る</Button> : '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{formatCostTotals(row.totals)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">
                    {row.friendAdds == null ? '—' : `${formatNumber(row.friendAdds)}人`}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">
                    {row.costPerFriendMinor == null ? '—' : formatMinor(row.costPerFriendMinor, row.totals[0]?.currency ?? 'JPY')}
                  </td>
                  <td className="px-4 py-3 text-ink-faint" title={row.source === 'manual' ? '手入力' : `最終 ${shortDateTime(row.lastImportedAt)}`}>
                    <Chip tone={row.source === 'manual' ? 'neutral' : 'ok'}>{row.source === 'manual' ? '手入力' : '自動'}</Chip>
                    <span className="sr-only">{shortDateTime(row.lastImportedAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/*
          R275: 手で入れた費用は1行ずつ出す。間違えて入れた分は理由を付けて
          取消せる。取消すと集計から外れるが行と理由は残る。
        */}
        {manualEntries.length > 0 && (
          <div className="border-t border-hairline px-4 py-3">
            <h4 className="text-xs font-bold text-ink-secondary">手で入れた費用</h4>
            <ul className="mt-2 divide-y divide-hairline">
              {manualEntries.map((entry) => {
                const cancelled = entry.cancelledAt != null
                return (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold ${cancelled ? 'text-ink-faint line-through' : 'text-ink'}`}>
                        {entry.day} ／ {entry.sourceLabel} ／ {formatMinor(entry.amountMinor, entry.currency)}
                      </p>
                      {cancelled ? (
                        <p className="mt-0.5 text-xs text-ink-faint">
                          取り消し済み（{entry.cancelReason ?? '理由の記録なし'}）— 集計には入りません
                        </p>
                      ) : null}
                    </div>
                    {!cancelled && canManage ? (
                      <div className="relative">
                        <MoreAction label={`${entry.sourceLabel}の費用の操作`} onClick={() => setManualMenuId(manualMenuId === entry.id ? null : entry.id)} />
                        <ActionMenu open={manualMenuId === entry.id} onClose={() => setManualMenuId(null)} items={[{ id: 'cancel', label: '取り消す', onSelect: () => { setManualMenuId(null); openCancelDialog(entry) } }]} />
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </section>

      <Dialog
        open={manualOpen}
        title="広告費を手で入れる"
        designNode="ZxKL5"
        description="媒体から取り込めない分（チラシや看板など）を日ごとに記録します。同じ流入元・同じ日に入れ直すと上書きになります。"
        confirmLabel="記録する"
        busy={manualBusy}
        error={manualError}
        onConfirm={() => void submitManualEntry()}
        onCancel={() => { if (!manualBusy) setManualOpen(false) }}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-secondary" htmlFor="ad-cost-label">流入元の名前</label>
            <TextField
              id="ad-cost-label"
              value={manualLabel}
              onChange={(event) => setManualLabel(event.target.value)}
              placeholder="例: チラシ"
              maxLength={100}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-secondary" htmlFor="ad-cost-route">計測リンク（分かれば）</label>
            <Select
              id="ad-cost-route"
              aria-label="計測リンク"
              value={manualRouteId}
              onChange={(value) => {
                setManualRouteId(value)
                const route = entryRoutes.find((item) => item.id === value)
                if (route && !manualLabel.trim()) setManualLabel(route.name)
              }}
              options={[
                { value: '', label: '結びつけない' },
                ...entryRoutes.map((route) => ({ value: route.id, label: route.name })),
              ]}
            />
            <p className="mt-1 text-xs text-ink-faint">結びつけると友だち追加の人数で「1人あたり」が出ます。</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-secondary" htmlFor="ad-cost-day">費用の日付</label>
            <DateField id="ad-cost-day" value={manualDay} onChange={setManualDay} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-secondary" htmlFor="ad-cost-amount">費用（円）</label>
            <TextField
              id="ad-cost-amount"
              inputMode="numeric"
              value={manualAmount}
              onChange={(event) => setManualAmount(event.target.value)}
              placeholder="例: 20000"
            />
          </div>
        </div>
      </Dialog>

      <Dialog
        open={cancelTarget !== null}
        title="この費用を取り消す"
        description="取り消すと集計と「1人あたり」から外れます。記録そのものは残り、取り消した理由と日時が履歴に残ります。同じ流入元・同じ日に入れ直すと新しい記録として戻ります。"
        confirmLabel="取り消す"
        busy={cancelBusy}
        error={cancelError}
        onConfirm={() => void submitCancel()}
        onCancel={() => { if (!cancelBusy) setCancelTarget(null) }}
      >
        {cancelTarget ? (
          <div className="space-y-4">
            <p className="text-xs text-ink-secondary">
              対象: <strong>{cancelTarget.day} ／ {cancelTarget.sourceLabel} ／ {formatMinor(cancelTarget.amountMinor, cancelTarget.currency)}</strong>
            </p>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-secondary" htmlFor="ad-cost-cancel-reason">取り消す理由（必須）</label>
              <TextField
                id="ad-cost-cancel-reason"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="例: 金額を間違えた"
                maxLength={200}
              />
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}

function Metric({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return <KpiCard title={label} value={value} unit="件" detail={detail} />
}
