'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  api,
  type ReminderDeliveryRun,
  type ReminderDeliveryRunsResponse,
  type ReminderDeliveryRunStatus,
} from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Breadcrumb from '@/components/shared/breadcrumb'
import Card, { CardHeader } from '@/components/shared/card'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { LinePreview, ReminderFooter } from '@/components/reminders/reminder-v6-ui'
import styles from './reminder-runs.module.css'
import { csvCell } from '@/lib/presentation'

const PAGE_SIZE = 20

const STATUS_VIEW: Record<ReminderDeliveryRunStatus, { label: string; tone: StatusBadgeTone }> = {
  planned: { label: '配信予定', tone: 'info' },
  claimed: { label: '送信処理中', tone: 'info' },
  succeeded: { label: '送信済み', tone: 'success' },
  skipped: { label: '送信なし', tone: 'neutral' },
  retry_wait: { label: '再試行待ち', tone: 'warning' },
  permanent_failed: { label: '送信失敗', tone: 'danger' },
  cancelled: { label: '取り消し', tone: 'neutral' },
}

function formatJst(value: string | null): string {
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

function timingLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return '基準時刻'
  const abs = Math.abs(offsetMinutes)
  const before = offsetMinutes < 0
  if (abs % 1440 === 0) return `${abs / 1440}日${before ? '前' : '後'}`
  if (abs % 60 === 0) return `${abs / 60}時間${before ? '前' : '後'}`
  return `${abs}分${before ? '前' : '後'}`
}

/** 通知の本文を、番号だけでなく人が見分けられる短い名前にする。 */
function stepLabel(step: ReminderDeliveryRunsResponse['steps'][number]): string {
  const firstLine = step.messageContent.trim().split(/\r?\n/, 1)[0]?.trim()
  return firstLine ? firstLine.slice(0, 40) : `${step.stepNumber}通目`
}

function csvFor(items: ReminderDeliveryRun[]): string {
  const rows = [
    ['友だち', '通知', '結果', '配信予定', '実行時刻', '試行回数', '次の再試行', 'LINE要求ID', '理由'],
    ...items.map((item) => [
      item.friendName ?? '削除済みの友だち',
      `${item.stepNumber}通目`,
      STATUS_VIEW[item.domainStatus].label,
      formatJst(item.scheduledAt),
      formatJst(item.completedAt ?? item.startedAt),
      item.attemptCount,
      formatJst(item.nextRetryAt),
      item.lineRequestId ?? '—',
      item.lastErrorMessage ?? '',
    ]),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'success' | 'info' | 'warning' | 'danger' }) {
  const toneClass = {
    success: styles.metricSuccess,
    info: styles.metricInfo,
    warning: styles.metricWarning,
    danger: styles.metricDanger,
  }[tone]
  return <Card padding="default" className={styles.metric}><p>{label}</p><strong className={toneClass}>{value}</strong></Card>
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className={styles.fact}><dt>{label}</dt><dd>{value}</dd></div>
}

