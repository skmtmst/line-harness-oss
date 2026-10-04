'use client'

/*
 * ★V8 自動応答の実行結果（Pencil `nWmLg`）。
 *
 * V7（runs/page.tsx の AutoReplyRunsInner）の取得・操作の動きはそのままに、
 * 絵だけ V8 へ合わせる。並びは「見出し→4つの数値→失敗の帯→実行の記録
 * の表→言葉ごとの数と引き継ぎ」。一時停止は v7 の update ではなく、
 * 一覧と同じ専用の停止口（理由を残せる）を使う。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Download, Pause, Pencil, RotateCcw, Search, TriangleAlert } from 'lucide-react'
import type { AutoReplyRun, AutoReplyRunsResponse, ExecutionRunStatus } from '@line-crm/shared'
import { usePageTitle } from '@/components/shell/page-chrome'
import Avatar from '@/components/shared/avatar'
import DateField from '@/components/shared/date-field'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { api, ApiError } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import styles from './runs-v8.module.css'
import { formatDateTime, formatNumber, formatTime } from '@/lib/format'

const PAGE_SIZE = 20

/* 再実行・一時停止は owner/admin だけ。v7 と同じ境目（R530）。 */
const NO_MANAGE_NOTE = '実行結果の再実行・一時停止はオーナーと管理者だけができます。必要なときはオーナーか管理者に頼んでください。'
const NO_RETRY_PERMISSION = '再実行する権限がありません。オーナーか管理者に頼んでください。'

const STATUS: Record<ExecutionRunStatus, { label: string; tone: StatusBadgeTone }> = {
  succeeded: { label: '成功', tone: 'success' },
  failed: { label: 'エラー', tone: 'danger' },
  partial: { label: '一部だけ完了', tone: 'warning' },
  skipped: { label: '何もしませんでした', tone: 'neutral' },
  pending: { label: '確認待ち', tone: 'warning' },
  cancelled: { label: '取り消しました', tone: 'neutral' },
  claimed: { label: '処理中', tone: 'warning' },
  permanent_failed: { label: '失敗', tone: 'danger' },
}

function statusView(status: string): { label: string; tone: StatusBadgeTone } {
  return (STATUS as Record<string, { label: string; tone: StatusBadgeTone }>)[status]
    ?? { label: '確認中', tone: 'neutral' }
}

