'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ActionMenu from '@/components/shared/action-menu'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
import Pagination from '@/components/shared/pagination'
import { Tabs } from '@/components/shared/tabs'
import { ActionCell, DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { ApiError, api, type EcSubscription, type EcSubscriptionList } from '@/lib/api'
import { formatEcShortDate as shortDate } from './ec-datetime'
import ListRange from '@/components/ui/list-range'
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

/** 1ページに出す件数。 */
const PAGE_SIZE = 100

export default function SubscriptionsPanel({ accountId }: { accountId: string | null }) {
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
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      if (!response.success || !Array.isArray(response.data?.items)) throw new Error('invalid_subscription_response')
      setData(response.data)
      setTotal(response.pagination?.total ?? response.data.items.length)
      setState(response.data.items.length ? 'ready' : 'empty')
    } catch (error) {
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId, filter, page])

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
        <SummaryCard variant="v6" title="今月 はじまった" value={summary?.startedThisMonth ?? null} unit="件" detail="" help="定期便の開始日から集計しています" badge={summary?.startedThisMonth === null ? '未取得' : undefined} badgeTone="neutral" />
        <SummaryCard variant="v6" title="今月 止まった" value={summary?.cancelledThisMonth ?? null} unit="件" detail={summary?.cancellationTopReason ? `多い理由「${summary.cancellationTopReason}」` : '解約理由の記録なし'} badge={summary?.cancelledThisMonth === null ? '未取得' : undefined} badgeTone="neutral" />
        <SummaryCard variant="v6" title="支払いを確認" value={summary?.atRisk ?? null} unit="人" detail="" help="ECの決済状態から確認する人数です" />
      </div>
      {/*
       * IDEA-21: 「次の発送」はECの定期便に登録された確定の予定日。推定ではない。
       * 購入後の案内（発送後の到着確認・口コミ・次の商品）はNEN配信が担う。
       * 定期便の変更・休止そのものはEC側（管理画面・お客様のマイページ）で行う。
       */}
      <NoteBar>「支払いを確認」はECから届いた決済状態です。将来止めるかどうかを予測した数字ではありません。「次の発送」はECに登録された確定の予定日で、EC側で変わると次の同期で更新されます。購入後の案内は <Link href="/nen-campaigns" className="font-semibold underline">NEN配信</Link> で管理します。</NoteBar>
      {(summary?.monthlyStats ?? []).length > 0 ? <div className="my-4 rounded-card border border-hairline bg-canvas p-4"><p className="text-sm font-semibold text-ink">月別の定期便</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{summary?.monthlyStats.slice(-6).map((item) => <div key={item.month} className="rounded-control bg-canvas-sunken px-3 py-2"><p className="text-xs text-ink-faint">{item.month}</p><p className="mt-1 text-sm font-semibold text-ink">{item.count.toLocaleString('ja-JP')}件</p><p className="text-xs text-ink-secondary">¥{item.amount.toLocaleString('ja-JP')}</p></div>)}</div></div> : null}
      <div className={styles.toolbar}>
        {/*
         * #948 N-325: placeholder は実際に検索する項目(ownerName・petName・
         * contractNumber・items)とそろえる。注文番号は検索対象ではなかった。
         */}
        <input className={styles.search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="お客様の名前・ペット名・契約番号・中身で検索" aria-label="定期便を検索" />
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
                <ActionCell>
                  {/* #641: 主操作は枠つきボタン、残りは「その他（…）」へ集約。 */}
                  {/* 友だち詳細は静的書き出しのため /friends/detail?id= 形（IDEA-21 で修正）。 */}
                  <Button href={`/friends/detail?id=${encodeURIComponent(item.friendId)}`} variant="secondary">中身を見る</Button>
                  {/* 定期便の変更先。ECが契約の変更ページを渡しているときだけ出す。 */}
                  {item.manageUrl ? (
                    <>
                      <IconButton
                        aria-label={`${item.ownerName ?? 'お客様'}のその他操作`}
                        aria-expanded={openMenuId === item.id}
                        onClick={() => setOpenMenuId((current) => (current === item.id ? null : item.id))}
                      >
                        <MoreHorizontal aria-hidden />
                      </IconButton>
                      <ActionMenu
                        open={openMenuId === item.id}
                        ariaLabel={`${item.ownerName ?? 'お客様'}の操作`}
                        onClose={() => setOpenMenuId(null)}
                        items={[{
                          id: 'manage',
                          label: 'ECで変更',
                          onSelect: () => window.open(item.manageUrl!, '_blank', 'noopener,noreferrer'),
                        }]}
                      />
                    </>
                  ) : (
                    <span className="text-micro text-ink-faint" title="ECがこの契約の変更ページを渡していないため、ここからは開けません。ECの管理画面で確認してください。">変更先なし</span>
                  )}
                </ActionCell>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {/*
        「N件中M件」の N は**サーバが数えた総数**(#731)。以前は取ってきた行を
        数えていたので、501人目以降の契約は N にも入らず、切れていることが
        分からなかった。
      */}
      <p className={styles.footer}>
        {search.trim()
          ? `このページの ${shown.length.toLocaleString('ja-JP')}件を表示（検索はページの中だけに効きます）`
          : <ListRange
              label={filter === 'all' ? '定期便' : '表示条件に合う定期便'}
              total={total}
              first={total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
              last={(page - 1) * PAGE_SIZE + shown.length}
            />}
        {data && data.skipped.malformedSnapshots > 0
          ? `／ 形が読めなかったお客様のぶん ${data.skipped.malformedSnapshots.toLocaleString('ja-JP')}件は数えていません`
          : ''}
      </p>
      <Pagination
        page={page}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        onPageChange={setPage}
        ariaLabel="定期便のページ送り"
      />
    </>
  )
}
