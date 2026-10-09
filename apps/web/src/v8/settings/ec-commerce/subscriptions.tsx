'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleDot, Star, Repeat2, Play, Pause, CreditCard } from 'lucide-react'
import Link from 'next/link'
import Button from '@/components/shared/button'
import Disclosure from '@/components/shared/disclosure'
import FilterChip from '@/components/shared/filter-chip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import PageSizeSelect from '@/components/ui/page-size-select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { RowMenu } from '@/components/shared/row-actions'
import { DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import ListRange from '@/components/ui/list-range'
import { ApiError, api, type EcSubscription, type EcSubscriptionList } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import shared from './screen.module.css'
import styles from './subscriptions.module.css'
import { formatDate as polishFormatDate } from '@/lib/format'


function shortDate(value: string | null): string {
  return polishFormatDate(value, { style: 'list-day', fallback: '—' })
}

const FILTERS = [
  { key: 'all', label: 'すべて' },
  { key: 'active', label: '続いている' },
  { key: 'at_risk', label: '支払いを確認' },
  { key: 'paused', label: '休止中' },
  { key: 'cancelled', label: '止まった' },
] as const
type Filter = typeof FILTERS[number]['key']

const STATUS_TONE: Record<EcSubscription['status'], StatusBadgeTone> = { active: 'success', paused: 'neutral', at_risk: 'info', cancelled: 'neutral' }

export default function EcSubscriptions({ accountId, canEdit = true }: { accountId: string | null; canEdit?: boolean }) {
  const [v8PageSize, setV8PageSize] = useState(10)
  const pageSize = v8PageSize
  const loadGeneration = useRef(0)
  const [data, setData] = useState<EcSubscriptionList | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading')
  const [filter, setFilter] = useState<Filter>('all')
  // 行の「その他」メニューの開き先（#641）
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  /** 絞り込みに合う総数。サーバが数える(#731)。 */
  const [total, setTotal] = useState(0)

  /*
   * 表示条件(ようす)は**サーバへ渡す**(#731)。手元で絞ると、ページごとに
   * 絞ることになって「N件中M件」が合わなくなる。検索の言葉だけは、いまも
   * ページの中だけで効く(サーバ側に検索が無いため。下の文言でそう伝える)。
   */
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    if (!accountId) {
      setData(null)
      setState('empty')
      return
    }
    setState('loading')
    try {
      const response = await api.ecCommerce.subscriptions({
        lineAccountId: accountId,
        status: filter === 'all' ? undefined : filter,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      if (generation !== loadGeneration.current) return
      if (!response.success || !Array.isArray(response.data?.items)) throw new Error('invalid_subscription_response')
      setData(response.data)
      setTotal(response.pagination?.total ?? response.data.items.length)
      // ROOT32：表示条件で0件になったときは「まだありません」にせず、
      // 条件の切り替え（タブ）を残したまま「条件に合うものはありません」を出す。
      setState(response.data.items.length || filter !== 'all' ? 'ready' : 'empty')
    } catch (error) {
      if (generation !== loadGeneration.current) return
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId, filter, page, pageSize])

  useEffect(() => { void load() }, [load])
  // 表示条件やアカウントを変えたら先頭のページへ戻す。
  useEffect(() => { setPage(1) }, [accountId, filter])

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return data?.items ?? []
    return (data?.items ?? []).filter((item) => [item.ownerName, item.petName, item.contractNumber, item.items]
      .some((value) => value?.toLowerCase().includes(needle)))
  }, [data, search])

  if (state !== 'ready') {
    return (
      <ListState
        kind={state}
        title={state === 'empty' && !accountId ? 'LINEアカウントを選択してください' : state === 'empty' ? '定期便はまだありません' : undefined}
        description={state === 'empty' && !accountId ? 'LINEアカウントを選ぶ欄で、確認するアカウントを選びます。' : state === 'empty' ? 'ECから定期便が届くと、ここに並びます。' : undefined}
        onRetry={state === 'error' ? () => void load() : undefined}
      />
    )
  }

  const summary = data?.summary
  return <>
    <KpiBand data-kpi-presentation="cards" gridClassName={shared.kpis}>
      <KpiCard metricSize="small" title="続いている定期便" icon={<Repeat2 size={13} />} value={summary?.active} unit="件" detail={summary?.monthlyAmount == null ? '今月の金額は未取得' : `今月 ¥${formatNumber(summary.monthlyAmount)}`} />
      <KpiCard metricSize="small" title="今月 はじまった" icon={<Play size={13} />} value={summary?.startedThisMonth} unit="件" detail="初回の発送済み —" help="初回の発送数はまだ数えていません。開始日はECの定期便から集計しています。" />
      <KpiCard metricSize="small" title="今月 止まった" icon={<Pause size={13} />} value={summary?.cancelledThisMonth} unit="件" detail="休止 —・解約 —" help="休止と解約は現在の契約数です。今月の内訳は未取得です。" />
      <KpiCard metricSize="small" title="支払いを確認" icon={<CreditCard size={13} />} value={summary?.atRisk} unit="件" detail="ECから届いた決済状態" />
    </KpiBand>
    <div className={styles.toolbar}>
      <SearchField className={styles.search} value={search} onChange={setSearch} placeholder="お客様の名前・ペット名・契約番号・中身で検索" aria-label="定期便を検索" />
      {FILTERS.map((item) => <FilterChip key={item.key} selected={filter === item.key} icon={item.key === 'all' ? <CircleDot size={13} /> : <Star size={13} />} onChange={() => setFilter(item.key)}>{item.label}</FilterChip>)}
    </div>
    {shown.length === 0 ? <ListState kind="empty" title="条件に合う定期便はありません" description="検索する言葉か表示条件を変えてください。" action={filter !== 'all' || search ? <Button onClick={() => { setFilter('all'); setSearch('') }}>条件を外す</Button> : undefined} /> : <DataTable label="定期便" density="compact" columns="var(--tpl-ecc-sub-columns)">
      <thead><TableHeadRow><Th>お客様と中身</Th><Th align="right">1回の金額</Th><Th>次の発送</Th><Th align="right">続いた回数</Th><Th>ようす</Th><Th>操作</Th></TableHeadRow></thead>
      <tbody>{shown.map((item) => <Tr key={item.id}>
        <Td><span className={shared.stack}><span className={shared.main} title={item.ownerName ?? undefined}>{item.ownerName ?? 'お客様名 —'}{item.petName ? `（${item.petName}）` : ''}</span><span className={shared.sub} title={item.items ?? undefined}>{[item.items ?? '中身 未取得', item.cycle].filter(Boolean).join('・')}</span></span></Td>
        <Td align="right">{item.amount == null ? '—' : `¥${formatNumber(item.amount)}`}</Td>
        <Td>{shortDate(item.nextShippingAt)}</Td>
        <Td align="right">{item.continuedCount == null ? '—' : `${item.continuedCount} 回`}</Td>
        <Td><span className={shared.stack}><StatusBadge tone={STATUS_TONE[item.status]} size="compact">{FILTERS.find((f) => f.key === item.status)?.label ?? item.statusLabel}</StatusBadge>{item.riskReason || item.cancellationReason ? <span className={shared.sub} title={item.riskReason ?? item.cancellationReason ?? undefined}>{item.riskReason ?? `理由「${item.cancellationReason}」`}</span> : null}</span></Td>
        <Td><span className={styles.ops}><Button href={`/friends/detail?id=${encodeURIComponent(item.friendId)}`} variant="secondary">中身を見る</Button>{item.manageUrl ? <RowMenu label={`${item.ownerName ?? 'お客様'}のその他操作`} menuLabel="定期便の操作" open={openMenuId === item.id} onOpenChange={(open) => setOpenMenuId(open ? item.id : null)} items={[{ id: 'manage', label: 'ECで変更', onSelect: () => window.open(item.manageUrl!, '_blank', 'noopener,noreferrer') }]} /> : null}</span></Td>
      </Tr>)}</tbody>
    </DataTable>}
    <NoteBar icon={null}>「支払いを確認」は EC から届いた決済状態です。将来止めるかどうかを予測した数字ではありません。「次の発送」は EC に登録された確定の予定日です。購入後の案内は <Link href="/nen-campaigns">NEN配信</Link> で管理します。</NoteBar>
    {canEdit ? <Button href="/broadcasts/new" variant="text">対象を選んで送る</Button> : null}
    <div className={shared.pager}>
      <p className={shared.minorText}>{search.trim() ? `このページの ${formatNumber(shown.length)} 件を表示（検索はページの中だけに効きます）` : <ListRange label={filter === 'all' ? '定期便' : '表示条件に合う定期便'} total={total} first={total === 0 ? 0 : (page - 1) * pageSize + 1} last={(page - 1) * pageSize + shown.length} />}{data && data.skipped.malformedSnapshots > 0 ? `／形が読めなかったお客様のぶん ${formatNumber(data.skipped.malformedSnapshots)} 件は数えていません` : ''}</p>
      <PageSizeSelect value={v8PageSize} options={[10, 20, 50]} onChange={(value) => { setV8PageSize(value); setPage(1) }} />
      <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / pageSize))} onPageChange={setPage} ariaLabel="定期便のページ送り" />
    </div>
    {(summary?.monthlyStats ?? []).length > 0 ? <Disclosure title="月別の定期便" size="compact" hint={summary?.monthlyAmount == null ? '今月の金額は未取得' : `今月 ¥${formatNumber(summary.monthlyAmount)}`}><DataTable><thead><TableHeadRow><Th>月</Th><Th>契約数</Th><Th align="right">金額</Th></TableHeadRow></thead><tbody>{summary?.monthlyStats.slice(-6).map((item) => <Tr key={item.month}><Td>{item.month}</Td><Td>{formatNumber(item.count)} 件</Td><Td align="right">¥{formatNumber(item.amount)}</Td></Tr>)}</tbody></DataTable></Disclosure> : null}
  </>
}
