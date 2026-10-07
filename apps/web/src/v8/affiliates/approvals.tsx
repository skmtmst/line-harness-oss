'use client'

/*
 * ★V8 成果とアフィリエイト「成果承認」（板 `OylSV`、まとめて操作は `hadfk`）。
 *
 * app/affiliates/v8-approvals-tab.tsx から動きを写し、見た目を一覧の型（ListPage）で
 * 組み直した。データの口・操作は今と同じ（承認の全件読み・続きの読み込み・認める・
 * 却下・まとめて判断・付帯動作のやり直し・成果の詳細と成果の付け方・CSV）。
 * 行の右端は「認める」と「…」（認める・認めない・付帯動作をやり直す・詳細を見る）。
 * 左のチェックで選ぶと下から一括バー →「操作を選ぶ」（hadfk）→ 確かめる → 結果。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ban, Check, CircleCheck, CircleHelp, Download, Hourglass, ListChecks, ShieldAlert, X } from 'lucide-react'
import { api, type ConversionApprovalItem } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import BulkBar from '@/components/shared/bulk-bar'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { ListPagePagination } from '@/components/templates'
import {
  approvalReviewReasons,
  downloadCsv,
  formatMonthDayTime,
  formatYen,
  formatYenNullable,
  jstMonthKey,
  listAllConversionApprovals,
  pageCountOf,
  pageOf,
  personName,
  type AffiliateItem,
} from './display'
import AttributionSection from './attribution-view'
import BulkOpWizard from './bulk-op'
import { AffiliateFrame, useAffiliateShell } from './frame'
import {
  AffiliateToolbar,
  PerPageSelect,
  RetryButton,
  RowMenu,
  SavedSelect,
  StateCard,
  StatusPill,
  ToolbarNotices,
} from './parts'
import styles from './affiliates.module.css'

type ApprovalStatus = 'pending' | 'approved' | 'rejected'
type BulkOutcome = 'approved' | 'rejected'
type BulkResult = {
  action: BulkOutcome
  succeeded: string[]
  conflicted: Array<{ id: string; currentStatus: string }>
  denied: string[]
  failed: Array<{ id: string; error: string }>
}

const STATUS_WORD: Record<ApprovalStatus, string> = { pending: '承認待ち', approved: '認めた', rejected: '認めなかった' }
const ORDER_STATUS_WORD: Record<string, string> = { current: '有効', refunded: '返金済み', cancelled: '取り消し済み' }
const REWARD_ENTRY_WORD: Record<string, string> = {
  pending: '確定前', approved: '認めた', held: '保留中', payable: '支払える', settled: '締め済み', paid: '支払い済み', reversed: '取り消し',
}

const SAVED_VIEWS = [
  { value: '', label: 'よく使う絞り込み' },
  { value: 'pending', label: '承認待ち（古い順）' },
  { value: 'flagged', label: '確認したほうがよい' },
  { value: 'approved', label: '認めた' },
  { value: 'rejected', label: '認めなかった' },
]

export default function ApprovalsTab() {
  const { readonly, narrow, setCount, focusAffiliateId } = useAffiliateShell()

  const [status, setStatus] = useState<ApprovalStatus>('pending')
  const [affiliateFilter, setAffiliateFilter] = useState<string | null>(focusAffiliateId)
  const [items, setItems] = useState<ConversionApprovalItem[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [holdDays, setHoldDays] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actioning, setActioning] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [saved, setSaved] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [detailItem, setDetailItem] = useState<ConversionApprovalItem | null>(null)
  const [truncatedStatuses, setTruncatedStatuses] = useState<ApprovalStatus[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState<{ action: BulkOutcome; items: ConversionApprovalItem[] } | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)
  const [bulkWizard, setBulkWizard] = useState<ConversionApprovalItem[] | null>(null)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const loadItems = useCallback(async () => {
    setLoadState('loading')
    try {
      const statuses = ['pending', 'approved', 'rejected'] as const
      const results = await Promise.all(statuses.map((value) => listAllConversionApprovals(value)))
      if (!mounted.current) return
      setItems(results.flatMap((result) => result.items))
      setTruncatedStatuses(statuses.filter((_, index) => results[index].truncated))
      setSelected(new Set())
      setLoadState('ready')
    } catch {
      if (mounted.current) setLoadState('error')
    }
  }, [])

  /* 保留期間（KPI）：登録されたアフィリエイターの保留日数のうち、いちばん長いもの。 */
  const loadHoldDays = useCallback(async () => {
    try {
      const res = await api.affiliates.list()
      if (!mounted.current || !res.success) return
      const days = (res.data as unknown as AffiliateItem[]).map((a) => a.holdDays).filter((d): d is number => typeof d === 'number')
      setHoldDays(days.length > 0 ? Math.max(...days) : null)
    } catch { /* 取れないときは「—」 */ }
  }, [])

  useEffect(() => {
    void loadItems()
    void loadHoldDays()
  }, [loadItems, loadHoldDays])

  const loadMoreItems = useCallback(async () => {
    if (loadingMore || truncatedStatuses.length === 0) return
    setLoadingMore(true)
    try {
      const results = await Promise.all(truncatedStatuses.map(async (value) => {
        const already = items.filter((item) => item.approvalStatus === value).length
        const result = await listAllConversionApprovals(value, already)
        return { status: value, ...result }
      }))
      setItems((current) => {
        const seen = new Set(current.map((item) => item.eventId))
        return [...current, ...results.flatMap((result) => result.items).filter((item) => !seen.has(item.eventId))]
      })
      setTruncatedStatuses(results.filter((result) => result.truncated).map((result) => result.status))
    } catch {
      setActionError('続きを読み込めませんでした。もう一度お試しください。')
    } finally {
      setLoadingMore(false)
    }
  }, [items, loadingMore, truncatedStatuses])

  const decideOne = useCallback(async (eventId: string, expectedStatus: ApprovalStatus, action: BulkOutcome) => {
    if (actioning) return
    setActioning(eventId)
    setActionError(null)
    try {
      const res = action === 'approved'
        ? await api.conversionApprovals.approve(eventId, expectedStatus)
        : await api.conversionApprovals.reject(eventId, expectedStatus)
      if (res.success) {
        await loadItems()
      } else if (res.code === 'approval_conflict') {
        setActionError('ほかの人が先に判断しました。一覧を読み直しました。')
        await loadItems()
      } else {
        setActionError(res.error ?? `${action === 'approved' ? '承認' : '却下'}できませんでした。通信を確かめて、もう一度お試しください。`)
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : `${action === 'approved' ? '承認' : '却下'}できませんでした。通信を確かめて、もう一度お試しください。`)
    }
    setActioning(null)
  }, [actioning, loadItems])

  const nameOf = useCallback((eventId: string) => {
    const item = items.find((entry) => entry.eventId === eventId)
    return item ? personName(item.friendName) : eventId
  }, [items])

  const runBulkDecide = useCallback(async (action: BulkOutcome, targets: ConversionApprovalItem[]) => {
    setActioning(action === 'approved' ? 'bulk' : 'bulk-reject')
    setActionError(null)
    try {
      const res = await api.conversionApprovals.bulkDecide(targets.map((item) => ({ id: item.eventId, status: action, expectedStatus: item.approvalStatus })))
      await loadItems()
      if (res.success && res.data) {
        const data = res.data
        setBulkResult({ action, ...data })
        const leftovers = data.conflicted.length + data.denied.length + data.failed.length
        if (leftovers === 0) setSelected(new Set())
        else setSelected((current) => new Set([...current].filter((eventId) => !data.succeeded.includes(eventId))))
      } else {
        setActionError(res.error ?? 'まとめて処理できませんでした')
      }
    } catch (e) {
      await loadItems()
      setActionError(e instanceof Error ? e.message : 'まとめて処理できませんでした')
    } finally {
      setBulkConfirm(null)
      setActioning(null)
    }
  }, [loadItems])

  const scoped = useMemo(() => (affiliateFilter ? items.filter((item) => item.affiliateId === affiliateFilter) : items), [affiliateFilter, items])
  const affiliateFilterName = affiliateFilter ? (items.find((item) => item.affiliateId === affiliateFilter)?.affiliateName ?? null) : null

  const retryBulkLeftovers = useCallback(() => {
    if (!bulkResult) return
    const ids = new Set([...bulkResult.conflicted.map((entry) => entry.id), ...bulkResult.denied, ...bulkResult.failed.map((entry) => entry.id)])
    const retryable = scoped.filter((item) => ids.has(item.eventId) && item.approvalStatus === 'pending')
    setBulkResult(null)
    if (retryable.length === 0) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(retryable.map((item) => item.eventId)))
    setBulkConfirm({ action: bulkResult.action, items: retryable })
  }, [bulkResult, scoped])

  const counts: Record<ApprovalStatus, number> = {
    pending: scoped.filter((item) => item.approvalStatus === 'pending').length,
    approved: scoped.filter((item) => item.approvalStatus === 'approved').length,
    rejected: scoped.filter((item) => item.approvalStatus === 'rejected').length,
  }
  const pendingItems = scoped.filter((item) => item.approvalStatus === 'pending')
  const flaggedCount = pendingItems.filter((item) => approvalReviewReasons(item).length > 0).length
  const oldestPendingDays = pendingItems.length === 0 ? null : Math.max(...pendingItems.map((item) => {
    const at = new Date(item.createdAt).getTime()
    return Number.isFinite(at) ? Math.floor(Math.max(0, Date.now() - at) / 86_400_000) : 0
  }))
  const month = jstMonthKey()
  const approvedThisMonth = scoped.filter((item) => item.approvalStatus === 'approved' && jstMonthKey(item.createdAt) === month)
  const rejectedThisMonth = scoped.filter((item) => item.approvalStatus === 'rejected' && jstMonthKey(item.createdAt) === month)
  /* 今月認めた成果の報酬の合計（成果額ではなく、払う額）。 */
  const approvedMonthYen = approvedThisMonth.reduce((sum, item) => sum + (item.rewardAmount ?? 0), 0)

  useEffect(() => {
    if (loadState === 'ready' && !affiliateFilter) setCount('approvals', formatNumber(counts.pending))
  }, [affiliateFilter, counts.pending, loadState, setCount])

  const shownItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    return scoped
      .filter((item) => item.approvalStatus === status)
      .filter((item) => !flaggedOnly || approvalReviewReasons(item).length > 0)
      .filter((item) => !needle || [item.friendName, item.affiliateName, item.offerName, item.conversionPointName, item.orderNumber]
        .filter(Boolean).join(' ').toLocaleLowerCase('ja-JP').includes(needle))
      .toSorted((a, b) => (status === 'pending'
        ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
  }, [scoped, flaggedOnly, query, status])

  const pageCount = pageCountOf(shownItems.length, pageSize)
  const currentPage = Math.min(page, pageCount)
  const pagedItems = pageOf(shownItems, currentPage, pageSize)
  const safePendingIds = pagedItems.filter((item) => item.approvalStatus === 'pending' && approvalReviewReasons(item).length === 0).map((item) => item.eventId)
  const allSafeSelected = safePendingIds.length > 0 && safePendingIds.every((eventId) => selected.has(eventId))
  const ready = loadState === 'ready'

  const clearSelections = () => setSelected(new Set())
  const resetPage = (change: () => void) => { change(); setPage(1); clearSelections() }
  const pickStatus = (next: ApprovalStatus, flagged = false) => resetPage(() => {
    setStatus(next)
    setFlaggedOnly(flagged)
  })

  const openBulkConfirm = useCallback((action: BulkOutcome, from?: ConversionApprovalItem[]) => {
    if (actioning) return
    const targets = from ?? scoped.filter((item) => selected.has(item.eventId) && item.approvalStatus === 'pending')
    if (targets.length === 0) return
    setBulkResult(null)
    setBulkConfirm({ action, items: targets })
  }, [actioning, scoped, selected])

  const openBulkWizard = () => {
    if (actioning) return
    const targets = scoped.filter((item) => selected.has(item.eventId) && item.approvalStatus === 'pending')
    if (targets.length === 0) return
    setBulkResult(null)
    setBulkWizard(targets)
  }

  const exportCsv = () => {
    downloadCsv(`conversion-approvals-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['日時', '友だち', 'アフィリエイター', 'アカウント', '案件', '成果地点', '注文番号', '金額', '確認状態'],
      ...shownItems.map((item) => [
        formatMonthDayTime(item.createdAt),
        personName(item.friendName),
        item.affiliateName ?? '名前を読み込めませんでした',
        item.lineAccountName ?? 'アカウント未設定',
        item.offerName ?? '未設定',
        item.conversionPointName ?? '未設定',
        item.orderNumber ?? '',
        item.value ?? '',
        approvalReviewReasons(item).join('・') || '問題なし',
      ]),
    ])
  }

  const loadingWord = '読み込んでいます'
  const errorWord = '読み込めませんでした'
  const stats = (
    <KpiBand>
      <KpiCard
        presentation="band"
        title="承認待ち"
        icon={<CircleHelp size={14} aria-hidden="true" />}
        value={ready ? counts.pending : null}
        unit="件"
        detail={ready ? (oldestPendingDays == null ? 'いまはありません' : `いちばん古いもの ${formatNumber(oldestPendingDays)}日前`) : loadState === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="今月 認めた"
        icon={<Check size={14} aria-hidden="true" />}
        value={ready ? approvedThisMonth.length : null}
        unit="件"
        detail={ready ? formatYen(approvedMonthYen) : loadState === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="今月 認めなかった"
        icon={<X size={14} aria-hidden="true" />}
        value={ready ? rejectedThisMonth.length : null}
        unit="件"
        detail={ready ? 'テスト注文・取り消し' : loadState === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="保留期間"
        icon={<Hourglass size={14} aria-hidden="true" />}
        value={holdDays}
        unit="日"
        detail={holdDays == null ? 'アフィリエイターごとに決めます' : '過ぎた成果が次の締めに入る'}
      />
    </KpiBand>
  )

  const chips = (
    <div role="group" aria-label="状態で絞り込む" className={styles.chipGroup}>
      {affiliateFilter ? (
        <FilterChip selected onChange={() => resetPage(() => setAffiliateFilter(null))} title="紹介者の絞りを外して、すべての成果に戻ります">
          {`紹介者：${affiliateFilterName ?? '名前を確認できません'}`}
        </FilterChip>
      ) : null}
      <FilterChip selected={status === 'pending' && !flaggedOnly} icon={<ListChecks size={13} aria-hidden="true" />} onChange={(on) => { if (on) pickStatus('pending') }}>
        {ready ? `承認待ち ${formatNumber(counts.pending)}` : '承認待ち'}
      </FilterChip>
      <FilterChip selected={status === 'rejected'} icon={<Ban size={13} aria-hidden="true" />} onChange={(on) => { if (on) pickStatus('rejected') }}>
        {ready ? `認めなかった ${formatNumber(counts.rejected)}` : '認めなかった'}
      </FilterChip>
      <FilterChip selected={status === 'approved'} icon={<CircleCheck size={13} aria-hidden="true" />} onChange={(on) => { if (on) pickStatus('approved') }}>
        {ready ? `認めた ${formatNumber(counts.approved)}` : '認めた'}
      </FilterChip>
      <FilterChip selected={flaggedOnly} icon={<ShieldAlert size={13} aria-hidden="true" />} onChange={(on) => pickStatus('pending', on)}>
        {ready ? `確認したほうがよい ${formatNumber(flaggedCount)}` : '確認したほうがよい'}
      </FilterChip>
    </div>
  )

  const trailing = (
    <>
      <SavedSelect
        value={saved}
        options={SAVED_VIEWS}
        onChange={(value) => {
          setSaved(value)
          if (value === 'flagged') pickStatus('pending', true)
          else if (value === 'approved' || value === 'rejected' || value === 'pending') pickStatus(value)
        }}
      />
      <PerPageSelect value={pageSize} onChange={(value) => resetPage(() => setPageSize(value))} />
    </>
  )

  const notices = (
    <ToolbarNotices
      info={`認めた成果は、保留期間${holdDays == null ? '' : `（${formatNumber(holdDays)}日）`}を過ぎると次の締めで報酬に入ります。締める前なら「認めない」に変えると、今回の支払いから外れます。`}
      error={actionError ?? undefined}
    />
  )

  const toolbar = (
    <AffiliateToolbar
      narrow={narrow}
      notices={notices}
      search={{ placeholder: '名前・注文番号で探す', value: query, onChange: (value) => resetPage(() => setQuery(value)) }}
      chips={chips}
      trailing={trailing}
    />
  )

  const canSelect = !readonly && status === 'pending'

  const table = (
    <div className={styles.tableWrap}>
      <DataTable className={`${styles.table} ${styles.tableApprovals}`}>
        <thead>
          <TableHeadRow className={styles.headRow} data-table-layout="columns">
            <Th className={styles.colCheck}>
              {canSelect ? (
                <Checkbox
                  aria-label="このページの確認不要な成果をすべて選ぶ"
                  checked={allSafeSelected}
                  onCheckedChange={(checked) => setSelected((current) => {
                    const next = new Set(current)
                    for (const eventId of safePendingIds) {
                      if (checked) next.add(eventId)
                      else next.delete(eventId)
                    }
                    return next
                  })}
                />
              ) : null}
            </Th>
            <Th className={styles.colName}>友だちと、成果が出た時刻</Th>
            <Th className={styles.colApAffiliate}>紹介した人</Th>
            <Th className={styles.colApAccount}>アカウント</Th>
            <Th className={styles.colApOffer}>案件と成果地点</Th>
            <Th className={`${styles.colApReward} ${styles.num}`}>報酬</Th>
            <Th className={styles.colApCheck}>確認</Th>
            <Th className={styles.colApOps}>決める</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {pagedItems.map((item) => {
            const reasons = approvalReviewReasons(item)
            const needsReview = reasons.length > 0
            const pending = item.approvalStatus === 'pending'
            return (
              <Tr key={item.eventId} className={styles.row} data-table-layout="columns">
                <Td className={styles.colCheck}>
                  {canSelect ? (
                    <Checkbox
                      aria-label={`${personName(item.friendName)}の成果を選ぶ`}
                      checked={selected.has(item.eventId)}
                      disabled={needsReview}
                      title={needsReview ? '確認が必要な成果はまとめて認められません' : undefined}
                      onCheckedChange={(checked) => setSelected((current) => {
                        const next = new Set(current)
                        if (checked) next.add(item.eventId)
                        else next.delete(item.eventId)
                        return next
                      })}
                    />
                  ) : null}
                </Td>
                <Td className={styles.colName}>
                  <span className={styles.stack}>
                    <button type="button" className={styles.rowName} title={personName(item.friendName)} onClick={() => setDetailItem(item)}>{personName(item.friendName)}</button>
                    <span className={styles.rowPlan}>{`${formatMonthDayTime(item.createdAt)} に成果`}</span>
                  </span>
                </Td>
                <Td className={styles.colApAffiliate}><span className={styles.cellNum} title={item.affiliateName ?? undefined}>{item.affiliateName ?? '名前を読み込めませんでした'}</span></Td>
                <Td className={styles.colApAccount}><span className={styles.cellNum} title={item.lineAccountName ?? undefined}>{item.lineAccountName ?? 'アカウント未設定'}</span></Td>
                <Td className={styles.colApOffer}>
                  <span className={styles.stack}>
                    <span className={styles.cellNum} title={item.offerName ?? undefined}>{item.offerName ?? '案件は未設定'}</span>
                    <span className={styles.rowWrap}>{`${item.conversionPointName ?? '成果地点は未設定'}・成果額 ${formatYenNullable(item.value)}`}</span>
                  </span>
                </Td>
                <Td className={`${styles.colApReward} ${styles.num}`}>
                  <span className={styles.cellNum}>{item.rewardAmount != null ? formatYen(item.rewardAmount) : '未確定'}</span>
                </Td>
                <Td className={styles.colApCheck}>
                  {needsReview
                    ? <span title={reasons.join('・')}><StatusPill tone="warn">要確認</StatusPill></span>
                    : <StatusPill tone="active">問題なし</StatusPill>}
                </Td>
                <Td className={styles.colApOps}>
                  <span className={styles.rowActions}>
                    {pending && !readonly ? (
                      <Button type="button" disabled={actioning !== null} onClick={() => { void decideOne(item.eventId, item.approvalStatus, 'approved') }}>認める</Button>
                    ) : null}
                    <RowMenu
                      label={`${personName(item.friendName)}の成果の操作`}
                      items={[
                        ...(!readonly && pending ? [
                          { id: 'approve', label: '認める', disabled: actioning !== null, disabledReason: 'ほかの判断を反映しています', onSelect: () => { void decideOne(item.eventId, item.approvalStatus, 'approved') } },
                          { id: 'reject', label: '認めない（却下）', disabled: actioning !== null, disabledReason: 'ほかの判断を反映しています', onSelect: () => openBulkConfirm('rejected', [item]) },
                        ] : []),
                        ...(!readonly && item.offerActionsIncomplete ? [
                          { id: 'redo', label: '付帯動作をやり直す', disabled: actioning !== null, disabledReason: 'ほかの判断を反映しています', onSelect: () => { void decideOne(item.eventId, 'approved', 'approved') } },
                        ] : []),
                        { id: 'detail', label: '詳細と成果の付け方を見る', onSelect: () => setDetailItem(item) },
                      ]}
                    />
                  </span>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    </div>
  )

  const resetAll = () => {
    setQuery('')
    setFlaggedOnly(false)
    setStatus('pending')
    setAffiliateFilter(null)
    setSaved('')
    setPage(1)
    clearSelections()
  }

  const body = loadState === 'loading' ? (
    <ListState kind="loading" title="成果を読み込んでいます" />
  ) : loadState === 'error' ? (
    <StateCard tone="error" title="成果を読み込めませんでした" description="数の帯は「—」にしています。道具はそのまま使えます。" action={<RetryButton onRetry={() => { void loadItems() }} />} />
  ) : items.length === 0 ? (
    <StateCard icon={<ListChecks size={16} aria-hidden="true" />} title="承認待ちの成果はありません" description="新しい成果が来るとここに出ます" />
  ) : shownItems.length === 0 ? (
    <StateCard title="条件に合うものはありません" description="検索や絞り込みを外すと、すべて出ます" action={<Button type="button" onClick={resetAll}>条件を外す</Button>} />
  ) : (
    <>
      {table}
      <p className={styles.footNote}>
        {readonly
          ? '行の「…」から 詳細と成果の付け方を見る。'
          : '行の「…」から 認める・認めない・詳細を見る。左のチェックで選ぶと、画面の下から一括バーが出ます。「操作を選ぶ」→ 認める／認めない → 確かめる → 結果 の順。却下の理由はまだ記録できません。'}
      </p>
      {truncatedStatuses.length > 0 ? (
        <div className={styles.subSection}>
          <Notice tone="info">
            {`件数が多いため${truncatedStatuses.map((value) => STATUS_WORD[value]).join('・')}の一部はまだ読み込んでいません。`}
          </Notice>
          <div><Button type="button" onClick={() => { void loadMoreItems() }} disabled={loadingMore} busy={loadingMore} busyLabel="読み込んでいます">さらに読み込む</Button></div>
        </div>
      ) : null}
      {bulkResult ? (
        <div className={styles.subSection} role="status" aria-label="まとめて処理の結果">
          <Notice tone={bulkResult.conflicted.length + bulkResult.denied.length + bulkResult.failed.length > 0 ? 'warn' : 'success'}>
            {`まとめて処理の結果：成功 ${formatNumber(bulkResult.succeeded.length)}件／ほかの人が先に判断 ${formatNumber(bulkResult.conflicted.length)}件／権限なし ${formatNumber(bulkResult.denied.length)}件／失敗 ${formatNumber(bulkResult.failed.length)}件`}
          </Notice>
          <ul className={styles.resultList}>
            {bulkResult.conflicted.map((entry) => (
              <li key={entry.id}>{`先に判断されました：${nameOf(entry.id)}（いま${entry.currentStatus === 'approved' ? '承認済み' : entry.currentStatus === 'rejected' ? '却下済み' : '未判断'}）`}</li>
            ))}
            {bulkResult.denied.map((eventId) => <li key={eventId}>{`権限がありません：${nameOf(eventId)}`}</li>)}
            {bulkResult.failed.map((entry) => <li key={entry.id}>{`失敗しました：${nameOf(entry.id)}（${entry.error}）`}</li>)}
          </ul>
          <div className={styles.headActions}>
            {bulkResult.conflicted.length + bulkResult.denied.length + bulkResult.failed.length > 0 ? (
              <Button type="button" onClick={retryBulkLeftovers}>残りを選び直して再試行</Button>
            ) : null}
            <Button type="button" onClick={() => setBulkResult(null)}>閉じる</Button>
          </div>
        </div>
      ) : null}
      <BulkBar count={canSelect ? selected.size : 0} hint="対象を確認してから操作を選んでください">
        <Button type="button" onClick={openBulkWizard}><ListChecks size={15} aria-hidden="true" /> 操作を選ぶ</Button>
      </BulkBar>
    </>
  )

  const pager = ready && shownItems.length > 0 && pageCount > 1 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>{`${formatNumber(shownItems.length)}件中 ${(currentPage - 1) * pageSize + 1}〜${Math.min(currentPage * pageSize, shownItems.length)}件`}</span>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={(value) => { setPage(value); clearSelections() }} />
    </ListPagePagination>
  ) : undefined

  return (
    <AffiliateFrame
      actions={<Button onClick={exportCsv} disabled={shownItems.length === 0}><Download size={15} aria-hidden="true" /> CSV で書き出す</Button>}
      stats={stats}
      toolbar={toolbar}
      pagination={pager}
      overlays={<>
        {detailItem ? (
          <Dialog open title="成果の詳細" onCancel={() => setDetailItem(null)}>
            <dl className={styles.detailList}>
              <div><dt>友だち</dt><dd>{personName(detailItem.friendName)}</dd></div>
              <div><dt>紹介した人</dt><dd>{detailItem.affiliateName ?? '名前を読み込めませんでした'}</dd></div>
              <div><dt>案件</dt><dd>{detailItem.offerName ?? '案件は未設定'}</dd></div>
              <div><dt>いつ・どこで</dt><dd>{`${formatMonthDayTime(detailItem.createdAt)}・${detailItem.lineAccountName ?? 'アカウント未設定'}・${detailItem.conversionPointName ?? '成果地点は未設定'}・${formatYenNullable(detailItem.value)}`}</dd></div>
              {detailItem.orderNumber ? (
                <div><dt>起こりになった注文</dt><dd>{`${detailItem.orderNumber}${detailItem.orderStatus ? `（${ORDER_STATUS_WORD[detailItem.orderStatus] ?? detailItem.orderStatus}）` : '（注文は見つかりません）'}`}</dd></div>
              ) : null}
              {detailItem.sameOrderDuplicate ? (
                <div><dt>重複の候補</dt><dd>同じ注文・同じ成果地点の成果がほかにもあります。二重に認めないか注文番号で確かめてください。</dd></div>
              ) : null}
              <div><dt>確定した報酬</dt><dd>{detailItem.rewardAmount != null ? formatYen(detailItem.rewardAmount) : '未確定'}</dd></div>
              <div><dt>支払い確定の状態</dt><dd>{detailItem.rewardEntryStatus ? (REWARD_ENTRY_WORD[detailItem.rewardEntryStatus] ?? detailItem.rewardEntryStatus) : 'まだ確定していません'}</dd></div>
            </dl>
            <AttributionSection eventId={detailItem.eventId} />
          </Dialog>
        ) : null}
        {bulkWizard ? (
          <BulkOpWizard
            open
            targets={bulkWizard.map((item) => ({ id: item.eventId, displayName: item.affiliateName ?? personName(item.friendName), amountYen: item.rewardAmount ?? item.value ?? 0 }))}
            onReselect={() => setBulkWizard(null)}
            onClose={() => setBulkWizard(null)}
            onChoose={(action) => { const targets = bulkWizard; setBulkWizard(null); openBulkConfirm(action, targets) }}
          />
        ) : null}
        {bulkConfirm ? (
          <ConfirmDialog
            open
            title={bulkConfirm.action === 'approved'
              ? `選んだ${formatNumber(bulkConfirm.items.length)}件を認めますか`
              : `選んだ${formatNumber(bulkConfirm.items.length)}件を認めない（却下）にしますか`}
            description="1件ずつ同じ判断の決まりで処理します。ほかの人が先に判断した成果は上書きせず残します。"
            confirmLabel={bulkConfirm.action === 'approved' ? '認める' : '認めない（却下）'}
            destructive={bulkConfirm.action === 'rejected'}
            busy={actioning !== null}
            onConfirm={() => { void runBulkDecide(bulkConfirm.action, bulkConfirm.items) }}
            onCancel={() => setBulkConfirm(null)}
          >
            <ul className={styles.resultList}>
              {bulkConfirm.items.map((item) => (
                <li key={item.eventId}>{`${personName(item.friendName)}／${item.affiliateName ?? '紹介者名を読み込めませんでした'}／${item.offerName ?? '案件は未設定'}`}</li>
              ))}
            </ul>
          </ConfirmDialog>
        ) : null}
      </>}
    >
      {body}
    </AffiliateFrame>
  )
}
