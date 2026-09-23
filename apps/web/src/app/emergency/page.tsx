'use client'

import { X } from 'lucide-react'
import SelectField from '@/components/shared/select-field'
import Button from '@/components/shared/button'
import Link from 'next/link'
import React, { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { LineAccount } from '@line-crm/shared'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import PageHeader from '@/components/shared/page-header'
import KpiCollapse from '@/components/ui/kpi-collapse'
import {
  api,
  ApiError,
  type OperationCapability,
  type OperationControl,
  type OperationAlert,
  type OperationHealthCheckKey,
  type OperationHealthSnapshot,
  type OperationHistoryEntry,
  type OperationImpactPreview,
  type OperationSendPath,
  type OperationSendPathsResponse,
} from '@/lib/api'
import { formatOperationDate, type OperationSeverity } from '@/lib/operation-status'
import { operationImpactText, type EmergencyStopTarget } from '@/lib/operation-impact'
import { onlyWhenVisible } from '@/lib/visible-polling'
import { operationControlSummary } from './control-summary'
import {
  CAPABILITY_LABEL as RESTORE_DRIFT_CAPABILITY_LABEL,
  describeRestoreBlockers,
  describeRestoreDrift,
  describeRestoreResult,
} from './restore-drift'
import type { OperationRestoreDrift } from '@/lib/api'
// 全文（release-log.json）ではなく要約を読む。全文は未反映の行が数千件あり、
// 同梱するとこの画面だけ最初の読み込みが他の2倍になった（V6R-S3-a）。
import releaseLog from '@/generated/release-log-summary.json'
import { useAccount } from '@/contexts/account-context'
import { collectRecentUpdates, RECENT_UPDATES_LIMIT, releaseEntryCount, type UpdateRelease } from './update-history'

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

/* N-451: drift文言の正本は restore-drift.ts。履歴表示も同じ名前を使う。 */
const CAPABILITY_LABEL = RESTORE_DRIFT_CAPABILITY_LABEL

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

/*
 * N-453(3回目の差し戻し): 403・409(版競合)以外で落ちたときの理由。
 *
 * 口の `error` は400/409/422/428でだけ運用者向け文言として保証される
 * (`apps/web/src/lib/api.ts` の `BODY_MESSAGE_STATUSES`)。429・5xxでは
 * `ApiError.message` が `API error: <status>` という内部向けの作り置きに
 * 落ちるため、それをそのまま出さず固定の案内文へ倒す。
 */
function operationFailureText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message && !/^API error: \d+$/.test(error.message)) {
    return error.message
  }
  return fallback
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

