'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import PageHeader from '@/components/shared/page-header'
import Select from '@/components/shared/select'
import SummaryCard from '@/components/shared/summary-card'
import { ActionCell, DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { useAccount } from '@/contexts/account-context'
import { ApiError, api, type EcCommerceEvent, type EcCommerceOverview } from '@/lib/api'
import ConnectorPanel from './connector-panel'
import SubscriptionsPanel from './subscriptions-panel'
import { EC_TABS } from './ec-tabs'
import styles from './ec-commerce-v6.module.css'

const EVENT_STATUS: Record<EcCommerceEvent['status'], { label: string; tone: string }> = {
  received: { label: '受け取り済み', tone: styles.statusMuted },
  identity_pending: { label: 'つき合わせ待ち', tone: styles.statusWarn },
  processing: { label: '処理中', tone: styles.statusWarn },
  processed: { label: '反映済み', tone: styles.statusGood },
  skipped: { label: '反映なし', tone: styles.statusMuted },
  failed: { label: '要確認', tone: styles.statusWarn },
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
  const [events, setEvents] = useState<EcCommerceEvent[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | EcCommerceEvent['status']>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')

  const load = useCallback(async () => {
    if (!accountId) {
      setOverview(null)
      setEvents([])
      setState('empty')
      return
    }
    setState('loading')
    try {
      const [overviewResponse, eventsResponse] = await Promise.all([
        api.ecCommerce.overview(accountId),
        api.ecCommerce.events({ lineAccountId: accountId, limit: 20 }),
      ])
      if (!overviewResponse.success || !eventsResponse.success) {
        throw new Error('invalid_ec_response')
      }
      const hasOverview = typeof overviewResponse.data === 'object'
        && overviewResponse.data !== null
        && !Array.isArray(overviewResponse.data)
      if (!hasOverview || !Array.isArray(eventsResponse.data)) {
        throw new Error('invalid_ec_response')
      }
      setOverview(overviewResponse.data)
      setEvents(eventsResponse.data)
      setState(eventsResponse.data.length ? 'ready' : 'empty')
    } catch (error) {
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    return events
      .filter((event) => status === 'all' || event.status === status)
      .filter((event) => !needle || [event.eventLabel, event.orderNumber, event.friendName]
        .some((value) => value?.toLocaleLowerCase('ja-JP').includes(needle)))
      .toSorted((left, right) => {
        const delta = Date.parse(right.receivedAt) - Date.parse(left.receivedAt)
        return sort === 'newest' ? delta : -delta
      })
  }, [events, query, sort, status])

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
        <div className="min-w-0 rounded-tile border border-hairline bg-canvas p-4">
          <p className="text-xs font-semibold text-ink-faint">最後に届いた</p>
          <p className="mt-1 text-2xl font-bold text-ink tabular-nums">{dateTime(overview?.lastReceivedAt ?? null)}</p>
          <p className="mt-1 text-xs text-ink-faint">最後に受け取った時刻</p>
        </div>
      </div>
      <NoteBar>ECの注文にはLINEの友だちが書かれていません。確認済みのメールアドレスか電話番号で結びつけ、見つからない注文は「会員のつき合わせ」に並べます。</NoteBar>
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
          ['processed', '反映済み', overview?.processed],
          ['processing', '処理中', events.filter((event) => event.status === 'processing').length],
          ['identity_pending', '送信なし', overview?.identityPending],
          ['failed', '失敗', overview?.failed],
        ] as const).map(([value, label, count]) => ({
          label,
          count,
          current: status === value,
          onClick: () => setStatus(value),
        }))} />
      <DataTable>
        <thead><TableHeadRow><Th>いつ・何が届いたか</Th><Th>お客様</Th><Th>中身</Th><Th>したこと</Th><Th>状態</Th><Th align="right">操作</Th></TableHeadRow></thead>
        <tbody>
          {shown.map((event) => (
            <Tr key={event.id}>
              <Td><span className={styles.cellStack}><span className={styles.cellMain}>{dateTime(event.receivedAt)} ／ {event.eventLabel}</span><span className={styles.cellSub}>{event.orderNumber ? `注文 ${event.orderNumber}` : '注文番号 —'}</span></span></Td>
              <Td>{event.friendName ?? <span className="text-xs text-ink-faint">見つかりません</span>}</Td>
              <Td><span className="text-xs text-ink-faint">商品明細は未取得</span></Td>
              <Td>{event.status === 'processed'
                ? 'LINE側まで反映済み'
                : event.status === 'identity_pending'
                  ? 'つき合わせ後に処理'
                  : event.status === 'failed'
                    ? event.errorMessage ?? '処理できませんでした'
                    : EVENT_STATUS[event.status].label}</Td>
              <Td><span className={`${styles.status} ${EVENT_STATUS[event.status].tone}`}>{EVENT_STATUS[event.status].label}</span></Td>
              <ActionCell>{event.friendId
                ? <Link className={styles.textLink} href={`/friends/${event.friendId}`}>中身を見る</Link>
                : <Link className={styles.textLink} href="/ec-commerce/identity-candidates">つき合わせる</Link>}</ActionCell>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      <div className={styles.footer}>
        {shown.length === 0 ? <p>条件に合う取り込みの記録はありません。</p> : null}
        <p>取り込みの記録 {overview?.total.toLocaleString('ja-JP') ?? '—'}件中 {shown.length.toLocaleString('ja-JP')}件を表示しています。</p>
        <p>注文の本文や接続用の秘密値、取得できない商品明細は表示していません。失敗だけを再試行する受け口は未接続です。</p>
      </div>
    </>
  )
}

function EcCommercePageInner() {
  const tab = useMergedTab(EC_TABS, 'tab', 'events')
  const { selectedAccountId } = useAccount()

  return (
    <div className={styles.root} data-design="Head">
      <PageHeader
        breadcrumb={[{ label: '専用機能' }, { label: 'EC連携' }]}
        title="EC連携"
        description="ECの注文・定期便を取り込み、LINEの配信や成果へつなげます。"
        actions={<Button href="/support" variant="secondary">マニュアル</Button>}
      />
      <MergedTabs basePath="/ec-commerce" tabs={EC_TABS} active={tab} defaultKey="events" />
      {tab === 'events' ? <EventsPanel accountId={selectedAccountId} /> : null}
      {tab === 'subscriptions' ? <SubscriptionsPanel accountId={selectedAccountId} /> : null}
      {tab === 'connector' ? <ConnectorPanel accountId={selectedAccountId} /> : null}
    </div>
  )
}

export default function EcCommercePage() {
  return <Suspense fallback={<ListState kind="loading" />}><EcCommercePageInner /></Suspense>
}