export default function ReminderRunsPage() {
  const searchParams = useSearchParams()
  const reminderId = searchParams.get('id') ?? ''
  const isPlannedView = searchParams.get('status') === 'planned'
  const [data, setData] = useState<ReminderDeliveryRunsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'' | ReminderDeliveryRunStatus>(isPlannedView ? 'planned' : '')
  const [page, setPage] = useState(1)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState('')
  const [exporting, setExporting] = useState(false)
  usePageTitle(data?.reminder.name ? `${data.reminder.name}・${isPlannedView ? '配信予定' : '実行結果'}` : null)

  // 同じpathnameのまま目的を切り替えても、URLと取得条件をずらさない。
  useEffect(() => {
    setStatus(isPlannedView ? 'planned' : '')
    setPage(1)
  }, [isPlannedView])

  const load = useCallback(async () => {
    if (!reminderId) return
    setLoading(true)
    setError('')
    // 読み直しに失敗したとき、前に取れた数字を現在値として残さない。
    setData(null)
    try {
      const response = await api.reminders.runs(reminderId, {
        status: status || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      if (!response.success) throw new Error(response.error)
      setData(response.data)
    } catch {
      setError(`${isPlannedView ? '配信予定' : '実行結果'}を読み込めませんでした。時間を置いてもう一度お試しください。`)
    } finally {
      setLoading(false)
    }
  }, [isPlannedView, page, reminderId, status])

  useEffect(() => {
    void load()
  }, [load])

  const pageCount = Math.max(1, Math.ceil((data?.pagination.total ?? 0) / PAGE_SIZE))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const firstStep = data?.steps[0] ?? null
  // 過去の失敗を、これから送る予定の警告として混ぜない。
  const hasErrors = !isPlannedView && (data?.summary.errors ?? 0) > 0

  const retry = async (runId: string) => {
    setRetryingId(runId)
    setActionMessage('')
    try {
      const response = await api.reminders.retryRun(runId, crypto.randomUUID())
      if (!response.success) throw new Error(response.error)
      setActionMessage('再試行を受け付けました。次の配信処理で送ります。')
      await load()
    } catch {
      setActionMessage('再試行を受け付けられませんでした。状態を読み直してからお試しください。')
    } finally {
      setRetryingId(null)
    }
  }

  const exportCsv = async () => {
    if (!reminderId || exporting) return
    setExporting(true)
    setActionMessage('')
    try {
      const all: ReminderDeliveryRun[] = []
      let offset = 0
      for (;;) {
        const response = await api.reminders.runs(reminderId, {
          status: status || undefined,
          limit: 100,
          offset,
        })
        if (!response.success) throw new Error(response.error)
        all.push(...response.data.items)
        offset += response.data.items.length
        if (offset >= response.data.pagination.total || response.data.items.length === 0) break
      }
      const url = URL.createObjectURL(new Blob([csvFor(all)], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `reminder-runs-${reminderId}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setActionMessage('CSVを書き出せませんでした。もう一度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  const pauseReminder = async () => {
    if (!data?.reminder.isActive) return
    setActionMessage('')
    try {
      const response = await api.reminders.update(reminderId, { isActive: false })
      if (!response.success) throw new Error(response.error)
      setData((current) => current ? {
        ...current,
        reminder: { ...current.reminder, isActive: false },
      } : current)
      setActionMessage('リマインダを一時停止しました。')
    } catch {
      setActionMessage('一時停止できませんでした。状態を読み直してからお試しください。')
    }
  }

  const showErrors = () => {
    setStatus('permanent_failed')
    setPage(1)
    requestAnimationFrame(() => document.querySelector('#recent-runs')?.scrollIntoView({ behavior: 'smooth' }))
  }

  return (
    <div className={styles.page} data-design-node="GC4St">
      <div className={styles.topActions}>
        <Breadcrumb items={[{ label: 'リマインダ一覧', href: '/reminders' }, { label: isPlannedView ? '配信予定' : '実行結果' }]} />
        <Button onClick={() => void exportCsv()} disabled={exporting || loading}>
          {exporting ? 'CSVを準備しています' : 'CSVで書き出す'}
        </Button>
      </div>

      <div className={styles.summary}>
        <MetricCard label="送信済み" value={data ? `${data.summary.sent.toLocaleString('ja-JP')}通` : '—'} tone="success" />
        <MetricCard label="送信予定" value={data ? `${data.summary.scheduled.toLocaleString('ja-JP')}通` : '—'} tone="info" />
        <MetricCard label="停止" value={data ? `${data.summary.stopped.toLocaleString('ja-JP')}人` : '—'} tone="warning" />
        <MetricCard label="エラー" value={data ? `${data.summary.errors.toLocaleString('ja-JP')}件` : '—'} tone="danger" />
      </div>

      {actionMessage ? <NoteBar tone={actionMessage.includes('ません') ? 'danger' : 'info'}>{actionMessage}</NoteBar> : null}

      <div className={styles.columns}>
        <main className={styles.main}>
          <Card overflow="hidden">
            <CardHeader title="通知実績" />
            <p className={styles.sectionNote}>ステップごとの送信状況を確認できます。</p>
            {loading ? <ListState kind="loading" title="通知実績を読み込んでいます" /> : null}
            {!loading && error ? (
              <ListState kind="error" title="通知実績を表示できませんでした" description="実行結果を再読み込みしてください。" />
            ) : null}
            {!loading && !error && (data?.steps.length ?? 0) > 0 ? (
              <div className={styles.tableWrap}>
                <DataTable>
                <thead>
                  <TableHeadRow>
                    <Th>通知</Th>
                    <Th>タイミング</Th>
                    <Th align="right">送信</Th>
                    <Th align="right">エラー</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {(data?.steps ?? []).map((step) => (
                    <Tr key={step.id}>
                      <Td>
                        <span className={styles.cellMain} title={stepLabel(step)}>{stepLabel(step)}</span>
                        <span className={styles.cellSub}>{step.stepNumber}通目</span>
                      </Td>
                      <Td>{timingLabel(step.offsetMinutes)}</Td>
                      <Td align="right">{step.sent.toLocaleString('ja-JP')}通</Td>
                      <Td align="right">{step.errors === 0 ? 'なし' : `${step.errors.toLocaleString('ja-JP')}件`}</Td>
                    </Tr>
                  ))}
                </tbody>
                </DataTable>
              </div>
            ) : null}
            {!loading && !error && (data?.steps.length ?? 0) === 0 ? (
              <ListState kind="empty" title="送る内容がありません" description="設定画面で通知を追加してください。" />
            ) : null}
            {!loading && !error ? <NoteBar className={styles.readNote} tone="warn">LINEでは友だち単位の既読を取得できません</NoteBar> : null}
          </Card>

          <Card overflow="hidden" id="recent-runs">
            <CardHeader
              title={isPlannedView ? '配信予定' : '最近の実行'}
              action={isPlannedView
                ? <Button href={`/reminders/detail?id=${encodeURIComponent(reminderId)}`}>実行履歴を見る</Button>
                : status
                  ? <Button onClick={() => { setStatus(''); setPage(1) }}>すべての実行結果</Button>
                  : <Button href={`/reminders/detail?id=${encodeURIComponent(reminderId)}&status=planned`}>配信予定を見る</Button>}
            />
            <p className={styles.sectionNote}>{isPlannedView ? 'これから送る予定を友だちごとに確認できます。' : '対象者ごとの履歴を確認できます。'}</p>

            {loading ? <ListState kind="loading" /> : null}
            {!loading && error ? (
              <ListState kind="error" description={error} action={<Button onClick={() => void load()}>{isPlannedView ? '配信予定' : '実行結果'}を再読み込み</Button>} />
            ) : null}
            {!loading && !error && (data?.items.length ?? 0) === 0 ? (
              <ListState
                kind="empty"
                title={isPlannedView ? '配信予定はありません' : status ? '送信エラーはありません' : '実行結果がまだありません'}
                description={isPlannedView ? '予約や対象条件が変わると、予定も変わります。' : status ? 'すべての実行結果へ戻って確認できます。' : '配信予定が作られると、ここに記録されます。'}
              />
            ) : null}
            {!loading && !error && (data?.items.length ?? 0) > 0 ? (
              <div className={styles.tableWrap}>
                <DataTable>
                  <thead>
                    <TableHeadRow>
                      <Th>友だち</Th>
                      <Th>通知</Th>
                      <Th>結果</Th>
                      <Th>時刻</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {data!.items.map((item) => {
                      const view = STATUS_VIEW[item.domainStatus]
                      const canRetry = item.canRetry
                      const step = data!.steps.find((candidate) => candidate.id === item.reminderStepId)
                      const notificationLabel = step ? stepLabel(step) : `${item.stepNumber}通目`
                      return (
                        <Tr key={item.id}>
                          <Td>
                            <span className={styles.cellMain}>{item.friendName ?? '削除済みの友だち'}</span>
                            <span className={styles.cellSub}>{item.accountLabel ?? '所属アカウントは未取得'}</span>
                          </Td>
                          <Td>
                            <span className={styles.cellMain} title={notificationLabel}>
                              {notificationLabel}
                            </span>
                            <span className={styles.cellSub}>予定 {formatJst(item.scheduledAt)}</span>
                          </Td>
                          <Td>
                            <StatusBadge tone={view.tone} size="compact">{view.label}</StatusBadge>
                            {item.lastErrorMessage ? <span className={styles.cellSub}>{item.lastErrorMessage}</span> : null}
                            {item.nextRetryAt ? <span className={styles.cellSub}>次回 {formatJst(item.nextRetryAt)}</span> : null}
                            {item.lineRequestId
                              ? <span className={styles.requestId} title={item.lineRequestId}>LINE要求ID {item.lineRequestId}</span>
                              : null}
                            {canRetry ? (
                              <Button onClick={() => void retry(item.id)} disabled={retryingId === item.id}>
                                {retryingId === item.id ? '受付中' : 'この通知を再試行'}
                              </Button>
                            ) : null}
                          </Td>
                          <Td>
                            <span className={styles.cellMain}>{formatJst(item.completedAt ?? item.startedAt)}</span>
                            <span className={styles.cellSub}>試行 {item.attemptCount}回</span>
                          </Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </DataTable>
                <div className={styles.footer}>
                  <span>
                    {data!.pagination.total === 0 ? 0 : data!.pagination.offset + 1}〜
                    {Math.min(data!.pagination.offset + data!.items.length, data!.pagination.total)}件 / 全
                    {data!.pagination.total.toLocaleString('ja-JP')}件
                  </span>
                  <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
                </div>
              </div>
            ) : null}
          </Card>
        </main>

        <aside className={styles.side}>
          <Card overflow="hidden">
            <CardHeader title="稼働状況" />
            <dl className={styles.sideBody}>
              <Fact label="状態" value={data ? (data.reminder.isActive ? '稼働中' : '停止中') : '—'} />
              <Fact label="対象者" value={data ? `${data.summary.targetCount.toLocaleString('ja-JP')}人` : '—'} />
              <Fact label="次回送信" value={data ? formatJst(data.summary.nextScheduledAt) : '—'} />
              <Fact label="停止予定" value="—" />
            </dl>
          </Card>

          {hasErrors ? (
            <Card overflow="hidden">
              <CardHeader title="要確認" />
              <div className={styles.attention}>
                <p>エラーがある場合だけ表示します。</p>
                <strong>送信エラー {data?.summary.errors ?? 0}件</strong>
                <span>送れなかった理由を確認してください</span>
                <Button onClick={showErrors}>実行結果を確認</Button>
              </div>
            </Card>
          ) : null}

          <LinePreview caption={data?.summary.nextScheduledAt ? `次は ${formatJst(data.summary.nextScheduledAt)} に届きます` : '次の送信予定はありません'} empty={!firstStep}>
            {loading ? '送る内容を確認しています。' : error ? '送る内容を表示できませんでした。' : firstStep ? <>{firstStep.messageContent}<span className={styles.previewAction}>Google Meetに参加</span></> : '送る内容はまだありません。'}
          </LinePreview>
        </aside>
      </div>

      <ReminderFooter
        status={loading ? '読み込み中' : error ? '状態を取得できません' : data?.reminder.isActive ? '稼働中' : '停止中'}
        secondary={data?.reminder.isActive ? { label: 'リマインダを一時停止', onClick: () => void pauseReminder() } : undefined}
        primary="リマインダの設定を編集"
        onPrimary={() => { window.location.href = `/reminders/edit?id=${reminderId}` }}
      />
    </div>
  )
}
