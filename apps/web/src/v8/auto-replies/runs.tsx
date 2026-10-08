'use client'

/*
 * ★V8 自動応答の実行結果（Pencil `nWmLg`）。
 *
 * 型は詳細（DetailPage）：頭（戻る・題・説明・右に3つの操作）→ 数の帯（4つ）→
 * 失敗の帯 → 実行の記録（道具の段・表・ページ送り）→ 言葉ごとの数と引き継ぎ。
 * 取得・操作の動き（読み直し・一時停止・再実行・CSV）は `app/auto-replies/runs/runs-v8.tsx`
 * から写した（import はしない）。動きの一覧は BEHAVIOR.md の「実行結果」。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Download,
  MessageCircle,
  Pause,
  Pencil,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react'
import type { AutoReplyRun, AutoReplyRunsResponse, ExecutionRunStatus } from '@line-crm/shared'
import { DetailPage } from '@/components/templates'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import DateField from '@/components/shared/date-field'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { api, ApiError } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatDateTime, formatNumber, formatTime } from '@/lib/format'
import styles from './runs.module.css'

/* 再実行・一時停止は owner/admin だけ（R530・再実行POST・停止口の requireRole と同じ境目）。 */
const NO_MANAGE_NOTE = '閲覧のみで見ています。再実行・一時停止はオーナーと管理者だけができます。実行結果の確認と書き出しはこのまま使えます。'
const NO_RETRY_PERMISSION = '再実行する権限がありません。オーナーか管理者に頼んでください。'

/* 絵の札の言葉（成功・確認待ち・失敗・見送り）。表に無い状態は「確認中」で出す（白い画面にしない）。 */
const STATUS: Record<ExecutionRunStatus, { label: string; tone: StatusBadgeTone }> = {
  succeeded: { label: '成功', tone: 'success' },
  failed: { label: '失敗', tone: 'danger' },
  partial: { label: '一部だけ完了', tone: 'warning' },
  skipped: { label: '見送り', tone: 'neutral' },
  pending: { label: '確認待ち', tone: 'warning' },
  cancelled: { label: '取り消し', tone: 'neutral' },
  claimed: { label: '処理中', tone: 'warning' },
  permanent_failed: { label: '失敗', tone: 'danger' },
}

export function statusView(status: string): { label: string; tone: StatusBadgeTone } {
  return (STATUS as Record<string, { label: string; tone: StatusBadgeTone }>)[status]
    ?? { label: '確認中', tone: 'neutral' }
}

