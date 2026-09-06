'use client'

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import KpiCard from '@/components/dashboard/kpi-card'
import { api, type AffiliateOffer, type AffiliatePaymentSummary, type ConversionApprovalItem } from '@/lib/api'
import type { Tag, Scenario, LineAccount } from '@line-crm/shared'
import { TableHeadRow, Th } from '@/components/shared/table'
import Button from '@/components/shared/button'
import type { ButtonProps } from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { calculateAffiliateReward } from './affiliate-reward'
import {
  confirmedDetail,
  confirmedThisMonth,
  confirmedTotals,
  confirmedUnit,
  confirmedValue,
  type ConfirmedState,
} from './offer-kpi'
import {
  CLICK_SUMMARY_LABEL,
  DUPLICATE_FLAG_TITLE,
  LINK_CODE_HEADING,
  duplicateFlagHeading,
  duplicateFriendNameText,
  personNameText,
} from './affiliate-display'
import {
  OFFER_FILTERS,
  OFFER_PAGE_SIZES,
  OFFER_SORTS,
  offersCsv,
  pageCountOf,
  pageOf,
  selectOffers,
  type OfferFilter,
  type OfferSort,
} from './offer-list-view'

const WORKER_BASE = process.env.NEXT_PUBLIC_API_URL
if (!WORKER_BASE) {
  throw new Error('NEXT_PUBLIC_API_URL is not set. Build cannot proceed.')
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AffiliateItem {
  id: string
  name: string
  code: string
  commissionRate: number
  isActive: boolean
  createdAt: string
  friendId: string | null
  email?: string | null
  holdDays?: number | null
  payoutCycle?: string | null
  notifyOnConversion?: boolean
}

interface AffiliateReportRow {
  affiliateId: string
  affiliateName: string
  code: string
  commissionRate: number
  totalClicks: number
  totalConversions: number
  totalRevenue: number
  confirmedReward: number
  linkCount: number
  friendAdds: number
}

/** Merged for the list view */
interface AffiliateListRow extends AffiliateItem {
  totalClicks: number
  totalConversions: number
  totalRevenue: number
  rewardAmount: number
  linkCount: number
  friendAdds: number
}

interface AffiliateLink {
  id: string
  affiliate_id: string
  ref_code: string
  label: string | null
  line_account_id: string | null
  is_active: number
  created_at: string
  click_count: number
  offer_id: string | null
  offer_name: string | null
}

interface ReportV2 {
  affiliateId: string
  affiliateName: string
  code: string
  commissionRate: number
  clicks: number
  linkClicks: number
  friendAdds: number
  conversions: number
  conversionsPending: number
  conversionsApproved: number
  conversionsRejected: number
  conversionsByPoint: Array<{ conversionPointId: string; name: string; count: number; value: number }>
  revenue: number
  estimatedCommission: number
  confirmedReward: number
  byOffer: Array<{
    offerId: string
    offerName: string
    rewardAmount: number
    conversionsApproved: number
    conversionsPending: number
    confirmedReward: number
  }>
  duplicateFlags: Array<{ friendId: string; identityKey: string }>
}

/*
  集計の返事が、数として読める形かを確かめる。

  **`as unknown as ReportV2` は嘘をつく。** 集計は期間で絞れるので、
  その期間に成果が1件も無い紹介者は**行そのものが返らない**。
  一覧には載っているので押せてしまい、`report.clicks.toLocaleString()` で
  **内訳の面ごと落ちていた。**（`Cannot read properties of undefined`）

  0件と「この期間に記録が無い」を混ぜないため、読めないときは `null` にして
  呼ぶ側で理由を出す。**0で埋めない。**
*/
function asReportV2(raw: unknown): ReportV2 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Partial<ReportV2>
  const numbers: Array<number | undefined> = [
    value.clicks, value.friendAdds, value.conversions,
    value.conversionsApproved, value.conversionsPending, value.conversionsRejected,
    value.confirmedReward,
  ]
  if (numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null
  if (!Array.isArray(value.byOffer) || !Array.isArray(value.conversionsByPoint)) return null
  return value as ReportV2
}


interface JourneySummary {
  friendId: string
  displayName: string | null
  addedAt: string
  refCode: string | null
  touchCount: number
  formCount: number
  conversionCount: number
  lastEventAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function formatYen(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

const JOURNEY_PAGE_SIZE = 30

/** 機能16内の操作を共通Buttonへ一本でつなぐ。 */
function AffiliateButton(props: ButtonProps) {
  if (props.variant === 'primary') return <Button {...props} variant="primary" />
  return <Button {...props} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Page shell — 3 tabs (affiliators / offers / approvals) with ?tab= persistence
// ─────────────────────────────────────────────────────────────────────────────

export type PageTab = 'affiliates' | 'offers' | 'approvals'

export const TAB_LABELS: Record<PageTab, string> = {
  affiliates: 'アフィリエイター',
  offers: '案件',
  approvals: '成果承認',
}

export function parseTab(raw: string | null): PageTab {
  return raw === 'offers' || raw === 'approvals' ? raw : 'affiliates'
}

// ─────────────────────────────────────────────────────────────────────────────
// Affiliators tab — list + inline detail panel
// ─────────────────────────────────────────────────────────────────────────────

export function AffiliatorsTab({ accountId }: { accountId: string | null }) {
  // ── list ───────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<AffiliateListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approvalItems, setApprovalItems] = useState<ConversionApprovalItem[]>([])
  const [approvalState, setApprovalState] = useState<ConfirmedState>('loading')
  const [paymentItems, setPaymentItems] = useState<AffiliatePaymentSummary[]>([])
  const [paymentState, setPaymentState] = useState<ConfirmedState>('loading')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Array<'active' | 'inactive' | 'reward'>>([])
  const [sort, setSort] = useState<'newest' | 'name' | 'reward'>('newest')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  // ── selected affiliate (detail panel) ─────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [report, setReport] = useState<ReportV2 | null>(null)
  const [links, setLinks] = useState<AffiliateLink[]>([])

  // ── create modal ────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false)

  // ── journeys (cursor-paginated) ────────────────────────────────────────────
  const [journeys, setJourneys] = useState<JourneySummary[]>([])
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [journeyMore, setJourneyMore] = useState(false)
  const [journeyLoadingMore, setJourneyLoadingMore] = useState(false)
  const journeyCursorRef = useRef<{ beforeAt: string; beforeId: string } | null>(null)

  // ── load list ──────────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [affiliatesRes, reportRes] = await Promise.all([
        api.affiliates.list(),
        api.affiliates.allReport(),
      ])
      if (!affiliatesRes.success) throw new Error('affiliates fetch failed')
      if (!reportRes.success) throw new Error('report fetch failed')

      const affiliates = affiliatesRes.data as unknown as AffiliateItem[]
      const reportMap = new Map<string, AffiliateReportRow>()
      for (const r of (reportRes.data as unknown as AffiliateReportRow[])) {
        reportMap.set(r.affiliateId, r)
      }

      const merged: AffiliateListRow[] = affiliates.map((a) => {
        const rep = reportMap.get(a.id)
        return {
          ...a,
          totalClicks: rep?.totalClicks ?? 0,
          totalConversions: rep?.totalConversions ?? 0,
          totalRevenue: rep?.totalRevenue ?? 0,
          rewardAmount: calculateAffiliateReward({
            commissionRate: a.commissionRate,
            totalRevenue: rep?.totalRevenue ?? 0,
            confirmedFixedReward: rep?.confirmedReward ?? 0,
          }),
          linkCount: rep?.linkCount ?? 0,
          friendAdds: rep?.friendAdds ?? 0,
        }
      })
      setRows(merged)
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みエラー')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadList() }, [loadList])

  useEffect(() => {
    let cancelled = false
    setApprovalState('loading')
    void Promise.all([
      api.conversionApprovals.list({ status: 'pending', limit: 200 }),
      api.conversionApprovals.list({ status: 'approved', limit: 200 }),
    ]).then(([pending, approved]) => {
      if (cancelled) return
      if (!pending.success || !approved.success) {
        setApprovalState('error')
        return
      }
      setApprovalItems([...pending.data, ...approved.data])
      setApprovalState('ready')
    }).catch(() => {
      if (!cancelled) setApprovalState('error')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!accountId) {
      setPaymentItems([])
      setPaymentState('error')
      return () => { cancelled = true }
    }
    setPaymentState('loading')
    void api.affiliates.paymentSummaries(accountId).then((result) => {
      if (cancelled) return
      if (!result.success || !Array.isArray(result.data)) {
        setPaymentState('error')
        return
      }
      setPaymentItems(result.data)
      setPaymentState('ready')
    }).catch(() => {
      if (!cancelled) setPaymentState('error')
    })
    return () => { cancelled = true }
  }, [accountId])

  // ── load detail (report v2 + links) ────────────────────────────────────────
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setReport(null)
    setLinks([])
    setJourneys([])
    setJourneyMore(false)
    journeyCursorRef.current = null
    try {
      const [reportRes, linksRes] = await Promise.all([
        api.affiliates.reportV2(id),
        api.affiliates.links(id),
      ])
      /* **形を確かめてから入れる。** 読めない返事を入れると、描くときに落ちる。 */
      setReport(reportRes.success ? asReportV2(reportRes.data) : null)
      if (linksRes.success) setLinks(linksRes.data as unknown as AffiliateLink[])
    } catch { /* silent — detail is optional */ }
    setDetailLoading(false)
  }, [])

  // ── load first page of journeys ────────────────────────────────────────────
  const loadJourneys = useCallback(async (id: string) => {
    setJourneyLoading(true)
    try {
      const res = await api.affiliates.journeys(id, { limit: JOURNEY_PAGE_SIZE })
      if (res.success) {
        setJourneys(res.data)
        journeyCursorRef.current = res.nextCursor ?? null
        setJourneyMore(Boolean(res.nextCursor))
      }
    } catch { /* silent */ }
    setJourneyLoading(false)
  }, [])

  // ── load more journeys ─────────────────────────────────────────────────────
  const loadMoreJourneys = useCallback(async (id: string) => {
    if (journeyLoadingMore) return
    const cursor = journeyCursorRef.current
    if (!cursor) { setJourneyMore(false); return }
    setJourneyLoadingMore(true)
    try {
      const res = await api.affiliates.journeys(id, {
        limit: JOURNEY_PAGE_SIZE,
        beforeAt: cursor.beforeAt,
        beforeId: cursor.beforeId,
      })
      if (res.success) {
        setJourneys((prev) => {
          const seen = new Set(prev.map((j) => j.friendId))
          return [...prev, ...res.data.filter((j) => !seen.has(j.friendId))]
        })
        journeyCursorRef.current = res.nextCursor ?? null
        setJourneyMore(Boolean(res.nextCursor))
      }
    } catch { /* silent */ }
    setJourneyLoadingMore(false)
  }, [journeyLoadingMore])

  // ── row click ──────────────────────────────────────────────────────────────
  const handleRowClick = useCallback((id: string) => {
    if (selectedId === id) {
      setSelectedId(null)
      return
    }
    setSelectedId(id)
    void loadDetail(id)
    void loadJourneys(id)
  }, [selectedId, loadDetail, loadJourneys])

  const shownRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    return rows
      .filter((row) => {
        if (needle && !`${row.name} ${row.code}`.toLocaleLowerCase('ja-JP').includes(needle)) {
          return false
        }
        if (filters.length === 0) return true
        return filters.some((filter) => {
          if (filter === 'active') return row.isActive
          if (filter === 'inactive') return !row.isActive
          return row.rewardAmount > 0
        })
      })
      .toSorted((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name, 'ja-JP')
        if (sort === 'reward') return b.rewardAmount - a.rewardAmount
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
  }, [filters, query, rows, sort])

  const listPageCount = pageCountOf(shownRows.length, pageSize)
  const currentPage = Math.min(page, listPageCount)
  const pagedRows = pageOf(shownRows, currentPage, pageSize)
  const approvedThisMonth = confirmedThisMonth(approvalItems)
  const approvedTotals = confirmedTotals(approvedThisMonth)
  const pendingItems = approvalItems.filter((item) => item.approvalStatus === 'pending')
  const pendingYen = pendingItems.reduce((sum, item) => sum + (item.value ?? 0), 0)
  const paymentTotal = paymentItems.reduce((sum, item) => sum + item.approvedReward, 0)
  const heldTotal = paymentItems.reduce((sum, item) => sum + item.heldReward, 0)
  const payoutCycle = paymentItems.find((item) => item.payoutCycle?.trim())?.payoutCycle ?? null
  const funnel = {
    clicks: rows.reduce((sum, row) => sum + row.totalClicks, 0),
    friends: rows.reduce((sum, row) => sum + row.friendAdds, 0),
    conversions: rows.reduce((sum, row) => sum + row.totalConversions, 0),
    approved: approvedThisMonth.length,
  }

  const exportAffiliatesCsv = () => {
    const header = ['名前', '紹介コード', '紹介リンク数', '友だち追加', '成果', '承認済み報酬']
    const cells = shownRows.map((row) => [
      row.name,
      row.code,
      row.linkCount,
      row.friendAdds,
      row.totalConversions,
      Math.round(row.rewardAmount),
    ])
    const escape = (value: string | number) => {
      const text = String(value)
      return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
    }
    const csv = [header, ...cells].map((line) => line.map(escape).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `affiliates-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div data-design-node="PouPn" data-affiliate-design="v6">
      <NoteBar>
        紹介リンクを渡した人ごとに、クリックから成果までの流れと確定した報酬を確認できます。
      </NoteBar>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="今月の成果"
          value={confirmedValue(approvalState, approvedTotals.count)}
          unit={confirmedUnit(approvalState, '件')}
          detail={confirmedDetail(approvalState, '今月に承認した成果')}
          loading={approvalState === 'loading'}
        />
        <KpiCard
          title="承認待ち"
          value={confirmedValue(approvalState, pendingItems.length)}
          unit={confirmedUnit(approvalState, '件')}
          detail={confirmedDetail(approvalState, `合計 ${formatYen(pendingYen)}（直近最大200件）`)}
          loading={approvalState === 'loading'}
        />
        <KpiCard
          title="確定した報酬"
          value={confirmedValue(paymentState, paymentTotal)}
          unit={confirmedUnit(paymentState, '円')}
          detail={confirmedDetail(paymentState, payoutCycle ? `${payoutCycle}・支払日は未接続` : '締め日・支払日は未接続')}
          loading={paymentState === 'loading'}
        />
        <KpiCard
          title="未払い残高"
          value={null}
          unit=""
          detail="支払済み台帳が接続されると表示されます"
          loading={paymentState === 'loading'}
        />
      </div>

      <section className="bg-canvas rounded-card border-hairline mb-4 border p-4" aria-label="今月の成果の流れ">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-ink text-sm font-semibold">今月の成果の流れ</h3>
          <span className="text-ink-faint text-xs">どこで人が減っているかを1本で見る</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {[
            ['クリック', funnel.clicks],
            ['友だち追加', funnel.friends],
            ['成果', funnel.conversions],
            ['認めた・承認', funnel.approved],
          ].map(([label, value]) => (
            <div key={label} className="bg-canvas-sunken rounded-control px-3 py-2">
              <p className="text-ink-faint text-xs">{label}</p>
              <p className="text-ink mt-1 text-lg font-semibold tabular-nums">
                {Number(value).toLocaleString('ja-JP')}件
              </p>
            </div>
          ))}
          <div className="bg-accent-soft rounded-control px-3 py-2">
            <p className="text-ink-faint text-xs">報酬</p>
            <p className="text-ink mt-1 text-lg font-semibold tabular-nums">{formatYen(paymentTotal)}</p>
            <p className="text-ink-faint mt-0.5 text-[11px]">保留中 {formatYen(heldTotal)} を含む</p>
          </div>
        </div>
      </section>

      <div className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3">
        <SearchField
          placeholder="名前・紹介コードで検索"
          aria-label="名前・紹介コードで検索"
          value={query}
          onChange={(value) => { setQuery(value); setPage(1) }}
          onClear={() => { setQuery(''); setPage(1) }}
          className="w-full md:max-w-md"
        />
        <span className="text-ink-faint whitespace-nowrap text-xs">並び順</span>
        <Select
          aria-label="紹介者の並び順"
          value={sort}
          options={[
            { value: 'newest', label: '登録が新しい順' },
            { value: 'name', label: '名前順' },
            { value: 'reward', label: '報酬が多い順' },
          ]}
          onChange={(value) => { setSort(value as typeof sort); setPage(1) }}
        />
        <span className="text-ink-faint whitespace-nowrap text-xs">表示</span>
        <Select
          aria-label="紹介者の表示件数"
          value={String(pageSize)}
          options={[20, 50, 100].map((n) => ({ value: String(n), label: `${n}件表示` }))}
          onChange={(value) => { setPageSize(Number(value)); setPage(1) }}
          size="page-size"
        />
        <AffiliateButton onClick={exportAffiliatesCsv} disabled={shownRows.length === 0} className="ml-auto">
          CSVで書き出す
        </AffiliateButton>
        <AffiliateButton variant="primary" onClick={() => setCreateOpen(true)}>
          アフィリエイターを追加
        </AffiliateButton>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([
          ['active', '計測中'],
          ['inactive', '停止中'],
          ['reward', '報酬あり'],
        ] as const).map(([filter, label]) => (
          <FilterChip
            key={filter}
            selected={filters.includes(filter)}
            onChange={(selected) => {
              setFilters((current) => selected
                ? [...current, filter]
                : current.filter((value) => value !== filter))
              setPage(1)
            }}
          >
            {label}
          </FilterChip>
        ))}
      </div>

      {createOpen && (
        <CreateAffiliateModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => { void loadList() }}
        />
      )}

      {error ? (
        <ListState
          kind="error"
          title="紹介者を表示できませんでした"
          description="再読み込みしても直らない場合は、エラー報告へ連絡してください。"
          onRetry={() => void loadList()}
        />
      ) : loading ? (
        <ListState kind="loading" title="紹介者を読み込んでいます" />
      ) : rows.length === 0 ? (
        <ListState
          kind="empty"
          title="紹介者はまだ登録されていません"
          description="紹介してくれる方を登録すると、専用リンクと成果を管理できます。"
          action={<Button variant="primary" onClick={() => setCreateOpen(true)}>アフィリエイターを追加</Button>}
        />
      ) : shownRows.length === 0 ? (
        <ListState
          kind="empty"
          title="絞り込みに合う紹介者がいません"
          description="検索語を変えるか、絞り込みの札を外すと表示されます。"
        />
      ) : (
        <div className="bg-canvas rounded-card border-hairline overflow-x-auto border">
          <table className="w-full min-w-[720px]">
            <thead>
              <TableHeadRow>
                <Th>アフィリエイター</Th>
                <Th align="right">紹介リンク</Th>
                <Th align="right">友だち追加</Th>
                <Th align="right">成果</Th>
                <Th align="right">報酬</Th>
                <Th align="center">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {pagedRows.map((row) => {
                const isExpanded = selectedId === row.id
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`cursor-pointer transition-colors ${isExpanded ? 'bg-canvas-sunken' : 'hover:bg-canvas-sunken'}`}
                      onClick={() => handleRowClick(row.id)}
                    >
                      <td className="text-ink px-4 py-3 text-sm font-medium">
                        <span className="block truncate" title={row.name}>{row.name}</span>
                        <span className="text-action mt-0.5 block font-mono text-xs">{row.code}</span>
                      </td>
                      <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                        {row.linkCount.toLocaleString()}本
                      </td>
                      <td className="text-action px-4 py-3 text-right text-sm font-semibold tabular-nums">
                        {row.friendAdds.toLocaleString()}人
                      </td>
                      <td className="text-ink px-4 py-3 text-right text-sm font-semibold tabular-nums">
                        {row.totalConversions.toLocaleString()}件
                      </td>
                      <td className="text-ink px-4 py-3 text-right text-sm font-semibold tabular-nums">
                        {formatYen(row.rewardAmount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-action text-xs font-medium">{isExpanded ? '閉じる' : '成果を見る'}</span>
                        <span className="text-ink-faint ml-2 text-xs">{row.isActive ? '計測中' : '停止中'}</span>
                      </td>
                    </tr>

                    {/* Detail expansion row */}
                    {isExpanded && (
                      <tr key={`${row.id}-detail`}>
                        <td colSpan={6} className="bg-canvas-sunken border-hairline border-t px-6 py-5">
                          {detailLoading ? (
                            <p className="text-sm text-gray-400">読み込み中...</p>
                          ) : (
                            <div className="space-y-6">

                              {/* 支払いの取り決め。報酬額そのものは案件側で持つが、
                                  連絡先と支払い条件は人に紐づく。 */}
                              <SettlementEditor
                                affiliate={row}
                                onSaved={() => {
                                  void loadList()
                                }}
                              />

                              {/*
                                **読めなかったことを、0件として描かない。**
                                集計は期間で絞れるので、その期間に成果が無い人は
                                行そのものが返らない。数を作らずに理由を出す。
                              */}
                              {!detailLoading && !report && (
                                <div className="rounded-card border-hairline bg-canvas border p-4">
                                  <p className="text-ink text-sm font-bold">この期間の集計を取得できませんでした</p>
                                  <p className="text-ink-secondary mt-1 text-xs leading-5">
                                    選んだ期間にこの方の成果が1件も無いか、集計が読めませんでした。
                                    リンクと成果の記録は消えていません。期間を広げて確かめてください。
                                  </p>
                                </div>
                              )}

                              {/* v2 summary cards */}
                              {report && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                  <div className="bg-white rounded-lg p-4 border border-gray-100">
                                    <p className="text-xs text-gray-500">{CLICK_SUMMARY_LABEL}</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{report.clicks.toLocaleString()}</p>
                                  </div>
                                  <div className="bg-white rounded-lg p-4 border border-gray-100">
                                    <p className="text-xs text-gray-500">友だち追加</p>
                                    <p className="text-2xl font-bold text-blue-600 mt-1">{report.friendAdds.toLocaleString()}</p>
                                  </div>
                                  <div className="bg-white rounded-lg p-4 border border-gray-100">
                                    <p className="text-xs text-gray-500">CV 件数（却下除く）</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{report.conversions.toLocaleString()}</p>
                                  </div>
                                  <div className="bg-white rounded-lg p-4 border border-emerald-100 bg-emerald-50/40">
                                    <p className="text-xs text-gray-500">確定報酬</p>
                                    <p className="text-2xl font-bold text-emerald-600 mt-1">{formatYen(report.confirmedReward)}</p>
                                    <p className="text-[11px] text-gray-500 mt-1">
                                      承認済み {report.conversionsApproved.toLocaleString()}件 / 審査中 {report.conversionsPending.toLocaleString()}件 / 却下 {report.conversionsRejected.toLocaleString()}件
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* Per-offer breakdown */}
                              {report && report.byOffer.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">案件別内訳</p>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-[560px] text-sm">
                                      <thead>
                                        <tr className="text-left text-xs text-gray-400">
                                          <th className="pb-1 pr-4">案件</th>
                                          <th className="pb-1 pr-4 text-right">報酬単価</th>
                                          <th className="pb-1 pr-4 text-right">承認済み</th>
                                          <th className="pb-1 pr-4 text-right">審査中</th>
                                          <th className="pb-1 text-right">確定報酬</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {report.byOffer.map((o) => (
                                          <tr key={o.offerId}>
                                            <td className="py-1 pr-4 text-gray-700">{o.offerName}</td>
                                            <td className="py-1 pr-4 text-right text-gray-500">{formatYen(o.rewardAmount)}</td>
                                            <td className="py-1 pr-4 text-right font-semibold text-gray-900">{o.conversionsApproved.toLocaleString()}</td>
                                            <td className="py-1 pr-4 text-right text-gray-500">{o.conversionsPending.toLocaleString()}</td>
                                            <td className="py-1 text-right font-semibold text-emerald-600">{formatYen(o.confirmedReward)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* Duplicate flags */}
                              {report && report.duplicateFlags.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-amber-700 uppercase mb-2">
                                    {duplicateFlagHeading(report.duplicateFlags.length)}
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {report.duplicateFlags.map((f) => (
                                      <span
                                        key={f.friendId}
                                        className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800"
                                      >
                                        ⚠ {duplicateFriendNameText(f.friendId, journeys)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* CV by point */}
                              {report && report.conversionsByPoint.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">CV ポイント別内訳</p>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-[400px] text-sm">
                                      <thead>
                                        <tr className="text-left text-xs text-gray-400">
                                          <th className="pb-1 pr-4">ポイント名</th>
                                          <th className="pb-1 pr-4 text-right">件数</th>
                                          <th className="pb-1 text-right">売上合計</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {report.conversionsByPoint.map((p) => (
                                          <tr key={p.conversionPointId}>
                                            <td className="py-1 pr-4 text-gray-700">{p.name}</td>
                                            <td className="py-1 pr-4 text-right font-semibold text-gray-900">{p.count}</td>
                                            <td className="py-1 text-right text-gray-700">{formatYen(p.value)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* Links table */}
                              {links.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                                    リンク別クリック ({links.length} 本)
                                  </p>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-[560px] text-sm">
                                      <thead>
                                        <tr className="text-left text-xs text-gray-400">
                                          <th className="pb-1 pr-4">{LINK_CODE_HEADING}</th>
                                          <th className="pb-1 pr-4">ラベル</th>
                                          <th className="pb-1 pr-4">案件</th>
                                          <th className="pb-1 pr-4 text-right">クリック</th>
                                          <th className="pb-1">状態</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {links.map((link) => (
                                          <tr key={link.id}>
                                            <td className="py-1 pr-4 font-mono text-blue-600">{link.ref_code}</td>
                                            <td className="py-1 pr-4 text-gray-600">{link.label ?? '—'}</td>
                                            <td className="py-1 pr-4">
                                              {link.offer_name ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                                  {link.offer_name}
                                                </span>
                                              ) : <span className="text-gray-400">—</span>}
                                            </td>
                                            <td className="py-1 pr-4 text-right font-semibold text-gray-900">{link.click_count.toLocaleString()}</td>
                                            <td className="py-1">
                                              {link.is_active
                                                ? <span className="text-xs text-green-600">有効</span>
                                                : <span className="text-xs text-gray-400">無効</span>
                                              }
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* Journeys */}
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                                  帰属ジャーニー ({journeys.length} 件{journeyMore ? '+' : ''})
                                </p>
                                {journeyLoading ? (
                                  <p className="text-sm text-gray-400">読み込み中...</p>
                                ) : journeys.length === 0 ? (
                                  <p className="text-sm text-gray-400">帰属された友だちがまだいません</p>
                                ) : (
                                  <>
                                    <div className="overflow-x-auto">
                                      <table className="min-w-[640px] text-sm">
                                        <thead>
                                          <tr className="text-left text-xs text-gray-400">
                                            <th className="pb-1 pr-4">友だち</th>
                                            <th className="pb-1 pr-4">追加日</th>
                                            <th className="pb-1 pr-4">{LINK_CODE_HEADING}</th>
                                            <th className="pb-1 pr-4 text-right">タッチ</th>
                                            <th className="pb-1 pr-4 text-right">フォーム</th>
                                            <th className="pb-1 pr-4 text-right">CV</th>
                                            <th className="pb-1">最終行動</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                          {journeys.map((j) => {
                                            const isDup = report?.duplicateFlags.some((f) => f.friendId === j.friendId)
                                            return (
                                              <tr key={j.friendId} className={isDup ? 'bg-amber-50' : ''}>
                                                <td className={`py-1 pr-4 ${j.displayName ? 'text-gray-800' : 'text-gray-400 italic'}`}>
                                                  {isDup && <span className="mr-1">⚠</span>}
                                                  {personNameText(j.displayName)}
                                                </td>
                                                <td className="py-1 pr-4 text-gray-500">{formatDate(j.addedAt)}</td>
                                                <td className="py-1 pr-4 font-mono text-xs text-blue-500">{j.refCode ?? '—'}</td>
                                                <td className="py-1 pr-4 text-right text-gray-700">{j.touchCount}</td>
                                                <td className="py-1 pr-4 text-right text-gray-700">{j.formCount}</td>
                                                <td className="py-1 pr-4 text-right font-semibold text-gray-900">{j.conversionCount}</td>
                                                <td className="py-1 text-gray-400 text-xs">{formatDate(j.lastEventAt)}</td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                    {journeyMore && (
                                      <button
                                        onClick={() => { void loadMoreJourneys(row.id) }}
                                        disabled={journeyLoadingMore}
                                        className="mt-3 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100 disabled:opacity-50 rounded-md border border-blue-200"
                                      >
                                        {journeyLoadingMore ? '読み込み中...' : 'さらに読み込む'}
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>

                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-ink-faint text-xs font-semibold tabular-nums">
            {shownRows.length === rows.length
              ? `全 ${rows.length}件`
              : `${shownRows.length}件 / 全 ${rows.length}件`}
          </p>
          <Pagination page={currentPage} pageCount={listPageCount} onPageChange={setPage} />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Create modal — friend-bound affiliate with an auto-generated (random) code
// ─────────────────────────────────────────────────────────────────────────────

interface FriendOption {
  id: string
  displayName: string | null
}

function CreateAffiliateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<FriendOption[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<FriendOption | null>(null)
  const [commissionRate, setCommissionRate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Incremental friend search (debounced). Skipped once a friend is selected.
  useEffect(() => {
    if (selected) return
    const term = search.trim()
    if (!term) { setOptions([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await api.friends.list({ search: term, limit: 20, includeTags: false })
        if (cancelled) return
        if (res.success) {
          setOptions(
            res.data.items.map((f) => ({ id: f.id, displayName: f.displayName })),
          )
        }
      } catch { /* silent */ }
      finally { if (!cancelled) setSearching(false) }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search, selected])

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    setFormError(null)
    if (!selected) {
      setFormError('友だちを選択してください')
      return
    }
    const rate = commissionRate.trim() === '' ? undefined : Number(commissionRate)
    if (rate !== undefined && (Number.isNaN(rate) || rate < 0)) {
      setFormError('報酬率は0以上の数値で入力してください')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.affiliates.create({
        friendId: selected.id,
        commissionRate: rate,
      })
      if (!res.success) {
        // 409 → friend already an affiliate; surface the server message.
        setFormError(res.error ?? '作成に失敗しました')
        setSubmitting(false)
        return
      }
      onCreated()
      if (res.link?.url) {
        setIssuedUrl(res.link.url)
      } else {
        onClose()
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, selected, commissionRate, onCreated, onClose])

  const handleCopy = useCallback(async () => {
    if (!issuedUrl) return
    try {
      await navigator.clipboard.writeText(issuedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable — user can select manually */ }
  }, [issuedUrl])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-lg shadow-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          アフィリエイター新規作成
        </h2>

        {issuedUrl ? (
          // ── Success state: show issued link with a copy button ────────────
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              アフィリエイターを作成し、初期リンクを発行しました。
            </p>
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={issuedUrl}
                className="flex-1 px-3 py-2 text-sm font-mono border border-gray-300 rounded-md bg-gray-50 text-gray-800"
              />
              <button
                onClick={() => { void handleCopy() }}
                className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md whitespace-nowrap"
              >
                {copied ? 'コピー済' : 'コピー'}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
              >
                閉じる
              </button>
            </div>
          </div>
        ) : (
          // ── Form state ────────────────────────────────────────────────────
          <div className="space-y-4">
            {/* Friend selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                LINE 友だち <span className="text-red-500">*</span>
              </label>
              {selected ? (
                <div className="flex items-center justify-between px-3 py-2 border border-gray-300 rounded-md bg-gray-50">
                  <span className="text-sm text-gray-800">
                    {selected.displayName ?? <span className="text-gray-400 italic">不明</span>}
                  </span>
                  <button
                    onClick={() => { setSelected(null); setSearch('') }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    変更
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="名前で検索..."
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  {(searching || options.length > 0) && search.trim() && (
                    <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
                      {searching ? (
                        <div className="px-3 py-2 text-sm text-gray-400">検索中...</div>
                      ) : options.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-400">該当なし</div>
                      ) : (
                        options.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => { setSelected(f); setOptions([]) }}
                            className="block w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-blue-50"
                          >
                            {f.displayName ?? <span className="text-gray-400 italic">不明</span>}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Commission rate */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                報酬率（%・省略可）
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(e.target.value)}
                  placeholder="例: 10"
                  className="w-full px-3 py-2 pr-8 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
              </div>
            </div>

            {/* Random-code notice */}
            <p className="text-xs text-gray-500">
              アフィリコードは推測されないよう自動でランダム生成されます（手入力は不要）。
            </p>

            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
              >
                キャンセル
              </button>
              <button
                onClick={() => { void handleSubmit() }}
                disabled={submitting || !selected}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md"
              >
                {submitting ? '作成中...' : '作成'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Offers / approvals — moved from the former /affiliate-offers page
// ─────────────────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatYenNullable(n: number | null): string {
  if (n === null) return '—'
  return `¥${Math.round(n).toLocaleString('ja-JP')}`
}

// ── Offer form modal ─────────────────────────────────────────────────────────

interface OfferFormProps {
  initial?: AffiliateOffer | null
  accounts: LineAccount[]
  tags: Tag[]
  scenarios: (Scenario & { stepCount?: number })[]
  onClose: () => void
  onSaved: () => void
}

function OfferFormModal({ initial, accounts, tags, scenarios, onClose, onSaved }: OfferFormProps) {
  const isEdit = Boolean(initial)
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [rewardAmount, setRewardAmount] = useState(
    initial?.rewardAmount != null ? String(initial.rewardAmount) : '',
  )
  const [rewardMiles, setRewardMiles] = useState(
    initial?.rewardMiles != null ? String(initial.rewardMiles) : '',
  )
  const [lineAccountId, setLineAccountId] = useState(initial?.lineAccountId ?? '')
  const [tagId, setTagId] = useState(initial?.tagId ?? '')
  const [scenarioId, setScenarioId] = useState(initial?.scenarioId ?? '')
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    setFormError(null)
    if (!name.trim()) {
      setFormError('案件名は必須です')
      return
    }
    const reward =
      rewardAmount.trim() === ''
        ? undefined
        : Number(rewardAmount)
    if (reward !== undefined && (!Number.isInteger(reward) || reward < 0)) {
      setFormError('報酬額は0以上の整数で入力してください')
      return
    }
    const miles = rewardMiles.trim() === '' ? undefined : Number(rewardMiles)
    if (miles !== undefined && (!Number.isInteger(miles) || miles < 0)) {
      setFormError('付与マイルは0以上の整数で入力してください')
      return
    }

    setSubmitting(true)
    try {
      if (isEdit && initial) {
        const res = await api.affiliateOffers.update(initial.id, {
          name: name.trim(),
          description: description.trim() || null,
          rewardAmount: reward,
          rewardMiles: miles,
          lineAccountId: lineAccountId || null,
          tagId: tagId || null,
          scenarioId: scenarioId || null,
          isActive,
        })
        if (!res.success) {
          setFormError('更新に失敗しました')
          setSubmitting(false)
          return
        }
      } else {
        const res = await api.affiliateOffers.create({
          name: name.trim(),
          description: description.trim() || null,
          rewardAmount: reward,
          rewardMiles: miles,
          lineAccountId: lineAccountId || null,
          tagId: tagId || null,
          scenarioId: scenarioId || null,
        })
        if (!res.success) {
          setFormError('作成に失敗しました')
          setSubmitting(false)
          return
        }
      }
      onSaved()
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, name, description, rewardAmount, rewardMiles, lineAccountId, tagId, scenarioId, isActive, isEdit, initial, onSaved, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? '案件を編集' : '案件を新規作成'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="閉じる"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              案件名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 無料体験申込"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">説明</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="案件の説明（任意）"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">報酬額（円）</label>
            <input
              type="number"
              min="0"
              step="1"
              value={rewardAmount}
              onChange={(e) => setRewardAmount(e.target.value)}
              placeholder="例: 3000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">成果承認時の付与マイル</label>
            <input
              type="number"
              min="0"
              step="1"
              value={rewardMiles}
              onChange={(e) => setRewardMiles(e.target.value)}
              placeholder="例: 500"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-[11px] text-gray-400">承認された紹介1件ごとに紹介者へ付与します</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">誘導 LINE アカウント</label>
            <select
              value={lineAccountId}
              onChange={(e) => setLineAccountId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 選択しない —</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">タグ</label>
            <select
              value={tagId}
              onChange={(e) => setTagId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 選択しない —</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">シナリオ</label>
            <select
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 選択しない —</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {isEdit && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  isActive ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isActive ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-sm text-gray-700">{isActive ? '有効' : '無効'}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            onClick={() => { void handleSubmit() }}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
          >
            {submitting ? '保存中...' : isEdit ? '更新' : '作成'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Approval queue ───────────────────────────────────────────────────────────

type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export function ApprovalQueue() {
  const [status, setStatus] = useState<ApprovalStatus>('pending')
  const [items, setItems] = useState<ConversionApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actioning, setActioning] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [sort, setSort] = useState<'oldest' | 'newest' | 'amount'>('oldest')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [detailItem, setDetailItem] = useState<ConversionApprovalItem | null>(null)

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const results = await Promise.all(
        (['pending', 'approved', 'rejected'] as const).map((value) =>
          api.conversionApprovals.list({ status: value, limit: 200 }),
        ),
      )
      if (results.some((result) => !result.success)) throw new Error('読み込みに失敗しました')
      setItems(results.flatMap((result) => result.data))
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みエラー')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadItems() }, [loadItems])

  const handleApprove = useCallback(async (eventId: string) => {
    if (actioning) return
    setActioning(eventId)
    setError(null)
    try {
      const res = await api.conversionApprovals.approve(eventId)
      if (res.success) {
        await loadItems()
      } else {
        setError(res.error ?? '承認に失敗しました')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '承認に失敗しました')
    }
    setActioning(null)
  }, [actioning, loadItems])

  const handleReject = useCallback(async (eventId: string) => {
    if (actioning) return
    setActioning(eventId)
    setError(null)
    try {
      const res = await api.conversionApprovals.reject(eventId)
      if (res.success) {
        await loadItems()
      } else {
        setError(res.error ?? '却下に失敗しました')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '却下に失敗しました')
    }
    setActioning(null)
  }, [actioning, loadItems])

  const counts = {
    pending: items.filter((item) => item.approvalStatus === 'pending').length,
    approved: items.filter((item) => item.approvalStatus === 'approved').length,
    rejected: items.filter((item) => item.approvalStatus === 'rejected').length,
  }
  const pendingItems = items.filter((item) => item.approvalStatus === 'pending')
  const flaggedCount = pendingItems.filter((item) => item.duplicateFlag).length
  const pendingYen = pendingItems.reduce((sum, item) => sum + (item.value ?? 0), 0)
  const averageWaitDays = pendingItems.length === 0
    ? 0
    : pendingItems.reduce((sum, item) => {
      const createdAt = new Date(item.createdAt).getTime()
      return sum + (Number.isFinite(createdAt) ? Math.max(0, Date.now() - createdAt) / 86_400_000 : 0)
    }, 0) / pendingItems.length

  const shownItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    return items
      .filter((item) => item.approvalStatus === status)
      .filter((item) => !flaggedOnly || item.duplicateFlag)
      .filter((item) => {
        if (!needle) return true
        return [item.friendName, item.affiliateName, item.offerName, item.conversionPointName]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('ja-JP')
          .includes(needle)
      })
      .toSorted((a, b) => {
        if (sort === 'amount') return (b.value ?? 0) - (a.value ?? 0)
        const time = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        return sort === 'oldest' ? time : -time
      })
  }, [flaggedOnly, items, query, sort, status])

  const approvalPageCount = pageCountOf(shownItems.length, pageSize)
  const currentPage = Math.min(page, approvalPageCount)
  const pagedItems = pageOf(shownItems, currentPage, pageSize)
  const safePendingIds = pagedItems
    .filter((item) => item.approvalStatus === 'pending' && !item.duplicateFlag)
    .map((item) => item.eventId)
  const allSafeSelected = safePendingIds.length > 0
    && safePendingIds.every((eventId) => selected.has(eventId))

  const handleBulkApprove = useCallback(async () => {
    const eventIds = [...selected]
    if (actioning || eventIds.length === 0) return
    setActioning('bulk')
    setError(null)
    try {
      const results = await Promise.all(eventIds.map((eventId) => api.conversionApprovals.approve(eventId)))
      const failed = results.filter((result) => !result.success).length
      await loadItems()
      if (failed > 0) setError(`${failed}件を承認できませんでした。一覧を確認してください。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'まとめて承認できませんでした')
    } finally {
      setActioning(null)
    }
  }, [actioning, loadItems, selected])

  const handleBulkReject = useCallback(async () => {
    const eventIds = [...selected]
    if (actioning || eventIds.length === 0) return
    setActioning('bulk-reject')
    setError(null)
    try {
      const results = await Promise.all(eventIds.map((eventId) => api.conversionApprovals.reject(eventId)))
      const failed = results.filter((result) => !result.success).length
      await loadItems()
      if (failed > 0) setError(`${failed}件を却下できませんでした。一覧を確認してください。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'まとめて却下できませんでした')
    } finally {
      setActioning(null)
    }
  }, [actioning, loadItems, selected])

  const exportApprovalsCsv = () => {
    const header = ['日時', '友だち', 'アフィリエイター', '案件', '成果地点', '金額', '確認状態']
    const lines = shownItems.map((item) => [
      formatDateTime(item.createdAt),
      personNameText(item.friendName),
      item.affiliateName ?? '名前を取得できませんでした',
      item.offerName ?? '未設定',
      item.conversionPointName ?? '未設定',
      item.value ?? '',
      item.duplicateFlag ? '確認が必要' : '問題なし',
    ])
    const escape = (value: string | number) => {
      const text = String(value)
      return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
    }
    const csv = [header, ...lines].map((line) => line.map(escape).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `conversion-approvals-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div data-design-node="n5VVTb" data-approval-design="v6">
      <NoteBar tone={flaggedCount > 0 ? 'warn' : 'info'}>
        {flaggedCount > 0
          ? `${flaggedCount}件は同じ友だちの重複が疑われます。内容を確認してから判断してください。`
          : '成果を認めると報酬が確定します。確認が必要な成果は、まとめて承認の対象から外れます。'}
      </NoteBar>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="認めるのを待っている"
          value={loading || error ? null : counts.pending}
          unit={loading || error ? '' : '件'}
          detail={loading ? '読み込んでいます' : error ? '読み込めませんでした' : `合計 ${formatYen(pendingYen)}`}
          loading={loading}
        />
        <KpiCard
          title="確認したほうがよい"
          value={loading || error ? null : flaggedCount}
          unit={loading || error ? '' : '件'}
          detail="同じ友だちの重複が疑われる成果"
          loading={loading}
        />
        <KpiCard
          title="認めた成果"
          value={loading || error ? null : counts.approved}
          unit={loading || error ? '' : '件'}
          detail="直近最大200件"
          loading={loading}
        />
        <KpiCard
          title="待たせている日数"
          value={loading || error ? null : Math.round(averageWaitDays * 10) / 10}
          unit={loading || error ? '' : '日'}
          detail="承認待ちの平均"
          loading={loading}
        />
      </div>

      <div className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3">
        <SearchField
          placeholder="友だち・紹介者・案件・成果地点で検索"
          aria-label="成果承認を検索"
          value={query}
          onChange={(value) => { setQuery(value); setPage(1); setSelected(new Set()) }}
          onClear={() => { setQuery(''); setPage(1); setSelected(new Set()) }}
          className="w-full md:max-w-lg"
        />
        <span className="text-ink-faint whitespace-nowrap text-xs">並び順</span>
        <Select
          aria-label="成果承認の並び順"
          value={sort}
          options={[
            { value: 'oldest', label: '古い順' },
            { value: 'newest', label: '新しい順' },
            { value: 'amount', label: '金額が高い順' },
          ]}
          onChange={(value) => { setSort(value as typeof sort); setPage(1); setSelected(new Set()) }}
        />
        <span className="text-ink-faint whitespace-nowrap text-xs">表示</span>
        <Select
          aria-label="成果承認の表示件数"
          value={String(pageSize)}
          options={[20, 50, 100].map((n) => ({ value: String(n), label: `${n}件表示` }))}
          onChange={(value) => { setPageSize(Number(value)); setPage(1); setSelected(new Set()) }}
          size="page-size"
        />
        <AffiliateButton onClick={exportApprovalsCsv} disabled={shownItems.length === 0} className="ml-auto">
          CSVで書き出す
        </AffiliateButton>
        {status === 'pending' && (
          <>
            <AffiliateButton
              variant="primary"
              onClick={() => { void handleBulkApprove() }}
              disabled={selected.size === 0 || actioning !== null}
            >
              選んだ{selected.size}件をまとめて認める
            </AffiliateButton>
            <AffiliateButton
              onClick={() => { void handleBulkReject() }}
              disabled={selected.size === 0 || actioning !== null}
            >
              まとめて却下する
            </AffiliateButton>
          </>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <FilterChip
            key={s}
            selected={status === s}
            onChange={(selectedNow) => {
              if (!selectedNow) return
              setStatus(s)
              setFlaggedOnly(false)
              setPage(1)
              setSelected(new Set())
            }}
          >
            {s === 'pending' ? '認めるのを待っている' : s === 'approved' ? '認めた' : '却下した'} {counts[s]}
          </FilterChip>
        ))}
        {status === 'pending' && (
          <FilterChip
            selected={flaggedOnly}
            onChange={(value) => { setFlaggedOnly(value); setPage(1); setSelected(new Set()) }}
          >
            確認したほうがよい {flaggedCount}
          </FilterChip>
        )}
      </div>

      {error ? (
        <ListState
          {...{ kind: 'error' as const }}
          title="成果を読み込めませんでした"
          description={error}
          onRetry={() => void loadItems()}
        />
      ) : loading ? (
        <ListState kind="loading" title="成果を読み込んでいます" />
      ) : shownItems.length === 0 ? (
        <ListState
          kind="empty"
          title="条件に合う成果がありません"
          description="状態や検索語を変えると、ほかの成果を確認できます。"
        />
      ) : (
        <div className="bg-canvas rounded-card border-hairline overflow-x-auto border">
          <table className="w-full min-w-[820px]">
            <thead>
              <TableHeadRow>
                <Th>
                  <span className="flex items-center gap-2">
                    {status === 'pending' && (
                      <input
                        type="checkbox"
                        aria-label="このページの確認不要な成果をすべて選ぶ"
                        checked={allSafeSelected}
                        onChange={(event) => {
                          setSelected((current) => {
                            const next = new Set(current)
                            for (const eventId of safePendingIds) {
                              if (event.target.checked) next.add(eventId)
                              else next.delete(eventId)
                            }
                            return next
                          })
                        }}
                      />
                    )}
                    友だちと、成果が出た時刻
                  </span>
                </Th>
                <Th>紹介した人</Th>
                <Th>案件と成果地点</Th>
                <Th align="right">報酬</Th>
                <Th align="center">確認</Th>
                {status === 'pending' && (
                  <Th align="center">決める</Th>
                )}
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {pagedItems.map((item) => (
                <tr key={item.eventId} className={item.duplicateFlag ? 'bg-warning-bg' : 'hover:bg-canvas-sunken'}>
                  <td className="text-ink px-4 py-3 text-sm">
                    <div className="flex items-start gap-2">
                    {status === 'pending' && (
                      <input
                        type="checkbox"
                        className="mt-1"
                        aria-label={`${personNameText(item.friendName)}の成果を選ぶ`}
                        checked={selected.has(item.eventId)}
                        disabled={item.duplicateFlag}
                        title={item.duplicateFlag ? '確認が必要な成果はまとめて承認できません' : undefined}
                        onChange={(event) => {
                          setSelected((current) => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(item.eventId)
                            else next.delete(item.eventId)
                            return next
                          })
                        }}
                      />
                    )}
                    <span>
                      <span className="block font-medium">{personNameText(item.friendName)}</span>
                      <span className="text-ink-faint mt-0.5 block whitespace-nowrap text-xs">{formatDateTime(item.createdAt)} に成果</span>
                    </span>
                    </div>
                  </td>
                  <td className="text-ink px-4 py-3 text-sm font-medium">
                    {item.affiliateName ?? '名前を取得できませんでした'}
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-sm">
                    <span className="text-ink block font-medium">{item.offerName ?? '未設定'}</span>
                    <span className="text-ink-faint mt-0.5 block text-xs">{item.conversionPointName ?? '成果地点は未設定'}</span>
                  </td>
                  <td className="text-ink px-4 py-3 text-right text-sm font-semibold tabular-nums">
                    {formatYenNullable(item.value)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {item.duplicateFlag ? (
                      <span title={DUPLICATE_FLAG_TITLE}><Chip tone="warn">要確認</Chip></span>
                    ) : (
                      <Chip tone="ok">問題なし</Chip>
                    )}
                  </td>
                  {status === 'pending' && (
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <AffiliateButton
                          onClick={() => { void handleApprove(item.eventId) }}
                          disabled={actioning !== null}
                          variant="primary"
                        >
                          認める
                        </AffiliateButton>
                        <AffiliateButton
                          onClick={() => { void handleReject(item.eventId) }}
                          disabled={actioning !== null}
                          title="却下理由はまだ保存できません"
                        >
                          却下
                        </AffiliateButton>
                        <AffiliateButton onClick={() => setDetailItem(item)}>見る</AffiliateButton>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailItem && (
        <div className="bg-canvas rounded-card border-hairline mt-3 border p-4" role="dialog" aria-label="成果の詳細">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-ink text-sm font-semibold">成果の詳細</h3>
              <p className="text-ink-secondary mt-2 text-sm">
                {personNameText(detailItem.friendName)}／{detailItem.affiliateName ?? '紹介者名を取得できませんでした'}／{detailItem.offerName ?? '案件未設定'}
              </p>
              <p className="text-ink-faint mt-1 text-xs">{formatDateTime(detailItem.createdAt)}・{detailItem.conversionPointName ?? '成果地点未設定'}・{formatYenNullable(detailItem.value)}</p>
            </div>
            <AffiliateButton onClick={() => setDetailItem(null)}>閉じる</AffiliateButton>
          </div>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-ink-faint text-xs font-semibold tabular-nums">
            {shownItems.length}件 / 全 {counts[status]}件（各状態 最大200件）
          </p>
          <Pagination page={currentPage} pageCount={approvalPageCount} onPageChange={(value) => {
            setPage(value)
            setSelected(new Set())
          }} />
        </div>
      )}

      <p className="text-ink-faint mt-3 text-xs">却下理由の記録は未接続です。却下状態はまとめて保存できます。</p>
    </div>
  )
}

// ── Offers list ──────────────────────────────────────────────────────────────

function OffersList({
  offers,
  tagMap,
  scenarioMap,
  offerStats,
  loading,
  error,
  filtered,
  onEdit,
  onRefresh,
}: {
  offers: AffiliateOffer[]
  tagMap: Map<string, string>
  scenarioMap: Map<string, string>
  offerStats: Map<string, { introducers: number; conversions: number; reward: number }>
  loading: boolean
  error: string | null
  /** 案件はあるが、絞り込みに合う行が無い。 */
  filtered: boolean
  onEdit: (offer: AffiliateOffer) => void
  onRefresh: () => void
}) {
  if (error) {
    return (
      <ListState
        kind="error"
        title="案件を読み込めませんでした"
        description="再読み込みしても直らない場合は、エラー報告へ連絡してください。"
        onRetry={onRefresh}
      />
    )
  }

  if (loading) {
    return <ListState kind="loading" title="案件を読み込んでいます" />
  }

  if (offers.length === 0) {
    return filtered ? (
      <ListState
        kind="empty"
        title="絞り込みに合う案件がありません"
        description="検索語を変えるか、絞り込みの札を外すと表示されます。"
      />
    ) : (
      <ListState
        kind="empty"
        title="案件はまだ登録されていません"
        description="何をしたら成果になり、いくら払うかを決めると、アフィリエイターが紹介できるようになります。"
        action={<Button href="/affiliate-offers/new" variant="primary">案件を作る</Button>}
      />
    )
  }

  return (
    <div data-design="Table" className="bg-canvas rounded-card border-hairline overflow-x-auto border">
      <table className="w-full min-w-[760px]">
        <thead>
          <TableHeadRow>
            <Th>案件</Th>
            <Th align="right">報酬</Th>
            <Th>成果が出たときの動き</Th>
            <Th align="right">紹介している人</Th>
            <Th align="right">成果</Th>
            <Th align="center">操作</Th>
          </TableHeadRow>
        </thead>
        <tbody className="divide-hairline divide-y">
          {offers.map((offer) => (
            <tr key={offer.id} className="hover:bg-canvas-sunken">
              <td className="text-ink px-4 py-3 text-sm font-medium">
                <span className="block">{offer.name}</span>
                <span className="text-ink-faint mt-0.5 block max-w-[300px] truncate text-xs">{offer.description ?? '説明はありません'}</span>
              </td>
              <td className="text-ink px-4 py-3 text-right text-sm font-semibold tabular-nums">
                {formatYenNullable(offer.rewardAmount)}
                {offer.rewardMiles > 0 && <span className="text-ink-faint block text-xs">＋{offer.rewardMiles.toLocaleString()}マイル</span>}
              </td>
              <td className="text-ink-secondary px-4 py-3 text-sm">
                {offer.tagId ? (
                  <>タグ「{tagMap.get(offer.tagId) ?? '名前を確認できません'}」を付ける</>
                ) : offer.scenarioId ? (
                  <>シナリオ「{scenarioMap.get(offer.scenarioId) ?? '名前を確認できません'}」を始める</>
                ) : offer.rewardMiles > 0 ? (
                  <>{offer.rewardMiles.toLocaleString()}マイルを付ける</>
                ) : (
                  <span className="text-warning">何も設定されていません</span>
                )}
              </td>
              <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">
                {(offerStats.get(offer.id)?.introducers ?? 0).toLocaleString()}人
              </td>
              <td className="text-ink px-4 py-3 text-right text-sm font-semibold tabular-nums">
                {(offerStats.get(offer.id)?.conversions ?? 0).toLocaleString()}件
                <span className="text-ink-faint block text-[11px]">確定 {formatYen(offerStats.get(offer.id)?.reward ?? 0)}</span>
              </td>
              <td className="px-4 py-3 text-center">
                <button
                  onClick={() => onEdit(offer)}
                  className="text-action text-xs font-medium hover:underline"
                >
                  編集
                </button>
                <span className="text-ink-faint ml-2 text-[11px]">{offer.isActive ? '公開中' : '停止・終了'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Offers tab — list + create/edit modal wiring ─────────────────────────────

export function OffersTab() {
  const [offers, setOffers] = useState<AffiliateOffer[]>([])
  const [offersLoading, setOffersLoading] = useState(true)
  const [offersError, setOffersError] = useState<string | null>(null)

  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<(Scenario & { stepCount?: number })[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AffiliateOffer | null>(null)

  // 一覧の見せ方。どれも読み込んだ行から数えられるので、画面の中で動かす。
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<OfferFilter[]>([])
  const [sort, setSort] = useState<OfferSort>('newest')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  const loadOffers = useCallback(async () => {
    setOffersLoading(true)
    setOffersError(null)
    try {
      const res = await api.affiliateOffers.list()
      if (res.success && Array.isArray(res.data)) {
        setOffers(res.data)
      } else {
        setOffers([])
        setOffersError('案件を読み込めませんでした')
      }
    } catch {
      setOffers([])
      setOffersError('案件を読み込めませんでした')
    } finally {
      setOffersLoading(false)
    }
  }, [])

  const loadOptions = useCallback(async () => {
    try {
      const [accountsRes, tagsRes, scenariosRes] = await Promise.all([
        api.lineAccounts.list(),
        api.tags.list(),
        api.scenarios.list(),
      ])
      if (accountsRes.success && Array.isArray(accountsRes.data)) setAccounts(accountsRes.data as unknown as LineAccount[])
      if (tagsRes.success && Array.isArray(tagsRes.data)) setTags(tagsRes.data as unknown as Tag[])
      if (scenariosRes.success && Array.isArray(scenariosRes.data)) setScenarios(scenariosRes.data as unknown as (Scenario & { stepCount?: number })[])
    } catch { /* silent */ }
  }, [])

  // 今月に発生し、承認まで済んだ成果。KPIの「今月の成果」「支払い予定」に要る。
  // **状態を別に持つ。** 取れなかったときに0を出すと、承認待ちが並んでいるのに
  // 「今月の成果0件」と読めて、運用者が成果そのものが無いと誤解する。
  const [offerApprovalItems, setOfferApprovalItems] = useState<ConversionApprovalItem[]>([])
  const [confirmedState, setConfirmedState] = useState<ConfirmedState>('loading')

  useEffect(() => {
    void loadOffers()
    void loadOptions()
  }, [loadOffers, loadOptions])

  useEffect(() => {
    let cancelled = false
    setConfirmedState('loading')
    void Promise.all((['pending', 'approved', 'rejected'] as const).map((status) =>
      api.conversionApprovals.list({ status, limit: 200 }),
    )).then((results) => {
        if (cancelled) return
        if (results.some((result) => !result.success || !Array.isArray(result.data))) {
          setConfirmedState('error')
          return
        }
        const all = results.flatMap((result) => result.data)
        setOfferApprovalItems(all)
        setConfirmedState('ready')
      })
      .catch(() => {
        // 承認が引けなくても、案件の一覧と作成は使える。
        // ただし**数は出さない。** 0と読めなかったを混ぜない。
        if (!cancelled) setConfirmedState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleEdit = (offer: AffiliateOffer) => {
    setEditTarget(offer)
    setFormOpen(true)
  }

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])
  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags])
  const scenarioMap = useMemo(() => new Map(scenarios.map((sc) => [sc.id, sc.name])), [scenarios])

  const shown = useMemo(
    () => selectOffers(offers, { filters, query, sort }),
    [offers, filters, query, sort],
  )

  const pageCount = pageCountOf(shown.length, pageSize)
  const currentPage = Math.min(page, pageCount)
  const paged = pageOf(shown, currentPage, pageSize)

  // 設計のKPI。案件そのものと、そこから出た成果の両方を見る。
  const openCount = offers.filter((o) => o.isActive).length
  // 案件に結びつかない成果（ref から案件を辿れないもの）はマイルが付かない。
  const offerStats = useMemo(() => {
    const result = new Map<string, { introducerIds: Set<string>; conversions: number; reward: number }>()
    for (const item of offerApprovalItems) {
      if (!item.offerId || item.approvalStatus === 'rejected') continue
      const current = result.get(item.offerId) ?? { introducerIds: new Set<string>(), conversions: 0, reward: 0 }
      current.introducerIds.add(item.affiliateId)
      current.conversions += 1
      if (item.approvalStatus === 'approved') current.reward += item.value ?? 0
      result.set(item.offerId, current)
    }
    return new Map([...result].map(([id, value]) => [id, {
      introducers: value.introducerIds.size,
      conversions: value.conversions,
      reward: value.reward,
    }]))
  }, [offerApprovalItems])
  const topOffer = offers.toSorted((a, b) =>
    (offerStats.get(b.id)?.conversions ?? 0) - (offerStats.get(a.id)?.conversions ?? 0),
  )[0]
  const rewardValues = offers.map((offer) => offer.rewardAmount ?? 0).filter((value) => value > 0)
  const averageReward = rewardValues.length === 0 ? 0 : Math.round(rewardValues.reduce((sum, value) => sum + value, 0) / rewardValues.length)
  const unsetActionCount = offers.filter((offer) => !offer.tagId && !offer.scenarioId && offer.rewardMiles === 0).length

  const exportCsv = () => {
    const csv = offersCsv(shown, {
      account: (id) => accountMap.get(id),
      tag: (id) => tagMap.get(id),
      scenario: (id) => scenarioMap.get(id),
      date: formatDate,
    })
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `affiliate-offers-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div data-design-node="GH8VL" data-affiliate-offers-design="v6">
      <NoteBar>
        案件は「何をしたら成果になり、いくら払うか」の組み合わせです。アフィリエイターはこの案件を選んで紹介します。
      </NoteBar>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="紹介できる案件" value={openCount} unit="件" detail={`公開中。停止・終了 ${offers.length - openCount}件`} />
        <KpiCard
          title="いちばん成果が出た案件"
          value={confirmedState === 'ready' && topOffer ? (offerStats.get(topOffer.id)?.conversions ?? 0) : null}
          unit={confirmedState === 'ready' && topOffer ? '件' : ''}
          loading={confirmedState === 'loading'}
          detail={confirmedDetail(confirmedState, topOffer ? `${topOffer.name}・確定 ${formatYen(offerStats.get(topOffer.id)?.reward ?? 0)}` : '成果はまだありません')}
        />
        <KpiCard
          title="1件あたりの平均報酬"
          value={averageReward}
          unit="円"
          detail={`いちばん高い案件 ${formatYen(Math.max(0, ...rewardValues))}`}
        />
        <KpiCard
          title="動きが未設定の案件"
          value={unsetActionCount}
          unit="件"
          detail="成果が出ても何も起きません"
          badge={unsetActionCount > 0 ? '確認' : undefined}
          badgeTone={unsetActionCount > 0 ? 'neutral' : undefined}
        />
      </div>

      <div
        data-design="Bar"
        className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
      >
        <SearchField
          placeholder="案件名・説明で検索"
          aria-label="案件名・説明で検索"
          value={query}
          onChange={(value) => { setQuery(value); setPage(1) }}
          onClear={() => { setQuery(''); setPage(1) }}
          className="w-[460px] max-w-full"
        />
        <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
        <Select
          aria-label="並び順"
          value={sort}
          options={OFFER_SORTS.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(value) => { setSort(value as OfferSort); setPage(1) }}
        />
        <span className="text-ink-faint text-xs whitespace-nowrap">表示</span>
        <Select
          aria-label="表示件数"
          value={String(pageSize)}
          options={OFFER_PAGE_SIZES.map((n) => ({ value: String(n), label: `${n}件表示` }))}
          onChange={(value) => { setPageSize(Number(value)); setPage(1) }}
          size="page-size"
        />
        {/* 「並び順を保存」は設計にあるが、保存する口が無いので置かない。 */}
        <AffiliateButton onClick={exportCsv} disabled={shown.length === 0} className="ml-auto">
          CSVで書き出す
        </AffiliateButton>
        <Button href="/affiliate-offers/new" variant="primary">
          案件を作る
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {OFFER_FILTERS.map((f) => (
          <FilterChip
            key={f.key}
            selected={filters.includes(f.key)}
            onChange={(selected) => {
              setFilters((current) =>
                selected ? [...current, f.key] : current.filter((k) => k !== f.key),
              )
              setPage(1)
            }}
          >
            {f.label}
          </FilterChip>
        ))}
      </div>

      <OffersList
        offers={paged}
        tagMap={tagMap}
        scenarioMap={scenarioMap}
        offerStats={offerStats}
        loading={offersLoading}
        error={offersError}
        filtered={offers.length > 0 && shown.length === 0}
        onEdit={handleEdit}
        onRefresh={loadOffers}
      />

      <div data-design="tf" className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-faint text-xs font-semibold tabular-nums">
          {shown.length === offers.length
            ? `全 ${offers.length}件`
            : `${shown.length}件 / 全 ${offers.length}件`}
        </p>
        {pageCount > 1 && (
          <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
        )}
      </div>

      <section className="bg-canvas rounded-card border-hairline mt-4 border p-4">
        <h3 className="text-ink text-sm font-semibold">アフィリエイターと案件のちがい</h3>
        <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
          <li>・アフィリエイター＝紹介してくれる人。紹介コードを持ちます</li>
          <li>・案件＝何を成果として、いくら払うか。1人のアフィリエイターが複数の案件を紹介できます</li>
          <li>・成果が出たときのタグ付けとシナリオ開始は、案件ごとに決められます</li>
        </ul>
      </section>

      {formOpen && (
        <OfferFormModal
          initial={editTarget}
          accounts={accounts}
          tags={tags}
          scenarios={scenarios}
          onClose={() => setFormOpen(false)}
          onSaved={() => { void loadOffers() }}
        />
      )}
    </div>
  )
}


/**
 * 支払いの取り決めの編集。
 *
 * 一覧の行を開いたところに置いている。別画面にすると、報酬の数字を見て
 * から条件を直す、という流れで毎回行き来することになる。
 */
function SettlementEditor({
  affiliate,
  onSaved,
}: {
  affiliate: {
    id: string
    email?: string | null
    holdDays?: number | null
    payoutCycle?: string | null
    notifyOnConversion?: boolean
  }
  onSaved: () => void
}) {
  const [email, setEmail] = useState(affiliate.email ?? '')
  const [holdDays, setHoldDays] = useState(
    affiliate.holdDays == null ? '' : String(affiliate.holdDays),
  )
  const [payoutCycle, setPayoutCycle] = useState(affiliate.payoutCycle ?? '')
  const [notify, setNotify] = useState(affiliate.notifyOnConversion ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await api.affiliates.update(affiliate.id, {
        email: email.trim() || null,
        holdDays: holdDays.trim() === '' ? null : Number(holdDays),
        payoutCycle: payoutCycle.trim() || null,
        notifyOnConversion: notify,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setSaved(true)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-4">
      <p className="mb-3 text-xs font-semibold uppercase text-gray-500">支払いの取り決め</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label
            htmlFor={`aff-email-${affiliate.id}`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            連絡先
          </label>
          <input
            id={`aff-email-${affiliate.id}`}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setSaved(false)
            }}
            placeholder="partner@example.com"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label
            htmlFor={`aff-hold-${affiliate.id}`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            確定までの保留
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id={`aff-hold-${affiliate.id}`}
              type="number"
              min={0}
              max={365}
              value={holdDays}
              onChange={(e) => {
                setHoldDays(e.target.value)
                setSaved(false)
              }}
              placeholder="なし"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="whitespace-nowrap text-xs text-gray-400">日</span>
          </div>
        </div>
        <div>
          <label
            htmlFor={`aff-cycle-${affiliate.id}`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            支払いサイクル
          </label>
          <input
            id={`aff-cycle-${affiliate.id}`}
            type="text"
            value={payoutCycle}
            onChange={(e) => {
              setPayoutCycle(e.target.value)
              setSaved(false)
            }}
            placeholder="例: 月末締め翌月末払い"
            maxLength={100}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => {
            setNotify(e.target.checked)
            setSaved(false)
          }}
          className="mt-0.5 rounded border-gray-300"
        />
        <span className="text-xs text-gray-600">成果が出たときに本人へ知らせる</span>
      </label>
      <p className="mt-2 text-[11px] text-gray-400">
        保留日数と支払いサイクルは取り決めの記録です。報酬の計算そのものには使いません。
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          {saving ? '保存中...' : '取り決めを保存'}
        </button>
        {saved && <span className="text-xs text-emerald-600">保存しました</span>}
      </div>
    </div>
  )
}
