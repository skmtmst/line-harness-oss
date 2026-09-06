'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { fetchApi } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import MergedTabs from '@/components/layout/merged-tabs'
import SelectField from '@/components/shared/select-field'
import { usePageTitle } from '@/components/shell/page-chrome'
import FilterChip from '@/components/shared/filter-chip'

type RunStatus = 'queued' | 'claimed' | 'succeeded' | 'skipped' | 'retry_wait' | 'permanent_failed' | 'cancelled'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

type AutomationRun = {
  id: string
  occurredAt: string
  subject: string | null
  accountLabel: string | null
  triggerLabel: string
  status: RunStatus
  detail: string | null
  durationMs: number | null
  automationName: string
  canRetry: false
}

type RunsResponse = {
  summary: {
    total: number
    executed: number
    skipped: number
    failed: number
    mostRunName: string | null
    mostRunCount: number | null
  }
  items: AutomationRun[]
  pagination: { total: number; limit: number; offset: number }
}

const TABS = [
  { key: 'active', label: '動いているもの', href: '/automations' },
  { key: 'stopped', label: '止めているもの', href: '/automations?tab=stopped' },
  { key: 'runs', label: '動いた記録' },
  { key: 'templates', label: '見本', href: '/automations?tab=templates' },
  { key: 'common-actions', label: '共通アクション', href: '/common-actions' },
]

const STATUS_LABEL: Record<RunStatus, string> = {
  queued: '待っています',
  claimed: '動いています',
  succeeded: '動きました',
  skipped: '動きませんでした',
  retry_wait: '再試行を待っています',
  permanent_failed: '失敗しました',
  cancelled: '取り消しました',
}

function formatOccurredAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日時不明'
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

