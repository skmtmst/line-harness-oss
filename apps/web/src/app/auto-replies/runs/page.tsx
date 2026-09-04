'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Download, Eye, Pause, Pencil, TriangleAlert } from 'lucide-react'
import type { AutoReplyRun, AutoReplyRunsResponse, ExecutionRunStatus } from '@line-crm/shared'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import SummaryCard from '@/components/shared/summary-card'
import { api } from '@/lib/api'
import styles from './auto-reply-runs.module.css'

const PAGE_SIZE = 20

const STATUS: Record<ExecutionRunStatus, { label: string; tone: StatusBadgeTone }> = {
  succeeded: { label: '成功', tone: 'success' },
  failed: { label: 'エラー', tone: 'danger' },
  partial: { label: '一部だけ完了', tone: 'warning' },
  skipped: { label: '何もしませんでした', tone: 'neutral' },
  pending: { label: '確認待ち', tone: 'warning' },
  cancelled: { label: '取り消しました', tone: 'neutral' },
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
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
      STATUS[item.status].label,
      actionLabel(item),
      item.durationMs === null ? '—' : `${item.durationMs}ms`,
    ]),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`
}

export default function AutoReplyRunsPage() {
  const searchParams = useSearchParams()
  const requestedRuleId = searchParams.get('id') ?? ''
  const [data, setData] = useState<AutoReplyRunsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [actionMessage, setActionMessage] = useState('')
  const [pausing, setPausing] = useState(false)
  const [exporting, setExporting] = useState(false)

  usePageTitle(data ? `${data.rule.name}・実行結果` : '自動応答・実行結果')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.autoReplies.runs({
        ruleId: requestedRuleId || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      if (!response.success) throw new Error(response.error)
      /*
        **形が違う返事を、そのまま画面へ流さない。**
        口の契約は `{ rule, items, ... }`（`apps/worker/src/routes/auto-reply-runs.ts`）
        だが、器だけ違うものが来ると `data.rule.id` で落ち、**この面が白い画面に
        なる**。読めなかったこととして扱えば、理由と読み直しの口が出る。
      */
      if (!response.data?.rule || !Array.isArray(response.data.items)) {
        throw new Error('runs_shape')
      }
      setData(response.data)
    } catch {
      setError('実行結果を読み込めませんでした。時間を置いてもう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [page, requestedRuleId])

  useEffect(() => { void load() }, [load])

  const pageCount = Math.max(1, Math.ceil((data?.pagination.total ?? 0) / PAGE_SIZE))

  const pause = async () => {
    if (!data?.rule.id || data.rule.isActive !== true || pausing) return
    setPausing(true)
    setActionMessage('')
    try {
      const response = await api.autoReplies.update(data.rule.id, { isActive: false })
      if (!response.success) throw new Error(response.error)
      setActionMessage('自動応答を一時停止しました。')
      await load()
    } catch {
      setActionMessage('一時停止できませんでした。状態を読み直してからお試しください。')
    } finally {
      setPausing(false)
    }
  }

  const exportCsv = async () => {
    if (!data?.rule.id || exporting) return
    setExporting(true)
    setActionMessage('')
    try {
      const items: AutoReplyRun[] = []
      let offset = 0
      for (;;) {
        const response = await api.autoReplies.runs({ ruleId: data.rule.id, limit: 100, offset })
        if (!response.success) throw new Error(response.error)
        items.push(...response.data.items)
        offset += response.data.items.length
        if (offset >= response.data.pagination.total || response.data.items.length === 0) break
      }
      const url = URL.createObjectURL(new Blob([csvFor(items)], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `auto-reply-runs-${data.rule.id}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setActionMessage('CSVを書き出せませんでした。もう一度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  const items = data?.items ?? []
  const errors = data?.summary.errors ?? null

  return (
    <div className={styles.page} data-design-node="t7UtYQ">
      <div className={styles.topActions}>
        <Link href="/auto-replies" className={styles.back}><ArrowLeft size={16} />自動応答一覧</Link>
        <Button onClick={() => void exportCsv()} disabled={!data?.rule.id || exporting}>
          <Download size={16} />{exporting ? '書き出しています' : '実行結果をCSVで書き出す'}
        </Button>
      </div>

      <div className={styles.columns}>
        <main className={styles.main}>
          <section className={styles.summary} aria-label="実行結果のまとめ">
            <SummaryCard variant="v6" title="今月ヒット" value={data?.summary.monthHits ?? null} unit="回" detail="今月、条件に合った回数" loading={loading} />
            <SummaryCard variant="v6" title="累計ヒット" value={data?.summary.totalHits ?? null} unit="回" detail="記録を開始してからの合計" loading={loading} />
            <SummaryCard variant="v6" title="引継ぎ" value={data?.summary.handovers ?? null} unit="件" detail="担当者へ渡した件数" loading={loading} />
            <SummaryCard variant="v6" title="エラー" value={data?.summary.errors ?? null} unit="件" detail="失敗した実行を確認" badgeTone="danger" loading={loading} />
          </section>

          <Card className={styles.runCard} id="recent-runs">
            <CardHeader title="最近の実行" />
            <p className={styles.cardDescription}>何をきっかけに、何が実行されたかを確認できます。</p>
            {loading ? <ListState kind="loading" /> : error ? (
              <ListState kind="error" description={error} action={<Button onClick={() => void load()}>再読み込み</Button>} />
            ) : items.length === 0 ? (
              <ListState kind="empty" title="実行結果はまだありません" description="自動応答が動くと、ここに結果が残ります。" />
            ) : (
              <>
                <div className={styles.runList}>
                  {items.map((item, index) => {
                    const view = STATUS[item.status]
                    return (
                      <article key={item.id} className={`${styles.runRow} ${index === 0 ? styles.highlight : ''}`}>
                        <span className={styles.avatar} aria-hidden="true">{(item.friendName ?? '?').slice(0, 1)}</span>
                        <div className={styles.runIdentity}>
                          <strong title={item.friendName ?? undefined}>{item.friendName ?? '削除済みの友だち'}</strong>
                          <span title={item.inputPreview ?? undefined}>入力：{item.inputPreview ?? '—'}</span>
                        </div>
                        <span className={styles.actionLabel} title={actionLabel(item)}>{actionLabel(item)}</span>
                        <StatusBadge tone={view.tone} size="compact">{view.label}</StatusBadge>
                        <time className={styles.time} dateTime={item.occurredAt}>{formatTime(item.occurredAt)}</time>
                      </article>
                    )
                  })}
                </div>
                {pageCount > 1 ? (
                  <div className={styles.pagination}>
                    <Pagination page={page} pageCount={pageCount} onPageChange={setPage} disabled={loading} />
                  </div>
                ) : null}
              </>
            )}
          </Card>

          <Card className={styles.breakdownCard}>
            <CardHeader title="きっかけ別の内訳" />
            <p className={styles.cardDescription}>一覧を開かずに効果を確認できます。</p>
            {loading ? <ListState kind="loading" /> : error || !data ? (
              <ListState kind="error" title="内訳を表示できませんでした" description="実行結果を読み直してからご確認ください。" />
            ) : data.triggerBreakdown.length === 0 ? (
              <ListState kind="empty" title="内訳はまだありません" description="実行結果がたまると、きっかけごとの件数が分かります。" />
            ) : (
              <div className={styles.breakdownList}>
                {data!.triggerBreakdown.map((item) => (
                  <div className={styles.breakdownRow} key={item.trigger}>
                    <strong>{item.trigger}</strong>
                    <span>{item.count.toLocaleString('ja-JP')}回</span>
                    <b>{item.share === null ? '—' : `${(item.share * 100).toFixed(1)}%`}</b>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </main>

        <aside className={styles.side}>
          <Card>
            <CardHeader title="稼働状況" />
            <dl className={styles.facts}>
              <div><dt>状態</dt><dd>{data?.rule.isActive === null || !data ? '—' : data.rule.isActive ? '稼働中' : '停止中'}</dd></div>
              <div><dt>優先順位</dt><dd>{data?.rule.priorityPosition ? `${data.rule.priorityPosition}番目` : '—'}</dd></div>
              <div><dt>最終実行</dt><dd>{formatTime(data?.summary.lastRunAt ?? null)}</dd></div>
              <div><dt>平均応答</dt><dd>{data?.summary.averageResponseMs === null || !data ? '—' : `${(data.summary.averageResponseMs / 1000).toFixed(1)}秒`}</dd></div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="要確認" />
            <p className={styles.cardDescription}>失敗した実行を表示します。</p>
            {errors === null ? (
              <p className={styles.quiet}>エラー件数を確認できませんでした。</p>
            ) : errors > 0 ? (
              <div className={styles.alert}>
                <TriangleAlert size={18} aria-hidden="true" />
                <div><strong>実行エラー {errors.toLocaleString('ja-JP')}件</strong><span>実行結果で理由を確認してください</span></div>
                <Button href="#recent-runs"><Eye size={16} />実行結果を確認</Button>
              </div>
            ) : <p className={styles.quiet}>確認が必要なエラーはありません。</p>}
          </Card>

          <Card>
            <CardHeader title="担当者引継ぎ" />
            <p className={styles.cardDescription}>対応が必要な受信へ連携済みです。</p>
            <dl className={styles.facts}>
              <div><dt>確認待ち</dt><dd className={styles.warning}>{data ? `${data.handovers.waiting}件` : '—'}</dd></div>
              <div><dt>対応中</dt><dd>{data ? `${data.handovers.inProgress}件` : '—'}</dd></div>
              <div><dt>完了</dt><dd>{data ? `${data.handovers.completed}件` : '—'}</dd></div>
            </dl>
          </Card>
        </aside>
      </div>

      {actionMessage ? <p className={styles.actionMessage} role="status">{actionMessage}</p> : null}
      <StickyBar
        className={styles.sticky}
        status={data?.rule.isActive === false ? 'この自動応答は停止中です' : '変更は実行結果に影響しません'}
        actions={(
          <>
            <Button onClick={() => void pause()} disabled={!data?.rule.id || data.rule.isActive !== true || pausing}>
              <Pause size={16} />{pausing ? '停止しています' : '自動応答を一時停止'}
            </Button>
            <Button variant="primary" href={data?.rule.id ? `/auto-replies/edit?id=${encodeURIComponent(data.rule.id)}` : '/auto-replies'}>
              <Pencil size={16} />自動応答の設定を編集
            </Button>
          </>
        )}
      />
    </div>
  )
}
