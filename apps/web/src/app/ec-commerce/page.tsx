'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import PageHeader from '@/components/shared/page-header'
import SummaryCard from '@/components/shared/summary-card'
import { ActionCell, DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import { ApiError, api, type EcCommerceEvent, type EcCommerceOverview } from '@/lib/api'
import ConnectorPanel from './connector-panel'
import SubscriptionsPanel from './subscriptions-panel'
import styles from './ec-commerce-v6.module.css'

const TABS = [
  { key: 'events', label: '取り込みの記録' },
  { key: 'identity', label: '会員のつき合わせ', href: '/ec-commerce/identity-candidates' },
  { key: 'subscriptions', label: '定期便' },
  { key: 'connector', label: 'つなぎ先' },
] as const

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
        <SummaryCard variant="v6" title="24時間の受け取り" value={overview?.last24h ?? null} unit="件" detail="ECから届いた出来事" />
        <SummaryCard variant="v6" title="反映済み" value={overview?.processed ?? null} unit="件" detail="LINE側の処理まで終わったもの" />
        <SummaryCard variant="v6" title="つき合わせ待ち" value={overview?.identityPending ?? null} unit="件" detail="会員の確認が必要なもの" />
        <SummaryCard variant="v6" title="要確認" value={overview?.failed ?? null} unit="件" detail={`最後に届いた ${dateTime(overview?.lastReceivedAt ?? null)}`} />
      </div>
      <NoteBar>注文の本文や接続用の秘密値は表示せず、取り込み結果だけを記録しています。</NoteBar>
      <DataTable>
        <thead><TableHeadRow><Th>届いた出来事</Th><Th>注文・お客様</Th><Th>届いた時刻</Th><Th>ようす</Th><Th align="right">操作</Th></TableHeadRow></thead>
        <tbody>
          {events.map((event) => (
            <Tr key={event.id}>
              <Td><span className={styles.cellStack}><span className={styles.cellMain}>{event.eventLabel}</span><span className={styles.cellSub}>{event.externalEventId}</span></span></Td>
              <Td><span className={styles.cellStack}><span className={styles.cellMain}>{event.orderNumber ? `注文 ${event.orderNumber}` : '注文番号 —'}</span><span className={styles.cellSub}>{event.friendName ?? '友だち 未確定'}</span></span></Td>
              <Td>{dateTime(event.receivedAt)}</Td>
              <Td><span className={`${styles.status} ${EVENT_STATUS[event.status].tone}`}>{EVENT_STATUS[event.status].label}</span></Td>
              <ActionCell>{event.friendId ? <Link className={styles.textLink} href={`/friends/${event.friendId}`}>中身を見る</Link> : '—'}</ActionCell>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      <p className={styles.footer}>{events.length.toLocaleString('ja-JP')}件を表示しています。</p>
    </>
  )
}

function EcCommercePageInner() {
  const tab = useMergedTab(TABS, 'tab', 'events')
  const { selectedAccountId } = useAccount()

  return (
    <div className={styles.root} data-design="Head">
      <PageHeader
        breadcrumb={[{ label: '専用機能' }, { label: 'EC連携' }]}
        title="EC連携"
        description="ECの注文・定期便を取り込み、LINEの配信や成果へつなげます。"
        actions={<Button href="/support" variant="secondary">マニュアル</Button>}
      />
      <MergedTabs basePath="/ec-commerce" tabs={TABS} active={tab} defaultKey="events" />
      {tab === 'events' ? <EventsPanel accountId={selectedAccountId} /> : null}
      {tab === 'subscriptions' ? <SubscriptionsPanel accountId={selectedAccountId} /> : null}
      {tab === 'connector' ? <ConnectorPanel accountId={selectedAccountId} /> : null}
    </div>
  )
}

export default function EcCommercePage() {
  return <Suspense fallback={<ListState kind="loading" />}><EcCommercePageInner /></Suspense>
}
