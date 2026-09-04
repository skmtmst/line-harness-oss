'use client'

import SelectField from '@/components/shared/select-field'
import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ApiResponse, LineAccount } from '@line-crm/shared'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import PageHeader from '@/components/shared/page-header'
import { api, type DashboardOverview } from '@/lib/api'
import { formatOperationDate, monthlyQuotaStatus, type OperationSeverity } from '@/lib/operation-status'
import ReleaseLogPanel from '@/components/emergency/release-log-panel'
import { apiCheckDetail } from './api-check-detail'
import { operationImpactText, type EmergencyStopTarget } from '@/lib/operation-impact'
import type { OperationImpactPreview } from '@/lib/api'

const TABS = [
  { key: 'health', label: '健全性チェック' },
  { key: 'control', label: '緊急コントロール' },
  { key: 'history', label: '更新履歴' },
]

const SNAPSHOT_KEY = 'nen_emergency_snapshot_v1'
const OPERATION_HISTORY_KEY = 'nen_operation_history_v1'

type StopTarget = 'broadcasts' | 'scenarios' | 'reminders' | 'automations'

/*
  画面の並びと、口が返す名前の対応。

  画面は `broadcasts`、口は `broadcast_dispatch` と呼ぶ。**どちらかに寄せない。**
  画面の名前を口に合わせると運用者向けの文が内部語になり、口を画面に合わせると
  ほかの口（停止・復旧）とずれる。ここで1か所だけ橋を架ける。
*/
const IMPACT_KEY: Record<StopTarget, EmergencyStopTarget> = {
  broadcasts: 'broadcast_dispatch',
  scenarios: 'scenario_dispatch',
  reminders: 'reminder_dispatch',
  automations: 'automation_actions',
}
type ConfirmMode = 'stop' | 'restore' | null

interface EmergencySnapshot {
  id: string
  stoppedAt: string
  accountId: string | null
  accountName: string
  reason: string
  broadcasts: Array<{ id: string; scheduledAt: string | null }>
  scenarios: string[]
  reminders: string[]
  automations: string[]
}

interface OperationHistoryEntry {
  id: string
  occurredAt: string
  kind: 'stop' | 'restore'
  title: string
  detail: string
  status: 'success' | 'partial' | 'failed'
}

interface UpdateHistoryRow {
  id: string
  started_at: number
  completed_at: number | null
  from_version: string
  to_version: string
  status: string
  error: string | null
}

type HealthCheckId = 'line' | 'quota' | 'api' | 'webhook' | 'delivery' | 'friends'

interface HealthCheckItem {
  id: HealthCheckId
  label: string
  detail: string
  severity: OperationSeverity
  icon: string
}

const CHECK_DEFINITIONS: Array<Pick<HealthCheckItem, 'id' | 'label' | 'icon'>> = [
  { id: 'line', label: 'LINE接続', icon: 'L' },
  { id: 'quota', label: '月間配信数', icon: '↗' },
  { id: 'api', label: 'API・外部連携', icon: '↔' },
  { id: 'webhook', label: 'Webhook', icon: 'W' },
  { id: 'delivery', label: '配信処理', icon: '▷' },
  { id: 'friends', label: '友だち変化', icon: '人' },
]

const severityStyle: Record<OperationSeverity, { label: string; badge: string; panel: string }> = {
  normal: { label: '正常', badge: 'bg-emerald-100 text-emerald-700', panel: 'border-emerald-200 bg-emerald-50' },
  warning: { label: '注意', badge: 'bg-amber-100 text-amber-800', panel: 'border-amber-200 bg-amber-50' },
  danger: { label: 'エラー', badge: 'bg-red-100 text-red-700', panel: 'border-red-200 bg-red-50' },
  unknown: { label: '未確認', badge: 'bg-gray-100 text-gray-600', panel: 'border-gray-200 bg-gray-50' },
}

function readSnapshot(): EmergencySnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    return raw ? (JSON.parse(raw) as EmergencySnapshot) : null
  } catch {
    return null
  }
}

function readOperationHistory(): OperationHistoryEntry[] {
  try {
    const raw = localStorage.getItem(OPERATION_HISTORY_KEY)
    return raw ? (JSON.parse(raw) as OperationHistoryEntry[]) : []
  } catch {
    return []
  }
}

function addOperationHistory(entry: OperationHistoryEntry): void {
  localStorage.setItem(OPERATION_HISTORY_KEY, JSON.stringify([entry, ...readOperationHistory()].slice(0, 100)))
  window.dispatchEvent(new Event('nen-operation-history-updated'))
}

