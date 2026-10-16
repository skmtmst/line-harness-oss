'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StoreComparisonResult, StoreComparisonRow } from '@line-crm/shared'
import { ListPage, ListPagePagination } from '@/components/templates'
import Button from '@/components/shared/button'
import DeltaChip from '@/components/shared/delta-chip'
import Drawer from '@/components/shared/drawer'
import ListState from '@/components/shared/list-state'
import ListToolbar from '@/components/shared/list-toolbar'
import Pagination from '@/components/shared/pagination'
import PageSizeSelect from '@/components/shared/page-size-select'
import PeriodPicker, { pastPeriod } from '@/components/shared/period-picker'
import Select from '@/components/shared/select'
import { DataTable, SortTh, TableHeadRow, Td, Th, Tr, type SortDirection } from '@/components/shared/table'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import TruncatedText from '@/components/shared/truncated-text'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { storeComparisonApi } from '@/lib/api-gap3'
import { diffTitle, formatDiff, formatMetric, METRICS, diffTone, worseCount, type MetricDef } from './metrics'
import styles from './list.module.css'

/*
 * ★V8 統括「店の比較」（G7-1 `W4fI7A`）。行＝店、列＝7つの数。
 * 各マスに値と平均との差の札（良い＝緑・悪い＝赤）。行を押すと右の引き出し（G7-2 `z0fSYt`）。
 * CSV の書き出しと「店の組」の絞り込みは受け口がまだ無いので、形を残して「現在準備中です」を出す（B-314）。
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
        <PeriodPicker days={days} onChange={(next) => { setPage(1); setDays(next) }} />
        <Select aria-label="比べる相手" value={compare} options={COMPARE_OPTIONS} onChange={(value) => { setPage(1); setCompare(value as 'previous' | 'average') }} />
        <Button variant="secondary" onClick={() => preparing.open('店の組での絞り込み')}>店の組：すべて</Button>
      </>}
      trailing={<>
        <PageSizeSelect value={pageSize} onChange={(next) => { setPage(1); setPageSize(next as 10 | 20 | 50) }} />
        <Button variant="secondary" onClick={() => preparing.open('CSVの書き出し')}>CSVで書き出す</Button>
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
        <span className={styles.averageNote}>平均より悪い数は赤の札</span>
      </div>
    </>
  )

  return (
    <>
      <ListPage
        skeleton
        boardId="W4fI7A"
        title="店の比較"
        help={<>店ごとに、友だち・予約・来店・返事の速さを並べて見ます。平均より悪い数は赤の札で知らせます。数は毎朝、前の日の分まで更新します。{METRICS.map((def) => <span key={def.key}><br />{`${def.label}：${def.help}`}</span>)}</>}
        toolbar={toolbar}
        pagination={status === 'ready' && total > 0 ? (
          <ListPagePagination>
            <span className={styles.pagerCount}>{`${total} 店中 ${first}〜${last} ・ 期間 ${rangeLabel(period.from, period.to)}`}</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </ListPagePagination>
        ) : undefined}
      >
        {body}
      </ListPage>
      <StoreDrawer row={openRow} period={period} onClose={() => setOpenId(null)} />
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
      {diff && tone ? <DeltaChip tone={tone}>{diff}</DeltaChip> : null}
    </span>
  )
}

type Detail = {
  recentBroadcasts: Array<{ id: string; title: string; status: string; sent_at: string | null }>
  attention: unknown
}

function StoreDrawer({ row, period, onClose }: { row: StoreComparisonRow | null; period: { from: string; to: string }; onClose: () => void }) {
  const router = useRouter()
  const { setSelectedAccountId } = useAccount()
  const [detail, setDetail] = useState<{ id: string; status: Status; data: Detail | null }>({ id: '', status: 'loading', data: null })
  const accountId = row?.accountId ?? null

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    setDetail({ id: accountId, status: 'loading', data: null })
    storeComparisonApi.detail(accountId, period.from, period.to)
      .then((response) => {
        if (cancelled) return
        if (!response.success) throw new Error('detail_failed')
        setDetail({ id: accountId, status: 'ready', data: response.data as Detail })
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

  return (
    <Drawer
      open={row !== null}
      title={row?.name ?? ''}
      description={row ? `${worse > 0 ? `平均より下の数 ${worse} つ` : '平均より下の数はありません'}` : undefined}
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
          <section className={styles.card} aria-label="7つの数">
            <h3 className={styles.cardTitle}>7 つの数</h3>
            <div>
              {ordered.map((def) => {
                const metric = row.metrics[def.key]
                const tone = diffTone(def, metric?.diff ?? null)
                const diff = formatDiff(def.key, metric?.diff ?? null)
                return (
                  <div key={def.key} className={styles.metricRow}>
                    <span className={styles.metricName}>{def.label}</span>
                    <span className={styles.metricValue}>
                      {metric?.available && metric.value !== null ? formatMetric(def.key, metric.value) : <span className={styles.cellEmpty}>—</span>}
                      {diff && tone ? <DeltaChip tone={tone}>{diff}</DeltaChip> : null}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
          <section className={styles.card} aria-label="最近の配信">
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
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}
