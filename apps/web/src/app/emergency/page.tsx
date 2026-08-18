'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { AccountHealthLog, LineAccount } from '@line-crm/shared'
import Header from '@/components/layout/header'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import { api, type DashboardOverview } from '@/lib/api'
import {
  buildHealthRows,
  buildResearchReport,
  formatOperationDate,
  HEALTH_CRITERIA,
  overallSeverity,
  type OperationHealthRow,
  type OperationSeverity,
} from '@/lib/operation-status'

const TABS = [
  { key: 'health', label: '健全性チェック' },
  { key: 'control', label: '緊急コントロール' },
  { key: 'history', label: '更新履歴' },
]

const SNAPSHOT_KEY = 'nen_emergency_snapshot_v1'
const OPERATION_HISTORY_KEY = 'nen_operation_history_v1'

type StopTarget = 'broadcasts' | 'scenarios' | 'reminders' | 'automations'
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

const severityStyle: Record<OperationSeverity, { label: string; badge: string; panel: string }> = {
  normal: { label: '正常', badge: 'bg-emerald-100 text-emerald-700', panel: 'border-emerald-200 bg-emerald-50' },
  warning: { label: '注意', badge: 'bg-amber-100 text-amber-800', panel: 'border-amber-200 bg-amber-50' },
  danger: { label: '異常', badge: 'bg-red-100 text-red-700', panel: 'border-red-200 bg-red-50' },
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

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function StatusPill({ severity }: { severity: OperationSeverity }) {
  const style = severityStyle[severity]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${style.badge}`}>{style.label}</span>
}

function SummaryCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border-hairline rounded-card border bg-white p-4">
      <p className="text-ink-faint text-xs font-semibold">{label}</p>
      <p className="text-ink mt-1 text-xl font-bold">{value}</p>
      <p className="text-ink-faint mt-1 text-xs">{note}</p>
    </div>
  )
}

function HealthPanel({ onSeverity }: { onSeverity: (severity: OperationSeverity) => void }) {
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [logsByAccount, setLogsByAccount] = useState<Record<string, AccountHealthLog[]>>({})
  const [risksByAccount, setRisksByAccount] = useState<Record<string, string>>({})
  const [dashboard, setDashboard] = useState<DashboardOverview | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const accountResponse = await api.health.accounts()
      if (!accountResponse.success) throw new Error(accountResponse.error)
      const nextLogs: Record<string, AccountHealthLog[]> = {}
      const nextRisks: Record<string, string> = {}
      const results = await Promise.allSettled(
        accountResponse.data.map(async (account) => ({ account, response: await api.health.getHealth(account.id) })),
      )
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.response.success) {
          nextLogs[result.value.account.id] = result.value.response.data.logs ?? []
          nextRisks[result.value.account.id] = result.value.response.data.riskLevel
        }
      }
      setAccounts(accountResponse.data)
      setLogsByAccount(nextLogs)
      setRisksByAccount(nextRisks)
      const dashboardResponse = await api.dashboard.overview({ period: 'today' })
      if (dashboardResponse.success) setDashboard(dashboardResponse.data)
    } catch {
      setLoadError('運用状態を取得できませんでした。時間をおいて再読み込みしてください。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  const rows = useMemo(() => buildHealthRows(accounts, logsByAccount, risksByAccount), [accounts, logsByAccount, risksByAccount])
  const severity = useMemo(() => overallSeverity(rows), [rows])
  const abnormalRows = useMemo(() => rows.filter((row) => row.severity === 'danger' || row.severity === 'warning'), [rows])
  const selected = rows.find((row) => row.accountId === selectedId) ?? abnormalRows[0] ?? rows[0] ?? null
  const checkedDates = rows.map((row) => row.checkedAt).filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(b) - Date.parse(a))
  const quotaLimit = dashboard?.delivery.quotaLimit ?? null
  const quotaUsed = dashboard?.delivery.quotaUsed ?? null
  const quotaRemaining = quotaLimit == null || quotaUsed == null ? '取得できません' : Math.max(quotaLimit - quotaUsed, 0).toLocaleString('ja-JP')

  useEffect(() => { onSeverity(severity) }, [onSeverity, severity])

  const exportReport = (row: OperationHealthRow) => {
    const report = buildResearchReport({ generatedAt: new Date().toISOString(), overall: severity, rows: [row], quotaLimit, quotaUsed })
    downloadText(`nen-operation-report-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`, report)
  }

  if (loading) return <div className="border-hairline rounded-card border bg-white p-10 text-center text-sm text-gray-500">確認しています...</div>

  return (
    <div className="space-y-4" data-design="V3 Health">
      {loadError && <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{loadError}</div>}
      <div className={`rounded-card flex flex-wrap items-center gap-3 border px-4 py-3 ${severityStyle[severity].panel}`}>
        <StatusPill severity={severity} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900">{severity === 'normal' ? '現在、確認できる異常はありません' : severity === 'unknown' ? 'まだ確認できていない項目があります' : `${abnormalRows.length}件の確認が必要です`}</p>
          <p className="mt-0.5 text-xs text-gray-600">異常を選ぶと、内容と次の行動を確認できます。</p>
        </div>
        <button onClick={() => void load()} className="rounded-control border-hairline min-h-10 border bg-white px-4 text-sm font-bold text-gray-700 hover:bg-gray-50">再読み込み</button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryCard label="全体の状態" value={severityStyle[severity].label} note={`${rows.length}アカウントを確認`} />
        <SummaryCard label="最後の確認" value={formatOperationDate(checkedDates[0] ?? null)} note="自動確認の最新記録" />
        <SummaryCard label="今月の配信残数" value={quotaRemaining} note={quotaLimit == null ? 'LINEから取得できたときだけ表示' : `上限 ${quotaLimit.toLocaleString('ja-JP')}通`} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <section className="border-hairline rounded-card overflow-hidden border bg-white">
          <div className="border-hairline border-b px-4 py-3"><h2 className="text-sm font-bold text-gray-900">チェック結果</h2></div>
          {rows.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">確認対象のLINEアカウントがありません。</p> : (
            <div className="divide-y divide-gray-100">{rows.map((row) => (
              <button key={row.accountId} onClick={() => setSelectedId(row.accountId)} className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 ${selected?.accountId === row.accountId ? 'bg-accent-soft' : ''}`}>
                <StatusPill severity={row.severity} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-gray-900">{row.accountName}</span><span className="block text-xs text-gray-500">{formatOperationDate(row.checkedAt)}</span></span>
              </button>
            ))}</div>
          )}
        </section>
        <section className="border-hairline rounded-card border bg-white p-5">
          <h2 className="text-sm font-bold text-gray-900">エラー内容</h2>
          {!selected ? <p className="mt-5 text-sm text-gray-500">確認結果を選んでください。</p> : selected.severity === 'normal' ? <div className="mt-4 rounded-control bg-emerald-50 p-4 text-sm text-emerald-800">このアカウントに異常はありません。</div> : selected.severity === 'unknown' ? <div className="mt-4 rounded-control bg-gray-50 p-4 text-sm text-gray-700">確認記録がありません。次回の自動確認後に結果が表示されます。</div> : (
            <div className="mt-4 space-y-4">
              <div className="rounded-control border border-red-200 bg-red-50 p-4">
                <div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-red-800">{selected.accountName}</p><StatusPill severity={selected.severity} /></div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-gray-500">エラーコード</dt><dd className="mt-1 font-bold text-gray-900">{selected.errorCode ?? 'なし'}</dd></div><div><dt className="text-xs text-gray-500">発生回数</dt><dd className="mt-1 font-bold text-gray-900">{selected.errorCount}回</dd></div></dl>
              </div>
              <div className="flex flex-wrap gap-2"><button onClick={() => exportReport(selected)} className="rounded-control border-hairline min-h-11 border bg-white px-4 text-sm font-bold text-gray-700 hover:bg-gray-50">調査レポートを出力</button><Link href="/emergency?tab=control" className="rounded-control inline-flex min-h-11 items-center bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700">緊急停止する</Link></div>
            </div>
          )}
          <details className="border-hairline mt-5 rounded-control border bg-gray-50"><summary className="cursor-pointer px-4 py-3 text-sm font-bold text-gray-800">異常とする基準</summary><div className="space-y-3 border-t border-gray-200 px-4 py-4">{HEALTH_CRITERIA.map((criterion) => <div key={criterion.severity} className="grid grid-cols-[auto_1fr] gap-3 text-xs"><StatusPill severity={criterion.severity} /><div><p className="font-bold text-gray-800">{criterion.condition}</p><p className="mt-1 text-gray-500">{criterion.action}</p></div></div>)}</div></details>
        </section>
      </div>
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
      <div className={`rounded-card border px-4 py-3 ${snapshot ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}><p className={`text-sm font-bold ${snapshot ? 'text-red-800' : 'text-emerald-800'}`}>{snapshot ? '緊急停止中です' : '配信は通常状態です'}</p><p className="mt-1 text-xs text-gray-600">{snapshot ? `${snapshot.accountName}・${formatOperationDate(snapshot.stoppedAt)}から停止中` : '対象と理由を選び、確認してから停止します。'}</p></div>
      {message && <div className={`rounded-control px-4 py-3 text-sm font-bold ${message.tone === 'success' ? 'bg-emerald-50 text-emerald-800' : message.tone === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800'}`}>{message.text}</div>}
      <section className={`border-hairline rounded-card border bg-white p-5 ${snapshot ? 'pointer-events-none opacity-50' : ''}`}>
        <div><h2 className="text-base font-bold text-gray-900">緊急停止</h2><p className="mt-1 text-xs text-gray-500">停止対象を実行直前に取得します。</p></div>
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2"><div><label className="text-xs font-bold text-gray-700" htmlFor="emergency-account">対象アカウント</label><select id="emergency-account" value={targetAccountId} onChange={(event) => setTargetAccountId(event.target.value)} className="border-hairline rounded-control mt-2 min-h-11 w-full border bg-white px-3 text-sm"><option value="all">すべてのアカウント</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div><div><label className="text-xs font-bold text-gray-700" htmlFor="emergency-reason">停止理由</label><select id="emergency-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="border-hairline rounded-control mt-2 min-h-11 w-full border bg-white px-3 text-sm"><option>障害対応</option><option>誤配信の防止</option><option>アカウント異常</option><option>メンテナンス</option><option>その他</option></select></div></div>
        <div className="border-hairline mt-5 overflow-hidden rounded-control border">{(Object.keys(targetLabels) as StopTarget[]).map((key) => <label key={key} className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0 hover:bg-gray-50"><input type="checkbox" checked={targets[key]} onChange={(event) => setTargets((current) => ({ ...current, [key]: event.target.checked }))} className="h-4 w-4 accent-red-600" /><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-gray-900">{targetLabels[key].label}</span><span className="block text-xs text-gray-500">{targetLabels[key].note}</span></span></label>)}</div>
        <div className="mt-5"><label className="text-xs font-bold text-gray-700" htmlFor="emergency-detail">補足（任意）</label><textarea id="emergency-detail" value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} rows={2} placeholder="発生していることを短く入力" className="border-hairline rounded-control mt-2 w-full border px-3 py-2 text-sm" /></div>
        <div className="mt-5 flex justify-end"><button onClick={openStopConfirm} disabled={running || Boolean(snapshot)} className="rounded-control min-h-11 bg-red-600 px-5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">緊急停止する</button></div>
      </section>
      {snapshot && <section className="rounded-card border border-blue-200 bg-blue-50 p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-sm font-bold text-blue-900">停止前の状態へ戻す</h2><p className="mt-1 text-xs text-blue-800">期限を過ぎた予約配信は安全のため再開しません。</p></div><button onClick={() => { setConfirmWord(''); setConfirmMode('restore') }} disabled={running} className="rounded-control border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-800 hover:bg-blue-100">復旧する</button></div></section>}
      {confirmMode && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="emergency-confirm-title"><div className="rounded-card w-full max-w-lg bg-white p-6 shadow-2xl"><h2 id="emergency-confirm-title" className="text-lg font-bold text-gray-900">{confirmMode === 'stop' ? '緊急停止の最終確認' : '復旧の最終確認'}</h2><div className={`mt-4 rounded-control p-4 text-sm ${confirmMode === 'stop' ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-900'}`}>{confirmMode === 'stop' ? <><p className="font-bold">{accountName}</p><p className="mt-1">{selectedTargets.map((key) => targetLabels[key].label).join('・')}</p><p className="mt-1">理由：{fullReason}</p></> : <><p className="font-bold">{snapshot?.accountName}</p><p className="mt-1">停止前に動いていた配信を再開します。</p></>}</div><label className="mt-4 block text-sm font-bold text-gray-800" htmlFor="emergency-confirm-word">確認のため「{confirmMode === 'stop' ? '停止' : '復旧'}」と入力</label><input id="emergency-confirm-word" value={confirmWord} onChange={(event) => setConfirmWord(event.target.value)} autoFocus className="border-hairline rounded-control mt-2 min-h-11 w-full border px-3 text-sm" /><div className="mt-5 flex justify-end gap-2"><button onClick={() => { setConfirmMode(null); setConfirmWord('') }} disabled={running} className="rounded-control border-hairline min-h-11 border px-4 text-sm font-bold text-gray-700">キャンセル</button><button onClick={() => void (confirmMode === 'stop' ? runStop() : runRestore())} disabled={running || confirmWord !== (confirmMode === 'stop' ? '停止' : '復旧')} className={`rounded-control min-h-11 px-4 text-sm font-bold text-white disabled:opacity-40 ${confirmMode === 'stop' ? 'bg-red-600' : 'bg-blue-700'}`}>{running ? '実行中...' : '実行する'}</button></div></div></div>}
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
  return <div className="space-y-4" data-design="V3 Update history"><div className="rounded-card border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-900">緊急操作とシステム更新は自動で記録されます。</div><div className="grid grid-cols-1 gap-3 md:grid-cols-3"><SummaryCard label="緊急操作" value={`${operations.length}件`} note="この端末に保存された履歴" /><SummaryCard label="システム更新" value={updateState === 'ready' ? `${updates.length}件` : '—'} note={updateState === 'unconfigured' ? '自動更新は未構成' : '取得できた更新履歴'} /><SummaryCard label="最後の緊急操作" value={formatOperationDate(operations[0]?.occurredAt ?? null)} note={operations[0]?.title ?? 'まだありません'} /></div><div className="border-hairline rounded-card overflow-hidden border bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3"><h2 className="text-sm font-bold text-gray-900">履歴</h2><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="border-hairline rounded-control min-h-10 border bg-white px-3 text-sm"><option value="all">すべて</option><option value="operation">緊急操作</option><option value="update">システム更新</option></select></div>{updateState === 'error' && <p className="bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">システム更新の履歴を取得できませんでした。</p>}{entries.length === 0 ? <p className="p-8 text-center text-sm text-gray-500">履歴はまだありません。</p> : <div className="divide-y divide-gray-100">{entries.map((entry) => <div key={entry.id} className="grid gap-2 px-4 py-4 md:grid-cols-[150px_120px_1fr_auto] md:items-center"><time className="text-xs text-gray-500">{formatOperationDate(entry.occurredAt)}</time><span className="text-xs font-bold text-gray-600">{entry.type === 'operation' ? '緊急操作' : 'システム更新'}</span><div><p className="text-sm font-bold text-gray-900">{entry.title}</p><p className="mt-1 text-xs text-gray-500">{entry.detail}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${entry.status === 'success' ? 'bg-emerald-100 text-emerald-700' : entry.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{entry.status === 'success' ? '完了' : entry.status === 'failed' ? '失敗' : entry.status === 'partial' ? '一部失敗' : entry.status}</span></div>)}</div>}</div></div>
}

function EmergencyPageInner() {
  const tab = useMergedTab(TABS)
  const [severity, setSeverity] = useState<OperationSeverity>('unknown')
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  useEffect(() => { api.health.accounts().then((response) => { if (response.success) setAccounts(response.data) }).catch(() => undefined) }, [])
  return <div><Header title="運用状態" description="問題を確認し、必要なときだけ配信を止めます。" action={severity === 'danger' || severity === 'warning' ? <StatusPill severity={severity} /> : undefined} /><MergedTabs basePath="/emergency" tabs={TABS} active={tab} />{tab === 'health' && <HealthPanel onSeverity={setSeverity} />}{tab === 'control' && <EmergencyControlPanel accounts={accounts} />}{tab === 'history' && <HistoryPanel />}</div>
}

export default function EmergencyPage() {
  return <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}><EmergencyPageInner /></Suspense>
}
