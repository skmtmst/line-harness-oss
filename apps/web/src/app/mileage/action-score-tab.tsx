'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Send, Users } from 'lucide-react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import SummaryCard from '@/components/shared/summary-card'
import { ActionCell, DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import {
  api,
  type ActionScoreBand,
  type ActionScoreFilter,
  type ActionScoreOverview,
  type ActionScoreSort,
} from '@/lib/api'
import { formatMileageDate } from './mileage-display'

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const

const BAND_LABELS: Record<ActionScoreBand, string> = {
  high: '高い',
  normal: 'ふつう',
  low: '低い',
}

/**
 * 数を出す。**数でないものを `NaN` と書かない。**
 *
 * 固定データの点数が入っていないとき、表の「いまの点数」に `NaN` が並んでいた。
 * `Intl.NumberFormat` は `undefined` を渡すと `NaN` を返す。
 * 取れていないものは `—` と書き、0 とも言い分ける。
 */
function formatNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('ja-JP').format(value)
    : '—'
}

function ScoreBand({ band }: { band: ActionScoreBand }) {
  if (band === 'high') return <span className="rounded-full bg-v6-accent-soft px-2.5 py-1 text-xs font-semibold text-v6-accent-hover">{BAND_LABELS[band]}</span>
  if (band === 'normal') return <span className="rounded-full bg-v6-warning-bg px-2.5 py-1 text-xs font-semibold text-v6-warning">{BAND_LABELS[band]}</span>
  return <span className="rounded-full bg-v6-surface-strong px-2.5 py-1 text-xs font-semibold text-v6-ink-secondary">{BAND_LABELS[band]}</span>
}

function ScoreChange({ value }: { value: number }) {
  const label = `${value > 0 ? '+' : ''}${formatNumber(value)}`
  if (value > 0) return <span className="font-semibold text-v6-accent-hover">{label}</span>
  if (value < 0) return <span className="font-semibold text-v6-danger">{label}</span>
  return <span className="font-semibold text-v6-ink-faint">{label}</span>
}

function scoreRange(filter: ActionScoreFilter, summary: ActionScoreOverview['summary'] | undefined) {
  const highMin = summary?.highMin ?? 70
  const normalMin = summary?.normalMin ?? 30
  if (filter === 'high') return { min: highMin, max: null }
  if (filter === 'normal') return { min: normalMin, max: highMin - 1 }
  if (filter === 'low') return { min: null, max: normalMin - 1 }
  return null
}

function scoreRangeQuery(filter: ActionScoreFilter, summary: ActionScoreOverview['summary'] | undefined) {
  const range = scoreRange(filter, summary)
  if (!range) return null
  const query = new URLSearchParams()
  if (range.min !== null) query.set('scoreMin', String(range.min))
  if (range.max !== null) query.set('scoreMax', String(range.max))
  return query.toString()
}

function safeReason(reason: string | null) {
  if (!reason) return '点数が変わった理由は未取得'
  const labels: Record<string, string> = {
    message_received: 'メッセージ返信',
    link_clicked: '配信URLクリック',
    form_submitted: '回答フォーム回答',
    booking_created: '予約',
    purchase_completed: '購入',
    friend_blocked: 'ブロック',
  }
  const [source, detail] = reason.split('→').map((part) => part.trim())
  if (labels[source]) return detail || labels[source]
  if (/^[a-z0-9_.-]+$/i.test(reason)) return '反応の記録'
  return reason
}

