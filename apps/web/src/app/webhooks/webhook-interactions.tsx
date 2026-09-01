'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { WebhookInteraction, WebhookInteractionList } from '@line-crm/shared'

import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

import styles from './webhook-interactions.module.css'

type Direction = 'all' | 'outgoing' | 'incoming'
type Status = 'all' | 'succeeded' | 'failed'

const EMPTY: WebhookInteractionList = {
  items: [],
  total: 0,
  page: 1,
  limit: 20,
  summary: { total: 0, outgoing: 0, incoming: 0, succeeded: 0, failed: 0, averageDurationMs: null },
}

const EVENT_LABELS: Record<string, string> = {
  'friend.added': '友だちが追加されたとき',
  'friend.tag_added': 'タグが追加されたとき',
  'message.received': 'メッセージを受け取ったとき',
  'conversion.created': '成果が認められたとき',
  'booking.created': '予約が入ったとき',
  'order.created': '注文が確定したとき',
}

function eventLabel(item: WebhookInteraction): string {
  if (item.direction === 'incoming') return `${item.webhookName}から受け取ったとき`
  return EVENT_LABELS[item.eventType] ?? '外部サービスへ送る条件に合ったとき'
}

function formatJst(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(date)
}

function directionLabel(direction: WebhookInteraction['direction']): string {
  return direction === 'outgoing' ? 'こちらから送った' : 'こちらで受け取った'
}

