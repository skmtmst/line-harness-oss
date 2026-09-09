'use client'

import SelectField from '@/components/shared/select-field'
import Link from 'next/link'
import React, { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { LineAccount } from '@line-crm/shared'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import PageHeader from '@/components/shared/page-header'
import {
  api,
  ApiError,
  type OperationCapability,
  type OperationControl,
  type OperationHealthCheckKey,
  type OperationHealthSnapshot,
  type OperationHistoryEntry,
  type OperationImpactPreview,
} from '@/lib/api'
import { formatOperationDate, type OperationSeverity } from '@/lib/operation-status'
import { operationImpactText, type EmergencyStopTarget } from '@/lib/operation-impact'
import { operationControlSummary } from './control-summary'
import releaseLog from '@/generated/release-log.json'
import { useAccount } from '@/contexts/account-context'

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

/*
 * N-453/N-455: 止められない理由と競合後の再読込。
 *
 * 止められない理由はサーバーが返す機械コード(`code`)で受け取り、運用者向けの
 * 文言と次の行動は画面側が持つ。理由の中身を固定の作り置きで捏造しない。
 * コードは `apps/worker/src/routes/operations.ts` の応答と1対1に対応する。
 */
const OPERATION_BLOCKED_CODES = {
  controlForbidden: 'EMERGENCY_CONTROL_FORBIDDEN',
  scopeForbidden: 'EMERGENCY_SCOPE_FORBIDDEN',
} as const

function operationBlockedText(code: string | null | undefined): string | null {
  if (code === OPERATION_BLOCKED_CODES.scopeForbidden) return 'この範囲を操作する権限がありません。対象アカウントを選び直すか、オーナーに確認してください。'
  if (code === OPERATION_BLOCKED_CODES.controlForbidden) return '緊急停止を実行する権限がありません。オーナーに権限付与を依頼してください。'
  return null
}
type ConfirmMode = 'stop' | 'restore' | null
type ControlMessage = { tone: 'success' | 'warning' | 'danger'; text: string }
type StopBlocker = 'unavailable' | 'forbidden' | 'scope' | 'empty' | 'stopped'

type CurrentRequestOptions<T> = {
  request: () => Promise<T>
  isCurrent: () => boolean
  onSuccess: (value: T) => void
  onError: (error: unknown) => void
  onSettled?: () => void
}

/**
 * Apply an asynchronous result only while it still belongs to the selected
 * account/request generation. This is exported for the behavior test because
 * the important contract is the ordering, not the source text.
 */
async function runCurrentRequest<T>({
  request,
  isCurrent,
  onSuccess,
  onError,
  onSettled,
}: CurrentRequestOptions<T>): Promise<void> {
  try {
    const value = await request()
    if (isCurrent()) onSuccess(value)
  } catch (error) {
    if (isCurrent()) onError(error)
  } finally {
    if (isCurrent()) onSettled?.()
  }
}

function isEmergencyMutationLocked(needsReload: boolean, running: boolean): boolean {
  return needsReload || running
}

type EmergencySafetyEvent = 'conflict' | 'reload-start' | 'reload-success' | 'reload-failure'

function emergencySafetyTransition(event: EmergencySafetyEvent): {
  clearPreview: boolean
  closeDialogs: boolean
  needsReload: boolean
  reloading: boolean
  message: ControlMessage | null
} {
  if (event === 'conflict') return {
    clearPreview: true,
    closeDialogs: true,
    needsReload: true,
    reloading: false,
    message: { tone: 'warning', text: '別の管理者が先に変更しました。最新の状態を読み直してから、もう一度確認してください。' },
  }
  if (event === 'reload-start') return {
    clearPreview: true,
    closeDialogs: true,
    needsReload: true,
    reloading: true,
    message: null,
  }
  if (event === 'reload-success') return {
    clearPreview: false,
    closeDialogs: false,
    needsReload: false,
    reloading: false,
    message: { tone: 'success', text: '最新の状態を読み直しました。内容を確認して、もう一度実行してください。' },
  }
  return {
    clearPreview: true,
    closeDialogs: true,
    needsReload: true,
    reloading: false,
    message: { tone: 'danger', text: '最新の状態を読み直せませんでした。時間をおいてもう一度読み直してください。' },
  }
}

/** Visible feedback is kept as a real React component so request-state tests
 * verify what the operator sees, instead of inspecting this file as text. */
function EmergencyControlFeedback({
  message,
  needsReload,
  reloading,
  previewSettled,
  stopBlockers,
  onReload,
}: {
  message: ControlMessage | null
  needsReload: boolean
  reloading: boolean
  previewSettled: boolean
  stopBlockers: StopBlocker[]
  onReload: () => void
}) {
  return <>
    {message && <div className={`rounded-control flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs font-bold ${message.tone === 'success' ? 'bg-success-bg text-success' : message.tone === 'warning' ? 'bg-warning-bg text-warning' : 'bg-danger-bg text-danger'}`}><p>{message.text}</p>{needsReload && <button type="button" onClick={onReload} disabled={reloading} className="rounded-control border border-current px-3 py-1.5 font-bold hover:opacity-80 disabled:opacity-50">{reloading ? '読み直しています…' : '最新の状態を読み直す'}</button>}</div>}
    {previewSettled && stopBlockers.length > 0 && <div className="border-warning rounded-card border bg-warning-bg px-4 py-3 text-xs leading-relaxed text-warning" role="status"><p className="font-bold">いまは緊急停止できません</p><ul className="mt-1 list-disc space-y-1 pl-5">{stopBlockers.includes('unavailable') && <li>停止状態を確認できないため、停止・復旧を実行できません。<button type="button" onClick={onReload} disabled={reloading} className="font-bold underline disabled:opacity-50">{reloading ? '読み直しています…' : 'もう一度読む'}</button></li>}{stopBlockers.includes('forbidden') && <li>緊急停止を実行する権限がありません。オーナーに権限付与を依頼してください。</li>}{stopBlockers.includes('scope') && <li>この範囲を操作する権限がありません。対象アカウントを選び直すか、オーナーに確認してください。</li>}{stopBlockers.includes('empty') && <li>停止する配信を1つ以上選んでください。</li>}{stopBlockers.includes('stopped') && <li>停止中です。新しい停止は復旧のあとに行えます。</li>}</ul></div>}
  </>
}

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
  observedAt: string | null
}

