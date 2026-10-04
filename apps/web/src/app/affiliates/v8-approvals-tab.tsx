'use client'

/*
 * ★V8-B 成果とアフィリエイト「成果承認」タブ（板 `OylSV`）。
 * まとめて選ぶ → 下の浮き帯（②件を選択中… ☰操作を選ぶ）で処理する形。
 *
 * 動作の契約は v7 の ApprovalQueue（tabs.tsx）と同じ：
 * - 状態ごとに安全弁つきで全件読む（1状態あたり最大25頁×200件）
 * - 「確認したほうがよい」成果はまとめて承認の対象から外す
 * - expectedStatus で競合を検知し、先に判断されたものは上書きしない
 * - 安全弁で止まった状態は「さらに読み込む」で続きを取る
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Download, ListChecks, Timer } from 'lucide-react'
import { api, type ConversionApprovalItem } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import BulkOpWizard from './bulk-op-wizard'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import Pagination from '@/components/shared/pagination'
import {
  APPROVAL_ORDER_STATUS_TEXT,
  ORDER_DUPLICATE_TITLE,
  REWARD_ENTRY_STATUS_TEXT,
  approvalReviewReasons,
  personNameText,
} from './affiliate-display'
import AttributionSection from './attribution-view'
import { csvCell, pageCountOf, pageOf } from './offer-list-view'
import { formatDateTime, formatYenNullable, listAllConversionApprovals } from './tabs'
import { KpiStrip, KpiCell, NoticeBar, EmptyState, ZeroResultState, LoadingRows, LoadError } from './v8-shared'
import './list-v8.css'

type ApprovalStatus = 'pending' | 'approved' | 'rejected'
type BulkOutcome = 'approved' | 'rejected'
type BulkResult = {
  action: BulkOutcome
  succeeded: string[]
  conflicted: Array<{ id: string; currentStatus: string }>
  denied: string[]
  failed: Array<{ id: string; error: string }>
}

function formatYen(n: number): string {
  return `¥${formatNumber(Math.round(n))}`
}

/** JSTの今月の始まり（UTCの瞬間で比べる）。 */
function jstMonthStart(): number {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1)
}

