'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState } from 'react'
import type { ApiResponse, LineAccount } from '@line-crm/shared'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import {
  ApiError,
  api,
  type OperationCapability,
  type OperationControl,
  type OperationHealthAlert,
  type OperationIncident,
  type OperationRestorePreview,
} from '@/lib/api'
import { formatOperationDate, type OperationSeverity } from '@/lib/operation-status'
import ReleaseLogPanel from '@/components/emergency/release-log-panel'
import Button from '@/components/shared/button'

const TABS = [
  { key: 'health', label: '健全性チェック' },
  { key: 'control', label: '緊急コントロール' },
  { key: 'history', label: '更新履歴' },
]

type StopTarget = Extract<OperationCapability, 'broadcast_dispatch' | 'scenario_dispatch' | 'reminder_dispatch' | 'automation_actions'>
type ConfirmMode = 'stop' | 'restore' | null

const restoreDriftLabels: Record<OperationRestorePreview['definitions']['drift'][number]['change'], string> = {
  deleted: '削除',
  disabled: '停止',
  edited: '編集',
  enabled: '有効化',
  added: '新規追加',
}

function emergencyControlError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : fallback
  if (error.status === 403) return '通常のログインと二段階認証、緊急停止・復旧の専用権限を確認してください。'
  if (error.status === 409) return 'この認証コードは使用済みです。認証アプリに次のコードが出てから入力してください。'
  if (error.status === 428) return '本人確認の有効時間が切れました。認証アプリの6桁コードでもう一度確認してください。'
  if (error.status === 429) return '入力回数を超えました。5分待ってからもう一度確認してください。'
  return error.message || fallback
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