export default function ActionScoreTab({ accountId }: { accountId: string }) {
  const latestAccountRef = useRef(accountId)
  latestAccountRef.current = accountId
  const [overview, setOverview] = useState<ActionScoreOverview | null>(null)
  const [filter, setFilter] = useState<ActionScoreFilter>('all')
  const [sort, setSort] = useState<ActionScoreSort>('score_desc')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const accountAtRequest = accountId
    setLoading(true)
    setError('')
    try {
      const response = await api.actionScores.friends({
        accountId: accountAtRequest,
        search: search || undefined,
        filter,
        sort,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      if (accountAtRequest !== latestAccountRef.current) return
      if (!response.success) throw new Error(response.error)
      setOverview(response.data)
    } catch {
      if (accountAtRequest !== latestAccountRef.current) return
      setOverview(null)
      setError('行動スコアを読み込めませんでした。')
    } finally {
      if (accountAtRequest === latestAccountRef.current) setLoading(false)
    }
  }, [accountId, filter, page, pageSize, search, sort])

  useEffect(() => {
    setPage(1)
    setOverview(null)
  }, [accountId])
  useEffect(() => void load(), [load])

  const total = overview?.pagination.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const summary = overview?.summary
  const rangeQuery = scoreRangeQuery(filter, summary)
  const friendsHref = rangeQuery ? `/friends?${rangeQuery}` : null
  const broadcastHref = rangeQuery ? `/broadcasts/new?${rangeQuery}` : null
  const filters = useMemo(() => [
    { key: 'all' as const, label: 'すべて', count: summary?.scoredFriends },
    { key: 'high' as const, label: '高い', count: summary?.high },
    { key: 'normal' as const, label: 'ふつう', count: summary?.normal },
    { key: 'low' as const, label: '低い', count: summary?.low },
    { key: 'decreased' as const, label: '下がっている', count: summary?.decreased30d },
  ], [summary])

  const exportCurrentPage = () => {
    if (!overview?.items.length) return
    const rows = overview.items.map((item) => [
      item.displayName,
      item.currentScore,
      BAND_LABELS[item.band],
      item.change30d,
      safeReason(item.lastReason),
      formatMileageDate(item.lastChangedAt),
    ])
    const csv = [['友だち', 'いまの点数', '帯', '30日間の変化', '最後に点数が変わった理由', '最終変動'], ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `action-scores-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section data-design-node="z3PB2" className="space-y-3.5">
      <div className="rounded-v6-control border border-v6-warning/25 bg-v6-warning-bg px-4 py-3 text-xs text-v6-ink-secondary">
        {/*
          設計 `z3PB2` の文そのまま。**「顧客には表示されず」だけでは足りない。**
          「マイルが減るのでは」と聞かれたときに答えられる形にする——
          交換できないこと、残高が動かないことを先に言う。
        */}
        <strong className="text-v6-ink">スコアはマイルではありません。</strong>
        お客様には見せず、交換もできません。マイル残高はスコアで増えも減りもしません。
        反応の目安として、配信や対応の順番を決めるために使います。
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard variant="v6" title="点数がついている人" value={summary?.scoredFriends ?? null} unit="人" detail="選択中のLINEアカウント" />
        <SummaryCard variant="v6" title={`高い（${summary?.highMin ?? 70}点以上）`} value={summary?.high ?? null} unit="人" detail="よく反応している帯" />
        <SummaryCard variant="v6" title={`ふつう（${summary?.normalMin ?? 30}〜${(summary?.highMin ?? 70) - 1}点）`} value={summary?.normal ?? null} unit="人" detail="反応が続いている帯" />
        <SummaryCard variant="v6" title={`低い（${(summary?.normalMin ?? 30) - 1}点以下）`} value={summary?.low ?? null} unit="人" detail="直近の反応が少ない帯" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {friendsHref ? <Button href={friendsHref}><Users className="h-4 w-4" aria-hidden="true" />この帯の人を見る</Button> : null}
          {broadcastHref ? <Button href={broadcastHref}><Send className="h-4 w-4" aria-hidden="true" />この帯に配信する</Button> : null}
          {filter === 'all' ? <span className="text-xs text-v6-ink-faint">高い・ふつう・低いの帯を選ぶと、友だち検索と配信へ引き継げます。</span> : null}
          {filter === 'decreased' ? <span className="text-xs text-v6-ink-faint">下がっている人は、この一覧で理由を確認できます。</span> : null}
        </div>
        <Button onClick={exportCurrentPage} disabled={!overview?.items.length}>
          <Download className="h-4 w-4" aria-hidden="true" />行動スコアをCSVで書き出す
        </Button>
      </div>

      <div className="rounded-v6-card border border-hairline bg-canvas shadow-v6-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
          <SearchField
            aria-label="友だち名で検索"
            value={searchInput}
            onChange={setSearchInput}
            onClear={() => { setSearchInput(''); setSearch(''); setPage(1) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setPage(1)
                setSearch(searchInput.trim())
              }
            }}
            placeholder="友だち名で検索"
            className="min-w-64 max-w-96 flex-1"
          />
          <Button onClick={() => { setPage(1); setSearch(searchInput.trim()) }}>検索</Button>
          <Select
            aria-label="表示件数"
            value={String(pageSize)}
            onChange={(value) => { setPage(1); setPageSize(Number(value) as typeof pageSize) }}
            options={PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: `${size}件表示` }))}
            size="page-size"
            className="ml-auto"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
          {filters.map((item) => (
            <Button
              key={item.key}
              type="button"
              aria-pressed={filter === item.key}
              onClick={() => { setPage(1); setFilter(item.key) }}
              variant={filter === item.key ? 'primary' : 'secondary'}
            >
              {item.label} {item.count === undefined ? '—' : formatNumber(item.count)}
            </Button>
          ))}
          <Select
            aria-label="並び順"
            value={sort}
            onChange={(value) => { setPage(1); setSort(value as ActionScoreSort) }}
            options={[
              { value: 'score_desc', label: '点数が高い順' },
              { value: 'score_asc', label: '点数が低い順' },
              { value: 'change_desc', label: '30日で上がった順' },
              { value: 'change_asc', label: '30日で下がった順' },
              { value: 'recent_desc', label: '点数の更新が新しい順' },
            ]}
            className="ml-auto w-52"
          />
        </div>

        {loading ? (
          <ListState kind="loading" title="行動スコアを読み込んでいます" description="友だちの現在点と30日間の変化を集計しています。" />
        ) : error ? (
          <ListState kind="error" title="行動スコアを表示できませんでした" description="再読み込みしても直らない場合はエラー報告へ。" onRetry={() => void load()} />
        ) : !overview?.items.length ? (
          <ListState kind="empty" title="条件に合う友だちがいません" description="帯または検索条件を変えてください。" />
        ) : (
          <DataTable>
              <thead className="bg-v6-surface text-left text-xs text-v6-ink-faint">
                <TableHeadRow>
                  <Th className="w-1/4">友だち</Th>
                  <Th className="w-1/12" align="right">いまの点数</Th>
                  <Th className="w-1/12">帯</Th>
                  <Th className="w-1/6" align="right">30日間の変化</Th>
                  <Th className="w-1/4">最後の反応</Th>
                  <Th className="w-1/6" align="right">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {overview.items.map((item) => (
                  <Tr key={item.friendId}>
                    <Td>
                      <div className="flex min-w-0 items-center gap-2.5">
                        {item.pictureUrl ? <img src={item.pictureUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" /> : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-v6-accent-soft text-xs font-bold text-v6-accent">{item.displayName.slice(0, 1)}</div>}
                        <span className="truncate text-sm font-semibold text-v6-ink" title={item.displayName}>{item.displayName}</span>
                      </div>
                    </Td>
                    <Td align="right"><strong>{formatNumber(item.currentScore)}</strong></Td>
                    <Td><ScoreBand band={item.band} /></Td>
                    <Td align="right"><ScoreChange value={item.change30d} /></Td>
                    <Td>
                      <p className="truncate text-xs text-v6-ink-secondary" title={safeReason(item.lastReason)}>{safeReason(item.lastReason)}</p>
                      <p className="mt-0.5 text-xs text-v6-ink-faint">{formatMileageDate(item.lastChangedAt)}</p>
                    </Td>
                    <ActionCell><Button href={`/friends/detail?id=${encodeURIComponent(item.friendId)}`}>友だちの詳細を見る</Button></ActionCell>
                  </Tr>
                ))}
              </tbody>
          </DataTable>
        )}

        {!loading && !error && total > 0 ? (
          <div className="flex items-center justify-between border-t border-hairline px-4 py-3">
            <span className="text-xs text-v6-ink-faint">{formatNumber((page - 1) * pageSize + 1)}〜{formatNumber(Math.min(page * pageSize, total))}件 / 全{formatNumber(total)}件</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </div>
        ) : null}
      </div>
    </section>
  )
}
