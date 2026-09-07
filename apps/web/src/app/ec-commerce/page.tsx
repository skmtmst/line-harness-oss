'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useMergedTab } from '@/components/layout/merged-tabs'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import PageHeader from '@/components/shared/page-header'
import Select from '@/components/shared/select'
import SummaryCard from '@/components/shared/summary-card'
import { ActionCell, DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { useAccount } from '@/contexts/account-context'
import {
  ApiError,
  api,
  type EcActionExecution,
  type EcActionExecutionList,
  type EcActionExecutionStatus,
  type EcCommerceOverview,
  type EcOrder,
} from '@/lib/api'
import ConnectorPanel from './connector-panel'
import EcTabs from './ec-tabs-view'
import SubscriptionsPanel from './subscriptions-panel'
import { EC_TABS } from './ec-tabs'
import styles from './ec-commerce-v6.module.css'

const ACTION_STATUS: Record<EcActionExecutionStatus, { label: string; tone: string }> = {
  pending: { label: '処理中', tone: styles.statusWarn },
  processing: { label: '処理中', tone: styles.statusWarn },
  succeeded: { label: '送信完了', tone: styles.statusGood },
  skipped: { label: '送信なし', tone: styles.statusMuted },
  retryable_failed: { label: '失敗', tone: styles.statusDanger },
  permanent_failed: { label: '失敗', tone: styles.statusDanger },
}

const EVENT_LABEL: Record<string, string> = {
  'ec.order.confirmed': '注文が確定',
  'ec.order.payment_received': '入金を確認',
  'ec.order.shipped': '発送しました',
  'ec.order.cancelled': '注文を取り消し',
  'ec.order.refunded': '返金しました',
  'ec.customer.profile_updated': '会員情報が変わりました',
  'ec.subscription.started': '定期便がはじまりました',
  'ec.subscription.payment_failed': '定期便の支払いを確認',
}

const ACTION_LABEL: Record<string, string> = {
  'ec.order.confirmed': '注文ありがとうございますを送信',
  'ec.order.payment_received': '定期便のご案内を送信',
  'ec.order.shipped': 'お荷物を送りましたを送信',
  'ec.order.cancelled': '注文の取り消しを反映',
  'ec.order.refunded': '成果を取り消し・マイルを調整',
  'ec.customer.profile_updated': '会員情報を更新',
}

function dateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function EventsPanel({ accountId }: { accountId: string | null }) {
  const [overview, setOverview] = useState<EcCommerceOverview | null>(null)
  const [orders, setOrders] = useState<EcOrder[]>([])
  const [actions, setActions] = useState<EcActionExecution[]>([])
  const [actionSummary, setActionSummary] = useState<EcActionExecutionList['summary'] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'succeeded' | 'processing' | 'skipped' | 'failed'>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async (showLoading = true) => {
    if (!accountId) {
      setOverview(null)
      setOrders([])
      setActions([])
      setActionSummary(null)
      setState('empty')
      return
    }
    if (showLoading) setState('loading')
    try {
      const [overviewResponse, ordersResponse, actionsResponse] = await Promise.all([
        api.ecCommerce.overview(accountId),
        api.ecCommerce.orders({ lineAccountId: accountId, limit: 20 }),
        api.ecCommerce.actionExecutions({ lineAccountId: accountId, limit: 20 }),
      ])
      if (!overviewResponse.success || !ordersResponse.success || !actionsResponse.success) {
        throw new Error('invalid_ec_response')
      }
      const hasOverview = typeof overviewResponse.data === 'object'
        && overviewResponse.data !== null
        && !Array.isArray(overviewResponse.data)
      if (!hasOverview || !Array.isArray(ordersResponse.data?.items) || !Array.isArray(actionsResponse.data?.items)) {
        throw new Error('invalid_ec_response')
      }
      setOverview(overviewResponse.data)
      setOrders(ordersResponse.data.items)
      setActions(actionsResponse.data.items)
      setActionSummary(actionsResponse.data.summary)
      setState(actionsResponse.data.items.length ? 'ready' : 'empty')
    } catch (error) {
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const ordersByNumber = useMemo(
    () => new Map(orders.map((order) => [order.orderNumber, order])),
    [orders],
  )

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    return actions
      .filter((action) => {
        if (status === 'all') return true
        if (status === 'processing') return action.status === 'pending' || action.status === 'processing'
        if (status === 'failed') return action.status === 'retryable_failed' || action.status === 'permanent_failed'
        return action.status === status
      })
      .filter((action) => {
        const order = action.orderNumber ? ordersByNumber.get(action.orderNumber) : null
        return !needle || [EVENT_LABEL[action.eventType], action.orderNumber, action.customerName, ...(order?.orderLines.map((line) => line.productName) ?? [])]
          .some((value) => value?.toLocaleLowerCase('ja-JP').includes(needle))
      })
      .toSorted((left, right) => {
        const delta = Date.parse(right.receivedAt) - Date.parse(left.receivedAt)
        return sort === 'newest' ? delta : -delta
      })
  }, [actions, ordersByNumber, query, sort, status])

  const retry = async (action: EcActionExecution) => {
    if (!accountId || !action.retryAvailable) return
    setRetryingId(action.id)
    setNotice(null)
    try {
      const response = await api.ecCommerce.retryActionExecution(
        action.id,
        { lineAccountId: accountId, expectedVersion: action.version },
        crypto.randomUUID(),
      )
      if (!response.success) throw new Error('retry_failed')
      setNotice({ tone: 'success', text: '失敗した処理だけを、もう一度行う待ち行列へ戻しました。' })
      await load(false)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await load(false)
      setNotice({
        tone: 'error',
        text: error instanceof ApiError && error.status === 409
          ? '別の担当者が先に更新しました。最新の状態を読み直しました。'
          : '処理をもう一度行う準備ができませんでした。時間をおいてやり直してください。',
      })
    } finally {
      setRetryingId(null)
    }
  }

  if (state !== 'ready') {
    return (
      <ListState
        kind={state}
        title={state === 'error'
          ? 'ECデータ連携の情報を読み込めませんでした'
          : state === 'empty' && !accountId
            ? 'LINEアカウントを選択してください'
            : undefined}
        description={state === 'empty' && !accountId ? '左のメニュー上部で、確認するLINEアカウントを選びます。' : undefined}
        onRetry={state === 'error' ? () => void load() : undefined}
      />
    )
  }

  return (
    <>
      <div className={styles.kpis}>
        <SummaryCard variant="v6" title="今日 取り込んだ" value={overview?.last24h ?? null} unit="件" detail={overview?.byType.map((item) => `${item.label} ${item.count.toLocaleString('ja-JP')}`).join('・') ?? '内訳は未取得'} />
        <SummaryCard variant="v6" title="つながっていない注文" value={overview?.identityPending ?? null} unit="件" detail="LINEの友だちが見つかりません" badge="つき合わせ" />
        <SummaryCard variant="v6" title="取り込みに失敗" value={overview?.failed ?? null} unit="件" detail="確認してから再処理します" badge="確認" badgeTone="danger" />
        <div className="min-w-0 rounded-card border border-hairline bg-canvas p-4">
          <p className="text-xs font-semibold text-ink-faint">最後に届いた</p>
          <p className="mt-1 text-2xl font-bold text-ink tabular-nums">{dateTime(overview?.lastReceivedAt ?? null)}</p>
          <p className="mt-1 text-xs text-ink-faint">最後に受け取った時刻</p>
        </div>
      </div>
      <NoteBar>ECの注文にはLINEの友だちが書かれていません。確認済みのメールアドレスか電話番号で結びつけ、見つからない注文は「会員のつき合わせ」に並べます。</NoteBar>
      {notice ? <div className={notice.tone === 'success' ? styles.noticeSuccess : styles.noticeError} role="status">{notice.text}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          className="min-w-80 flex-1 rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="注文番号・お名前・出来事で検索"
          aria-label="取り込みの記録を検索"
        />
        <Select
          aria-label="取り込みの並び順"
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          options={[
            { value: 'newest', label: '取り込みが新しい順' },
            { value: 'oldest', label: '取り込みが古い順' },
          ]}
        />
      </div>
      <Tabs items={([
          ['all', 'すべて', overview?.total],
          ['succeeded', '送信完了', actionSummary?.succeeded],
          ['processing', '処理中', (actionSummary?.pending ?? 0) + (actionSummary?.processing ?? 0)],
          ['skipped', '送信なし', actionSummary?.skipped],
          ['failed', '失敗', (actionSummary?.retryable_failed ?? 0) + (actionSummary?.permanent_failed ?? 0)],
        ] as const).map(([value, label, count]) => ({
          label,
          count,
          current: status === value,
          onClick: () => setStatus(value),
        }))} />
      <DataTable>
        <thead><TableHeadRow><Th>いつ・何が届いたか</Th><Th>お客様</Th><Th>中身</Th><Th>したこと</Th><Th>状態</Th><Th align="right">操作</Th></TableHeadRow></thead>
        <tbody>
          {shown.map((action) => {
            const order = action.orderNumber ? ordersByNumber.get(action.orderNumber) : null
            const contents = order?.orderLines.length
              ? order.orderLines.map((line) => `${line.productName} × ${line.quantity}`).join('・')
              : '商品明細は未取得'
            const amount = order?.status === 'refunded' && order.refundedAmount !== null
              ? `−¥${order.refundedAmount.toLocaleString('ja-JP')}`
              : order?.totalAmount === null || order?.totalAmount === undefined
                ? null
                : `¥${order.totalAmount.toLocaleString('ja-JP')}`
            const statusInfo = ACTION_STATUS[action.status]
            return <Tr key={action.id}>
              <Td><span className={styles.cellStack}><span className={styles.cellMain}>{dateTime(action.receivedAt)} ／ {EVENT_LABEL[action.eventType] ?? 'ECの出来事'}</span><span className={styles.cellSub}>{action.orderNumber ? `注文 ${action.orderNumber}${amount ? ` ／ ${amount}` : ''}` : '注文番号 —'}</span></span></Td>
              <Td>{action.customerName ?? <span className="text-xs text-ink-faint">見つかりません</span>}</Td>
              <Td><span className={order?.orderLines.length ? undefined : 'text-xs text-ink-faint'}>{contents}</span></Td>
              <Td>{action.status === 'retryable_failed' || action.status === 'permanent_failed'
                ? action.errorMessage ?? `${action.attemptCount}回やり直しました`
                : action.status === 'skipped'
                  ? '何もしていません'
                  : ACTION_LABEL[action.eventType] ?? statusInfo.label}</Td>
              <Td><span className={`${styles.status} ${statusInfo.tone}`}>{statusInfo.label}</span></Td>
              <ActionCell>
                {order?.friendId
                  ? <Link className={styles.textLink} href={`/friends/${order.friendId}`}>中身を見る</Link>
                  : <Link className={styles.textLink} href="/ec-commerce/identity-candidates">つき合わせる</Link>}
                {action.retryAvailable ? <Button type="button" disabled={retryingId === action.id} onClick={() => void retry(action)}>{retryingId === action.id ? '戻しています…' : 'もう一度やる'}</Button> : null}
              </ActionCell>
            </Tr>
          })}
        </tbody>
      </DataTable>
      <div className={styles.footer}>
        {shown.length === 0 ? <p>条件に合う取り込みの記録はありません。</p> : null}
        <p>取り込みの記録 {overview?.total.toLocaleString('ja-JP') ?? '—'}件中 {shown.length.toLocaleString('ja-JP')}件を表示しています。</p>
        <p>注文の本文や接続用の秘密値は表示しません。もう一度行うときも、成功済みの処理は重ねません。</p>
      </div>
    </>
  )
}

function EcCommercePageInner() {
  const tab = useMergedTab(EC_TABS, 'tab', 'events')
  const { selectedAccountId } = useAccount()

  return (
    <div className={styles.root} data-design="Head">
      {/* マニュアルは共通トップバーに置く。本文に「ECの注文・定期便を取り込み、LINEの配信や成果へつなげます。」という重複説明は置かない。 */}
      <PageHeader
        breadcrumb={[{ label: '専用機能' }, { label: 'EC連携' }]}
        title="EC連携"
        description=""
        actions={tab === 'events'
          ? <Button href="/ec-commerce?tab=connector" variant="secondary">つなぎ先の設定</Button>
          : tab === 'subscriptions'
            ? <Button href="/broadcasts/new" variant="primary">対象を選んで配信</Button>
            : undefined}
      />
      <EcTabs accountId={selectedAccountId} active={tab as typeof EC_TABS[number]['key']} />
      {tab === 'events' ? <EventsPanel accountId={selectedAccountId} /> : null}
      {tab === 'subscriptions' ? <SubscriptionsPanel accountId={selectedAccountId} /> : null}
      {tab === 'connector' ? <ConnectorPanel accountId={selectedAccountId} /> : null}
    </div>
  )
}

export default function EcCommercePage() {
  return <Suspense fallback={<ListState kind="loading" />}><EcCommercePageInner /></Suspense>
}
