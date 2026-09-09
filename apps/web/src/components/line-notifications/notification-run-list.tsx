'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api, type EcNotificationRun, type EcNotificationRunList } from '@/lib/api'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import SummaryCard from '@/components/shared/summary-card'
import { DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

const PAGE_SIZE = 20

const STATUS_LABEL: Record<EcNotificationRun['status'], string> = {
  pending: '送信処理中',
  accepted: 'LINE API受付済み',
  excluded: '送信対象外',
  failed: '送信できませんでした',
}

function StatusBadge({ status }: { status: EcNotificationRun['status'] }) {
  const label = STATUS_LABEL[status]
  if (status === 'pending') {
    return <span className="inline-flex rounded-pill bg-warning-bg px-2 py-1 text-xs font-semibold text-warning">{label}</span>
  }
  if (status === 'accepted') {
    return <span className="inline-flex rounded-pill bg-success-bg px-2 py-1 text-xs font-semibold text-success">{label}</span>
  }
  if (status === 'excluded') {
    return <span className="inline-flex rounded-pill bg-canvas-sunken px-2 py-1 text-xs font-semibold text-ink-faint">{label}</span>
  }
  return <span className="inline-flex rounded-pill bg-danger-bg px-2 py-1 text-xs font-semibold text-danger">{label}</span>
}

function formatJst(value: string | null): string {
  if (!value) return '—'
  // DBの古い行はJSTの文字列をオフセット無しで持つ。端末のタイムゾーンで
  // 読み直すと時刻がずれるため、その形は「既にJST」として整形だけ行う。
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
    return match ? `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}` : '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden'
export type RunFilter = 'all' | 'failed' | 'excluded' | 'clicked'
export type RecipientFilter = 'all' | EcNotificationRun['recipientType']
export type PeriodFilter = 'all' | '24h' | '7d' | '30d'

const PERIOD_MILLISECONDS: Record<Exclude<PeriodFilter, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

export function filterNotificationRuns(
  items: EcNotificationRun[],
  filters: {
    query: string
    status: RunFilter
    recipient: RecipientFilter
    period: PeriodFilter
  },
  now = Date.now(),
): EcNotificationRun[] {
  const normalized = filters.query.trim().toLocaleLowerCase('ja-JP')
  return items.filter((item) => {
    if (filters.status === 'clicked' && !item.clickedAt) return false
    if (filters.status === 'failed' && item.status !== 'failed') return false
    if (filters.status === 'excluded' && item.status !== 'excluded') return false
    if (filters.recipient !== 'all' && item.recipientType !== filters.recipient) return false
    if (filters.period !== 'all') {
      const receivedAt = new Date(item.receivedAt).getTime()
      if (!Number.isFinite(receivedAt) || receivedAt > now || now - receivedAt > PERIOD_MILLISECONDS[filters.period]) return false
    }
    if (!normalized) return true
    return [item.notificationName, item.friendName, item.orderNumber, item.reason, item.source]
      .some((value) => value?.toLocaleLowerCase('ja-JP').includes(normalized))
  })
}

export default function NotificationRunList({
  lineAccountId,
  mode,
}: {
  lineAccountId: string | null
  mode: 'history' | 'failures'
}) {
  const [page, setPage] = useState(1)
  const [state, setState] = useState<LoadState>('loading')
  const [result, setResult] = useState<EcNotificationRunList | null>(null)
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RunFilter>('all')
  const [recipientFilter, setRecipientFilter] = useState<RecipientFilter>('all')
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  // 再試行口は店長専用。担当者にはボタンを出さない。
  const [canRetry, setCanRetry] = useState(false)
  const [loadedScope, setLoadedScope] = useState('')
  const requestRef = useRef(0)
  const currentScope = `${lineAccountId ?? 'none'}:${mode}`

  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (active && response.success) setCanRetry(response.data.role === 'owner')
    }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    setPage(1)
    setQuery('')
    setFilter('all')
    setRecipientFilter('all')
    setPeriodFilter('all')
    setNotice(null)
  }, [lineAccountId, mode])

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoadedScope(currentScope)
    if (!lineAccountId) {
      setResult(null)
      setTotal(0)
      setState('ready')
      return
    }
    setState('loading')
    try {
      const params = {
        lineAccountId,
        view: mode === 'failures' ? 'failures' as const : 'all' as const,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }
      // 古い検証用モックと段階移行中の環境だけ、互換口へ戻す（404のとき1回だけ）。
      let fellBack = false
      const primary = await api.lineNotifications.deliveries(params).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          fellBack = true
          return api.ecCommerce.notificationRuns(params)
        }
        throw error
      })
      if (!primary.success) throw new Error('load failed')
      // 互換口の結果をもう一度取り直さない。毎回2要求になるのを防ぐ。
      const response = !fellBack && (!primary.pagination || primary.data.coverage?.source !== 'notification_delivery_ledger')
        ? await api.ecCommerce.notificationRuns(params)
        : primary
      if (request !== requestRef.current) return
      if (!response.success) throw new Error('load failed')
      setResult(response.data)
      setTotal(response.pagination.total)
      setState('ready')
    } catch (error) {
      if (request !== requestRef.current) return
      setResult(null)
      setTotal(0)
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [currentScope, lineAccountId, mode, page])

  useEffect(() => { void load() }, [load])

  const retry = async (item: EcNotificationRun) => {
    if (!lineAccountId || !item.retryAvailable) return
    setRetryingId(item.id)
    setNotice(null)
    try {
      await api.lineNotifications.retryDelivery(item.id, {
        lineAccountId,
        expectedVersion: item.recordVersion,
      })
      setNotice({ tone: 'success', text: '同じ通知の送信を安全に再試行しました。' })
      await load()
    } catch (error) {
      const text = error instanceof ApiError && error.status === 403
        ? '送信の再試行は店長だけができます。'
        : error instanceof ApiError && error.status === 409
          ? 'ほかの担当者が先に再試行しました。最新の記録を読み直してください。'
          : '送信を再試行できませんでした。時間をおいて読み直してください。'
      setNotice({ tone: 'error', text })
    } finally {
      setRetryingId(null)
    }
  }

  const title = mode === 'failures' ? '送れなかったもの' : 'お知らせの記録'
  const nodeId = mode === 'failures' ? 'X8JCA5' : 'Se65i'
  // アカウント切替の直後は、useEffectが動く前でも前アカウントの行を描かない。
  const visibleState: LoadState = loadedScope === currentScope ? state : lineAccountId ? 'loading' : 'ready'
  const scopedResult = loadedScope === currentScope ? result : null
  const scopedTotal = loadedScope === currentScope ? total : 0
  const items = useMemo(() => scopedResult?.items ?? [], [scopedResult])
  const summary = scopedResult?.summary ?? null
  const pageCount = Math.max(1, Math.ceil(scopedTotal / PAGE_SIZE))
  const summaryDetail = (ready: string): string => {
    if (!lineAccountId) return 'LINEアカウントを選択すると表示します'
    if (visibleState === 'error') return '取得できませんでした'
    if (visibleState === 'forbidden') return '見る権限がありません'
    return ready
  }
  const filters: Array<{ value: RunFilter; label: string }> = mode === 'failures'
    ? [{ value: 'all', label: 'すべて' }, { value: 'failed', label: '送信できなかった' }, { value: 'excluded', label: '送信対象外' }]
    : [{ value: 'all', label: 'すべて' }, { value: 'clicked', label: 'クリック記録あり' }, { value: 'failed', label: '送れなかった' }]
  const visibleItems = useMemo(() => filterNotificationRuns(items, {
    query,
    status: filter,
    recipient: recipientFilter,
    period: periodFilter,
  }), [filter, items, periodFilter, query, recipientFilter])
  const listState = !lineAccountId
    ? 'account-required'
    : visibleState === 'ready' && items.length === 0
      ? 'empty'
      : visibleState === 'ready' && visibleItems.length === 0
        ? 'filtered-empty'
        : visibleState

  return (
    <section className="space-y-4" data-design-node={nodeId} data-list-state={listState} aria-label={title}>
      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${mode === 'history' ? 'xl:grid-cols-4' : ''}`}>
        {mode === 'failures' ? <>
          <SummaryCard title="届かなかった" value={summary?.failed ?? null} unit="通" detail={summaryDetail('確認と連絡が必要')} variant="v6" loading={visibleState === 'loading'} badgeTone="danger" />
          <SummaryCard title="送信対象外" value={summary?.excluded ?? null} unit="通" detail={summaryDetail('つながりや設定を確認')} variant="v6" loading={visibleState === 'loading'} />
        </> : <>
          <SummaryCard title="お知らせの記録" value={lineAccountId && visibleState === 'ready' ? scopedTotal : null} unit="件" detail={summaryDetail('選択中のLINEアカウント')} variant="v6" loading={visibleState === 'loading'} />
          <SummaryCard title="LINE API受付済み" value={summary?.accepted ?? null} unit="通" detail={summaryDetail('LINEへの受付まで確認')} variant="v6" loading={visibleState === 'loading'} />
          <SummaryCard title="送信処理中" value={summary?.pending ?? null} unit="通" detail={summaryDetail('送信台帳に記録済み')} variant="v6" loading={visibleState === 'loading'} />
          <SummaryCard title="送れなかった" value={summary?.failed ?? null} unit="通" detail={summaryDetail('対応が必要なもの')} variant="v6" loading={visibleState === 'loading'} badgeTone="danger" />
        </>}
      </div>

      <div className="rounded-control border border-warning bg-warning-bg px-4 py-3 text-sm leading-6 text-warning">
        {mode === 'failures'
          ? '発送や返金のお知らせが届いていない場合は、その日のうちに受信箱など別の手だてで連絡してください。対応済みの記録は、送信台帳に項目が追加された後に表示します。'
          : '選択中のLINEアカウントと結び付きを確認できたEC通知だけを表示します。個人の既読は取得せず、押されたかどうかは自社の短縮URLだけで数えます。'}
        <span className="mt-1 block text-xs">個人の既読は取得できません。試行回数と次の再試行予定は送信台帳の記録を表示します。</span>
      </div>

      {notice ? <div className={`rounded-control border px-4 py-3 text-sm ${notice.tone === 'success' ? 'border-success bg-success-bg text-success' : 'border-danger bg-danger-bg text-danger'}`}>{notice.text}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-64 flex-1">
          <span className="sr-only">お客様の名前・注文番号で検索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="お客様の名前・注文番号で検索（表示中の20件のみ）" className="min-h-10 w-full rounded-control border border-hairline bg-canvas px-3 text-sm outline-none focus:border-accent" />
        </label>
        {filters.map((item) => <FilterChip key={item.value} selected={filter === item.value} onChange={() => setFilter(item.value)}>{item.label}</FilterChip>)}
        <Select
          aria-label="対象を絞り込み"
          label="対象"
          value={recipientFilter}
          onChange={(value) => setRecipientFilter(value as RecipientFilter)}
          options={[
            { value: 'all', label: 'すべて' },
            { value: 'customer', label: '顧客' },
            { value: 'operator', label: '運用者' },
          ]}
        />
        <Select
          aria-label="期間を絞り込み"
          label="期間"
          value={periodFilter}
          onChange={(value) => setPeriodFilter(value as PeriodFilter)}
          options={[
            { value: 'all', label: 'すべて' },
            { value: '24h', label: '24時間以内' },
            { value: '7d', label: '7日以内' },
            { value: '30d', label: '30日以内' },
          ]}
        />
        <span className="text-xs text-ink-faint" title="検索と絞り込みは表示中のページの中だけに効きます">表示中の20件を絞り込み</span>
      </div>

      {!lineAccountId ? (
        <ListState kind="empty" title="LINEアカウントを選択してください" description="上のアカウント切り替えから、確認するLINEアカウントを選んでください。" />
      ) : visibleState === 'loading' ? (
        <ListState kind="loading" title={`${title}を読み込んでいます`} />
      ) : visibleState === 'error' ? (
        <ListState
          kind="error"
          title={`${title}を表示できませんでした`}
          description="登録済みの記録は消えていません。時間をおいて読み直してください。"
          action={<Button onClick={() => void load()}>記録を再読み込み</Button>}
        />
      ) : visibleState === 'forbidden' ? (
        <ListState kind="forbidden" />
      ) : items.length === 0 ? (
        <ListState
          kind="empty"
          title={mode === 'failures' ? '送れなかったお知らせはありません' : 'お知らせの記録はまだありません'}
          description={mode === 'failures' ? '現在の表示範囲には、確認が必要な失敗はありません。' : 'ECからのお知らせを処理すると、ここに記録が残ります。'}
        />
      ) : visibleItems.length === 0 ? (
        <ListState kind="empty" title="条件に合う記録はありません" description="検索語か絞り込みを変えてください。" />
      ) : (
        <>
          <DataTable>
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th>お知らせ</Th>
                <Th>対象者</Th>
                <Th>状態</Th>
                <Th>受け付けた日時</Th>
                <Th>試行・クリック</Th>
                <Th>理由・対応</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <Tr key={item.id}>
                  <NameCell name={item.notificationName} sub={item.orderNumber ? `注文 ${item.orderNumber}` : item.source} />
                  <NameCell name={item.friendName || '名前は未取得'} sub={item.recipientType === 'customer' ? '顧客へのお知らせ' : '運用者へのお知らせ'} />
                  <Td><StatusBadge status={item.status} /></Td>
                  <Td>
                    <span className="block whitespace-nowrap text-sm">{formatJst(item.receivedAt)}</span>
                    <span className="mt-1 block whitespace-nowrap text-xs text-ink-faint">LINE受付 {formatJst(item.acceptedAt)}</span>
                  </Td>
                  <Td>
                    <span className="block text-sm">試行 {item.attemptCount == null ? '—' : `${item.attemptCount}回`}</span>
                    <span className="mt-1 block text-xs text-ink-faint">クリック {formatJst(item.clickedAt)}</span>
                    {item.nextRetryAt ? <span className="mt-1 block text-xs text-warning">次回 {formatJst(item.nextRetryAt)}</span> : null}
                  </Td>
                  <Td>
                    <span className="block text-sm leading-5 text-ink-secondary">{item.reason || '—'}</span>
                    {mode === 'failures' && item.friendId ? (
                      <Link href={`/chats?friend=${encodeURIComponent(item.friendId)}`} className="mt-1 inline-block whitespace-nowrap text-xs font-semibold text-accent hover:underline">
                        受信箱で連絡
                      </Link>
                    ) : null}
                    {mode === 'failures' && item.retryAvailable && canRetry ? (
                      <Button className="mt-2" disabled={retryingId === item.id} onClick={() => void retry(item)}>
                        {retryingId === item.id ? '再試行中' : '送信を再試行'}
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-ink-faint">
              {(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, scopedTotal)}件 / 全{scopedTotal.toLocaleString('ja-JP')}件
            </p>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </div>
        </>
      )}
    </section>
  )
}
