'use client'

/*
 * ★V8-B 成果とアフィリエイト「アフィリエイター」タブ（板 `nJlxX`。
 * 1152 は `KdFRI`、状態別は `rRk0C`、閲覧のみは `v9JWQ`）。
 *
 * データの口は v7（tabs.tsx の AffiliatorsTab）と同じ。ここでは見せ方だけを
 * V8-B の板に合わせる。板 `nJlxX`・`v9JWQ` の左のフォルダの棚（数・
 * 未分類・フォルダを追加）は、アフィリエイターを分ける API が無いので
 * 描かない。止めた日・1件ごとの固定額も同じ理由で出さない。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Download, UserRoundPlus, Users } from 'lucide-react'
import { api, type ConversionApprovalItem } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Pagination from '@/components/shared/pagination'
import { MoreAction } from '@/components/shared/row-actions'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { notifyToast } from '@/components/shared/toast'
import { calculateAffiliateReward } from './affiliate-reward'
import {
  CreateAffiliateModal,
  distributionUrl,
  listAllConversionApprovals,
  type AffiliateItem,
  type AffiliateLink,
  type AffiliateListRow,
} from './tabs'
import { AffiliateArchiveDialog } from './action-dialogs'
import { csvCell, pageCountOf, pageOf } from './offer-list-view'
import { type ConfirmedState } from './offer-kpi'
import { currentAffiliateSettlementPeriod } from './payment-tab'
import { KpiStrip, KpiCell, NoticeBar, EmptyState, ZeroResultState, LoadingRows, LoadError, BulkBar } from './v8-shared'
import AffiliateDrawerV8 from './v8-drawer'
import './list-v8.css'

const PAGE_SIZES = [20, 50, 100]

type FilterKey = 'active' | 'inactive' | 'reward'
type SortKey = 'newest' | 'name' | 'reward' | 'conversions'

/** 「よく使う絞り込み」：絞り込みと並びを1つにまとめた保存済みの見方。 */
const SAVED_VIEWS: Array<{ value: string; label: string; filters: FilterKey[]; sort: SortKey }> = [
  { value: 'active-results', label: '計測中・成果が多い順', filters: ['active'], sort: 'conversions' },
  { value: 'active-reward', label: '計測中・報酬が多い順', filters: ['active', 'reward'], sort: 'reward' },
  { value: 'reward', label: '報酬あり・報酬が多い順', filters: ['reward'], sort: 'reward' },
  { value: 'inactive', label: '停止中のみ', filters: ['inactive'], sort: 'newest' },
  { value: 'name', label: '名前順', filters: [], sort: 'name' },
]

function formatYen(n: number): string {
  return `¥${formatNumber(Math.round(n))}`
}

/** 報酬の約束の一行。API は売上の割合だけを返すので、あるものだけ書く。 */
function planText(row: AffiliateItem): string {
  if (!row.isActive) return '止めている'
  if (row.commissionRate > 0) return `売上の ${row.commissionRate}%`
  return '報酬なし（計測のみ）'
}

/** 締めの月の1つ前の集計期間（日本時間の月初〜月末）。 */
export function previousAffiliateSettlementPeriod(periodFrom: string): { periodFrom: string; periodTo: string } {
  const JST_MS = 9 * 60 * 60 * 1000
  const wall = new Date(new Date(periodFrom).getTime() + JST_MS)
  const year = wall.getUTCFullYear()
  const month = wall.getUTCMonth()
  return {
    periodFrom: new Date(Date.UTC(year, month - 1, 1) - JST_MS).toISOString(),
    periodTo: new Date(Date.UTC(year, month, 1) - JST_MS - 1).toISOString(),
  }
}