type EmergencySafetyEvent = 'conflict' | 'forbidden' | 'operation-failed' | 'reload-start' | 'reload-success' | 'reload-failure'

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
  /*
   * N-453: 403は「押した本人に権限が無い」。本人確認の窓を開けたままだと、
   * 理由と次の行動が窓の裏へ回って見えず、同じ要求をもう一度送れてしまう。
   * 窓と入力と要求鍵を閉じて、理由を前面に出し、送り直せなくする。
   */
  if (event === 'forbidden') return {
    clearPreview: false,
    closeDialogs: true,
    needsReload: false,
    reloading: false,
    message: null,
  }
  /*
   * N-453(3回目の差し戻し): 403・409(版競合)以外の失敗(400/429/5xx等)は
   * 本人確認の窓が `fixed inset-0` の覆いつきで開いたままだと、帯(理由)が
   * 覆いの裏へ回って運用者から見えない。403と同じく窓を閉じて理由を前面へ出す。
   */
  if (event === 'operation-failed') return {
    clearPreview: false,
    closeDialogs: true,
    needsReload: false,
    reloading: false,
    message: null,
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

const ALERT_ACTION_LABEL: Record<OperationAlert['events'][number]['action'], string> = {
  opened: '検知', escalated: '悪化', acknowledged: '受領', resolved: '解消', reopened: '再発',
}

/*
 * 異常が出たとき、運用者が最初に知りたい3つ (#1050)。
 *
 * お客さまへの影響 → 担当 → 直し方、の順で通知の技術的な詳細より先に出す。
 * 文言は画面側が持ち、口の checkKey と1対1に対応する。
 *
 * A32-01: 「お客さまへの影響」は実測そのものではなく起こり得る影響の案内なので、
 * 実測で裏付けられない事態を断定しない。すべて「可能性」として書き、
 * 確認そのものができていない(severity=unknown)異常では欄の出し分けで
 * 「影響の有無も未確認」と伝える(下の OperationAlertsPanel)。
 */
const ALERT_RESPONSE_FIRST: Record<OperationHealthCheckKey, { impact: string; recovery: string; href: string }> = {
  line_connection: {
    impact: 'LINEへの返信や配信が止まっている可能性があります。',
    recovery: 'アカウント設定でLINE接続を確認し直してください。',
    href: '/accounts',
  },
  message_quota: {
    impact: '配信が途中で止まる可能性があります。',
    recovery: '配信数を減らすか、月の更新を待ってください。',
    href: '/broadcasts',
  },
  external_integrations: {
    impact: 'EC連携など外部とのやり取りが止まっている可能性があります。',
    recovery: '連携設定を確認し、止まっている連携を再設定してください。',
    href: '/ec-commerce',
  },
  webhook: {
    impact: '外部システムへの通知が届いていない可能性があります。',
    recovery: '合言葉と送信先を確認し、失敗した通知を再送してください。',
    href: '/webhooks',
  },
  dispatch_jobs: {
    impact: '予約した配信が時刻どおりに出ていない可能性があります。',
    recovery: '緊急コントロールで止めたままになっていないか確認してください。',
    href: '/emergency?tab=control',
  },
  friend_change: {
    impact: '友だちが急に減っている可能性があります。誤配信やブロックが原因の可能性があります。',
    recovery: '直近の配信内容を確認し、必要なら緊急停止してください。',
    href: '/emergency?tab=control',
  },
}

/** 異常なしと「通知を読めない」を混同しない、健全性チェックの受領・再送欄。 */
function OperationAlertsPanel({
  alerts,
  failed,
  busyId,
  onAcknowledge,
  onRetry,
}: {
  alerts: OperationAlert[]
  failed: boolean
  busyId: string | null
  onAcknowledge: (alert: OperationAlert, note: string) => Promise<void>
  onRetry: (alert: OperationAlert) => Promise<void>
}) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  if (failed) return <section className="rounded-card border border-warning bg-warning-bg px-4 py-3 text-xs font-medium text-warning" role="alert">異常の受領・通知記録を取得できませんでした。異常なしとは扱いません。時間をおいて読み直してください。</section>
  if (alerts.length === 0) return <section className="rounded-card border border-success bg-success-bg px-4 py-3 text-xs font-medium text-success"><strong>異常の記録はありません。</strong> 健全性チェックで新しい異常が見つかると、ここで担当者と通知結果を確認できます。</section>
  return <section className="border-hairline rounded-card overflow-hidden border bg-canvas" aria-label="異常の受領と通知">
    <div className="border-hairline border-b px-4 py-3"><h2 className="text-base font-bold text-ink">異常の対応履歴と通知</h2><p className="mt-1 text-xs text-ink-faint">同じ異常はまとめます。悪化・解消・再発は履歴と通知に残ります。</p></div>
    <div className="divide-y divide-hairline">{alerts.map((alert) => {
      const busy = busyId === alert.id
      const lastEvent = alert.events[0]
      const notification = alert.notification.unconfigured > 0
        ? `${alert.notification.unconfigured}件の通知先が未設定です。担当者または連絡先を設定して再確認できます。`
        : alert.notification.failed > 0
          ? `${alert.notification.failed}件の通知が送れませんでした。再送できます。`
          : alert.notification.total === 0
            ? '通知の準備を確認しています。'
          : alert.notification.queued + alert.notification.sending > 0
            ? '通知を送っています。'
            : `${alert.notification.sent}件の通知を送信しました。`
      const response = ALERT_RESPONSE_FIRST[alert.checkKey]
      return <div key={alert.id} className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><StatusPill severity={alert.severity} /><p className="text-sm font-bold text-ink">{CHECK_DEFINITIONS.find((item) => HEALTH_CHECK_ID[alert.checkKey] === item.id)?.label ?? alert.checkKey}</p>{alert.status === 'acknowledged' && <span className="rounded-pill bg-info-bg px-2 py-1 text-xs font-bold text-info">受領済み</span>}{alert.status === 'resolved' && <span className="rounded-pill bg-success-bg px-2 py-1 text-xs font-bold text-success">解消済み</span>}</div><p className="mt-2 text-xs text-ink-secondary">{alert.summary}</p><p className="mt-1 text-xs text-ink-faint">{lastEvent ? `${ALERT_ACTION_LABEL[lastEvent.action]}：${formatOperationDate(lastEvent.createdAt)}` : formatOperationDate(alert.lastDetectedAt)}</p></div><p className={`text-xs font-bold ${alert.notification.failed + alert.notification.unconfigured > 0 ? 'text-danger' : 'text-ink-faint'}`}>{notification}</p></div>
        {/* #1050: お客さまへの影響→担当→直し方を、通知の内訳より先に出す。 */}
        {alert.status !== 'resolved' && response && <dl className="rounded-control grid gap-3 bg-canvas-sunken px-4 py-3 text-xs sm:grid-cols-3">
          <div><dt className="font-bold text-ink-faint">お客さまへの影響</dt><dd className="mt-1 leading-relaxed text-ink-secondary">{alert.severity === 'unknown' ? 'この項目はまだ確認できていないため、影響の有無も未確認です。' : response.impact}</dd></div>
          <div><dt className="font-bold text-ink-faint">担当</dt><dd className="mt-1 leading-relaxed text-ink-secondary">{alert.acknowledgedById ?? 'まだ受領されていません。下の「受領する」で担当が記録されます。'}</dd></div>
          <div><dt className="font-bold text-ink-faint">直し方</dt><dd className="mt-1 leading-relaxed text-ink-secondary">{response.recovery} <Link href={response.href} className="font-bold text-action">対象画面へ</Link></dd></div>
        </dl>}
        {alert.status === 'open' && <div className="flex flex-wrap items-end gap-2"><label className="min-w-56 flex-1 text-xs font-bold text-ink-secondary" htmlFor={`operation-alert-note-${alert.id}`}>受領メモ（任意）<input id={`operation-alert-note-${alert.id}`} value={notes[alert.id] ?? ''} maxLength={500} onChange={(event) => setNotes((current) => ({ ...current, [alert.id]: event.target.value }))} disabled={busy} className="border-hairline rounded-control mt-1 block min-h-9 w-full border bg-canvas px-3 text-sm font-normal text-ink" /></label><Button variant="primary" disabled={busy} onClick={() => void onAcknowledge(alert, notes[alert.id] ?? '')}>{busy ? '保存中…' : '受領する'}</Button></div>}
        {alert.notification.failed + alert.notification.unconfigured > 0 && <button type="button" disabled={busy} onClick={() => void onRetry(alert)} className="rounded-control min-h-9 border border-danger px-3 text-xs font-bold text-danger disabled:opacity-50">{busy ? '処理しています…' : alert.notification.unconfigured > 0 ? '通知先を再確認する' : '失敗した通知を再送する'}</button>}
      </div>
    })}</div>
  </section>
}