export default function ApprovalsTabV8({
  canEdit,
  registerHeaderActions,
  focusAffiliateId,
}: {
  canEdit: boolean
  registerHeaderActions: (node: ReactNode) => void
  /** 停止前の確認から来たとき、最初から絞る紹介者（R291）。 */
  focusAffiliateId?: string | null
}) {
  const [status, setStatus] = useState<ApprovalStatus>('pending')
  const [affiliateFilter, setAffiliateFilter] = useState<string | null>(focusAffiliateId ?? null)
  const [items, setItems] = useState<ConversionApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actioning, setActioning] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [sort] = useState<'oldest' | 'newest' | 'amount'>('oldest')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [detailItem, setDetailItem] = useState<ConversionApprovalItem | null>(null)
  const [truncatedStatuses, setTruncatedStatuses] = useState<ApprovalStatus[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState<{ action: BulkOutcome; items: ConversionApprovalItem[] } | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)
  /* まとめて操作の手順窓（★V8-B `hadfk`）。浮き帯のメニューの代わりにここから選ぶ。 */
  const [bulkWizard, setBulkWizard] = useState<ConversionApprovalItem[] | null>(null)
  const cancelledRef = useRef(false)
  useEffect(() => () => { cancelledRef.current = true }, [])

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const statuses = ['pending', 'approved', 'rejected'] as const
      const results = await Promise.all(statuses.map((value) => listAllConversionApprovals(value)))
      setItems(results.flatMap((result) => result.items))
      setTruncatedStatuses(statuses.filter((value, index) => results[index].truncated))
      setSelected(new Set())
    } catch {
      if (!cancelledRef.current) setError(true)
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { void loadItems() }, [loadItems])

  // 安全弁で止まった状態の続きを読む（N-207）
  const loadMoreItems = useCallback(async () => {
    if (loadingMore || truncatedStatuses.length === 0) return
    setLoadingMore(true)
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
    } catch {
      if (!cancelledRef.current) setActionError('続きを読み込めませんでした。もう一度お試しください。')
    } finally {
      if (!cancelledRef.current) setLoadingMore(false)
    }
  }, [items, loadingMore, truncatedStatuses])

  const handleApprove = useCallback(async (eventId: string, expectedStatus: 'pending' | 'approved' | 'rejected') => {
    if (actioning) return
    setActioning(eventId)
    setActionError(null)
    try {
      const res = await api.conversionApprovals.approve(eventId, expectedStatus)
      if (res.success) {
        await loadItems()
      } else if (res.code === 'approval_conflict') {
        setActionError('ほかの人が先に判断しました。一覧を読み直しました。')
        await loadItems()
      } else {
        setActionError(res.error ?? '承認に失敗しました。通信を確かめて、もう一度お試しください。')
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '承認に失敗しました。通信を確かめて、もう一度お試しください。')
    }
    setActioning(null)
  }, [actioning, loadItems])

  const handleReject = useCallback(async (eventId: string, expectedStatus: 'pending' | 'approved' | 'rejected') => {
    if (actioning) return
    setActioning(eventId)
    setActionError(null)
    try {
      const res = await api.conversionApprovals.reject(eventId, expectedStatus)
      if (res.success) {
        await loadItems()
      } else if (res.code === 'approval_conflict') {
        setActionError('ほかの人が先に判断しました。一覧を読み直しました。')
        await loadItems()
      } else {
        setActionError(res.error ?? '却下に失敗しました。通信を確かめて、もう一度お試しください。')
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '却下に失敗しました。通信を確かめて、もう一度お試しください。')
    }
    setActioning(null)
  }, [actioning, loadItems])

  const nameOf = useCallback((eventId: string) => {
    const item = items.find((entry) => entry.eventId === eventId)
    return item ? personNameText(item.friendName) : eventId
  }, [items])

  const runBulkDecide = useCallback(async (action: BulkOutcome, targets: ConversionApprovalItem[]) => {
    setActioning(action === 'approved' ? 'bulk' : 'bulk-reject')
    setActionError(null)
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
        if (leftovers === 0) {
          setSelected(new Set())
        } else {
          setSelected((current) => {
            const next = new Set<string>()
            for (const eventId of current) {
              if (!res.data!.succeeded.includes(eventId)) next.add(eventId)
            }
            return next
          })
        }
      } else {
        setActionError(res.error ?? 'まとめて処理できませんでした')
      }
    } catch (e) {
      // 通信などで結果が不明のときは一覧を読み直す（保存状態と表示を合わせる）
      await loadItems()
      setActionError(e instanceof Error ? e.message : 'まとめて処理できませんでした')
    } finally {
      setBulkConfirm(null)
      setActioning(null)
    }
  }, [loadItems])

  const scopedItems = useMemo(() => (
    affiliateFilter ? items.filter((item) => item.affiliateId === affiliateFilter) : items
  ), [affiliateFilter, items])
  const affiliateFilterName = affiliateFilter
    ? (scopedItems[0]?.affiliateName
      ?? items.find((item) => item.affiliateId === affiliateFilter)?.affiliateName
      ?? null)
    : null

  const accountItems = scopedItems

  const retryBulkLeftovers = useCallback(() => {
    if (!bulkResult) return
    const leftoverIds = new Set([
      ...bulkResult.conflicted.map((entry) => entry.id),
      ...bulkResult.denied,
      ...bulkResult.failed.map((entry) => entry.id),
    ])
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
  const flaggedCount = pendingItems.filter((item) => approvalReviewReasons(item).length > 0).length
  const averageWaitDays = pendingItems.length === 0
    ? 0
    : pendingItems.reduce((sum, item) => {
      const createdAt = new Date(item.createdAt).getTime()
      return sum + (Number.isFinite(createdAt) ? Math.max(0, Date.now() - createdAt) / 86_400_000 : 0)
    }, 0) / pendingItems.length
  /** 板 `OylSV`：いちばん古い承認待ちの経過日数。 */
  const oldestPendingDays = pendingItems.length === 0
    ? null
    : Math.max(...pendingItems.map((item) => {
      const createdAt = new Date(item.createdAt).getTime()
      return Number.isFinite(createdAt) ? Math.floor(Math.max(0, Date.now() - createdAt) / 86_400_000) : 0
    }))
  /** 板 `OylSV`：今月（JST）に起きた認めた・認めなかった成果。 */
  const monthStart = jstMonthStart()
  const approvedThisMonth = accountItems.filter((item) => item.approvalStatus === 'approved' && new Date(item.createdAt).getTime() >= monthStart)
  const rejectedThisMonth = accountItems.filter((item) => item.approvalStatus === 'rejected' && new Date(item.createdAt).getTime() >= monthStart)
  const approvedMonthYen = approvedThisMonth.reduce((sum, item) => sum + (item.value ?? 0), 0)

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
  const safePendingIds = pagedItems
    .filter((item) => item.approvalStatus === 'pending' && approvalReviewReasons(item).length === 0)
    .map((item) => item.eventId)
  const allSafeSelected = safePendingIds.length > 0 && safePendingIds.every((eventId) => selected.has(eventId))

  const openBulkConfirm = useCallback((action: BulkOutcome) => {
    if (actioning) return
    const targets = accountItems.filter((item) => selected.has(item.eventId) && item.approvalStatus === 'pending')
    if (targets.length === 0) return
    setBulkResult(null)
    setBulkConfirm({ action, items: targets })
  }, [actioning, accountItems, selected])

  const openBulkWizard = useCallback(() => {
    if (actioning) return
    const targets = accountItems.filter((item) => selected.has(item.eventId) && item.approvalStatus === 'pending')
    if (targets.length === 0) return
    setBulkResult(null)
    setBulkWizard(targets)
  }, [actioning, accountItems, selected])

  const exportCsv = useCallback(() => {
    const header = ['日時', '友だち', 'アフィリエイター', 'アカウント', '案件', '成果地点', '注文番号', '金額', '確認状態']
    const lines = shownItems.map((item) => [
      formatDateTime(item.createdAt),
      personNameText(item.friendName),
      item.affiliateName ?? '名前を読み込めませんでした',
      item.lineAccountName ?? 'アカウント未設定',
      item.offerName ?? '未設定',
      item.conversionPointName ?? '未設定',
      item.orderNumber ?? '',
      item.value ?? '',
      approvalReviewReasons(item).join('・') || '問題なし',
    ])
    const csv = [header, ...lines].map((line) => line.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `conversion-approvals-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [shownItems])

  useEffect(() => {
    registerHeaderActions(
      <Button key="csv" type="button" onClick={exportCsv} disabled={shownItems.length === 0}>
        <Download size={15} aria-hidden="true" /> CSV で書き出す
      </Button>,
    )
    return () => registerHeaderActions(null)
  }, [registerHeaderActions, exportCsv, shownItems.length])

  const listState = error ? 'error' : loading ? 'loading' : items.length === 0 ? 'empty' : shownItems.length === 0 ? 'zero' : 'ready'
  const clearSelections = () => setSelected(new Set())

  return (
    <>
      <KpiStrip>
        <KpiCell
          icon={<ListChecks size={14} aria-hidden="true" />}
          label="承認待ち"
          value={loading || error ? null : counts.pending}
          unit="件"
          sub={loading ? '読み込んでいます' : error ? '読み込めませんでした' : oldestPendingDays == null ? 'いまはありません' : `いちばん古いもの ${formatNumber(oldestPendingDays)}日前`}
          info="まだ認める・認めないを決めていない成果です。認めると報酬が確定します。"
        />
        <KpiCell
          icon={<CheckCircle2 size={14} aria-hidden="true" />}
          label="今月 認めた"
          value={loading || error ? null : approvedThisMonth.length}
          unit="件"
          sub={loading ? '読み込んでいます' : error ? '読み込めませんでした' : formatYen(approvedMonthYen)}
          info="今月（日本時間）に起きて、認めるまで済んだ成果の数です。承認待ちは含みません。"
        />
        <KpiCell
          label="今月 認めなかった"
          value={loading || error ? null : rejectedThisMonth.length}
          unit="件"
          sub={loading || error ? '' : 'テスト注文・取り消し'}
          info="今月（日本時間）に起きて、認めないと決めた成果の数です。"
        />
        <KpiCell
          icon={<Timer size={14} aria-hidden="true" />}
          label="待たせている日数"
          value={loading || error ? null : Math.round(averageWaitDays * 10) / 10}
          unit="日"
          sub="承認待ちの平均"
          info="承認待ちの成果が、起きてから今日まで待っている平均の日数です。"
        />
      </KpiStrip>

      {flaggedCount > 0 && !loading && !error ? (
        <NoticeBar tone="warn">
          {formatNumber(flaggedCount)}件は同じ友だちや同じ注文の重複、返金・取り消し済みの注文が疑われます。内容を確認してから判断してください。
        </NoticeBar>
      ) : !loading && !error ? (
        <NoticeBar>
          認めた成果は、保留期間を過ぎると次の締めで報酬に入ります。締める前なら「認めない」に変えると、今回の支払いから外れます。
        </NoticeBar>
      ) : null}

      {actionError ? <NoticeBar tone="warn">{actionError}</NoticeBar> : null}

      <div className="af-list-tools">
        <SearchField
          placeholder="名前・注文番号で探す"
          aria-label="名前・注文番号で探す"
          value={query}
          onChange={(value) => { setQuery(value); setPage(1); clearSelections() }}
          onClear={() => { setQuery(''); setPage(1); clearSelections() }}
          className="af-list-toolsSearch"
        />
        {affiliateFilter ? (
          <FilterChip
            selected
            onChange={() => { setAffiliateFilter(null); setPage(1); clearSelections() }}
            count={counts.pending}
            title="紹介者の絞りを外して、すべての成果に戻ります"
          >
            紹介者：{affiliateFilterName ?? '名前を確認できません'}
          </FilterChip>
        ) : null}
        {(['pending', 'rejected', 'approved'] as const).map((s) => (
          <FilterChip
            key={s}
            selected={status === s && !flaggedOnly}
            onChange={(selectedNow) => {
              if (!selectedNow) return
              setStatus(s)
              setFlaggedOnly(false)
              setPage(1)
              clearSelections()
            }}
            count={loading || error ? undefined : counts[s]}
          >
            {s === 'pending' ? '承認待ち' : s === 'approved' ? '認めた' : '認めなかった'}
          </FilterChip>
        ))}
        <FilterChip
          selected={flaggedOnly}
          onChange={(value) => { setFlaggedOnly(value); setPage(1); clearSelections() }}
          count={loading || error ? undefined : flaggedCount}
        >
          確認したほうがよい
        </FilterChip>
        <span className="af-list-toolsSpacer" />
        <Select
          aria-label="よく使う絞り込み"
          value={flaggedOnly ? 'flagged' : status}
          options={[
            { value: 'pending', label: 'よく使う絞り込み' },
            { value: 'pending', label: '承認待ち' },
            { value: 'rejected', label: '認めなかった' },
            { value: 'approved', label: '認めた' },
            { value: 'flagged', label: '確認したほうがよい' },
          ]}
          onChange={(value) => {
            if (value === 'flagged') {
              setStatus('pending')
              setFlaggedOnly(true)
            } else {
              setStatus(value as ApprovalStatus)
              setFlaggedOnly(false)
            }
            setPage(1)
            clearSelections()
          }}
        />
        <Select
          aria-label="表示件数"
          value={String(pageSize)}
          options={[20, 50, 100].map((n) => ({ value: String(n), label: `${n}件表示` }))}
          onChange={(value) => { setPageSize(Number(value)); setPage(1); clearSelections() }}
          size="page-size"
        />
      </div>

      {listState === 'error' ? (
        <LoadError name="成果" onRetry={() => { void loadItems() }} />
      ) : listState === 'loading' ? (
        <LoadingRows />
      ) : listState === 'empty' ? (
        <EmptyState
          icon={<ListChecks size={20} aria-hidden="true" />}
          title="まだ成果はありません"
          description="アフィリエイターの紹介リンクから成果が出ると、ここに認める・認めないを決める行が並びます。"
        />
      ) : listState === 'zero' ? (
        <ZeroResultState onReset={() => { setQuery(''); setFlaggedOnly(false); setStatus('pending'); setAffiliateFilter(null); setPage(1); clearSelections() }} />
      ) : (
        <div className="af-list-tableWrap">
          <div className="af-list-tableScroll">
            <table className="af-list-table">
              <thead>
                <tr>
                  <th className="af-list-cellCheck">
                    {status === 'pending' ? (
                      <Checkbox
                        aria-label="このページの確認不要な成果をすべて選ぶ"
                        checked={allSafeSelected}
                        disabled={!canEdit}
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
                    ) : null}
                  </th>
                  <th>友だちと、成果が出た時刻</th>
                  <th>紹介した人</th>
                  <th>アカウント</th>
                  <th>案件と成果地点</th>
                  <th className="af-list-numRight">報酬</th>
                  <th className="af-list-numCenter">確認</th>
                  <th className="af-list-numRight">決める</th>
                </tr>
              </thead>
              <tbody>
                {pagedItems.map((item) => {
                  const reviewReasons = approvalReviewReasons(item)
                  const needsReview = reviewReasons.length > 0
                  return (
                    <tr key={item.eventId} style={needsReview ? { background: 'var(--color-status-warn-soft)' } : undefined}>
                      <td className="af-list-cellCheck">
                        {status === 'pending' ? (
                          <Checkbox
                            aria-label={`${personNameText(item.friendName)}の成果を選ぶ`}
                            checked={selected.has(item.eventId)}
                            disabled={!canEdit || needsReview}
                            title={needsReview ? '確認が必要な成果はまとめて承認できません' : !canEdit ? '閲覧のみのため変更できません' : undefined}
                            onCheckedChange={(checked) => {
                              setSelected((current) => {
                                const next = new Set(current)
                                if (checked) next.add(item.eventId)
                                else next.delete(item.eventId)
                                return next
                              })
                            }}
                          />
                        ) : null}
                      </td>
                      <td>
                        <span className="af-list-cellMain" style={{ fontWeight: 600 }}>{personNameText(item.friendName)}</span>
                        <span className="af-list-cellSub">{formatDateTime(item.createdAt)} に成果</span>
                      </td>
                      <td><span className="af-list-cellMain">{item.affiliateName ?? '名前を読み込めませんでした'}</span></td>
                      <td><span className="af-list-cellMain" style={{ color: 'var(--color-ink-secondary)' }}>{item.lineAccountName ?? 'アカウント未設定'}</span></td>
                      <td>
                        <span className="af-list-cellMain">{item.offerName ?? '未設定'}</span>
                        <span className="af-list-cellSub">{item.conversionPointName ?? '成果地点は未設定'}</span>
                        <span className="af-list-cellSub">成果額 {formatYenNullable(item.value)}</span>
                      </td>
                      <td className="af-list-numRight">
                        <strong>{item.rewardAmount != null ? formatYenNullable(item.rewardAmount) : '未確定'}</strong>
                      </td>
                      <td className="af-list-numCenter">
                        {needsReview ? (
                          <span className={`af-list-statusBadge af-list-statusWarn`} title={reviewReasons.join('・')}>
                            <span className="af-list-statusDot" aria-hidden="true" />要確認
                          </span>
                        ) : (
                          <span className={`af-list-statusBadge af-list-statusOk`}>
                            <span className="af-list-statusDot" aria-hidden="true" />問題なし
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="af-list-rowActions">
                          {status === 'pending' ? (
                            <>
                              <Button
                                type="button"
                                variant="primary"
                                size="compact"
                                disabled={!canEdit || actioning !== null}
                                title={!canEdit ? '閲覧のみのため変更できません' : undefined}
                                onClick={() => { void handleApprove(item.eventId, item.approvalStatus) }}
                              >
                                認める
                              </Button>
                              <Button
                                type="button"
                                size="compact"
                                disabled={!canEdit || actioning !== null}
                                title={!canEdit ? '閲覧のみのため変更できません' : '却下理由はまだ保存できません'}
                                onClick={() => { void handleReject(item.eventId, item.approvalStatus) }}
                              >
                                却下
                              </Button>
                            </>
                          ) : null}
                          {item.offerActionsIncomplete ? (
                            <Button
                              type="button"
                              size="compact"
                              disabled={!canEdit || actioning !== null}
                              title="承認は済んでいます。案件に設定されたタグ付与・シナリオ開始だけをやり直します"
                              onClick={() => { void handleApprove(item.eventId, 'approved') }}
                            >
                              付帯動作をやり直す
                            </Button>
                          ) : null}
                          <Button type="button" size="compact" onClick={() => setDetailItem(item)}>見る</Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {listState === 'ready' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 24px 0' }}>
          <p className="af-list-footNote" style={{ padding: 0 }}>
            {formatNumber(shownItems.length)}件 / 全 {formatNumber(counts[status])}件
            {truncatedStatuses.includes(status) ? '（まだ続きがあります）' : ''}
          </p>
          <Pagination page={currentPage} pageCount={approvalPageCount} onPageChange={(value) => { setPage(value); clearSelections() }} />
        </div>
      ) : null}

      {!loading && !error && truncatedStatuses.length > 0 ? (
        <NoticeBar>
          件数が多いため{truncatedStatuses.map((value) => (value === 'pending' ? '承認待ち' : value === 'approved' ? '承認済み' : '却下済み')).join('・')}の一部はまだ読み込んでいません。
          {'　'}
          <button type="button" style={{ color: 'var(--color-action)', textDecoration: 'underline', border: 0, background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }} onClick={() => { void loadMoreItems() }} disabled={loadingMore}>
            {loadingMore ? '読み込んでいます…' : 'さらに読み込む'}
          </button>
        </NoticeBar>
      ) : null}

      <p className="af-list-footNote">
        却下理由の記録は未接続です。却下状態はまとめて保存できます。行を選ぶと、下にまとめて操作の帯が出ます。
      </p>

      {/* まとめて操作の浮き帯（板 `OylSV`：「②件を選択中　☰操作を選ぶ」） */}
      {canEdit && selected.size > 0 ? (
        <div className="af-list-bulkBar" role="region" aria-label="選択中のまとめ操作">
          <span className="af-list-bulkCount">{formatNumber(selected.size)}</span>
          <span className="af-list-bulkHint">件を選択中　対象を確認してから操作を選んでください</span>
          <span className="af-list-bulkActions">
            <Button type="button" onClick={openBulkWizard}>
              ☰ 操作を選ぶ
            </Button>
          </span>
        </div>
      ) : null}

      {/* 成果の詳細（見る → ダイアログ） */}
      {detailItem ? (
        <Dialog
          open
          title="成果の詳細"
          onCancel={() => setDetailItem(null)}
        >
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-ink-secondary)' }}>
            {personNameText(detailItem.friendName)}／{detailItem.affiliateName ?? '紹介者名を読み込めませんでした'}／{detailItem.offerName ?? '案件未設定'}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-ink-faint)' }}>
            {formatDateTime(detailItem.createdAt)}・{detailItem.lineAccountName ?? 'アカウント未設定'}・{detailItem.conversionPointName ?? '成果地点未設定'}・{formatYenNullable(detailItem.value)}
          </p>
          <dl style={{ margin: '12px 0 0', fontSize: 12, display: 'grid', gap: 6 }}>
            {detailItem.orderNumber ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <dt style={{ color: 'var(--color-ink-faint)', flexShrink: 0 }}>起こりになった注文</dt>
                <dd style={{ margin: 0, color: 'var(--color-ink-secondary)' }}>
                  {detailItem.orderNumber}
                  {detailItem.orderStatus
                    ? `（${APPROVAL_ORDER_STATUS_TEXT[detailItem.orderStatus] ?? detailItem.orderStatus}）`
                    : '（注文は見つかりません）'}
                </dd>
              </div>
            ) : null}
            {detailItem.sameOrderDuplicate ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <dt style={{ color: 'var(--color-ink-faint)', flexShrink: 0 }}>重複の候補</dt>
                <dd style={{ margin: 0, color: 'var(--color-warning)' }}>
                  {ORDER_DUPLICATE_TITLE}：同じ注文・同じ成果地点の成果がほかにもあります。二重に認めないか注文番号で確かめてください。
                </dd>
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <dt style={{ color: 'var(--color-ink-faint)', flexShrink: 0 }}>確定した報酬</dt>
              <dd style={{ margin: 0, color: 'var(--color-ink-secondary)' }}>
                {detailItem.rewardAmount != null ? formatYenNullable(detailItem.rewardAmount) : '未確定'}
              </dd>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <dt style={{ color: 'var(--color-ink-faint)', flexShrink: 0 }}>支払い確定の状態</dt>
              <dd style={{ margin: 0, color: 'var(--color-ink-secondary)' }}>
                {detailItem.rewardEntryStatus
                  ? (REWARD_ENTRY_STATUS_TEXT[detailItem.rewardEntryStatus] ?? detailItem.rewardEntryStatus)
                  : 'まだ確定していません'}
              </dd>
            </div>
          </dl>
          <AttributionSection eventId={detailItem.eventId} />
        </Dialog>
      ) : null}

      {/* まとめて操作の手順窓（★V8-B `hadfk`：手順1/3「操作を選ぶ」） */}
      {bulkWizard ? (
        <BulkOpWizard
          open
          targets={bulkWizard.map((item) => ({
            id: item.eventId,
            displayName: item.affiliateName
              ? `${personNameText(item.friendName)}・${item.affiliateName}`
              : personNameText(item.friendName),
            amountYen: item.value ?? 0,
          }))}
          onReselect={() => { setBulkWizard(null) }}
          onClose={() => { setBulkWizard(null) }}
          onChoose={(action) => { setBulkWizard(null); openBulkConfirm(action) }}
        />
      ) : null}

      {bulkConfirm ? (
        <ConfirmDialog
          open
          title={bulkConfirm.action === 'approved' ? `選んだ${formatNumber(bulkConfirm.items.length)}件をまとめて認めますか` : `選んだ${formatNumber(bulkConfirm.items.length)}件をまとめて却下しますか`}
          description="実行すると1件ずつ同じ判断の契約で処理します。ほかの人が先に判断した対象は上書きせず残します。"
          confirmLabel={bulkConfirm.action === 'approved' ? 'まとめて認める' : 'まとめて却下する'}
          destructive={bulkConfirm.action === 'rejected'}
          busy={actioning !== null}
          onConfirm={() => { void runBulkDecide(bulkConfirm.action, bulkConfirm.items) }}
          onCancel={() => { setBulkConfirm(null) }}
        >
          <ul style={{ margin: '8px 0 0', maxHeight: 192, overflowY: 'auto', fontSize: 14, color: 'var(--color-ink-secondary)', paddingLeft: 18 }}>
            {bulkConfirm.items.map((item) => (
              <li key={item.eventId}>
                {personNameText(item.friendName)}／{item.affiliateName ?? '紹介者名を読み込めませんでした'}／{item.offerName ?? '案件未設定'}
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      ) : null}

      {bulkResult ? (
        <div className="af-list-notice" role="status" aria-label="まとめて処理の結果" style={{ margin: '12px 24px 0', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ color: 'var(--color-ink)' }}>まとめて処理の結果</strong>
            <p style={{ margin: '4px 0 0', fontSize: 13 }}>
              成功 {formatNumber(bulkResult.succeeded.length)}件
              ／ほかの人が先に判断 {formatNumber(bulkResult.conflicted.length)}件
              ／権限なし {formatNumber(bulkResult.denied.length)}件
              ／失敗 {formatNumber(bulkResult.failed.length)}件
            </p>
            {bulkResult.conflicted.length > 0 ? (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                {bulkResult.conflicted.map((entry) => (
                  <li key={entry.id}>先に判断されました：{nameOf(entry.id)}（いま{entry.currentStatus === 'approved' ? '承認済み' : entry.currentStatus === 'rejected' ? '却下済み' : '未判断'}）</li>
                ))}
              </ul>
            ) : null}
            {bulkResult.denied.length > 0 ? (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                {bulkResult.denied.map((eventId) => (
                  <li key={eventId}>権限がありません：{nameOf(eventId)}</li>
                ))}
              </ul>
            ) : null}
            {bulkResult.failed.length > 0 ? (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                {bulkResult.failed.map((entry) => (
                  <li key={entry.id}>失敗しました：{nameOf(entry.id)}（{entry.error}）</li>
                ))}
              </ul>
            ) : null}
          </div>
          <span style={{ display: 'inline-flex', flexShrink: 0, gap: 8 }}>
            {bulkResult.conflicted.length + bulkResult.denied.length + bulkResult.failed.length > 0 ? (
              <Button type="button" onClick={retryBulkLeftovers}>残りを選び直して再試行</Button>
            ) : null}
            <Button type="button" onClick={() => { setBulkResult(null) }}>閉じる</Button>
          </span>
        </div>
      ) : null}
    </>
  )
}
