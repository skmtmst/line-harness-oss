'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import SummaryCard from '@/components/shared/summary-card'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { ApiError } from '@/lib/api'
import { nenRanksApi, type NenMemberListData, type NenMemberRow, type NenMemberSort, type NenRankSettingsData } from '@/lib/nen-ranks-api'
import type { LoadStatus } from './page'
import { RankChip, yen } from './rank-view'
import KpiCollapse from '@/components/ui/kpi-collapse'

type ListStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * 会員一覧タブ。★V6 37-1（`IqL2Z`）。
 * 列：会員（EC会員ID）／ランク／通年／ライフタイム／マイル残高／ペット／最終購入／マイル還元／詳細。
 */
export default function MembersTab({
  accountId,
  settingsStatus,
  settings,
}: {
  accountId: string
  settingsStatus: LoadStatus
  settings: NenRankSettingsData | null
}) {
  const [status, setStatus] = useState<ListStatus>('loading')
  const [data, setData] = useState<NenMemberListData | null>(null)
  const [query, setQuery] = useState('')
  const [rank, setRank] = useState('')
  const [pet, setPet] = useState<'any' | 'with' | 'without'>('any')
  const [sort, setSort] = useState<NenMemberSort>('annual_desc')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await nenRanksApi.members(accountId, { q: query, rank, pet, sort, page })
      if (!res.success) throw new Error(res.error)
      setData(res.data)
      setStatus('ready')
    } catch (caught) {
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId, query, rank, pet, sort, page])

  useEffect(() => {
    void load()
  }, [load])

  const kpis = data?.kpis ?? settings?.kpis ?? null
  const ranks = data?.ranks ?? settings?.ranks.map((r) => ({ key: r.key, name: r.name, annualThresholdYen: r.annualThresholdYen, mileRatePercent: r.mileRatePercent })) ?? []
  const topRanks = [...ranks].sort((a, b) => b.annualThresholdYen - a.annualThresholdYen)
  const topTwo = topRanks.slice(0, 2)
  const rankOrder = [...ranks].sort((a, b) => a.annualThresholdYen - b.annualThresholdYen).map((r) => r.key)
  const ready = status === 'ready' && kpis !== null
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <>
      <KpiCollapse data-design="KPIs" data-design-node="THwtN" gridClassName="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard variant="v6" title="LINE連携済みの会員" value={ready ? kpis!.members : null} unit="人" detail="ECの会員と結びついた友だち" loading={!ready && settingsStatus === 'loading'} />
        <SummaryCard variant="v6" title="通年 合計" value={ready ? kpis!.annualTotalYen : null} unit="円" detail="1/1〜今日の購入額" loading={!ready && settingsStatus === 'loading'} />
        <SummaryCard
          variant="v6"
          title={topTwo.map((r) => r.name).join('・') || '上位ランク'}
          value={ready && topTwo[0] ? (kpis!.byRank[topTwo[0].key] ?? 0) : null}
          unit="人"
          detail={ready && topTwo[1] ? `${topTwo[1].name} ${kpis!.byRank[topTwo[1].key] ?? 0}人` : '—'}
          loading={!ready && settingsStatus === 'loading'}
        />
        <SummaryCard variant="v6" title="マイル残高 合計" value={ready ? kpis!.balanceTotal : null} unit="マイル" detail={ready ? `今月 使われた ${kpis!.usedThisMonth.toLocaleString('ja-JP')}マイル` : '—'} loading={!ready && settingsStatus === 'loading'} />
      </KpiCollapse>

      <div data-design="Note" data-design-node="G9TVE">
        <NoteBar tone="info">
          ランクは通年（1〜12月の購入額）で決まり、翌年の12月末まで維持されます。ランクが変わると友だち属性のタグが自動で付け替わります。
        </NoteBar>
      </div>

      <div data-design="ListControls" data-design-node="c75RAU" className="flex flex-wrap items-center gap-3">
        <form
          className="min-w-64 flex-1"
          onSubmit={(event) => { event.preventDefault(); setPage(1); void load() }}
        >
          <TextField
            aria-label="会員を検索"
            placeholder="名前・EC会員IDで検索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
        <Select
          aria-label="ランクで絞り込む"
          value={rank}
          onChange={(value) => { setRank(value); setPage(1) }}
          options={[{ value: '', label: 'ランク：すべて' }, ...ranks.map((r) => ({ value: r.key, label: `ランク：${r.name}` }))]}
        />
        <Select
          aria-label="ペットの有無で絞り込む"
          value={pet}
          onChange={(value) => { setPet(value === 'with' || value === 'without' ? value : 'any'); setPage(1) }}
          options={[{ value: 'any', label: 'ペット：すべて' }, { value: 'with', label: 'ペット：登録あり' }, { value: 'without', label: 'ペット：未登録' }]}
        />
        <Select
          aria-label="並び順"
          value={sort}
          onChange={(value) => { setSort(value as NenMemberSort); setPage(1) }}
          options={[
            { value: 'annual_desc', label: '並び：通年が多い順' },
            { value: 'lifetime_desc', label: '並び：ライフタイムが多い順' },
            { value: 'balance_desc', label: '並び：マイル残高が多い順' },
            { value: 'recent', label: '並び：最終購入が新しい順' },
          ]}
        />
        <span className="ml-auto text-caption font-semibold text-ink-faint">
          {data ? `${data.total.toLocaleString('ja-JP')}人中 ${data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1}〜${Math.min(data.total, data.page * data.pageSize)}人` : '—'}
        </span>
      </div>

      <section data-design="Table" data-design-node="poyyh">
        {status === 'loading' && !data ? (
          <ListState kind="loading" title="会員を読み込んでいます" />
        ) : status === 'forbidden' ? (
          <ListState kind="forbidden" />
        ) : status === 'error' ? (
          <ListState kind="error" title="会員を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />
        ) : data && data.items.length === 0 ? (
          <ListState kind="empty" emptyPreset="readonly" title="まだ会員がいません" description="ECの会員がLINEと結びつくと、ここに並びます。" />
        ) : data ? (
          <>
            {/* @container: 列の出し分けを画面幅ではなく表の実際の幅で決める。
                サイドバー・フォルダ欄の有無で同じ画面幅でも表の幅が違うため。 */}
            <DataTable className="@container">
              <thead>
                <TableHeadRow>
                  <Th className="w-72">会員</Th>
                  <Th className="w-28">ランク</Th>
                  <Th className="w-32" align="right">通年</Th>
                  <Th className="w-32" align="right">ライフタイム</Th>
                  <Th className="w-28" align="right">マイル残高</Th>
                  <Th>ペット</Th>
                  {/* 谷間帯の列削減: 詳細画面で見られる列から先に畳む。 */}
                  <Th className="cq-hide-below-1120 w-28">最終購入</Th>
                  <Th className="cq-hide-below-1010 w-24" align="right">マイル還元</Th>
                  {/* #768: 表が横に流れる帯でも操作列は右端に留める。 */}
                  <Th className="bg-surface-pearl sticky right-0 w-16" align="right"><span className="sr-only">操作</span></Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {data.items.map((member) => <MemberRow key={member.friendId} member={member} rankOrder={rankOrder} />)}
              </tbody>
            </DataTable>
            {pageCount > 1 ? <Pagination page={data.page} pageCount={pageCount} onPageChange={setPage} /> : null}
          </>
        ) : null}
      </section>
    </>
  )
}

