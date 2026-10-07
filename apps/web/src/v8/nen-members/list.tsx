'use client'

/*
 * ★V8-B 会員一覧（AOWoJ）。今の V8 の会員一覧（app/nen/members/members-v8.tsx の MembersTabV8）を
 * 写した。検索・よく使う札・並び・件数・ページ送り・行の「…」は今と同じ口・同じ指定。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { RowActions } from '@/components/shared/row-actions'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import Pagination from '@/components/shared/pagination'
import PageSizeSelect from '@/components/ui/page-size-select'
import ListRange from '@/components/ui/list-range'
import { ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import {
  nenRanksApi,
  type NenMemberListData,
  type NenMemberRow,
  type NenMemberSort,
  type NenRankSettingsData,
} from '@/lib/nen-ranks-api'
import { RankChip, yen } from './parts'
import styles from './members.module.css'

type ListStatus = 'loading' | 'ready' | 'error' | 'forbidden'

export default function MembersListV8({
  accountId,
  settings,
}: {
  accountId: string
  settings: NenRankSettingsData | null
}) {
  const router = useRouter()
  const [status, setStatus] = useState<ListStatus>('loading')
  const [data, setData] = useState<NenMemberListData | null>(null)
  const [query, setQuery] = useState('')
  /** よく使う札：○○以上（上位2ランク）・ペットあり・EC未連携。 */
  const [chipTopRanks, setChipTopRanks] = useState(false)
  const [chipPet, setChipPet] = useState(false)
  const [chipUnlinked, setChipUnlinked] = useState(false)
  const [rank, setRank] = useState('')
  const [sort, setSort] = useState<NenMemberSort>('annual_desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const requestRef = useRef(0)

  /*
   * `?? []` をそのまま書くと、読み込み中に毎回新しい配列が生えて
   * 下の useMemo 連鎖がすべて揺れ、load が作り直されて取得がループする。
   */
  const rankSource = useMemo(() => data?.ranks ?? settings?.ranks ?? [], [data?.ranks, settings?.ranks])
  const sorted = useMemo(() => [...rankSource].sort((a, b) => b.annualThresholdYen - a.annualThresholdYen), [rankSource])
  const topTwoKeys = useMemo(() => sorted.slice(0, 2).map((item) => item.key), [sorted])
  /* load の依存には配列ではなく、内容で比べられる結合文字を使う（取得ループを防ぐ）。 */
  const topTwoKeyQuery = topTwoKeys.join(',')
  const rankOrder = useMemo(() => [...rankSource].sort((a, b) => a.annualThresholdYen - b.annualThresholdYen).map((item) => item.key), [rankSource])

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setStatus('loading')
    try {
      const res = await nenRanksApi.members(accountId, {
        q: query,
        rank,
        ranks: chipTopRanks && topTwoKeyQuery ? topTwoKeyQuery.split(',') : undefined,
        link: chipUnlinked ? 'unlinked' : undefined,
        pet: chipPet ? 'with' : 'any',
        sort,
        page,
        pageSize,
      })
      if (request !== requestRef.current) return
      if (!res.success) throw new Error(res.error)
      setData(res.data)
      setStatus('ready')
    } catch (caught) {
      if (request !== requestRef.current) return
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId, query, rank, chipTopRanks, chipPet, chipUnlinked, page, pageSize, sort, topTwoKeyQuery])

  useEffect(() => {
    void load()
  }, [load])

  const kpis = data?.kpis ?? settings?.kpis ?? null
  const unlinkedCount = kpis ? kpis.members - (kpis.linkedMembers ?? kpis.members) : undefined
  const topTwoCount = kpis ? topTwoKeys.reduce((sum, key) => sum + (kpis.byRank[key] ?? 0), 0) : undefined
  const topTwoLabel = sorted[1] ? `${sorted[1].name}以上` : '上位ランク'
  const filtering = Boolean(query.trim()) || chipTopRanks || chipPet || chipUnlinked || Boolean(rank)

  const clearFilters = () => {
    setQuery('')
    setChipTopRanks(false)
    setChipPet(false)
    setChipUnlinked(false)
    setRank('')
    setPage(1)
  }

  return (
    <div className={styles.listBody}>
      <NoteBar tone="info" help="ランクは通年の購入額で決まり、翌年の12月末まで維持されます" helpLabel="ランクの決まり">
        会員はネットショップで登録した人です。LINE と結びつくと、ランクやペットに合わせた配信ができます。
      </NoteBar>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <SearchField
            aria-label="会員を検索"
            placeholder="会員を探す"
            value={query}
            onChange={(value) => { setQuery(value); setPage(1) }}
            onClear={() => { setQuery(''); setPage(1) }}
          />
        </div>
        <FilterChip
          selected={chipTopRanks}
          count={topTwoCount}
          onChange={(next) => { setChipTopRanks(next); if (next) setRank(''); setPage(1) }}
          title={`今年の購入が ${yen(sorted[1]?.annualThresholdYen ?? 0)} 以上の会員`}
        >
          {topTwoLabel}
        </FilterChip>
        <FilterChip selected={chipPet} count={kpis?.petMembers} onChange={(next) => { setChipPet(next); setPage(1) }}>
          ペットあり
        </FilterChip>
        <FilterChip selected={chipUnlinked} count={unlinkedCount} onChange={(next) => { setChipUnlinked(next); setPage(1) }}>
          EC未連携
        </FilterChip>
        <span className={styles.toolbarRight}>
          <Select
            aria-label="よく使う絞り込み"
            value={rank}
            onChange={(value) => { setRank(value); if (value) setChipTopRanks(false); setPage(1) }}
            options={[
              { value: '', label: 'よく使う絞り込み' },
              ...rankSource.map((item) => ({ value: item.key, label: `ランク：${item.name}` })),
            ]}
          />
          <Select
            aria-label="並び順"
            value={sort}
            onChange={(value) => { setSort(value as NenMemberSort); setPage(1) }}
            options={[
              { value: 'annual_desc', label: '通年が多い順' },
              { value: 'lifetime_desc', label: 'ライフタイムが多い順' },
              { value: 'balance_desc', label: 'マイル残高が多い順' },
              { value: 'recent', label: '最終購入が新しい順' },
            ]}
          />
          <PageSizeSelect value={pageSize} options={[10, 20, 50]} onChange={(value) => { setPageSize(value); setPage(1) }} />
        </span>
      </div>

      <section>
        {status === 'loading' && !data ? (
          <ListState kind="loading" title="会員を読み込んでいます" />
        ) : status === 'forbidden' ? (
          <ListState kind="forbidden" />
        ) : status === 'error' ? (
          <ListState kind="error" title="会員を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />
        ) : data && data.items.length === 0 ? (
          filtering ? (
            <ListState
              kind="empty"
              title="条件に合う会員はいません"
              description="検索や絞り込みを外すと、すべて出ます。"
              action={<Button variant="secondary" onClick={clearFilters}>条件を外す</Button>}
            />
          ) : (
            <ListState kind="empty" emptyPreset="readonly" title="まだ会員がいません" description="ネットショップの会員が LINE と結びつくと、ここに並びます。" />
          )
        ) : data ? (
          <>
            <div className={styles.tableWrap}>
              <DataTable className="@container">
                <thead>
                  <TableHeadRow>
                    <Th className="w-64">会員</Th>
                    <Th className="w-24">ランク</Th>
                    <Th className="w-24" align="right">通年</Th>
                    <Th className="w-28" align="right">ライフタイム</Th>
                    <Th className="w-24" align="right">マイル残高</Th>
                    <Th>ペット</Th>
                    <Th className="cq-hide-below-1010 w-20">最終購入</Th>
                    <Th className="cq-hide-below-1010 w-20" align="right">マイル還元</Th>
                    <Th className="w-14" align="right"><span className="sr-only">操作</span></Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {data.items.map((member) => (
                    <MemberRow key={member.friendId} member={member} rankOrder={rankOrder} onOpen={(href) => router.push(href)} />
                  ))}
                </tbody>
              </DataTable>
            </div>
            <div className={styles.listFoot}>
              <ListRange
                total={data.total}
                first={data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1}
                last={Math.min(data.total, data.page * data.pageSize)}
              />
              {data.total > data.pageSize ? (
                <Pagination page={data.page} pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))} onPageChange={setPage} />
              ) : null}
            </div>
            <p className={styles.listHint}>行の「…」から 会員の詳細・友だちを開く・ECで開く。</p>
          </>
        ) : null}
      </section>
    </div>
  )
}

