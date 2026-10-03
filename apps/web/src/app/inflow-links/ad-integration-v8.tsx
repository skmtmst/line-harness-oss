'use client'

/*
 * ★V8-B 広告連携（板 `qSTVR`）・広告とのつなぎ（板 `FDBsG`）・
 * 広告への送信履歴（板 `p0kA3`）。
 *
 * v7 の広告タブ（`ad-integration.tsx`）とは別の見せ方。取ってくる口・
 * 取り込み・手入力・取消し・書き出しの動きは v7 と同じ。口に無い所
 * （つなぐ操作・対応表の件数・媒体の絞り込み・流入元の紐づけ）は作らず、
 * 今の形のままか「—」にする。v7 を直す必要が出たら
 * `ad-integration.tsx` 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import Link from 'next/link'
import type React from 'react'
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BadgeDollarSign, Megaphone, UserPlus, Wallet } from 'lucide-react'
import { api, type AdConversionLog, type AdPlatform } from '@/lib/api'
import type { ApiResponse, EntryRoute } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import DateField from '@/components/shared/date-field'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { RowActions } from '@/components/shared/row-actions'
import { TableHeadRow, Th } from '@/components/shared/table'
import styles from './ad-integration-v8.module.css'

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
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0 8px' }}>
      {totals.map((total) => <span key={total.currency}>{formatMinor(total.amountMinor, total.currency)}</span>)}
    </span>
  )
}

/** 取込日時の短い表示(9/25 06:00)。 */
function shortDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function platformLabel(platform: AdPlatform): string {
  return PROVIDERS.find((provider) => provider.key === platform.name)?.label
    ?? platform.displayName
    ?? platform.name
}

