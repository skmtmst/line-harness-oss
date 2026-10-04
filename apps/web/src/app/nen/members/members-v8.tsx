'use client'

/*
 * ★V8-B 会員（Pencil「★V8-B 画面の地図」専用機能の組：
 * 会員一覧 `AOWoJ`、ランク設定 `fb9NJ`、ランク設定の競合 `e5yBLx`、
 * ライフタイム `zQ5vY`、状態の板 `dzx5D`）。
 *
 * v7（page.tsx 内の MembersInner と members-tab / rank-settings-tab /
 * lifetime-tab）とは別の部品として持ち、data-theme="v8" のときだけ
 * こちらが出る。データの口（settings・members・saveRanks・saveMilestones・
 * deleteRank・resync）は同じ。違いは置き場と見せ方だけ——
 * ・会員の数の帯は1枚の白い板に区切り線で4つ（離したカードにしない）。
 * ・道具の段は「会員を探す」＋よく使う札（○○以上・ペットあり・EC未連携）。
 * ・ランクの表には 友だち属性タグ・会員数 列があり、削除は移す先つきの
 *   版つき DELETE（版が違うと競合の帯 e5yBLx へ）。
 * ・「ECとの照合」タブは今の作りどおり /ec-commerce/identity-candidates へ。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, RefreshCw, Users, PawPrint, ShoppingBag, Link2 } from 'lucide-react'
import Button from '@/components/shared/button'
import NoPermissionV8 from '@/app/no-permission/no-permission-v8'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Chip from '@/components/shared/chip'
import { describeApiFailure } from '@/components/shared/api-error-message'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { RowActions, DeleteAction } from '@/components/shared/row-actions'
import StickyBar from '@/components/shared/sticky-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import Pagination from '@/components/shared/pagination'
import PageSizeSelect from '@/components/ui/page-size-select'
import ListRange from '@/components/ui/list-range'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { Tabs } from '@/components/shared/tabs'
import { ApiError } from '@/lib/api'
import { usePageCrumbs } from '@/components/shell/page-chrome'
import { formatJstDateTime } from '@/lib/presentation'
import { formatNumber } from '@/lib/format'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { csvExportLine } from '@/app/friends/csv-export'
import {
  nenRanksApi,
  type NenMemberListData,
  type NenMemberRow,
  type NenMemberSort,
  type NenRankSettingsData,
} from '@/lib/nen-ranks-api'
import type { LoadStatus, MemberTab } from './page'
import { RankChip, yen } from './rank-view'
import styles from './members-v8.module.css'

type ListStatus = 'loading' | 'ready' | 'error' | 'forbidden'

const RULE_LABELS = {
  yearStartMonth: (month: number) => (month === 1 ? '1月1日〜12月31日' : `${month}月1日〜翌年${month - 1}月末`),
  applyOnReach: 'すぐに反映する',
  keepUntil: '翌年の12月末まで',
  countOrders: '入金済みの注文（キャンセル・返金は除く）',
} as const

/** 板ごとの data-design-node（タブで切り替える外枠の印）。 */
const BOARD_NODE: Record<MemberTab, string> = {
  members: 'AOWoJ',
  ranks: 'fb9NJ',
  lifetime: 'zQ5vY',
}

/**
 * 会員の V8 画面。外枠（見出し・CSV・タブ・数の帯）は全部のタブで同じ。
 */
export default function MembersPageV8({
  accountId,
  tab,
  status,
  settings,
  onRetry,
  onSaved,
  onChangeTab,
}: {
  accountId: string | null
  tab: MemberTab
  status: LoadStatus
  settings: NenRankSettingsData | null
  onRetry: () => void
  onSaved: (forAccountId: string, next: NenRankSettingsData) => void
  onChangeTab: (next: MemberTab) => void
}) {
  const role = useStaffRole()
  const readonly = role !== null && !canManageRole(role)
  /* ★V8 の上の帯は「ホーム › 会員」（板 AOWoJ）。画面名は枠が付ける。 */
  usePageCrumbs([{ label: 'ホーム', href: '/' }])

  const kpis = settings?.kpis ?? null
  const ranks = settings?.ranks ?? []

  return (
    <div className={styles.board} data-design-node={BOARD_NODE[tab]}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>会員</h1>
          <p className={styles.headDescription}>
            ネットショップの会員と LINE の友だちを結びつけて、ランクやペットの情報を見ます。
          </p>
        </div>
        {tab === 'members' && accountId ? <CsvExportButton accountId={accountId} /> : null}
      </header>

      <Tabs
        label="会員の切り替え"
        items={[
          { label: '会員一覧', count: kpis?.members, current: tab === 'members', onClick: () => onChangeTab('members') },
          { label: 'ランク設定', current: tab === 'ranks', onClick: () => onChangeTab('ranks') },
          { label: 'ライフタイム', current: tab === 'lifetime', onClick: () => onChangeTab('lifetime') },
          { label: 'ECとの照合', href: '/ec-commerce/identity-candidates' },
        ]}
      />

      {!accountId ? (
        <ListState
          kind="empty"
          title="LINEアカウントを選んでください"
          description="上のバーから、会員を見るLINEアカウントを選びます。"
        />
      ) : (
        <>
          <MembersKpiBand kpis={kpis} ranks={ranks} loading={status === 'loading' && !settings} />
          {tab === 'ranks' ? (
            <RankSettingsTabV8
              accountId={accountId}
              status={status}
              settings={settings}
              onSaved={onSaved}
              onRetry={onRetry}
              readonly={readonly}
            />
          ) : tab === 'lifetime' ? (
            <LifetimeTabV8
              accountId={accountId}
              status={status}
              settings={settings}
              onSaved={onSaved}
              onRetry={onRetry}
              readonly={readonly}
            />
          ) : (
            <MembersTabV8 accountId={accountId} settings={settings} />
          )}
        </>
      )}
    </div>
  )
}