function HealthPanel({ onSeverity, refreshKey }: { onSeverity: (severity: OperationSeverity) => void; refreshKey: number }) {
  const [checks, setChecks] = useState<HealthCheckItem[]>(() =>
    CHECK_DEFINITIONS.map((item) => ({ ...item, detail: '確認しています…', severity: 'unknown' })),
  )
  const [loading, setLoading] = useState(true)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [control, setControl] = useState<OperationControl | null>(null)
  const [alerts, setAlerts] = useState<OperationHealthAlert[]>([])
  const [alertState, setAlertState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [acknowledgingAlertId, setAcknowledgingAlertId] = useState<string | null>(null)
  const [alertMessage, setAlertMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const lineRequest = apiData(api.health.accounts()).then(async (accounts) => {
      const activeAccounts = accounts.filter((account) => account.isActive)
      const health = await Promise.all(
        activeAccounts.map((account) => apiData(api.health.getHealth(account.id))),
      )
      return { activeAccounts, health }
    })
    const persistedRequest = apiData(api.operations.health())
    const controlRequest = apiData(api.operations.control(null))
    const alertsRequest = apiData(api.operations.alerts())

    const [lineResult, persistedResult, controlResult, alertsResult] =
      await Promise.allSettled([
        lineRequest,
        persistedRequest,
        controlRequest,
        alertsRequest,
      ])

    const nextChecks: HealthCheckItem[] = []

    if (lineResult.status === 'fulfilled') {
      const { activeAccounts, health } = lineResult.value
      const risks = health.map((item) => item.riskLevel)
      const lineSeverity: OperationSeverity = activeAccounts.length === 0
        ? 'unknown'
        : health.some((item) => item.isStale)
          ? 'unknown'
        : risks.some((risk) => risk === 'danger')
          ? 'danger'
          : risks.some((risk) => risk === 'warning')
            ? 'warning'
            : risks.some((risk) => risk !== 'normal')
              ? 'unknown'
              : 'normal'
      nextChecks.push({
        id: 'line',
        label: 'LINE接続',
        icon: 'L',
        severity: lineSeverity,
        detail: activeAccounts.length === 0
          ? '有効なLINEアカウントが登録されていません'
          : health.some((item) => item.isStale)
            ? `10分以内の確認結果がないLINEアカウントが${health.filter((item) => item.isStale).length}件あります`
          : `LINE APIの認証エラーと接続状態を確認しました（${activeAccounts.length}アカウント）`,
      })
    } else {
      nextChecks.push({ id: 'line', label: 'LINE接続', icon: 'L', severity: 'unknown', detail: 'LINE接続状態を取得できませんでした' })
    }

    if (persistedResult.status === 'fulfilled' && persistedResult.value && !persistedResult.value.isStale) {
      const snapshot = persistedResult.value
      for (const definition of CHECK_DEFINITIONS.filter((item) => item.id !== 'line')) {
        const saved = snapshot.results.find((item) => item.checkKey === definition.id)
        nextChecks.push(saved
          ? { ...definition, severity: saved.severity, detail: saved.detail }
          : { ...definition, severity: 'unknown', detail: '保存された確認結果がありません' })
      }
      setCheckedAt(snapshot.checkedAt)
    } else {
      const stale = persistedResult.status === 'fulfilled' && persistedResult.value?.isStale
      for (const definition of CHECK_DEFINITIONS.filter((item) => item.id !== 'line')) {
        nextChecks.push({
          ...definition,
          severity: 'unknown',
          detail: stale ? '10分以内の確認結果がありません' : '保存された確認結果を取得できませんでした',
        })
      }
      setCheckedAt(persistedResult.status === 'fulfilled' ? persistedResult.value?.checkedAt ?? null : null)
    }

    setControl(controlResult.status === 'fulfilled' ? controlResult.value : null)
    if (alertsResult.status === 'fulfilled') {
      setAlerts(alertsResult.value)
      setAlertState('ready')
    } else {
      setAlerts([])
      setAlertState('error')
    }

    setChecks(CHECK_DEFINITIONS.map((definition) => nextChecks.find((item) => item.id === definition.id) ?? { ...definition, detail: '確認できませんでした', severity: 'unknown' }))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load() }, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [load, refreshKey])

  const acknowledgeAlert = async (alertId: string) => {
    setAcknowledgingAlertId(alertId)
    setAlertMessage(null)
    try {
      const response = await api.operations.acknowledgeAlert(alertId)
      if (!response.success) {
        setAlertMessage(response.error)
        return
      }
      setAlerts((current) => current.map((alert) => alert.id === alertId ? response.data : alert))
    } catch {
      setAlertMessage('アラートを確認済みにできませんでした。')
    } finally {
      setAcknowledgingAlertId(null)
    }
  }

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
    <div className="space-y-4" data-design="V6 Health">
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
        <SummaryCard
          label="緊急停止状態"
          value={control?.activeIncidentId ? '緊急停止中' : control ? '通常運用' : '—'}
          note={control?.activeIncidentId ? `${formatOperationDate(control.stoppedAt)}から停止` : control ? '停止なし' : '停止状態を取得できません'}
        />
      </div>
      <section className="border-hairline rounded-card overflow-hidden border bg-white">
        <div className="border-hairline flex items-start justify-between gap-3 border-b px-4 py-3"><div><h2 className="text-base font-bold text-gray-900">チェック結果</h2><p className="mt-0.5 text-xs text-gray-500">6項目を常に表示し、確認内容と最新結果を示します</p></div><span className="rounded-pill bg-info-bg text-info px-2 py-1 text-[10px] font-bold">5分ごと</span></div>
        <div className="divide-y divide-gray-100">
          {checks.map((check) => {
            const style = severityStyle[check.severity]
            const iconClass = check.severity === 'normal' ? 'bg-emerald-100 text-emerald-700' : check.severity === 'warning' ? 'bg-amber-100 text-amber-800' : check.severity === 'danger' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
            const alert = check.id === 'line' ? undefined : alerts.find((item) => item.checkKey === check.id)
            return (
              <div key={check.id} className={`flex items-center gap-3 px-4 py-4 ${check.severity === 'normal' ? 'bg-emerald-50/50' : style.panel}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${iconClass}`}>{check.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-900">{check.label}</p>
                  <p className="mt-1 text-xs text-gray-600">{check.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {alert?.status === 'acknowledged'
                    ? <span className="bg-info-bg text-info rounded-pill px-2.5 py-1 text-xs font-bold">確認済み</span>
                    : alert?.status === 'open'
                      ? <Button onClick={() => void acknowledgeAlert(alert.id)} disabled={acknowledgingAlertId === alert.id}>{acknowledgingAlertId === alert.id ? '反映中…' : '確認済みにする'}</Button>
                      : null}
                  <StatusPill severity={check.severity} />
                </div>
              </div>
            )
          })}
        </div>
        {alertState === 'error' ? <p className="border-hairline bg-warning-bg text-warning border-t px-4 py-3 text-xs font-medium">アラートの確認状態を取得できませんでした。</p> : null}
        {alertMessage ? <p className="border-hairline bg-danger-bg text-danger border-t px-4 py-3 text-xs font-medium">{alertMessage}</p> : null}
        {!isNormal && <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"><p className="text-xs text-gray-600">配信予定を確認し、必要な場合だけ配信を停止してください。</p><Link href="/emergency?tab=control" className="rounded-control inline-flex min-h-9 items-center bg-red-600 px-3 text-xs font-bold text-white hover:bg-red-700">緊急停止を確認</Link></div>}
      </section>
    </div>
  )
}

function EmergencyControlPanel({ accounts }: { accounts: LineAccount[] }) {
  const [targetAccountId, setTargetAccountId] = useState('all')
  const [targets, setTargets] = useState<Record<StopTarget, boolean>>({
    broadcast_dispatch: true,
    scenario_dispatch: true,
    reminder_dispatch: true,
    automation_actions: false,
  })
  const [reason, setReason] = useState('障害対応')
  const [reasonDetail, setReasonDetail] = useState('')
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null)
  const [confirmWord, setConfirmWord] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null)
  const [control, setControl] = useState<OperationControl | null>(null)
  const [counts, setCounts] = useState<Partial<Record<OperationCapability, number>>>({})
  const [restorePreview, setRestorePreview] = useState<OperationRestorePreview | null>(null)
  const [canControl, setCanControl] = useState<boolean | null>(null)

  const selectedTargets = (Object.keys(targets) as StopTarget[]).filter((key) => targets[key])
  const accountName = targetAccountId === 'all' ? 'すべてのアカウント' : accounts.find((account) => account.id === targetAccountId)?.name ?? '選択したアカウント'
  const fullReason = reasonDetail.trim() ? `${reason}: ${reasonDetail.trim()}` : reason
  const targetLabels: Record<StopTarget, { label: string; note: string }> = {
    broadcast_dispatch: { label: '予約中・送信中の一斉配信', note: '次のLINE送信をサーバーで止めます' },
    scenario_dispatch: { label: 'シナリオ配信', note: '次のステップ送信をサーバーで止めます' },
    reminder_dispatch: { label: 'リマインダ', note: '次のリマインド送信をサーバーで止めます' },
    automation_actions: { label: '自動処理', note: '公開版の次のアクション実行をサーバーで止めます' },
  }

  const loadPreview = useCallback(async () => {
    setLoading(true)
    const accountId = targetAccountId === 'all' ? null : targetAccountId
    try {
      const response = await api.operations.preview(accountId)
      if (!response.success) {
        setControl(null)
        setCounts({})
        setCanControl(false)
        setMessage({ tone: 'danger', text: response.error })
        return
      }
      setControl(response.data.control)
      setCounts(response.data.counts)
      setCanControl(response.data.permissions.canControl)
    } catch {
      setControl(null)
      setCounts({})
      setCanControl(false)
      setMessage({ tone: 'danger', text: '停止状態と影響件数を取得できませんでした。' })
    } finally {
      setLoading(false)
    }
  }, [targetAccountId])

  useEffect(() => { void loadPreview() }, [loadPreview])

  const openStopConfirm = () => {
    if (!canControl) { setMessage({ tone: 'danger', text: '緊急停止・復旧の専用権限がありません。ownerに権限付与を依頼してください。' }); return }
    if (selectedTargets.length === 0) { setMessage({ tone: 'warning', text: '停止する配信を1つ以上選んでください。' }); return }
    if (!control) { setMessage({ tone: 'danger', text: '最新の停止状態を確認できないため実行できません。' }); return }
    setConfirmWord(''); setTotpCode(''); setConfirmMode('stop')
  }

  const runStop = async () => {
    if (confirmWord !== '停止' || !control || !/^\d{6}$/.test(totpCode)) return
    setRunning(true); setMessage(null)
    try {
      const verified = await api.auth.stepUp({ code: totpCode, purpose: 'operation-stop' })
      if (!verified.success) {
        setMessage({ tone: 'danger', text: verified.error })
        return
      }
      const response = await api.operations.stop({
        lineAccountId: targetAccountId === 'all' ? null : targetAccountId,
        capabilities: selectedTargets,
        reason,
        detail: reasonDetail.trim() || undefined,
        expectedVersion: control.version,
        confirmation: '停止',
      }, verified.data.stepUpToken)
      if (!response.success) {
        setMessage({ tone: 'danger', text: response.error })
        await loadPreview()
        return
      }
      setControl(response.data.control)
      setMessage({ tone: 'success', text: 'サーバー側の緊急停止を受け付けました。別の端末にも同じ状態が表示されます。' })
      setConfirmMode(null); setConfirmWord(''); setTotpCode('')
    } catch (caught) {
      setMessage({ tone: 'danger', text: emergencyControlError(caught, '停止を受け付けられませんでした。状態を読み直して確認してください。') })
    } finally { setRunning(false) }
  }

  const runRestore = async () => {
    if (!control?.activeIncidentId || !restorePreview?.definitions.previewHash || confirmWord !== '復旧' || !/^\d{6}$/.test(totpCode)) return
    setRunning(true); setMessage(null)
    try {
      const verified = await api.auth.stepUp({ code: totpCode, purpose: 'operation-restore' })
      if (!verified.success) {
        setMessage({ tone: 'danger', text: verified.error })
        return
      }
      const response = await api.operations.restore(control.activeIncidentId, {
        expectedVersion: control.version,
        confirmation: '復旧',
        previewHash: restorePreview.definitions.previewHash,
      }, verified.data.stepUpToken)
      if (!response.success) {
        setMessage({ tone: 'danger', text: response.error })
        await loadPreview()
        return
      }
      setControl(response.data.control)
      setMessage({ tone: 'success', text: 'サーバー側の停止を解除しました。期限切れ配信の自動追送は行いません。' })
      setConfirmMode(null); setConfirmWord(''); setTotpCode('')
    } catch (caught) { setMessage({ tone: 'danger', text: emergencyControlError(caught, '復旧に失敗しました。更新履歴を確認してください。') }) } finally { setRunning(false) }
  }

  const openRestoreConfirm = async () => {
    if (!canControl) { setMessage({ tone: 'danger', text: '緊急停止・復旧の専用権限がありません。ownerに権限付与を依頼してください。' }); return }
    if (!control?.activeIncidentId) return
    setRunning(true); setMessage(null); setRestorePreview(null)
    try {
      const response = await api.operations.restorePreview(control.activeIncidentId)
      if (!response.success) {
        setMessage({ tone: 'danger', text: response.error })
        return
      }
      setRestorePreview(response.data)
      if (!response.data.canRestore) {
        const total = Object.values(response.data.blockers).reduce((sum, value) => sum + Number(value ?? 0), 0)
        setMessage({ tone: 'warning', text: response.data.definitions.available
          ? `期限切れまたは実行待ちが${total}件あります。過去分を自動送信しないよう、整理してから復旧してください。`
          : response.data.definitions.error ?? '停止時と現在の設定を比較できないため復旧できません。' })
        return
      }
      setConfirmWord(''); setTotpCode(''); setConfirmMode('restore')
    } catch {
      setMessage({ tone: 'danger', text: '復旧前の安全確認を実行できませんでした。' })
    } finally {
      setRunning(false)
    }
  }

  const stopped = Boolean(control?.activeIncidentId)

  return (
    <div className="space-y-4" data-design="V6 Emergency control" data-design-node="b3HfZ">
      <div className={`rounded-card border px-4 py-3 ${stopped ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}><p className={`text-base font-bold ${stopped ? 'text-red-800' : 'text-emerald-800'}`}>{loading ? '停止状態を確認中' : stopped ? '緊急停止中' : control ? '通常運用中' : '停止状態を確認できません'}</p><p className="mt-1 text-xs text-gray-600">{stopped ? `${accountName}・${formatOperationDate(control?.stoppedAt ?? null)}から停止中 / 理由: ${control?.reason ?? '記録なし'}` : control ? '緊急停止は実行されていません。' : '取得できない状態では停止・復旧を実行できません。'}</p></div>
      {message && <div className={`rounded-control px-4 py-3 text-xs font-bold ${message.tone === 'success' ? 'bg-emerald-50 text-emerald-800' : message.tone === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800'}`}>{message.text}</div>}
      {canControl === false && <div className="rounded-control bg-warning-bg px-4 py-3 text-xs font-bold text-warning">状態と履歴は確認できます。停止・復旧には専用権限が必要です。</div>}
      <section className={`border-hairline rounded-card border bg-white p-4 ${stopped ? 'pointer-events-none opacity-50' : ''}`}>
        <div><h2 className="text-base font-bold text-gray-900">緊急停止</h2><p className="mt-1 text-xs text-gray-500">影響件数と版をサーバーで再確認してから、送信ゲートを先に止めます。</p></div>
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2"><div><label className="text-xs font-bold text-gray-700" htmlFor="emergency-account">対象アカウント</label><select id="emergency-account" value={targetAccountId} onChange={(event) => setTargetAccountId(event.target.value)} className="border-hairline rounded-control mt-2 min-h-11 w-full border bg-white px-3 text-sm"><option value="all">すべてのアカウント</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div><div><label className="text-xs font-bold text-gray-700" htmlFor="emergency-reason">停止理由</label><select id="emergency-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="border-hairline rounded-control mt-2 min-h-11 w-full border bg-white px-3 text-sm"><option>障害対応</option><option>誤配信の防止</option><option>アカウント異常</option><option>メンテナンス</option><option>その他</option></select></div></div>
        <div className="border-hairline mt-5 overflow-hidden rounded-control border">{(Object.keys(targetLabels) as StopTarget[]).map((key) => <label key={key} className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0 hover:bg-gray-50"><input type="checkbox" checked={targets[key]} onChange={(event) => setTargets((current) => ({ ...current, [key]: event.target.checked }))} className="h-4 w-4 accent-red-600" /><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-gray-900">{targetLabels[key].label}</span><span className="block text-xs text-gray-500">{targetLabels[key].note}</span></span><span className="text-xs font-bold text-gray-600">{counts[key] == null ? '—' : `${counts[key]}件`}</span></label>)}</div>
        <div className="mt-5"><label className="text-xs font-bold text-gray-700" htmlFor="emergency-detail">補足（任意）</label><textarea id="emergency-detail" value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} rows={2} placeholder="発生していることを短く入力" className="border-hairline rounded-control mt-2 w-full border px-3 py-2 text-sm" /></div>
        <div className="mt-5 flex justify-end"><button onClick={openStopConfirm} disabled={running || loading || stopped || !control || !canControl} className="rounded-control min-h-10 bg-red-600 px-4 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50">配信を緊急停止</button></div>
      </section>
      {stopped && <section className="rounded-card border border-blue-200 bg-blue-50 p-4"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-base font-bold text-blue-900">復旧</h2><p className="mt-1 text-xs text-blue-800">期限切れ・実行待ちをサーバーで確認し、過去分が残っている間は復旧を止めます。</p></div><button onClick={() => void openRestoreConfirm()} disabled={running || !canControl} className="rounded-control border border-blue-300 bg-white px-4 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100 disabled:opacity-50">復旧内容を確認</button></div></section>}
      {confirmMode && <div data-design-node="U0BwS" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="emergency-confirm-title"><div className="rounded-card max-h-screen w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl"><h2 id="emergency-confirm-title" className="text-lg font-bold text-gray-900">{confirmMode === 'stop' ? '緊急停止の最終確認' : '復旧の最終確認'}</h2><div className={`mt-4 rounded-control p-4 text-sm ${confirmMode === 'stop' ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-900'}`}>{confirmMode === 'stop' ? <><p className="font-bold">{accountName}</p><p className="mt-1">{selectedTargets.map((key) => `${targetLabels[key].label}（${counts[key] == null ? '未取得' : `${counts[key]}件`}）`).join('・')}</p><p className="mt-1">理由：{fullReason}</p><p className="mt-2 font-bold">停止前にすでにLINEへ渡したものは取り消せません。</p></> : <><p className="font-bold">{accountName}</p><p className="mt-1">期限切れ・実行待ち0件を確認しました。サーバーの送信ゲートを再開します。</p><p className="mt-1 text-xs">確認時刻：{formatOperationDate(restorePreview?.calculatedAt ?? null)}</p></>}</div>{confirmMode === 'restore' && <div className="border-hairline mt-4 rounded-control border p-4"><p className="text-sm font-bold text-ink">停止後の設定変更</p>{restorePreview?.definitions.drift.length ? <ul className="mt-2 space-y-2">{restorePreview.definitions.drift.map((item) => <li key={`${item.key}:${item.change}`} className="flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate text-ink" title={item.name}>{item.name}</span><span className="shrink-0 font-bold text-warning">{restoreDriftLabels[item.change]}</span></li>)}</ul> : <p className="mt-2 text-xs text-ink-secondary">停止後の削除・編集・有効状態の変更はありません。</p>}<p className="mt-3 text-xs text-ink-faint">この確認後に設定が変わった場合、復旧は自動で止まります。</p></div>}<label className="mt-4 block text-sm font-bold text-gray-800" htmlFor="emergency-confirm-word">確認のため「{confirmMode === 'stop' ? '停止' : '復旧'}」と入力</label><input id="emergency-confirm-word" value={confirmWord} onChange={(event) => setConfirmWord(event.target.value)} autoFocus className="border-hairline rounded-control mt-2 min-h-11 w-full border px-3 text-sm" /><label className="mt-4 block text-sm font-bold text-ink" htmlFor="emergency-totp-code">認証アプリの6桁コード</label><input id="emergency-totp-code" value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className="border-hairline rounded-control mt-2 min-h-11 w-full border px-3 text-sm tracking-widest" /><p className="mt-2 text-xs text-ink-faint">この操作専用の本人確認として、5分以内に1回だけ使います。</p><div className="mt-5 flex justify-end gap-2"><button onClick={() => { setConfirmMode(null); setConfirmWord(''); setTotpCode('') }} disabled={running} className="rounded-control border-hairline min-h-11 border px-4 text-sm font-bold text-gray-700">確認画面を閉じる</button><button onClick={() => void (confirmMode === 'stop' ? runStop() : runRestore())} disabled={running || confirmWord !== (confirmMode === 'stop' ? '停止' : '復旧') || !/^\d{6}$/.test(totpCode) || (confirmMode === 'restore' && !restorePreview?.definitions.previewHash)} className={`rounded-control min-h-11 px-4 text-sm font-bold text-white disabled:opacity-40 ${confirmMode === 'stop' ? 'bg-red-600' : 'bg-blue-700'}`}>{running ? '実行中...' : confirmMode === 'stop' ? 'この内容で配信を緊急停止' : 'この内容で配信を復旧'}</button></div></div></div>}
    </div>
  )
}

function HistoryPanel() {
  const [operations, setOperations] = useState<OperationIncident[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [filter, setFilter] = useState<'all' | 'stopped' | 'resolved' | 'failed'>('all')
  useEffect(() => {
    api.operations.history().then((response) => {
      if (!response.success) { setState('error'); return }
      setOperations(response.data)
      setState('ready')
    }).catch(() => setState('error'))
  }, [])
  const entries = operations.filter((item) => filter === 'all' || item.status === filter)
  const last = operations[0]
  const stoppedCount = operations.filter((item) => item.status === 'stopped').length
  const statusLabel = (status: OperationIncident['status']) => status === 'stopped' ? '停止中' : status === 'resolved' ? '復旧済み' : status === 'failed' ? '失敗' : '処理中'
  const targetResultSummary = (incident: OperationIncident) => {
    const counts = incident.targetCounts
    if (!counts) return '停止対象の実績を取得できません'
    return [
      counts.held > 0 ? `保留 ${counts.held}件` : null,
      counts.skippedDueToEmergency > 0 ? `見送り ${counts.skippedDueToEmergency}件` : null,
      counts.inFlight > 0 ? `送信開始済み ${counts.inFlight}件` : null,
      counts.failed > 0 ? `失敗 ${counts.failed}件` : null,
    ].filter((item): item is string => item !== null).join('・')
  }
  return (
    <div className="space-y-4" data-design="V6 Update history" data-design-node="UhC2O">
      <div className="rounded-card border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-900">
        緊急停止と復旧はサーバーに追記し、別の端末からも同じ履歴を確認できます。変更内容はリリースごとに記録します。
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryCard label="緊急操作" value={state === 'ready' ? `${operations.length}件` : '—'} note="サーバーに保存された履歴" />
        <SummaryCard label="停止中" value={state === 'ready' ? `${stoppedCount}件` : '—'} note="復旧が必要な停止" />
        <SummaryCard label="最後の緊急操作" value={formatOperationDate(last?.createdAt ?? null)} note={last ? `${last.reason}・${statusLabel(last.status)}` : 'まだありません'} />
      </div>
      <ReleaseLogPanel />
      <div className="border-hairline rounded-card overflow-hidden border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-bold text-gray-900">緊急操作の履歴</h2>
          <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="border-hairline rounded-control min-h-9 border bg-white px-3 text-xs">
            <option value="all">すべての状態</option><option value="stopped">停止中</option><option value="resolved">復旧済み</option><option value="failed">失敗</option>
          </select>
        </div>
        {state === 'error' && <p className="bg-red-50 px-4 py-3 text-xs font-medium text-red-800">緊急操作の履歴を取得できませんでした。</p>}
        {state === 'loading' ? <p className="p-8 text-center text-xs text-gray-500">履歴を読み込んでいます…</p> : entries.length === 0 ? <p className="p-8 text-center text-xs text-gray-500">該当する履歴はまだありません。</p> : <div className="divide-y divide-gray-100">{entries.map((entry) => { const resultSummary = targetResultSummary(entry); return <div key={entry.id} className="grid gap-2 px-4 py-4 md:grid-cols-[150px_120px_1fr_auto] md:items-center"><time className="text-xs text-gray-500">{formatOperationDate(entry.stoppedAt ?? entry.createdAt)}</time><span className="text-xs font-bold text-gray-600">{entry.lineAccountId ? 'アカウント別' : '全アカウント'}</span><div><p className="text-sm font-bold text-gray-900">{entry.reason}</p><p className="mt-1 text-xs text-gray-500">{entry.capabilities.join('・')}{entry.detail ? ` / ${entry.detail}` : ''}{entry.errorMessage ? ` / ${entry.errorMessage}` : ''}</p>{resultSummary ? <p className="text-ink-secondary mt-1 text-xs font-bold">{resultSummary}</p> : null}</div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${entry.status === 'resolved' ? 'bg-emerald-100 text-emerald-700' : entry.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{statusLabel(entry.status)}</span></div> })}</div>}
      </div>
    </div>
  )
}

function EmergencyPageInner() {
  const tab = useMergedTab(TABS)
  const [severity, setSeverity] = useState<OperationSeverity>('unknown')
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [healthRefreshKey, setHealthRefreshKey] = useState(0)
  const [healthRunning, setHealthRunning] = useState(false)
  useEffect(() => { api.health.accounts().then((response) => { if (response.success) setAccounts(response.data) }).catch(() => undefined) }, [])
  const runHealthCheck = async () => {
    setHealthRunning(true)
    try {
      await api.operations.runHealthCheck()
      setHealthRefreshKey((current) => current + 1)
    } finally {
      setHealthRunning(false)
    }
  }
  const headerAction = tab === 'health'
    ? <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void runHealthCheck()} disabled={healthRunning} className="rounded-control min-h-9 bg-accent px-3 text-xs font-bold text-white disabled:opacity-50">{healthRunning ? '確認中…' : '健全性を再確認'}</button><Link href="/emergency?tab=control" className="rounded-control inline-flex min-h-9 items-center bg-red-600 px-3 text-xs font-bold text-white">配信を緊急停止</Link></div>
    : severity === 'danger' || severity === 'warning' ? <StatusPill severity={severity} /> : undefined
  return <div data-design-node={tab === 'health' ? 'UgonK' : tab === 'control' ? 'b3HfZ' : 'UhC2O'}><MergedTabs basePath="/emergency" tabs={TABS} active={tab} actions={headerAction} />{tab === 'health' && <HealthPanel onSeverity={setSeverity} refreshKey={healthRefreshKey} />}{tab === 'control' && <EmergencyControlPanel accounts={accounts} />}{tab === 'history' && <HistoryPanel />}</div>
}

export default function EmergencyPage() {
  return <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}><EmergencyPageInner /></Suspense>
}
