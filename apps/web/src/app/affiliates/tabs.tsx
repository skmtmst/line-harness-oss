'use client'

import { Fragment, useState, useEffect, useCallback, useMemo, useRef, useId } from 'react'
import KpiCard from '@/components/shared/kpi-card'
import {
  api,
  type AffiliateAccountSettlementPreview,
  type AffiliateOffer,
  type AffiliatePaymentSummary,
  type ConversionApprovalItem,
} from '@/lib/api'
import type { Tag, Scenario, LineAccount } from '@line-crm/shared'
import { TableHeadRow, Th } from '@/components/shared/table'
import ActionMenu from '@/components/shared/action-menu'
import MenuPortal from '@/components/shared/menu-portal'
import { MoreAction } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import type { ButtonProps } from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import { CopyAnnounce, useCopy } from '@/lib/copy'
import Chip from '@/components/shared/chip'
import FilterChip from '@/components/shared/filter-chip'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Notice from '@/components/shared/notice'
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
  APPROVAL_ORDER_STATUS_TEXT,
  CLICK_SUMMARY_LABEL,
  LINK_CODE_HEADING,
  ORDER_DUPLICATE_TITLE,
  REWARD_ENTRY_STATUS_TEXT,
  approvalReviewReasons,
  duplicateFlagHeading,
  duplicateFriendNameText,
  personNameText,
} from './affiliate-display'
import { AffiliateArchiveDialog } from './action-dialogs'
import AttributionSection from './attribution-view'
import OfferTermsDialog, {
  EMPTY_TERMS,
  OfferTermsFields,
  parseOfferTermsInput,
  toDateInput,
  type OfferTermsFieldValues,
  type ParsedOfferTerms,
} from './offer-terms'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import Toggle from '@/components/shared/toggle'
import {
  OFFER_FILTERS,
  OFFER_PAGE_SIZES,
  OFFER_SORTS,
  csvCell,
  offersCsv,
  pageCountOf,
  pageOf,
  selectOffers,
  type OfferFilter,
  type OfferSort,
} from './offer-list-view'
import { formatDay, formatNumber } from '@/lib/format'

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
  一覧には載っているので押せてしまい、`formatNumber(report.clicks)` で
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
  return formatDay(date)
}

function formatYen(n: number): string {
  return `¥${formatNumber(Math.round(n))}`
}

/*
  R292: 既存リンクの配布URL。Worker の `resolveLinkBaseUrl` と同じ優先順位。
  1. 管理画面で決めた短縮ドメイン（`link_base_url`）があれば、その直下。
  2. 無ければ Worker の `/r/`（`NEXT_PUBLIC_API_URL` が Worker のURL）。
  呼び出し側で付け足しの `/r` を増やさない（Worker の契約どおり）。
*/
const WORKER_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')