export function actionLabel(run: AutoReplyRun): string {
  const summary = run.actionSummary
  const parts: string[] = []
  if (run.replyStatus === 'accepted') parts.push('返信')
  if ((summary.executed ?? 0) > 0) parts.push(`後続処理${summary.executed}件`)
  if ((summary.failed ?? 0) > 0) parts.push(`失敗${summary.failed}件`)
  return parts.length > 0 ? parts.join('＋') : run.detail ?? '—'
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function csvFor(items: AutoReplyRun[]): string {
  const rows = [
    ['日時', '友だち', 'LINEアカウント', '入力', 'きっかけ', '結果', '処理内容', 'かかった時間'],
    ...items.map((item) => [
      formatDateTime(item.occurredAt),
      item.friendName ?? '削除済みの友だち',
      item.accountLabel ?? '—',
      item.inputPreview ?? '—',
      item.triggerLabel,
      statusView(item.status).label,
      actionLabel(item),
      item.durationMs === null ? '—' : `${item.durationMs}ms`,
    ]),
  ]
  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`
}

export type RunFilter = 'all' | 'failed' | 'pending' | 'skipped'

export function matchesFilter(item: AutoReplyRun, filter: RunFilter): boolean {
  switch (filter) {
    case 'failed':
      return item.status === 'failed' || item.status === 'permanent_failed' || item.status === 'partial'
    case 'pending':
      return item.status === 'pending'
    case 'skipped':
      return item.status === 'skipped' || item.status === 'cancelled'
    default:
      return true
  }
}

/* 期間（絵は「今月」）。決めた日は「日付で決める」で2つの日付欄を出す。 */
export type PeriodKey = 'month' | 'last7' | 'last30' | 'all' | 'custom'
const PERIOD_OPTIONS: Array<{ value: PeriodKey; label: string }> = [
  { value: 'month', label: '今月' },
  { value: 'last7', label: 'この7日' },
  { value: 'last30', label: 'この30日' },
  { value: 'all', label: 'すべての期間' },
  { value: 'custom', label: '日付で決める' },
]

function ymd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 期間の選び方から、口へ渡す開始日（YYYY-MM-DD）を出す。決めた日・すべては null。 */
export function periodFrom(period: PeriodKey, now: Date): string | null {
  if (period === 'month') return ymd(new Date(now.getFullYear(), now.getMonth(), 1))
  if (period === 'last7') return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
  if (period === 'last30') return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29))
  return null
}

const PAGE_SIZE_OPTIONS = [10, 20, 50].map((n) => ({ value: String(n), label: `${n}件表示` }))

/** 届いた言葉は「」で囲んで1行。 */
function quoted(text: string | null): string {
  return text ? `「${text}」` : '—'
}

function initialOf(name: string | null): string {
  const trimmed = (name ?? '').trim()
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : '?'
}

export default function AutoReplyRunsV8() {
  const searchParams = useSearchParams()
  const requestedRuleId = searchParams.get('id') ?? ''
  const staffRole = useStaffRole()
  const canManage = staffRole === null || canManageRole(staffRole)
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [data, setData] = useState<AutoReplyRunsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<RunFilter>('all')
  const [search, setSearch] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [stopOpen, setStopOpen] = useState(false)
  const [stopReason, setStopReason] = useState('')
  const [stopping, setStopping] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryingAll, setRetryingAll] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const exportCancelledRef = useRef(false)
  const loadSeqRef = useRef(0)

  usePageTitle(data ? `${data.rule.name}・実行結果` : '自動応答・実行結果')

  useEffect(() => {
    setPage(1)
    setData(null)
    setActionMessage('')
    setFilter('all')
    setSearch('')
  }, [requestedRuleId])

  /* 口へ渡す期間。決めた日のときだけ日付欄の値を使う。 */
  const range = useMemo(() => {
    if (period === 'custom') return { from: dateFrom || undefined, to: dateTo || undefined }
    return { from: periodFrom(period, new Date()) ?? undefined, to: undefined }
  }, [period, dateFrom, dateTo])

  const load = useCallback(async () => {
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq
    setLoading(true)
    setError('')
    try {
      const response = await api.autoReplies.runs({
        from: range.from,
        to: range.to,
        ruleId: requestedRuleId || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      if (loadSeqRef.current !== seq) return
      if (!response.success) throw new Error(response.error)
      if (!response.data?.rule || !Array.isArray(response.data.items)) {
        throw new Error('runs_shape')
      }
      if (requestedRuleId && (response.data.rule.id || '') !== requestedRuleId) return
      setData(response.data)
    } catch {
      if (loadSeqRef.current !== seq) return
      setData(null)
      setError('実行結果を読み込めませんでした。時間を置いてもう一度お試しください。')
    } finally {
      if (loadSeqRef.current === seq) setLoading(false)
    }
  }, [page, pageSize, requestedRuleId, range])

  useEffect(() => { void load() }, [load])

  const total = data?.pagination.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const stopRule = async () => {
    if (!data?.rule.id || stopping) return
    setStopping(true)
    setActionMessage('')
    try {
      const response = await api.autoReplies.stop(
        data.rule.id,
        { reason: stopReason.trim() || null },
        crypto.randomUUID(),
      )
      if (!response.success) throw new Error(response.error)
      setStopOpen(false)
      setStopReason('')
      setActionMessage('自動応答を一時停止しました。')
      await load()
    } catch {
      setActionMessage('一時停止できませんでした。状態を読み直してからお試しください。')
    } finally {
      setStopping(false)
    }
  }

  const retryRun = async (item: AutoReplyRun) => {
    if (!item.canRetry || retryingId !== null || retryingAll) return
    setRetryingId(item.id)
    setActionMessage('')
    try {
      const response = await api.autoReplies.retryRun(item.id)
      if (!response.success) throw new Error(response.error)
      setActionMessage('失敗した処理をもう一度実行しました。')
      await load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setActionMessage('すでに処理中または完了しています。最新の状態を読み直しました。')
        await load()
      } else if (e instanceof ApiError && e.status === 403) {
        setActionMessage(NO_RETRY_PERMISSION)
      } else {
        setActionMessage('失敗した処理をもう一度実行できませんでした。時間を置いてお試しください。')
      }
    } finally {
      setRetryingId(null)
    }
  }

  const items = data?.items ?? []

  /* 「失敗した処理をもう一度」：今のページでやり直せる失敗を順に実行する。 */
  const retryAllFailed = async () => {
    const targets = items.filter((item) => item.canRetry && matchesFilter(item, 'failed'))
    if (targets.length === 0 || retryingAll || retryingId !== null) return
    setRetryingAll(true)
    setActionMessage('')
    let retried = 0
    let denied = false
    for (const item of targets) {
      try {
        const response = await api.autoReplies.retryRun(item.id)
        if (!response.success) throw new Error(response.error)
        retried += 1
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) denied = true
        /* 409（もう動いている・済み）などは飛ばして次へ。 */
      }
    }
    setRetryingAll(false)
    if (denied) {
      setActionMessage(NO_RETRY_PERMISSION)
      return
    }
    setActionMessage(
      retried > 0
        ? `失敗した処理を${retried}件もう一度実行しました。`
        : 'もう一度実行できる処理はありませんでした。',
    )
    await load()
  }

  const MAX_CSV_ROWS = 5000
  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    exportCancelledRef.current = false
    setActionMessage('')
    try {
      const rows: AutoReplyRun[] = []
      let offset = 0
      let capped = false
      for (;;) {
        if (exportCancelledRef.current) throw new Error('csv_cancelled')
        const response = await api.autoReplies.runs({ ruleId: requestedRuleId || undefined, from: range.from, to: range.to, limit: 100, offset })
        if (!response.success) throw new Error(response.error)
        const room = MAX_CSV_ROWS - rows.length
        rows.push(...response.data.items.slice(0, room))
        offset += response.data.items.length
        if (rows.length % 1000 === 0 && rows.length > 0) {
          setActionMessage(`${formatNumber(rows.length)}件読み込み中…`)
        }
        if (rows.length >= MAX_CSV_ROWS) {
          capped = offset < response.data.pagination.total || response.data.items.length > room
          break
        }
        if (offset >= response.data.pagination.total || response.data.items.length === 0) break
      }
      const url = URL.createObjectURL(new Blob([csvFor(rows)], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `auto-reply-runs${requestedRuleId ? `-${requestedRuleId}` : ''}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      setActionMessage(
        capped
          ? `直近${formatNumber(MAX_CSV_ROWS)}件まで書き出しました。全部要るときは期間を絞って分けてください。`
          : `${formatNumber(rows.length)}件を書き出しました。`,
      )
    } catch (e) {
      if (e instanceof Error && e.message === 'csv_cancelled') {
        setActionMessage('書き出しを止めました。')
      } else {
        setActionMessage('CSVを書き出せませんでした。もう一度お試しください。')
      }
    } finally {
      setExporting(false)
    }
  }

  const failedCount = data?.summary.errors ?? 0
  const retryableFailed = items.filter((item) => item.canRetry && matchesFilter(item, 'failed')).length
  const query = search.trim().toLowerCase()
  const visibleItems = items.filter((item) => {
    if (!matchesFilter(item, filter)) return false
    if (!query) return true
    return [item.friendName, item.inputPreview, item.triggerLabel]
      .some((text) => (text ?? '').toLowerCase().includes(query))
  })
  const isActiveRule = data?.rule.isActive === true && data.rule.id

  /* 札の数：すべて＝全件・失敗＝帯の数・確認待ち＝引き継ぎの確認待ち。見送りは口に数が無いので出さない。 */
  const chipCounts: Record<RunFilter, number | null> = {
    all: data ? data.pagination.total : null,
    failed: data ? failedCount : null,
    pending: data ? data.handovers.waiting : null,
    skipped: null,
  }
  const chips: Array<{ key: RunFilter; label: string }> = [
    { key: 'all', label: 'すべて' },
    { key: 'failed', label: '失敗' },
    { key: 'pending', label: '確認待ち' },
    { key: 'skipped', label: '見送り' },
  ]

  const rowMenuItems = (item: AutoReplyRun): ActionMenuItem[] => {
    const list: ActionMenuItem[] = []
    if (item.friendId) {
      list.push({
        id: 'chat',
        label: 'トークを開く',
        icon: <MessageCircle size={14} aria-hidden="true" />,
        external: true,
        onSelect: () => { window.location.assign(`/chats?friend=${encodeURIComponent(item.friendId)}`) },
      })
    }
    if (canManage && item.canRetry) {
      list.push({
        id: 'retry',
        label: 'もう一度実行',
        icon: <RotateCcw size={14} aria-hidden="true" />,
        disabled: retryingId !== null || retryingAll,
        onSelect: () => { void retryRun(item) },
      })
    }
    return list
  }

  return (
    <DetailPage
      boardId="nWmLg"
      title={`実行結果：${data?.rule.name ?? '自動応答'}`}
      description="いつ・誰に・何を返したか、失敗した処理を見ます。"
      identity={<Link href="/auto-replies" className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" />自動応答へ</Link>}
      actions={<div className={styles.headActions}>
        {canManage ? (
          <Button onClick={() => setStopOpen(true)} disabled={!isActiveRule || stopping}>
            <Pause size={14} aria-hidden="true" />一時停止する
          </Button>
        ) : null}
        {canManage && data?.rule.id ? (
          <Button href={`/auto-replies/edit?id=${encodeURIComponent(data.rule.id)}`}>
            <Pencil size={14} aria-hidden="true" />ルールの編集へ
          </Button>
        ) : null}
        <Button onClick={() => void exportCsv()} disabled={exporting || loading} busy={exporting} busyLabel="書き出しています">
          <Download size={14} aria-hidden="true" />CSVで書き出す
        </Button>
        {exporting ? (
          <Button onClick={() => { exportCancelledRef.current = true }}>書き出しを止める</Button>
        ) : null}
      </div>}
    >
      {!canManage ? (
        <p className={styles.viewerBand} role="status">{NO_MANAGE_NOTE}</p>
      ) : null}

      <div className={styles.kpis}>
      <KpiBand data-design="KPIs">
        <KpiCard presentation="band" icon={null} title="今月当たった" value={data ? data.summary.monthHits : null} unit="回"
          detail={`累計 ${data ? formatNumber(data.summary.totalHits) : '—'}回`} />
        <KpiCard presentation="band" icon={null} title="担当者へ引き継ぎ" value={data ? data.summary.handovers : null} unit="件"
          detail={`確認待ち ${data ? formatNumber(data.handovers.waiting) : '—'}件`} />
        <KpiCard presentation="band" icon={null} title="失敗した処理" value={data ? failedCount : null} unit="件"
          detail={failedCount > 0 ? '理由を見て、もう一度実行できます' : '記録を開始してからの合計です'} />
        <KpiCard presentation="band" icon={null} title="平均で返すまで"
          value={data?.summary.averageResponseMs == null ? null : Number((data.summary.averageResponseMs / 1000).toFixed(1))} unit="秒"
          detail={`最後に動いた ${data ? formatTime(data.summary.lastRunAt) : '—'}`} />
      </KpiBand>
      </div>

      {failedCount > 0 ? (
        <div className={styles.failBand} role="alert">
          <TriangleAlert size={18} className={styles.failIcon} aria-hidden="true" />
          <div className={styles.failText}>
            <p className={styles.failTitle}>{`失敗した処理が ${formatNumber(failedCount)}件あります`}</p>
            <p className={styles.failNote}>止まった行の理由を見て、もう一度実行できます。返信が届いているかは「行ったこと」に出ます。</p>
          </div>
          <Button onClick={() => { setFilter('failed'); setPage(1) }}>失敗だけ見る</Button>
          {canManage ? (
            <Button
              variant="primary"
              onClick={() => void retryAllFailed()}
              disabled={retryableFailed === 0 || retryingAll || retryingId !== null}
              busy={retryingAll}
              busyLabel="実行しています"
            >
              <RotateCcw size={14} aria-hidden="true" />失敗した処理をもう一度
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className={styles.card} aria-label="実行の記録">
        <div className={styles.tools}>
          <div className={styles.searchBox}>
            <SearchField
              placeholder="友だち・言葉で探す"
              aria-label="友だち・言葉で探す"
              value={search}
              onChange={(value) => setSearch(value)}
              onClear={() => setSearch('')}
            />
          </div>
          <div className={styles.chips} role="group" aria-label="結果で絞り込む">
            {chips.map((chip) => {
              const count = chipCounts[chip.key]
              return (
                <button
                  key={chip.key}
                  type="button"
                  className={styles.chip}
                  aria-pressed={filter === chip.key}
                  onClick={() => setFilter(chip.key)}
                >
                  {count == null ? chip.label : `${chip.label} ${formatNumber(count)}`}
                </button>
              )
            })}
          </div>
          <span className={styles.toolsSpacer} aria-hidden="true" />
          {period === 'custom' ? (
            <>
              <DateField value={dateFrom} onChange={(value) => { setDateFrom(value); setPage(1) }} max={dateTo || undefined} aria-label="実行日（開始）" />
              <DateField value={dateTo} onChange={(value) => { setDateTo(value); setPage(1) }} min={dateFrom || undefined} aria-label="実行日（終了）" />
            </>
          ) : null}
          <div className={styles.periodBox}>
            <Select
              aria-label="期間"
              value={period}
              onChange={(value) => { setPeriod(value as PeriodKey); setPage(1) }}
              options={PERIOD_OPTIONS}
            />
          </div>
          <div className={styles.sizeBox}>
            <Select
              aria-label="1ページに出す件数"
              size="page-size"
              value={String(pageSize)}
              onChange={(value) => { setPageSize(Number(value)); setPage(1) }}
              options={PAGE_SIZE_OPTIONS}
            />
          </div>
        </div>

        {loading ? (
          <ListState kind="loading" />
        ) : error ? (
          <ListState kind="error" description={error} action={<Button onClick={() => void load()}>再読み込み</Button>} />
        ) : items.length === 0 ? (
          <ListState kind="empty" title="実行結果はまだありません" description="自動応答が動くと、ここに結果が残ります。" />
        ) : visibleItems.length === 0 ? (
          <ListState kind="empty" title="条件に合う記録はありません" description="絞り込みや検索の条件を変えてみてください。" />
        ) : (
          <DataTable className={styles.table}>
            <thead>
              <TableHeadRow className={styles.headRow} data-table-layout="columns">
                <Th className={styles.colWhen}>日時</Th>
                <Th className={styles.colFriend}>友だち</Th>
                <Th className={styles.colInput}>届いた言葉</Th>
                <Th className={styles.colResult}>結果</Th>
                <Th className={styles.colDone}>行ったこと</Th>
                <Th className={styles.colTime}>時間</Th>
                <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const view = statusView(item.status)
                const failed = matchesFilter(item, 'failed')
                const done = failed && item.detail ? item.detail : actionLabel(item)
                const name = item.friendName ?? '削除済みの友だち'
                const menuItems = rowMenuItems(item)
                return (
                  <Tr key={item.id} className={styles.row} data-table-layout="columns">
                    <Td className={styles.colWhen}>
                      <time dateTime={item.occurredAt} title={formatDateTime(item.occurredAt)} className={styles.when}>{formatTime(item.occurredAt)}</time>
                    </Td>
                    <Td className={styles.colFriend}>
                      <span className={styles.face} aria-hidden="true">{initialOf(item.friendName)}</span>
                      {item.friendId ? (
                        <Link className={styles.friendName} href={`/friends/detail?id=${encodeURIComponent(item.friendId)}`} title={name}>{name}</Link>
                      ) : (
                        <span className={styles.friendName} title={name}>{name}</span>
                      )}
                    </Td>
                    <Td className={styles.colInput}>
                      <span className={styles.input} title={`${quoted(item.inputPreview)}（きっかけ：${item.triggerLabel}）`}>{quoted(item.inputPreview)}</span>
                    </Td>
                    <Td className={styles.colResult}><StatusBadge tone={view.tone} size="compact">{view.label}</StatusBadge></Td>
                    <Td className={styles.colDone}><span className={styles.done} title={done}>{done}</span></Td>
                    <Td className={styles.colTime}>
                      <span className={styles.time}>{item.durationMs === null ? '—' : `${(item.durationMs / 1000).toFixed(1)}秒`}</span>
                    </Td>
                    <Td className={styles.colMenu}>
                      {menuItems.length > 0 ? (
                        <div className={styles.menuBox}>
                          <RowMenu
                            label={`${name}さんの記録の操作`}
                            items={menuItems}
                            open={menuId === item.id}
                            onOpenChange={(next) => setMenuId(next ? item.id : null)}
                          />
                        </div>
                      ) : null}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        )}
        {!loading && !error && items.length > 0 ? (
          <div className={styles.pager}>
            <Pagination
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
              disabled={loading}
              summary={total > 0 ? `${formatNumber(total)}件中 ${(page - 1) * pageSize + 1}〜${Math.min(page * pageSize, total)}件` : undefined}
            />
          </div>
        ) : null}
      </section>

      <div className={styles.bottom}>
        <section className={styles.box} aria-label="言葉ごとの当たった回数">
          <h2 className={styles.boxTitle}>言葉ごとの当たった回数</h2>
          {loading ? (
            <ListState kind="loading" />
          ) : !data || data.triggerBreakdown.length === 0 ? (
            <ListState kind="empty" title="内訳はまだありません" description="実行結果がたまると、きっかけごとの件数が分かります。" />
          ) : (
            <dl className={styles.kv}>
              {data.triggerBreakdown.map((item) => (
                <div className={styles.kvRow} key={item.trigger}>
                  <dt>{item.trigger}</dt>
                  <dd>{`${formatNumber(item.count)}回${item.share === null ? '' : `（${(item.share * 100).toFixed(1)}%）`}`}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className={styles.box} aria-label="担当者への引き継ぎ">
          <h2 className={styles.boxTitle}>担当者への引き継ぎ</h2>
          <dl className={styles.kv}>
            <div className={styles.kvRow}>
              <dt>確認待ち</dt>
              <dd className={data && data.handovers.waiting > 0 ? styles.kvWarn : undefined}>{data ? `${formatNumber(data.handovers.waiting)}件` : '—'}</dd>
            </div>
            <div className={styles.kvRow}>
              <dt>対応中</dt>
              <dd>{data ? `${formatNumber(data.handovers.inProgress)}件` : '—'}</dd>
            </div>
            <div className={styles.kvRow}>
              <dt>完了</dt>
              <dd>{data ? `${formatNumber(data.handovers.completed)}件` : '—'}</dd>
            </div>
          </dl>
          <div className={styles.boxFoot}>
            <Button variant="text" href="/chats">受信箱で見る</Button>
          </div>
        </section>
      </div>

      {actionMessage ? <p className={styles.hint} role="status">{actionMessage}</p> : null}

      <ConfirmDialog
        open={stopOpen}
        title="この自動応答を止めますか？"
        description="止めると、条件に合うメッセージが届いても自動では返しません。あとで一覧から再び動かせます。"
        confirmLabel="一時停止する"
        destructive
        busy={stopping}
        designNode="i8F12"
        onConfirm={() => void stopRule()}
        onCancel={() => { if (!stopping) { setStopOpen(false); setStopReason('') } }}
      >
        <input
          type="text"
          className={styles.stopReason}
          placeholder="止める理由（任意・記録に残ります）"
          aria-label="止める理由（任意）"
          value={stopReason}
          onChange={(e) => setStopReason(e.target.value)}
        />
      </ConfirmDialog>
    </DetailPage>
  )
}
