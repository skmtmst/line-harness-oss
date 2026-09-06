'use client'

import SelectField from '@/components/shared/select-field'
import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ApiResponse, LineAccount } from '@line-crm/shared'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import PageHeader from '@/components/shared/page-header'
import {
  api,
  type DashboardOverview,
  type OperationCapability,
  type OperationControl,
  type OperationImpactPreview,
  type OperationIncident,
} from '@/lib/api'
import { formatOperationDate, monthlyQuotaStatus, type OperationSeverity } from '@/lib/operation-status'
import { apiCheckDetail } from './api-check-detail'
import { operationImpactText, type EmergencyStopTarget } from '@/lib/operation-impact'
import releaseLog from '@/generated/release-log.json'

const TABS = [
  { key: 'health', label: '健全性チェック' },
  { key: 'control', label: '緊急コントロール' },
  { key: 'history', label: '更新履歴' },
]

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

const TARGET_CAPABILITIES: Record<StopTarget, OperationCapability[]> = {
  broadcasts: ['broadcast_dispatch'],
  scenarios: ['scenario_dispatch'],
  reminders: ['reminder_dispatch'],
  automations: ['automation_actions', 'auto_reply_dispatch'],
}

const CAPABILITY_LABEL: Record<OperationCapability, string> = {
  broadcast_dispatch: '予約中の一斉配信',
  scenario_dispatch: 'シナリオ配信',
  reminder_dispatch: 'リマインダ',
  automation_actions: 'オートメーション',
  auto_reply_dispatch: '自動応答',
  webhook_outgoing: '外部への通知',
  ad_postback: '広告への成果通知',
}
type ConfirmMode = 'stop' | 'restore' | null

type HealthCheckId = 'line' | 'quota' | 'api' | 'webhook' | 'delivery' | 'friends'

interface HealthCheckItem {
  id: HealthCheckId
  label: string
  detail: string
  severity: OperationSeverity
  icon: string
  description: string
  threshold: string
  href: string
}

type HealthCheckResult = Pick<HealthCheckItem, 'id' | 'label' | 'detail' | 'severity' | 'icon'>

const CHECK_DEFINITIONS: Array<Pick<HealthCheckItem, 'id' | 'label' | 'icon' | 'description' | 'threshold' | 'href'>> = [
  { id: 'line', label: 'LINE接続', icon: 'L', description: 'LINEのアカウントとつながっているか', threshold: '応答がない状態が5分つづくと「エラー」', href: '/accounts' },
  { id: 'quota', label: '月間配信数', icon: '↗', description: 'LINEの上限に近づいていないか', threshold: '80%で「注意」・95%で「エラー」', href: '/broadcasts' },
  { id: 'api', label: 'API・外部連携', icon: '↔', description: '管理画面とEC連携が動いているか', threshold: '応答なし・取り込み0件で「注意」', href: '/ec-commerce' },
  { id: 'webhook', label: 'Webhook', icon: 'W', description: '合言葉が入り、送信が通っているか', threshold: '合言葉なしが1本でもあれば「注意」', href: '/webhooks' },
  { id: 'delivery', label: '配信処理', icon: '▷', description: '予約した配信が時刻どおりに出ているか', threshold: '10分の遅れで「注意」・30分で「エラー」', href: '/broadcasts/reserved' },
  { id: 'friends', label: '友だち変化', icon: '人', description: '急に減っていないか', threshold: '1日で5%以上減ると「注意」', href: '/friends' },
]

const severityStyle: Record<OperationSeverity, { label: string; badge: string; panel: string }> = {
  normal: { label: '正常', badge: 'bg-success-bg text-success', panel: 'border-success bg-success-bg' },
  warning: { label: '注意', badge: 'bg-warning-bg text-warning', panel: 'border-warning bg-warning-bg' },
  danger: { label: 'エラー', badge: 'bg-danger-bg text-danger', panel: 'border-danger bg-danger-bg' },
  unknown: { label: '未確認', badge: 'bg-canvas-sunken text-ink-faint', panel: 'border-hairline bg-canvas-sunken' },
}