/**
 * 数の帯。1枚の白い板を区切り線で4つに分ける（★V8 の決まり：
 * 数の帯はカードを離して並べず、白い板の左右いっぱいに置く）。
 * 数と単位（人）は分け、金額は ¥込みの1つの数に見せる（見本 AOWoJ）。
 */
export function MembersKpiBand({
  kpis,
  ranks,
  loading,
}: {
  kpis: NenRankSettingsData['kpis'] | null
  ranks: NenRankSettingsData['ranks']
  loading: boolean
}) {
  const sorted = [...ranks].sort((a, b) => b.annualThresholdYen - a.annualThresholdYen)
  // 「○○以上」は上から2ランク（描いた板は ゴールド以上＝プラチナとゴールド）。
  const topTwo = sorted.slice(0, 2)
  const topTwoCount = kpis ? topTwo.reduce((sum, rank) => sum + (kpis.byRank[rank.key] ?? 0), 0) : null
  const topTwoLabel = topTwo[1] ? `${topTwo[1].name}以上` : '上位ランク'
  const petPercent = kpis && kpis.members > 0 ? Math.round(((kpis.petMembers ?? 0) / kpis.members) * 100) : null

  const cell = (
    icon: React.ReactNode,
    label: string,
    value: string,
    unit: string | null,
    sub: string,
  ) => (
    <div className={styles.kpiCell} key={label}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiIcon} aria-hidden="true">{icon}</span>
        <span className={styles.kpiLabel}>{label}</span>
      </div>
      <p className={styles.kpiValue}>{value}{unit ? <span className={styles.kpiUnit}>{unit}</span> : null}</p>
      <p className={styles.kpiSub}>{sub}</p>
    </div>
  )

  const pending = loading || !kpis
  return (
    <section className={styles.kpiBand} aria-label="会員の数の帯">
      {cell(<Users size={14} />, '会員', pending ? '—' : formatNumber(kpis!.members), pending ? null : '人', pending ? ' ' : `LINE 連携済み ${formatNumber(kpis!.linkedMembers ?? 0)}`)}
      {cell(<ShoppingBag size={14} />, topTwoLabel, pending || topTwo.length === 0 ? '—' : formatNumber(topTwoCount ?? 0), pending || topTwo.length === 0 ? null : '人', topTwo[1] ? `今年の購入 ${yen(topTwo[1].annualThresholdYen)} 以上` : ' ')}
      {cell(<PawPrint size={14} />, 'ペット登録あり', pending ? '—' : formatNumber(kpis!.petMembers ?? 0), pending ? null : '人', pending || petPercent === null ? ' ' : `会員の ${petPercent}%`)}
      {cell(<Link2 size={14} />, '今月の購入', pending ? '—' : yen(kpis!.monthPurchaseYen ?? 0), null, pending ? ' ' : `会員 ${formatNumber(kpis!.monthBuyers ?? 0)} 人`)}
    </section>
  )
}