function MemberRow({ member, rankOrder }: { member: NenMemberRow; rankOrder: string[] }) {
  const initial = (member.name || '?').slice(0, 1)
  return (
    <Tr>
      <Td>
        <span className="flex items-center gap-3">
          {member.pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- LINEのCDN画像
            <img src={member.pictureUrl} alt="" className="h-9 w-9 shrink-0 rounded-pill object-cover" />
          ) : (
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-caption font-bold text-accent-deep">{initial}</span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-label font-semibold text-ink" title={member.name}>{member.name || '（名前なし）'}</span>
            <span className="block truncate text-micro text-ink-faint">{member.customerId ? `EC会員 ${member.customerId}` : 'EC未連携'}</span>
          </span>
        </span>
      </Td>
      <Td><RankChip rankKey={member.rankKey} name={member.rankName} rankOrder={rankOrder} /></Td>
      <Td align="right"><span className="text-label font-semibold tabular-nums text-ink">{yen(member.annualMilesYen)}</span></Td>
      <Td align="right"><span className="text-label tabular-nums text-ink-secondary">{yen(member.lifetimeMilesYen)}</span></Td>
      <Td align="right"><span className="text-label tabular-nums text-ink">{member.mileBalance.toLocaleString('ja-JP')}</span></Td>
      <Td>
        <span className="block truncate text-label text-ink-secondary" title={member.petNames ?? ''}>
          {member.petNames ? `${member.petNames}${member.petCount > 2 ? ` ほか${member.petCount - 2}頭` : ''}` : '—'}
        </span>
      </Td>
      <Td className="cq-hide-below-1120"><span className="text-label text-ink-secondary">{member.lastPurchasedAt ? member.lastPurchasedAt.slice(5, 10).replace('-', '/') : '—'}</span></Td>
      <Td className="cq-hide-below-1010" align="right"><span className="text-label font-semibold tabular-nums text-ink">{member.mileRatePercent == null ? '—' : `${member.mileRatePercent}%`}</span></Td>
      <Td align="right" className="bg-canvas sticky right-0">
        <Link href={`/friends/detail?id=${encodeURIComponent(member.friendId)}`} className="text-label font-semibold text-action">詳細</Link>
      </Td>
    </Tr>
  )
}