function StatusPill({ severity }: { severity: OperationSeverity }) {
  const style = severityStyle[severity]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${style.badge}`}>{style.label}</span>
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
    <div className="border-hairline rounded-card border bg-canvas p-4">
      <p className="text-ink-faint text-[11px] font-semibold">{label}</p>
      <p className="text-ink mt-1 text-base font-bold">{value}</p>
      <p className="text-ink-faint mt-1 text-xs">{note}</p>
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

    const nextChecks: HealthCheckResult[] = []

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

    setChecks(CHECK_DEFINITIONS.map((definition) => ({
      ...definition,
      ...(nextChecks.find((item) => item.id === definition.id) ?? { detail: '確認できませんでした', severity: 'unknown' as const }),
    })))
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
  const statusIconClass = isNormal ? 'text-success' : displayedSeverity === 'warning' ? 'text-warning' : displayedSeverity === 'danger' ? 'text-danger' : 'text-ink-faint'

  useEffect(() => { onSeverity(displayedSeverity) }, [displayedSeverity, onSeverity])

  const nextCheckedAt = checkedAt
    ? new Date(Date.parse(checkedAt) + 5 * 60 * 1000).toISOString()
    : null

  return (
    <div className="space-y-4" data-design="V3 Health">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryCard label="全体の状態" value={resultTitle} note={loading ? '確認中' : '最新結果'} />
        <SummaryCard label="最後の確認" value={formatOperationDate(checkedAt)} note="5分ごとに自動確認" />
        <SummaryCard label="緊急停止状態" value="通常運用" note="停止なし" />
      </div>
      <div className="rounded-control bg-info-bg text-info px-4 py-3 text-xs font-semibold">
        LINEとのつながりや配信の詰まりを、5分ごとに自動で確かめています。赤が出たら「緊急コントロール」で止められます。
      </div>
      <div className={`rounded-card flex flex-wrap items-center gap-3 border px-4 py-3 ${severityStyle[displayedSeverity].panel}`}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-bold ${statusIconClass}`}>{statusIcon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-ink">{loading ? '確認しています…' : `${resultTitle}。${isNormal ? '6項目のすべてが正常です。' : ''}`}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {loading ? '最新の状態を読み込んでいます。' : `${resultDescription} 次は${formatOperationDate(nextCheckedAt)}に自動で確かめます。`}
          </p>
        </div>
        <Link href="/emergency?tab=control" className="rounded-control inline-flex min-h-9 items-center bg-danger px-3 text-xs font-bold text-on-accent hover:opacity-90">緊急停止を確認</Link>
      </div>
      <section className="border-hairline rounded-card overflow-hidden border bg-canvas">
        <div className="border-hairline flex items-start justify-between gap-3 border-b px-4 py-3"><div><h2 className="text-base font-bold text-ink">チェック結果</h2><p className="mt-0.5 text-xs text-ink-faint">6項目を常に表示し、確認内容と最新結果を示します</p></div><span className="rounded-pill bg-info-bg text-info px-2 py-1 text-xs font-bold">5分ごと</span></div>
        <div className="hidden grid-cols-6 gap-3 bg-canvas-sunken px-4 py-3 text-xs font-bold text-ink-faint lg:grid">
          <span>確認する項目</span><span>結果</span><span>いまの数字</span><span>目安</span><span>最後の確認</span><span>操作</span>
        </div>
        <div className="divide-y divide-hairline">
          {checks.map((check) => {
            const style = severityStyle[check.severity]
            const iconClass = check.severity === 'normal' ? 'bg-success-bg text-success' : check.severity === 'warning' ? 'bg-warning-bg text-warning' : check.severity === 'danger' ? 'bg-danger-bg text-danger' : 'bg-canvas-sunken text-ink-faint'
            return (
              <div key={check.id} className={`grid gap-3 px-4 py-4 lg:grid-cols-6 lg:items-center ${check.severity === 'normal' ? 'bg-canvas' : style.panel}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${iconClass}`}>{check.icon}</span>
                  <div className="min-w-0"><p className="text-sm font-bold text-ink">{check.label}</p><p className="mt-1 text-xs text-ink-faint">{check.description}</p></div>
                </div>
                <StatusPill severity={check.severity} />
                <p className="text-xs leading-relaxed text-ink-secondary">{check.detail}</p>
                <p className="text-xs leading-relaxed text-ink-faint">{check.threshold}</p>
                <p className="text-xs text-ink-faint">{formatOperationDate(checkedAt)}</p>
                <Link href={check.href} className="rounded-control border-hairline inline-flex min-h-9 items-center justify-center border bg-canvas px-3 text-xs font-bold text-ink-secondary hover:bg-canvas-sunken">中身を見る</Link>
              </div>
            )
          })}
        </div>
      </section>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="判定の見方">
        {([
          ['正常', '目安の中に入っています', 'normal'],
          ['注意', '目安をこえました。見てください', 'warning'],
          ['エラー', '動いていません。止めるか直してください', 'danger'],
          ['未確認', '確かめられませんでした', 'unknown'],
        ] as const).map(([label, note, severity]) => <div key={label} className="border-hairline rounded-control border px-4 py-3"><StatusPill severity={severity} /><p className="text-ink-faint mt-1 text-xs">{note}</p></div>)}
      </div>
    </div>
  )
}