function MemberRow({
  member,
  rankOrder,
  onOpen,
}: {
  member: NenMemberRow
  rankOrder: string[]
  onOpen: (href: string) => void
}) {
  const initial = (member.name || '?').slice(0, 1)
  const friendDetail = `/friends/detail?id=${encodeURIComponent(member.friendId)}`
  return (
    <Tr>
      <Td className="w-64">
        <span className={styles.memberCell}>
          {member.pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- LINEのCDN画像
            <img src={member.pictureUrl} alt="" className={styles.avatar} />
          ) : (
            <span aria-hidden="true" className={styles.avatarInitial}>{initial}</span>
          )}
          <span className={styles.memberText}>
            <span className={styles.memberName} title={member.name}>{member.name || '（名前なし）'}</span>
            <span className={styles.memberSub}>{member.customerId ? `EC会員 ${member.customerId}` : 'EC未連携'}</span>
          </span>
        </span>
      </Td>
      <Td className="w-24"><RankChip rankKey={member.rankKey} name={member.rankName} rankOrder={rankOrder} /></Td>
      <Td align="right" className="w-24"><span className={styles.numStrong}>{yen(member.annualMilesYen)}</span></Td>
      <Td align="right" className="w-28"><span className={styles.numSoft}>{yen(member.lifetimeMilesYen)}</span></Td>
      <Td align="right" className="w-24"><span className={styles.numPlain}>{formatNumber(member.mileBalance)}</span></Td>
      <Td>
        <span className={styles.cellText} title={member.petNames ?? ''}>
          {member.petNames ? `${member.petNames}${member.petCount > 2 ? ` ほか${member.petCount - 2}頭` : ''}` : '—'}
        </span>
      </Td>
      <Td className="cq-hide-below-1010 w-20"><span className={styles.cellText}>{member.lastPurchasedAt ? member.lastPurchasedAt.slice(5, 10).replace('-', '/') : '—'}</span></Td>
      <Td className="cq-hide-below-1010 w-20" align="right"><span className={styles.numStrong}>{member.mileRatePercent == null ? '—' : `${member.mileRatePercent}%`}</span></Td>
      <Td align="right" className="w-14">
        {/*
          行の「…」：会員の詳細（＝友だち詳細の会員の区画）・友だちを開く・ECで開く。
          EC 側に会員の管理ページの住所は無いので、「ECで開く」はECのつなぎの画面へ。
        */}
        <RowActions
          subjectName={member.name || 'この会員'}
          menuItems={[
            { id: 'detail', label: '会員の詳細', external: true, onSelect: () => onOpen(friendDetail) },
            { id: 'friend', label: '友だちを開く', external: true, onSelect: () => onOpen(`${friendDetail}&tab=info`) },
            {
              id: 'ec',
              label: 'ECで開く',
              external: true,
              disabled: !member.customerId,
              disabledReason: 'ECと結びついていません',
              onSelect: () => onOpen('/ec-commerce'),
            },
          ]}
        />
      </Td>
    </Tr>
  )
}