function StatusPill({ severity }: { severity: OperationSeverity }) {
  const style = severityStyle[severity]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${style.badge}`}>{style.label}</span>
}

async function apiData<T>(request: Promise<ApiResponse<T>>): Promise<T> {
  const response = await request
  if (!response.success) throw new Error(response.error)
  return response.data
}

function mostSevere(items: HealthCheckItem[]): OperationSeverity {
  if (items.some((item) => item.severity === 'danger')) return 'danger'
  if (items.some((item) => item.severity === 'warning')) return 'warning'
  if (items.some((item) => item.severity === 'unknown')) return 'unknown'
  return 'normal'
}

function SummaryCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border-hairline rounded-card border bg-white p-4">
      <p className="text-ink-faint text-[11px] font-semibold">{label}</p>
      <p className="text-ink mt-1 text-base font-bold">{value}</p>
      <p className="text-ink-faint mt-1 text-[10px]">{note}</p>
    </div>
  )
}

/**
 * 運用状態の見出し。
 *
 * **画面名はトップバーが出すので、本文には出さない。**
 * 以前はここに `<h1>運用状態</h1>` を直接書いていて、トップバーと合わせて
 * 同じ言葉が2回見えていた。共通 `PageHeader` は題を `sr-only` で持つ。
 */
function OperationPageHeader({ description, action }: { description: string; action?: ReactNode }) {
  return (
    <PageHeader
      className="mb-6"
      breadcrumb={[{ label: '設定' }, { label: '運用状態' }]}
      title="運用状態"
      description={description}
      actions={action}
    />
  )
}

function HealthPanel({ onSeverity }: { onSeverity: (severity: OperationSeverity) => void }) {
  const [checks, setChecks] = useState<HealthCheckItem[]>(() =>
    CHECK_DEFINITIONS.map((item) => ({ ...item, detail: '確認しています…', severity: 'unknown' })),
  )
  const [loading, setLoading] = useState(true)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const dashboardRequest = apiData(api.dashboard.organizationOverview({ period: 'today' }))
    const lineRequest = apiData(api.health.accounts()).then(async (accounts) => {
      const activeAccounts = accounts.filter((account) => account.isActive)
      const health = await Promise.all(
        activeAccounts.map((account) => apiData(api.health.getHealth(account.id))),
      )
      return { activeAccounts, health }
    })
    const apiRequest = Promise.all([
      apiData(api.system.health()),
      apiData(api.ecCommerce.overview()),
    ])
    const webhookRequest = apiData(api.health.accounts()).then(async (accounts) => {
      const visibleAccountIds = accounts.filter((account) => account.isActive).map((account) => account.id)
      const rows = await Promise.all(visibleAccountIds.map(async (lineAccountId) => Promise.all([
        apiData(api.webhooks.incoming.list(lineAccountId)),
        apiData(api.webhooks.outgoing.list(lineAccountId)),
      ])))
      return [rows.flatMap(([incoming]) => incoming), rows.flatMap(([, outgoing]) => outgoing)] as const
    })
    const deliveryRequest = apiData(api.broadcasts.list())

    const [dashboardResult, lineResult, apiResult, webhookResult, deliveryResult] =
      await Promise.allSettled([
        dashboardRequest,
        lineRequest,
        apiRequest,
        webhookRequest,
        deliveryRequest,
      ])

    const nextChecks: HealthCheckItem[] = []

    if (lineResult.status === 'fulfilled') {
      const { activeAccounts, health } = lineResult.value
      const risks = health.map((item) => item.riskLevel)
      const lineSeverity: OperationSeverity = activeAccounts.length === 0
        ? 'unknown'
        : risks.some((risk) => risk === 'danger')
          ? 'danger'
          : risks.some((risk) => risk === 'warning')
            ? 'warning'
            : risks.some((risk) => risk !== 'normal')
              ? 'unknown'
              : 'normal'
      /*
        **バッジと本文で違うことを言わない。**

        `lineSeverity` は、`normal`／`warning`／`danger` のどれでもない危険度が
        1つでもあると `unknown`（＝未確認）に落ちる。ところが本文は
        「アカウントが0件かどうか」だけで分けていたので、判定できなかったときにも
        「確認しました」と書いていた。検証環境で
        **本文「確認しました（3アカウント）」・バッジ「未確認」**という
        食い違いが出ている。ほかの2項目（月間配信数・友だち変化）は
        本文もバッジも「取れなかった」で揃っているので、ここだけずれていた。

        判定できなかった件数を本文に出して、バッジと同じことを言わせる。
      */
      const undeterminedCount = risks.filter((risk) =>
        risk !== 'normal' && risk !== 'warning' && risk !== 'danger').length
      nextChecks.push({
        id: 'line',
        label: 'LINE接続',
        icon: 'L',
        severity: lineSeverity,
        detail: activeAccounts.length === 0
          ? '有効なLINEアカウントが登録されていません'
          : undeterminedCount > 0
            ? `${activeAccounts.length}アカウントのうち${undeterminedCount}件は接続状態を判定できませんでした`
            : `LINE APIの認証エラーと接続状態を確認しました（${activeAccounts.length}アカウント）`,
      })
    } else {
      nextChecks.push({ id: 'line', label: 'LINE接続', icon: 'L', severity: 'unknown', detail: 'LINE接続状態を取得できませんでした' })
    }

    if (dashboardResult.status === 'fulfilled') {
      const dashboard = dashboardResult.value as DashboardOverview
      const quota = monthlyQuotaStatus(dashboard.delivery.quotaLimit, dashboard.delivery.quotaUsed)
      const quotaDetail = quota.remaining == null || dashboard.delivery.quotaLimit == null
        ? '配信上限なしとして、今月の配信数を確認しました'
        : `残り${quota.remaining.toLocaleString('ja-JP')}通 / 上限${dashboard.delivery.quotaLimit.toLocaleString('ja-JP')}通（残り${Math.floor(quota.remainingPercent ?? 0)}%）`
      nextChecks.push({ id: 'quota', label: '月間配信数', icon: '↗', severity: quota.severity, detail: quotaDetail })
      const today = dashboard.trend.at(-1)
      nextChecks.push({
        id: 'friends',
        label: '友だち変化',
        icon: '人',
        severity: 'normal',
        detail: today
          ? `直近日の追加${today.added.toLocaleString('ja-JP')}人・ブロック${today.blocked.toLocaleString('ja-JP')}人を確認しました`
          : '友だち数と日次変化を確認しました（変化なし）',
      })
      setCheckedAt(dashboard.generatedAt ?? new Date().toISOString())
    } else {
      nextChecks.push({ id: 'quota', label: '月間配信数', icon: '↗', severity: 'unknown', detail: '月間配信数を取得できませんでした' })
      nextChecks.push({ id: 'friends', label: '友だち変化', icon: '人', severity: 'unknown', detail: '友だちの日次変化を取得できませんでした' })
      setCheckedAt(new Date().toISOString())
    }

    if (apiResult.status === 'fulfilled') {
      const [, commerce] = apiResult.value
      nextChecks.push({
        id: 'api',
        label: 'API・外部連携',
        icon: '↔',
        severity: 'normal',
        detail: apiCheckDetail((commerce as { last24h?: unknown } | null)?.last24h),
      })
    } else {
      nextChecks.push({ id: 'api', label: 'API・外部連携', icon: '↔', severity: 'unknown', detail: '管理APIまたはEC連携データを取得できませんでした' })
    }

    if (webhookResult.status === 'fulfilled') {
      const [incoming, outgoing] = webhookResult.value
      const invalidSecrets = [...incoming, ...outgoing].filter((item) => item.isActive && !item.hasSecret).length
      const failedOutgoing = outgoing.filter((item) => item.isActive && (item.consecutiveFailures ?? 0) > 0)
      const webhookSeverity: OperationSeverity = invalidSecrets > 0 ? 'danger' : failedOutgoing.length > 0 ? 'warning' : 'normal'
      const webhookDetail = invalidSecrets > 0
        ? `有効なWebhookの署名設定不足が${invalidSecrets}件あります`
        : failedOutgoing.length > 0
          ? `送信に連続失敗しているWebhookが${failedOutgoing.length}件あります`
          : `受信${incoming.length}件・送信${outgoing.length}件の設定と送信失敗を確認しました`
      nextChecks.push({ id: 'webhook', label: 'Webhook', icon: 'W', severity: webhookSeverity, detail: webhookDetail })
    } else {
      nextChecks.push({ id: 'webhook', label: 'Webhook', icon: 'W', severity: 'unknown', detail: 'Webhook設定と送信失敗を取得できませんでした' })
    }

    if (deliveryResult.status === 'fulfilled') {
      const scheduled = deliveryResult.value.filter((item) => item.status === 'scheduled').length
      const sending = deliveryResult.value.filter((item) => item.status === 'sending').length
      nextChecks.push({
        id: 'delivery',
        label: '配信処理',
        icon: '▷',
        severity: 'normal',
        detail: `配信処理を確認しました（予約${scheduled}件・送信中${sending}件）`,
      })
    } else {
      nextChecks.push({ id: 'delivery', label: '配信処理', icon: '▷', severity: 'unknown', detail: '配信処理の状態を取得できませんでした' })
    }

    setChecks(CHECK_DEFINITIONS.map((definition) => nextChecks.find((item) => item.id === definition.id) ?? { ...definition, detail: '確認できませんでした', severity: 'unknown' }))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load() }, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [load])

  const displayedSeverity = loading ? 'unknown' : mostSevere(checks)
  const isNormal = displayedSeverity === 'normal'
  const resultTitle = isNormal ? '異常なし' : displayedSeverity === 'warning' ? '注意' : displayedSeverity === 'danger' ? 'エラー' : '確認できない項目があります'
  const resultDescription = isNormal
    ? '6項目を確認し、現在、確認できる異常はありません。'
    : displayedSeverity === 'warning'
      ? '注意が必要な項目があります。チェック結果を確認してください。'
      : displayedSeverity === 'danger'
        ? '対応が必要な項目があります。チェック結果を確認してください。'
        : '取得できない項目があります。時間をおいて再確認してください。'
  const statusIcon = isNormal ? '✓' : '!'
  const statusIconClass = isNormal ? 'text-emerald-700' : displayedSeverity === 'warning' ? 'text-amber-700' : displayedSeverity === 'danger' ? 'text-red-700' : 'text-gray-600'

  useEffect(() => { onSeverity(displayedSeverity) }, [displayedSeverity, onSeverity])

  return (
    <div className="space-y-4" data-design="V3 Health">
      <div className={`rounded-card flex flex-wrap items-center gap-3 border px-4 py-3 ${severityStyle[displayedSeverity].panel}`}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold ${statusIconClass}`}>{statusIcon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-gray-900">{resultTitle}</p>
          <p className="mt-0.5 text-xs text-gray-600">{loading ? '確認しています…' : resultDescription}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryCard label="全体の状態" value={resultTitle} note={loading ? '確認中' : '最新結果'} />
        <SummaryCard label="最後の確認" value={formatOperationDate(checkedAt)} note="5分ごとに自動確認" />
        <SummaryCard label="緊急停止状態" value="通常運用" note="停止なし" />
      </div>
      <section className="border-hairline rounded-card overflow-hidden border bg-white">
        <div className="border-hairline flex items-start justify-between gap-3 border-b px-4 py-3"><div><h2 className="text-base font-bold text-gray-900">チェック結果</h2><p className="mt-0.5 text-xs text-gray-500">6項目を常に表示し、確認内容と最新結果を示します</p></div><span className="rounded-pill bg-info-bg text-info px-2 py-1 text-[10px] font-bold">5分ごと</span></div>
        <div className="divide-y divide-gray-100">
          {checks.map((check) => {
            const style = severityStyle[check.severity]
            const iconClass = check.severity === 'normal' ? 'bg-emerald-100 text-emerald-700' : check.severity === 'warning' ? 'bg-amber-100 text-amber-800' : check.severity === 'danger' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
            return (
              <div key={check.id} className={`flex items-center gap-3 px-4 py-4 ${check.severity === 'normal' ? 'bg-emerald-50/50' : style.panel}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${iconClass}`}>{check.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-900">{check.label}</p>
                  <p className="mt-1 text-xs text-gray-600">{check.detail}</p>
                </div>
                <StatusPill severity={check.severity} />
              </div>
            )
          })}
        </div>
        {!isNormal && <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"><p className="text-xs text-gray-600">配信予定を確認し、必要な場合だけ配信を停止してください。</p><Link href="/emergency?tab=control" className="rounded-control inline-flex min-h-9 items-center bg-red-600 px-3 text-xs font-bold text-white hover:bg-red-700">緊急停止を確認</Link></div>}
      </section>
    </div>
  )
}

function EmergencyControlPanel({ accounts }: { accounts: LineAccount[] }) {
  const [targetAccountId, setTargetAccountId] = useState('all')
  const [targets, setTargets] = useState<Record<StopTarget, boolean>>({ broadcasts: true, scenarios: true, reminders: true, automations: true })
  const [reason, setReason] = useState('障害対応')
  const [reasonDetail, setReasonDetail] = useState('')
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null)
  const [confirmWord, setConfirmWord] = useState('')
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null)
  const [snapshot, setSnapshot] = useState<EmergencySnapshot | null>(null)
  useEffect(() => setSnapshot(readSnapshot()), [])

  /*
    **止める前に、何本止まって何人に関わるかを実測で出す。**

    以前はここに数が1つも出ず、取り消せない操作を「予約中の一斉配信」という
    名前だけで押していた。設計 `b3HfZ` は行ごとに件数と人数を出す。

    数は口（`GET /api/operations/control/preview`）が返した実測だけを使う。
    **取れないときに0人と書かない**——`operationImpactText` が `—人` を出す。
  */
  const [impact, setImpact] = useState<OperationImpactPreview | null>(null)
  const [impactFailed, setImpactFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    setImpact(null); setImpactFailed(false)
    const accountId = targetAccountId === 'all' ? null : targetAccountId
    api.operations.preview(accountId)
      .then((response) => {
        if (cancelled) return
        if (response.success) setImpact(response.data.impact)
        else setImpactFailed(true)
      })
      .catch(() => { if (!cancelled) setImpactFailed(true) })
    return () => { cancelled = true }
  }, [targetAccountId])

  const selectedTargets = (Object.keys(targets) as StopTarget[]).filter((key) => targets[key])
  const accountName = targetAccountId === 'all' ? 'すべてのアカウント' : accounts.find((account) => account.id === targetAccountId)?.name ?? '選択したアカウント'
  const fullReason = reasonDetail.trim() ? `${reason}: ${reasonDetail.trim()}` : reason
  const targetLabels: Record<StopTarget, { label: string; note: string }> = {
    broadcasts: { label: '予約中の一斉配信', note: '予約を下書きに戻します' },
    scenarios: { label: 'シナリオ配信', note: '稼働中のものを止めます' },
    reminders: { label: 'リマインダ', note: '稼働中のものを止めます' },
    automations: { label: '自動処理', note: '配信につながる自動処理を止めます' },
  }

  const openStopConfirm = () => {
    if (selectedTargets.length === 0) { setMessage({ tone: 'warning', text: '停止する配信を1つ以上選んでください。' }); return }
    setConfirmWord(''); setConfirmMode('stop')
  }

  const runStop = async () => {
    if (confirmWord !== '停止') return
    setRunning(true); setMessage(null)
    const accountId = targetAccountId === 'all' ? undefined : targetAccountId
    const nextSnapshot: EmergencySnapshot = { id: crypto.randomUUID(), stoppedAt: new Date().toISOString(), accountId: accountId ?? null, accountName, reason: fullReason, broadcasts: [], scenarios: [], reminders: [], automations: [] }
    let attempted = 0; let succeeded = 0
    const apply = async (jobs: Array<Promise<unknown>>) => { attempted += jobs.length; const results = await Promise.allSettled(jobs); succeeded += results.filter((result) => result.status === 'fulfilled').length }
    try {
      if (targets.broadcasts) { const response = await api.broadcasts.list(accountId ? { accountId } : undefined); if (!response.success) throw new Error(response.error); const active = response.data.filter((item) => item.status === 'scheduled'); nextSnapshot.broadcasts = active.map((item) => ({ id: item.id, scheduledAt: item.scheduledAt })); await apply(active.map((item) => api.broadcasts.update(item.id, { scheduledAt: null }))) }
      if (targets.scenarios) { const response = await api.scenarios.list(accountId ? { accountId } : undefined); if (!response.success) throw new Error(response.error); const active = response.data.filter((item) => item.isActive); nextSnapshot.scenarios = active.map((item) => item.id); await apply(active.map((item) => api.scenarios.update(item.id, { isActive: false }))) }
      if (targets.reminders) { const response = await api.reminders.list(accountId ? { accountId } : undefined); if (!response.success) throw new Error(response.error); const active = response.data.filter((item) => item.isActive); nextSnapshot.reminders = active.map((item) => item.id); await apply(active.map((item) => api.reminders.update(item.id, { isActive: false }))) }
      if (targets.automations) { const response = await api.automations.list(accountId ? { accountId } : undefined); if (!response.success) throw new Error(response.error); const active = response.data.filter((item) => item.isActive); nextSnapshot.automations = active.map((item) => item.id); await apply(active.map((item) => api.automations.update(item.id, { isActive: false }))) }
      const status = succeeded === attempted ? 'success' : succeeded > 0 ? 'partial' : 'failed'
      if (succeeded > 0 || attempted === 0) { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(nextSnapshot)); setSnapshot(nextSnapshot) }
      addOperationHistory({ id: crypto.randomUUID(), occurredAt: new Date().toISOString(), kind: 'stop', title: '緊急停止', detail: `${accountName} / ${fullReason} / ${succeeded}件停止${attempted !== succeeded ? `（${attempted - succeeded}件失敗）` : ''}`, status })
      setMessage({ tone: status === 'success' ? 'success' : status === 'partial' ? 'warning' : 'danger', text: attempted === 0 ? '停止対象はありませんでした。' : `${succeeded}/${attempted}件を停止しました。` })
      setConfirmMode(null); setConfirmWord('')
    } catch {
      addOperationHistory({ id: crypto.randomUUID(), occurredAt: new Date().toISOString(), kind: 'stop', title: '緊急停止', detail: `${accountName} / ${fullReason} / 読み込みまたは実行に失敗`, status: succeeded > 0 ? 'partial' : 'failed' })
      setMessage({ tone: succeeded > 0 ? 'warning' : 'danger', text: '一部またはすべての停止に失敗しました。更新履歴を確認してください。' }); setConfirmMode(null)
    } finally { setRunning(false) }
  }

  const runRestore = async () => {
    if (!snapshot || confirmWord !== '復旧') return
    setRunning(true); setMessage(null)
    let attempted = 0; let succeeded = 0
    const apply = async (jobs: Array<Promise<unknown>>) => { attempted += jobs.length; const results = await Promise.allSettled(jobs); succeeded += results.filter((result) => result.status === 'fulfilled').length }
    try {
      const restorableBroadcasts = snapshot.broadcasts.filter((item) => item.scheduledAt && Date.parse(item.scheduledAt) > Date.now())
      const expiredBroadcasts = snapshot.broadcasts.length - restorableBroadcasts.length
      await apply(restorableBroadcasts.map((item) => api.broadcasts.update(item.id, { scheduledAt: item.scheduledAt })))
      await apply(snapshot.scenarios.map((id) => api.scenarios.update(id, { isActive: true })))
      await apply(snapshot.reminders.map((id) => api.reminders.update(id, { isActive: true })))
      await apply(snapshot.automations.map((id) => api.automations.update(id, { isActive: true })))
      const status = succeeded === attempted ? 'success' : succeeded > 0 ? 'partial' : 'failed'
      if (status === 'success') { localStorage.removeItem(SNAPSHOT_KEY); setSnapshot(null) }
      addOperationHistory({ id: crypto.randomUUID(), occurredAt: new Date().toISOString(), kind: 'restore', title: '配信を復旧', detail: `${snapshot.accountName} / ${succeeded}件復旧${expiredBroadcasts > 0 ? ` / 期限を過ぎた予約${expiredBroadcasts}件は下書きのまま` : ''}`, status })
      setMessage({ tone: status === 'success' ? (expiredBroadcasts > 0 ? 'warning' : 'success') : status === 'partial' ? 'warning' : 'danger', text: `${succeeded}/${attempted}件を復旧しました。${expiredBroadcasts > 0 ? ` 期限を過ぎた予約${expiredBroadcasts}件は安全のため再開していません。` : ''}` }); setConfirmMode(null); setConfirmWord('')
    } catch { setMessage({ tone: 'danger', text: '復旧に失敗しました。更新履歴を確認してください。' }); setConfirmMode(null) } finally { setRunning(false) }
  }

  return (
    <div className="space-y-4" data-design="V3 Emergency control">
      <div className={`rounded-card border px-4 py-3 ${snapshot ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}><p className={`text-base font-bold ${snapshot ? 'text-red-800' : 'text-emerald-800'}`}>{snapshot ? '緊急停止中' : '通常運用中'}</p><p className="mt-1 text-xs text-gray-600">{snapshot ? `${snapshot.accountName}・${formatOperationDate(snapshot.stoppedAt)}から停止中` : '緊急停止は実行されていません。'}</p></div>
      {message && <div className={`rounded-control px-4 py-3 text-xs font-bold ${message.tone === 'success' ? 'bg-emerald-50 text-emerald-800' : message.tone === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800'}`}>{message.text}</div>}
      <section className={`border-hairline rounded-card border bg-white p-4 ${snapshot ? 'pointer-events-none opacity-50' : ''}`}>
        <div><h2 className="text-base font-bold text-gray-900">緊急停止</h2><p className="mt-1 text-xs text-gray-500">停止対象を実行直前に取得します。</p></div>
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2"><div><label className="text-xs font-bold text-gray-700" htmlFor="emergency-account">対象アカウント</label><select id="emergency-account" value={targetAccountId} onChange={(event) => setTargetAccountId(event.target.value)} className="border-hairline rounded-control mt-2 min-h-11 w-full border bg-white px-3 text-sm"><option value="all">すべてのアカウント</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div><div><label className="text-xs font-bold text-gray-700" htmlFor="emergency-reason">停止理由</label><select id="emergency-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="border-hairline rounded-control mt-2 min-h-11 w-full border bg-white px-3 text-sm"><option>障害対応</option><option>誤配信の防止</option><option>アカウント異常</option><option>メンテナンス</option><option>その他</option></select></div></div>
        <div className="border-hairline mt-5 overflow-hidden rounded-control border">{(Object.keys(targetLabels) as StopTarget[]).map((key) => <label key={key} className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0 hover:bg-gray-50"><input type="checkbox" checked={targets[key]} onChange={(event) => setTargets((current) => ({ ...current, [key]: event.target.checked }))} className="h-4 w-4 accent-red-600" /><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-gray-900">{targetLabels[key].label}</span><span className="block text-xs text-gray-500">{targetLabels[key].note}</span></span><span className="max-w-sm shrink-0 text-right text-xs font-bold text-ink-secondary">{impactFailed ? '影響を確認できません' : operationImpactText(IMPACT_KEY[key], impact)}</span></label>)}</div>
        <div className="mt-5"><label className="text-xs font-bold text-gray-700" htmlFor="emergency-detail">補足（任意）</label><textarea id="emergency-detail" value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} rows={2} placeholder="発生していることを短く入力" className="border-hairline rounded-control mt-2 w-full border px-3 py-2 text-sm" /></div>
        <div className="mt-5 flex justify-end"><button onClick={openStopConfirm} disabled={running || Boolean(snapshot)} className="rounded-control min-h-10 bg-red-600 px-4 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50">緊急停止する</button></div>
      </section>
      {snapshot && <section className="rounded-card border border-blue-200 bg-blue-50 p-4"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-base font-bold text-blue-900">復旧</h2><p className="mt-1 text-xs text-blue-800">期限を過ぎた予約配信は安全のため再開しません。</p></div><button onClick={() => { setConfirmWord(''); setConfirmMode('restore') }} disabled={running} className="rounded-control border border-blue-300 bg-white px-4 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100">復旧する</button></div></section>}
      {confirmMode && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="emergency-confirm-title"><div className="rounded-card w-full max-w-lg bg-white p-6 shadow-2xl"><h2 id="emergency-confirm-title" className="text-lg font-bold text-gray-900">{confirmMode === 'stop' ? '緊急停止の最終確認' : '復旧の最終確認'}</h2><div className={`mt-4 rounded-control p-4 text-sm ${confirmMode === 'stop' ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-900'}`}>{confirmMode === 'stop' ? <><p className="font-bold">{accountName}</p><div className="mt-3 space-y-2">{selectedTargets.map((key) => <div key={key} className="flex items-start justify-between gap-3"><span>{targetLabels[key].label}</span><strong className="text-right">{impactFailed ? '影響を確認できません' : operationImpactText(IMPACT_KEY[key], impact)}</strong></div>)}</div><p className="mt-3">理由：{fullReason}</p><p className="mt-2 font-bold">停止前にすでにLINEへ渡したものは取り消せません。</p></> : <><p className="font-bold">{snapshot?.accountName}</p><p className="mt-1">停止前に動いていた配信を再開します。</p></>}</div><label className="mt-4 block text-sm font-bold text-gray-800" htmlFor="emergency-confirm-word">確認のため「{confirmMode === 'stop' ? '停止' : '復旧'}」と入力</label><input id="emergency-confirm-word" value={confirmWord} onChange={(event) => setConfirmWord(event.target.value)} autoFocus className="border-hairline rounded-control mt-2 min-h-11 w-full border px-3 text-sm" /><div className="mt-5 flex justify-end gap-2"><button onClick={() => { setConfirmMode(null); setConfirmWord('') }} disabled={running} className="rounded-control border-hairline min-h-11 border px-4 text-sm font-bold text-gray-700">キャンセル</button><button onClick={() => void (confirmMode === 'stop' ? runStop() : runRestore())} disabled={running || confirmWord !== (confirmMode === 'stop' ? '停止' : '復旧')} className={`rounded-control min-h-11 px-4 text-sm font-bold text-white disabled:opacity-40 ${confirmMode === 'stop' ? 'bg-red-600' : 'bg-blue-700'}`}>{running ? '実行中...' : '実行する'}</button></div></div></div>}
    </div>
  )
}

function HistoryPanel() {
  const [operations, setOperations] = useState<OperationHistoryEntry[]>([])
  const [updates, setUpdates] = useState<UpdateHistoryRow[]>([])
  const [updateState, setUpdateState] = useState<'loading' | 'ready' | 'unconfigured' | 'error'>('loading')
  const [filter, setFilter] = useState<'all' | 'operation' | 'update'>('all')
  useEffect(() => { const refresh = () => setOperations(readOperationHistory()); refresh(); window.addEventListener('nen-operation-history-updated', refresh); return () => window.removeEventListener('nen-operation-history-updated', refresh) }, [])
  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL; const adminKey = process.env.NEXT_PUBLIC_ADMIN_API_KEY
    if (!apiUrl || !adminKey) { setUpdateState('unconfigured'); return }
    fetch(`${apiUrl}/admin/update/history`, { headers: { 'x-admin-api-key': adminKey } }).then(async (response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<{ history: UpdateHistoryRow[] }> }).then((body) => { setUpdates(body.history); setUpdateState('ready') }).catch(() => setUpdateState('error'))
  }, [])
  const entries = [...operations.map((item) => ({ id: `operation-${item.id}`, occurredAt: item.occurredAt, type: 'operation' as const, title: item.title, detail: item.detail, status: item.status })), ...updates.map((item) => ({ id: `update-${item.id}`, occurredAt: new Date(item.started_at).toISOString(), type: 'update' as const, title: `システム更新 ${item.from_version} → ${item.to_version}`, detail: item.error ? '更新に失敗しました' : 'システム更新の記録', status: item.status }))].filter((item) => filter === 'all' || item.type === filter).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
  return <div className="space-y-4" data-design="V3 Update history"><div className="rounded-card border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-900">変更内容はリリースごとに記録しています。緊急操作とシステム更新は自動で記録されます。</div><div className="grid grid-cols-1 gap-3 md:grid-cols-3"><SummaryCard label="緊急操作" value={`${operations.length}件`} note="この端末に保存された履歴" /><SummaryCard label="システム更新" value={updateState === 'ready' ? `${updates.length}件` : '—'} note={updateState === 'unconfigured' ? '自動更新は未構成' : '取得できた更新履歴'} /><SummaryCard label="最後の緊急操作" value={formatOperationDate(operations[0]?.occurredAt ?? null)} note={operations[0]?.title ?? 'まだありません'} /></div><ReleaseLogPanel /><div className="border-hairline rounded-card overflow-hidden border bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3"><h2 className="text-base font-bold text-gray-900">履歴</h2><SelectField value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} options={[{ value: "all", label: "すべて" }, { value: "operation", label: "緊急操作" }, { value: "update", label: "システム更新" }]} className="border-hairline rounded-control min-h-9 border bg-white px-3 text-xs" /></div>{updateState === 'error' && <p className="bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">システム更新の履歴を取得できませんでした。</p>}{entries.length === 0 ? <p className="p-8 text-center text-xs text-gray-500">履歴はまだありません。</p> : <div className="divide-y divide-gray-100">{entries.map((entry) => <div key={entry.id} className="grid gap-2 px-4 py-4 md:grid-cols-[150px_120px_1fr_auto] md:items-center"><time className="text-xs text-gray-500">{formatOperationDate(entry.occurredAt)}</time><span className="text-xs font-bold text-gray-600">{entry.type === 'operation' ? '緊急操作' : 'システム更新'}</span><div><p className="text-sm font-bold text-gray-900">{entry.title}</p><p className="mt-1 text-xs text-gray-500">{entry.detail}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${entry.status === 'success' ? 'bg-emerald-100 text-emerald-700' : entry.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{entry.status === 'success' ? '完了' : entry.status === 'failed' ? '失敗' : entry.status === 'partial' ? '一部失敗' : entry.status}</span></div>)}</div>}</div></div>
}