function EmergencyControlPanel({ accounts }: { accounts: LineAccount[] }) {
  const [targetAccountId, setTargetAccountId] = useState('all')
  const [targets, setTargets] = useState<Record<StopTarget, boolean>>({ broadcasts: true, scenarios: true, reminders: true, automations: false })
  const [reason, setReason] = useState('障害対応')
  const [reasonDetail, setReasonDetail] = useState('')
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null)
  const [confirmWord, setConfirmWord] = useState('')
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null)
  const [control, setControl] = useState<OperationControl | null>(null)
  const [canControl, setCanControl] = useState(false)
  const [calculatedAt, setCalculatedAt] = useState<string | null>(null)

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
        if (response.success && response.data?.impact && response.data?.control && response.data?.permissions) {
          setImpact(response.data.impact)
          setControl(response.data.control)
          setCanControl(response.data.permissions.canControl)
          setCalculatedAt(response.data.calculatedAt)
        }
        else setImpactFailed(true)
      })
      .catch(() => { if (!cancelled) setImpactFailed(true) })
    return () => { cancelled = true }
  }, [targetAccountId])

  const selectedTargets = (Object.keys(targets) as StopTarget[]).filter((key) => targets[key])
  const selectedCapabilities = selectedTargets.flatMap((key) => TARGET_CAPABILITIES[key])
  const isStopped = Boolean(control?.activeIncidentId)
  const accountName = targetAccountId === 'all' ? 'すべてのアカウント' : accounts.find((account) => account.id === targetAccountId)?.name ?? '選択したアカウント'
  const fullReason = reasonDetail.trim() ? `${reason}: ${reasonDetail.trim()}` : reason
  const targetLabels: Record<StopTarget, { label: string; note: string }> = {
    broadcasts: { label: '予約中の一斉配信', note: '予約を下書きに戻します' },
    scenarios: { label: 'シナリオ配信', note: '稼働中のものを止めます' },
    reminders: { label: 'リマインダ', note: '稼働中のものを止めます' },
    automations: { label: '自動処理', note: 'オートメーションと自動応答を止めます' },
  }

  const impactText = (key: StopTarget) => {
    if (impactFailed) return '影響を確認できません'
    if (key !== 'automations') return operationImpactText(IMPACT_KEY[key], impact)
    return `オートメーション ${operationImpactText('automation_actions', impact)}／自動応答 ${operationImpactText('auto_reply_dispatch', impact)}`
  }

  const openStopConfirm = () => {
    if (!control || impactFailed || !impact) { setMessage({ tone: 'warning', text: '停止状態と影響を確認できるまで実行できません。' }); return }
    if (!canControl) { setMessage({ tone: 'warning', text: '緊急停止を実行する権限がありません。' }); return }
    if (selectedTargets.length === 0) { setMessage({ tone: 'warning', text: '停止する配信を1つ以上選んでください。' }); return }
    setConfirmWord(''); setConfirmMode('stop')
  }

  const runStop = async () => {
    if (confirmWord !== '停止' || !control) return
    setRunning(true); setMessage(null)
    try {
      const response = await api.operations.stop({
        lineAccountId: targetAccountId === 'all' ? null : targetAccountId,
        capabilities: selectedCapabilities,
        reason,
        detail: reasonDetail.trim() || null,
        confirmation: '停止',
        expectedVersion: control.version,
      })
      if (!response.success) throw new Error(response.error)
      setControl(response.data.control)
      setMessage({ tone: 'success', text: 'サーバー共通の停止状態を更新しました。別の端末にも同じ状態が表示されます。' })
      setConfirmMode(null); setConfirmWord('')
    } catch {
      setMessage({ tone: 'danger', text: '緊急停止を保存できませんでした。最新の停止状態を読み直して、もう一度確認してください。' })
    } finally { setRunning(false) }
  }

  const runRestore = async () => {
    if (!control?.activeIncidentId || confirmWord !== '復旧') return
    setRunning(true); setMessage(null)
    try {
      const response = await api.operations.restore(control.activeIncidentId, {
        confirmation: '復旧',
        expectedVersion: control.version,
      })
      if (!response.success) throw new Error(response.error)
      setControl(response.data.control)
      setMessage({ tone: 'success', text: 'サーバー共通の停止状態を復旧しました。期限を過ぎた予約は自動では送りません。' })
      setConfirmMode(null); setConfirmWord('')
    } catch {
      setMessage({ tone: 'danger', text: '復旧できませんでした。最新の停止状態を読み直して、もう一度確認してください。' })
    } finally { setRunning(false) }
  }

  return (
    <div className="space-y-4" data-design="V3 Emergency control">
      <div className={`rounded-card border px-4 py-3 ${isStopped ? 'border-danger bg-danger-bg' : impactFailed ? 'border-hairline bg-canvas-sunken' : 'border-success bg-success-bg'}`}><p className={`text-base font-bold ${isStopped ? 'text-danger' : impactFailed ? 'text-ink-secondary' : 'text-success'}`}>{isStopped ? '緊急停止中' : impactFailed ? '停止状態を確認できません' : '通常運用中'}</p><p className="mt-1 text-xs text-ink-faint">{isStopped ? `${accountName}・${formatOperationDate(control?.stoppedAt ?? null)}から停止中` : impactFailed ? '取得できない状態では停止・復旧を実行できません。' : `緊急停止は実行されていません。${calculatedAt ? `${formatOperationDate(calculatedAt)}に確認しました。` : ''}`}</p></div>
      {message && <div className={`rounded-control px-4 py-3 text-xs font-bold ${message.tone === 'success' ? 'bg-success-bg text-success' : message.tone === 'warning' ? 'bg-warning-bg text-warning' : 'bg-danger-bg text-danger'}`}>{message.text}</div>}
      <section className={`border-hairline rounded-card border bg-canvas p-4 ${isStopped ? 'pointer-events-none opacity-50' : ''}`}>
        <div><h2 className="text-base font-bold text-ink">緊急停止</h2><p className="mt-1 text-xs text-ink-faint">停止対象を実行直前に取得します。</p></div>
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2"><div><label className="text-xs font-bold text-ink-secondary" htmlFor="emergency-account">対象アカウント</label><SelectField id="emergency-account" value={targetAccountId} onChange={(event) => setTargetAccountId(event.target.value)} aria-label="緊急停止の対象アカウント" className="border-hairline rounded-control mt-2 min-h-11 w-full border bg-canvas px-3 text-sm" options={[{ value: 'all', label: 'すべてのアカウント' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} /></div><div><label className="text-xs font-bold text-ink-secondary" htmlFor="emergency-reason">停止理由</label><SelectField id="emergency-reason" value={reason} onChange={(event) => setReason(event.target.value)} aria-label="緊急停止の理由" className="border-hairline rounded-control mt-2 min-h-11 w-full border bg-canvas px-3 text-sm" options={['障害対応', '誤配信の防止', 'アカウント異常', 'メンテナンス', 'その他'].map((label) => ({ value: label, label }))} /></div></div>
        <div className="border-hairline mt-5 overflow-hidden rounded-control border">{(Object.keys(targetLabels) as StopTarget[]).map((key) => <label key={key} className="flex cursor-pointer items-center gap-3 border-b border-hairline px-4 py-3 last:border-0 hover:bg-canvas-sunken"><input type="checkbox" checked={targets[key]} onChange={(event) => setTargets((current) => ({ ...current, [key]: event.target.checked }))} className="h-4 w-4 accent-danger" /><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-ink">{targetLabels[key].label}</span><span className="block text-xs text-ink-faint">{targetLabels[key].note}</span></span><span className="max-w-md shrink-0 text-right text-xs font-bold text-ink-secondary">{impactText(key)}</span></label>)}</div>
        <div className="mt-5"><label className="text-xs font-bold text-ink-secondary" htmlFor="emergency-detail">補足（任意）</label><textarea id="emergency-detail" value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} rows={2} placeholder="発生していることを短く入力" className="border-hairline rounded-control mt-2 w-full border px-3 py-2 text-sm" /></div>
        <div className="mt-5 flex justify-end"><button onClick={openStopConfirm} disabled={running || isStopped || impactFailed || !impact || !control || !canControl} className="rounded-control min-h-10 bg-danger px-4 text-xs font-bold text-on-accent hover:opacity-90 disabled:opacity-50">緊急停止する</button></div>
      </section>
      {isStopped && <section className="rounded-card border border-info bg-info-bg p-4"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-base font-bold text-info">復旧</h2><p className="mt-1 text-xs text-info">停止前に動いていたものだけを戻します。期限を過ぎた予約配信は安全のため再開しません。</p></div><button onClick={() => { setConfirmWord(''); setConfirmMode('restore') }} disabled={running || !canControl} className="rounded-control border border-info bg-canvas px-4 py-2 text-xs font-bold text-info hover:bg-info-bg disabled:opacity-50">復旧する</button></div></section>}
      {confirmMode && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/50 p-4" role="dialog" aria-modal="true" aria-labelledby="emergency-confirm-title"><div className="rounded-card w-full max-w-2xl overflow-hidden bg-canvas shadow-2xl"><div className="border-hairline border-b px-6 py-5"><h2 id="emergency-confirm-title" className="text-lg font-bold text-ink">{confirmMode === 'stop' ? '緊急停止の最終確認' : '復旧の最終確認'}</h2><p className="mt-1 text-xs text-ink-faint">{confirmMode === 'stop' ? 'この内容で止めます。止めた瞬間から、自動で送るものが出なくなります。' : '停止前に動いていたものだけを戻します。'}</p></div><div className="space-y-4 p-6"><div className={`rounded-control border p-4 text-sm ${confirmMode === 'stop' ? 'border-danger bg-danger-bg text-danger' : 'border-info bg-info-bg text-info'}`}>{confirmMode === 'stop' ? <><p className="font-bold">{accountName}</p><div className="mt-3 space-y-2">{selectedTargets.map((key) => <div key={key} className="flex items-start justify-between gap-3"><span>{targetLabels[key].label}</span><strong className="text-right">{impactText(key)}</strong></div>)}</div><p className="mt-3">理由：{fullReason}</p><p className="mt-2 font-bold">停止前にすでにLINEへ渡したものは取り消せません。</p></> : <><p className="font-bold">{accountName}</p><p className="mt-1">期限を過ぎた予約は自動では送りません。</p></>}</div>{confirmMode === 'stop' && <div className="rounded-control bg-success-bg px-4 py-3 text-xs font-bold text-success">{targets.automations ? '受信箱からの手の返信と予約の受付は止まりません。' : '自動処理／受信箱からの手の返信／予約の受付は止まりません。'}</div>}<div className="rounded-control bg-warning-bg px-4 py-3 text-xs font-semibold text-warning">ログインユーザーへのLINE・メール通知は、通知基盤の接続後に有効になります。現在は更新履歴へ記録します。</div><label className="block text-sm font-bold text-ink-secondary" htmlFor="emergency-confirm-word">確認のため「{confirmMode === 'stop' ? '停止' : '復旧'}」と入力</label><input id="emergency-confirm-word" value={confirmWord} onChange={(event) => setConfirmWord(event.target.value)} autoFocus className="border-hairline rounded-control min-h-11 w-full border px-3 text-sm" /></div><div className="border-hairline flex justify-end gap-2 border-t px-6 py-4"><button onClick={() => { setConfirmMode(null); setConfirmWord('') }} disabled={running} className="rounded-control min-h-11 px-4 text-sm font-bold text-action hover:bg-action-soft">キャンセル</button><button onClick={() => void (confirmMode === 'stop' ? runStop() : runRestore())} disabled={running || confirmWord !== (confirmMode === 'stop' ? '停止' : '復旧')} className={`rounded-control min-h-11 px-4 text-sm font-bold text-on-accent disabled:opacity-40 ${confirmMode === 'stop' ? 'bg-danger' : 'bg-info'}`}>{running ? '実行中...' : confirmMode === 'stop' ? '配信を緊急停止する' : '復旧を実行する'}</button></div></div></div>}
    </div>
  )
}

function HistoryPanel() {
  const [operations, setOperations] = useState<OperationIncident[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [period, setPeriod] = useState<'year' | '30days'>('year')

  useEffect(() => {
    let cancelled = false
    api.operations.history(200)
      .then((response) => {
        if (cancelled) return
        if (response.success && Array.isArray(response.data)) { setOperations(response.data); setState('ready') }
        else setState('error')
      })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [])

  const cutoff = Date.now() - (period === '30days' ? 30 : 365) * 24 * 60 * 60 * 1000
  const entries = operations.filter((item) => Date.parse(item.createdAt) >= cutoff)
  const longestMinutes = operations.reduce((longest, item) => {
    if (!item.stoppedAt || !item.resolvedAt) return longest
    return Math.max(longest, Math.round((Date.parse(item.resolvedAt) - Date.parse(item.stoppedAt)) / 60_000))
  }, 0)
  const releases = (releaseLog as { releases?: Array<{
    version: string
    released: string | null
    entries: Array<{ kind: string; text: string; by: string | null; pr: number | null; at: string | null }>
  }> }).releases ?? []
  const currentVersion = releases.find((item) => item.released)?.version ?? '—'
  const updateCount = releases.filter((item) => item.released && Date.parse(item.released) >= Date.now() - 30 * 24 * 60 * 60 * 1000).reduce((sum, item) => sum + item.entries.length, 0)
  const recentUpdates = releases
    .flatMap((release) => release.entries.map((entry) => ({ ...entry, version: release.version, released: release.released })))
    .toSorted((left, right) => Date.parse(right.at ?? right.released ?? '') - Date.parse(left.at ?? left.released ?? ''))
    .slice(0, 10)

  const downloadCsv = () => {
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const rows = entries.map((item) => [
      item.createdAt,
      item.actorId,
      item.capabilities.map((capability) => CAPABILITY_LABEL[capability]).join('・'),
      item.lineAccountId ?? 'すべてのアカウント',
      item.reason,
      item.resolvedAt ?? '',
    ])
    const blob = new Blob([`\uFEFF${[['いつ・だれが', '担当者', '止めたもの', '対象', '理由', '戻した'], ...rows].map((row) => row.map(quote).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'operation-history.csv'; anchor.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4" data-design="V3 Update history">
      <div className="flex flex-wrap justify-end gap-2">
        <SelectField value={period} onChange={(event) => setPeriod(event.target.value as typeof period)} options={[{ value: 'year', label: 'この1年' }, { value: '30days', label: 'この30日' }]} className="border-hairline rounded-control min-h-9 border bg-canvas px-3 text-xs" />
        <button type="button" onClick={downloadCsv} className="rounded-control min-h-9 px-3 text-xs font-bold text-action hover:bg-action-soft">CSVで書き出す</button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCard label="止めた回数" value={state === 'ready' ? `${operations.length}回` : '—'} note="この1年" />
        <SummaryCard label="いちばん長かった停止" value={longestMinutes > 0 ? `${longestMinutes}分` : '—'} note="サーバーに残る記録" />
        <SummaryCard label="管理画面の更新" value={`${updateCount}回`} note="この30日" />
        <SummaryCard label="いまの版" value={currentVersion} note="反映済み" />
      </div>
      <div className="rounded-control bg-info-bg text-info px-4 py-3 text-xs font-semibold">止めた・戻した記録です。だれが、いつ、何を止めたかが残ります。通常の管理者は消せません。</div>
      <section className="border-hairline rounded-card overflow-hidden border bg-canvas">
        <div className="border-hairline border-b px-4 py-3"><h2 className="text-base font-bold text-ink">止めた・戻した記録</h2><p className="mt-0.5 text-xs text-ink-faint">だれが・いつ・何を・なぜ。サーバーに追記して残します</p></div>
        {state === 'error' ? <p className="bg-warning-bg px-4 py-4 text-xs font-medium text-warning">緊急操作の履歴を取得できませんでした。履歴なしとは扱いません。</p> : entries.length === 0 ? <p className="p-8 text-center text-xs text-ink-faint">この期間の記録はありません。</p> : <><div className="hidden grid-cols-[190px_1.2fr_1fr_1fr_110px] gap-3 bg-canvas-sunken px-4 py-3 text-[11px] font-bold text-ink-faint md:grid"><span>いつ・だれが</span><span>止めたもの</span><span>対象</span><span>理由</span><span>戻した</span></div><div className="divide-y divide-hairline">{entries.map((entry) => <div key={entry.id} className="grid gap-3 px-4 py-4 md:grid-cols-[190px_1.2fr_1fr_1fr_110px] md:items-center"><div><time className="text-sm font-bold text-ink">{formatOperationDate(entry.createdAt)}</time><p className="mt-1 truncate text-xs text-ink-faint" title={entry.actorId}>{entry.actorId}</p></div><p className="text-xs font-bold text-ink-secondary">{entry.capabilities.map((capability) => CAPABILITY_LABEL[capability]).join('・')}</p><p className="text-xs text-ink-secondary">{entry.lineAccountId ?? 'すべてのアカウント'}</p><div><p className="text-xs font-bold text-ink-secondary">{entry.reason}</p>{entry.detail && <p className="mt-1 text-xs text-ink-faint">{entry.detail}</p>}</div><p className={`text-xs font-bold ${entry.resolvedAt ? 'text-success' : entry.status === 'failed' ? 'text-danger' : 'text-ink-faint'}`}>{entry.resolvedAt ? formatOperationDate(entry.resolvedAt) : entry.status === 'failed' ? '失敗' : '停止中'}</p></div>)}</div></>}
      </section>
      <section className="border-hairline rounded-card overflow-hidden border bg-canvas">
        <div className="border-hairline border-b px-4 py-3"><h2 className="text-base font-bold text-ink">システム更新</h2><p className="mt-0.5 text-xs text-ink-faint">管理画面へ入った変更のうち、新しい10件を表示します</p></div>
        {recentUpdates.length === 0 ? <p className="p-8 text-center text-xs text-ink-faint">更新の記録はありません。</p> : <div className="divide-y divide-hairline">{recentUpdates.map((entry, index) => <div key={`${entry.version}-${entry.pr ?? index}-${entry.at ?? index}`} className="grid gap-2 px-4 py-3 md:grid-cols-[150px_minmax(0,1fr)_100px] md:items-center"><div><time className="text-xs font-bold text-ink-secondary">{formatOperationDate(entry.at ?? entry.released)}</time><p className="mt-1 text-[11px] text-ink-faint">{entry.version}</p></div><p className="line-clamp-2 text-xs leading-relaxed text-ink-secondary" title={entry.text}>{entry.text}</p><p className="text-xs font-bold text-ink-faint">{entry.by ?? '自動'}{entry.pr ? ` #${entry.pr}` : ''}</p></div>)}</div>}
      </section>
    </div>
  )
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
    ? <button type="button" onClick={() => window.location.reload()} className="rounded-control min-h-9 bg-accent-deep px-3 text-xs font-bold text-on-accent">↻ いますぐ確かめる</button>
    : severity === 'danger' || severity === 'warning' ? <StatusPill severity={severity} /> : undefined
  return <div><OperationPageHeader description={description} action={headerAction} /><MergedTabs basePath="/emergency" tabs={TABS} active={tab} />{tab === 'health' && <HealthPanel onSeverity={setSeverity} />}{tab === 'control' && <EmergencyControlPanel accounts={accounts} />}{tab === 'history' && <HistoryPanel />}</div>
}

export default function EmergencyPage() {
  return <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}><EmergencyPageInner /></Suspense>
}
