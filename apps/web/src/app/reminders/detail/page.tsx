'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  api,
  type ReminderDeliveryRun,
  type ReminderDeliveryRunsResponse,
  type ReminderDeliveryRunStatus,
} from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { Tabs } from '@/components/shared/tabs'
import styles from './reminder-runs.module.css'

const PAGE_SIZES = [10, 20, 50] as const

const STATUS_OPTIONS: Array<{ value: '' | ReminderDeliveryRunStatus; label: string }> = [
  { value: '', label: 'すべての結果' },
  { value: 'queued', label: '配信予定' },
  { value: 'claimed', label: '送信処理中' },
  { value: 'succeeded', label: '送信済み' },
  { value: 'retry_wait', label: '再試行待ち' },
  { value: 'permanent_failed', label: '送信できなかったもの' },
  { value: 'skipped', label: '送らなかったもの' },
  { value: 'cancelled', label: '取り消したもの' },
]

const STATUS_VIEW: Record<ReminderDeliveryRunStatus, { label: string; tone: StatusBadgeTone }> = {
  queued: { label: '配信予定', tone: 'info' },
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

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
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

export default function ReminderRunsPage() {
  const searchParams = useSearchParams()
  const reminderId = searchParams.get('id') ?? ''
  const [data, setData] = useState<ReminderDeliveryRunsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'' | ReminderDeliveryRunStatus>('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20)
  const [page, setPage] = useState(1)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState('')
  const [exporting, setExporting] = useState(false)
  usePageTitle(data?.reminder.name ? `${data.reminder.name}・実行結果` : null)

  const load = useCallback(async () => {
    if (!reminderId) return
    setLoading(true)
    setError('')
    // 読み直しに失敗したとき、前に取れた数字を現在値として残さない。
    setData(null)
    try {
      const response = await api.reminders.runs(reminderId, {
        status: status || undefined,
        search: search || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      if (!response.success) throw new Error(response.error)
      setData(response.data)
    } catch {
      setError('実行結果を読み込めませんでした。時間を置いてもう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, reminderId, search, status])

  useEffect(() => {
    void load()
  }, [load])

  const pageCount = Math.max(1, Math.ceil((data?.pagination.total ?? 0) / pageSize))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const firstStep = data?.steps[0] ?? null
  const hasErrors = (data?.summary.errors ?? 0) > 0

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
          search: search || undefined,
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

  const statusOptions = useMemo(
    () => STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    [],
  )

  return (
    <div className={styles.page} data-design-node="GC4St">
      <Tabs
        items={[
          { label: '設定', href: `/reminders/edit?id=${reminderId}` },
          { label: '実行結果', current: true },
        ]}
        actions={(
          <Button onClick={() => void exportCsv()} disabled={exporting || loading}>
            {exporting ? 'CSVを準備しています' : 'CSVで書き出す'}
          </Button>
        )}
      />

      <NoteBar tone={error || hasErrors ? 'danger' : 'info'}>
        {error
          ? '実行結果を確認できませんでした。再読み込みしてから、操作を続けてください。'
          : hasErrors
          ? `${data?.summary.errors ?? 0}件を送れませんでした。理由を確認し、必要なものだけ再試行してください。`
          : '配信予定・送信済み・送れなかった理由を、友だちごとに確認できます。'}
      </NoteBar>

      <div className={styles.summary}>
        <SummaryCard variant="v6" title="送信済み" value={data?.summary.sent ?? null} unit="通" detail="LINEが受け付けたもの" loading={loading} />
        <SummaryCard variant="v6" title="配信予定" value={data?.summary.scheduled ?? null} unit="通" detail="再試行待ちを含む" loading={loading} />
        <SummaryCard variant="v6" title="送信なし" value={data?.summary.stopped ?? null} unit="通" detail="取消・ブロックなど" loading={loading} />
        <SummaryCard variant="v6" title="送信失敗" value={data?.summary.errors ?? null} unit="通" detail="手動確認が必要" loading={loading} badge={hasErrors ? '要確認' : undefined} badgeTone="danger" />
      </div>

      {actionMessage ? <NoteBar tone={actionMessage.includes('ません') ? 'danger' : 'info'}>{actionMessage}</NoteBar> : null}

      <div className={styles.columns}>
        <main className={styles.main}>
          <Card overflow="hidden">
            <CardHeader title="通知実績" meta={loading || error ? '—通' : `${data?.steps.length ?? 0}通`} />
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
                    <Th align="right">既読</Th>
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
                      <Td align="right" title="LINEは友だち単位の既読を返しません">—</Td>
                      <Td align="right">{step.errors.toLocaleString('ja-JP')}件</Td>
                    </Tr>
                  ))}
                </tbody>
                </DataTable>
              </div>
            ) : null}
            {!loading && !error && (data?.steps.length ?? 0) === 0 ? (
              <ListState kind="empty" title="送る内容がありません" description="設定画面で通知を追加してください。" />
            ) : null}
          </Card>

          <Card overflow="hidden">
            <CardHeader title="最近の実行" meta={`${data?.pagination.total ?? 0}件`} />
            <div className={styles.toolbar}>
              <SearchField
                className={styles.search}
                value={searchInput}
                placeholder="友だち名で検索"
                aria-label="友だち名で検索"
                onChange={setSearchInput}
                onClear={() => {
                  setSearchInput('')
                  setSearch('')
                  setPage(1)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setSearch(searchInput.trim())
                    setPage(1)
                  }
                }}
              />
              <Button onClick={() => { setSearch(searchInput.trim()); setPage(1) }}>実行結果を検索</Button>
              <Select
                aria-label="実行結果で絞り込む"
                value={status}
                onChange={(value) => { setStatus(value as '' | ReminderDeliveryRunStatus); setPage(1) }}
                options={statusOptions}
              />
              <Select
                aria-label="表示件数"
                size="page-size"
                value={String(pageSize)}
                onChange={(value) => { setPageSize(Number(value) as (typeof PAGE_SIZES)[number]); setPage(1) }}
                options={PAGE_SIZES.map((value) => ({ value: String(value), label: `${value}件表示` }))}
              />
            </div>

            {loading ? <ListState kind="loading" /> : null}
            {!loading && error ? (
              <ListState kind="error" description={error} action={<Button onClick={() => void load()}>実行結果を再読み込み</Button>} />
            ) : null}
            {!loading && !error && (data?.items.length ?? 0) === 0 ? (
              <ListState
                kind="empty"
                title={search || status ? 'この条件に合う実行結果はありません' : '実行結果がまだありません'}
                description={search || status ? '条件を変えて確認してください。' : '配信予定が作られると、ここに記録されます。'}
              />
            ) : null}
            {!loading && !error && (data?.items.length ?? 0) > 0 ? (
              <div className={styles.tableWrap}>
                <DataTable className={styles.runsTable}>
                  <thead>
                    <TableHeadRow>
                      <Th>友だち</Th>
                      <Th>通知</Th>
                      <Th>結果</Th>
                      <Th>予定</Th>
                      <Th>実行</Th>
                      <Th>試行</Th>
                      <Th>理由・次の動き</Th>
                      {/*
                        要件 §3-7 は LINE要求ID を実行履歴の項目に挙げている。
                        **問い合わせるときはこれが要る。** LINE 側へ「この送信が
                        届いていない」と伝えるとき、日時と名前だけでは特定できない。
                      */}
                      <Th>LINE要求ID</Th>
                      <Th>操作</Th>
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
                          </Td>
                          <Td><StatusBadge tone={view.tone} size="compact">{view.label}</StatusBadge></Td>
                          <Td>{formatJst(item.scheduledAt)}</Td>
                          <Td>{formatJst(item.completedAt ?? item.startedAt)}</Td>
                          <Td align="right">{item.attemptCount}回</Td>
                          <Td>
                            <span className={styles.cellMain}>{item.lastErrorMessage ?? '—'}</span>
                            {item.nextRetryAt ? <span className={styles.cellSub}>次回 {formatJst(item.nextRetryAt)}</span> : null}
                          </Td>
                          <Td>
                            {/* まだ送っていない・送れなかったものには無い。**0や空文字で埋めない。** */}
                            {item.lineRequestId
                              ? <span className={styles.requestId} title={item.lineRequestId}>{item.lineRequestId}</span>
                              : '—'}
                          </Td>
                          <Td>
                            {canRetry ? (
                              <Button onClick={() => void retry(item.id)} disabled={retryingId === item.id}>
                                {retryingId === item.id ? '受付中' : 'この通知を再試行'}
                              </Button>
                            ) : '—'}
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
            <CardHeader title="現在の状態" />
            <dl className={styles.sideBody}>
              <div className={styles.fact}><dt>稼働</dt><dd>{data ? (data.reminder.isActive ? '動いています' : '止めています') : '—'}</dd></div>
              <div className={styles.fact}><dt>対象</dt><dd>{data ? `${data.summary.targetCount.toLocaleString('ja-JP')}人` : '—'}</dd></div>
              <div className={styles.fact}><dt>次の配信</dt><dd>{data ? formatJst(data.summary.nextScheduledAt) : '—'}</dd></div>
              <div className={styles.fact}><dt>予定停止</dt><dd>—</dd></div>
            </dl>
            <p className={styles.hint}>予定停止は現在の保存形式に無いため、値を作らず「—」で表示します。</p>
          </Card>

          <Card overflow="hidden">
            <CardHeader title="LINEで届く内容" meta={firstStep ? stepLabel(firstStep) : '—'} />
            {loading ? <p className={styles.hint}>送る内容を確認しています。</p> : null}
            {!loading && error ? <p className={styles.hint}>送る内容を表示できませんでした。</p> : null}
            {!loading && !error && firstStep ? <p className={styles.preview}>{firstStep.messageContent}</p> : null}
            {!loading && !error && !firstStep ? <p className={styles.hint}>送る内容はまだありません。</p> : null}
          </Card>

          <Card padding="default">
            <CardHeader title="操作" />
            <div className={styles.actions}>
              <Button href={`/reminders/edit?id=${reminderId}`}>リマインダの設定を編集</Button>
              <Button href="/reminders">リマインダ一覧へ戻る</Button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}
