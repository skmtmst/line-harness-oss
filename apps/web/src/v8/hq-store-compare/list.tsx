'use client'

import PeriodPicker from '@/components/shared/period-picker'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StoreComparisonDetail, HqAttentionKind, StoreComparisonResult, StoreComparisonRow } from '@line-crm/shared'
import { ListPage, ListPagePagination } from '@/components/templates'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import { ValueBarChart } from '@/components/shared/charts'
import DeltaChip from '@/components/shared/delta-chip'
import Drawer from '@/components/shared/drawer'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import ListToolbar from '@/components/shared/list-toolbar'
import Pagination from '@/components/shared/pagination'
import PageSizeSelect from '@/components/shared/page-size-select'
import { pastPeriod } from '@/components/shared/period-picker'
import Select from '@/components/shared/select'
import { DataTable, SortTh, TableHeadRow, Td, Th, Tr, type SortDirection } from '@/components/shared/table'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import TruncatedText from '@/components/shared/truncated-text'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { storeComparisonApi } from '@/lib/api/helpers/gap3'
import { diffTitle, formatDiff, formatMetric, METRICS, diffTone, worseCount, type MetricDef } from './metrics'
import styles from './list.module.css'

/*
 * ★V8 統括「店の比較」（G7-1 `W4fI7A`）。行＝店、列＝7つの数。
 * 各マスに値と平均との差の札（良い＝緑・悪い＝赤）。行を押すと右の引き出し（G7-2 `z0fSYt`）。
 * CSV は書き出しの口（頼む→待つ→受け取る）につないだ。「店の組」の絞り込みは口がまだ無いので、形を残して共通の準備中の窓を出す。
 */

type Status = 'loading' | 'ready' | 'error'
type Order = 'asc' | 'desc'

const COMPARE_OPTIONS = [
  { value: 'previous', label: '比べる相手：前の期間' },
  { value: 'average', label: '比べる相手：全店の平均' },
]

function rangeLabel(from: string, to: string): string {
  const f = (v: string) => `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}`
  return `${f(from)}〜${f(to)}`
}