function actionLabel(run: AutoReplyRun): string {
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
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`
}

type RunFilter = 'all' | 'failed' | 'pending' | 'skipped'

const FILTERS: Array<{ key: RunFilter; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'failed', label: '失敗' },
  { key: 'pending', label: '確認待ち' },
  { key: 'skipped', label: '見送り' },
]

function matchesFilter(item: AutoReplyRun, filter: RunFilter): boolean {
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

export default function AutoReplyRunsV8() {
  const searchParams = useSearchParams()
  const requestedRuleId = searchParams.get('id') ?? ''
  const staffRole = useStaffRole()
  const canManage = staffRole === null || canManageRole(staffRole)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
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

  const load = useCallback(async () => {
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq
    setLoading(true)
    setError('')
    try {
      const response = await api.autoReplies.runs({
        from: dateFrom || undefined,
        to: dateTo || undefined,
        ruleId: requestedRuleId || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
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
  }, [page, requestedRuleId, dateFrom, dateTo])

  useEffect(() => { void load() }, [load])

  const pageCount = Math.max(1, Math.ceil((data?.pagination.total ?? 0) / PAGE_SIZE))

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
      const items: AutoReplyRun[] = []
      let offset = 0
      let capped = false
      for (;;) {
        if (exportCancelledRef.current) throw new Error('csv_cancelled')
        const response = await api.autoReplies.runs({ ruleId: requestedRuleId || undefined, from: dateFrom || undefined, to: dateTo || undefined, limit: 100, offset })
        if (!response.success) throw new Error(response.error)
        const room = MAX_CSV_ROWS - items.length
        items.push(...response.data.items.slice(0, room))
        offset += response.data.items.length
        if (items.length % 1000 === 0 && items.length > 0) {
          setActionMessage(`${formatNumber(items.length)}件読み込み中…`)
        }
        if (items.length >= MAX_CSV_ROWS) {
          capped = offset < response.data.pagination.total || response.data.items.length > room
          break
        }
        if (offset >= response.data.pagination.total || response.data.items.length === 0) break
      }
      const url = URL.createObjectURL(new Blob([csvFor(items)], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `auto-reply-runs${requestedRuleId ? `-${requestedRuleId}` : ''}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      setActionMessage(
        capped
          ? `直近${formatNumber(MAX_CSV_ROWS)}件まで書き出しました。全部要るときは期間を絞って分けてください。`
          : `${formatNumber(items.length)}件を書き出しました。`,
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

  const items = data?.items ?? []
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

  return (
    <div className={styles.page} data-design-node="nWmLg">
      {!canManage && (
        <p className="bg-info-bg text-ink-secondary rounded-control mb-1 px-4 py-3 text-xs leading-relaxed">
          {NO_MANAGE_NOTE}実行結果の確認と書き出しはこのまま使えます。
        </p>
      )}

      <Link href="/auto-replies" className={styles.backLink}>
        <ArrowLeft size={16} aria-hidden="true" />自動応答へ
      </Link>

      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>実行結果：{data?.rule.name ?? '自動応答'}</h1>
          <p className={styles.headDescription}>いつ・誰に・何を返したか、失敗した処理を見ます。</p>
        </div>
        <div className={styles.headActions}>
          {canManage && (
            <Button
              variant="secondary"
              size="compact"
              onClick={() => setStopOpen(true)}
              disabled={!isActiveRule || stopping}
            >
              <Pause size={14} aria-hidden="true" />一時停止する
            </Button>
          )}
          {data?.rule.id && (
            <Button variant="secondary" size="compact" href={`/auto-replies/edit?id=${encodeURIComponent(data.rule.id)}`}>
              <Pencil size={14} aria-hidden="true" />ルールの編集へ
            </Button>
          )}
          <Button
            variant="secondary"
            size="compact"
            onClick={() => void exportCsv()}
            disabled={exporting || loading}
            busy={exporting}
            busyLabel="書き出しています"
          >
            <Download size={14} aria-hidden="true" />CSVで書き出す
          </Button>
          {exporting ? (
            <Button variant="secondary" size="compact" onClick={() => { exportCancelledRef.current = true }}>
              書き出しを止める
            </Button>
          ) : null}
        </div>
      </div>

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>今月当たった</p>
          <p className={styles.kpiValue}>{data ? formatNumber(data.summary.monthHits) : '—'}<span className={styles.kpiUnit}> 回</span></p>
          <p className={styles.kpiNote}>累計 {data ? formatNumber(data.summary.totalHits) : '—'} 回</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>担当者へ引き継ぎ</p>
          <p className={styles.kpiValue}>{data ? formatNumber(data.summary.handovers) : '—'}<span className={styles.kpiUnit}> 件</span></p>
          <p className={styles.kpiNote}>確認待ち {data ? formatNumber(data.handovers.waiting) : '—'} 件</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>失敗した処理</p>
          <p className={`${styles.kpiValue} ${failedCount > 0 ? styles.kpiValueDanger : ''}`}>{data ? formatNumber(failedCount) : '—'}<span className={styles.kpiUnit}> 件</span></p>
          <p className={styles.kpiNote}>{failedCount > 0 ? '理由を見て、もう一度実行できます' : '記録を開始してからの合計です'}</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>平均で返すまで</p>
          <p className={styles.kpiValue}>
            {data?.summary.averageResponseMs == null ? '—' : `${(data.summary.averageResponseMs / 1000).toFixed(1)}`}
            <span className={styles.kpiUnit}> 秒</span>
          </p>
          <p className={styles.kpiNote}>最後に動いた {data ? formatTime(data.summary.lastRunAt) : '—'}</p>
        </div>
      </div>

      {failedCount > 0 && (
        <div className={styles.failBanner} role="alert">
          <TriangleAlert size={18} className={styles.failBannerIcon} aria-hidden="true" />
          <div className={styles.failBannerText}>
            <p className={styles.failBannerTitle}>失敗した処理が{formatNumber(failedCount)}件あります</p>
            <p className={styles.failBannerNote}>止まった行を選んで、もう一度実行できます。</p>
          </div>
          <div className={styles.failBannerActions}>
            <Button variant="secondary" size="compact" onClick={() => setFilter('failed')}>
              失敗だけ見る
            </Button>
            {canManage && (
              <Button
                size="compact"
                onClick={() => void retryAllFailed()}
                disabled={retryableFailed === 0 || retryingAll || retryingId !== null}
                busy={retryingAll}
                busyLabel="実行しています"
              >
                <RotateCcw size={14} aria-hidden="true" />失敗した処理をもう一度
              </Button>
            )}
          </div>
        </div>
      )}

      <section className={styles.card} aria-label="実行の記録">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>実行の記録</h2>
          <div className={styles.cardTools}>
            <DateField value={dateFrom} onChange={(value) => { setDateFrom(value); setPage(1) }} max={dateTo || undefined} aria-label="実行日（開始）" />
            <DateField value={dateTo} onChange={(value) => { setDateTo(value); setPage(1) }} min={dateFrom || undefined} aria-label="実行日（終了）" />
            <div className={styles.filterChips} role="group" aria-label="結果で絞り込む">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={styles.filterChip}
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <label className={styles.headDescription} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                className={styles.stopReasonInput}
                style={{ width: 200, padding: '6px 10px' }}
                placeholder="友だち・届いた言葉で探す"
                aria-label="友だち・届いた言葉で探す"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
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
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">日時</th>
                  <th scope="col">友だち</th>
                  <th scope="col">届いた言葉</th>
                  <th scope="col">結果</th>
                  <th scope="col">行ったこと</th>
                  <th scope="col">時間</th>
                  {canManage && <th scope="col"><span className="sr-only">操作</span></th>}
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => {
                  const view = statusView(item.status)
                  const failed = matchesFilter(item, 'failed')
                  const label = failed && item.detail ? item.detail : actionLabel(item)
                  return (
                    <tr key={item.id} className={failed ? styles.rowFailed : ''}>
                      <td className="text-ink-faint" style={{ whiteSpace: 'nowrap' }}>
                        <time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt)}</time>
                      </td>
                      <td className={styles.cellMain}>
                        <span className={styles.friendCell}>
                          <Avatar name={item.friendName} size={32} />
                          {item.friendId ? (
                            <Link
                              href={`/friends/detail?id=${encodeURIComponent(item.friendId)}`}
                              title={item.friendName ?? undefined}
                            >
                              {item.friendName ?? '削除済みの友だち'}
                            </Link>
                          ) : (
                            item.friendName ?? '削除済みの友だち'
                          )}
                        </span>
                      </td>
                      <td>
                        <span title={item.inputPreview ?? undefined}>{item.inputPreview ?? '—'}</span>
                        <span className={styles.cellSub}>きっかけ：{item.triggerLabel}</span>
                      </td>
                      <td><StatusBadge tone={view.tone} size="compact">{view.label}</StatusBadge></td>
                      <td><span title={label}>{label}</span></td>
                      <td className="text-ink-faint" style={{ whiteSpace: 'nowrap' }}>
                        {item.durationMs === null ? '—' : `${(item.durationMs / 1000).toFixed(1)}秒`}
                      </td>
                      {canManage && (
                        <td>
                          {item.canRetry ? (
                            <Button
                              variant="secondary"
                              size="compact"
                              onClick={() => void retryRun(item)}
                              disabled={retryingId !== null || retryingAll}
                              busy={retryingId === item.id}
                              busyLabel="実行しています"
                            >
                              <RotateCcw size={14} aria-hidden="true" />もう一度
                            </Button>
                          ) : null}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className={styles.pager}>
              <Pagination
                page={page}
                pageCount={pageCount}
                onPageChange={setPage}
                disabled={loading}
                summary={
                  data && data.pagination.total > 0
                    ? `${formatNumber(data.pagination.total)}件中 ${(page - 1) * PAGE_SIZE + 1}〜${Math.min(page * PAGE_SIZE, data.pagination.total)}件`
                    : undefined
                }
              />
            </div>
          </>
        )}
      </section>

      <div className={styles.bottomGrid}>
        <section className={styles.card} aria-label="言葉ごとの当たった回数">
          <h2 className={styles.cardTitle}>言葉ごとの当たった回数</h2>
          {loading ? (
            <ListState kind="loading" />
          ) : !data || data.triggerBreakdown.length === 0 ? (
            <ListState kind="empty" title="内訳はまだありません" description="実行結果がたまると、きっかけごとの件数が分かります。" />
          ) : (
            data.triggerBreakdown.map((item) => (
              <div className={styles.wordRow} key={item.trigger}>
                <span className={styles.wordName}>{item.trigger}</span>
                <span>
                  <span className={styles.wordCount}>{formatNumber(item.count)}回</span>{' '}
                  <span className={styles.wordShare}>{item.share === null ? '—' : `${(item.share * 100).toFixed(1)}%`}</span>
                </span>
              </div>
            ))
          )}
        </section>

        <section className={styles.card} aria-label="担当者への引き継ぎ">
          <h2 className={styles.cardTitle}>担当者への引き継ぎ</h2>
          <dl className={styles.kvList}>
            <div className={styles.kvRow}>
              <dt className={styles.kvKey}>確認待ち</dt>
              <dd className={`${styles.kvVal} ${data && data.handovers.waiting > 0 ? styles.kvValWarn : ''}`}>
                {data ? `${formatNumber(data.handovers.waiting)}件` : '—'}
              </dd>
            </div>
            <div className={styles.kvRow}>
              <dt className={styles.kvKey}>対応中</dt>
              <dd className={styles.kvVal}>{data ? `${formatNumber(data.handovers.inProgress)}件` : '—'}</dd>
            </div>
            <div className={styles.kvRow}>
              <dt className={styles.kvKey}>完了</dt>
              <dd className={styles.kvVal}>{data ? `${formatNumber(data.handovers.completed)}件` : '—'}</dd>
            </div>
          </dl>
          <div className={styles.cardFoot}>
            <Link href="/chats" className={styles.footLink}>
              → 受信箱で見る
            </Link>
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
          className={styles.stopReasonInput}
          placeholder="止める理由（任意・記録に残ります）"
          aria-label="止める理由（任意）"
          value={stopReason}
          onChange={(e) => setStopReason(e.target.value)}
        />
      </ConfirmDialog>
    </div>
  )
}