function HealthPanel({
  accountId,
  manualRunRequest,
  onSeverity,
  onManualRunSettled,
}: {
  accountId: string | null
  manualRunRequest: number
  onSeverity: (severity: OperationSeverity) => void
  onManualRunSettled?: () => void
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
  const [alerts, setAlerts] = useState<OperationAlert[]>([])
  const [alertsFailed, setAlertsFailed] = useState(false)
  const [alertBusyId, setAlertBusyId] = useState<string | null>(null)
  const [alertNotice, setAlertNotice] = useState<ControlMessage | null>(null)
  const alertRequestGeneration = useRef(0)
  const currentAccountIdRef = useRef(accountId)
  currentAccountIdRef.current = accountId

  const applySnapshot = useCallback((snapshot: OperationHealthSnapshot) => {
    const results = snapshot.latestRun?.results ?? []
    /*
     * A32-01: 前回の実行が期限切れ(stale)のとき、古い実測を現在の判定として
     * 出さない。各項目の判定は「未確認」へ倒し、本文には古い結果であることを
     * 明示して残す(古い「正常」が残って現在の健全と読み違えるのを防ぐ)。
     */
    const stale = snapshot.overallStatus === 'stale'
    setChecks(CHECK_DEFINITIONS.map((definition) => {
      const result = results.find((item) => HEALTH_CHECK_ID[item.checkKey] === definition.id)
      return {
        ...definition,
        detail: result
          ? stale ? `古い結果です（再確認待ち）: ${result.summary}` : result.summary
          : 'サーバーに確認記録がありません',
        severity: stale ? 'unknown' : (result?.status ?? 'unknown'),
        observedAt: result?.observedAt ?? snapshot.lastCheckedAt,
      }
    }))
    setCheckedAt(snapshot.lastCheckedAt)
    setNextCheckedAt(snapshot.nextCheckAt)
    setSnapshotStatus(snapshot.overallStatus)
  }, [])

  const load = useCallback(async (manual: boolean) => {
    const requestedAccountId = accountId
    const generation = ++alertRequestGeneration.current
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
      setAlerts([])
      setAlertsFailed(false)
      setLoading(false)
      setRefreshing(false)
      hasLoaded.current = true
      if (manual) onManualRunSettled?.()
      return
    }
    try {
      const [response, preview, alertResponse] = await Promise.all([
        manual ? api.operations.runHealth(accountId) : api.operations.health(accountId),
        api.operations.preview(accountId).catch(() => null),
        api.operations.alerts(accountId, true).catch(() => null),
      ])
      if (generation !== alertRequestGeneration.current || requestedAccountId !== currentAccountIdRef.current) return
      if (!response.success) throw new Error(response.error)
      applySnapshot(response.data)
      if (alertResponse?.success) {
        setAlerts(alertResponse.data)
        setAlertsFailed(false)
      } else {
        setAlerts([])
        setAlertsFailed(true)
      }
      setControlSummary(preview?.success
        ? operationControlSummary(preview.data.control)
        : { value: '未確認', note: '停止状態を取得できませんでした' })
    } catch {
      if (generation !== alertRequestGeneration.current || requestedAccountId !== currentAccountIdRef.current) return
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
      setAlerts([])
      setAlertsFailed(true)
    } finally {
      if (generation === alertRequestGeneration.current && requestedAccountId === currentAccountIdRef.current) {
        setLoading(false)
        setRefreshing(false)
        hasLoaded.current = true
      }
      if (manual) onManualRunSettled?.()
    }
  }, [accountId, applySnapshot, onManualRunSettled])

  useEffect(() => {
    setAlertBusyId(null)
    setAlertNotice(null)
  }, [accountId])

  /*
   * クリック由来の増分だけ「手動実行」と見なす(N-458)。
   * manualRunRequest が増えた後にアカウント切替などで load が
   * 変わっても effect は再発火する。そのとき > 0 のままだと
   * クリックしていないのに runHealth が走り、処理中の実行と
   * 2本立つ。最後に処理した番号を覚えておき、新しい番号だけ手動扱いにする。
   */
  const handledManualRequest = useRef(manualRunRequest)
  useEffect(() => {
    const manual = manualRunRequest > handledManualRequest.current
    handledManualRequest.current = manualRunRequest
    void load(manual)
  }, [load, manualRunRequest])

  useEffect(() => {
    // 隠れたタブでは取り直さない（V6R-S3-g）。
    const timer = window.setInterval(onlyWhenVisible(() => { void load(false) }), 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [load])

  const displayedSeverity = loading || snapshotStatus === 'stale' ? 'unknown' : mostSevere(checks)
  // A32-01: 期限切れ(stale)は「取得失敗」と「実測の異常」のどちらでもない第3の状態。
  const isStale = !loading && snapshotStatus === 'stale'
  const isNormal = displayedSeverity === 'normal'
  const resultTitle = isNormal ? '異常なし' : displayedSeverity === 'warning' ? '注意' : displayedSeverity === 'danger' ? 'エラー' : '確認できない項目があります'
  const resultDescription = isNormal
    ? '6項目を確認し、現在、確認できる異常はありません。'
    : displayedSeverity === 'warning'
      ? '注意が必要な項目があります。チェック結果を確認してください。'
      : displayedSeverity === 'danger'
        ? '対応が必要な項目があります。チェック結果を確認してください。'
        : isStale
          ? '前回の確認結果が期限切れです。自動確認が止まっている可能性があります。「いますぐ確かめる」で再確認してください。'
          : '取得できない項目があります。時間をおいて再確認してください。'
  const statusIcon = isNormal ? '✓' : '!'
  const statusIconClass = isNormal ? 'text-success' : displayedSeverity === 'warning' ? 'text-warning' : displayedSeverity === 'danger' ? 'text-danger' : 'text-ink-faint'

  const acknowledgeAlert = useCallback(async (alert: OperationAlert, note: string) => {
    if (!accountId) return
    const requestedAccountId = accountId
    setAlertBusyId(alert.id)
    try {
      const response = await api.operations.acknowledgeAlert(alert.id, {
        lineAccountId: accountId, expectedVersion: alert.version, note,
      })
      if (!response.success) throw new Error(response.error)
      if (requestedAccountId !== currentAccountIdRef.current) return
      setAlerts((current) => current.map((item) => item.id === alert.id ? response.data : item))
      setAlertNotice({ tone: 'success', text: response.duplicate ? 'この異常はすでに受領済みです。' : '異常を受領しました。対応内容は履歴に残ります。' })
    } catch (error) {
      if (requestedAccountId !== currentAccountIdRef.current) return
      setAlertNotice({ tone: 'danger', text: operationFailureText(error, '異常を受領できませんでした。最新の状態を読み直してください。') })
    } finally {
      if (requestedAccountId === currentAccountIdRef.current) setAlertBusyId(null)
    }
  }, [accountId])

  const retryAlertNotifications = useCallback(async (alert: OperationAlert) => {
    if (!accountId) return
    const requestedAccountId = accountId
    setAlertBusyId(alert.id)
    try {
      const response = await api.operations.retryAlertNotifications(alert.id, accountId)
      if (!response.success) throw new Error(response.error)
      if (requestedAccountId !== currentAccountIdRef.current) return
      setAlertNotice({ tone: 'success', text: response.data.retried > 0 ? `${response.data.retried}件の通知または通知先を再確認しました。` : '再確認できる通知はありません。' })
      await load(false)
    } catch (error) {
      if (requestedAccountId !== currentAccountIdRef.current) return
      setAlertNotice({ tone: 'danger', text: operationFailureText(error, '通知を再送待ちへ戻せませんでした。') })
    } finally {
      if (requestedAccountId === currentAccountIdRef.current) setAlertBusyId(null)
    }
  }, [accountId, load])

  // 深刻度の通知は初回の確定後だけ送る(#518 中2)。読み込み中の `unknown`
  // や自動更新のたびに送ると、親の表示が警告へちらつく。
  useEffect(() => { if (hasLoaded.current) onSeverity(displayedSeverity) }, [displayedSeverity, onSeverity])

  return (
    <div className="space-y-4" data-design="V3 Health">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryCard label="全体の状態" value={resultTitle} note={loading ? '確認中' : refreshing ? '更新中' : isStale ? '期限切れ（再確認待ち）' : '最新結果'} />
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
            {loading ? '最新の状態を読み込んでいます。' : `${resultDescription}${isStale ? '' : ` 次は${formatOperationDate(nextCheckedAt)}に自動で確かめます。`}`}
          </p>
        </div>
        <Link href="/emergency?tab=control" className="rounded-control inline-flex min-h-9 items-center bg-danger px-3 text-xs font-bold text-on-accent hover:opacity-90">緊急停止を確認</Link>
      </div>
      {alertNotice && <div className={`rounded-control px-4 py-3 text-xs font-medium ${alertNotice.tone === 'success' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`} role="status">{alertNotice.text}</div>}
      <OperationAlertsPanel alerts={alerts} failed={alertsFailed} busyId={alertBusyId} onAcknowledge={acknowledgeAlert} onRetry={retryAlertNotifications} />
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

const SEND_PATH_KIND_LABEL: Record<OperationSendPath['kind'], string> = {
  manual: '手の操作',
  auto: '自動',
  scheduled: '予約',
  proxy: 'プロキシ経由',
  external: '外部へ送信',
}

/*
 * 停止ボタンが届く経路の一覧 (#1050)。
 *
 * 「止める」と押したとき実際にどの送信経路が止まるか、口が返す台帳
 * (`GET /api/operations/send-paths`) をそのまま見せる。対象外の経路も
 * 理由付きで出し、「表示されているのに止まらない」事故を防ぐ。
 * 台帳と実装がずれているとき(problems)は警告として先頭に出す。
 */
function SendPathCoveragePanel({ accountId, revision }: { accountId: string | null; revision: number }) {
  const [data, setData] = useState<OperationSendPathsResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setFailed(false)
    api.operations.sendPaths(accountId)
      .then((response) => {
        if (cancelled) return
        if (response.success) setData(response.data)
        else setFailed(true)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [accountId, revision])

  if (failed) {
    return <section className="rounded-card border border-warning bg-warning-bg px-4 py-3 text-xs font-medium text-warning" role="alert">
      送信経路の台帳を取得できませんでした。停止の届く範囲が確認できないため、経路の網羅は保証できません。時間をおいて読み直してください。
    </section>
  }
  if (!data) {
    return <section className="border-hairline rounded-card border bg-canvas px-4 py-3 text-xs text-ink-faint">送信経路の台帳を読み込んでいます…</section>
  }

  const groups: Array<{ title: string; stopped: boolean; excluded: boolean; paths: OperationSendPath[] }> = []
  for (const capability of data.capabilities) {
    const paths = data.paths.filter((path) => path.capability === capability)
    if (paths.length === 0) continue
    groups.push({
      title: CAPABILITY_LABEL[capability],
      stopped: paths.some((path) => path.state === 'stopped'),
      excluded: false,
      paths,
    })
  }
  const excluded = data.paths.filter((path) => path.capability === null)
  if (excluded.length > 0) groups.push({ title: '対象外（止まりません）', stopped: false, excluded: true, paths: excluded })

  return <section className="border-hairline rounded-card overflow-hidden border bg-canvas">
    <div className="border-hairline border-b px-4 py-3">
      <h2 className="text-base font-bold text-ink">停止が届く送信経路</h2>
      <p className="mt-0.5 text-xs text-ink-faint">緊急停止が実際に届く経路と、対象外の経路の一覧です。{formatOperationDate(data.evaluatedAt)}時点</p>
      {data.problems.length > 0 && <p className="mt-2 rounded-control bg-warning-bg px-3 py-2 text-xs font-bold text-warning" role="alert">台帳と実装がずれています: {data.problems.join(' / ')}</p>}
    </div>
    <div className="divide-y divide-hairline">
      {groups.map((group) => <div key={group.title} className="px-4 py-3">
        <p className={`text-xs font-bold ${group.excluded ? 'text-ink-faint' : group.stopped ? 'text-danger' : 'text-ink-secondary'}`}>
          {group.title}{group.stopped ? '（停止中）' : ''}
        </p>
        <ul className="mt-2 space-y-1.5">
          {group.paths.map((path) => <li key={path.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
            <span className={`shrink-0 rounded-pill px-2 py-0.5 font-bold ${path.state === 'stopped' ? 'bg-danger-bg text-danger' : path.state === 'running' ? 'bg-success-bg text-success' : 'bg-canvas-sunken text-ink-faint'}`}>
              {path.state === 'stopped' ? '停止中' : path.state === 'running' ? '稼働中' : '対象外'}
            </span>
            <span className="min-w-0 font-bold text-ink">{path.label}</span>
            <span className="text-ink-faint">{SEND_PATH_KIND_LABEL[path.kind]}</span>
            <span className="min-w-0 flex-1 text-ink-faint" title={path.excludedReason ?? path.note ?? undefined}>{path.excludedReason ?? path.note}</span>
          </li>)}
        </ul>
      </div>)}
    </div>
  </section>
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
  /*
   * N-451: 停止中のincidentがあるとき、復旧前検査の結果（停止中の
   * 編集・追加・期限切れ）を保持して確認画面へ出す。取得に失敗しても
   * 復旧自体は口側の検査が同じ判断をするので進められる。
   */
  const [restoreDrift, setRestoreDrift] = useState<OperationRestoreDrift | null>(null)
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

  /* N-451: 停止中のincidentが確定したら復旧前検査を取り、確認画面へ出す。 */
  const activeIncidentId = control?.activeIncidentId ?? null
  useEffect(() => {
    if (!activeIncidentId) {
      setRestoreDrift(null)
      return
    }
    let cancelled = false
    void api.operations.restorePreview(activeIncidentId)
      .then((response) => {
        if (!cancelled && response.success) setRestoreDrift(response.data.drift)
      })
      .catch(() => {
        if (!cancelled) setRestoreDrift(null)
      })
    return () => { cancelled = true }
  }, [activeIncidentId])

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

  /*
   * 403のあとは口の判断を画面へ持ち帰る。`canControl` を落とすことで
   * 停止・復旧のボタンが押せなくなり、理由は常に見えている停止不可の欄に出る。
   * 対象アカウントを選び直せば `preview` を取り直して復帰する。
   */
  const handleForbidden = useCallback((code: string | null | undefined) => {
    applySafetyTransition('forbidden')
    setCanControl(false)
    setPreviewBlockedCode(code ?? null)
    setMessage({ tone: 'warning', text: operationBlockedText(code) ?? 'この操作を行う権限がありません。オーナーに確認してください。' })
  }, [applySafetyTransition])

  /*
   * 403・409(版競合)以外の失敗はここへ倒す。本人確認の窓を閉じて理由を
   * 前面へ出すことで、`fixed inset-0` の覆いの裏に理由が隠れないようにする。
   */
  const handleOperationFailure = useCallback((text: string) => {
    applySafetyTransition('operation-failed')
    setMessage({ tone: 'danger', text })
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
      if (error instanceof ApiError && error.status === 409 && error.code === 'VERSION_CONFLICT') {
        handleConflict()
      } else if (error instanceof ApiError && error.status === 403) {
        handleForbidden(error.code)
      } else {
        handleOperationFailure(operationFailureText(error, '緊急停止を保存できませんでした。最新の停止状態を読み直して、もう一度確認してください。'))
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
      /* N-451: 全部戻った・一部だけ戻った・期限切れを下書きへ戻した、を分けて伝える。 */
      setMessage(response.data.report
        ? describeRestoreResult(response.data.report)
        : { tone: 'success', text: 'サーバー共通の停止状態を復旧しました。' })
      setStepUpMode(null); setStepUpCode(''); setRequestKey('')
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === 'VERSION_CONFLICT') {
        handleConflict()
      } else if (error instanceof ApiError && error.status === 409 && error.code === 'OPERATION_RESTORE_BLOCKED') {
        /* N-451: 再開を止めた理由（編集・追加・権限喪失）を帯へ出す。 */
        const report = (error.data as { report?: { drift?: OperationRestoreDrift } } | undefined)?.report
        const reasons = report?.drift ? describeRestoreBlockers(report.drift) : []
        handleOperationFailure([
          operationFailureText(error, '停止中の変更があるため復旧を止めました。'),
          ...reasons,
        ].join(' '))
      } else if (error instanceof ApiError && error.status === 403) {
        handleForbidden(error.code)
      } else {
        handleOperationFailure(operationFailureText(error, '復旧できませんでした。最新の停止状態を読み直して、もう一度確認してください。'))
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

          <SendPathCoveragePanel accountId={targetAccountId === 'all' ? null : targetAccountId} revision={control?.version ?? 0} />
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
          <div className="flex items-start gap-3 border-b border-hairline px-6 py-6" style={{ minHeight: 112 }}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-bg text-xl font-bold text-danger">!</span><div className="min-w-0 flex-1"><h2 id="emergency-confirm-title" className="text-xl font-bold text-ink">{confirmMode === 'stop' ? '緊急停止の最終確認' : '復旧の最終確認'}</h2><p className="mt-1 text-sm text-ink-faint">{confirmMode === 'stop' ? 'この内容で止めます。止めた瞬間から、自動で送るものが出なくなります。' : '停止前に動いていたものだけを戻します。'}</p></div><button type="button" onClick={() => { setConfirmMode(null); setConfirmWord('') }} disabled={mutationLocked} aria-label="閉じる" className="rounded-mini shrink-0 p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button></div>
          <div className="flex-1 space-y-3 overflow-y-auto p-6">{confirmMode === 'stop' ? <>
            <section className="rounded-control border border-danger bg-danger-bg p-4 text-danger"><p className="text-sm font-bold">{accountName}</p><div className="mt-3 divide-y divide-danger/15">{selectedTargets.map((key) => <div key={key} className="flex items-center justify-between gap-4 py-2" style={{ minHeight: 58 }}><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-canvas text-danger">■</span><div><p className="text-sm font-bold">{targetLabels[key].label}</p><p className="mt-0.5 text-xs">{targetLabels[key].note}</p></div></div><strong className="text-right text-sm">{impactText(key)}</strong></div>)}</div><p className="mt-3 text-xs font-bold">停止前にすでにLINEへ渡したものは取り消せません。</p></section>
            <section className="rounded-control bg-canvas-sunken px-4 py-3"><p className="text-xs font-bold text-ink">理由</p><p className="mt-1 text-sm text-ink-secondary">{fullReason}</p></section>
            <section className="rounded-control bg-success-bg px-4 py-3"><p className="text-xs font-bold text-success">止まらないもの</p><p className="mt-1 text-xs text-success">{targets.automations ? '受信箱からの手の返信と予約の受付は止まりません。' : '自動処理／受信箱からの手の返信／予約の受付は止まりません。'}</p></section>
          </> : <>
            <section className="rounded-control border border-info bg-info-bg p-4 text-info"><p className="font-bold">{accountName}</p><p className="mt-1">期限を過ぎた予約は自動では送りません。</p></section>
            {/* N-451: 停止中の変更・追加・期限切れを復旧の前に見せる。未取得なら出さない。 */}
            {restoreDrift && describeRestoreDrift(restoreDrift).length > 0 && <section className="rounded-control border border-warning bg-warning-bg p-4 text-warning"><p className="text-sm font-bold">停止しているあいだに変わったものがあります</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{describeRestoreDrift(restoreDrift).map((line) => <li key={line}>{line}</li>)}</ul><p className="mt-2 text-xs">変更・追加があった配信は再開しません。期限切れの予約は下書きへ戻します。</p></section>}
          </>}
            <div><label className="block text-sm font-bold text-ink-secondary" htmlFor="emergency-confirm-word">確認のため「{confirmMode === 'stop' ? '停止' : '復旧'}」と入力</label><input id="emergency-confirm-word" value={confirmWord} onChange={(event) => setConfirmWord(event.target.value)} autoFocus className="mt-2 min-h-11 rounded-control border border-hairline px-3 text-sm" style={{ width: 280 }} /><p className="mt-2 text-xs text-ink-faint">この操作は記録に残り、ログインユーザーへ通知されます。</p></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-6 py-4" style={{ minHeight: 84 }}><p className="max-w-sm text-xs text-ink-faint">止めたことは、ログインユーザー全員のLINEとメールへ知らせます。</p><div className="flex gap-2"><button onClick={() => { setConfirmMode(null); setConfirmWord('') }} disabled={mutationLocked} className="min-h-11 rounded-control px-4 text-sm font-bold text-action hover:bg-action-soft">キャンセル</button><button onClick={() => { setStepUpMode(confirmMode); setConfirmMode(null); setStepUpCode('') }} disabled={mutationLocked || confirmWord !== (confirmMode === 'stop' ? '停止' : '復旧')} className={`min-h-11 rounded-control px-4 text-sm font-bold text-on-accent disabled:opacity-40 ${confirmMode === 'stop' ? 'bg-danger' : 'bg-info'}`}>{confirmMode === 'stop' ? '配信を緊急停止する' : '復旧を実行する'}</button></div></div>
        </div>
      </div>}
      {stepUpMode && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" role="dialog" aria-modal="true" aria-labelledby="emergency-step-up-title"><div className="rounded-card w-full max-w-md bg-canvas p-6 shadow-2xl"><div className="flex items-start justify-between gap-3"><h2 id="emergency-step-up-title" className="text-lg font-bold text-ink">認証アプリで本人確認</h2><button type="button" onClick={() => { setStepUpMode(null); setStepUpCode('') }} disabled={mutationLocked} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button></div><p className="mt-2 text-xs leading-relaxed text-ink-faint">この操作専用に、5分以内に1回だけ使える6桁コードを確認します。</p><label className="mt-5 block text-sm font-bold text-ink-secondary" htmlFor="emergency-step-up-code">認証アプリの6桁コード</label><input id="emergency-step-up-code" value={stepUpCode} onChange={(event) => setStepUpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={mutationLocked} inputMode="numeric" autoFocus className="border-hairline rounded-control mt-2 min-h-11 w-full border px-3 text-center text-lg font-bold tracking-[0.4em]" placeholder="000000" /><div className="mt-6 flex justify-end gap-2"><button onClick={() => { setStepUpMode(null); setStepUpCode('') }} disabled={mutationLocked} className="rounded-control min-h-11 px-4 text-sm font-bold text-action">戻る</button><button onClick={() => void (stepUpMode === 'stop' ? runStop() : runRestore())} disabled={mutationLocked || !/^\d{6}$/.test(stepUpCode)} className={`rounded-control min-h-11 px-4 text-sm font-bold text-on-accent disabled:opacity-40 ${stepUpMode === 'stop' ? 'bg-danger' : 'bg-info'}`}>{running ? '確認中...' : stepUpMode === 'stop' ? '本人確認して停止' : '本人確認して復旧'}</button></div></div></div>}
    </div>
  )
}

const HISTORY_FETCH_LIMIT = 200

function HistoryPanel() {
  const [history, setHistory] = useState<OperationHistoryEntry[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [period, setPeriod] = useState<'year' | '30days'>('year')

  useEffect(() => {
    let cancelled = false
    api.operations.history(HISTORY_FETCH_LIMIT)
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
  /*
   * 一覧・回数・最長停止は同じ期間で数える(N-454)。
   *
   * 以前は一覧だけ期間で絞り、概要は取得分すべて(最大200件)を数えていた。
   * 表示期間と食い違い、200件で打ち切られた総数を「全部」として見せていた。
   * 打ち切りが起きたときは「以上」を付けて総数を誤表示しない。
   */
  const truncated = history.length >= HISTORY_FETCH_LIMIT
  const longestMinutes = entries.reduce((longest, item) => {
    if (!item.stoppedAt || !item.resolvedAt) return longest
    return Math.max(longest, Math.round((Date.parse(item.resolvedAt) - Date.parse(item.stoppedAt)) / 60_000))
  }, 0)
  const releases = (releaseLog as { releases?: UpdateRelease[] }).releases ?? []
  const releaseUpdateCount = releases.filter((item) => item.released && Date.parse(item.released) >= Date.now() - 30 * 24 * 60 * 60 * 1000).reduce((sum, item) => sum + releaseEntryCount(item), 0)
  const deployedVersion = deployments.find((item) => item.deployment?.phase === 'succeeded' && item.deployment.version)?.deployment?.version
  const currentVersion = deployedVersion ?? releases.find((item) => item.released)?.version ?? '—'
  const updateCount = deployments.length > 0 ? deployments.filter((item) => Date.parse(item.occurredAt ?? item.createdAt) >= Date.now() - 30 * 24 * 60 * 60 * 1000).length : releaseUpdateCount
  /*
   * 「管理画面の更新」欄(OPERATIONS-01)。
   *
   * 以前は案内が「新しい10件」なのに `.slice(0, 4)` で4件しか出さず、
   * 5件目以降があることも分からなかった。件数は RECENT_UPDATES_LIMIT に
   * まとめ、案内文・行数・「続きがあります」の表示を同じ定数で揃える。
   * まだ画面に入っていない変更は行に混ぜず、件数だけ別に案内する。
   */
  const { updates: allUpdates, pendingCount: pendingUpdateCount, totalCount: allUpdateCount } = collectRecentUpdates(deployments, releases)
  const recentUpdates = allUpdates.slice(0, RECENT_UPDATES_LIMIT)
  const hiddenUpdateCount = allUpdateCount - recentUpdates.length

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
      {/* #975 U060: 390pxでは先頭2件だけ出し、残りは「集計を見る」で開く。 */}
      <KpiCollapse gridClassName="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCard label="止めた回数" value={state === 'ready' ? `${entries.length}回${truncated ? '以上' : ''}` : '—'} note={period === '30days' ? 'この30日' : 'この1年'} />
        <SummaryCard label="いちばん長かった停止" value={longestMinutes > 0 ? `${longestMinutes}分` : '—'} note={truncated ? '直近の記録から' : period === '30days' ? 'この30日' : 'この1年'} />
        <SummaryCard label="管理画面の更新" value={`${updateCount}回`} note="この30日" />
        <SummaryCard label="いまの版" value={currentVersion} note="反映済み" />
      </KpiCollapse>
      <div className="rounded-control bg-info-bg text-info px-4 py-3 text-xs font-semibold">止めた・戻した記録です。だれが、いつ、何を止めたかが残ります。通常の管理者は消せません。</div>
      <div className="flex flex-col items-start gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <section className="border-hairline rounded-card overflow-hidden border bg-canvas">
            <div className="border-hairline border-b px-4 py-3"><h2 className="text-base font-bold text-ink">止めた・戻した記録</h2><p className="mt-0.5 text-xs text-ink-faint">だれが・いつ・何を・なぜ。サーバーに追記して残します</p>{unreadableEntries.length > 0 ? <p className="mt-1 text-xs font-medium text-warning">日付が読めない記録が{unreadableEntries.length}件あり、期間の絞り込みから外しています。履歴なしとは扱いません。</p> : null}</div>
            {state === 'loading' ? <p className="p-8 text-center text-xs text-ink-faint">記録を読み込んでいます…</p> : state === 'error' ? <p className="bg-warning-bg px-4 py-4 text-xs font-medium text-warning">緊急操作の履歴を取得できませんでした。履歴なしとは扱いません。</p> : entries.length === 0 ? <p className="p-8 text-center text-xs text-ink-faint">この期間の記録はありません。</p> : <><div className="hidden grid-cols-[170px_1.2fr_1fr_1fr_100px] gap-3 bg-canvas-sunken px-4 py-3 text-[11px] font-bold text-ink-faint md:grid"><span>いつ・だれが</span><span>止めたもの</span><span>対象</span><span>理由</span><span>戻した</span></div><div className="divide-y divide-hairline">{entries.map((entry) => <div key={entry.id} className="grid gap-3 px-4 py-4 md:grid-cols-[170px_1.2fr_1fr_1fr_100px] md:items-center"><div><time className="text-sm font-bold text-ink">{formatOperationDate(entry.createdAt)}</time><p className="mt-1 truncate text-xs text-ink-faint" title={entry.actorId}>{entry.actorId}</p></div><p className="text-xs font-bold text-ink-secondary">{entry.capabilities.map((capability) => CAPABILITY_LABEL[capability]).join('・')}</p><p className="text-xs text-ink-secondary">{entry.lineAccountId ?? 'すべてのアカウント'}</p><div><p className="text-xs font-bold text-ink-secondary">{entry.reason}</p>{entry.detail && <p className="mt-1 text-xs text-ink-faint">{entry.detail}</p>}</div><p className={`text-xs font-bold ${entry.resolvedAt ? 'text-success' : entry.status === 'failed' ? 'text-danger' : 'text-ink-faint'}`}>{entry.resolvedAt ? formatOperationDate(entry.resolvedAt) : entry.status === 'failed' ? '失敗' : '停止中'}</p></div>)}</div></>}
          </section>
          <section className="border-hairline rounded-card overflow-hidden border bg-canvas">
            <div className="border-hairline border-b px-4 py-3"><h2 className="text-base font-bold text-ink">管理画面の更新</h2><p className="mt-0.5 text-xs text-ink-faint">管理画面へ入った変更のうち、新しい{RECENT_UPDATES_LIMIT}件を表示します</p></div>
            {recentUpdates.length === 0 ? <p className="p-8 text-center text-xs text-ink-faint">更新の記録はありません。</p> : <div className="divide-y divide-hairline">{recentUpdates.map((entry, index) => <div key={`${entry.version}-${entry.pr ?? index}-${entry.at ?? index}`} className="grid gap-2 px-4 py-3 md:grid-cols-[140px_minmax(0,1fr)_90px] md:items-center"><div><time className="text-xs font-bold text-ink-secondary">{formatOperationDate(entry.at ?? entry.released)}</time><p className="mt-1 text-[11px] text-ink-faint">{entry.version}</p></div><p className="line-clamp-2 text-xs leading-relaxed text-ink-secondary" title={entry.text}>{entry.text}</p><p className="text-xs font-bold text-ink-faint">{entry.by ?? '自動'}{entry.pr ? ` #${entry.pr}` : ''}</p></div>)}</div>}
            {(hiddenUpdateCount > 0 || pendingUpdateCount > 0) && <div className="border-hairline space-y-1 border-t px-4 py-3 text-xs text-ink-faint">
              {hiddenUpdateCount > 0 && <p>続きが{hiddenUpdateCount}件あります。この欄では新しい{RECENT_UPDATES_LIMIT}件までを表示します。</p>}
              {pendingUpdateCount > 0 && <p>まだ画面に入っていない変更が{pendingUpdateCount}件あります。更新回数には含めていません。</p>}
            </div>}
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
  /*
   * 手動確認の連打・同時実行を止めるガード(N-458)。
   *
   * 以前はクリックのたびに manualRunRequest が増え、処理中でも
   * runHealth が何本も発射された。ロック中のクリックは握りつぶし、
   * HealthPanel が成否どちらでも終わった時点(settled)で外す。
   * 古い応答は HealthPanel 側の世代照合で破棄される。
   */
  const [manualBusy, setManualBusy] = useState(false)
  const manualRunLock = useRef(false)
  const requestManualRun = useCallback(() => {
    if (manualRunLock.current) return
    manualRunLock.current = true
    setManualBusy(true)
    setManualRunRequest((current) => current + 1)
  }, [])
  const settleManualRun = useCallback(() => {
    manualRunLock.current = false
    setManualBusy(false)
  }, [])
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
    ? <button type="button" onClick={requestManualRun} disabled={!selectedAccountId || manualBusy} className="rounded-control min-h-9 bg-accent-deep px-3 text-xs font-bold text-on-accent disabled:opacity-50">{manualBusy ? '↻ 確認中…' : '↻ いますぐ確かめる'}</button>
    : severity === 'danger' || severity === 'warning' ? <StatusPill severity={severity} /> : undefined
  return <div><OperationPageHeader description={tab === 'history' ? '' : description} action={headerAction} />{accountsFailed ? <div className="bg-warning-bg mt-3 flex flex-wrap items-center justify-between gap-2 rounded-control px-4 py-3 text-xs font-medium text-warning" role="alert"><p>アカウント一覧を取得できませんでした。個別のアカウントを選べず、全体が対象になります。</p><button type="button" onClick={() => loadAccounts()} className="rounded-control border border-warning px-3 py-1.5 font-bold hover:opacity-80">もう一度読む</button></div> : null}<MergedTabs basePath="/emergency" tabs={TABS} active={tab} />{tab === 'health' && <HealthPanel accountId={selectedAccountId} manualRunRequest={manualRunRequest} onSeverity={setSeverity} onManualRunSettled={settleManualRun} />}{tab === 'control' && <EmergencyControlPanel accounts={accounts} />}{tab === 'history' && <HistoryPanel />}</div>
}

function EmergencyPage() {
  return <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}><EmergencyPageInner /></Suspense>
}

EmergencyPage.__test = {
  EmergencyControlFeedback,
  EmergencyControlPanel,
  EmergencyPageInner,
  HealthPanel,
  HistoryPanel,
  OperationAlertsPanel,
  emergencySafetyTransition,
  isEmergencyMutationLocked,
  runCurrentRequest,
}

export default EmergencyPage