function syncLabel(platform: AdPlatform): string | null {
  const syncedAt = platform.config.synced_at
  if (typeof syncedAt !== 'string' || !syncedAt) return null
  const date = new Date(syncedAt)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
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

function logDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'

/*
 * 3つの画面で同じ口を使う。v7 の `AdIntegration` の取ってくる所と
 * 同じ順番・同じ口。取り直しは `reload` にまとめる。
 */
function useAdV8Model() {
  const { selectedAccountId } = useAccount()
  const loadGenerationRef = useRef(0)
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const [platforms, setPlatforms] = useState<AdPlatform[]>([])
  const [logs, setLogs] = useState<AdConversionLog[]>([])
  const [logTotal, setLogTotal] = useState(0)
  const [logSummary, setLogSummary] = useState<{
    sentLast30Days: number
    pendingLast30Days: number
    failedLast30Days: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [logPage, setLogPage] = useState(1)
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
  const [costRows, setCostRows] = useState<AdCostRow[]>([])
  const [costPlatforms, setCostPlatforms] = useState<AdCostPlatformStatus[]>([])
  const [costFailed, setCostFailed] = useState(false)
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
    const isCurrent = () => generation === loadGenerationRef.current
      && accountAtRequest === latestAccountRef.current
    setLoading(true)
    setFailed(false)
    try {
      const [platformResponse, logResponse, costResponse, routeResponse] = await Promise.all([
        api.adPlatforms.list(accountAtRequest),
        api.adPlatforms.logsPage({
          page: logPage,
          limit: LOG_PAGE_SIZE,
          status,
          query,
          lineAccountId: accountAtRequest,
        }),
        api.adCosts.list({ accountId: accountAtRequest }),
        api.entryRoutes.list(accountAtRequest),
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
      if (routeResponse.success) setEntryRoutes(routeResponse.data)
      if (costResponse.success) {
        setCostRows((costResponse.data.rows ?? []) as AdCostRow[])
        setCostPlatforms((costResponse.data.platforms ?? []) as AdCostPlatformStatus[])
        setManualEntries((costResponse.data.manualEntries ?? []) as ManualCostEntry[])
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
  }, [logPage, query, selectedAccountId, status])

  useEffect(() => {
    setPlatforms([])
    setLogs([])
    setLogTotal(0)
    setLogSummary(null)
    void load()
    return () => {
      loadGenerationRef.current += 1
    }
  }, [load])

  useEffect(() => {
    if (!selectedAccountId) {
      setCanManage(false)
      return
    }
    let active = true
    void api.staff
      .me()
      .then((response) => {
        if (!active) return
        setCanManage(
          response.success && (response.data.role === 'owner' || response.data.role === 'admin'),
        )
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [selectedAccountId])

  const openManualEntry = useCallback(() => {
    setManualError('')
    setManualOpen(true)
  }, [])

  const submitManualEntry = useCallback(async () => {
    if (!selectedAccountId || manualBusy) return
    if (!manualLabel.trim()) {
      setManualError('流入元の名前を入れてください')
      return
    }
    if (!manualDay) {
      setManualError('費用の日付を選んでください')
      return
    }
    if (!manualAmount.trim()) {
      setManualError('費用を入力してください')
      return
    }
    const amount = Number(manualAmount)
    if (!Number.isInteger(amount) || amount < 0) {
      setManualError('費用は0以上の整数(円)で入れてください')
      return
    }
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
      if (!res.success) {
        setManualError(res.error ?? '記録できませんでした')
        return
      }
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

  const submitCancel = useCallback(async () => {
    if (!cancelTarget || cancelBusy) return
    const reason = cancelReason.trim()
    if (!reason) {
      setCancelError('取り消す理由を入れてください')
      return
    }
    setCancelBusy(true)
    setCancelError('')
    try {
      const res = await api.adCosts.cancel(cancelTarget.id, reason)
      if (!res.success) {
        setCancelError(res.error ?? '取り消せませんでした')
        return
      }
      setCancelTarget(null)
      void load()
    } catch {
      setCancelError('取り消せませんでした。通信状態を確かめて、もう一度お試しください。')
    } finally {
      setCancelBusy(false)
    }
  }, [cancelTarget, cancelBusy, cancelReason, load])

  const runImportNow = useCallback(
    async (platformId: string) => {
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
    },
    [importingId, load],
  )

  const exportLogs = useCallback(() => {
    const blob = new Blob([`﻿${safeCsv(logs)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `広告への送信履歴_${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [logs])

  const connected = platforms.filter((platform) => platform.isActive)
  const matchesLogStatus = (log: AdConversionLog) => {
    if (status === 'all') return true
    if (status === 'sent') return log.status === 'sent' || log.status === 'success'
    return log.status === status
  }
  const sentCount = logSummary?.sentLast30Days
    ?? logs.filter((log) => log.status === 'sent' || log.status === 'success').length
  const pendingCount = logSummary?.pendingLast30Days
    ?? logs.filter((log) => log.status === 'pending').length
  const failedCount = logSummary?.failedLast30Days
    ?? logs.filter((log) => log.status === 'failed').length
  const logPageCount = Math.max(1, Math.ceil(logTotal / LOG_PAGE_SIZE))
  const safeLogPage = Math.min(logPage, logPageCount)

  const totalCostByCurrency = new Map<string, number>()
  for (const row of costRows) {
    for (const total of row.totals) {
      totalCostByCurrency.set(
        total.currency,
        (totalCostByCurrency.get(total.currency) ?? 0) + total.amountMinor,
      )
    }
  }
  const linkedJpyRows = costRows.filter(
    (row) => row.entryRouteId && row.totals.some((total) => total.currency === 'JPY'),
  )
  const addsByRoute = new Map<string, number>()
  for (const row of linkedJpyRows) {
    if (row.entryRouteId && !addsByRoute.has(row.entryRouteId)) {
      addsByRoute.set(row.entryRouteId, row.friendAdds ?? 0)
    }
  }
  const linkedFriendAdds = [...addsByRoute.values()].reduce((sum, count) => sum + count, 0)
  const linkedJpyCost = linkedJpyRows.reduce(
    (sum, row) => sum + (row.totals.find((total) => total.currency === 'JPY')?.amountMinor ?? 0),
    0,
  )
  const avgCostPerFriend = linkedFriendAdds > 0 ? Math.round(linkedJpyCost / linkedFriendAdds) : null
  const routeRefById = new Map(entryRoutes.map((route) => [route.id, route.refCode]))

  return {
    selectedAccountId,
    platforms,
    connected,
    logs,
    logTotal,
    loading,
    failed,
    reload: load,
    query,
    setQueryAndPage: (value: string) => {
      setQuery(value)
      setLogPage(1)
    },
    status,
    setStatusAndPage: (value: string) => {
      setStatus(value)
      setLogPage(1)
    },
    logPage: safeLogPage,
    setLogPage,
    logPageCount,
    expandedLogId,
    setExpandedLogId,
    sentCount,
    pendingCount,
    failedCount,
    costRows,
    costPlatforms,
    manualEntries,
    costFailed,
    canManage,
    cancelTarget,
    setCancelTarget: (entry: ManualCostEntry | null) => {
      setCancelTarget(entry)
      setCancelReason('')
      setCancelError('')
    },
    cancelReason,
    setCancelReason,
    cancelBusy,
    cancelError,
    submitCancel,
    manualOpen,
    setManualOpen,
    openManualEntry,
    manualBusy,
    manualError,
    manualLabel,
    setManualLabel,
    manualRouteId,
    setManualRouteId: (value: string) => {
      setManualRouteId(value)
      const route = entryRoutes.find((item) => item.id === value)
      if (route && !manualLabel.trim()) setManualLabel(route.name)
    },
    manualDay,
    setManualDay,
    manualAmount,
    setManualAmount,
    entryRoutes,
    submitManualEntry,
    importingId,
    importError,
    runImportNow,
    exportLogs,
    totalCostByCurrency,
    linkedFriendAdds,
    avgCostPerFriend,
    routeRefById,
    matchesLogStatus,
  }
}

type AdV8Model = ReturnType<typeof useAdV8Model>

function AdV8Gate({
  model,
  loadingTitle,
  children,
}: {
  model: AdV8Model
  loadingTitle: string
  children: ReactNode
}) {
  if (!model.selectedAccountId) {
    return (
      <ListState
        kind="empty"
        title="LINEアカウントを選択してください"
        description="選んだLINEアカウントの広告費だけを表示します。"
      />
    )
  }
  if (model.loading) {
    return <ListState kind="loading" title={loadingTitle} />
  }
  if (model.failed) {
    return (
      <ListState
        kind="error"
        title="広告との接続状況を表示できませんでした"
        description="接続設定は消えていません。状態を読み直して、もう一度お試しください。"
        action={<Button onClick={() => void model.reload()}>広告の状態を再読み込み</Button>}
      />
    )
  }
  return <>{children}</>
}

function StatusPill({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? '状態不明'
  const tone =
    status === 'failed'
      ? styles.statePillDanger
      : status === 'pending'
        ? styles.statePillInfo
        : status === 'sent' || status === 'success'
          ? styles.statePillActive
          : styles.statePillMuted
  return (
    <span className={`${styles.statePill} ${tone}`}>
      <span className={styles.statePillDot} aria-hidden="true" />
      {label}
    </span>
  )
}

function ManualEntryDialogs({ model }: { model: AdV8Model }) {
  return (
    <>
      <Dialog
        open={model.manualOpen}
        title="広告費を手で入れる"
        description="媒体から取り込めない分（チラシや看板など）を日ごとに記録します。同じ流入元・同じ日に入れ直すと上書きになります。"
        confirmLabel="記録する"
        busy={model.manualBusy}
        error={model.manualError}
        onConfirm={() => void model.submitManualEntry()}
        onCancel={() => {
          if (!model.manualBusy) model.setManualOpen(false)
        }}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-secondary" htmlFor="ad-cost-label-v8">流入元の名前</label>
            <TextField
              id="ad-cost-label-v8"
              value={model.manualLabel}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => model.setManualLabel(event.target.value)}
              placeholder="例: チラシ"
              maxLength={100}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-secondary" htmlFor="ad-cost-route-v8">計測リンク（分かれば）</label>
            <Select
              id="ad-cost-route-v8"
              aria-label="計測リンク"
              value={model.manualRouteId}
              onChange={model.setManualRouteId}
              options={[
                { value: '', label: '結びつけない' },
                ...model.entryRoutes.map((route) => ({ value: route.id, label: route.name })),
              ]}
            />
            <p className="mt-1 text-xs text-ink-faint">結びつけると友だち追加の人数で「1人あたり」が出ます。</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-secondary" htmlFor="ad-cost-day-v8">費用の日付</label>
            <DateField id="ad-cost-day-v8" value={model.manualDay} onChange={model.setManualDay} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-secondary" htmlFor="ad-cost-amount-v8">費用（円）</label>
            <TextField
              id="ad-cost-amount-v8"
              inputMode="numeric"
              value={model.manualAmount}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => model.setManualAmount(event.target.value)}
              placeholder="例: 20000"
            />
          </div>
        </div>
      </Dialog>

      <Dialog
        open={model.cancelTarget !== null}
        title="この費用を取り消す"
        description="取り消すと集計と「1人あたり」から外れます。記録そのものは残り、取り消した理由と日時が履歴に残ります。同じ流入元・同じ日に入れ直すと新しい記録として戻ります。"
        confirmLabel="取り消す"
        busy={model.cancelBusy}
        error={model.cancelError}
        onConfirm={() => void model.submitCancel()}
        onCancel={() => {
          if (!model.cancelBusy) model.setCancelTarget(null)
        }}
      >
        {model.cancelTarget ? (
          <div className="space-y-4">
            <p className="text-xs text-ink-secondary">
              対象:{' '}
              <strong>
                {model.cancelTarget.day} ／ {model.cancelTarget.sourceLabel} ／{' '}
                {formatMinor(model.cancelTarget.amountMinor, model.cancelTarget.currency)}
              </strong>
            </p>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-secondary" htmlFor="ad-cost-cancel-reason-v8">取り消す理由（必須）</label>
              <TextField
                id="ad-cost-cancel-reason-v8"
                value={model.cancelReason}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => model.setCancelReason(event.target.value)}
                placeholder="例: 金額を間違えた"
                maxLength={200}
              />
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  )
}

/**
 * ★V8-B 広告連携（板 `qSTVR`）。
 * 広告をつなぐと毎日自動で費用を取り込みます。取り込めない分
 * （チラシや看板など）は「費用を手で入れる」から足せます。
 */
export function AdMetricsV8() {
  usePageTitle('広告連携')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: '流入と計測', href: '/inflow-links' },
  ])
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  const model = useAdV8Model()

  const jpyTotal = model.totalCostByCurrency.get('JPY') ?? null
  const otherTotals = [...model.totalCostByCurrency].filter(([currency]) => currency !== 'JPY')

  return (
    <AdV8Gate model={model} loadingTitle="広告連携を読み込んでいます">
      <div className={styles.board} data-design-node="qSTVR">
        <div className={styles.head}>
          <div className={styles.headText}>
            <p className={styles.headBack}>
              <Link href="/inflow-links" className={styles.headBackLink}>
                ← 流入と計測へ
              </Link>
            </p>
            <h1 className={styles.headTitle}>広告連携</h1>
            <p className={styles.headDescription}>
              広告をつなぐと毎日自動で費用を取り込みます。取り込めない分（チラシや看板など）は「費用を手で入れる」から足せます。
            </p>
          </div>
          <div className={styles.headActions}>
            {canEdit ? (
              <Button variant="secondary" onClick={model.openManualEntry}>
                ＋ 費用を手で入れる
              </Button>
            ) : (
              <Button type="button" variant="secondary" disabled title={READONLY_REASON}>
                ＋ 費用を手で入れる
              </Button>
            )}
          </div>
        </div>

        {!canEdit ? (
          <Notice tone="info" message="閲覧のみで見ています。変える操作は管理者に頼んでください。" />
        ) : null}

        <ul className={styles.kpis} aria-label="広告連携の概要">
          <li className={styles.kpi}>
            <span className={styles.kpiLabel}>
              <Wallet size={13} aria-hidden="true" />
              この30日の広告費
            </span>
            <p className={styles.kpiValue}>
              {jpyTotal != null ? (
                <>¥{formatNumber(jpyTotal)}</>
              ) : otherTotals.length > 0 ? (
                <>{formatMinor(otherTotals[0][1], otherTotals[0][0])}</>
              ) : (
                '—'
              )}
            </p>
            <p className={styles.kpiDetail}>選んだLINEアカウントの分だけ</p>
          </li>
          <li className={styles.kpi}>
            <span className={styles.kpiLabel}>
              <Megaphone size={13} aria-hidden="true" />
              つないだ広告
            </span>
            <p className={styles.kpiValue}>
              {formatNumber(model.connected.length)}
              <span className={styles.kpiUnit}>件</span>
            </p>
            <p className={styles.kpiDetail}>
              {model.connected.length > 0
                ? model.connected.map(platformLabel).join('・')
                : 'まだ接続がありません'}
            </p>
          </li>
          <li className={styles.kpi}>
            <span className={styles.kpiLabel}>
              <UserPlus size={13} aria-hidden="true" />
              友だち1人あたり
            </span>
            <p className={styles.kpiValue}>
              {model.avgCostPerFriend != null ? (
                <>¥{formatNumber(model.avgCostPerFriend)}</>
              ) : (
                '—'
              )}
            </p>
            <p className={styles.kpiDetail}>友だち追加 {formatNumber(model.linkedFriendAdds)}人</p>
          </li>
          <li className={styles.kpi}>
            <span className={styles.kpiLabel}>
              <BadgeDollarSign size={13} aria-hidden="true" />
              成果1件あたり
            </span>
            <p className={styles.kpiValue}>—</p>
            <p className={styles.kpiDetail}>認めた成果の件数は未接続のため表示できません</p>
          </li>
        </ul>

        <section className={styles.card} aria-label="媒体ごとの接続">
          <div className={styles.providerGrid}>
            {PROVIDERS.map((provider) => {
              const platform = model.platforms.find((item) => item.name === provider.key)
              const active = platform?.isActive === true
              const synced = platform ? syncLabel(platform) : null
              return (
                <div key={provider.key} className={styles.providerCard}>
                  <div className={styles.providerNameRow}>
                    <span className={styles.providerName}>{provider.label}</span>
                    {active ? (
                      <span className={`${styles.statePill} ${styles.statePillActive}`}>
                        <span className={styles.statePillDot} aria-hidden="true" />
                        つないでいる
                      </span>
                    ) : (
                      <span className={`${styles.statePill} ${styles.statePillMuted}`}>
                        <span className={styles.statePillDot} aria-hidden="true" />
                        未接続
                      </span>
                    )}
                  </div>
                  <p className={styles.providerSub}>
                    {active
                      ? `最後の取り込み ${synced ?? '—'}・毎日自動`
                      : 'つなぐと費用とクリックを毎日取り込みます'}
                  </p>
                  {active && platform ? (
                    <Button
                      variant="secondary"
                      disabled={model.importingId === platform.id}
                      busy={model.importingId === platform.id}
                      busyLabel="取り込んでいます…"
                      onClick={() => void model.runImportNow(platform.id)}
                    >
                      広告の状態を再読み込み
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>
          {model.importError ? (
            <p role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--color-danger)' }}>
              {model.importError}
            </p>
          ) : null}
        </section>

        <section className={styles.card} aria-labelledby="ad-v8-costs">
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle} id="ad-v8-costs">
                流入元ごとの費用
              </h2>
              <p className={styles.cardNote}>
                取り込んだ費用と手入力の分です。取れない日は「—」になります。
              </p>
            </div>
          </div>
          {model.costFailed ? (
            <ListState
              kind="error"
              title="広告費を読み込めませんでした"
              description="記録は消えていません。もう一度読み込んでください。"
              action={<Button onClick={() => void model.reload()}>もう一度読み込む</Button>}
            />
          ) : model.costRows.length === 0 ? (
            <ListState
              kind="empty"
              title="まだ費用の記録がありません"
              description="広告をつなぐと毎日自動で取り込みます。取り込めない分は「費用を手で入れる」から足せます。"
            />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <colgroup>
                  <col />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 170 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 130 }} />
                </colgroup>
                <thead>
                  <TableHeadRow>
                    <Th>流入元</Th>
                    <Th>媒体</Th>
                    <Th>計測リンク</Th>
                    <Th align="right">この30日の費用</Th>
                    <Th align="right">友だち追加</Th>
                    <Th align="right">1人あたり</Th>
                    <Th>取り込み</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {model.costRows.map((row) => {
                    const platform = model.platforms.find((item) => item.id === row.adPlatformId)
                    const refCode = row.entryRouteId
                      ? (model.routeRefById.get(row.entryRouteId) ?? null)
                      : null
                    return (
                      <tr key={`${row.sourceLabel}|${row.adPlatformId ?? ''}|${row.entryRouteId ?? ''}`}>
                        <td>
                          <span className={styles.cellMain} title={row.sourceLabel}>
                            {row.sourceLabel}
                          </span>
                        </td>
                        <td>
                          <span className={styles.cellEllipsis}>
                            {platform ? platformLabel(platform) : row.source === 'manual' ? '手入力' : '—'}
                          </span>
                        </td>
                        <td>
                          <span className={styles.cellEllipsis} title={refCode ?? undefined}>
                            {refCode ?? '—'}
                          </span>
                        </td>
                        <td className={styles.numeric}>
                          <span className={styles.cellValue}>{formatCostTotals(row.totals)}</span>
                        </td>
                        <td className={styles.numeric}>
                          <span className={styles.cellValue}>
                            {row.friendAdds == null ? '—' : `${formatNumber(row.friendAdds)}人`}
                          </span>
                        </td>
                        <td className={styles.numeric}>
                          <span className={styles.cellValue}>
                            {row.costPerFriendMinor == null
                              ? '—'
                              : formatMinor(row.costPerFriendMinor, row.totals[0]?.currency ?? 'JPY')}
                          </span>
                        </td>
                        <td>
                          {row.source === 'manual' ? (
                            <span className={`${styles.statePill} ${styles.statePillMuted}`}>
                              <span className={styles.statePillDot} aria-hidden="true" />
                              手入力
                            </span>
                          ) : (
                            <span className={`${styles.statePill} ${styles.statePillActive}`}>
                              <span className={styles.statePillDot} aria-hidden="true" />
                              自動
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.cardNote} style={{ marginTop: 8 }}>
            取り込んだ費用と手入力の分です。取れない日は「—」になります。秘密の鍵は画面に表示しません。
          </p>
        </section>

        {model.manualEntries.length > 0 ? (
          <section className={styles.card} aria-labelledby="ad-v8-manual">
            <h2 className={styles.cardTitle} id="ad-v8-manual">
              手で入れた費用
            </h2>
            <p className={styles.cardNote}>
              行の「…」から取り消すと、その日の費用は集計から外れます。
            </p>
            <ul className={styles.manualList}>
              {model.manualEntries.map((entry) => {
                const cancelled = entry.cancelledAt != null
                return (
                  <li key={entry.id} className={styles.manualItem}>
                    <div>
                      <p className={`${styles.manualMain} ${cancelled ? styles.manualMainCancelled : ''}`}>
                        {entry.day} ／ {entry.sourceLabel} ／{' '}
                        {formatMinor(entry.amountMinor, entry.currency)}
                      </p>
                      {cancelled ? (
                        <p className={styles.manualSub}>
                          取り消し済み（{entry.cancelReason ?? '理由の記録なし'}）— 集計には入りません
                        </p>
                      ) : null}
                    </div>
                    {!cancelled && canEdit ? (
                      <RowActions
                        menuItems={[
                          {
                            id: 'cancel',
                            label: '取り消す',
                            onSelect: () => model.setCancelTarget(entry),
                          },
                        ]}
                        subjectName={`${entry.day} ${entry.sourceLabel}`}
                      />
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        {model.costPlatforms.length > 0 ? (
          <section className={styles.card} aria-labelledby="ad-v8-import">
            <h2 className={styles.cardTitle} id="ad-v8-import">
              広告からの取り込み
            </h2>
            <p className={styles.cardNote}>
              つないだ広告から前日分までを毎日取り込みます。取り込めない日は費用が「—」のままになります。
            </p>
            {model.importError ? (
              <p role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--color-danger)' }}>
                {model.importError}
              </p>
            ) : null}
            <ul className={styles.importList}>
              {model.costPlatforms.map((platform) => (
                <li key={platform.id} className={styles.importItem}>
                  <div>
                    <p className={styles.importMain}>
                      {PROVIDERS.find((provider) => provider.key === platform.name)?.label
                        ?? platform.displayName
                        ?? platform.name}
                    </p>
                    <p className={styles.importSub}>
                      {platform.lastSuccessAt
                        ? `最後に取り込んだのは ${shortDateTime(platform.lastSuccessAt)} です`
                        : 'まだ一度も取り込めていません'}
                      {platform.lastRunStatus === 'failed' && platform.lastError
                        ? ` ／ 直近は取り込めませんでした（${platform.lastError}）`
                        : ''}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={model.importingId === platform.id}
                    onClick={() => void model.runImportNow(platform.id)}
                    busy={model.importingId === platform.id}
                    busyLabel="取り込んでいます…"
                  >
                    いま取り込む
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <ManualEntryDialogs model={model} />
      </div>
    </AdV8Gate>
  )
}

/**
 * ★V8-B 広告とのつなぎ（板 `FDBsG`）。
 * LINE で出た成果を広告へ返し、広告の配信を賢くします。
 * お客様の名前やメールアドレスは広告へ送りません。
 */
export function AdConnectionsV8() {
  usePageTitle('広告とのつなぎ')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: '流入と計測', href: '/inflow-links' },
  ])
  const model = useAdV8Model()

  return (
    <AdV8Gate model={model} loadingTitle="広告とのつなぎを読み込んでいます">
      <div className={styles.board} data-design-node="FDBsG">
        <div className={styles.head}>
          <div className={styles.headText}>
            <p className={styles.headBack}>
              <Link href="/inflow-links" className={styles.headBackLink}>
                ← 流入と計測へ
              </Link>
            </p>
            <h1 className={styles.headTitle}>広告とのつなぎ</h1>
            <p className={styles.headDescription}>
              LINE で出た成果を広告へ返し、広告の配信を賢くします。お客様の名前やメールアドレスは広告へ送りません。
            </p>
          </div>
          <div className={styles.headActions}>
            <Button variant="secondary" href="/inflow-links?tab=connections&view=history">
              送信履歴を見る
            </Button>
          </div>
        </div>

        <section aria-label="返ししくみ">
          <h2 className={styles.cardTitle}>返ししくみ</h2>
          <div className={styles.stepsGrid}>
            <div className={styles.stepCard}>
              <p className={styles.stepTitle}>
                <span className={styles.stepNum} aria-hidden="true">
                  1
                </span>
                クリックの目印を持ち帰る
              </p>
              <p className={styles.stepText}>
                広告から中継リンクを通った人の目印を残します。中継リンクを通らないと広告と結びつきません。
              </p>
            </div>
            <div className={styles.stepCard}>
              <p className={styles.stepTitle}>
                <span className={styles.stepNum} aria-hidden="true">
                  2
                </span>
                成果が出たら順に送る
              </p>
              <p className={styles.stepText}>
                成果地点で数えたら、待ち行列に入れてから広告へ送ります。
              </p>
            </div>
            <div className={styles.stepCard}>
              <p className={styles.stepTitle}>
                <span className={styles.stepNum} aria-hidden="true">
                  3
                </span>
                同じ成果は2回送らない
              </p>
              <p className={styles.stepText}>
                やり直しても同じ目印を使います。広告側で2重に数えられません。
              </p>
            </div>
          </div>
        </section>

        <ul className={styles.kpis} aria-label="広告への送信の概要">
          <li className={styles.kpi}>
            <span className={styles.kpiLabel}>送った件数</span>
            <p className={styles.kpiValue}>
              {formatNumber(model.sentCount)}
              <span className={styles.kpiUnit}>件</span>
            </p>
            <p className={styles.kpiDetail}>この30日</p>
          </li>
          <li className={styles.kpi}>
            <span className={styles.kpiLabel}>待っている</span>
            <p className={styles.kpiValue}>
              {formatNumber(model.pendingCount)}
              <span className={styles.kpiUnit}>件</span>
            </p>
            <p className={styles.kpiDetail}>送信処理を待っています</p>
          </li>
          <li className={styles.kpi}>
            <span className={styles.kpiLabel}>断られた</span>
            <p className={`${styles.kpiValue} ${model.failedCount > 0 ? styles.kpiValueDanger : ''}`}>
              {formatNumber(model.failedCount)}
              <span className={styles.kpiUnit}>件</span>
            </p>
            <p className={styles.kpiDetail}>理由を確認してください</p>
          </li>
          <li className={styles.kpi}>
            <span className={styles.kpiLabel}>やり直して成功</span>
            <p className={styles.kpiValue}>—</p>
            <p className={styles.kpiDetail}>二重にはなっていません</p>
          </li>
        </ul>

        <section className={styles.card} aria-labelledby="ad-v8-mapping">
          <h2 className={styles.cardTitle} id="ad-v8-mapping">
            成果地点と、広告に返す名前の対応
          </h2>
          <p className={styles.cardNote}>
            左がうちの成果地点、右が広告側の名前です。対応が付いていないものは返せません。
          </p>
          <ListState
            kind="empty"
            title="対応表はまだ表示できません"
            description="成果地点と広告側の名前の対応を取れていないため、件数は表示しません。対応が取れたらここに並びます。"
          />
          <p className={styles.cardNote} style={{ marginTop: 8 }}>
            気をつけること：広告側で成果の名前を先に作ってから対応を決めてください。失敗した送信のやり直しは、送信履歴から行えます。
          </p>
        </section>
      </div>
    </AdV8Gate>
  )
}

/**
 * ★V8-B 広告への送信履歴（板 `p0kA3`）。
 * 成果と広告のクリックが結びつき、送信処理が始まるとここに並びます。
 */
export function AdHistoryV8() {
  usePageTitle('広告への送信履歴')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: '流入と計測', href: '/inflow-links' },
    { label: '広告とのつなぎ', href: '/inflow-links?tab=connections' },
  ])
  const model = useAdV8Model()

  return (
    <AdV8Gate model={model} loadingTitle="広告への送信履歴を読み込んでいます">
      <div className={styles.board} data-design-node="p0kA3">
        <div className={styles.head}>
          <div className={styles.headText}>
            <p className={styles.headBack}>
              <Link href="/inflow-links?tab=connections" className={styles.headBackLink}>
                ← 広告とのつなぎへ戻る
              </Link>
            </p>
            <h1 className={styles.headTitle}>広告への送信履歴</h1>
            <p className={styles.headDescription}>
              成果と広告のクリックが結びつき、送信処理が始まるとここに並びます。
            </p>
          </div>
          <div className={styles.headActions}>
            <Button
              variant="secondary"
              disabled={model.logs.length === 0}
              onClick={model.exportLogs}
            >
              CSVで書き出す
            </Button>
          </div>
        </div>

        <div className={styles.toolbar}>
          <span className={styles.searchWrap}>
            <SearchField
              value={model.query}
              onChange={model.setQueryAndPage}
              placeholder="成果・クリックの種類で探す"
              aria-label="成果・クリックの種類で探す"
            />
          </span>
          <Select
            value={model.status}
            onChange={model.setStatusAndPage}
            options={STATUS_OPTIONS}
            aria-label="送信状態"
          />
          <span className={styles.toolbarSpacer} />
          <span className={styles.toolbarCount}>全 {formatNumber(model.logTotal)} 件</span>
        </div>

        {model.logs.length === 0 ? (
          <ListState
            kind="empty"
            title="条件に合う送信履歴はありません"
            description="成果と広告のクリックが結びつき、送信処理が始まるとここに並びます。"
          />
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <colgroup>
                  <col />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 150 }} />
                </colgroup>
                <thead>
                  <TableHeadRow>
                    <Th>いつ・何の成果</Th>
                    <Th>媒体</Th>
                    <Th>状態</Th>
                    <Th>次の予定</Th>
                    <Th>操作</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {model.logs.map((log) => {
                    const platform = model.platforms.find((item) => item.id === log.adPlatformId)
                    const expanded = model.expandedLogId === log.id
                    return (
                      <Fragment key={log.id}>
                        <tr>
                          <td>
                            <span className={styles.cellMain} title={log.eventName}>
                              {log.eventName}
                            </span>
                            <span className={styles.cellSub}>{logDateTime(log.createdAt)}</span>
                          </td>
                          <td>
                            <span className={styles.cellEllipsis}>
                              {platform ? platformLabel(platform) : '—'}
                            </span>
                          </td>
                          <td>
                            <StatusPill status={log.status} />
                          </td>
                          <td>
                            <span className={styles.cellMuted}>{nextScheduleText(log)}</span>
                          </td>
                          <td>
                            {log.status === 'failed' ? (
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  model.setExpandedLogId(expanded ? null : log.id)
                                }
                              >
                                {expanded ? '理由を閉じる' : 'やり直す'}
                              </Button>
                            ) : (
                              <span className={styles.cellMuted}>—</span>
                            )}
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className={styles.reasonRow}>
                            <td colSpan={5}>
                              断られた理由: {log.errorMessage || '理由の記録がありません。広告側の接続設定を確かめてください。'}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className={styles.pagerRow}>
              <span className={styles.pagerCount}>全 {formatNumber(model.logTotal)} 件</span>
              <Pagination
                page={model.logPage}
                pageCount={model.logPageCount}
                onPageChange={model.setLogPage}
              />
            </div>
          </>
        )}

        <p className={styles.bottomNote}>
          断られた理由：クリックの目印の期限（90日）が切れていました。やり直しても同じ目印を使うため、2重には数えられません。
        </p>
      </div>
    </AdV8Gate>
  )
}
