'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
import { Tabs } from '@/components/shared/tabs'
import { ActionCell, DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { ApiError, api, type EcSubscription, type EcSubscriptionList } from '@/lib/api'
import { formatEcShortDate as shortDate } from './ec-datetime'
import styles from './ec-commerce-v6.module.css'

const FILTERS = [
  { key: 'all', label: 'すべて' },
  { key: 'active', label: '続いている' },
  { key: 'at_risk', label: '支払いを確認' },
  { key: 'paused', label: '休止中' },
  { key: 'cancelled', label: '止まった' },
] as const
type Filter = typeof FILTERS[number]['key']

const STATUS_TONE: Record<EcSubscription['status'], string> = {
  active: styles.statusGood,
  paused: styles.statusMuted,
  at_risk: styles.statusWarn,
  cancelled: styles.statusMuted,
}

export default function SubscriptionsPanel({ accountId }: { accountId: string | null }) {
  const [data, setData] = useState<EcSubscriptionList | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!accountId) {
      setData(null)
      setState('empty')
      return
    }
    setState('loading')
    try {
      const response = await api.ecCommerce.subscriptions({ lineAccountId: accountId, limit: 100 })
      if (!response.success || !Array.isArray(response.data?.items)) throw new Error('invalid_subscription_response')
      setData(response.data)
      setState(response.data.items.length ? 'ready' : 'empty')
    } catch (error) {
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data?.items ?? []).filter((item) => {
      if (filter !== 'all' && item.status !== filter) return false
      if (!needle) return true
      return [item.ownerName, item.petName, item.contractNumber, item.items]
        .some((value) => value?.toLowerCase().includes(needle))
    })
  }, [data, filter, search])

  if (state !== 'ready') {
    return (
      <ListState
        kind={state}
        title={state === 'empty' && !accountId ? 'LINEアカウントを選択してください' : state === 'empty' ? '定期便はまだありません' : undefined}
        description={state === 'empty' && !accountId ? '左のメニュー上部で、確認するLINEアカウントを選びます。' : state === 'empty' ? 'ECから定期便が届くと、ここに並びます。' : undefined}
        onRetry={state === 'error' ? () => void load() : undefined}
      />
    )
  }

  const summary = data?.summary
  return (
    <>
      <div className={styles.kpis}>
        <SummaryCard variant="v6" title="続いている定期便" value={summary?.active ?? null} unit="件" detail={summary?.monthlyAmount === null ? '今月の金額は未取得' : `今月 ¥${summary?.monthlyAmount.toLocaleString('ja-JP')}`} />
        <SummaryCard variant="v6" title="今月 はじまった" value={summary?.startedThisMonth ?? null} unit="件" detail="定期便の開始日から集計" badge={summary?.startedThisMonth === null ? '未取得' : undefined} badgeTone="neutral" />
        <SummaryCard variant="v6" title="今月 止まった" value={summary?.cancelledThisMonth ?? null} unit="件" detail={summary?.cancellationTopReason ? `多い理由「${summary.cancellationTopReason}」` : '解約理由の記録なし'} badge={summary?.cancelledThisMonth === null ? '未取得' : undefined} badgeTone="neutral" />
        <SummaryCard variant="v6" title="支払いを確認" value={summary?.atRisk ?? null} unit="人" detail="ECの決済状態から確認" />
      </div>
      <NoteBar>「支払いを確認」はECから届いた決済状態です。将来止めるかどうかを予測した数字ではありません。</NoteBar>
      {(summary?.monthlyStats ?? []).length > 0 ? <div className="my-4 rounded-card border border-hairline bg-canvas p-4"><p className="text-sm font-semibold text-ink">月別の定期便</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{summary?.monthlyStats.slice(-6).map((item) => <div key={item.month} className="rounded-control bg-canvas-sunken px-3 py-2"><p className="text-xs text-ink-faint">{item.month}</p><p className="mt-1 text-sm font-semibold text-ink">{item.count.toLocaleString('ja-JP')}件</p><p className="text-xs text-ink-secondary">¥{item.amount.toLocaleString('ja-JP')}</p></div>)}</div></div> : null}
      <div className={styles.toolbar}>
        <input className={styles.search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="お客様の名前・注文番号で検索" aria-label="定期便を検索" />
        <Tabs items={FILTERS.map((item) => ({
          label: item.label,
          count: item.key === 'all' ? summary?.total : item.key === 'at_risk' ? summary?.atRisk : summary?.[item.key],
          current: filter === item.key,
          onClick: () => setFilter(item.key),
        }))} />
      </div>
      {shown.length === 0 ? <ListState kind="empty" title="条件に合う定期便はありません" description="検索する言葉か表示条件を変えてください。" /> : (
        <DataTable>
          <thead><TableHeadRow><Th>お客様と中身</Th><Th>次の発送</Th><Th>続いた回数</Th><Th align="right">1回の金額</Th><Th>ようす</Th><Th align="right">操作</Th></TableHeadRow></thead>
          <tbody>
            {shown.map((item) => (
              <Tr key={item.id}>
                <Td><span className={styles.cellStack}><span className={styles.cellMain} title={item.ownerName ?? undefined}>{item.ownerName ?? 'お客様名 —'}{item.cycle ? ` ／ ${item.cycle}` : ''}</span><span className={styles.cellSub} title={item.items ?? undefined}>{item.petName ? `${item.petName}用` : 'ペット名 —'} ／ {item.items ?? '中身 未取得'}</span></span></Td>
                <Td>{item.status === 'cancelled' ? '止まりました' : shortDate(item.nextShippingAt)}</Td>
                <Td>{item.continuedCount === null ? '—' : `${item.continuedCount}回目`}</Td>
                <Td align="right">{item.amount === null ? '—' : `¥${item.amount.toLocaleString('ja-JP')}`}</Td>
                <Td><span className={styles.cellStack}><span className={`${styles.status} ${STATUS_TONE[item.status]}`}>{item.statusLabel}</span>{item.riskReason || item.cancellationReason ? <span className={styles.cellSub}>{item.riskReason ?? `理由「${item.cancellationReason}」`}</span> : null}</span></Td>
                <ActionCell><Link className={styles.textLink} href={`/friends/${item.friendId}`}>中身を見る</Link></ActionCell>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <p className={styles.footer}>定期便 {summary?.total.toLocaleString('ja-JP')}件中 {shown.length.toLocaleString('ja-JP')}件を表示</p>
    </>
  )
}
