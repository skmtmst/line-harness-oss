'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AutomationExecutionRun,
  AutomationExecutionRunsResponse,
  ExecutionRunStatus,
} from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { Tabs } from '@/components/shared/tabs'
import styles from './automation-runs.module.css'

const PAGE_SIZES = [10, 20, 50] as const
type ResultFilter = '' | 'executed' | 'problems' | Extract<ExecutionRunStatus, 'skipped'>

const STATUS_VIEW: Record<ExecutionRunStatus, { label: string; tone: StatusBadgeTone }> = {
  succeeded: { label: '動きました', tone: 'success' },
  failed: { label: '失敗しました', tone: 'danger' },
  partial: { label: '一部だけ動きました', tone: 'warning' },
  skipped: { label: '動きませんでした', tone: 'neutral' },
  pending: { label: '処理中です', tone: 'info' },
  cancelled: { label: '取り消しました', tone: 'neutral' },
}

function formatJst(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function durationLabel(value: number | null): string {
  if (value === null) return '—'
  if (value < 1_000) return `${value}ミリ秒`
  return `${(value / 1_000).toFixed(1)}秒`
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function csvFor(items: AutomationExecutionRun[]): string {
  const rows = [
    ['日時', '友だち', 'LINEアカウント', 'オートメーション', '結果', 'したこと', 'かかった時間'],
    ...items.map((item) => [
      formatJst(item.occurredAt),
      item.friendName ?? '—',
      item.accountLabel ?? '—',
      item.automationName,
      STATUS_VIEW[item.status].label,
      item.detail ?? '—',
      durationLabel(item.durationMs),
    ]),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`
}

export default function AutomationRunsPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [data, setData] = useState<AutomationExecutionRunsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<ResultFilter>('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [days, setDays] = useState(30)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [actionMessage, setActionMessage] = useState('')

  const range = useMemo(() => {
    const to = new Date()
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1_000)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [days])

  const load = useCallback(async () => {
    if (accountLoading) return
    setLoading(true)
    setError('')
    setData(null)
    try {
      const response = await api.automations.runs({
        accountId: selectedAccountId || undefined,
        status: filter || undefined,
        search: search || undefined,
        from: range.from,
        to: range.to,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      if (!response.success) throw new Error(response.error)
      setData(response.data)
    } catch {
      setError('動いた記録を読み込めませんでした。時間を置いてもう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [accountLoading, filter, page, pageSize, range.from, range.to, search, selectedAccountId])

  useEffect(() => { void load() }, [load])

  const pageCount = Math.max(1, Math.ceil((data?.pagination.total ?? 0) / pageSize))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    setActionMessage('')
    try {
      const items: AutomationExecutionRun[] = []
      let offset = 0
      for (;;) {
        const response = await api.automations.runs({
          accountId: selectedAccountId || undefined,
          status: filter || undefined,
          search: search || undefined,
          from: range.from,
          to: range.to,
          limit: 100,
          offset,
        })
        if (!response.success) throw new Error(response.error)
        items.push(...response.data.items)
        offset += response.data.items.length
        if (offset >= response.data.pagination.total || response.data.items.length === 0) break
      }
      const url = URL.createObjectURL(new Blob([csvFor(items)], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'automation-runs.csv'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setActionMessage('CSVを書き出せませんでした。もう一度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  const summary = data?.summary
  const hasFailures = (summary?.failed ?? 0) > 0
  const chips: Array<{ value: ResultFilter; label: string; count: number | null; tone?: 'danger' }> = [
    { value: '', label: 'すべて', count: summary?.total ?? null },
    { value: 'executed', label: '動いた', count: summary?.executed ?? null },
    { value: 'skipped', label: '条件に外れた', count: summary?.skipped ?? null },
    { value: 'problems', label: '失敗', count: summary?.failed ?? null, tone: 'danger' },
  ]

  return (
    <div className={styles.page} data-design-node="DkPY0">
      <Tabs
        items={[
          { label: 'オートメーション', href: '/automations' },
          { label: '動いた記録', current: true },
          { label: '共通アクション', href: '/common-actions' },
        ]}
        actions={<Button onClick={() => void exportCsv()} disabled={loading || exporting}>{exporting ? 'CSVを準備しています' : 'CSVで書き出す'}</Button>}
      />

      <div className={styles.summary}>
        <SummaryCard variant="v6" title={`この${days}日に動いた`} value={summary?.executed ?? null} unit="回" detail={summary ? `1日あたり ${Math.round(summary.executed / days).toLocaleString('ja-JP')}回` : '集計中'} loading={loading} />
        <SummaryCard variant="v6" title="いちばん動いた" value={summary?.mostRunCount ?? null} unit="回" detail={summary?.mostRunName ?? '—'} loading={loading} />
        <SummaryCard
          variant="v6"
          title="失敗した"
          value={summary?.failed ?? null}
          unit="回"
          detail={summary ? (hasFailures ? '理由を確認してください' : '失敗はありません') : '集計を取得できません'}
          badge={hasFailures ? '確認' : undefined}
          badgeTone="danger"
          loading={loading}
        />
        <SummaryCard variant="v6" title="条件に外れて動かなかった" value={summary?.skipped ?? null} unit="回" detail="条件が厳しすぎないか確認できます" loading={loading} />
      </div>

      <NoteBar tone={hasFailures ? 'danger' : 'info'}>
        {hasFailures
          ? `${summary?.failed ?? 0}件が失敗しました。中身を開き、どの処理で止まったか確認してください。`
          : 'オートメーションが動いた記録です。条件に外れて動かなかったものも並びます。'}
      </NoteBar>

      {actionMessage ? <NoteBar tone="danger">{actionMessage}</NoteBar> : null}

      <div className={styles.toolbar}>
        <SearchField
          className={styles.search}
          value={searchInput}
          placeholder="友だちの名前・オートメーションの名前で検索"
          aria-label="動いた記録を検索"
          onChange={setSearchInput}
          onClear={() => { setSearchInput(''); setSearch(''); setPage(1) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { setSearch(searchInput.trim()); setPage(1) }
          }}
        />
        <Button onClick={() => { setSearch(searchInput.trim()); setPage(1) }}>記録を検索</Button>
        <div className={styles.toolbarEnd}>
          <Select
            aria-label="期間"
            value={String(days)}
            onChange={(value) => { setDays(Number(value)); setPage(1) }}
            options={[7, 30, 90].map((value) => ({ value: String(value), label: `この${value}日` }))}
          />
          <Select
            aria-label="表示件数"
            size="page-size"
            value={String(pageSize)}
            onChange={(value) => { setPageSize(Number(value) as (typeof PAGE_SIZES)[number]); setPage(1) }}
            options={PAGE_SIZES.map((value) => ({ value: String(value), label: `${value}件表示` }))}
          />
        </div>
      </div>

      <div className={styles.chips} aria-label="実行結果で絞り込む">
        {chips.map((chip) => (
          <button
            key={chip.value || 'all'}
            type="button"
            className={`${styles.chip} ${filter === chip.value ? styles.chipCurrent : ''} ${chip.tone === 'danger' ? styles.chipDanger : ''}`}
            aria-pressed={filter === chip.value}
            onClick={() => { setFilter(chip.value); setPage(1) }}
          >
            {chip.label} {chip.count === null ? '—' : chip.count.toLocaleString('ja-JP')}
          </button>
        ))}
      </div>

      {loading ? <ListState kind="loading" /> : null}
      {!loading && error ? <ListState kind="error" description={error} action={<Button onClick={() => void load()}>記録を再読み込み</Button>} /> : null}
      {!loading && !error && (data?.items.length ?? 0) === 0 ? (
        <ListState
          kind="empty"
          title={filter || search ? 'この条件に合う記録はありません' : '動いた記録はまだありません'}
          description={filter || search ? '条件を変えて確認してください。' : 'オートメーションが判定されると、動かなかったものもここに残ります。'}
        />
      ) : null}
      {!loading && !error && (data?.items.length ?? 0) > 0 ? (
        <>
          <DataTable>
            <colgroup>
              <col className={styles.whenColumn} />
              <col className={styles.automationColumn} />
              <col className={styles.resultColumn} />
              <col className={styles.detailColumn} />
              <col className={styles.durationColumn} />
              <col className={styles.actionColumn} />
            </colgroup>
            <thead><TableHeadRow><Th>いつ・だれに</Th><Th>オートメーション</Th><Th>結果</Th><Th>したこと</Th><Th>かかった時間</Th><Th>操作</Th></TableHeadRow></thead>
            <tbody>
              {data!.items.map((item) => {
                const view = STATUS_VIEW[item.status]
                const expanded = expandedId === item.id
                return (
                  <Tr key={item.id}>
                    <Td><span className={styles.mainText}>{formatJst(item.occurredAt)}／{item.friendName ?? '対象は未取得'}</span><span className={styles.subText}>{item.accountLabel ?? 'LINEアカウントは未取得'}</span></Td>
                    <Td><span className={styles.mainText}>{item.triggerLabel}</span><span className={styles.subText}>{item.automationName}</span></Td>
                    <Td><StatusBadge tone={view.tone} size="compact">{view.label}</StatusBadge></Td>
                    <Td title={item.detail ?? undefined}><span className={styles.ellipsis}>{item.detail ?? '—'}</span>{expanded ? <span className={styles.expanded}>{item.failureReason ?? item.detail ?? '詳しい記録はありません'}</span> : null}</Td>
                    <Td>{durationLabel(item.durationMs)}</Td>
                    <Td><Button onClick={() => setExpandedId(expanded ? null : item.id)}>{expanded ? '中身を閉じる' : '中身を見る'}</Button></Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
          <div className={styles.footer}>
            <span>{data!.pagination.total === 0 ? 0 : data!.pagination.offset + 1}〜{Math.min(data!.pagination.offset + data!.items.length, data!.pagination.total)}件 / 全{data!.pagination.total.toLocaleString('ja-JP')}件</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </div>
        </>
      ) : null}
    </div>
  )
}