export default function StoreComparisonList() {
  usePageTitle('店の比較')
  usePageCrumbs([{ label: 'ホーム', href: '/hq' }])
  const preparing = usePreparingDialog()
  const [days, setDays] = useState(30)
  const [compare, setCompare] = useState<'previous' | 'average'>('previous')
  /* 初期は予約の少ない順（G7 §2-1）。 */
  const [sort, setSort] = useState<MetricDef['key']>('bookings')
  const [order, setOrder] = useState<Order>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(20)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<unknown>(null)
  const [data, setData] = useState<StoreComparisonResult | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState('')
  const period = useMemo(() => pastPeriod(days), [days])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const response = await storeComparisonApi.get({ from: period.from, to: period.to, compare, sort, order, page, pageSize })
      if (!response.success) throw new Error('store_comparison_failed')
      setData(response.data)
      setStatus('ready')
    } catch (reason) {
      setError(reason)
      setStatus('error')
    }
  }, [period.from, period.to, compare, sort, order, page, pageSize])

  useEffect(() => { void load() }, [load])

  /* CSV：書き出しを頼み、できるまで待ってから受け取る（今の並び・期間・比べる相手のまま）。 */
  const exportCsv = async () => {
    setExporting(true)
    setNotice('')
    try {
      const started = await storeComparisonApi.export({ from: period.from, to: period.to, compare, sort, order }, crypto.randomUUID())
      if (!started.success) throw new Error('export_failed')
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const status = await storeComparisonApi.exportStatus(started.data.id)
        if (!status.success) throw new Error('export_failed')
        if (status.data.status === 'failed') throw new Error('export_failed')
        if (status.data.status === 'completed') { await storeComparisonApi.download(started.data.id); return }
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
      }
      setNotice('CSV の用意に時間がかかっています。しばらくしてからもう一度お試しください。')
    } catch {
      setNotice('CSV を書き出せませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  const openRow = data?.rows.find((row) => row.accountId === openId) ?? null

  const sortDirection = (key: MetricDef['key']): SortDirection => (sort === key ? order : 'none')
  const changeSort = (key: MetricDef['key']) => {
    setPage(1)
    if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc')
    else { setSort(key); setOrder('asc') }
  }

  const toolbar = (
    <ListToolbar
      filters={<>
        <PeriodPicker days={days} onChange={(value) => { setPage(1); setDays(Number(value)) }} />
        <Select aria-label="比べる相手" value={compare} options={COMPARE_OPTIONS} onChange={(value) => { setPage(1); setCompare(value as 'previous' | 'average') }} />
        <Button variant="secondary" onClick={() => preparing.open('店の組での絞り込み')}>店の組：すべて</Button>
      </>}
      trailing={<>
        <PageSizeSelect value={pageSize} onChange={(next) => { setPage(1); setPageSize(next as 10 | 20 | 50) }} />
        <Button variant="secondary" onClick={() => void exportCsv()} busy={exporting} disabled={exporting}>CSVで書き出す</Button>
      </>}
    />
  )

  const body = status === 'loading' && !data ? (
    <ListState kind="loading" title="店の比較を読み込んでいます" />
  ) : status === 'error' ? (
    <ListState kind="error" error={error} onRetry={() => void load()} />
  ) : !data || data.rows.length === 0 ? (
    <ListState kind="empty" emptyPreset="readonly" title="比べる店がまだありません" description="統括に店が入ると、ここで数を並べて見られます。" />
  ) : (
    <>
      <DataTable columns="minmax(0, 1.1fr) repeat(7, minmax(0, 1fr))">
        <thead>
          <TableHeadRow>
            <Th grow>店</Th>
            {METRICS.map((def) => (
              <SortTh key={def.key} align="right" sort={sortDirection(def.key)} onSort={() => changeSort(def.key)} sortLabel={`${def.label}で並べ替える`}>{def.short}</SortTh>
            ))}
          </TableHeadRow>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <Tr key={row.accountId} interactive onOpen={() => setOpenId(row.accountId)} data-row-id={row.accountId}>
              <Td grow><span className={styles.storeName}><TruncatedText value={row.name} /></span></Td>
              {METRICS.map((def) => (
                <Td key={def.key} align="right"><MetricCell def={def} metric={row.metrics[def.key]} compare={compare} /></Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </DataTable>
      <div className={styles.averageBand}>
        <span className={styles.averageTitle}>{`${total} 店の平均`}</span>
        <span className={styles.averageText}>
          {METRICS.map((def) => `${def.label} ${formatMetric(def.key, data.average[def.key] ?? null)}`).join('・')}
        </span>
        <span className={styles.averageNote}>{`札は${compare === 'average' ? '全店の平均' : '前の期間'}との差（赤＝悪い・緑＝良い）`}</span>
      </div>
    </>
  )

  return (
    <>
      <ListPage
        skeleton
        boardId="W4fI7A"
        title="店の比較"
        help={<>店ごとに、友だち・予約・来店・返事の速さを並べて見ます。平均より悪い数は赤の札で知らせます。数は毎朝、前の日の分まで更新します。数の横の札は、「比べる相手」（前の期間か全店の平均）との差で、赤は悪い方・緑は良い方です。{METRICS.map((def) => <span key={def.key}><br />{`${def.label}：${def.help}`}</span>)}</>}
        toolbar={toolbar}
        pagination={status === 'ready' && total > 0 ? (
          <ListPagePagination>
            <span className={styles.pagerCount}>{`${total} 店中 ${first}〜${last} ・ 期間 ${rangeLabel(period.from, period.to)}`}</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </ListPagePagination>
        ) : undefined}
      >
        {notice ? <Notice tone="danger" message={notice} /> : null}
        {body}
      </ListPage>
      <StoreDrawer row={openRow} period={period} compare={compare} onClose={() => setOpenId(null)} />
      {preparing.dialog}
    </>
  )
}

function MetricCell({ def, metric, compare }: { def: MetricDef; metric: StoreComparisonRow['metrics'][MetricDef['key']] | undefined; compare: 'previous' | 'average' }) {
  if (!metric || !metric.available || metric.value === null) {
    return <span className={styles.cellEmpty} title="この数はまだ取れていません">—</span>
  }
  const diff = formatDiff(def.key, metric.diff)
  const tone = diffTone(def, metric.diff)
  return (
    <span className={styles.cell} title={diffTitle(def.key, metric.diff, compare)}>
      {formatMetric(def.key, metric.value)}
      <span className={styles.chipSlot}>{diff && tone ? <DeltaChip tone={tone} direction={(metric.diff ?? 0) > 0 ? 'up' : 'down'}>{diff}</DeltaChip> : null}</span>
    </span>
  )
}

const ATTENTION: Array<{key:HqAttentionKind;label:string}> = [
 {key:'unhandledChats',label:'未対応・対応中・保留のトーク'},
 {key:'pendingBookings',label:'承認待ちの予約'},
 {key:'unpaid',label:'未払い'},
 {key:'connections',label:'接続の異常'},
]

function attentionTargetLabel(href:string) {
 const path=new URL(href,'https://qa.invalid');
 if(path.pathname==='/chats')return {unread:'未対応のトークを開く',in_progress:'対応中のトークを開く',on_hold:'保留のトークを開く'}[path.searchParams.get('status') ?? ''] ?? 'トークを開く';
 if(path.pathname==='/events/bookings')return 'イベントの申込を開く';
 if(path.pathname==='/restaurant-test/reservations')return '飲食店の予約台帳を開く';
 if(path.pathname==='/booking/bookings')return '承認待ちの予約を開く';
 if(path.pathname==='/booking/menus')return 'お支払いの記録を開く';
 return '接続の状態を開く';
}

function StoreDrawer({ row, period, compare, onClose }: { row: StoreComparisonRow | null; period: { from: string; to: string }; compare: 'previous' | 'average'; onClose: () => void }) {
  const router = useRouter()
  const { setSelectedAccountId } = useAccount()
  const [detail, setDetail] = useState<{ id: string; status: Status; data: StoreComparisonDetail | null }>({ id: '', status: 'loading', data: null })
  const accountId = row?.accountId ?? null

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    setDetail({ id: accountId, status: 'loading', data: null })
    storeComparisonApi.detail(accountId, period.from, period.to)
      .then((response) => {
        if (cancelled) return
        if (!response.success) throw new Error('detail_failed')
        setDetail({ id: accountId, status: 'ready', data: response.data })
      })
      .catch(() => { if (!cancelled) setDetail({ id: accountId, status: 'error', data: null }) })
    return () => { cancelled = true }
  }, [accountId, period.from, period.to])

  const worse = row ? worseCount(row) : 0
  /* 平均より下の数を上に並べる（G7 §2-1）。 */
  const ordered = row
    ? [...METRICS].sort((a, b) => Number(diffTone(b, row.metrics[b.key]?.diff ?? null) === 'down') - Number(diffTone(a, row.metrics[a.key]?.diff ?? null) === 'down'))
    : []
  const current = detail.id === accountId ? detail : { id: '', status: 'loading' as Status, data: null }

  const attention = current.data?.attention

  return (
    <Drawer
      open={row !== null}
      title={row?.name ?? ''}
      description={row ? `${worse > 0 ? `${compare === 'average' ? '全店の平均' : '前の期間'}より悪い数 ${worse} つ` : `${compare === 'average' ? '全店の平均' : '前の期間'}より悪い数はありません`}` : undefined}
      closeAppearance="box"
      heightMode="viewport"
      onClose={onClose}
      footer={row ? (
        <div className={styles.footer}>
          <Button variant="primary" onClick={() => { setSelectedAccountId(row.accountId); router.push('/') }}>この店を開く</Button>
        </div>
      ) : undefined}
    >
      {row ? (
        <div className={styles.drawerBody}>
          <Card padding="default" layout="vertical" gap="normal" aria-label="7つの数">
            <h3 className={styles.cardTitle}>7 つの数</h3>
            <div>
              {ordered.map((def) => {
                const metric = row.metrics[def.key]
                const tone = diffTone(def, metric?.diff ?? null)
                const diff = formatDiff(def.key, metric?.diff ?? null)
                return (
                  <div key={def.key}>
                  <div className={styles.metricRow}>
                    <span className={styles.metricName}>{def.label}</span>
                    <span className={styles.metricValue}>
                      {metric?.available && metric.value !== null ? formatMetric(def.key, metric.value) : <span className={styles.cellEmpty}>—</span>}
                      {diff && tone ? <DeltaChip tone={tone} direction={(metric.diff ?? 0) > 0 ? 'up' : 'down'}>{diff}</DeltaChip> : null}
                    </span>
                  </div>
                  {current.status === 'ready' && current.data?.trend?.length ? <ValueBarChart label={`${def.label}の日ごとの推移`} unit={metric?.unit ?? ''} signed={def.key === 'friendChange'} items={current.data.trend.map(day => ({key:day.date,label:day.date,value:day.values[def.key],note:day.state==='failed'?'集計に失敗':day.state==='missing'?'取得待ち':undefined}))} /> : null}
                  {current.status === 'loading' ? <p className={styles.mute}>推移を読み込んでいます</p> : null}
                  {current.status === 'error' ? <p className={styles.mute}>推移を読み込めませんでした。</p> : null}
                  {current.status === 'ready' && !current.data?.trend?.length ? <p className={styles.mute}>推移はまだ取れていません。</p> : null}
                  </div>
                )
              })}
            </div>
          </Card>
          <Card padding="default" layout="vertical" gap="normal" aria-label="最近の配信">
            <h3 className={styles.cardTitle}>最近の配信</h3>
            {current.status === 'loading' ? <p className={styles.mute}>読み込んでいます</p> : null}
            {current.status === 'error' ? <p className={styles.mute}>最近の配信を読み込めませんでした。</p> : null}
            {current.status === 'ready' && (current.data?.recentBroadcasts.length ?? 0) === 0 ? <p className={styles.mute}>この店の配信はまだありません。</p> : null}
            {current.status === 'ready' && current.data && current.data.recentBroadcasts.length > 0 ? (
              <div className={styles.recent}>
                {current.data.recentBroadcasts.map((item) => (
                  <div key={item.id} className={styles.recentRow}>
                    <span className={styles.recentTitle} title={item.title}>{item.title}</span>
                    <span className={styles.recentDate}>{item.sent_at ? `${Number(item.sent_at.slice(5, 7))}/${Number(item.sent_at.slice(8, 10))}` : '—'}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
          <Card padding="default" layout="vertical" gap="normal" aria-label="対応が要るもの">
            <h3 className={styles.cardTitle}>対応が要るもの</h3>
            {current.status === 'loading' ? <p className={styles.mute}>読み込んでいます</p> : null}
            {current.status === 'error' || (current.status === 'ready' && attention?.status !== 'ready') ? <p className={styles.mute}>対応が要るものを読み込めませんでした。</p> : null}
            {current.status === 'ready' && attention?.status === 'ready' ? ATTENTION.map(item => <div key={item.key}>
              <p>{item.label} {attention.counts[item.key]}件</p>
              {(attention.targets?.[item.key] ?? []).map(target => <Button key={target.href} variant="text" onClick={() => { setSelectedAccountId(row.accountId); router.push(target.href) }}>{attentionTargetLabel(target.href)} {target.count}件</Button>)}
            </div>) : null}
          </Card>
        </div>
      ) : null}
    </Drawer>
  )
}