/** 「CSV で書き出す」。いまの絞り込みは付けず、見えている会員をすべて書き出す。 */
function CsvExportButton({ accountId }: { accountId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const exportCsv = async () => {
    setBusy(true)
    setError('')
    try {
      const rows: NenMemberRow[] = []
      let page = 1
      // 1回あたり100件まで。全部取る（NEN の会員数は数百規模を想定）。
      for (;;) {
        const res = await nenRanksApi.members(accountId, { page, pageSize: 100, sort: 'annual_desc' })
        if (!res.success) throw new Error(res.error)
        rows.push(...res.data.items)
        if (rows.length >= res.data.total || res.data.items.length === 0) break
        page += 1
      }
      const lines = [
        csvExportLine(['会員名', 'EC会員ID', 'LINE連携', 'ランク', '通年（円）', 'ライフタイム（円）', 'マイル残高', 'ペット', '最終購入', 'マイル還元（%）']),
        ...rows.map((member) => csvExportLine([
          member.name,
          member.customerId ?? '',
          member.customerId ? '連携済み' : '未連携',
          member.rankName,
          String(member.annualMilesYen),
          String(member.lifetimeMilesYen),
          String(member.mileBalance),
          member.petNames ?? '',
          member.lastPurchasedAt ?? '',
          member.mileRatePercent == null ? '' : String(member.mileRatePercent),
        ])),
      ]
      const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `nen-members-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setError(describeApiFailure(caught, 'CSVの書き出し', {
        forbidden: 'CSVを書き出す権限がありません。権限を確認してください。',
      }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={styles.csvWrap}>
      <Button variant="secondary" onClick={() => void exportCsv()} disabled={busy}>
        <Download aria-hidden="true" className="h-4 w-4" />
        {busy ? '書き出しています…' : 'CSV で書き出す'}
      </Button>
      {error ? <span className={styles.csvError} role="alert">{error}</span> : null}
    </span>
  )
}

/* ---------- 会員一覧（AOWoJ） ---------- */

function MembersTabV8({
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
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const requestRef = useRef(0)

  /*
   * `?? []` をそのまま書くと、読み込み中に毎回新しい配列が生えて
   * 下の useMemo 連鎖がすべて揺れ、load が作り直されて取得がループする。
   * 空のときも同じ配列を返すよう、ここだけ先に memo で固定する。
   */
  const rankSource = useMemo(() => data?.ranks ?? settings?.ranks ?? [], [data?.ranks, settings?.ranks])
  const sorted = useMemo(() => [...rankSource].sort((a, b) => b.annualThresholdYen - a.annualThresholdYen), [rankSource])
  const topTwoKeys = useMemo(() => sorted.slice(0, 2).map((rank) => rank.key), [sorted])
  /*
   * load の依存には配列（取得ごとに新しい実体）ではなく、
   * 内容で比べられる結合文字を使う。配列を入れると取得のたびに load が
   * 作り直され、useEffect が再発火して取得ループになる。
   */
  const topTwoKeyQuery = topTwoKeys.join(',')
  const rankOrder = useMemo(() => [...rankSource].sort((a, b) => a.annualThresholdYen - b.annualThresholdYen).map((rank) => rank.key), [rankSource])

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
        sort: 'annual_desc' as NenMemberSort,
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
  }, [accountId, query, rank, chipTopRanks, chipPet, chipUnlinked, page, pageSize, topTwoKeyQuery])

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
    <>
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
        <FilterChip
          selected={chipPet}
          count={kpis?.petMembers}
          onChange={(next) => { setChipPet(next); setPage(1) }}
        >
          ペットあり
        </FilterChip>
        <FilterChip
          selected={chipUnlinked}
          count={unlinkedCount}
          onChange={(next) => { setChipUnlinked(next); setPage(1) }}
        >
          EC未連携
        </FilterChip>
        <span className={styles.toolbarRight}>
          <Select
            aria-label="よく使う絞り込み"
            value={rank}
            onChange={(value) => { setRank(value); if (value) setChipTopRanks(false); setPage(1) }}
            options={[
              { value: '', label: 'よく使う絞り込み' },
              ...(data?.ranks ?? settings?.ranks ?? []).map((r) => ({ value: r.key, label: `ランク：${r.name}` })),
            ]}
          />
          <PageSizeSelect
            value={pageSize}
            options={[10, 20, 50]}
            onChange={(value) => { setPageSize(value); setPage(1) }}
          />
        </span>
      </div>

      <section>
        {status === 'loading' && !data ? (
          <ListState kind="loading" title="会員を読み込んでいます" />
        ) : status === 'forbidden' ? (
          <NoPermissionV8
            featureName="会員"
            capabilitiesHref="/staff"
          />
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
            <ListState
              kind="empty"
              emptyPreset="readonly"
              title="まだ会員がいません"
              description="ネットショップの会員が LINE と結びつくと、ここに並びます。"
            />
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
                    <MemberRowV8 key={member.friendId} member={member} rankOrder={rankOrder} onOpen={(href) => router.push(href)} />
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
                <Pagination
                  page={data.page}
                  pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))}
                  onPageChange={setPage}
                />
              ) : null}
            </div>
            <p className={styles.listHint}>行の「…」から 会員の詳細・友だちを開く・ECで開く。</p>
          </>
        ) : null}
      </section>
    </>
  )
}

function MemberRowV8({
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
        <span className="flex items-center gap-3">
          {member.pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- LINEのCDN画像
            <img src={member.pictureUrl} alt="" className="h-9 w-9 shrink-0 rounded-pill object-cover" />
          ) : (
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-caption font-medium text-accent-deep">{initial}</span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-label font-semibold text-ink" title={member.name}>{member.name || '（名前なし）'}</span>
            <span className="block truncate text-micro text-ink-faint">{member.customerId ? `EC会員 ${member.customerId}` : 'EC未連携'}</span>
          </span>
        </span>
      </Td>
      <Td className="w-24"><RankChip rankKey={member.rankKey} name={member.rankName} rankOrder={rankOrder} /></Td>
      <Td align="right" className="w-24"><span className="text-label font-semibold tabular-nums text-ink">{yen(member.annualMilesYen)}</span></Td>
      <Td align="right" className="w-28"><span className="text-label tabular-nums text-ink-secondary">{yen(member.lifetimeMilesYen)}</span></Td>
      <Td align="right" className="w-24"><span className="text-label tabular-nums text-ink">{formatNumber(member.mileBalance)}</span></Td>
      <Td>
        <span className="block truncate text-label text-ink-secondary" title={member.petNames ?? ''}>
          {member.petNames ? `${member.petNames}${member.petCount > 2 ? ` ほか${member.petCount - 2}頭` : ''}` : '—'}
        </span>
      </Td>
      <Td className="cq-hide-below-1010 w-20"><span className="text-label text-ink-secondary">{member.lastPurchasedAt ? member.lastPurchasedAt.slice(5, 10).replace('-', '/') : '—'}</span></Td>
      <Td className="cq-hide-below-1010 w-20" align="right"><span className="text-label font-semibold tabular-nums text-ink">{member.mileRatePercent == null ? '—' : `${member.mileRatePercent}%`}</span></Td>
      <Td align="right" className="w-14">
        {/*
          板の行の「…」：会員の詳細（＝友だち詳細の会員の区画）・友だちを開く・ECで開く。
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

/* ---------- ランク設定（fb9NJ / 競合 e5yBLx） ---------- */

type RankDraft = { id: string | null; name: string; threshold: string; rate: string; tagName: string | null; memberCount: number }

function RankSettingsTabV8({
  accountId,
  status,
  settings,
  onSaved,
  onRetry,
  readonly,
}: {
  accountId: string
  status: LoadStatus
  settings: NenRankSettingsData | null
  onSaved: (forAccountId: string, next: NenRankSettingsData) => void
  onRetry: () => void
  readonly: boolean
}) {
  const [drafts, setDrafts] = useState<RankDraft[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /**
   * 競合（e5yBLx）：読み込んだあとにほかの人が保存した形。
   * latest はその時点で取り直した新しい設定。「違いを比べる」で見せる。
   */
  const [conflict, setConflict] = useState<{ latest: NenRankSettingsData } | null>(null)
  const [comparing, setComparing] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<number | null>(null)
  const [replacement, setReplacement] = useState('')
  const [draftAccountId, setDraftAccountId] = useState(accountId)

  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })

  if (draftAccountId !== accountId) {
    const hadUnsaved = dirty
    setDraftAccountId(accountId)
    setDrafts([])
    setDirty(false)
    setError('')
    setRemoveTarget(null)
    setConflict(null)
    setComparing(false)
    cancelLeave()
    setNotice(hadUnsaved ? 'LINEアカウントを切り替えたため、保存していない変更は破棄しました。' : '')
  }

  const fromSettings = (next: NenRankSettingsData): RankDraft[] =>
    next.ranks.map((rank) => ({
      id: rank.id, name: rank.name, threshold: String(rank.annualThresholdYen), rate: String(rank.mileRatePercent), tagName: rank.tagName, memberCount: rank.memberCount,
    }))

  useEffect(() => {
    if (!settings || dirty) return
    setDrafts(fromSettings(settings))
  }, [settings, dirty])

  const update = (index: number, patch: Partial<RankDraft>) => {
    setDrafts((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    setDirty(true)
    setNotice('')
  }
  const add = () => {
    setDrafts((current) => [...current, { id: null, name: '', threshold: '', rate: '', tagName: null, memberCount: 0 }])
    setDirty(true)
  }
  const cancel = () => {
    setDirty(false)
    setError('')
    setConflict(null)
    if (settings) setDrafts(fromSettings(settings))
  }

  /**
   * 保存の前に最新を取り直し、読み込んだ版から進んでいたら競合の帯へ
   * （e5yBLx。PUT には版の口が無いため、画面側で先に確かめる）。
   */
  const checkConflict = async (): Promise<NenRankSettingsData | null> => {
    if (!settings?.rules) return null
    const res = await nenRanksApi.settings(accountId)
    if (!res.success) return null
    const latest = res.data
    if (latest.rules && latest.rules.version !== settings.rules.version) {
      setConflict({ latest })
      return latest
    }
    return null
  }

  const save = async (force = false) => {
    if (draftAccountId !== accountId) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (!force && await checkConflict()) return
      const res = await nenRanksApi.saveRanks(accountId, drafts.map((row) => ({
        id: row.id,
        name: row.name.trim(),
        annualThresholdYen: Number(row.threshold.replace(/[,，]/g, '')),
        mileRatePercent: Number(row.rate),
      })))
      if (!res.success) throw new Error(res.error)
      setDirty(false)
      setConflict(null)
      setComparing(false)
      onSaved(accountId, res.data)
      setNotice(res.data.sync?.status === 'synced'
        ? 'ランク設定を保存し、ECへ同期しました。友だち属性のタグも付け替えています。'
        : 'ランク設定を保存しました。ECへの同期は失敗したので、右の「もう一度同期」で送り直せます。')
    } catch (caught) {
      setError(describeApiFailure(caught, 'ランク設定の保存', {
        forbidden: 'ランク設定を保存する権限がありません。権限を確認してください。',
      }))
    } finally {
      setBusy(false)
    }
  }

  /** ランクの削除は版つきの DELETE（移す先を選んで会員を反映する）。 */
  const removeRank = async () => {
    if (removeTarget === null || !settings?.rules) return
    const row = drafts[removeTarget]
    if (!row?.id) {
      setDrafts((current) => current.filter((_, i) => i !== removeTarget))
      setRemoveTarget(null)
      setDirty(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await nenRanksApi.deleteRank(accountId, row.id, {
        replacementRankId: replacement || null,
        expectedVersion: settings.rules.version,
      })
      if (!res.success) throw new Error(res.error)
      setRemoveTarget(null)
      setReplacement('')
      setNotice(res.data.ecSync === 'synced' ? 'ランクを削除し、会員を移し先へ反映しました。' : `ランクを削除しました。${res.data.message ?? ''}`)
      onRetry()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        const res = await nenRanksApi.settings(accountId).catch(() => null)
        if (res?.success) setConflict({ latest: res.data })
        setRemoveTarget(null)
      } else {
        setError(describeApiFailure(caught, 'ランクの削除', {
          forbidden: 'ランクを削除する権限がありません。権限を確認してください。',
        }))
      }
    } finally {
      setBusy(false)
    }
  }

  /** 「最新を読み込んで続ける」：新しい設定へ乗り換え、下書きは捨てる。 */
  const reloadLatest = () => {
    if (!conflict) return
    onSaved(accountId, conflict.latest)
    setConflict(null)
    setComparing(false)
    setDirty(false)
    setError('')
    setNotice('最新のランク設定を読み込みました。')
  }

  const resync = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await nenRanksApi.resync(accountId)
      if (!res.success) throw new Error(res.error)
      onSaved(accountId, res.data)
      setNotice(res.data.sync?.status === 'synced' ? 'ECへ同期しました。' : `ECへの同期に失敗しました：${res.data.sync?.error ?? ''}`)
    } catch (caught) {
      setError(describeApiFailure(caught, 'ECへの同期', {
        forbidden: 'ECへ同期する権限がありません。権限を確認してください。',
      }))
    } finally {
      setBusy(false)
    }
  }

  const noticeEl = notice ? <p className={styles.notice} role="status">{notice}</p> : null
  if (status === 'loading' && !settings) return <>{noticeEl}<ListState kind="loading" title="ランク設定を読み込んでいます" /></>
  if (status === 'forbidden') {
    return (
      <NoPermissionV8
        featureName="ランク設定"
        capabilitiesHref="/staff"
      />
    )
  }
  if (status === 'error') return <ListState kind="error" title="ランク設定を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={onRetry} />
  if (!settings) return <>{noticeEl}<ListState kind="loading" title="ランク設定を読み込んでいます" /></>

  const rules = settings.rules
  const removeRow = removeTarget !== null ? drafts[removeTarget] : null
  const removeCandidates = removeRow ? drafts.filter((row) => row.id && row.id !== removeRow.id) : []

  return (
    <>
      {conflict ? (
        /* e5yBLx：黄色の帯。保存した人の情報は API に無いので時刻だけ出す。 */
        <NoteBar
          tone="warn"
          action={(
            <span className={styles.conflictActions}>
              <Button variant="secondary" size="compact" onClick={() => setComparing(true)}>違いを比べる</Button>
              <Button variant="secondary" size="compact" onClick={reloadLatest}>最新を読み込んで続ける</Button>
            </span>
          )}
        >
          {conflict.latest.rules ? `${formatJstDateTime(conflict.latest.rules.updatedAt)} にランク設定が保存されました。` : 'ランク設定が別の場所で保存されました。'}
          このまま保存すると、その変更が消えます。
        </NoteBar>
      ) : null}

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.errorText} role="alert">{error}</p> : null}

      <div className={styles.rankGrid}>
        <div className={styles.rankMain}>
          <section className={styles.card} data-design-node="luziY">
            <h2 className={styles.cardTitle}>ランクの決まり</h2>
            <p className={styles.cardDesc}>通年の購入額でランクが決まります</p>
            <dl className={styles.ruleGrid}>
              <RuleBox label="通年の区切り" value={RULE_LABELS.yearStartMonth(rules?.yearStartMonth ?? 1)} />
              <RuleBox label="集計に含める注文" value={RULE_LABELS.countOrders} />
              <RuleBox label="上がったとき" value={RULE_LABELS.applyOnReach} />
              <RuleBox label="維持する期間" value={RULE_LABELS.keepUntil} />
            </dl>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>ランク</h2>
            <p className={styles.cardDesc}>上から高い順。行を外して保存すると、そのランクは「廃止予定」になり、会員を移し先へ反映します</p>
            <div className={styles.tableWrap}>
              <DataTable>
                <thead>
                  <TableHeadRow>
                    <Th className="w-40">ランク名</Th>
                    <Th className="w-36">通年のしきい値</Th>
                    <Th className="w-28">マイル還元</Th>
                    <Th>友だち属性タグ</Th>
                    <Th className="cq-hide-below-1010 w-20" align="right">会員数</Th>
                    <Th className="w-14" align="right"><span className="sr-only">削除</span></Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {drafts.map((row, index) => {
                    const isBase = index === drafts.length - 1 && row.threshold.replace(/[,，]/g, '') === '0'
                    return (
                      <Tr key={row.id ?? `new-${index}`}>
                        <Td className="w-40">
                          <TextField aria-label={`ランク名 ${index + 1}`} value={row.name} maxLength={20} disabled={readonly} onChange={(event) => update(index, { name: event.target.value })} />
                        </Td>
                        <Td className="w-36">
                          <span className="flex items-center gap-2">
                            <TextField aria-label={`しきい値 ${index + 1}`} inputMode="numeric" value={row.threshold} disabled={readonly || isBase} onChange={(event) => update(index, { threshold: event.target.value })} />
                            <span className="shrink-0 text-caption font-semibold text-ink-faint">円〜</span>
                          </span>
                        </Td>
                        <Td className="w-28">
                          <span className="flex items-center gap-2">
                            <TextField aria-label={`マイル還元 ${index + 1}`} inputMode="decimal" value={row.rate} disabled={readonly} onChange={(event) => update(index, { rate: event.target.value })} />
                            <span className="shrink-0 text-caption font-semibold text-ink-faint">%</span>
                          </span>
                        </Td>
                        <Td>
                          <span className="block truncate text-label text-ink-secondary" title={row.tagName ?? ''}>
                            {row.tagName ?? (row.name.trim() ? `[会員] ランク：${row.name.trim()}（保存すると作られます）` : '—')}
                          </span>
                        </Td>
                        <Td align="right" className="cq-hide-below-1010 w-20"><span className="text-label font-semibold tabular-nums text-ink">{formatNumber(row.memberCount)}人</span></Td>
                        <Td align="right" className="w-14">
                          {isBase || readonly ? null : row.id === null ? (
                            <button type="button" className={styles.removeRow} onClick={() => { setDrafts((current) => current.filter((_, i) => i !== index)); setDirty(true) }}>
                              行を外す
                            </button>
                          ) : (
                            <DeleteAction label={`${row.name.trim() || `ランク ${index + 1}`}を削除する`} onClick={() => { setRemoveTarget(index); setReplacement('') }} />
                          )}
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </DataTable>
            </div>
            <div className="mt-3">
              <button type="button" className={styles.addRow} onClick={add} disabled={readonly || drafts.length >= 8}>
                ＋ ランクを足す
              </button>
            </div>
          </section>
        </div>

        <section className={styles.card} data-design-node="vMRJs">
          <h2 className={styles.cardTitle}>ECとの同期</h2>
          <p className={styles.cardDesc}>保存すると、ランクをネットショップへ送り、友だち属性のタグも付け替えます</p>
          <div className={styles.syncRow}>
            {rules?.syncStatus === 'synced' ? <Chip tone="ok">同期済み</Chip> : rules?.syncStatus === 'failed' ? <Chip tone="danger">失敗</Chip> : <Chip tone="warn">未同期</Chip>}
            <span className="text-caption text-ink-secondary">
              {rules?.syncStatus === 'synced' && rules.syncedAt ? `最後に送った日時 ${formatJstDateTime(rules.syncedAt)}` : rules?.syncStatus === 'failed' ? rules.syncError ?? '理由は記録されていません' : 'まだECへ送っていません'}
            </span>
          </div>
          <div className="mt-3">
            <Button variant="secondary" onClick={() => void resync()} disabled={busy || dirty || readonly}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              もう一度同期
            </Button>
          </div>
        </section>
      </div>

      <StickyBar
        status={dirty ? '保存していない変更があります' : rules ? `版 ${rules.version}` : undefined}
        actions={(
          <>
            <Button variant="secondary" onClick={cancel} disabled={busy || !dirty}>キャンセル</Button>
            <Button variant="primary" onClick={() => (conflict ? setComparing(true) : void save())} disabled={busy || !dirty || readonly}>
              {conflict ? '比べてから保存' : '保存して EC へ同期'}
            </Button>
          </>
        )}
      />

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="ランク設定への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />

      {/* 削除の確認：会員がいるランクには移す先が必須（API 側の決まりと同じ）。 */}
      <ConfirmDialog
        open={removeTarget !== null && removeRow !== null && removeRow.id !== null}
        title={`「${removeRow?.name.trim() || `ランク ${(removeTarget ?? 0) + 1}`}」を削除しますか？`}
        description={
          removeRow && removeRow.memberCount > 0
            ? `このランクの会員 ${formatNumber(removeRow.memberCount)}人 は、選んだランクへ移ります。`
            : 'このランクは消えます。会員はいないので移す先は不要です。'
        }
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        destructive
        onConfirm={() => void removeRank()}
        onCancel={() => setRemoveTarget(null)}
      >
        {removeRow && removeRow.memberCount > 0 ? (
          <Select
            aria-label="会員の移す先"
            value={replacement}
            onChange={setReplacement}
            options={[
              { value: '', label: '移す先のランクを選ぶ' },
              ...removeCandidates.map((row) => ({ value: row.id ?? '', label: row.name.trim() || '（名前なし）' })),
            ]}
          />
        ) : null}
      </ConfirmDialog>

      {/* 違いを比べる：読み込んだ版と最新の版を並べて見せる。 */}
      <ConfirmDialog
        open={comparing && conflict !== null}
        title="ランク設定の違い"
        description="左が最新の保存、右がいまの下書きです。よければ、この内容で保存できます。"
        confirmLabel="この内容で保存する"
        cancelLabel="閉じる"
        onConfirm={() => void save(true)}
        onCancel={() => setComparing(false)}
      >
        {conflict ? (
          <div className={styles.diffGrid}>
            <div>
              <p className={styles.diffHead}>最新（{conflict.latest.rules ? formatJstDateTime(conflict.latest.rules.updatedAt) : '—'}）</p>
              <ul className={styles.diffList}>
                {conflict.latest.ranks.map((rank) => (
                  <li key={rank.id}>{rank.name} — {yen(rank.annualThresholdYen)}〜 / {rank.mileRatePercent}%</li>
                ))}
              </ul>
            </div>
            <div>
              <p className={styles.diffHead}>いまの下書き</p>
              <ul className={styles.diffList}>
                {drafts.map((row, index) => (
                  <li key={row.id ?? `draft-${index}`}>{row.name || '（名前なし）'} — {yen(Number(row.threshold.replace(/[,，]/g, '')) || 0)}〜 / {row.rate || '—'}%</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  )
}

function RuleBox({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.ruleBox}>
      <dt className={styles.ruleLabel}>{label}</dt>
      <dd className={styles.ruleValue}>{value}</dd>
    </div>
  )
}

/* ---------- ライフタイム（zQ5vY） ---------- */

type MilestoneDraft = { id: string | null; threshold: string; title: string; benefit: string | null; notify: boolean; reachedCount: number }

function LifetimeTabV8({
  accountId,
  status,
  settings,
  onSaved,
  onRetry,
  readonly,
}: {
  accountId: string
  status: LoadStatus
  settings: NenRankSettingsData | null
  onSaved: (forAccountId: string, next: NenRankSettingsData) => void
  onRetry: () => void
  readonly: boolean
}) {
  const [drafts, setDrafts] = useState<MilestoneDraft[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draftAccountId, setDraftAccountId] = useState(accountId)

  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })

  if (draftAccountId !== accountId) {
    const hadUnsaved = dirty
    setDraftAccountId(accountId)
    setDrafts([])
    setDirty(false)
    setError('')
    cancelLeave()
    setNotice(hadUnsaved ? 'LINEアカウントを切り替えたため、保存していない変更は破棄しました。' : '')
  }

  const fromSettings = (next: NenRankSettingsData): MilestoneDraft[] =>
    next.milestones.map((m) => ({ id: m.id, threshold: String(m.thresholdYen), title: m.title, benefit: m.benefitNote, notify: m.notifyOnReach, reachedCount: m.reachedCount }))

  useEffect(() => {
    if (!settings || dirty) return
    setDrafts(fromSettings(settings))
  }, [settings, dirty])

  const update = (index: number, patch: Partial<MilestoneDraft>) => {
    setDrafts((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    setDirty(true)
    setNotice('')
  }

  const save = async () => {
    if (draftAccountId !== accountId) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await nenRanksApi.saveMilestones(accountId, drafts.map((row) => ({
        id: row.id, thresholdYen: Number(row.threshold.replace(/[,，]/g, '')), title: row.title.trim(), notifyOnReach: row.notify,
      })))
      if (!res.success) throw new Error(res.error)
      setDirty(false)
      onSaved(accountId, res.data)
      setNotice(res.data.sync?.status === 'synced' ? '節目を保存し、ECへ同期しました。' : '節目を保存しました。ECへの同期は失敗したので、ランク設定の「もう一度同期」で送り直せます。')
    } catch (caught) {
      setError(describeApiFailure(caught, '節目の保存', {
        forbidden: '節目を保存する権限がありません。権限を確認してください。',
      }))
    } finally {
      setBusy(false)
    }
  }

  const noticeEl = notice ? <p className={styles.notice} role="status">{notice}</p> : null
  if (status === 'loading' && !settings) return <>{noticeEl}<ListState kind="loading" title="ライフタイムを読み込んでいます" /></>
  if (status === 'forbidden') {
    return (
      <NoPermissionV8
        featureName="ライフタイム"
        capabilitiesHref="/staff"
      />
    )
  }
  if (status === 'error') return <ListState kind="error" title="ライフタイムを読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={onRetry} />
  if (!settings) return <>{noticeEl}<ListState kind="loading" title="ライフタイムを読み込んでいます" /></>

  return (
    <>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.errorText} role="alert">{error}</p> : null}

      <section className={styles.card}>
        <div className={styles.lifetimeHead}>
          <div className={styles.headText}>
            <h2 className={styles.cardTitle}>節目（ライフタイム）</h2>
            <p className={styles.cardDesc}>ライフタイムはこれまでの購入額の累計で、減りません。LINE 連携済みの会員の累計です</p>
          </div>
          <div className={styles.lifetimeTotal}>
            <span className={styles.ruleLabel}>ライフタイム 合計</span>
            <span className={styles.lifetimeTotalValue}>{yen(settings.kpis.lifetimeTotalYen)}</span>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <DataTable className="@container">
            <thead>
              <TableHeadRow>
                <Th className="w-44">節目（累計）</Th>
                <Th className="w-48">称号</Th>
                <Th>特典</Th>
                <Th className="cq-hide-below-1010 w-24" align="right">到達した人</Th>
                <Th className="w-40">到達時の LINE 通知</Th>
                <Th className="w-14" align="right"><span className="sr-only">削除</span></Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {drafts.map((row, index) => (
                <Tr key={row.id ?? `new-${index}`}>
                  <Td className="w-44">
                    <span className="flex items-center gap-2">
                      <TextField aria-label={`節目 ${index + 1}`} inputMode="numeric" value={row.threshold} disabled={readonly} onChange={(event) => update(index, { threshold: event.target.value })} />
                      <span className="shrink-0 text-caption font-semibold text-ink-faint">円</span>
                    </span>
                  </Td>
                  <Td className="w-48"><TextField aria-label={`称号 ${index + 1}`} value={row.title} maxLength={30} disabled={readonly} onChange={(event) => update(index, { title: event.target.value })} /></Td>
                  <Td>
                    <span className="flex min-w-0 items-center gap-2.5">
                      {row.benefit ? (
                        <span className="min-w-0 truncate text-label text-ink" title={row.benefit}>{row.benefit}</span>
                      ) : (
                        <>
                          <Chip tone="neutral" className="shrink-0">未設定</Chip>
                          <span className="min-w-0 truncate text-label text-ink-faint" title="限定グッズは決まり次第ここで設定します">限定グッズは決まり次第ここで設定します</span>
                        </>
                      )}
                    </span>
                  </Td>
                  <Td align="right" className="cq-hide-below-1010 w-24"><span className="text-label font-semibold tabular-nums text-ink">{formatNumber(row.reachedCount)}人</span></Td>
                  <Td className="w-40">
                    {readonly ? (
                      /* 閲覧のみ：押せない文字で出す。locked は「オン固定」なので実際の値を見せられない */
                      <span className="text-label text-ink-secondary">{row.notify ? '通知する' : '通知しない'}</span>
                    ) : (
                      <Toggle checked={row.notify} onChange={(checked) => update(index, { notify: checked })} label={row.notify ? '通知する' : '通知しない'} />
                    )}
                  </Td>
                  <Td align="right" className="w-14">
                    {readonly ? null : (
                      <DeleteAction label={`${row.title || 'この節目'}を削除する`} onClick={() => { setDrafts((current) => current.filter((_, i) => i !== index)); setDirty(true) }} />
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </div>
        <div className="mt-3">
          <button
            type="button"
            className={styles.addRow}
            disabled={readonly || drafts.length >= 12}
            onClick={() => { setDrafts((current) => [...current, { id: null, threshold: '', title: '', benefit: null, notify: true, reachedCount: 0 }]); setDirty(true) }}
          >
            ＋ 節目を足す
          </button>
        </div>
      </section>

      <StickyBar
        status={dirty ? '保存していない変更があります' : undefined}
        actions={(
          <>
            <Button variant="secondary" onClick={() => { setDirty(false); setError(''); if (settings) setDrafts(fromSettings(settings)) }} disabled={busy || !dirty}>キャンセル</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty || readonly}>保存して EC へ同期する</Button>
          </>
        )}
      />

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="節目への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}