export default function WebhookInteractions() {
  const { selectedAccountId } = useAccount()
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)
  const [data, setData] = useState<WebhookInteractionList>(EMPTY)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState<Direction>('all')
  const [status, setStatus] = useState<Status>('all')
  const [periodDays, setPeriodDays] = useState(30)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [selected, setSelected] = useState<WebhookInteraction | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [bulkRetrying, setBulkRetrying] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [canRetry, setCanRetry] = useState(false)

  useEffect(() => {
    const role = window.localStorage.getItem('lh_staff_role')
    setCanRetry(role === 'owner' || role === 'admin')
  }, [])

  const load = useCallback(async () => {
    const requestAccountId = selectedAccountId
    const requestGeneration = ++loadGenerationRef.current
    setData(EMPTY)
    setLoadedAccountId(null)
    setSelected(null)
    setNotice(null)
    setRetrying(null)
    setBulkRetrying(false)
    if (!requestAccountId) {
      setData(EMPTY)
      setLoading(false)
      setError(false)
      return
    }
    setData(EMPTY)
    setSelected(null)
    setLoading(true)
    setError(false)
    try {
      const response = await api.webhooks.interactions.list(requestAccountId, {
        periodDays,
        direction: direction === 'all' ? undefined : direction,
        status: status === 'all' ? undefined : status,
        search: search || undefined,
        page,
        limit,
      })
      if (!response.success) throw new Error(response.error)
      if (
        loadGenerationRef.current !== requestGeneration
        || selectedAccountIdRef.current !== requestAccountId
      ) return
      setData(response.data)
      setLoadedAccountId(requestAccountId)
    } catch {
      if (
        loadGenerationRef.current !== requestGeneration
        || selectedAccountIdRef.current !== requestAccountId
      ) return
      setData(EMPTY)
      setLoadedAccountId(requestAccountId)
      setError(true)
    } finally {
      if (
        loadGenerationRef.current !== requestGeneration
        || selectedAccountIdRef.current !== requestAccountId
      ) return
      setLoading(false)
    }
  }, [selectedAccountId, periodDays, direction, status, search, page, limit])

  useEffect(() => { void load() }, [load])

  const successRate = data.summary.total > 0
    ? Math.round((data.summary.succeeded / data.summary.total) * 1000) / 10
    : 0
  const pageCount = Math.max(1, Math.ceil(data.total / data.limit))
  const range = useMemo(() => {
    if (data.total === 0) return '0件'
    const first = (data.page - 1) * data.limit + 1
    return `${first}〜${Math.min(data.total, first + data.items.length - 1)}件 / 全${data.total}件`
  }, [data])

  const retry = async (item: WebhookInteraction) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) return
    setRetrying(item.id)
    setNotice(null)
    try {
      const response = await api.webhooks.interactions.retry(item.id, requestAccountId)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!response.success) throw new Error(response.error)
      setNotice({
        tone: response.data.status === 'succeeded' ? 'success' : 'error',
        message: response.data.status === 'succeeded'
          ? `「${item.webhookName}」へもう一度送り、届いたことを確認しました。`
          : `「${item.webhookName}」へ送り直しましたが、まだ届きませんでした。`,
      })
      await load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setNotice({ tone: 'error', message: '送り直しを受け付けられませんでした。状態を読み直してからお試しください。' })
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setRetrying(null)
    }
  }

  const retryFailed = async () => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) return
    setBulkRetrying(true)
    setNotice(null)
    try {
      const response = await api.webhooks.interactions.retryFailed(requestAccountId)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!response.success) throw new Error(response.error)
      setNotice({
        tone: response.data.failed > 0 || response.data.skipped > 0 ? 'error' : 'success',
        message: `${response.data.requested}件を確認し、${response.data.succeeded}件が届きました。届かなかったもの ${response.data.failed}件、対象外 ${response.data.skipped}件です。`,
      })
      await load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setNotice({ tone: 'error', message: 'まとめて送り直せませんでした。状態を読み直してからお試しください。' })
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setBulkRetrying(false)
    }
  }

  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINEアカウントを選択してください" description="やり取りはLINEアカウントごとに分けて記録します。" />
  }

  if (loadedAccountId !== selectedAccountId && !error) {
    return <ListState kind="loading" title="やり取りの記録を読み込んでいます" />
  }

  return (
    <div className={styles.page} data-design-node="KNG00">
      {canRetry ? <div className={styles.topActions}>
        <Button
          onClick={() => void retryFailed()}
          disabled={loading || bulkRetrying || data.summary.failed === 0}
          title={data.summary.failed === 0 ? '送り直す失敗はありません' : undefined}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {bulkRetrying ? '失敗したものを確認中' : '失敗したものをまとめてやり直す'}
        </Button>
      </div> : null}

      {notice ? <Notice tone={notice.tone} message={notice.message} onClose={() => setNotice(null)} /> : null}

      {loading && data.items.length === 0 ? (
        <ListState kind="loading" title="やり取りの記録を読み込んでいます" />
      ) : error ? (
        <ListState
          kind="error"
          title="やり取りの記録を表示できませんでした"
          description="記録は消えていません。再読み込みしても直らない場合はエラー報告へ。"
          action={<Button onClick={() => void load()}>やり取りの記録を再読み込み</Button>}
        />
      ) : (
        <>
          <div className={styles.cards}>
            <SummaryCard variant="v6" title={`この${periodDays}日`} value={data.summary.total} unit="回" detail={`送った ${data.summary.outgoing.toLocaleString('ja-JP')}・受け取った ${data.summary.incoming.toLocaleString('ja-JP')}`} />
            <SummaryCard variant="v6" title="成功" value={data.summary.succeeded} unit="回" detail={`${successRate.toLocaleString('ja-JP')}%`} />
            <SummaryCard variant="v6" title="失敗" value={data.summary.failed} unit="回" detail={data.summary.failed > 0 ? '送り直せます' : '失敗はありません'} badge={data.summary.failed > 0 ? 'やり直す' : undefined} badgeTone="danger" />
            <SummaryCard variant="v6" title="返事までの時間" value={data.summary.averageDurationMs == null ? null : Math.round(data.summary.averageDurationMs / 100) / 10} unit="秒" detail={data.summary.averageDurationMs == null ? '未取得' : '送受信の処理時間'} />
          </div>

          <NoteBar>送った・受け取ったやり取りの記録です。失敗したものはここからやり直せます。</NoteBar>

          <div className={styles.tools}>
            <SearchField
              aria-label="つなぎ先・きっかけで検索"
              placeholder="つなぎ先・きっかけで検索"
              value={search}
              onChange={(value) => { setSearch(value); setPage(1) }}
              onClear={() => { setSearch(''); setPage(1) }}
              className={styles.search}
            />
            <div className={styles.selects}>
              <Select aria-label="期間" value={String(periodDays)} options={[{ value: '7', label: 'この7日' }, { value: '30', label: 'この30日' }, { value: '90', label: 'この90日' }]} onChange={(value) => { setPeriodDays(Number(value)); setPage(1) }} />
              <Select aria-label="表示件数" size="page-size" value={String(limit)} options={[{ value: '10', label: '10件表示' }, { value: '20', label: '20件表示' }, { value: '50', label: '50件表示' }]} onChange={(value) => { setLimit(Number(value)); setPage(1) }} />
            </div>
          </div>

          <div className={styles.filters} aria-label="やり取りの絞り込み">
            <button type="button" className={`${styles.filter} ${direction === 'all' && status === 'all' ? styles.filterActive : ''}`} onClick={() => { setDirection('all'); setStatus('all'); setPage(1) }}>すべて {data.summary.total.toLocaleString('ja-JP')}</button>
            <button type="button" className={`${styles.filter} ${direction === 'outgoing' ? styles.filterActive : ''}`} onClick={() => { setDirection('outgoing'); setStatus('all'); setPage(1) }}>送った {data.summary.outgoing.toLocaleString('ja-JP')}</button>
            <button type="button" className={`${styles.filter} ${direction === 'incoming' ? styles.filterActive : ''}`} onClick={() => { setDirection('incoming'); setStatus('all'); setPage(1) }}>受け取った {data.summary.incoming.toLocaleString('ja-JP')}</button>
            <button type="button" className={`${styles.filter} ${status === 'failed' ? styles.filterDanger : ''}`} onClick={() => { setDirection('all'); setStatus('failed'); setPage(1) }}>失敗 {data.summary.failed.toLocaleString('ja-JP')}</button>
          </div>

          {data.items.length === 0 ? (
            <ListState kind="empty" title="条件に合うやり取りはありません" description="期間や絞り込みを変えて確認してください。" />
          ) : (
            <DataTable className={styles.table}>
              <colgroup><col /><col /><col /><col /><col /><col /></colgroup>
              <thead><TableHeadRow><Th>いつ・どちら向き</Th><Th>つなぎ先</Th><Th>送った・届いた中身</Th><Th>返事</Th><Th>かかった時間</Th><Th><span className="sr-only">操作</span></Th></TableHeadRow></thead>
              <tbody>
                {data.items.map((item) => (
                  <Tr key={item.id}>
                    <Td><div className={styles.primary}>{formatJst(item.startedAt)} ／ {directionLabel(item.direction)}</div><div className={styles.secondary} title={eventLabel(item)}>{eventLabel(item)}</div></Td>
                    <Td><div className={`${styles.primary} ${item.status === 'failed' ? styles.danger : ''}`} title={item.webhookName}>{item.webhookName}</div></Td>
                    <Td><div className={styles.primary}>{item.direction === 'outgoing' ? '外部サービスへ渡す内容' : '外部サービスから届いた内容'}</div><div className={styles.secondary}>安全のため本文と接続情報は一覧に表示しません</div></Td>
                    <Td><StatusBadge tone={item.status === 'succeeded' ? 'success' : item.status === 'failed' ? 'danger' : 'info'}>{item.responseLabel}</StatusBadge></Td>
                    <Td>{item.durationMs == null ? '—' : `${Math.round(item.durationMs / 100) / 10}秒`}</Td>
                    <ActionCell><div className={styles.rowActions}><Button onClick={() => setSelected(item)}>中身を見る</Button>{canRetry && item.canRetry ? <Button onClick={() => void retry(item)} disabled={retrying === item.id}>{retrying === item.id ? 'やり直し中' : 'やり直す'}</Button> : null}</div></ActionCell>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}

          <div className={styles.pagination}>
            <span className={styles.count}>やり取り {range}</span>
            <Pagination page={data.page} pageCount={pageCount} onPageChange={setPage} disabled={loading} />
          </div>
        </>
      )}

      <Dialog open={Boolean(selected)} title="やり取りの中身" description="接続先URL、シークレット、本文は安全のため表示しません。" onCancel={() => setSelected(null)} cancelLabel="閉じる">
        {selected ? <dl className={styles.details}><div className={styles.detailsRow}><dt>日時</dt><dd>{formatJst(selected.startedAt)}</dd></div><div className={styles.detailsRow}><dt>向き</dt><dd>{directionLabel(selected.direction)}</dd></div><div className={styles.detailsRow}><dt>つなぎ先</dt><dd>{selected.webhookName}</dd></div><div className={styles.detailsRow}><dt>きっかけ</dt><dd>{eventLabel(selected)}</dd></div><div className={styles.detailsRow}><dt>結果</dt><dd>{selected.responseLabel}</dd></div><div className={styles.detailsRow}><dt>試した回数</dt><dd>{selected.attemptCount}回</dd></div><div className={styles.detailsRow}><dt>かかった時間</dt><dd>{selected.durationMs == null ? '—' : `${Math.round(selected.durationMs / 100) / 10}秒`}</dd></div>{selected.failureReason ? <div className={styles.detailsRow}><dt>失敗した理由</dt><dd>{selected.failureReason}</dd></div> : null}</dl> : null}
      </Dialog>
    </div>
  )
}