function distributionUrl(refCode: string, customBase: string | null): string {
  if (customBase) return `${customBase.replace(/\/$/, '')}/${refCode}`
  if (WORKER_BASE) return `${WORKER_BASE}/r/${encodeURIComponent(refCode)}`
  return ''
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
// 承認の集計は打ち切らない（#505 重大2）
// ─────────────────────────────────────────────────────────────────────────────
/*
 * KPI（今月の成果・支払い予定・いちばん成果が出た案件）は承認の一覧から
 * 数える。`limit: 200` で止めると、件数が増えたときに実態より小さく出て
 * 支払い判断を誤る。口に offset があるので、短い頁が返るまで送って全件取る。
 * 安全弁として 25 頁（5000 件）で止め、そのときは打ち切ったことを返す。
 */
const APPROVAL_PAGE_SIZE = 200
const APPROVAL_MAX_PAGES = 25

async function listAllConversionApprovals(
  status: 'pending' | 'approved' | 'rejected',
  startOffset = 0,
): Promise<{ items: ConversionApprovalItem[]; truncated: boolean }> {
  const items: ConversionApprovalItem[] = []
  for (let page = 0; page < APPROVAL_MAX_PAGES; page += 1) {
    const res = await api.conversionApprovals.list({
      status,
      limit: APPROVAL_PAGE_SIZE,
      offset: startOffset + page * APPROVAL_PAGE_SIZE,
    })
    if (!res.success) throw new Error('承認の読み込みに失敗しました。もう一度読み込んでください。')
    items.push(...res.data)
    if (res.data.length < APPROVAL_PAGE_SIZE) return { items, truncated: false }
  }
  return { items, truncated: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Affiliators tab — list + inline detail panel
// ─────────────────────────────────────────────────────────────────────────────

export function AffiliatorsTab({
  accountId,
  focusAffiliateId,
}: {
  accountId: string | null
  /** R291: 停止前の確認から戻ってきたとき、最初に開く紹介者。 */
  focusAffiliateId?: string | null
}) {
  // ── list ───────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<AffiliateListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approvalItems, setApprovalItems] = useState<ConversionApprovalItem[]>([])
  const [approvalState, setApprovalState] = useState<ConfirmedState>('loading')
  // 安全弁（5000 件）で止まったときだけ注記を出す。通常は false。
  const [approvalTruncated, setApprovalTruncated] = useState(false)
  const [paymentItems, setPaymentItems] = useState<AffiliatePaymentSummary[]>([])
  const [accountSettlement, setAccountSettlement] = useState<AffiliateAccountSettlementPreview | null>(null)
  const [paymentState, setPaymentState] = useState<ConfirmedState>('loading')
  const settlementPeriod = useMemo(() => {
    const now = new Date()
    return {
      periodFrom: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString(),
      periodTo: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString(),
    }
  }, [])
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Array<'active' | 'inactive' | 'reward'>>([])
  const [sort, setSort] = useState<'newest' | 'name' | 'reward'>('newest')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  // ── selected affiliate (detail panel) ─────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [report, setReport] = useState<ReportV2 | null>(null)
  const [links, setLinks] = useState<AffiliateLink[]>([])

  // ── create modal ────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null)
  // 行の「…」メニューの開き先（EC連携の一覧と同じ形）
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)

  // ── journeys (cursor-paginated) ────────────────────────────────────────────
  const [journeys, setJourneys] = useState<JourneySummary[]>([])
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [journeyError, setJourneyError] = useState(false)
  const [journeyMore, setJourneyMore] = useState(false)
  const [journeyLoadingMore, setJourneyLoadingMore] = useState(false)
  const journeyCursorRef = useRef<{ beforeAt: string; beforeId: string } | null>(null)
  /*
    R289: 内訳の読み込みの世代番号。紹介者を切り替えたら前の世代の遅い
    応答を捨てる（#916 の会員一覧・友だち詳細と同じ形）。集計・リンク・
    動線・追加読み込みの全経路で、選んでいる途中の世代だけを入れる。
  */
  const detailGenRef = useRef(0)
  const selectedIdRef = useRef<string | null>(null)
  const isCurrentDetail = useCallback((id: string, gen: number) => (
    detailGenRef.current === gen && selectedIdRef.current === id
  ), [])

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

  /*
    R290: 「今月の成果の流れ」のクリック・友だち追加・成果は、今月の範囲で
    取り直す。一覧の集計は累計のまま（一覧の表は累計で見る）なので、流れ用
    だけ別に今月の allReport を読む。認めた・承認は承認の一覧の今月分。
  */
  const [monthlyFunnel, setMonthlyFunnel] = useState<{
    clicks: number
    friends: number
    conversions: number
  } | null>(null)
  const [monthlyState, setMonthlyState] = useState<ConfirmedState>('loading')
  const loadMonthlyFunnel = useCallback(async () => {
    setMonthlyState('loading')
    try {
      const res = await api.affiliates.allReport({
        startDate: settlementPeriod.periodFrom,
        endDate: settlementPeriod.periodTo,
      })
      if (!res.success) throw new Error('monthly report fetch failed')
      const list = res.data as unknown as AffiliateReportRow[]
      setMonthlyFunnel({
        clicks: list.reduce((sum, row) => sum + row.totalClicks, 0),
        friends: list.reduce((sum, row) => sum + row.friendAdds, 0),
        conversions: list.reduce((sum, row) => sum + row.totalConversions, 0),
      })
      setMonthlyState('ready')
    } catch {
      // R293: 取れていない数を0として描かない。再試行で戻す。
      setMonthlyFunnel(null)
      setMonthlyState('error')
    }
  }, [settlementPeriod])

  useEffect(() => { void loadMonthlyFunnel() }, [loadMonthlyFunnel])

  /*
    R292: 配布URLの土台（短縮ドメイン）。取れなくても Worker の `/r/` で
    URLは作れるので、ここでは失敗の面を出さない。
  */
  const [linkBaseUrl, setLinkBaseUrl] = useState<string | null>(null)
  const { copied: copiedLink, copy: copyText } = useCopy()
  useEffect(() => {
    let cancelled = false
    void api.accountSettings.getLinkBaseUrl().then((res) => {
      if (cancelled || !res.success || !res.data) return
      setLinkBaseUrl(res.data)
    }).catch(() => { /* 取れなくても /r/ で作れる */ })
    return () => { cancelled = true }
  }, [])
  /*
    R292: URLの取り出しとコピーは計測を起こさない。文字を写すだけで、
    クリック記録の口もリンク発行の口も呼ばない。
  */
  const copyLinkUrl = useCallback(async (link: AffiliateLink) => {
    const url = distributionUrl(link.ref_code, linkBaseUrl)
    if (!url) return
    await copyText(url, link.id)
    /* 書けないときは選んで写せる（URLは表示のまま） */
  }, [linkBaseUrl, copyText])

  useEffect(() => {
    let cancelled = false
    setApprovalState('loading')
    // KPI の元になる承認は全件取る（打ち切ると数が小さく出る）。
    void Promise.all([
      listAllConversionApprovals('pending'),
      listAllConversionApprovals('approved'),
    ]).then(([pending, approved]) => {
      if (cancelled) return
      setApprovalItems([...pending.items, ...approved.items])
      setApprovalTruncated(pending.truncated || approved.truncated)
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
      setAccountSettlement(null)
      setPaymentState('error')
      return () => { cancelled = true }
    }
    setPaymentState('loading')
    void Promise.all([
      api.affiliates.settlementPreview(accountId, settlementPeriod),
      api.affiliates.paymentSummaries(accountId).catch(() => null),
    ]).then(([settlement, result]) => {
      if (cancelled) return
      if (!settlement.success || !Array.isArray(settlement.data.affiliates)) {
        setPaymentState('error')
        return
      }
      setPaymentItems(result?.success && Array.isArray(result.data) ? result.data : [])
      setAccountSettlement(settlement.data)
      setPaymentState('ready')
    }).catch(() => {
      if (!cancelled) {
        setAccountSettlement(null)
        setPaymentState('error')
      }
    })
    return () => { cancelled = true }
  }, [accountId, settlementPeriod])

  // ── load detail (report v2 + links) ────────────────────────────────────────
  const loadDetail = useCallback(async (id: string, gen: number) => {
    setDetailLoading(true)
    setDetailError(false)
    setReport(null)
    setLinks([])
    setJourneys([])
    setJourneyError(false)
    setJourneyMore(false)
    journeyCursorRef.current = null
    try {
      const [reportRes, linksRes] = await Promise.all([
        api.affiliates.reportV2(id),
        api.affiliates.links(id),
      ])
      // R289: 選んでいる途中の世代だけ入れる。遅れて届いた前の世代は捨てる。
      if (!isCurrentDetail(id, gen)) return
      /* **形を確かめてから入れる。** 読めない返事を入れると、描くときに落ちる。 */
      setReport(reportRes.success ? asReportV2(reportRes.data) : null)
      if (linksRes.success) setLinks(linksRes.data as unknown as AffiliateLink[])
      // 失敗は握りつぶさず、内訳面に再試行を出す（#554 点検#505中7）。
      if (!reportRes.success || !linksRes.success) setDetailError(true)
    } catch {
      if (!isCurrentDetail(id, gen)) return
      setDetailError(true)
    }
    if (!isCurrentDetail(id, gen)) return
    setDetailLoading(false)
  }, [isCurrentDetail])

  // ── load first page of journeys ────────────────────────────────────────────
  const loadJourneys = useCallback(async (id: string, gen: number) => {
    setJourneyLoading(true)
    setJourneyError(false)
    try {
      const res = await api.affiliates.journeys(id, { limit: JOURNEY_PAGE_SIZE })
      if (!isCurrentDetail(id, gen)) return
      if (res.success) {
        setJourneys(res.data)
        journeyCursorRef.current = res.nextCursor ?? null
        setJourneyMore(Boolean(res.nextCursor))
      } else {
        setJourneyError(true)
      }
    } catch {
      if (!isCurrentDetail(id, gen)) return
      setJourneyError(true)
    }
    if (!isCurrentDetail(id, gen)) return
    setJourneyLoading(false)
  }, [isCurrentDetail])

  // ── load more journeys ─────────────────────────────────────────────────────
  const loadMoreJourneys = useCallback(async (id: string, gen: number) => {
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
      // R289: 追加読み込みの遅い応答も、別の紹介者へは混ぜない。
      if (!isCurrentDetail(id, gen)) return
      if (res.success) {
        setJourneys((prev) => {
          const seen = new Set(prev.map((j) => j.friendId))
          return [...prev, ...res.data.filter((j) => !seen.has(j.friendId))]
        })
        journeyCursorRef.current = res.nextCursor ?? null
        setJourneyMore(Boolean(res.nextCursor))
        setJourneyError(false)
      } else {
        setJourneyError(true)
      }
    } catch {
      if (!isCurrentDetail(id, gen)) return
      setJourneyError(true)
    }
    // 読み込み中の印だけは必ず戻す（古い世代の応答でも印を残さない）。
    setJourneyLoadingMore(false)
  }, [isCurrentDetail, journeyLoadingMore])

  // ── row click ──────────────────────────────────────────────────────────────
  const handleRowClick = useCallback((id: string) => {
    if (selectedId === id) {
      // R289: 閉じたあとに届く応答も捨てるため、世代を進める。
      detailGenRef.current += 1
      selectedIdRef.current = null
      setSelectedId(null)
      return
    }
    // R289: 世代を進めて、いま選んだ紹介者の応答だけ入れる。
    detailGenRef.current += 1
    selectedIdRef.current = id
    const gen = detailGenRef.current
    setSelectedId(id)
    void loadDetail(id, gen)
    void loadJourneys(id, gen)
  }, [selectedId, loadDetail, loadJourneys])

  /*
    R291: 停止前の確認（`?affiliate=`）から来たとき、その紹介者の内訳を
    開く。一覧が読めてから1回だけ。閉じたあとは普通に操作できる。
  */
  const focusConsumedRef = useRef(false)
  useEffect(() => {
    if (!focusAffiliateId || focusConsumedRef.current) return
    if (loading || error) return
    if (!rows.some((row) => row.id === focusAffiliateId)) return
    focusConsumedRef.current = true
    detailGenRef.current += 1
    selectedIdRef.current = focusAffiliateId
    const gen = detailGenRef.current
    setSelectedId(focusAffiliateId)
    void loadDetail(focusAffiliateId, gen)
    void loadJourneys(focusAffiliateId, gen)
  }, [focusAffiliateId, rows, loading, error, loadDetail, loadJourneys])

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
  const paymentTotal = accountSettlement?.totalAmount
    ?? paymentItems.reduce((sum, item) => sum + item.approvedReward, 0)
  const heldTotal = paymentItems.reduce((sum, item) => sum + item.heldReward, 0)
  const payoutCycle = paymentItems.find((item) => item.payoutCycle?.trim())?.payoutCycle ?? null
  /*
    R293: 流れの各段は、取れていないときに0を描かない。実値0のときだけ0。
    読み込み中・取得失敗は「—」にし、失敗は再試行で戻す。
  */
  const funnel = {
    clicks: monthlyState === 'ready' && monthlyFunnel ? monthlyFunnel.clicks : null,
    friends: monthlyState === 'ready' && monthlyFunnel ? monthlyFunnel.friends : null,
    conversions: monthlyState === 'ready' && monthlyFunnel ? monthlyFunnel.conversions : null,
    approved: approvalState === 'ready' ? approvedThisMonth.length : null,
    reward: paymentState === 'ready' ? paymentTotal : null,
    held: paymentState === 'ready' ? heldTotal : null,
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
    // 数式対策は共通の csvCell に寄せる（`offer-list-view.ts`）。
    const csv = [header, ...cells].map((line) => line.map(csvCell).join(',')).join('\r\n')
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
    <div data-design-node="PouPn" data-affiliate-design="v6" className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          title="今月の成果"
          value={confirmedValue(approvalState, approvedTotals.count)}
          unit={confirmedUnit(approvalState, '件')}
          detail={confirmedDetail(approvalState, approvalTruncated ? '今月に承認した成果（直近5000件まで）' : '今月に承認した成果')}
          loading={approvalState === 'loading'}
        />
        <KpiCard
          title="承認待ち"
          value={confirmedValue(approvalState, pendingItems.length)}
          unit={confirmedUnit(approvalState, '件')}
          detail={confirmedDetail(approvalState, `合計 ${formatYen(pendingYen)}${approvalTruncated ? '（直近5000件まで）' : ''}`)}
          loading={approvalState === 'loading'}
        />
        <KpiCard
          title="確定した報酬"
          value={confirmedValue(paymentState, paymentTotal)}
          unit={confirmedUnit(paymentState, '円')}
          detail={confirmedDetail(paymentState, payoutCycle ? `${payoutCycle}・支払日は未接続` : '締め日・支払日は未接続')}
          loading={paymentState === 'loading'}
        />
      </div>

      <NoteBar>
        紹介リンクを渡した人ごとに、クリックから成果までの流れと確定した報酬を確認できます。
      </NoteBar>

      <section className="bg-canvas rounded-card border-hairline border p-4" aria-label="今月の成果の流れ">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-ink flex items-center gap-1 text-sm font-semibold">
            今月の成果の流れ
            {/*
              R290: 段ごとの数え方の違いは「？」に集約する。本文に補足を書いて
              箱を高くしない（共通ルール 2-1b）。
            */}
            <HelpTip label="今月の成果の流れの説明">
              クリック・友だち追加・成果は今月に起きた数を数えています。認めた・承認は承認の一覧にある今月の成果で、数え方が違うため段差は目安です。
            </HelpTip>
          </h3>
          <span className="flex items-center gap-2">
            <span className="text-ink-faint text-xs">どこで人が減っているかを1本で見る</span>
            {monthlyState === 'error' ? (
              <AffiliateButton onClick={() => { void loadMonthlyFunnel() }}>
                もう一度読み込む
              </AffiliateButton>
            ) : null}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {(
            [
              ['クリック', funnel.clicks],
              ['友だち追加', funnel.friends],
              ['成果', funnel.conversions],
              ['認めた・承認', funnel.approved],
            ] as Array<[label: string, value: number | null]>
          ).map(([label, value]) => (
            <div key={label} className="bg-canvas-sunken rounded-control px-3 py-2">
              <p className="text-ink-faint text-xs">{label}</p>
              <p className="text-ink mt-1 text-lg font-semibold tabular-nums">
                {value === null ? '—' : `${formatNumber(value)}件`}
              </p>
            </div>
          ))}
          <div className="bg-accent-soft rounded-control px-3 py-2">
            <p className="text-ink-faint text-xs">報酬</p>
            <p className="text-ink mt-1 text-lg font-semibold tabular-nums">
              {funnel.reward === null ? '—' : formatYen(funnel.reward)}
            </p>
            <p className="text-ink-faint mt-0.5 text-xs">
              {funnel.held === null ? '—' : `保留中 ${formatYen(funnel.held)} を含む`}
            </p>
          </div>
        </div>
      </section>

      <div className="bg-canvas rounded-card border-hairline flex flex-wrap items-center gap-2 border p-3">
        <SearchField
          placeholder="名前・紹介コードで検索"
          aria-label="名前・紹介コードで検索"
          value={query}
          onChange={(value) => { setQuery(value); setPage(1) }}
          onClear={() => { setQuery(''); setPage(1) }}
          className="min-w-52 flex-1"
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
        {/* 作る操作は行の左。たまに使う CSV は右に残す。 */}
        <AffiliateButton variant="primary" onClick={() => setCreateOpen(true)}>
          ＋ アフィリエイターを作る
        </AffiliateButton>
        <AffiliateButton onClick={exportAffiliatesCsv} disabled={shownRows.length === 0} className="ml-auto">
          CSVで書き出す
        </AffiliateButton>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          selected={filters.length === 0}
          onChange={() => { setFilters([]); setPage(1) }}
        >
          すべて
        </FilterChip>
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
          accountId={accountId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { void loadList() }}
        />
      )}

      <AffiliateArchiveDialog
        target={archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onChanged={() => { void loadList() }}
      />

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
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState
            kind="empty"
            title="紹介者はまだ登録されていません"
            description="紹介してくれる方を登録すると、専用リンクと成果を管理できます。"
            action={<Button variant="primary" onClick={() => setCreateOpen(true)}>＋ アフィリエイターを作る</Button>}
          />
        </div>
      ) : shownRows.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState
            kind="empty"
            title="絞り込みに合う紹介者がいません"
            description="検索語を変えるか、絞り込みの札を外すと表示されます。"
          />
        </div>
      ) : (
        <div className="bg-canvas rounded-card border-hairline overflow-x-auto border">
          <table className="w-full min-w-[720px]">
            <thead>
              <TableHeadRow>
                {/*
                  表の外側の余白は左右で同じにする（左端 pl-5・右端 pr-5）。
                  操作列は中身の幅で固定する。残りは数値の列で吸収する。
                */}
                <Th className="pl-5">アフィリエイター</Th>
                <Th align="right">紹介リンク</Th>
                <Th align="right">友だち追加</Th>
                <Th align="right">成果</Th>
                <Th align="right">報酬</Th>
                <Th align="center" className="w-44 pr-5">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {pagedRows.map((row) => {
                const isExpanded = selectedId === row.id
                const settlement = accountSettlement?.affiliates.find((item) => item.affiliateId === row.id) ?? null
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`cursor-pointer transition-colors ${isExpanded ? 'bg-canvas-sunken' : 'hover:bg-canvas-sunken'}`}
                      onClick={() => handleRowClick(row.id)}
                    >
                      <td className="text-ink py-3 pr-4 pl-5 text-sm font-medium">
                        <span className="block truncate" title={row.name}>{row.name}</span>
                        <span className="text-action mt-0.5 block font-mono text-xs">{row.code}</span>
                        {/* #670 16: 状態は名前の下の札で出す。操作セルに置くと操作と読める。 */}
                        <span className="mt-1 block"><Chip tone={row.isActive ? 'ok' : 'neutral'}>{row.isActive ? '計測中' : '停止中'}</Chip></span>
                      </td>
                      <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                        {formatNumber(row.linkCount)}本
                      </td>
                      <td className="text-action px-4 py-3 text-right text-sm font-semibold tabular-nums">
                        {formatNumber(row.friendAdds)}人
                      </td>
                      <td className="text-ink px-4 py-3 text-right text-sm font-semibold tabular-nums">
                        {formatNumber(row.totalConversions)}件
                      </td>
                      <td className="text-ink px-4 py-3 text-right text-sm font-semibold tabular-nums">
                        {formatYen(row.rewardAmount)}
                      </td>
                      {/* 行の操作は枠つきボタン＋「…」へ集約。紹介を止めるは確認画面つき。 */}
                      <td className="py-3 pr-5 pl-4 text-center" onClick={(event) => event.stopPropagation()}>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <AffiliateButton
                            aria-label={isExpanded ? `${row.name}の成果を閉じる` : `${row.name}の成果を見る`}
                            onClick={() => handleRowClick(row.id)}
                          >
                            {isExpanded ? '閉じる' : '成果を見る'}
                          </AffiliateButton>
                          <span className="relative inline-flex">
                            <MoreAction
                              label={`${row.name}のその他操作`}
                              aria-expanded={rowMenuId === row.id}
                              onClick={() => setRowMenuId((current) => (current === row.id ? null : row.id))}
                            />
                            <ActionMenu
                              open={rowMenuId === row.id}
                              ariaLabel={`${row.name}の操作`}
                              onClose={() => setRowMenuId(null)}
                              items={[
                                {
                                  id: 'archive',
                                  label: '紹介を止める',
                                  onSelect: () => setArchiveTarget({ id: row.id, name: row.name }),
                                },
                              ]}
                            />
                          </span>
                        </div>
                      </td>
                    </tr>

                    {/* Detail expansion row */}
                    {isExpanded && (
                      <tr key={`${row.id}-detail`}>
                        <td colSpan={6} className="bg-canvas-sunken border-hairline border-t px-6 py-5">
                          {detailLoading ? (
                            <p className="text-sm text-ink-faint">読み込み中...</p>
                          ) : (
                            <div className="flex flex-col gap-6">

                              {/* 支払いの取り決め。報酬額そのものは案件側で持つが、
                                  連絡先と支払い条件は人に紐づく。 */}
                              <SettlementEditor
                                affiliate={row}
                                onSaved={() => {
                                  void loadList()
                                }}
                              />

                              <section className="rounded-card border-hairline order-first bg-canvas border p-4" aria-label="次の支払い">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="text-ink text-sm font-bold">次の支払い</p>
                                    <p className="text-ink-faint mt-1 text-xs">今回の締め対象と、本人が登録した振込先の有無</p>
                                  </div>
                                  <AffiliateButton href="/conversions?tab=payment">支払いを開く</AffiliateButton>
                                </div>
                                {paymentState === 'loading' ? (
                                  <p className="text-ink-faint mt-4 text-sm">締め対象を確認しています…</p>
                                ) : paymentState === 'error' ? (
                                  <p className="text-danger mt-4 text-sm">締め対象を確認できませんでした。金額を0とは扱いません。</p>
                                ) : settlement ? (
                                  <dl className="mt-4 grid gap-3 sm:grid-cols-4">
                                    <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">今回の金額</dt><dd className="text-ink mt-1 font-medium tabular-nums">{formatYen(settlement.amount)}</dd></div>
                                    <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">成果</dt><dd className="text-ink mt-1 font-medium tabular-nums">{formatNumber(settlement.conversionCount)}件</dd></div>
                                    <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">締め日</dt><dd className="text-ink mt-1 font-medium">{formatDate(accountSettlement?.periodTo ?? null)}</dd></div>
                                    <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">振込先</dt><dd className={`mt-1 font-medium ${settlement.bankProfileRegistered ? 'text-success' : 'text-warning'}`}>{settlement.bankProfileRegistered ? '登録済み' : '未登録'}</dd><p className="text-ink-faint mt-1 text-xs">口座番号は本人だけに表示</p></div>
                                  </dl>
                                ) : (
                                  <p className="text-ink-faint mt-4 text-sm">この方には、今回締められる報酬がありません。</p>
                                )}
                              </section>

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
                                  {detailError ? (
                                    <AffiliateButton onClick={() => { void loadDetail(row.id, detailGenRef.current) }} className="mt-3">
                                      もう一度読み込む
                                    </AffiliateButton>
                                  ) : null}
                                </div>
                              )}

                              {/* v2 summary cards */}
                              {report && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                  <div className="bg-canvas rounded-control p-4 border border-hairline">
                                    <p className="text-xs text-ink-secondary">{CLICK_SUMMARY_LABEL}</p>
                                    <p className="text-2xl font-bold text-ink mt-1">{formatNumber(report.clicks)}</p>
                                  </div>
                                  <div className="bg-canvas rounded-control p-4 border border-hairline">
                                    <p className="text-xs text-ink-secondary">友だち追加</p>
                                    <p className="text-2xl font-bold text-status-info mt-1">{formatNumber(report.friendAdds)}</p>
                                  </div>
                                  <div className="bg-canvas rounded-control p-4 border border-hairline">
                                    <p className="text-xs text-ink-secondary">CV 件数（却下除く）</p>
                                    <p className="text-2xl font-bold text-ink mt-1">{formatNumber(report.conversions)}</p>
                                  </div>
                                  <div className="bg-success-bg rounded-control p-4 border border-hairline">
                                    <p className="text-xs text-ink-secondary">確定報酬</p>
                                    <p className="text-2xl font-bold text-success mt-1">{formatYen(report.confirmedReward)}</p>
                                    <p className="text-[11px] text-ink-secondary mt-1">
                                      承認済み {formatNumber(report.conversionsApproved)}件 / 審査中 {formatNumber(report.conversionsPending)}件 / 却下 {formatNumber(report.conversionsRejected)}件
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* Per-offer breakdown */}
                              {report && report.byOffer.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-ink-secondary uppercase mb-2">案件別内訳</p>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-[560px] text-sm">
                                      <thead>
                                        <tr className="text-left text-xs text-ink-faint">
                                          <th className="pb-1 pr-4">案件</th>
                                          <th className="pb-1 pr-4 text-right">報酬単価</th>
                                          <th className="pb-1 pr-4 text-right">承認済み</th>
                                          <th className="pb-1 pr-4 text-right">審査中</th>
                                          <th className="pb-1 text-right">確定報酬</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-hairline">
                                        {report.byOffer.map((o) => (
                                          <tr key={o.offerId}>
                                            <td className="py-1 pr-4 text-ink">{o.offerName}</td>
                                            <td className="py-1 pr-4 text-right text-ink-secondary">{formatYen(o.rewardAmount)}</td>
                                            <td className="py-1 pr-4 text-right font-semibold text-ink">{formatNumber(o.conversionsApproved)}</td>
                                            <td className="py-1 pr-4 text-right text-ink-secondary">{formatNumber(o.conversionsPending)}</td>
                                            <td className="py-1 text-right font-semibold text-success">{formatYen(o.confirmedReward)}</td>
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
                                  <p className="text-xs font-semibold text-warning uppercase mb-2">
                                    {duplicateFlagHeading(report.duplicateFlags.length)}
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {report.duplicateFlags.map((f) => (
                                      <span
                                        key={f.friendId}
                                        className="inline-flex items-center gap-1 px-2 py-1 bg-status-warn-soft border border-status-warn rounded-mini text-xs text-status-warn-deep"
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
                                  <p className="text-xs font-semibold text-ink-secondary uppercase mb-2">CV ポイント別内訳</p>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-[400px] text-sm">
                                      <thead>
                                        <tr className="text-left text-xs text-ink-faint">
                                          <th className="pb-1 pr-4">ポイント名</th>
                                          <th className="pb-1 pr-4 text-right">件数</th>
                                          <th className="pb-1 text-right">売上合計</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-hairline">
                                        {report.conversionsByPoint.map((p) => (
                                          <tr key={p.conversionPointId}>
                                            <td className="py-1 pr-4 text-ink">{p.name}</td>
                                            <td className="py-1 pr-4 text-right font-semibold text-ink">{p.count}</td>
                                            <td className="py-1 text-right text-ink-secondary">{formatYen(p.value)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* Links table */}
                              {/*
                                R292: 既存リンクの配布URLとコピー。作ったときの
                                画面を閉じたあとでも、同じ有効リンクを取り出せる。
                                見出しは増やさない（直書きの借金を増やさない）。
                              */}
                              {links.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-ink-secondary uppercase mb-2">
                                    リンク別クリック ({links.length} 本)
                                  </p>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-[560px] text-sm">
                                      <thead>
                                        <tr className="text-left text-xs text-ink-faint">
                                          <th className="pb-1 pr-4">{LINK_CODE_HEADING}</th>
                                          <th className="pb-1 pr-4">ラベル</th>
                                          <th className="pb-1 pr-4">案件</th>
                                          <th className="pb-1 pr-4 text-right">クリック</th>
                                          <th className="pb-1">状態</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-hairline">
                                        {links.map((link) => {
                                          const linkCode = link.ref_code
                                          const url = distributionUrl(linkCode, linkBaseUrl)
                                          return (
                                          <tr key={link.id}>
                                            <td className="py-1 pr-4">
                                              <span className="font-mono text-status-info">{linkCode}</span>
                                              {url ? (
                                                <span className="mt-1 flex items-center gap-2">
                                                  <span className="block max-w-56 truncate font-mono text-xs text-ink-secondary" title={url}>
                                                    {url}
                                                  </span>
                                                  <AffiliateButton
                                                    aria-label={`${linkCode}の配布URLをコピー`}
                                                    onClick={() => { void copyLinkUrl(link) }}
                                                  >
                                                    {copiedLink(link.id) ? '✓ コピーしました' : 'コピー'}
                                                  </AffiliateButton>
                                                  <CopyAnnounce show={copiedLink(link.id)} />
                                                </span>
                                              ) : null}
                                            </td>
                                            <td className="py-1 pr-4 text-ink-secondary">{link.label ?? '—'}</td>
                                            <td className="py-1 pr-4">
                                              {link.offer_name ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-pill text-xs font-medium bg-status-info-soft text-status-info">
                                                  {link.offer_name}
                                                </span>
                                              ) : <span className="text-ink-faint">—</span>}
                                            </td>
                                            <td className="py-1 pr-4 text-right font-semibold text-ink">{formatNumber(link.click_count)}</td>
                                            <td className="py-1">
                                              {link.is_active
                                                /* #670 22: green-600 は白地で 3.3:1 しかなく AA 未満。共通トークンの濃い緑へ。 */
                                                ? <span className="text-xs font-semibold text-success">有効</span>
                                                : <span className="text-xs text-ink-faint">無効</span>
                                              }
                                            </td>
                                          </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* Journeys */}
                              <div>
                                <p className="text-xs font-semibold text-ink-secondary uppercase mb-2">
                                  帰属ジャーニー ({journeys.length} 件{journeyMore ? '+' : ''})
                                </p>
                                {journeyLoading ? (
                                  <p className="text-sm text-ink-faint">読み込み中...</p>
                                ) : journeyError && journeys.length === 0 ? (
                                  <div>
                                    <p className="text-sm text-danger">動線を読み込めませんでした。記録は消えていません。</p>
                                    <AffiliateButton onClick={() => { void loadJourneys(row.id, detailGenRef.current) }} className="mt-3">
                                      もう一度読み込む
                                    </AffiliateButton>
                                  </div>
                                ) : journeys.length === 0 ? (
                                  <p className="text-sm text-ink-faint">帰属された友だちがまだいません</p>
                                ) : (
                                  <>
                                    <div className="overflow-x-auto">
                                      <table className="min-w-[640px] text-sm">
                                        <thead>
                                          <tr className="text-left text-xs text-ink-faint">
                                            <th className="pb-1 pr-4">友だち</th>
                                            <th className="pb-1 pr-4">追加日</th>
                                            <th className="pb-1 pr-4">{LINK_CODE_HEADING}</th>
                                            <th className="pb-1 pr-4 text-right">タッチ</th>
                                            <th className="pb-1 pr-4 text-right">フォーム</th>
                                            <th className="pb-1 pr-4 text-right">CV</th>
                                            <th className="pb-1">最終行動</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-hairline">
                                          {journeys.map((j) => {
                                            const isDup = report?.duplicateFlags.some((f) => f.friendId === j.friendId)
                                            return (
                                              <tr key={j.friendId} className={isDup ? 'bg-status-warn-soft' : ''}>
                                                <td className={`py-1 pr-4 ${j.displayName ? 'text-ink' : 'text-ink-faint italic'}`}>
                                                  {isDup && <span className="mr-1">⚠</span>}
                                                  {personNameText(j.displayName)}
                                                </td>
                                                <td className="py-1 pr-4 text-ink-secondary">{formatDate(j.addedAt)}</td>
                                                <td className="py-1 pr-4 font-mono text-xs text-status-info">{j.refCode ?? '—'}</td>
                                                <td className="py-1 pr-4 text-right text-ink-secondary">{j.touchCount}</td>
                                                <td className="py-1 pr-4 text-right text-ink-secondary">{j.formCount}</td>
                                                <td className="py-1 pr-4 text-right font-semibold text-ink">{j.conversionCount}</td>
                                                <td className="py-1 text-ink-faint text-xs">{formatDate(j.lastEventAt)}</td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                    {journeyError && !journeyLoadingMore ? (
                                      <p className="text-danger mt-3 text-xs">続きを読み込めませんでした。「さらに読み込む」で試し直せます。</p>
                                    ) : null}
                                    {journeyMore && (
                                      <button
                                        onClick={() => { void loadMoreJourneys(row.id, detailGenRef.current) }}
                                        disabled={journeyLoadingMore}
                                        className="mt-3 px-4 py-2 text-sm text-action hover:bg-status-info-soft disabled:opacity-50 rounded-mini border border-status-info-soft"
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

export function CreateAffiliateModal({
  accountId,
  onClose,
  onCreated,
}: {
  accountId: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<FriendOption[]>([])
  const [searching, setSearching] = useState(false)
  const [suggestDismissed, setSuggestDismissed] = useState(false)
  // R294: 0件と失敗を候補枠の中で言い分けるための状態。
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchedTerm, setSearchedTerm] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<FriendOption | null>(null)
  const [commissionRate, setCommissionRate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null)
  const { copied, copy } = useCopy()

  // Incremental friend search (debounced). Skipped once a friend is selected.
  useEffect(() => {
    if (selected) return
    const term = search.trim()
    if (!term) { setOptions([]); setSearchError(null); setSearchedTerm(null); return }
    let cancelled = false
    setSearching(true)
    setSearchError(null)
    const t = setTimeout(async () => {
      try {
        const res = await api.friends.list({ search: term, limit: 20, includeTags: false })
        if (cancelled) return
        if (res.success) {
          setOptions(
            res.data.items.map((f) => ({ id: f.id, displayName: f.displayName })),
          )
          setSearchError(null)
        } else {
          // R294: 失敗を黙らせない。候補枠の中で再試行を出す。
          setOptions([])
          setSearchError('候補を読み込めませんでした')
        }
      } catch {
        if (cancelled) return
        setOptions([])
        setSearchError('候補を読み込めませんでした')
      }
      finally {
        if (cancelled) return
        setSearchedTerm(term)
        setSearching(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search, selected, retryNonce])

  // R294: 検索語・状態がそろったら候補枠を開いたままにする。0件でも
  // 「該当なし」を出すため、候補があるときだけ開く作りはやめる。
  const searchTerm = search.trim()
  const suggestOpen = !suggestDismissed
    && Boolean(searchTerm)
    && (searching || searchError !== null || searchedTerm === searchTerm || options.length > 0)
  const retrySearch = useCallback(() => {
    setSuggestDismissed(false)
    setRetryNonce((n) => n + 1)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    setFormError(null)
    if (!selected) {
      setFormError('友だちを選択してください')
      return
    }
    const rate = commissionRate.trim() === '' ? undefined : Number(commissionRate)
    if (rate !== undefined && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
      setFormError('報酬率は0から100の間で入力してください')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.affiliates.create({
        friendId: selected.id,
        commissionRate: rate,
        lineAccountId: accountId ?? undefined,
      })
      if (!res.success) {
        // 409 → friend already an affiliate; surface the server message.
        setFormError(res.error ?? '作成に失敗しました。通信を確かめて、もう一度お試しください。')
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
      setFormError(e instanceof Error ? e.message : '作成に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, selected, commissionRate, accountId, onCreated, onClose])

  const handleCopy = useCallback(async () => {
    if (!issuedUrl) return
    await copy(issuedUrl)
    /* clipboard unavailable — user can select manually */
  }, [issuedUrl, copy])

  /*
    R295: 手作りの窓をやめ、共通の窓（Dialog）を使う。初期フォーカス・
    Tab の循環・Escape・起動元への復帰は共通部品が持つ。
    成功画面のフッターに「閉じる」は置かない（右上の×だけ。監査7 #809）。
  */
  return (
    <Dialog
      open
      title="アフィリエイター新規作成"
      busy={submitting}
      onCancel={onClose}
      footer={issuedUrl ? (
        <div className="border-hairline flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button variant="primary" onClick={() => { void handleCopy() }} done={copied()} doneLabel="コピーしました">
            コピー
          </Button>
          <CopyAnnounce show={copied()} />
        </div>
      ) : (
        <div className="border-hairline flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={() => { void handleSubmit() }}
            disabled={submitting || !selected} busy={submitting} busyLabel="作成中...">作る
          </Button>
        </div>
      )}
    >
        {issuedUrl ? (
          // ── Success state: show issued link with a copy button ────────────
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">
              アフィリエイターを作成し、初期リンクを発行しました。
            </p>
            <input
              readOnly
              value={issuedUrl}
              aria-label="発行した初期リンク"
              className="border-hairline rounded-control bg-canvas-sunken text-ink w-full px-3 py-2 font-mono text-sm"
            />
          </div>
        ) : (
          // ── Form state ────────────────────────────────────────────────────
          <div className="space-y-4">
            {/* Friend selector */}
            <div>
              <label htmlFor="aff-friend-search" className="mb-1 block text-sm font-medium text-ink-secondary">
                LINE 友だち <span className="text-danger">*</span>
              </label>
              {selected ? (
                <div className="flex items-center justify-between rounded-control border border-hairline bg-canvas-sunken px-3 py-2">
                  <span className="text-sm text-ink">
                    {selected.displayName ?? <span className="italic text-ink-faint">不明</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setSelected(null); setSearch('') }}
                    className="text-xs text-action hover:underline"
                  >
                    変更
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    ref={searchInputRef}
                    id="aff-friend-search"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setSuggestDismissed(false) }}
                    placeholder="名前で検索..."
                    className="w-full rounded-control border border-hairline px-3 py-2 text-sm"
                  />
                  <MenuPortal
                    open={suggestOpen}
                    align="start"
                    matchWidth
                    getAnchor={() => searchInputRef.current}
                    onClose={() => setSuggestDismissed(true)}
                  >
                    <div
                      className="max-h-56 overflow-y-auto rounded-control border border-hairline bg-canvas shadow-float"
                      // 最上層では absolute 指定を無効にする（位置は器が決める）。
                      style={{ position: 'static', width: '100%' }}
                    >
                      {searching ? (
                        <div className="px-3 py-2 text-sm text-ink-faint">検索中...</div>
                      ) : searchError !== null ? (
                        <div className="px-3 py-2 text-sm">
                          <p className="text-danger">{searchError}</p>
                          <button
                            type="button"
                            onClick={retrySearch}
                            className="text-action mt-1 text-xs hover:underline"
                          >
                            もう一度試す
                          </button>
                        </div>
                      ) : options.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-ink-faint">該当なし。検索語を変えてお試しください。</div>
                      ) : (
                        options.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => { setSelected(f); setOptions([]) }}
                            className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-accent-soft"
                          >
                            {f.displayName ?? <span className="italic text-ink-faint">不明</span>}
                          </button>
                        ))
                      )}
                    </div>
                  </MenuPortal>
                </div>
              )}
            </div>

            {/* Commission rate */}
            <div>
              <label htmlFor="aff-commission-rate" className="mb-1 block text-sm font-medium text-ink-secondary">
                報酬率（%・省略可）
              </label>
              <div className="relative">
                <input
                  id="aff-commission-rate"
                  type="number"
                  min={0}
                  step="0.1"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(e.target.value)}
                  placeholder="例: 10"
                  className="w-full rounded-control border border-hairline px-3 py-2 pr-8 text-sm"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">%</span>
              </div>
            </div>

            {/* Random-code notice */}
            <p className="text-xs text-ink-faint">
              アフィリコードは推測されないよう自動でランダム生成されます（手入力は不要）。
            </p>

            {formError && (
              <Notice tone="danger" message={formError} />
            )}
          </div>
        )}
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Offers / approvals — moved from the former /affiliate-offers page
// ─────────────────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return formatDay(iso)
}

function formatYenNullable(n: number | null): string {
  if (n === null) return '—'
  return `¥${formatNumber(Math.round(n))}`
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
  // R286: 読み上げの項目名。見えている項目名と入力欄を htmlFor・id で結ぶ。
  const fieldId = useId()
  const nameId = `${fieldId}-name`
  const descriptionId = `${fieldId}-description`
  const rewardAmountId = `${fieldId}-reward-amount`
  const rewardMilesId = `${fieldId}-reward-miles`
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

  // 決まりの欄（#823）。編集では今の版で埋める。読み込めるまでは
  // 差分に含めない（読み込めないまま保存して上限を消さないため）。
  const [terms, setTerms] = useState<OfferTermsFieldValues>(EMPTY_TERMS)
  const [termsBase, setTermsBase] = useState<ParsedOfferTerms | null>(null)
  const [termsLoaded, setTermsLoaded] = useState(!initial)

  useEffect(() => {
    if (!initial) return
    let cancelled = false
    void api.affiliateOffers.capStatus(initial.id)
      .then((res) => {
        if (cancelled || !res.success || !res.data) return
        const version = res.data.version
        const base: ParsedOfferTerms = {
          windowDays: version?.windowDays ?? 30,
          capTotal: version?.capTotal ?? null,
          capMonthlyPerAffiliate: version?.capMonthlyPerAffiliate ?? null,
          receptionFrom: version?.receptionFrom ?? null,
          receptionTo: version?.receptionTo ?? null,
        }
        if (cancelled) return
        setTermsBase(base)
        setTerms({
          windowDays: String(base.windowDays ?? 30),
          capTotal: base.capTotal != null ? String(base.capTotal) : '',
          capMonthly: base.capMonthlyPerAffiliate != null ? String(base.capMonthlyPerAffiliate) : '',
          receptionFrom: toDateInput(base.receptionFrom),
          receptionTo: toDateInput(base.receptionTo),
        })
        setTermsLoaded(true)
      })
      .catch(() => {
        // 決まりが読めなくても、名前・報酬の編集はできる。決まりの差分は送らない。
        if (!cancelled) setTermsLoaded(false)
      })
    return () => {
      cancelled = true
    }
  }, [initial])

  // 選べるタグ・シナリオは「いま選んでいるLINEアカウントの有効なもの」だけに
  // 絞る（#798）。別アカウントのものを選ばせると保存時にサーバーが止める。
  // アカウント未選択のときは候補を出さない（先にアカウントを選ばせる）。
  // 既存案件に古い不正参照が残っているときは、選択中の値だけ別枠で見せて
  // 直せるようにする（黙って消すと保存のたびに参照が変わる）。
  const accountTags = tags.filter(
    (t) => lineAccountId !== '' && t.lineAccountId === lineAccountId && (t.status ?? 'active') === 'active',
  )
  const accountScenarios = scenarios.filter(
    (s) => lineAccountId !== '' && s.lineAccountId === lineAccountId && s.isActive !== false,
  )
  const tagIdStale = tagId !== '' && !accountTags.some((t) => t.id === tagId)
  const scenarioIdStale = scenarioId !== '' && !accountScenarios.some((s) => s.id === scenarioId)
  const staleTagName = tags.find((t) => t.id === tagId)?.name
  const staleScenarioName = scenarios.find((s) => s.id === scenarioId)?.name

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
    // 決まりの欄（#823）。壊れた値は欄の下ではなく箱の誤りで見せる。
    const parsed = parseOfferTermsInput(terms)
    if (parsed.error) {
      setFormError(parsed.error)
      return
    }
    // 編集では変えた決まりだけ送る。変えていない保存で版を増やさない。
    // 読み込めなかったときは決まりを送らない（上限の消失を防ぐ）。
    const termsDiff: ParsedOfferTerms = {}
    if (isEdit && termsLoaded && termsBase) {
      if (parsed.terms.windowDays !== undefined && parsed.terms.windowDays !== termsBase.windowDays) {
        termsDiff.windowDays = parsed.terms.windowDays
      }
      if (parsed.terms.capTotal !== termsBase.capTotal) {
        termsDiff.capTotal = parsed.terms.capTotal
      }
      if (parsed.terms.capMonthlyPerAffiliate !== termsBase.capMonthlyPerAffiliate) {
        termsDiff.capMonthlyPerAffiliate = parsed.terms.capMonthlyPerAffiliate
      }
      if (parsed.terms.receptionFrom !== termsBase.receptionFrom) {
        termsDiff.receptionFrom = parsed.terms.receptionFrom
      }
      if (parsed.terms.receptionTo !== termsBase.receptionTo) {
        termsDiff.receptionTo = parsed.terms.receptionTo
      }
    }

    setSubmitting(true)
    try {
      if (isEdit && initial) {
        const res = await api.affiliateOffers.update(initial.id, {
          name: name.trim(),
          description: description.trim() || null,
          rewardAmount: reward,
          rewardMiles: miles,
          ...termsDiff,
          lineAccountId: lineAccountId || null,
          tagId: tagId || null,
          scenarioId: scenarioId || null,
          isActive,
        })
        if (!res.success) {
          // 失敗応答は非2xxで fetchApi が例外にするので、ここに来るのは
          // 2xx なのに success:false の形だけ。それでも文言があれば見せる。
          setFormError((res as { error?: string }).error ?? '更新に失敗しました。通信を確かめて、もう一度お試しください。')
          setSubmitting(false)
          return
        }
      } else {
        const res = await api.affiliateOffers.create({
          name: name.trim(),
          description: description.trim() || null,
          rewardAmount: reward,
          rewardMiles: miles,
          windowDays: parsed.terms.windowDays,
          capTotal: parsed.terms.capTotal,
          capMonthlyPerAffiliate: parsed.terms.capMonthlyPerAffiliate,
          receptionFrom: parsed.terms.receptionFrom,
          receptionTo: parsed.terms.receptionTo,
          lineAccountId: lineAccountId || null,
          tagId: tagId || null,
          scenarioId: scenarioId || null,
        })
        if (!res.success) {
          setFormError((res as { error?: string }).error ?? '作成に失敗しました。通信を確かめて、もう一度お試しください。')
          setSubmitting(false)
          return
        }
      }
      onSaved()
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, name, description, rewardAmount, rewardMiles, terms, termsLoaded, termsBase, lineAccountId, tagId, scenarioId, isActive, isEdit, initial, onSaved, onClose])

  return (
    <Dialog
      open
      title={isEdit ? '案件を編集' : '案件を新規作成'}
      busy={submitting}
      error={formError ?? undefined}
      confirmLabel={isEdit ? '更新' : '作成'}
      cancelLabel="キャンセル"
      onConfirm={() => { void handleSubmit() }}
      onCancel={onClose}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor={nameId} className="text-ink-secondary mb-1 block text-xs font-medium">
            案件名 <span className="text-danger">*</span>
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 無料体験申込"
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor={descriptionId} className="text-ink-secondary mb-1 block text-xs font-medium">説明</label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="案件の説明（任意）"
            className="border-hairline rounded-control bg-canvas text-ink w-full resize-none border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor={rewardAmountId} className="text-ink-secondary mb-1 block text-xs font-medium">報酬額（円）</label>
          <input
            id={rewardAmountId}
            type="number"
            min="0"
            step="1"
            value={rewardAmount}
            onChange={(e) => setRewardAmount(e.target.value)}
            placeholder="例: 3000"
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor={rewardMilesId} className="text-ink-secondary mb-1 block text-xs font-medium">成果承認時の付与マイル</label>
          <input
            id={rewardMilesId}
            type="number"
            min="0"
            step="1"
            value={rewardMiles}
            onChange={(e) => setRewardMiles(e.target.value)}
            placeholder="例: 500"
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm"
          />
          <p className="text-ink-faint mt-1 text-[11px]">承認された紹介1件ごとに紹介者へ付与します</p>
        </div>

        <OfferTermsFields values={terms} onChange={setTerms} />

        <div>
          <label className="text-ink-secondary mb-1 block text-xs font-medium">誘導 LINE アカウント</label>
          <Select
            aria-label="誘導 LINE アカウント"
            value={lineAccountId}
            onChange={(value) => setLineAccountId(value)}
            options={[{ value: '', label: '— 選択しない —' }, ...accounts.map((acc) => ({ value: acc.id, label: acc.name }))]}
            className="w-full"
            size="full"
          />
        </div>

        <div>
          <label className="text-ink-secondary mb-1 block text-xs font-medium">タグ</label>
          <Select
            aria-label="タグ"
            value={tagId}
            onChange={(value) => setTagId(value)}
            options={[
              { value: '', label: '— 選択しない —' },
              ...accountTags.map((tag) => ({ value: tag.id, label: tag.name })),
              ...(tagIdStale ? [{ value: tagId, label: `${staleTagName ?? tagId}（このアカウントでは使えません）` }] : []),
            ]}
            className="w-full"
            size="full"
          />
        </div>

        <div>
          <label className="text-ink-secondary mb-1 block text-xs font-medium">シナリオ</label>
          <Select
            aria-label="シナリオ"
            value={scenarioId}
            onChange={(value) => setScenarioId(value)}
            options={[
              { value: '', label: '— 選択しない —' },
              ...accountScenarios.map((s) => ({ value: s.id, label: s.name })),
              ...(scenarioIdStale ? [{ value: scenarioId, label: `${staleScenarioName ?? scenarioId}（このアカウントでは使えません）` }] : []),
            ]}
            className="w-full"
            size="full"
          />
        </div>

        {isEdit && (
          <Toggle
            checked={isActive}
            onChange={setIsActive}
            label={isActive ? '有効' : '無効'}
          />
        )}
      </div>
    </Dialog>
  )
}

// ── Approval queue ───────────────────────────────────────────────────────────

type ApprovalStatus = 'pending' | 'approved' | 'rejected'

// アカウント絞りの特別な値(N-218)。アカウント未割当の成果地点だけを
// 集める札で、実IDとは衝突しない文字列にする。
const APPROVAL_FILTER_ALL = 'all'
const APPROVAL_FILTER_UNASSIGNED = '__unassigned__'

export function ApprovalQueue({
  focusAffiliateId,
}: {
  /** R291: 停止前の確認から来たとき、最初から絞る紹介者。 */
  focusAffiliateId?: string | null
} = {}) {
  const [status, setStatus] = useState<ApprovalStatus>('pending')
  // R291: 紹介者の停止前に「認めるのを待っている成果」の明細を見るための絞り。
  const [affiliateFilter, setAffiliateFilter] = useState<string | null>(focusAffiliateId ?? null)
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
  // N-207: 各状態を短い頁が返るまで全部読む。安全弁(状態ごと5000件)で
  // 打ち切った状態だけここに残し、「さらに読み込む」で続きを取る。
  const [truncatedStatuses, setTruncatedStatuses] = useState<ApprovalStatus[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  // N-218: アカウント絞り。選択肢は権限内アカウント( /api/line-accounts は
  // scope 済み)と、読み込んだ行にだけある未割当。
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [accountFilter, setAccountFilter] = useState<string>(APPROVAL_FILTER_ALL)

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const statuses = ['pending', 'approved', 'rejected'] as const
      const results = await Promise.all(statuses.map((value) => listAllConversionApprovals(value)))
      setItems(results.flatMap((result) => result.items))
      setTruncatedStatuses(statuses.filter((value, index) => results[index].truncated))
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みエラー')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadItems() }, [loadItems])

  // 安全弁で止まった状態の続きを読む。既読みの件数を offset にして
  // 次の頁から取り、同じ成果が重ならないよう eventId で除く(N-207)。
  const loadMoreItems = useCallback(async () => {
    if (loadingMore || truncatedStatuses.length === 0) return
    setLoadingMore(true)
    setError(null)
    try {
      const results = await Promise.all(
        truncatedStatuses.map(async (value) => {
          const already = items.filter((item) => item.approvalStatus === value).length
          const result = await listAllConversionApprovals(value, already)
          return { status: value, ...result }
        }),
      )
      setItems((current) => {
        const seen = new Set(current.map((item) => item.eventId))
        const additions = results.flatMap((result) => result.items).filter((item) => !seen.has(item.eventId))
        return [...current, ...additions]
      })
      setTruncatedStatuses(results.filter((result) => result.truncated).map((result) => result.status))
    } catch (e) {
      setError(e instanceof Error ? e.message : '続きを読み込めませんでした')
    } finally {
      setLoadingMore(false)
    }
  }, [items, loadingMore, truncatedStatuses])

  useEffect(() => {
    let cancelled = false
    // アカウント一覧が取れなくてもキュー自体は全件で使える。
    // その場合は行に載っているアカウントだけが選択肢に出る。
    const load = async () => {
      try {
        const res = await api.lineAccounts.list()
        if (!cancelled && res.success && Array.isArray(res.data)) {
          setAccounts(res.data.map((account) => ({ id: account.id, name: account.name })))
        }
      } catch {
        // 一覧の口が無い・失敗しても絞り以外は動かす
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const handleApprove = useCallback(async (eventId: string, expectedStatus: 'pending' | 'approved' | 'rejected') => {
    if (actioning) return
    setActioning(eventId)
    setError(null)
    try {
      const res = await api.conversionApprovals.approve(eventId, expectedStatus)
      if (res.success) {
        await loadItems()
      } else if (res.code === 'approval_conflict') {
        setError('ほかの人が先に判断しました。一覧を読み直しました。')
        await loadItems()
      } else {
        setError(res.error ?? '承認に失敗しました。通信を確かめて、もう一度お試しください。')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '承認に失敗しました。通信を確かめて、もう一度お試しください。')
    }
    setActioning(null)
  }, [actioning, loadItems])

  const handleReject = useCallback(async (eventId: string, expectedStatus: 'pending' | 'approved' | 'rejected') => {
    if (actioning) return
    setActioning(eventId)
    setError(null)
    try {
      const res = await api.conversionApprovals.reject(eventId, expectedStatus)
      if (res.success) {
        await loadItems()
      } else if (res.code === 'approval_conflict') {
        setError('ほかの人が先に判断しました。一覧を読み直しました。')
        await loadItems()
      } else {
        setError(res.error ?? '却下に失敗しました。通信を確かめて、もう一度お試しください。')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '却下に失敗しました。通信を確かめて、もう一度お試しください。')
    }
    setActioning(null)
  }, [actioning, loadItems])

  type BulkOutcome = 'approved' | 'rejected'
  type BulkResult = {
    action: BulkOutcome
    succeeded: string[]
    conflicted: Array<{ id: string; currentStatus: string }>
    denied: string[]
    failed: Array<{ id: string; error: string }>
  }
  const [bulkConfirm, setBulkConfirm] = useState<{ action: BulkOutcome; items: ConversionApprovalItem[] } | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)

  const nameOf = useCallback((eventId: string) => {
    const item = items.find((entry) => entry.eventId === eventId)
    return item ? personNameText(item.friendName) : eventId
  }, [items])

  const runBulkDecide = useCallback(async (action: BulkOutcome, targets: ConversionApprovalItem[]) => {
    setActioning(action === 'approved' ? 'bulk' : 'bulk-reject')
    setError(null)
    try {
      const res = await api.conversionApprovals.bulkDecide(
        targets.map((item) => ({
          id: item.eventId,
          status: action,
          expectedStatus: item.approvalStatus,
        })),
      )
      await loadItems()
      if (res.success && res.data) {
        setBulkResult({ action, ...res.data })
        const leftovers = res.data.conflicted.length + res.data.denied.length + res.data.failed.length
        if (leftovers === 0) setSelected(new Set())
        else {
          // 残った対象だけ選び直せるようにする。成功分は外す。
          setSelected((current) => {
            const next = new Set<string>()
            for (const eventId of current) {
              if (!res.data!.succeeded.includes(eventId)) next.add(eventId)
            }
            return next
          })
        }
      } else {
        setError(res.error ?? 'まとめて処理できませんでした')
      }
    } catch (e) {
      // m22u R353: 通信などで結果が不明のときは一覧を読み直す。Worker は
      // 途中まで進んだ分を保存しているため、表示と保存状態を合わせる。
      await loadItems()
      setError(e instanceof Error ? e.message : 'まとめて処理できませんでした')
    } finally {
      setBulkConfirm(null)
      setActioning(null)
    }
  }, [loadItems])

  /*
    R291: 紹介者絞りはアカウント絞りの前段。ここを通った行だけが数えられ・
    選ばれ・まとめて処理される（確認窓の対象紹介者・件数と一致する明細）。
  */
  const scopedItems = useMemo(() => (
    affiliateFilter ? items.filter((item) => item.affiliateId === affiliateFilter) : items
  ), [affiliateFilter, items])
  const affiliateFilterName = affiliateFilter
    ? (scopedItems[0]?.affiliateName
      ?? items.find((item) => item.affiliateId === affiliateFilter)?.affiliateName
      ?? null)
    : null

  // N-218: アカウント絞りは一覧・件数・一括操作すべての元にする。
  // ここを通った行だけが数えられ・選ばれ・まとめて処理される。
  const accountItems = useMemo(() => {
    if (accountFilter === APPROVAL_FILTER_ALL) return scopedItems
    if (accountFilter === APPROVAL_FILTER_UNASSIGNED) return scopedItems.filter((item) => !item.lineAccountId)
    return scopedItems.filter((item) => item.lineAccountId === accountFilter)
  }, [accountFilter, scopedItems])

  // 絞りの選択肢。権限内アカウント(lineAccounts.list は scope 済み)へ、
  // 読み込んだ行にだけあるIDと未割当を足す。行が無いアカウントは
  // 選んでも0件にしかならないので、行にあるIDだけを出す。
  const accountOptions = useMemo(() => {
    const nameById = new Map<string, string>()
    for (const account of accounts) nameById.set(account.id, account.name)
    for (const item of items) {
      if (item.lineAccountId && !nameById.has(item.lineAccountId)) {
        nameById.set(item.lineAccountId, item.lineAccountName ?? '名前を確認できません')
      }
    }
    const options = [{ value: APPROVAL_FILTER_ALL, label: 'すべてのアカウント' }]
    for (const [id, name] of nameById) options.push({ value: id, label: name })
    if (items.some((item) => !item.lineAccountId)) {
      options.push({ value: APPROVAL_FILTER_UNASSIGNED, label: 'アカウント未設定' })
    }
    // 絞りを選んだまま対象行が0件になっても、選択肢から消して
    // 空白の札にしない。選んだままの値は最後に残す。
    if (accountFilter !== APPROVAL_FILTER_ALL && !options.some((option) => option.value === accountFilter)) {
      options.push({ value: accountFilter, label: accountFilter === APPROVAL_FILTER_UNASSIGNED ? 'アカウント未設定' : '選択中のアカウント' })
    }
    return options
  }, [accountFilter, accounts, items])

  const retryBulkLeftovers = useCallback(() => {
    if (!bulkResult) return
    const leftoverIds = new Set([
      ...bulkResult.conflicted.map((entry) => entry.id),
      ...bulkResult.denied,
      ...bulkResult.failed.map((entry) => entry.id),
    ])
    // 読み直し後の最新状態で選び直す。競合で状態が変わった対象は
    // 最新の一覧から外れるため、誤って再送しない。
    const retryable = accountItems.filter((item) => leftoverIds.has(item.eventId) && item.approvalStatus === 'pending')
    setBulkResult(null)
    if (retryable.length === 0) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(retryable.map((item) => item.eventId)))
    setBulkConfirm({ action: bulkResult.action, items: retryable })
  }, [bulkResult, accountItems])

  const counts = {
    pending: accountItems.filter((item) => item.approvalStatus === 'pending').length,
    approved: accountItems.filter((item) => item.approvalStatus === 'approved').length,
    rejected: accountItems.filter((item) => item.approvalStatus === 'rejected').length,
  }
  const pendingItems = accountItems.filter((item) => item.approvalStatus === 'pending')
  // IDEA-16: 確認対象は「同じ友だちの重複」だけでなく、同じ注文の重複候補と
  // 返金・取消済みの注文に由来する成果も含める。理由は approvalReviewReasons
  // が集め、行の吹き出しと詳細で根拠ごと見せる。
  const flaggedCount = pendingItems.filter((item) => approvalReviewReasons(item).length > 0).length
  const pendingYen = pendingItems.reduce((sum, item) => sum + (item.value ?? 0), 0)
  const averageWaitDays = pendingItems.length === 0
    ? 0
    : pendingItems.reduce((sum, item) => {
      const createdAt = new Date(item.createdAt).getTime()
      return sum + (Number.isFinite(createdAt) ? Math.max(0, Date.now() - createdAt) / 86_400_000 : 0)
    }, 0) / pendingItems.length

  const shownItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    return accountItems
      .filter((item) => item.approvalStatus === status)
      .filter((item) => !flaggedOnly || approvalReviewReasons(item).length > 0)
      .filter((item) => {
        if (!needle) return true
        return [item.friendName, item.affiliateName, item.offerName, item.conversionPointName, item.orderNumber]
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
  }, [accountItems, flaggedOnly, query, sort, status])

  const approvalPageCount = pageCountOf(shownItems.length, pageSize)
  const currentPage = Math.min(page, approvalPageCount)
  const pagedItems = pageOf(shownItems, currentPage, pageSize)
  // 承認済みタブで付帯動作が未完の行があるときだけ「やり直す」列を出す。
  // 承認自体は済んでいるので、列が要らないページでは列自体を足さない。
  const showActionRetry = status === 'approved'
    && pagedItems.some((item) => item.offerActionsIncomplete)
  const safePendingIds = pagedItems
    .filter((item) => item.approvalStatus === 'pending' && approvalReviewReasons(item).length === 0)
    .map((item) => item.eventId)
  const allSafeSelected = safePendingIds.length > 0
    && safePendingIds.every((eventId) => selected.has(eventId))

  const openBulkConfirm = useCallback((action: BulkOutcome) => {
    if (actioning) return
    // 確認を開く前に選んだ対象を確定する。確認画面に並んだ顔ぶれが
    // 実行対象とずれないようにするため、開いた後は選び直しを受けない。
    const targets = accountItems.filter((item) => selected.has(item.eventId) && item.approvalStatus === 'pending')
    if (targets.length === 0) return
    setBulkResult(null)
    setBulkConfirm({ action, items: targets })
  }, [actioning, accountItems, selected])

  const exportApprovalsCsv = () => {
    // IDEA-16: 注文番号を書き出す。書き出した一覧から注文・返金・支払いの
    // 記録へ辿れるようにするための根拠列。確認状態は理由を並べて出す。
    const header = ['日時', '友だち', 'アフィリエイター', 'アカウント', '案件', '成果地点', '注文番号', '金額', '確認状態']
    const lines = shownItems.map((item) => [
      formatDateTime(item.createdAt),
      personNameText(item.friendName),
      item.affiliateName ?? '名前を取得できませんでした',
      item.lineAccountName ?? 'アカウント未設定',
      item.offerName ?? '未設定',
      item.conversionPointName ?? '未設定',
      item.orderNumber ?? '',
      item.value ?? '',
      approvalReviewReasons(item).join('・') || '問題なし',
    ])
    // 数式対策は共通の csvCell に寄せる（`offer-list-view.ts`）。
    const csv = [header, ...lines].map((line) => line.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `conversion-approvals-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div data-design-node="n5VVTb" data-approval-design="v6" className="flex flex-col gap-4">
      <NoteBar tone={flaggedCount > 0 ? 'warn' : 'info'}>
        {flaggedCount > 0
          ? `${flaggedCount}件は同じ友だちや同じ注文の重複、返金・取り消し済みの注文が疑われます。内容を確認してから判断してください。`
          : '成果を認めると報酬が確定します。確認が必要な成果は、まとめて承認の対象から外れます。'}
      </NoteBar>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          detail=""
          help="同じ友だち・同じ注文の重複や、返金・取り消し済みの注文の成果です"
          loading={loading}
        />
        <KpiCard
          title="認めた成果"
          value={loading || error ? null : counts.approved}
          unit={loading || error ? '' : '件'}
          detail={truncatedStatuses.includes('approved') ? 'まだ読み込んでいない分があります' : '絞り込み条件での全件'}
          loading={loading}
        />
        <KpiCard
          title="待たせている日数"
          value={loading || error ? null : Math.round(averageWaitDays * 10) / 10}
          unit={loading || error ? '' : '日'}
          detail=""
          help="承認待ちの平均日数です"
          loading={loading}
        />
      </div>

      <div className="bg-canvas rounded-card border-hairline flex flex-wrap items-center gap-2 border p-3">
        <SearchField
          placeholder="友だち・紹介者・案件・成果地点・注文番号で検索"
          aria-label="成果承認を検索"
          value={query}
          onChange={(value) => { setQuery(value); setPage(1); setSelected(new Set()) }}
          onClear={() => { setQuery(''); setPage(1); setSelected(new Set()) }}
          className="w-full md:max-w-lg"
        />
        <span className="text-ink-faint whitespace-nowrap text-xs">アカウント</span>
        <Select
          aria-label="成果承認をアカウントで絞る"
          value={accountFilter}
          options={accountOptions}
          onChange={(value) => { setAccountFilter(value); setPage(1); setSelected(new Set()) }}
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
              onClick={() => { openBulkConfirm('approved') }}
              disabled={selected.size === 0 || actioning !== null}
            >
              選んだ{selected.size}件をまとめて認める
            </AffiliateButton>
            <AffiliateButton
              onClick={() => { openBulkConfirm('rejected') }}
              disabled={selected.size === 0 || actioning !== null}
            >
              まとめて却下する
            </AffiliateButton>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {/*
          R291: 停止前の確認から来た紹介者絞り。押すと外れて一覧へ戻れる。
          件数はこの紹介者の承認待ち（確認窓の数と一致）。
        */}
        {affiliateFilter ? (
          <FilterChip
            selected
            onChange={() => { setAffiliateFilter(null); setPage(1); setSelected(new Set()) }}
            count={counts.pending}
            title="紹介者の絞りを外して、すべての成果に戻ります"
          >
            紹介者：{affiliateFilterName ?? '名前を確認できません'}
          </FilterChip>
        ) : null}
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
            count={counts[s]}
          >
            {s === 'pending' ? '認めるのを待っている' : s === 'approved' ? '認めた' : '却下した'}
          </FilterChip>
        ))}
        {status === 'pending' && (
          <FilterChip
            selected={flaggedOnly}
            onChange={(value) => { setFlaggedOnly(value); setPage(1); setSelected(new Set()) }}
            count={flaggedCount}
          >
            確認したほうがよい
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
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState
            kind="empty"
            title="条件に合う成果がありません"
            description="状態や検索語を変えると、ほかの成果を確認できます。"
          />
        </div>
      ) : (
        <div className="bg-canvas rounded-card border-hairline overflow-x-auto border">
          <table className="w-full min-w-[820px]">
            <thead>
              <TableHeadRow>
                <Th>
                  <span className="flex items-center gap-2">
                    {status === 'pending' && (
                      <Checkbox
                        aria-label="このページの確認不要な成果をすべて選ぶ"
                        checked={allSafeSelected}
                        onCheckedChange={(checked) => {
                          setSelected((current) => {
                            const next = new Set(current)
                            for (const eventId of safePendingIds) {
                              if (checked) next.add(eventId)
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
                <Th>アカウント</Th>
                <Th>案件と成果地点</Th>
                <Th align="right">報酬</Th>
                <Th align="center">確認</Th>
                {status === 'pending' && (
                  <Th align="center">決める</Th>
                )}
                {showActionRetry && (
                  <Th align="center">付帯動作</Th>
                )}
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {pagedItems.map((item) => {
                const reviewReasons = approvalReviewReasons(item)
                const needsReview = reviewReasons.length > 0
                return (
                <tr key={item.eventId} className={needsReview ? 'bg-warning-bg' : 'hover:bg-canvas-sunken'}>
                  <td className="text-ink px-4 py-3 text-sm">
                    <div className="flex items-start gap-2">
                    {status === 'pending' && (
                      <Checkbox
                        aria-label={`${personNameText(item.friendName)}の成果を選ぶ`}
                        checked={selected.has(item.eventId)}
                        disabled={needsReview}
                        title={needsReview ? '確認が必要な成果はまとめて承認できません' : undefined}
                        onCheckedChange={(checked) => {
                          setSelected((current) => {
                            const next = new Set(current)
                            if (checked) next.add(item.eventId)
                            else next.delete(item.eventId)
                            return next
                          })
                        }}
                        className="mt-1"
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
                  <td className="text-ink-secondary whitespace-nowrap px-4 py-3 text-sm">
                    {item.lineAccountName ?? 'アカウント未設定'}
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-sm">
                    <span className="text-ink block font-medium">{item.offerName ?? '未設定'}</span>
                    <span className="text-ink-faint mt-0.5 block text-xs">{item.conversionPointName ?? '成果地点は未設定'}</span>
                    {/* R51: 成果金額と確定報酬は別項目。ここは成果の金額。 */}
                    <span className="text-ink-faint mt-0.5 block text-xs">成果額 {formatYenNullable(item.value)}</span>
                  </td>
                  <td className="text-ink px-4 py-3 text-right text-sm font-semibold tabular-nums">
                    {/* R51: 報酬列は確定した報酬額。まだ決まっていなければ「未確定」。 */}
                    {item.rewardAmount != null ? formatYenNullable(item.rewardAmount) : '未確定'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {needsReview ? (
                      <span title={reviewReasons.join('・')}><Chip tone="warn">要確認</Chip></span>
                    ) : (
                      <Chip tone="ok">問題なし</Chip>
                    )}
                  </td>
                  {status === 'pending' && (
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <AffiliateButton
                          onClick={() => { void handleApprove(item.eventId, item.approvalStatus) }}
                          disabled={actioning !== null}
                          variant="primary"
                        >
                          認める
                        </AffiliateButton>
                        <AffiliateButton
                          onClick={() => { void handleReject(item.eventId, item.approvalStatus) }}
                          disabled={actioning !== null}
                          title="却下理由はまだ保存できません"
                        >
                          却下
                        </AffiliateButton>
                        <AffiliateButton onClick={() => setDetailItem(item)}>見る</AffiliateButton>
                      </div>
                    </td>
                  )}
                  {showActionRetry && (
                    <td className="px-4 py-3 text-center">
                      {item.offerActionsIncomplete && (
                        <AffiliateButton
                          onClick={() => { void handleApprove(item.eventId, 'approved') }}
                          disabled={actioning !== null}
                          title="承認は済んでいます。案件に設定されたタグ付与・シナリオ開始だけをやり直します"
                        >
                          付帯動作をやり直す
                        </AffiliateButton>
                      )}
                    </td>
                  )}
                </tr>
                )
              })}
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
              <p className="text-ink-faint mt-1 text-xs">{formatDateTime(detailItem.createdAt)}・{detailItem.lineAccountName ?? 'アカウント未設定'}・{detailItem.conversionPointName ?? '成果地点未設定'}・{formatYenNullable(detailItem.value)}</p>
              {/* IDEA-16: 注文番号を根拠に、注文の最新状態・同じ注文の重複候補・
                  確定した報酬・支払い確定の状態までここで辿る。未確定の額は
                  「未確定」と出し、確定額と混ぜない。 */}
              <dl className="mt-3 space-y-1 text-xs">
                {detailItem.orderNumber ? (
                  <div className="flex gap-2">
                    <dt className="text-ink-faint shrink-0">起こりになった注文</dt>
                    <dd className="text-ink-secondary">
                      {detailItem.orderNumber}
                      {detailItem.orderStatus
                        ? `（${APPROVAL_ORDER_STATUS_TEXT[detailItem.orderStatus] ?? detailItem.orderStatus}）`
                        : '（注文は見つかりません）'}
                    </dd>
                  </div>
                ) : null}
                {detailItem.sameOrderDuplicate ? (
                  <div className="flex gap-2">
                    <dt className="text-ink-faint shrink-0">重複の候補</dt>
                    <dd className="text-warning">
                      {ORDER_DUPLICATE_TITLE}：同じ注文・同じ成果地点の成果がほかにもあります。二重に認めないか注文番号で確かめてください。
                    </dd>
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <dt className="text-ink-faint shrink-0">確定した報酬</dt>
                  <dd className="text-ink-secondary">
                    {detailItem.rewardAmount != null ? `¥${formatNumber(Math.round(detailItem.rewardAmount))}` : '未確定'}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-ink-faint shrink-0">支払い確定の状態</dt>
                  <dd className="text-ink-secondary">
                    {detailItem.rewardEntryStatus
                      ? (REWARD_ENTRY_STATUS_TEXT[detailItem.rewardEntryStatus] ?? detailItem.rewardEntryStatus)
                      : 'まだ確定していません'}
                  </dd>
                </div>
              </dl>
              <AttributionSection eventId={detailItem.eventId} />
            </div>
            <AffiliateButton onClick={() => setDetailItem(null)}>閉じる</AffiliateButton>
          </div>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-ink-faint text-xs font-semibold tabular-nums">
            {shownItems.length}件 / 全 {counts[status]}件
            {truncatedStatuses.includes(status) ? '（まだ続きがあります）' : ''}
          </p>
          <Pagination page={currentPage} pageCount={approvalPageCount} onPageChange={(value) => {
            setPage(value)
            setSelected(new Set())
          }} />
        </div>
      )}

      {!loading && !error && truncatedStatuses.length > 0 && (
        <div className="bg-canvas rounded-card border-hairline mt-3 flex flex-wrap items-center gap-3 border p-3">
          <p className="text-ink-secondary text-sm">
            件数が多いため{truncatedStatuses.map((value) => (value === 'pending' ? '承認待ち' : value === 'approved' ? '承認済み' : '却下済み')).join('・')}の一部はまだ読み込んでいません。
          </p>
          <AffiliateButton onClick={() => { void loadMoreItems() }} disabled={loadingMore}>
            {loadingMore ? '読み込んでいます…' : 'さらに読み込む'}
          </AffiliateButton>
        </div>
      )}

      <p className="text-ink-faint mt-3 text-xs">却下理由の記録は未接続です。却下状態はまとめて保存できます。</p>

      {bulkConfirm && (
        <ConfirmDialog
          open
          title={bulkConfirm.action === 'approved' ? `選んだ${bulkConfirm.items.length}件をまとめて認めますか` : `選んだ${bulkConfirm.items.length}件をまとめて却下しますか`}
          description="実行すると1件ずつ同じ判断の契約で処理します。ほかの人が先に判断した対象は上書きせず残します。"
          confirmLabel={bulkConfirm.action === 'approved' ? 'まとめて認める' : 'まとめて却下する'}
          destructive={bulkConfirm.action === 'rejected'}
          busy={actioning !== null}
          onConfirm={() => { void runBulkDecide(bulkConfirm.action, bulkConfirm.items) }}
          onCancel={() => { setBulkConfirm(null) }}
        >
          <ul className="text-ink-secondary mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
            {bulkConfirm.items.map((item) => (
              <li key={item.eventId}>
                {personNameText(item.friendName)}／{item.affiliateName ?? '紹介者名を取得できませんでした'}／{item.offerName ?? '案件未設定'}
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}

      {bulkResult && (
        <div className="bg-canvas rounded-card border-hairline mt-3 border p-4" role="status" aria-label="まとめて処理の結果">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-ink text-sm font-semibold">まとめて処理の結果</h3>
              <p className="text-ink-secondary mt-1 text-sm">
                成功 {bulkResult.succeeded.length}件
                ／ほかの人が先に判断 {bulkResult.conflicted.length}件
                ／権限なし {bulkResult.denied.length}件
                ／失敗 {bulkResult.failed.length}件
              </p>
              {bulkResult.conflicted.length > 0 && (
                <ul className="text-ink-secondary mt-2 space-y-1 text-sm">
                  {bulkResult.conflicted.map((entry) => (
                    <li key={entry.id}>先に判断されました：{nameOf(entry.id)}（いま{entry.currentStatus === 'approved' ? '承認済み' : entry.currentStatus === 'rejected' ? '却下済み' : '未判断'}）</li>
                  ))}
                </ul>
              )}
              {bulkResult.denied.length > 0 && (
                <ul className="text-ink-secondary mt-2 space-y-1 text-sm">
                  {bulkResult.denied.map((eventId) => (
                    <li key={eventId}>権限がありません：{nameOf(eventId)}</li>
                  ))}
                </ul>
              )}
              {bulkResult.failed.length > 0 && (
                <ul className="text-ink-secondary mt-2 space-y-1 text-sm">
                  {bulkResult.failed.map((entry) => (
                    <li key={entry.id}>失敗しました：{nameOf(entry.id)}（{entry.error}）</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {(bulkResult.conflicted.length + bulkResult.denied.length + bulkResult.failed.length) > 0 && (
                <AffiliateButton onClick={() => { retryBulkLeftovers() }}>残りを選び直して再試行</AffiliateButton>
              )}
              <AffiliateButton onClick={() => { setBulkResult(null) }}>閉じる</AffiliateButton>
            </div>
          </div>
        </div>
      )}
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
  onTerms,
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
  onTerms: (offer: AffiliateOffer) => void
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

  // 空の案内も表と同じカード（白地・枠・角丸）の中に出す。灰色の地だけにしない。
  if (offers.length === 0) {
    return (
      <div className="bg-canvas rounded-card border-hairline border">
        {filtered ? (
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
            action={<Button href="/affiliate-offers/new" variant="primary">＋ 案件を作る</Button>}
          />
        )}
      </div>
    )
  }

  return (
    <div data-design="Table" className="bg-canvas rounded-card border-hairline overflow-x-auto border">
      <table className="w-full min-w-[760px]">
        <thead>
          <TableHeadRow>
            {/* 表の外側の余白は左右で同じにし、操作は右端にそろえる。 */}
            <Th>案件</Th>
            <Th align="right">報酬</Th>
            <Th>成果が出たときの動き</Th>
            <Th align="right">紹介している人</Th>
            <Th align="right">成果</Th>
            <Th align="right">操作</Th>
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
                {offer.rewardMiles > 0 && <span className="text-ink-faint block text-xs">＋{formatNumber(offer.rewardMiles)}マイル</span>}
              </td>
              <td className="text-ink-secondary px-4 py-3 text-sm">
                {offer.tagId ? (
                  <>タグ「{tagMap.get(offer.tagId) ?? '名前を確認できません'}」を付ける</>
                ) : offer.scenarioId ? (
                  <>シナリオ「{scenarioMap.get(offer.scenarioId) ?? '名前を確認できません'}」を始める</>
                ) : offer.rewardMiles > 0 ? (
                  <>{formatNumber(offer.rewardMiles)}マイルを付ける</>
                ) : (
                  <span className="text-warning">何も設定されていません</span>
                )}
              </td>
              <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">
                {formatNumber((offerStats.get(offer.id)?.introducers ?? 0))}人
              </td>
              <td className="text-ink px-4 py-3 text-right text-sm font-semibold tabular-nums">
                {formatNumber((offerStats.get(offer.id)?.conversions ?? 0))}件
                <span className="text-ink-faint block text-xs">確定 {formatYen(offerStats.get(offer.id)?.reward ?? 0)}</span>
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <button
                  onClick={() => onEdit(offer)}
                  className="text-action text-xs font-medium hover:underline"
                >
                  編集
                </button>
                <button
                  onClick={() => onTerms(offer)}
                  className="text-action ml-2 text-xs font-medium hover:underline"
                >
                  決まり
                </button>
                <span className="text-ink-faint ml-2 text-xs">{offer.isActive ? '公開中' : '停止・終了'}</span>
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
  const [termsTarget, setTermsTarget] = useState<AffiliateOffer | null>(null)

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
  // 安全弁（5000 件）で止まったときだけ注記を出す。通常は false。
  const [confirmedTruncated, setConfirmedTruncated] = useState(false)

  useEffect(() => {
    void loadOffers()
    void loadOptions()
  }, [loadOffers, loadOptions])

  useEffect(() => {
    let cancelled = false
    setConfirmedState('loading')
    // 「いちばん成果が出た案件」の元になる承認は全件取る（打ち切ると数が小さく出る）。
    void Promise.all((['pending', 'approved', 'rejected'] as const).map((status) =>
      listAllConversionApprovals(status),
    )).then((results) => {
        if (cancelled) return
        const all = results.flatMap((result) => result.items)
        setOfferApprovalItems(all)
        setConfirmedTruncated(results.some((result) => result.truncated))
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
    <div data-design-node="GH8VL" data-affiliate-offers-design="v6" className="flex flex-col gap-4">
      <NoteBar help="案件は、何をしたら成果になりいくら払うかの組み合わせです" helpLabel="案件の意味">
        案件は「何をしたら成果になり、いくら払うか」の組み合わせです。アフィリエイターはこの案件を選んで紹介します。
      </NoteBar>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="紹介できる案件" value={openCount} unit="件" detail={`公開中。停止・終了 ${offers.length - openCount}件`} />
        <KpiCard
          title="いちばん成果が出た案件"
          value={confirmedState === 'ready' && topOffer ? (offerStats.get(topOffer.id)?.conversions ?? 0) : null}
          unit={confirmedState === 'ready' && topOffer ? '件' : ''}
          loading={confirmedState === 'loading'}
          detail={confirmedDetail(confirmedState, topOffer ? `${topOffer.name}・確定 ${formatYen(offerStats.get(topOffer.id)?.reward ?? 0)}${confirmedTruncated ? '（直近5000件まで）' : ''}` : '成果はまだありません')}
        />
        <KpiCard
          title="平均報酬額"
          value={averageReward}
          unit="円"
          detail={`いちばん高い案件 ${formatYen(Math.max(0, ...rewardValues))}`}
          /* m22d: 「1件あたり」は単位の意味なので見出しの「？」へ移し、
             件数は「紹介できる案件」と「動きが未設定の案件」の2か所だけにする。 */
          help="成果1件あたりの平均です"
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
        className="bg-canvas rounded-card border-hairline flex flex-wrap items-center gap-2 border p-3"
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
        {/* 作る操作は行の左。たまに使う CSV は右に残す。 */}
        <Button href="/affiliate-offers/new" variant="primary">
          ＋ 案件を作る
        </Button>
        <AffiliateButton onClick={exportCsv} disabled={shown.length === 0} className="ml-auto">
          CSVで書き出す
        </AffiliateButton>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
        onTerms={setTermsTarget}
        onRefresh={loadOffers}
      />

      <div data-design="tf" className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-faint text-xs font-semibold tabular-nums">
          {shown.length === offers.length
            ? `全 ${offers.length}件`
            : `${shown.length}件 / 全 ${offers.length}件`}
        </p>
        {pageCount > 1 && (
          <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
        )}
      </div>

      <section className="bg-canvas rounded-card border-hairline border p-4">
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

      {termsTarget && (
        <OfferTermsDialog offer={termsTarget} onClose={() => setTermsTarget(null)} />
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
      setError(e instanceof Error ? e.message : '保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-control border border-divider-soft bg-canvas p-4">
      <p className="mb-3 text-xs font-semibold uppercase text-ink-faint">支払いの取り決め</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label
            htmlFor={`aff-email-${affiliate.id}`}
            className="mb-1 block text-xs font-medium text-ink-secondary"
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
            className="w-full rounded-mini border border-hairline px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label
            htmlFor={`aff-hold-${affiliate.id}`}
            className="mb-1 block text-xs font-medium text-ink-secondary"
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
              className="w-full rounded-mini border border-hairline px-3 py-2 text-sm tabular-nums"
            />
            <span className="whitespace-nowrap text-xs text-ink-faint">日</span>
          </div>
        </div>
        <div>
          <label
            htmlFor={`aff-cycle-${affiliate.id}`}
            className="mb-1 block text-xs font-medium text-ink-secondary"
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
            className="w-full rounded-mini border border-hairline px-3 py-2 text-sm"
          />
        </div>
      </div>
      <Checkbox
        checked={notify}
        onCheckedChange={(checked) => {
          setNotify(checked)
          setSaved(false)
        }}
        className="mt-3"
      >成果が出たときに本人へ知らせる</Checkbox>
      <p className="mt-2 text-[11px] text-ink-faint">
        保留日数と支払いサイクルは取り決めの記録です。報酬の計算そのものには使いません。
      </p>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-mini border border-hairline px-3 py-1.5 text-xs font-medium text-ink-secondary hover:bg-surface-pearl disabled:opacity-40"
        >
          {saving ? '保存中...' : '取り決めを保存する'}
        </button>
        {/* #670 22: emerald-600 は白地で 3.8:1 しかなく AA 未満。共通トークンの濃い緑へ。 */}
        {saved && <span className="text-xs font-semibold text-success">保存しました</span>}
      </div>
    </div>
  )
}