function formatDuration(value: number | null): string {
  if (value === null) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(1)}秒` : `${value}ミリ秒`
}

export default function AutomationRunsPage() {
  usePageTitle('オートメーション')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [data, setData] = useState<RunsResponse | null>(null)
  const [query, setQuery] = useState('')
  const [resultFilter, setResultFilter] = useState<'all' | 'executed' | 'skipped' | 'problems'>('all')

  const load = useCallback(async () => {
    if (accountLoading) return
    setStatus('loading')
    try {
      const params = new URLSearchParams({ limit: '20', offset: '0' })
      if (selectedAccountId) params.set('lineAccountId', selectedAccountId)
      if (query.trim()) params.set('search', query.trim())
      if (resultFilter !== 'all') params.set('status', resultFilter)
      const response = await fetchApi<ApiResponse<RunsResponse>>(`/api/automation-runs?${params}`)
      if (!response.success) throw new Error(response.error)
      if (!response.data || !response.data.summary || !Array.isArray(response.data.items) || !response.data.pagination) {
        throw new Error('実行記録の応答形式が正しくありません')
      }
      setData(response.data)
      setStatus('ready')
    } catch {
      setData(null)
      setStatus('error')
    }
  }, [accountLoading, query, resultFilter, selectedAccountId])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 200)
    return () => window.clearTimeout(timer)
  }, [load])

  return (
    <div data-design-node="DkPY0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-faint">自動化 ＞ オートメーション ＞ 動いた記録</p>
        <div className="text-right">
          <Button disabled>CSVで書き出す</Button>
          <p className="mt-1 text-xs text-ink-faint">CSV書き出しは未接続</p>
        </div>
      </div>
      <div className="mb-4"><MergedTabs basePath="/automations/runs" paramName="tab" tabs={TABS} active="runs" /></div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="この30日に動いた" value={data ? `${data.summary.executed.toLocaleString('ja-JP')}回` : '—'} note={data ? '実行結果を集計' : '未取得'} />
        <Metric label="いちばん動いた" value={data?.summary.mostRunName ?? '—'} note={data?.summary.mostRunCount !== null && data?.summary.mostRunCount !== undefined ? `${data.summary.mostRunCount.toLocaleString('ja-JP')}回` : '未取得'} />
        <Metric label="失敗した" value={data ? `${data.summary.failed.toLocaleString('ja-JP')}回` : '—'} note="処理結果を確認してください" danger={Boolean(data?.summary.failed)} />
        <Metric label="条件に外れて動かなかった" value={data ? `${data.summary.skipped.toLocaleString('ja-JP')}回` : '—'} note="条件が厳しすぎないか見てください" />
      </div>

      <div className="mb-4 rounded-control border border-info bg-info-bg px-4 py-3 text-sm font-medium text-info">
        オートメーションが動いた記録です。条件に外れて動かなかったものも並ぶため、「動いていないはず」の切り分けができます。
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="友だちの名前・オートメーションの名前で検索" className="h-10 w-full max-w-lg rounded-control border border-hairline bg-canvas px-3 text-sm outline-none focus:border-info" />
        <div className="flex gap-2">
          <SelectField aria-label="表示期間" value="30" onChange={() => undefined} options={[{ value: '30', label: 'この30日' }]} className="h-10 min-w-32" />
          <SelectField aria-label="表示件数" value="20" onChange={() => undefined} options={[{ value: '20', label: '20件表示' }]} className="h-10 min-w-32" />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2" aria-label="結果で絞り込む">
        {([
          ['all', `すべて ${data?.summary.total.toLocaleString('ja-JP') ?? '—'}`],
          ['executed', `動いた ${data?.summary.executed.toLocaleString('ja-JP') ?? '—'}`],
          ['skipped', `条件に外れた ${data?.summary.skipped.toLocaleString('ja-JP') ?? '—'}`],
          ['problems', `失敗 ${data?.summary.failed.toLocaleString('ja-JP') ?? '—'}`],
        ] as const).map(([value, label]) => (
          <FilterChip key={value} selected={resultFilter === value} onChange={() => setResultFilter(value)}>{label}</FilterChip>
        ))}
      </div>

      {status === 'loading' ? (
        <ListState kind="loading" title="動いた記録を読み込んでいます" />
      ) : status === 'error' ? (
        <ListState kind="error" title="動いた記録を読み込めませんでした" description="記録は消えていません。再読み込みしてください。" action={<Button onClick={() => void load()}>もう一度読み込む</Button>} />
      ) : !data || data.items.length === 0 ? (
        <ListState kind="empty" title={query || resultFilter !== 'all' ? '条件に合う記録はありません' : '動いた記録はまだありません'} description={query || resultFilter !== 'all' ? '検索語や絞り込みを変えてください。' : 'オートメーションが動くと、結果がここに残ります。'} />
      ) : (
        <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-sm">
          <div className="grid grid-cols-6 gap-3 bg-canvas-sunken px-4 py-3 text-xs font-semibold text-ink-faint">
            <span>いつ・だれに</span><span>オートメーション</span><span>結果</span><span>したこと</span><span>かかった時間</span><span aria-hidden />
          </div>
          {data.items.map((run) => (
            <div key={run.id} className="grid min-h-14 grid-cols-6 items-center gap-3 border-t border-hairline px-4 py-2 text-sm">
              <div className="min-w-0"><p className="truncate font-semibold text-ink">{formatOccurredAt(run.occurredAt)} ／ {run.subject ?? '友だち名なし'}</p><p className="truncate text-xs text-ink-faint">{run.accountLabel ?? 'アカウント名なし'}</p></div>
              <div className="min-w-0"><p className="truncate text-ink" title={run.automationName}>{run.automationName}</p><p className="truncate text-xs text-ink-faint" title={run.triggerLabel}>{run.triggerLabel}</p></div>
              <span className={run.status === 'permanent_failed' || run.status === 'retry_wait' ? 'font-semibold text-danger' : run.status === 'succeeded' ? 'font-semibold text-accent-deep' : 'font-semibold text-ink-faint'}>{STATUS_LABEL[run.status]}</span>
              <p className="truncate text-ink-secondary" title={run.detail ?? '何もしていません'}>{run.detail ?? '何もしていません'}</p>
              <span className="tabular-nums text-ink-secondary">{formatDuration(run.durationMs)}</span>
              <Button disabled title="実行詳細の画面は未接続です">中身を見る</Button>
            </div>
          ))}
          <div className="border-t border-hairline px-4 py-3 text-xs text-ink-faint">記録 {data.pagination.total.toLocaleString('ja-JP')}件中 1〜{data.items.length}件を表示</div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, note, danger = false }: { label: string; value: string; note: string; danger?: boolean }) {
  return (
    <section className="rounded-card border border-hairline bg-canvas p-4 shadow-sm">
      <p className="text-xs font-semibold text-ink-faint">{label}</p>
      <p className={`mt-1 truncate text-xl font-bold ${danger ? 'text-danger' : 'text-ink'}`} title={value}>{value}</p>
      <p className="mt-1 truncate text-xs text-ink-faint" title={note}>{note}</p>
    </section>
  )
}