export default function AffiliatesTabV8({
  accountId,
  canEdit,
  registerHeaderActions,
  focusAffiliateId,
}: {
  accountId: string | null
  /** 役割が読めるまでは true（従来どおり出す）。staff と分かったら false。 */
  canEdit: boolean
  /** 板の頭の右上に置く操作（CSV など）。タブが変わったら戻す。 */
  registerHeaderActions: (node: ReactNode) => void
  /** 停止前の確認などから来たとき、最初に明細を開く紹介者（R291）。 */
  focusAffiliateId?: string | null
}) {
  const settlementPeriod = useMemo(() => currentAffiliateSettlementPeriod(), [])

  // ── 一覧 ──────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<AffiliateListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // ── KPI の元（承認の一覧は全件・支払いの集計） ──────────────────────────────
  const [approvalItems, setApprovalItems] = useState<ConversionApprovalItem[]>([])
  const [approvalState, setApprovalState] = useState<ConfirmedState>('loading')
  const [approvalTruncated, setApprovalTruncated] = useState(false)
  const [paymentTotal, setPaymentTotal] = useState<number | null>(null)
  const [paymentState, setPaymentState] = useState<ConfirmedState>('loading')
  const [monthlyConversions, setMonthlyConversions] = useState<number | null>(null)
  const [monthlyDelta, setMonthlyDelta] = useState<number | null>(null)
  const [monthlyState, setMonthlyState] = useState<ConfirmedState>('loading')

  // ── 見せ方 ────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<FilterKey[]>([])
  const [sort, setSort] = useState<SortKey>('newest')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  // ── 操作 ──────────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null)
  const [drawerRow, setDrawerRow] = useState<AffiliateListRow | null>(null)
  const [drawerEdit, setDrawerEdit] = useState(false)
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // R292: 配布URLの土台（短縮ドメイン）。取れなくても /r/ で作れる。
  const [linkBaseUrl, setLinkBaseUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void api.accountSettings.getLinkBaseUrl().then((res) => {
      if (cancelled || !res.success || !res.data) return
      setLinkBaseUrl(res.data)
    }).catch(() => { /* 取れなくても /r/ で作れる */ })
    return () => { cancelled = true }
  }, [])

  // ── 読み込み ───────────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [affiliatesRes, reportRes] = await Promise.all([
        api.affiliates.list(),
        api.affiliates.allReport(),
      ])
      if (!affiliatesRes.success || !reportRes.success) throw new Error('fetch failed')
      const affiliates = affiliatesRes.data as unknown as AffiliateItem[]
      const reportMap = new Map<string, {
        totalRevenue: number
        confirmedReward: number
        linkCount: number
        friendAdds: number
        totalConversions: number
        totalClicks: number
      }>()
      for (const r of reportRes.data as unknown as Array<{
        affiliateId: string
        totalClicks: number
        totalConversions: number
        totalRevenue: number
        confirmedReward: number
        linkCount: number
        friendAdds: number
      }>) {
        reportMap.set(r.affiliateId, r)
      }
      setRows(affiliates.map((a) => {
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
      }))
    } catch {
      setRows([])
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadApprovals = useCallback(async () => {
    setApprovalState('loading')
    try {
      const [pending, approved] = await Promise.all([
        listAllConversionApprovals('pending'),
        listAllConversionApprovals('approved'),
      ])
      setApprovalItems([...pending.items, ...approved.items])
      setApprovalTruncated(pending.truncated || approved.truncated)
      setApprovalState('ready')
    } catch {
      if (!cancelledRef.current) setApprovalState('error')
    }
  }, [])
  const cancelledRef = useRef(false)
  useEffect(() => () => { cancelledRef.current = true }, [])

  const loadPayment = useCallback(async () => {
    if (!accountId) {
      setPaymentState('error')
      setPaymentTotal(null)
      return
    }
    setPaymentState('loading')
    try {
      const res = await api.affiliates.settlementPreview(accountId, settlementPeriod)
      if (!res.success || !Array.isArray(res.data.affiliates)) {
        setPaymentState('error')
        setPaymentTotal(null)
        return
      }
      setPaymentTotal(res.data.totalAmount)
      setPaymentState('ready')
    } catch {
      if (!cancelledRef.current) {
        setPaymentState('error')
        setPaymentTotal(null)
      }
    }
  }, [accountId, settlementPeriod])

  const loadMonthly = useCallback(async () => {
    setMonthlyState('loading')
    try {
      const prev = previousAffiliateSettlementPeriod(settlementPeriod.periodFrom)
      const [res, prevRes] = await Promise.all([
        api.affiliates.allReport({
          startDate: settlementPeriod.periodFrom,
          endDate: settlementPeriod.periodTo,
        }),
        api.affiliates.allReport({
          startDate: prev.periodFrom,
          endDate: prev.periodTo,
        }),
      ])
      if (!res.success) throw new Error('monthly report failed')
      const total = (arr: unknown) => (arr as Array<{ totalConversions: number }>)
        .reduce((sum, row) => sum + row.totalConversions, 0)
      const current = total(res.data)
      setMonthlyConversions(current)
      setMonthlyDelta(prevRes.success ? current - total(prevRes.data) : null)
      setMonthlyState('ready')
    } catch {
      if (!cancelledRef.current) {
        setMonthlyConversions(null)
        setMonthlyDelta(null)
        setMonthlyState('error')
      }
    }
  }, [settlementPeriod])

  useEffect(() => {
    void loadList()
    void loadApprovals()
    void loadMonthly()
  }, [loadList, loadApprovals, loadMonthly])
  useEffect(() => { void loadPayment() }, [loadPayment])

  // ── 板の頭の操作（CSV で書き出す） ──────────────────────────────────────────
  const shownRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    return rows
      .filter((row) => {
        if (needle && !`${row.name} ${row.code}`.toLocaleLowerCase('ja-JP').includes(needle)) return false
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
        if (sort === 'conversions') return b.totalConversions - a.totalConversions
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
  }, [filters, query, rows, sort])

  const exportCsv = useCallback(() => {
    const header = ['名前', '紹介コード', '紹介リンク数', '友だち追加', '成果', '承認済み報酬']
    const cells = shownRows.map((row) => [
      row.name, row.code, row.linkCount, row.friendAdds, row.totalConversions, Math.round(row.rewardAmount),
    ])
    const csv = [header, ...cells].map((line) => line.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `affiliates-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [shownRows])

  useEffect(() => {
    registerHeaderActions(
      <Button
        key="csv"
        type="button"
        onClick={exportCsv}
        disabled={shownRows.length === 0}
      >
        <Download size={15} aria-hidden="true" /> CSV で書き出す
      </Button>,
    )
    return () => registerHeaderActions(null)
  }, [registerHeaderActions, exportCsv, shownRows.length])

  // ── 行の操作 ───────────────────────────────────────────────────────────────
  const openDrawer = useCallback((id: string, edit: boolean) => {
    const row = rows.find((item) => item.id === id) ?? null
    setDrawerRow(row)
    setDrawerEdit(edit)
  }, [rows])

  // R291: `?affiliate=` で来たとき、その人の明細を最初から開く（1回だけ）。
  const focusHandledRef = useRef(false)
  useEffect(() => {
    if (focusHandledRef.current || !focusAffiliateId || loading) return
    focusHandledRef.current = true
    if (rows.some((row) => row.id === focusAffiliateId)) openDrawer(focusAffiliateId, false)
  }, [focusAffiliateId, loading, rows, openDrawer])

  const copyFirstLink = useCallback(async (row: AffiliateListRow) => {
    try {
      const res = await api.affiliates.links(row.id)
      if (!res.success) throw new Error('links failed')
      const link = (res.data as unknown as AffiliateLink[]).find((item) => item.is_active)
        ?? (res.data as unknown as AffiliateLink[])[0]
      if (!link) {
        notifyToast('この人には紹介リンクがまだありません。詳細から発行できます。')
        return
      }
      const url = distributionUrl(link.ref_code, linkBaseUrl)
      if (!url) return
      try {
        await navigator.clipboard.writeText(url)
        setCopiedId(row.id)
        notifyToast('紹介リンクをコピーしました。')
        window.setTimeout(() => setCopiedId((current) => (current === row.id ? null : current)), 2000)
      } catch { /* 書けないときは引き出しでURLを見せる */ openDrawer(row.id, false) }
    } catch {
      notifyToast('紹介リンクを読み込めませんでした。もう一度お試しください。')
    }
  }, [linkBaseUrl, openDrawer])

  // ── まとめて「紹介を止める」（行ごとの確認は個別の画面が持つ。ここは一括停止のみ） ──
  const bulkTargets = useMemo(
    () => rows.filter((row) => selected.has(row.id) && row.isActive),
    [rows, selected],
  )
  const runBulkArchive = useCallback(async () => {
    if (bulkTargets.length === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      const results = await Promise.allSettled(
        bulkTargets.map((row) => api.affiliates.archive(row.id, { mode: 'pause' })),
      )
      const failed = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length
      const done = bulkTargets.length - failed
      if (failed === 0) {
        notifyToast(`${formatNumber(done)}人の紹介を止めました。`)
        setSelected(new Set())
      } else {
        notifyToast(`${formatNumber(done)}人を止めました。${formatNumber(failed)}人は止められませんでした。`)
      }
      setBulkConfirm(false)
      void loadList()
    } finally {
      setBulkBusy(false)
    }
  }, [bulkTargets, bulkBusy, loadList])

  // ── 数の帯 ─────────────────────────────────────────────────────────────────
  const activeCount = rows.filter((row) => row.isActive).length
  const pendingCount = approvalItems.filter((item) => item.approvalStatus === 'pending').length

  const pageCount = pageCountOf(shownRows.length, pageSize)
  const currentPage = Math.min(page, pageCount)
  const pagedRows = pageOf(shownRows, currentPage, pageSize)
  const allChecked = pagedRows.length > 0 && pagedRows.every((row) => selected.has(row.id))

  const resetConditions = () => {
    setQuery('')
    setFilters([])
    setPage(1)
  }

  const listState = error ? 'error' : loading ? 'loading' : rows.length === 0 ? 'empty' : shownRows.length === 0 ? 'zero' : 'ready'

  return (
    <>
      <KpiStrip>
        <KpiCell
          icon={<Users size={14} aria-hidden="true" />}
          label="アフィリエイター"
          value={listState === 'error' || (loading && rows.length === 0) ? null : rows.length}
          unit="人"
          sub={listState === 'error' ? '読み込めませんでした' : `計測中 ${formatNumber(activeCount)}・停止中 ${formatNumber(rows.length - activeCount)}`}
          info="紹介してくれる人（アフィリエイター）の登録数です。計測中は紹介リンクからの成果を数えている人、停止中は数えていない人です。"
        />
        <KpiCell
          label="今月の成果"
          value={monthlyState === 'ready' ? monthlyConversions : null}
          unit="件"
          sub={monthlyState === 'ready'
            ? (monthlyDelta == null
              ? '今月に起きた成果'
              : monthlyDelta === 0 ? '先月と同じ' : `先月より${monthlyDelta > 0 ? '+' : '−'}${formatNumber(Math.abs(monthlyDelta))}`)
            : monthlyState === 'loading' ? '読み込んでいます' : '読み込めませんでした'}
          info="今月（日本時間）に記録された成果の数です。認める・認めないに関わらず記録された分を数えます。"
        />
        <KpiCell
          label="今月の報酬"
          value={paymentState === 'ready' && paymentTotal != null ? formatYen(paymentTotal) : null}
          sub={paymentState === 'ready' ? `承認待ち ${formatNumber(pendingCount)}件は入っていない` : paymentState === 'loading' ? '読み込んでいます' : '読み込めませんでした'}
          info="今回の締めで払う見込みの合計です。承認待ちの成果は確定していないので含みません。"
        />
        <KpiCell
          label="承認待ち"
          value={approvalState === 'ready' ? pendingCount : null}
          unit="件"
          sub={approvalState === 'ready' ? (approvalTruncated ? '直近の分まで表示' : '認めると報酬に入ります') : approvalState === 'loading' ? '読み込んでいます' : '読み込めませんでした'}
          info="まだ認める・認めないを決めていない成果です。認めると次の締めで報酬に入ります。"
        />
      </KpiStrip>

      {approvalState === 'ready' && pendingCount > 0 ? (
        <NoticeBar>
          承認待ちの成果が{formatNumber(pendingCount)}件あります。「成果承認」で認めると、次の締めで報酬に入ります。
        </NoticeBar>
      ) : null}

      <div className="af-list-tools">
        <Button
          type="button"
          variant="primary"
          onClick={() => setCreateOpen(true)}
          disabled={!canEdit}
          title={canEdit ? undefined : '閲覧のみのため変更できません'}
        >
          <UserRoundPlus size={15} aria-hidden="true" /> アフィリエイターを作る
        </Button>
        <SearchField
          placeholder="名前・紹介コードで探す"
          aria-label="名前・紹介コードで探す"
          value={query}
          onChange={(value) => { setQuery(value); setPage(1) }}
          onClear={() => { setQuery(''); setPage(1) }}
          className="af-list-toolsSearch"
        />
        <FilterChip
          selected={filters.includes('active')}
          onChange={(on) => {
            setFilters((cur) => (on ? [...cur, 'active'] : cur.filter((v) => v !== 'active')))
            setPage(1)
          }}
          count={listState === 'error' ? undefined : formatNumber(activeCount)}
        >
          計測中
        </FilterChip>
        <FilterChip
          selected={filters.includes('reward')}
          onChange={(on) => {
            setFilters((cur) => (on ? [...cur, 'reward'] : cur.filter((v) => v !== 'reward')))
            setPage(1)
          }}
          count={listState === 'error' ? undefined : formatNumber(rows.filter((r) => r.rewardAmount > 0).length)}
        >
          報酬あり
        </FilterChip>
        <span className="af-list-toolsSpacer" />
        <Select
          aria-label="よく使う絞り込み"
          value=""
          options={[{ value: '', label: 'よく使う絞り込み' }, ...SAVED_VIEWS.map((v) => ({ value: v.value, label: v.label }))]}
          onChange={(value) => {
            const view = SAVED_VIEWS.find((v) => v.value === value)
            if (!view) return
            setFilters([...view.filters])
            setSort(view.sort)
            setPage(1)
          }}
        />
        <Select
          aria-label="表示件数"
          value={String(pageSize)}
          options={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n}件表示` }))}
          onChange={(value) => { setPageSize(Number(value)); setPage(1) }}
          size="page-size"
        />
      </div>

      {listState === 'error' ? (
        <LoadError name="アフィリエイター" onRetry={() => { void loadList() }} />
      ) : listState === 'loading' ? (
        <LoadingRows />
      ) : listState === 'empty' ? (
        <EmptyState
          icon={<Users size={20} aria-hidden="true" />}
          title="まだアフィリエイターはいません"
          description="紹介してくれる人を登録すると、紹介リンクができます。先にコンバージョンで「何を成果にするか」を決めておきます。"
          action={(
            <Button type="button" variant="primary" onClick={() => setCreateOpen(true)} disabled={!canEdit}>
              <UserRoundPlus size={15} aria-hidden="true" /> アフィリエイターを作る
            </Button>
          )}
        />
      ) : listState === 'zero' ? (
        <ZeroResultState onReset={resetConditions} />
      ) : (
        <div className="af-list-tableWrap">
          <div className="af-list-tableScroll">
            <table className={`af-list-table af-list-affiliateTable`}>
              <colgroup>
                <col className="af-list-checkColumn" /><col />
                <col className="af-list-metricColumn" /><col className="af-list-metricColumn" />
                <col className="af-list-metricColumn" /><col className="af-list-rewardColumn" />
                <col className="af-list-actionsColumn" />
              </colgroup>
              <thead>
                <tr>
                  <th className="af-list-cellCheck">
                    <Checkbox
                      aria-label="このページの全員を選ぶ"
                      checked={allChecked}
                      disabled={!canEdit}
                      onCheckedChange={(checked) => {
                        setSelected((cur) => {
                          const next = new Set(cur)
                          for (const row of pagedRows) {
                            if (checked) next.add(row.id)
                            else next.delete(row.id)
                          }
                          return next
                        })
                      }}
                    />
                  </th>
                  <th>アフィリエイター</th>
                  <th className="af-list-numRight">紹介リンク</th>
                  <th className="af-list-numRight">友だち追加</th>
                  <th className="af-list-numRight">成果</th>
                  <th className="af-list-numRight">報酬</th>
                  <th className="af-list-numRight">操作</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => (
                  <tr key={row.id}>
                    <td className="af-list-cellCheck">
                      <Checkbox
                        aria-label={`${row.name}を選ぶ`}
                        checked={selected.has(row.id)}
                        disabled={!canEdit}
                        onCheckedChange={(checked) => {
                          setSelected((cur) => {
                            const next = new Set(cur)
                            if (checked) next.add(row.id)
                            else next.delete(row.id)
                            return next
                          })
                        }}
                      />
                    </td>
                    <td>
                      <div className="af-list-personCell">
                        <button type="button" className="af-list-personName" title={row.name} onClick={() => openDrawer(row.id, false)}>
                          {row.name}
                        </button>
                        <span className="af-list-personCode" title={row.code}>{row.code}</span>
                        <span className="af-list-personPlan">{planText(row)}</span>
                        <span className={`af-list-statusBadge ${row.isActive ? 'af-list-statusOk' : 'af-list-statusNeutral'}`}>
                          <span className="af-list-statusDot" aria-hidden="true" />
                          {row.isActive ? '計測中' : '停止中'}
                        </span>
                      </div>
                    </td>
                    <td className="af-list-numRight">{formatNumber(row.linkCount)}本</td>
                    <td className="af-list-numRight">{formatNumber(row.friendAdds)}人</td>
                    <td className="af-list-numRight"><strong>{formatNumber(row.totalConversions)}件</strong></td>
                    <td className="af-list-numRight"><strong>{formatYen(row.rewardAmount)}</strong></td>
                    <td>
                      <div className="af-list-rowActions">
                        <Button type="button" onClick={() => openDrawer(row.id, false)}>
                          成果を見る
                        </Button>
                        <span style={{ position: 'relative', display: 'inline-flex' }}>
                          <MoreAction
                            label={`${row.name}のその他操作`}
                            aria-expanded={rowMenuId === row.id}
                            onClick={() => setRowMenuId((cur) => (cur === row.id ? null : row.id))}
                          />
                          <ActionMenu
                            open={rowMenuId === row.id}
                            ariaLabel={`${row.name}の操作`}
                            onClose={() => setRowMenuId(null)}
                            items={([
                              { id: 'view', label: '成果を見る', onSelect: () => openDrawer(row.id, false) },
                              { id: 'copy', label: copiedId === row.id ? 'コピーしました' : '紹介リンクをコピー', onSelect: () => { void copyFirstLink(row) } },
                              {
                                id: 'edit',
                                label: '編集',
                                onSelect: () => openDrawer(row.id, true),
                                disabled: !canEdit,
                              },
                              {
                                id: 'archive',
                                label: '紹介を止める',
                                onSelect: () => setArchiveTarget({ id: row.id, name: row.name }),
                                disabled: !canEdit,
                              },
                            ] satisfies ActionMenuItem[])}
                          />
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {listState === 'ready' ? (
        <div className="pageFoot">
          <p className="pageCount">
            {shownRows.length === rows.length
              ? `全 ${formatNumber(rows.length)}件`
              : `${formatNumber(shownRows.length)}件 / 全 ${formatNumber(rows.length)}件`}
          </p>
          {pageCount > 1 ? <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} /> : null}
        </div>
      ) : null}

      <p className="af-list-footNote">
        行の「…」から 成果を見る・紹介リンクをコピー・編集・紹介を止める。止めると、その人の紹介リンクからの成果を数えなくなります。
      </p>

      {canEdit ? (
        <BulkBar
          count={selected.size}
          hint="件を選択中　対象を確認してから操作を選んでください"
          actionLabel="操作を選ぶ"
          onAction={() => setBulkConfirm(true)}
          onClear={() => setSelected(new Set())}
        />
      ) : null}

      {createOpen ? (
        <CreateAffiliateModal
          accountId={accountId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { void loadList() }}
        />
      ) : null}

      <AffiliateArchiveDialog
        target={archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onChanged={() => { void loadList() }}
      />

      {drawerRow ? (
        <AffiliateDrawerV8
          affiliate={drawerRow}
          accountId={accountId}
          canEdit={canEdit}
          startInEdit={drawerEdit}
          linkBaseUrl={linkBaseUrl}
          onClose={() => setDrawerRow(null)}
          onChanged={() => { void loadList() }}
          onStopRequest={(id, name) => { setArchiveTarget({ id, name }) }}
        />
      ) : null}

      {/* まとめて止める確認。個別の「紹介を止める」は影響を確かめる別画面が担う。 */}
      <BulkArchiveConfirm
        open={bulkConfirm}
        count={bulkTargets.length}
        busy={bulkBusy}
        onCancel={() => setBulkConfirm(false)}
        onConfirm={() => { void runBulkArchive() }}
      />
    </>
  )
}

/** 「まとめて紹介を止める」の確認窓。 */
function BulkArchiveConfirm({
  open,
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean
  count: number
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ConfirmDialog
      open={open}
      title={`${formatNumber(count)}人の紹介をまとめて止めますか？`}
      description="止めると、その人たちの紹介リンクからの成果はこれから数えません。認めるのを待っている成果がある人は、個別の画面で中身を確かめてから止めてください。"
      confirmLabel="まとめて止める"
      destructive
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