function EmergencyPageInner() {
  const tab = useMergedTab(TABS)
  const [severity, setSeverity] = useState<OperationSeverity>('unknown')
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  useEffect(() => { api.health.accounts().then((response) => { if (response.success) setAccounts(response.data) }).catch(() => undefined) }, [])
  const description = tab === 'health'
    ? '問題がないか自動で確認し、エラーがあれば内容と次の行動を表示します。'
    : tab === 'control'
      ? '止める配信を選び、理由を入力して緊急停止します。'
      : 'エラー、緊急停止、システム更新、設定変更を時間順に確認できます。'
  const headerAction = tab === 'health'
    ? <div className="flex flex-wrap gap-2"><button type="button" onClick={() => window.location.reload()} className="rounded-control min-h-9 bg-accent-deep px-3 text-xs font-bold text-white">↻ チェックを今すぐ実行</button><Link href="/emergency?tab=control" className="rounded-control inline-flex min-h-9 items-center bg-red-600 px-3 text-xs font-bold text-white">⊗ 配信をすべて緊急停止</Link></div>
    : severity === 'danger' || severity === 'warning' ? <StatusPill severity={severity} /> : undefined
  return <div><OperationPageHeader description={description} action={headerAction} /><MergedTabs basePath="/emergency" tabs={TABS} active={tab} />{tab === 'health' && <HealthPanel onSeverity={setSeverity} />}{tab === 'control' && <EmergencyControlPanel accounts={accounts} />}{tab === 'history' && <HistoryPanel />}</div>
}

export default function EmergencyPage() {
  return <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}><EmergencyPageInner /></Suspense>
}