const CHECK_DEFINITIONS: Array<Pick<HealthCheckItem, 'id' | 'label' | 'icon' | 'description' | 'threshold' | 'href'>> = [
  { id: 'line', label: 'LINE接続', icon: 'L', description: 'LINEのアカウントとつながっているか', threshold: '応答がない状態が5分つづくと「エラー」', href: '/accounts' },
  { id: 'quota', label: '月間配信数', icon: '↗', description: 'LINEの上限に近づいていないか', threshold: '80%で「注意」・95%で「エラー」', href: '/broadcasts' },
  { id: 'api', label: 'API・外部連携', icon: '↔', description: '管理画面とEC連携が動いているか', threshold: '応答なし・取り込み0件で「注意」', href: '/ec-commerce' },
  { id: 'webhook', label: 'Webhook', icon: 'W', description: '合言葉が入り、送信が通っているか', threshold: '合言葉なしが1本でもあれば「注意」', href: '/webhooks' },
  { id: 'delivery', label: '配信処理', icon: '▷', description: '予約した配信が時刻どおりに出ているか', threshold: '10分の遅れで「注意」・30分で「エラー」', href: '/broadcasts/reserved' },
  { id: 'friends', label: '友だち変化', icon: '人', description: '急に減っていないか', threshold: '1日で5%以上減ると「注意」', href: '/friends' },
]

const HEALTH_CHECK_ID: Record<OperationHealthCheckKey, HealthCheckId> = {
  line_connection: 'line',
  message_quota: 'quota',
  external_integrations: 'api',
  webhook: 'webhook',
  dispatch_jobs: 'delivery',
  friend_change: 'friends',
}

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

function OperationSideCard({
  title,
  tone = 'plain',
  children,
}: {
  title: string
  tone?: 'plain' | 'warning'
  children: ReactNode
}) {
  return (
    <section className={`rounded-card border p-4 ${tone === 'warning' ? 'border-warning bg-warning-bg text-warning' : 'border-hairline bg-canvas text-ink-secondary'}`}>
      <h2 className="text-sm font-bold">{title}</h2>
      <div className="mt-3 space-y-3 text-xs leading-relaxed">{children}</div>
    </section>
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

function HealthPanel({
  accountId,
  manualRunRequest,
  onSeverity,
}: {
  accountId: string | null
  manualRunRequest: number
  onSeverity: (severity: OperationSeverity) => void
}) {
  const [checks, setChecks] = useState<HealthCheckItem[]>(() =>
    CHECK_DEFINITIONS.map((item) => ({ ...item, detail: '確認しています…', severity: 'unknown', observedAt: null })),
  )
  /**
   * 初回と2回目以降を分ける(#518 中2)。
   *
   * 以前は5分ごとの自動更新のたびに `loading` が立ち、バナーと概要が
   * 「確認できない項目があります」へ瞬間的に変わっていた(オオカミ少年化)。
   * 2回目以降は `refreshing` にして、前回の結果を表示したままにする。
   */
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const hasLoaded = useRef(false)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [nextCheckedAt, setNextCheckedAt] = useState<string | null>(null)
  const [snapshotStatus, setSnapshotStatus] = useState<OperationHealthSnapshot['overallStatus']>('unknown')
  const [controlSummary, setControlSummary] = useState({ value: '確認中', note: '停止状態を確認しています' })

  const applySnapshot = useCallback((snapshot: OperationHealthSnapshot) => {
    const results = snapshot.latestRun?.results ?? []
    setChecks(CHECK_DEFINITIONS.map((definition) => {
      const result = results.find((item) => HEALTH_CHECK_ID[item.checkKey] === definition.id)
      return {
        ...definition,
        detail: result?.summary ?? 'サーバーに確認記録がありません',
        severity: result?.status ?? 'unknown',
        observedAt: result?.observedAt ?? snapshot.lastCheckedAt,
      }
    }))
    setCheckedAt(snapshot.lastCheckedAt)
    setNextCheckedAt(snapshot.nextCheckAt)
    setSnapshotStatus(snapshot.overallStatus)
  }, [])

  const load = useCallback(async (manual: boolean) => {
    if (hasLoaded.current) setRefreshing(true)
    else setLoading(true)
    if (!accountId) {
      setChecks(CHECK_DEFINITIONS.map((definition) => ({
        ...definition,
        detail: '上のバーでLINEアカウントを選択してください',
        severity: 'unknown',
        observedAt: null,
      })))
      setCheckedAt(null)
      setNextCheckedAt(null)
      setSnapshotStatus('unknown')
      setControlSummary({ value: '未確認', note: 'LINEアカウントを選択してください' })
      setLoading(false)
      setRefreshing(false)
      hasLoaded.current = true
      return
    }
    try {
      const [response, preview] = await Promise.all([
        manual ? api.operations.runHealth(accountId) : api.operations.health(accountId),
        api.operations.preview(accountId).catch(() => null),
      ])
      if (!response.success) throw new Error(response.error)
      applySnapshot(response.data)
      setControlSummary(preview?.success
        ? operationControlSummary(preview.data.control)
        : { value: '未確認', note: '停止状態を取得できませんでした' })
    } catch {
      setChecks(CHECK_DEFINITIONS.map((definition) => ({
        ...definition,
        detail: 'サーバーの確認記録を取得できませんでした',
        severity: 'unknown',
        observedAt: null,
      })))
      setCheckedAt(null)
      setNextCheckedAt(null)
      setSnapshotStatus('unknown')
      setControlSummary({ value: '未確認', note: '停止状態を取得できませんでした' })
    } finally {
      setLoading(false)
      setRefreshing(false)
      hasLoaded.current = true
    }
  }, [accountId, applySnapshot])

  useEffect(() => {
    void load(manualRunRequest > 0)
  }, [load, manualRunRequest])

  useEffect(() => {
    const timer = window.setInterval(() => { void load(false) }, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [load])

  const displayedSeverity = loading || snapshotStatus === 'stale' ? 'unknown' : mostSevere(checks)
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

  // 深刻度の通知は初回の確定後だけ送る(#518 中2)。読み込み中の `unknown`
  // や自動更新のたびに送ると、親の表示が警告へちらつく。
  useEffect(() => { if (hasLoaded.current) onSeverity(displayedSeverity) }, [displayedSeverity, onSeverity])

  return (
    <div className="space-y-4" data-design="V3 Health">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryCard label="全体の状態" value={resultTitle} note={loading ? '確認中' : refreshing ? '更新中' : '最新結果'} />
        <SummaryCard label="最後の確認" value={formatOperationDate(checkedAt)} note="5分ごとに自動確認" />
        <SummaryCard label="緊急停止状態" value={controlSummary.value} note={controlSummary.note} />
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
                <p className="text-xs text-ink-faint">{formatOperationDate(check.observedAt)}</p>
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
  const [stepUpMode, setStepUpMode] = useState<Exclude<ConfirmMode, null> | null>(null)
  const [stepUpCode, setStepUpCode] = useState('')
  const [requestKey, setRequestKey] = useState('')
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<ControlMessage | null>(null)
  const [control, setControl] = useState<OperationControl | null>(null)
  const [canControl, setCanControl] = useState(false)
  const [calculatedAt, setCalculatedAt] = useState<string | null>(null)
  /*
   * N-453: 停止できない理由の機械コード。口の `preview` が返す
   * `permissions.reasonCode` をそのまま保持し、文言への変換は
   * `operationBlockedText` で行う。口が古い版で欄が無いときは null。
   */
  const [previewBlockedCode, setPreviewBlockedCode] = useState<string | null>(null)
  // N-455: 競合(409)後に最新状態の読み直しが必要な合図。成功後は消す。
  const [needsReload, setNeedsReload] = useState(false)
  const [reloading, setReloading] = useState(false)
  const previewRequestGeneration = useRef(0)

  /*
    **止める前に、何本止まって何人に関わるかを実測で出す。**

    以前はここに数が1つも出ず、取り消せない操作を「予約中の一斉配信」という
    名前だけで押していた。設計 `b3HfZ` は行ごとに件数と人数を出す。

    数は口（`GET /api/operations/control/preview`）が返した実測だけを使う。
    **取れないときに0人と書かない**——`operationImpactText` が `—人` を出す。
  */
  const [impact, setImpact] = useState<OperationImpactPreview | null>(null)
  const [impactFailed, setImpactFailed] = useState(false)
  /*
   * N-455: 最新状態の読み直しは、対象切替の自動取得と競合後の手動取得で
   * 同じ口(`preview`)を使う。成功すれば競合の合図は消える。
   */
  const requestPreview = useCallback(async (accountId: string | null) => {
    const response = await api.operations.preview(accountId)
    if (!response.success) throw new Error(response.error)
    if (response.data?.impact && response.data?.control && response.data?.permissions) {
      return response.data
    }
    throw new Error('invalid preview')
  }, [])

  const clearPreview = useCallback(() => {
    setImpact(null)
    setImpactFailed(false)
    setControl(null)
    setCanControl(false)
    setPreviewBlockedCode(null)
    setCalculatedAt(null)
  }, [])

  const applyPreview = useCallback((preview: Awaited<ReturnType<typeof requestPreview>>) => {
    setImpact(preview.impact)
    setImpactFailed(false)
    setControl(preview.control)
    setCanControl(preview.permissions.canControl)
    setPreviewBlockedCode((preview.permissions as { canControl: boolean; reasonCode?: string | null }).reasonCode ?? null)
    setCalculatedAt(preview.calculatedAt)
  }, [])

  const applySafetyTransition = useCallback((event: EmergencySafetyEvent) => {
    const next = emergencySafetyTransition(event)
    if (next.clearPreview) clearPreview()
    if (next.closeDialogs) {
      setConfirmMode(null)
      setConfirmWord('')
      setStepUpMode(null)
      setStepUpCode('')
      setRequestKey('')
    }
    setNeedsReload(next.needsReload)
    setReloading(next.reloading)
    if (next.message) setMessage(next.message)
  }, [clearPreview])

  useEffect(() => {
    const requestGeneration = ++previewRequestGeneration.current
    const accountId = targetAccountId === 'all' ? null : targetAccountId
    clearPreview()
    setNeedsReload(false)
    setReloading(false)
    setConfirmMode(null)
    setConfirmWord('')
    setStepUpMode(null)
    setStepUpCode('')
    setRequestKey('')
    void runCurrentRequest({
      request: () => requestPreview(accountId),
      isCurrent: () => previewRequestGeneration.current === requestGeneration,
      onSuccess: applyPreview,
      onError: (error) => {
        setImpactFailed(true)
        setPreviewBlockedCode(error instanceof ApiError ? (error.code ?? null) : null)
      },
    })
    return () => {
      if (previewRequestGeneration.current === requestGeneration) previewRequestGeneration.current += 1
    }
  }, [applyPreview, clearPreview, requestPreview, targetAccountId])

  const reloadControl = useCallback(async () => {
    const requestGeneration = ++previewRequestGeneration.current
    const accountId = targetAccountId === 'all' ? null : targetAccountId
    applySafetyTransition('reload-start')
    await runCurrentRequest({
      request: () => requestPreview(accountId),
      isCurrent: () => previewRequestGeneration.current === requestGeneration,
      onSuccess: (preview) => {
        applyPreview(preview)
        applySafetyTransition('reload-success')
      },
      onError: (error) => {
        applySafetyTransition('reload-failure')
        setImpactFailed(true)
        setPreviewBlockedCode(error instanceof ApiError ? (error.code ?? null) : null)
      },
      onSettled: () => setReloading(false),
    })
  }, [applyPreview, applySafetyTransition, requestPreview, targetAccountId])

  const handleTargetAccountChange = useCallback((accountId: string) => {
    // Invalidate the old account synchronously. Waiting for the next effect
    // leaves a window where a slow response can still overwrite this choice.
    previewRequestGeneration.current += 1
    clearPreview()
    setTargetAccountId(accountId)
  }, [clearPreview])

  const handleConflict = useCallback(() => {
    previewRequestGeneration.current += 1
    applySafetyTransition('conflict')
  }, [applySafetyTransition])

  const selectedTargets = (Object.keys(targets) as StopTarget[]).filter((key) => targets[key])
  const selectedCapabilities = selectedTargets.flatMap((key) => TARGET_CAPABILITIES[key])
  const isStopped = Boolean(control?.activeIncidentId)
  const accountName = targetAccountId === 'all' ? 'すべてのアカウント' : accounts.find((account) => account.id === targetAccountId)?.name ?? '選択したアカウント'
  const fullReason = reasonDetail.trim() ? `${reason}: ${reasonDetail.trim()}` : reason
  const mutationLocked = isEmergencyMutationLocked(needsReload, running)
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
    if (needsReload) { setMessage({ tone: 'warning', text: '最新の状態を読み直してから、もう一度確認してください。' }); return }
    if (!control || impactFailed || !impact) { setMessage({ tone: 'warning', text: '停止状態と影響を確認できるまで実行できません。' }); return }
    if (!canControl) { setMessage({ tone: 'warning', text: '緊急停止を実行する権限がありません。' }); return }
    if (selectedTargets.length === 0) { setMessage({ tone: 'warning', text: '停止する配信を1つ以上選んでください。' }); return }
    setConfirmWord(''); setStepUpCode(''); setRequestKey(crypto.randomUUID()); setConfirmMode('stop')
  }

  const runStop = async () => {
    if (needsReload || !/^\d{6}$/.test(stepUpCode) || !control || !requestKey) return
    setRunning(true); setMessage(null)
    try {
      const grant = await api.operations.stepUp(stepUpCode)
      if (!grant.success) throw new Error(grant.error)
      const response = await api.operations.stop({
        lineAccountId: targetAccountId === 'all' ? null : targetAccountId,
        capabilities: selectedCapabilities,
        reason,
        detail: reasonDetail.trim() || null,
        confirmation: '停止',
        expectedVersion: control.version,
      }, grant.data.token, requestKey)
      if (!response.success) throw new Error(response.error)
      setControl(response.data.control)
      setNeedsReload(false)
      setMessage({ tone: 'success', text: 'サーバー共通の停止状態を更新しました。別の端末にも同じ状態が表示されます。' })
      setStepUpMode(null); setStepUpCode(''); setRequestKey('')
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        handleConflict()
      } else if (error instanceof ApiError && error.status === 403) {
        setMessage({ tone: 'warning', text: operationBlockedText(error.code) ?? 'この操作を行う権限がありません。オーナーに確認してください。' })
      } else {
        setMessage({ tone: 'danger', text: '緊急停止を保存できませんでした。最新の停止状態を読み直して、もう一度確認してください。' })
      }
    } finally { setRunning(false) }
  }

  const runRestore = async () => {
    if (needsReload || !control?.activeIncidentId || !/^\d{6}$/.test(stepUpCode) || !requestKey) return
    setRunning(true); setMessage(null)
    try {
      const grant = await api.operations.stepUp(stepUpCode)
      if (!grant.success) throw new Error(grant.error)
      const response = await api.operations.restore(control.activeIncidentId, {
        confirmation: '復旧',
        expectedVersion: control.version,
      }, grant.data.token, requestKey)
      if (!response.success) throw new Error(response.error)
      setControl(response.data.control)
      setNeedsReload(false)
      setMessage({ tone: 'success', text: 'サーバー共通の停止状態を復旧しました。期限を過ぎた予約は自動では送りません。' })
      setStepUpMode(null); setStepUpCode(''); setRequestKey('')
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        handleConflict()
      } else if (error instanceof ApiError && error.status === 403) {
        setMessage({ tone: 'warning', text: operationBlockedText(error.code) ?? 'この操作を行う権限がありません。オーナーに確認してください。' })
      } else {
        setMessage({ tone: 'danger', text: '復旧できませんでした。最新の停止状態を読み直して、もう一度確認してください。' })
      }
    } finally { setRunning(false) }
  }

  /*
   * N-453: 止められない理由は黙ってボタンを薄くするだけにしない。
   * 理由ごとに運用者向け文言と次の行動を出す。口の機械コードがあるときは
   * それを優先し、古い口で欄が無いときは画面の状態から文言を出す。
   * 初回の取得が終わるまでは出さない。取得失敗時も `control` が空でも出す。
   */
  const previewSettled = impact !== null || impactFailed
  const stopBlockers: StopBlocker[] = []
  if (previewSettled) {
    if (impactFailed) stopBlockers.push(previewBlockedCode === OPERATION_BLOCKED_CODES.scopeForbidden ? 'scope' : 'unavailable')
    else if (!canControl) stopBlockers.push(previewBlockedCode === OPERATION_BLOCKED_CODES.scopeForbidden ? 'scope' : 'forbidden')
    if (!impactFailed && selectedTargets.length === 0) stopBlockers.push('empty')
    if (isStopped) stopBlockers.push('stopped')
  }

  return (
    <div className="space-y-4" data-design="V3 Emergency control">
      <EmergencyControlFeedback message={message} needsReload={needsReload} reloading={reloading} previewSettled={previewSettled} stopBlockers={stopBlockers} onReload={() => void reloadControl()} />
      <div className="flex flex-col items-start gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <section className={`border-hairline rounded-card overflow-hidden border bg-canvas ${isStopped || needsReload ? 'pointer-events-none opacity-50' : ''}`}>
            <div className="border-hairline border-b px-4 py-4"><h2 className="text-base font-bold text-ink">何を止めますか</h2><p className="mt-1 text-xs text-ink-faint">停止前に、何本と何人に関わるかを実測で確認します。</p></div>
            <div>{(Object.keys(targetLabels) as StopTarget[]).map((key) => <label key={key} className="flex cursor-pointer items-center gap-3 border-b border-hairline px-4 py-3 last:border-0 hover:bg-canvas-sunken"><input type="checkbox" checked={targets[key]} onChange={(event) => setTargets((current) => ({ ...current, [key]: event.target.checked }))} disabled={mutationLocked || isStopped} className="h-4 w-4 accent-danger" /><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-ink">{targetLabels[key].label}</span><span className="block text-xs text-ink-faint">{targetLabels[key].note}</span></span><span className="max-w-md shrink-0 text-right text-xs font-bold text-ink-secondary">{impactText(key)}</span></label>)}</div>
          </section>

          <section className={`border-hairline rounded-card border bg-canvas p-4 ${isStopped || needsReload ? 'pointer-events-none opacity-50' : ''}`}>
            <h2 className="text-base font-bold text-ink">どのアカウントを、なぜ止めますか</h2>
            <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2"><div><label className="text-xs font-bold text-ink-secondary" htmlFor="emergency-account">対象アカウント</label><SelectField id="emergency-account" value={targetAccountId} onChange={(event) => handleTargetAccountChange(event.target.value)} disabled={mutationLocked || isStopped} aria-label="緊急停止の対象アカウント" className="border-hairline rounded-control mt-2 min-h-11 w-full border bg-canvas px-3 text-sm" options={[{ value: 'all', label: 'すべてのアカウント' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} /></div><div><label className="text-xs font-bold text-ink-secondary" htmlFor="emergency-reason">停止理由</label><SelectField id="emergency-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={mutationLocked || isStopped} aria-label="緊急停止の理由" className="border-hairline rounded-control mt-2 min-h-11 w-full border bg-canvas px-3 text-sm" options={['障害対応', '誤配信の防止', 'アカウント異常', 'メンテナンス', 'その他'].map((label) => ({ value: label, label }))} /></div></div>
          </section>

          <section className={`border-hairline rounded-card border bg-canvas p-4 ${isStopped || needsReload ? 'pointer-events-none opacity-50' : ''}`}>
            <div className="flex items-baseline justify-between gap-2">
              <label className="text-base font-bold text-ink" htmlFor="emergency-detail">補足（任意）</label>
              <p className="text-xs tabular-nums text-ink-faint">あと{1000 - reasonDetail.length}文字</p>
            </div>
            <textarea id="emergency-detail" value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} disabled={mutationLocked || isStopped} rows={2} maxLength={1000} placeholder="発生していることを短く入力" className="border-hairline rounded-control mt-3 w-full border px-3 py-2 text-sm" />
          </section>

          <section className={`rounded-card border p-4 ${isStopped ? 'border-info bg-info-bg' : impactFailed ? 'border-warning bg-warning-bg' : 'border-info bg-info-bg'}`}>
            <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className={`text-base font-bold ${impactFailed ? 'text-warning' : 'text-info'}`}>復旧</h2><p className={`mt-1 text-xs ${impactFailed ? 'text-warning' : 'text-info'}`}>{isStopped ? '停止前に動いていたものだけを戻します。期限を過ぎた予約配信は安全のため再開しません。' : impactFailed ? '停止状態を確認できないため、停止・復旧を実行できません。' : `いまは止めていません。復旧できるものはありません。${calculatedAt ? `${formatOperationDate(calculatedAt)}に確認しました。` : ''}`}</p></div>{isStopped && <button onClick={() => { setConfirmWord(''); setStepUpCode(''); setRequestKey(crypto.randomUUID()); setConfirmMode('restore') }} disabled={mutationLocked || !canControl} className="rounded-control border border-info bg-canvas px-4 py-2 text-xs font-bold text-info hover:bg-info-bg disabled:opacity-50">復旧する</button>}</div>
          </section>
        </div>

        <aside className="w-full space-y-4 xl:w-96 xl:shrink-0">
          <OperationSideCard title="止めるとどうなるか" tone="warning">
            <p><strong>予約中の一斉配信は下書きに戻ります</strong><br />止めたあと、そのまま出ることはありません。</p>
            <p><strong>シナリオ・リマインダは途中で止まります</strong><br />止めているあいだの時刻ぶんは、戻しても送りません。</p>
            <p><strong>受信箱からの手の返信と予約の受付は止まりません</strong></p>
          </OperationSideCard>
          <OperationSideCard title="止めたあとにすること">
            <p><strong>ログインユーザー全員へ知らせます</strong><br />LINEとメールへ停止した人と理由を届けます。</p>
            <p><strong>更新履歴に残ります</strong><br />いつ・だれが・何を・なぜ止めたかを記録します。</p>
            <p><strong>直したら復旧します</strong><br />止める前に動いていたものだけを戻します。</p>
          </OperationSideCard>
          <OperationSideCard title="つながる先">
            <p><Link href="/emergency?tab=health" className="font-bold text-action">→ 健全性チェック</Link><br />止める前に、どこが変かを確認</p>
            <p><Link href="/emergency?tab=history" className="font-bold text-action">→ 更新履歴</Link><br />止めた・戻した記録</p>
            <p><Link href="/broadcasts" className="font-bold text-action">→ 一斉配信</Link><br />下書きに戻った配信</p>
          </OperationSideCard>
        </aside>
      </div>

      <div className="border-hairline rounded-card sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border bg-canvas px-4 py-3 shadow-lg">
        <p className="text-xs font-semibold text-ink-faint">4つのうち{selectedTargets.length}つを選択 ／ {accountName} ／ 理由「{reason}」</p>
        <div className="flex items-center gap-2"><button type="button" onClick={() => { setTargets({ broadcasts: true, scenarios: true, reminders: true, automations: false }); setReason('障害対応'); setReasonDetail('') }} disabled={mutationLocked || isStopped} className="rounded-control min-h-10 px-4 text-xs font-bold text-action hover:bg-action-soft disabled:opacity-50">キャンセル</button><button onClick={openStopConfirm} disabled={mutationLocked || isStopped || impactFailed || !impact || !control || !canControl} className="rounded-control min-h-10 bg-danger px-4 text-xs font-bold text-on-accent hover:opacity-90 disabled:opacity-50">緊急停止する</button></div>
      </div>

      {confirmMode && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4" role="dialog" aria-modal="true" aria-labelledby="emergency-confirm-title">
        <div className="flex w-full flex-col overflow-hidden rounded-card bg-canvas shadow-2xl" style={{ height: 700, maxHeight: 'calc(100vh - 32px)', maxWidth: 720 }}>
          <div className="flex items-start gap-3 border-b border-hairline px-6 py-6" style={{ minHeight: 112 }}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-bg text-xl font-bold text-danger">!</span><div><h2 id="emergency-confirm-title" className="text-xl font-bold text-ink">{confirmMode === 'stop' ? '緊急停止の最終確認' : '復旧の最終確認'}</h2><p className="mt-1 text-sm text-ink-faint">{confirmMode === 'stop' ? 'この内容で止めます。止めた瞬間から、自動で送るものが出なくなります。' : '停止前に動いていたものだけを戻します。'}</p></div></div>
          <div className="flex-1 space-y-3 overflow-y-auto p-6">{confirmMode === 'stop' ? <>
            <section className="rounded-control border border-danger bg-danger-bg p-4 text-danger"><p className="text-sm font-bold">{accountName}</p><div className="mt-3 divide-y divide-danger/15">{selectedTargets.map((key) => <div key={key} className="flex items-center justify-between gap-4 py-2" style={{ minHeight: 58 }}><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-canvas text-danger">■</span><div><p className="text-sm font-bold">{targetLabels[key].label}</p><p className="mt-0.5 text-xs">{targetLabels[key].note}</p></div></div><strong className="text-right text-sm">{impactText(key)}</strong></div>)}</div><p className="mt-3 text-xs font-bold">停止前にすでにLINEへ渡したものは取り消せません。</p></section>
            <section className="rounded-control bg-canvas-sunken px-4 py-3"><p className="text-xs font-bold text-ink">理由</p><p className="mt-1 text-sm text-ink-secondary">{fullReason}</p></section>
            <section className="rounded-control bg-success-bg px-4 py-3"><p className="text-xs font-bold text-success">止まらないもの</p><p className="mt-1 text-xs text-success">{targets.automations ? '受信箱からの手の返信と予約の受付は止まりません。' : '自動処理／受信箱からの手の返信／予約の受付は止まりません。'}</p></section>
          </> : <section className="rounded-control border border-info bg-info-bg p-4 text-info"><p className="font-bold">{accountName}</p><p className="mt-1">期限を過ぎた予約は自動では送りません。</p></section>}
            <div><label className="block text-sm font-bold text-ink-secondary" htmlFor="emergency-confirm-word">確認のため「{confirmMode === 'stop' ? '停止' : '復旧'}」と入力</label><input id="emergency-confirm-word" value={confirmWord} onChange={(event) => setConfirmWord(event.target.value)} autoFocus className="mt-2 min-h-11 rounded-control border border-hairline px-3 text-sm" style={{ width: 280 }} /><p className="mt-2 text-xs text-ink-faint">この操作は記録に残り、ログインユーザーへ通知されます。</p></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-6 py-4" style={{ minHeight: 84 }}><p className="max-w-sm text-xs text-ink-faint">止めたことは、ログインユーザー全員のLINEとメールへ知らせます。</p><div className="flex gap-2"><button onClick={() => { setConfirmMode(null); setConfirmWord('') }} disabled={mutationLocked} className="min-h-11 rounded-control px-4 text-sm font-bold text-action hover:bg-action-soft">キャンセル</button><button onClick={() => { setStepUpMode(confirmMode); setConfirmMode(null); setStepUpCode('') }} disabled={mutationLocked || confirmWord !== (confirmMode === 'stop' ? '停止' : '復旧')} className={`min-h-11 rounded-control px-4 text-sm font-bold text-on-accent disabled:opacity-40 ${confirmMode === 'stop' ? 'bg-danger' : 'bg-info'}`}>{confirmMode === 'stop' ? '配信を緊急停止する' : '復旧を実行する'}</button></div></div>
        </div>
      </div>}
      {stepUpMode && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" role="dialog" aria-modal="true" aria-labelledby="emergency-step-up-title"><div className="rounded-card w-full max-w-md bg-canvas p-6 shadow-2xl"><h2 id="emergency-step-up-title" className="text-lg font-bold text-ink">認証アプリで本人確認</h2><p className="mt-2 text-xs leading-relaxed text-ink-faint">この操作専用に、5分以内に1回だけ使える6桁コードを確認します。</p><label className="mt-5 block text-sm font-bold text-ink-secondary" htmlFor="emergency-step-up-code">認証アプリの6桁コード</label><input id="emergency-step-up-code" value={stepUpCode} onChange={(event) => setStepUpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={mutationLocked} inputMode="numeric" autoFocus className="border-hairline rounded-control mt-2 min-h-11 w-full border px-3 text-center text-lg font-bold tracking-[0.4em]" placeholder="000000" /><div className="mt-6 flex justify-end gap-2"><button onClick={() => { setStepUpMode(null); setStepUpCode('') }} disabled={mutationLocked} className="rounded-control min-h-11 px-4 text-sm font-bold text-action">戻る</button><button onClick={() => void (stepUpMode === 'stop' ? runStop() : runRestore())} disabled={mutationLocked || !/^\d{6}$/.test(stepUpCode)} className={`rounded-control min-h-11 px-4 text-sm font-bold text-on-accent disabled:opacity-40 ${stepUpMode === 'stop' ? 'bg-danger' : 'bg-info'}`}>{running ? '確認中...' : stepUpMode === 'stop' ? '本人確認して停止' : '本人確認して復旧'}</button></div></div></div>}
    </div>
  )
}

function HistoryPanel() {
  const [history, setHistory] = useState<OperationHistoryEntry[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [period, setPeriod] = useState<'year' | '30days'>('year')

  useEffect(() => {
    let cancelled = false
    api.operations.history(200)
      .then((response) => {
        if (cancelled) return
        if (response.success && Array.isArray(response.data)) { setHistory(response.data); setState('ready') }
        else setState('error')
      })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [])

  const cutoff = Date.now() - (period === '30days' ? 30 : 365) * 24 * 60 * 60 * 1000
  const operations = history.filter((item) => item.historyKind !== 'deployment')
  const deployments = history.filter((item) => item.historyKind === 'deployment' && item.deployment)
  /*
   * 日付が読めない記録は期間外と別に数える(#518 10)。
   *
   * 以前は `NaN >= cutoff` が偽になり、黙って一覧から落ちていた。
   * 「履歴なし」と「記録が壊れて見えない」の区別が付かないのは、
   * 監査の記録では見逃せない。
   */
  const unreadableEntries = operations.filter((item) => Number.isNaN(Date.parse(item.createdAt)))
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
  const releaseUpdateCount = releases.filter((item) => item.released && Date.parse(item.released) >= Date.now() - 30 * 24 * 60 * 60 * 1000).reduce((sum, item) => sum + item.entries.length, 0)
  const deployedVersion = deployments.find((item) => item.deployment?.phase === 'succeeded' && item.deployment.version)?.deployment?.version
  const currentVersion = deployedVersion ?? releases.find((item) => item.released)?.version ?? '—'
  const updateCount = deployments.length > 0 ? deployments.filter((item) => Date.parse(item.occurredAt ?? item.createdAt) >= Date.now() - 30 * 24 * 60 * 60 * 1000).length : releaseUpdateCount
  const releaseUpdates = releases
    .flatMap((release) => release.entries.map((entry) => ({ ...entry, version: release.version, released: release.released })))
  const deploymentUpdates = deployments.map((entry) => ({
    kind: 'deployment',
    text: entry.reason,
    by: entry.deployment?.actor ?? entry.actorId,
    pr: entry.deployment?.pullRequest ?? null,
    at: entry.occurredAt ?? entry.createdAt,
    version: entry.deployment?.version ?? entry.deployment?.environment ?? '—',
    released: entry.occurredAt ?? entry.createdAt,
  }))
  const recentUpdates = [...deploymentUpdates, ...releaseUpdates]
    .toSorted((left, right) => Date.parse(right.at ?? right.released ?? '') - Date.parse(left.at ?? left.released ?? ''))
    .slice(0, 4)

  const downloadCsv = () => {
    /**
     * 数式インジェクション対策(#518 中3)。
     *
     * 停止理由・補足・担当者は運用者の自由文で、先頭が `= + - @` のまま
     * Excel で開くと数式として実行され得る。先頭に `'` を付けて無害化する
     * (成果地点の書き出し `csvCell` と同じ約束)。
     */
    const quote = (value: unknown) => {
      const raw = String(value ?? '')
      const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
      return `"${safe.replaceAll('"', '""')}"`
    }
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
        <SelectField aria-label="表示期間" value={period} onChange={(event) => setPeriod(event.target.value as typeof period)} options={[{ value: 'year', label: 'この1年' }, { value: '30days', label: 'この30日' }]} className="border-hairline rounded-control min-h-9 border bg-canvas px-3 text-xs" />
        <button type="button" onClick={downloadCsv} className="rounded-control min-h-9 px-3 text-xs font-bold text-action hover:bg-action-soft">CSVで書き出す</button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCard label="止めた回数" value={state === 'ready' ? `${operations.length}回` : '—'} note="この1年" />
        <SummaryCard label="いちばん長かった停止" value={longestMinutes > 0 ? `${longestMinutes}分` : '—'} note="サーバーに残る記録" />
        <SummaryCard label="管理画面の更新" value={`${updateCount}回`} note="この30日" />
        <SummaryCard label="いまの版" value={currentVersion} note="反映済み" />
      </div>
      <div className="rounded-control bg-info-bg text-info px-4 py-3 text-xs font-semibold">止めた・戻した記録です。だれが、いつ、何を止めたかが残ります。通常の管理者は消せません。</div>
      <div className="flex flex-col items-start gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <section className="border-hairline rounded-card overflow-hidden border bg-canvas">
            <div className="border-hairline border-b px-4 py-3"><h2 className="text-base font-bold text-ink">止めた・戻した記録</h2><p className="mt-0.5 text-xs text-ink-faint">だれが・いつ・何を・なぜ。サーバーに追記して残します</p>{unreadableEntries.length > 0 ? <p className="mt-1 text-xs font-medium text-warning">日付が読めない記録が{unreadableEntries.length}件あり、期間の絞り込みから外しています。履歴なしとは扱いません。</p> : null}</div>
            {state === 'loading' ? <p className="p-8 text-center text-xs text-ink-faint">記録を読み込んでいます…</p> : state === 'error' ? <p className="bg-warning-bg px-4 py-4 text-xs font-medium text-warning">緊急操作の履歴を取得できませんでした。履歴なしとは扱いません。</p> : entries.length === 0 ? <p className="p-8 text-center text-xs text-ink-faint">この期間の記録はありません。</p> : <><div className="hidden grid-cols-[170px_1.2fr_1fr_1fr_100px] gap-3 bg-canvas-sunken px-4 py-3 text-[11px] font-bold text-ink-faint md:grid"><span>いつ・だれが</span><span>止めたもの</span><span>対象</span><span>理由</span><span>戻した</span></div><div className="divide-y divide-hairline">{entries.map((entry) => <div key={entry.id} className="grid gap-3 px-4 py-4 md:grid-cols-[170px_1.2fr_1fr_1fr_100px] md:items-center"><div><time className="text-sm font-bold text-ink">{formatOperationDate(entry.createdAt)}</time><p className="mt-1 truncate text-xs text-ink-faint" title={entry.actorId}>{entry.actorId}</p></div><p className="text-xs font-bold text-ink-secondary">{entry.capabilities.map((capability) => CAPABILITY_LABEL[capability]).join('・')}</p><p className="text-xs text-ink-secondary">{entry.lineAccountId ?? 'すべてのアカウント'}</p><div><p className="text-xs font-bold text-ink-secondary">{entry.reason}</p>{entry.detail && <p className="mt-1 text-xs text-ink-faint">{entry.detail}</p>}</div><p className={`text-xs font-bold ${entry.resolvedAt ? 'text-success' : entry.status === 'failed' ? 'text-danger' : 'text-ink-faint'}`}>{entry.resolvedAt ? formatOperationDate(entry.resolvedAt) : entry.status === 'failed' ? '失敗' : '停止中'}</p></div>)}</div></>}
          </section>
          <section className="border-hairline rounded-card overflow-hidden border bg-canvas">
            <div className="border-hairline border-b px-4 py-3"><h2 className="text-base font-bold text-ink">管理画面の更新</h2><p className="mt-0.5 text-xs text-ink-faint">管理画面へ入った変更のうち、新しい10件を表示します</p></div>
            {recentUpdates.length === 0 ? <p className="p-8 text-center text-xs text-ink-faint">更新の記録はありません。</p> : <div className="divide-y divide-hairline">{recentUpdates.map((entry, index) => <div key={`${entry.version}-${entry.pr ?? index}-${entry.at ?? index}`} className="grid gap-2 px-4 py-3 md:grid-cols-[140px_minmax(0,1fr)_90px] md:items-center"><div><time className="text-xs font-bold text-ink-secondary">{formatOperationDate(entry.at ?? entry.released)}</time><p className="mt-1 text-[11px] text-ink-faint">{entry.version}</p></div><p className="line-clamp-2 text-xs leading-relaxed text-ink-secondary" title={entry.text}>{entry.text}</p><p className="text-xs font-bold text-ink-faint">{entry.by ?? '自動'}{entry.pr ? ` #${entry.pr}` : ''}</p></div>)}</div>}
          </section>
        </div>
        <aside className="w-full space-y-4 xl:w-96 xl:shrink-0">
          <OperationSideCard title="この記録でできること">
            <p><strong>「あの日 何が起きたか」をさかのぼれます</strong><br />止めた理由と、そのとき動いていたものが残ります。</p>
            <p><strong>だれが止めたかが分かります</strong><br />名前・場所・端末をサーバーの記録で確認します。</p>
            <p><strong>通常の管理者は消せません</strong></p>
          </OperationSideCard>
          <OperationSideCard title="つながる先">
            <p><Link href="/emergency?tab=control" className="font-bold text-action">→ 緊急コントロール</Link><br />止める・戻す</p>
            <p><Link href="/staff" className="font-bold text-action">→ ログインユーザー</Link><br />入った記録と担当者</p>
            <p><Link href="/broadcasts" className="font-bold text-action">→ 一斉配信</Link><br />下書きに戻った配信</p>
          </OperationSideCard>
          <OperationSideCard title="気をつけること" tone="warning">
            <p><strong>止めているあいだの配信は出ません</strong><br />戻しても、そのぶんはさかのぼって送りません。</p>
            <p><strong>期限を過ぎた予約配信は戻りません</strong></p>
          </OperationSideCard>
        </aside>
      </div>
    </div>
  )
}

function EmergencyPageInner() {
  const tab = useMergedTab(TABS)
  const { selectedAccountId } = useAccount()
  const [severity, setSeverity] = useState<OperationSeverity>('unknown')
  const [manualRunRequest, setManualRunRequest] = useState(0)
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [accountsFailed, setAccountsFailed] = useState(false)
  /*
   * 対象アカウント欄の元。失敗しても黙らせない(#518 9)。
   *
   * 以前は失敗時に何も出さず、選択肢が「すべてのアカウント」だけになり、
   * 個別停止したいのに全体停止を選ばざるを得なくなる恐れがあった。
   */
  const loadAccounts = useCallback(() => {
    setAccountsFailed(false)
    api.health.accounts()
      .then((response) => {
        if (response.success) setAccounts(response.data)
        else setAccountsFailed(true)
      })
      .catch(() => setAccountsFailed(true))
  }, [])
  useEffect(() => { loadAccounts() }, [loadAccounts])
  const description = tab === 'health'
    ? '問題がないか自動で確認し、エラーがあれば内容と次の行動を表示します。'
    : tab === 'control'
      ? '止める配信を選び、理由を入力して緊急停止します。'
      : 'エラー、緊急停止、システム更新、設定変更を時間順に確認できます。'
  const headerAction = tab === 'health'
    ? <button type="button" onClick={() => setManualRunRequest((current) => current + 1)} disabled={!selectedAccountId} className="rounded-control min-h-9 bg-accent-deep px-3 text-xs font-bold text-on-accent disabled:opacity-50">↻ いますぐ確かめる</button>
    : severity === 'danger' || severity === 'warning' ? <StatusPill severity={severity} /> : undefined
  return <div><OperationPageHeader description={tab === 'history' ? '' : description} action={headerAction} />{accountsFailed ? <div className="bg-warning-bg mt-3 flex flex-wrap items-center justify-between gap-2 rounded-control px-4 py-3 text-xs font-medium text-warning" role="alert"><p>アカウント一覧を取得できませんでした。個別のアカウントを選べず、全体が対象になります。</p><button type="button" onClick={() => loadAccounts()} className="rounded-control border border-warning px-3 py-1.5 font-bold hover:opacity-80">もう一度読む</button></div> : null}<MergedTabs basePath="/emergency" tabs={TABS} active={tab} />{tab === 'health' && <HealthPanel accountId={selectedAccountId} manualRunRequest={manualRunRequest} onSeverity={setSeverity} />}{tab === 'control' && <EmergencyControlPanel accounts={accounts} />}{tab === 'history' && <HistoryPanel />}</div>
}

function EmergencyPage() {
  return <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}><EmergencyPageInner /></Suspense>
}

EmergencyPage.__test = {
  EmergencyControlFeedback,
  emergencySafetyTransition,
  isEmergencyMutationLocked,
  runCurrentRequest,
}

export default EmergencyPage
