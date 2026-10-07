'use client'

/*
 * ★V8 成果とアフィリエイト「アフィリエイター」（板 `nJlxX`・1152 `KdFRI`・
 * 閲覧のみ `v9JWQ`、状態は見本帳 `rRk0C`、行を押すと引き出し `tnTn9`）。
 *
 * app/affiliates/v8-affiliates-tab.tsx から動きを写し、見た目を一覧の型
 * （ListPage）で組み直した。データの口・操作は今と同じ（一覧・集計・承認待ち・
 * 今回の締めの見込み・紹介リンクのコピー・紹介を止める・まとめて止める・CSV）。
 *
 * フォルダの列：アフィリエイターを分けて保存する口は無いので、報酬の決め方で
 * 分けた見え方の切り替えとして持つ（保存しない）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, CircleDot, CircleHelp, Download, Plus, Trophy, Users } from 'lucide-react'
import { api, type ConversionApprovalItem } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import BulkBar from '@/components/shared/bulk-bar'
import Checkbox from '@/components/shared/checkbox'
import { FolderDotName } from '@/components/shared/folder-dot'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel from '@/components/shared/folder-panel'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { notifyToast } from '@/components/shared/toast'
import { ListPagePagination } from '@/components/templates'
import {
  calculateAffiliateReward,
  currentSettlementPeriod,
  deltaText,
  distributionUrl,
  downloadCsv,
  formatYen,
  listAllConversionApprovals,
  pageCountOf,
  pageOf,
  planText,
  previousSettlementPeriod,
  type AffiliateItem,
  type AffiliateLink,
  type AffiliateListRow,
  type AffiliateReportRow,
} from './display'
import { AffiliateArchiveDialog } from './dialogs'
import AffiliateDrawer from './drawer'
import { AffiliateFrame, CreateButton, useAffiliateShell } from './frame'
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

type FilterKey = 'active' | 'reward'
type SortKey = 'conversions' | 'reward' | 'name' | 'newest'
type GroupKey = 'all' | 'rate' | 'fixed' | 'none' | 'stopped'
type LoadState = 'loading' | 'ready' | 'error'

/** 「よく使う絞り込み」：絞り込みと並びを1つにまとめた見方。 */
const SAVED_VIEWS: Array<{ value: string; label: string; filters: FilterKey[]; sort: SortKey; group?: GroupKey }> = [
  { value: '', label: 'よく使う絞り込み', filters: [], sort: 'conversions' },
  { value: 'active-results', label: '計測中・成果が多い順', filters: ['active'], sort: 'conversions' },
  { value: 'reward', label: '報酬あり・報酬が多い順', filters: ['reward'], sort: 'reward' },
  { value: 'stopped', label: '停止中のみ', filters: [], sort: 'newest', group: 'stopped' },
  { value: 'name', label: '名前順', filters: [], sort: 'name' },
  { value: 'newest', label: '登録が新しい順', filters: [], sort: 'newest' },
]

/** フォルダの列（見え方の切り替え。保存しない）。 */
const GROUPS: Array<{ key: GroupKey; label: string; match: (row: AffiliateListRow) => boolean }> = [
  { key: 'all', label: 'すべて', match: () => true },
  { key: 'rate', label: '売上の割合で払う', match: (row) => row.isActive && row.commissionRate > 0 },
  { key: 'fixed', label: '1件ごとに払う', match: (row) => row.isActive && row.commissionRate <= 0 && row.rewardAmount > 0 },
  { key: 'none', label: '報酬なし（計測のみ）', match: (row) => row.isActive && row.commissionRate <= 0 && row.rewardAmount <= 0 },
  { key: 'stopped', label: '止めている', match: (row) => !row.isActive },
]

export default function AffiliatorsTab() {
  const router = useRouter()
  const { readonly, narrow, accountId, setCount, focusAffiliateId } = useAffiliateShell()
  const settlementPeriod = useMemo(() => currentSettlementPeriod(), [])

  /* ===== 一覧 ===== */
  const [rows, setRows] = useState<AffiliateListRow[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')

  /* ===== 数の帯の元 ===== */
  const [pendingItems, setPendingItems] = useState<ConversionApprovalItem[]>([])
  const [approvalState, setApprovalState] = useState<LoadState>('loading')
  const [approvalTruncated, setApprovalTruncated] = useState(false)
  const [paymentTotal, setPaymentTotal] = useState<number | null>(null)
  const [paymentState, setPaymentState] = useState<LoadState>('loading')
  const [monthly, setMonthly] = useState<{ count: number; delta: number | null } | null>(null)
  const [monthlyState, setMonthlyState] = useState<LoadState>('loading')

  /* ===== 見せ方 ===== */
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<FilterKey[]>([])
  const [group, setGroup] = useState<GroupKey>('all')
  const [sort, setSort] = useState<SortKey>('conversions')
  const [saved, setSaved] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  /* ===== 操作 ===== */
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null)
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [drawerEdit, setDrawerEdit] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [linkBaseUrl, setLinkBaseUrl] = useState<string | null>(null)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  /* 配布URLの土台（短縮ドメイン）。取れなくても /r/ で作れる。 */
  useEffect(() => {
    let cancelled = false
    void api.accountSettings.getLinkBaseUrl().then((res) => {
      if (cancelled || !res.success || !res.data) return
      setLinkBaseUrl(res.data)
    }).catch(() => { /* 取れなくても /r/ で作れる */ })
    return () => { cancelled = true }
  }, [])

  const loadList = useCallback(async () => {
    setLoadState('loading')
    try {
      const [affiliatesRes, reportRes] = await Promise.all([api.affiliates.list(), api.affiliates.allReport()])
      if (!affiliatesRes.success || !reportRes.success) throw new Error('fetch failed')
      const affiliates = affiliatesRes.data as unknown as AffiliateItem[]
      const report = new Map((reportRes.data as unknown as AffiliateReportRow[]).map((r) => [r.affiliateId, r]))
      if (!mounted.current) return
      setRows(affiliates.map((a) => {
        const rep = report.get(a.id)
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
      setLoadState('ready')
    } catch {
      if (!mounted.current) return
      setRows([])
      setLoadState('error')
    }
  }, [])

  const loadApprovals = useCallback(async () => {
    setApprovalState('loading')
    try {
      const pending = await listAllConversionApprovals('pending')
      if (!mounted.current) return
      setPendingItems(pending.items)
      setApprovalTruncated(pending.truncated)
      setApprovalState('ready')
    } catch {
      if (mounted.current) setApprovalState('error')
    }
  }, [])

  const loadPayment = useCallback(async () => {
    if (!accountId) {
      setPaymentState('error')
      setPaymentTotal(null)
      return
    }
    setPaymentState('loading')
    try {
      const res = await api.affiliates.settlementPreview(accountId, settlementPeriod)
      if (!mounted.current) return
      if (!res.success || !Array.isArray(res.data.affiliates)) {
        setPaymentState('error')
        setPaymentTotal(null)
        return
      }
      setPaymentTotal(res.data.totalAmount)
      setPaymentState('ready')
    } catch {
      if (mounted.current) {
        setPaymentState('error')
        setPaymentTotal(null)
      }
    }
  }, [accountId, settlementPeriod])

  const loadMonthly = useCallback(async () => {
    setMonthlyState('loading')
    try {
      const prev = previousSettlementPeriod(settlementPeriod.periodFrom)
      const [res, prevRes] = await Promise.all([
        api.affiliates.allReport({ startDate: settlementPeriod.periodFrom, endDate: settlementPeriod.periodTo }),
        api.affiliates.allReport({ startDate: prev.periodFrom, endDate: prev.periodTo }),
      ])
      if (!res.success) throw new Error('monthly report failed')
      const total = (arr: unknown) => (arr as Array<{ totalConversions: number }>).reduce((sum, row) => sum + row.totalConversions, 0)
      const current = total(res.data)
      if (!mounted.current) return
      setMonthly({ count: current, delta: prevRes.success ? current - total(prevRes.data) : null })
      setMonthlyState('ready')
    } catch {
      if (mounted.current) {
        setMonthly(null)
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

  /* タブの名の横の件数。 */
  useEffect(() => {
    if (loadState === 'ready') setCount('affiliates', formatNumber(rows.length))
  }, [loadState, rows.length, setCount])
  useEffect(() => {
    if (approvalState === 'ready') setCount('approvals', formatNumber(pendingItems.length))
  }, [approvalState, pendingItems.length, setCount])

  /* ===== 絞り込み ===== */
  const groupRows = useMemo(() => {
    const match = GROUPS.find((g) => g.key === group)?.match ?? (() => true)
    return rows.filter(match)
  }, [group, rows])
  const shownRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    return groupRows
      .filter((row) => {
        if (needle && !`${row.name} ${row.code}`.toLocaleLowerCase('ja-JP').includes(needle)) return false
        if (filters.includes('active') && !row.isActive) return false
        if (filters.includes('reward') && row.rewardAmount <= 0) return false
        return true
      })
      .toSorted((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name, 'ja-JP')
        if (sort === 'reward') return b.rewardAmount - a.rewardAmount
        if (sort === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        return b.totalConversions - a.totalConversions || b.rewardAmount - a.rewardAmount
      })
  }, [filters, groupRows, query, sort])

  const pageCount = pageCountOf(shownRows.length, pageSize)
  const currentPage = Math.min(page, pageCount)
  const pagedRows = pageOf(shownRows, currentPage, pageSize)
  const activeCount = rows.filter((row) => row.isActive).length
  const rewardCount = rows.filter((row) => row.rewardAmount > 0).length
  const pendingCount = pendingItems.length
  const ready = loadState === 'ready'

  const resetPage = (change: () => void) => { change(); setPage(1) }
  const resetConditions = () => {
    setQuery('')
    setFilters([])
    setGroup('all')
    setSaved('')
    setPage(1)
  }
  const toggleFilter = (key: FilterKey, on: boolean) => resetPage(() => {
    setSaved('')
    setFilters((cur) => (on ? [...cur, key] : cur.filter((value) => value !== key)))
  })

  /* ===== 行の操作 ===== */
  const openDrawer = useCallback((id: string, edit: boolean) => {
    setDrawerId(id)
    setDrawerEdit(edit)
  }, [])

  /* `?affiliate=` で来たとき、その人の引き出しを最初から開く（1回だけ）。 */
  const focusHandled = useRef(false)
  useEffect(() => {
    if (focusHandled.current || !focusAffiliateId || !ready) return
    focusHandled.current = true
    if (rows.some((row) => row.id === focusAffiliateId)) openDrawer(focusAffiliateId, false)
  }, [focusAffiliateId, ready, rows, openDrawer])

  const copyFirstLink = useCallback(async (row: AffiliateListRow) => {
    try {
      const res = await api.affiliates.links(row.id)
      if (!res.success) throw new Error('links failed')
      const links = res.data as unknown as AffiliateLink[]
      const link = links.find((item) => Boolean(item.is_active)) ?? links[0]
      if (!link) {
        notifyToast('この人には紹介リンクがまだありません。詳細から発行できます。')
        return
      }
      const url = distributionUrl(link.ref_code, linkBaseUrl)
      if (!url) return
      try {
        await navigator.clipboard.writeText(url)
        notifyToast('紹介リンクをコピーしました。')
      } catch {
        openDrawer(row.id, false)
      }
    } catch {
      notifyToast('紹介リンクを読み込めませんでした。もう一度お試しください。')
    }
  }, [linkBaseUrl, openDrawer])

  /* まとめて「紹介を止める」。行ごとの確かめは「…」の紹介を止めるが担う。 */
  const bulkTargets = useMemo(() => rows.filter((row) => selected.has(row.id) && row.isActive), [rows, selected])
  const runBulkArchive = useCallback(async () => {
    if (bulkTargets.length === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      const results = await Promise.allSettled(bulkTargets.map((row) => api.affiliates.archive(row.id, { mode: 'pause' })))
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

  const exportCsv = () => {
    downloadCsv(`affiliates-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['名前', '紹介コード', '紹介リンク数', '友だち追加', '成果', '承認済み報酬'],
      ...shownRows.map((row) => [row.name, row.code, row.linkCount, row.friendAdds, row.totalConversions, Math.round(row.rewardAmount)]),
    ])
  }

  /* ===== 数の帯（4マス） ===== */
  const loadingWord = '読み込んでいます'
  const errorWord = '読み込めませんでした'
  const stats = (
    <KpiBand>
      <KpiCard
        presentation="band"
        title="アフィリエイター"
        icon={<Users size={14} aria-hidden="true" />}
        value={ready ? rows.length : null}
        unit="人"
        detail={ready ? `計測中 ${formatNumber(activeCount)}・停止中 ${formatNumber(rows.length - activeCount)}` : loadState === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="今月の成果"
        icon={<Trophy size={14} aria-hidden="true" />}
        value={monthlyState === 'ready' && monthly ? monthly.count : null}
        unit="件"
        detail={monthlyState === 'ready' && monthly ? deltaText(monthly.delta) : monthlyState === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="今月の報酬"
        icon={<Banknote size={14} aria-hidden="true" />}
        value={null}
        valueText={paymentState === 'ready' && paymentTotal != null ? formatYen(paymentTotal) : '—'}
        unit=""
        detail={paymentState === 'ready' ? `承認待ち ${formatNumber(pendingCount)} 件は入っていない` : paymentState === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="承認待ち"
        icon={<CircleHelp size={14} aria-hidden="true" />}
        value={approvalState === 'ready' ? pendingCount : null}
        unit="件"
        detail={approvalState === 'ready' ? (approvalTruncated ? '直近の分まで表示' : '認めると報酬に入ります') : approvalState === 'loading' ? loadingWord : errorWord}
      />
    </KpiBand>
  )

  const createButton = (full: boolean) => (
    <CreateButton href="/affiliates/new" readonly={readonly} full={full}>
      <Plus size={15} aria-hidden="true" /> アフィリエイターを作る
    </CreateButton>
  )

  const groupCount = (key: GroupKey) => rows.filter(GROUPS.find((g) => g.key === key)?.match ?? (() => true)).length
  const folderPanel = (
    <FolderPanel
      heading="フォルダ"
      rows={GROUPS.map((item) => ({ id: item.key, label: item.label, count: ready ? groupCount(item.key) : null }))}
      activeId={group}
      onSelect={(id) => resetPage(() => { setSaved(''); setGroup(id as GroupKey) })}
      addFolderNote={<p className={styles.stateDesc}>報酬の決め方で分けた見え方です</p>}
    />
  )

  const folderSelect = (
    <div className={styles.narrowFolder}>
      <Select
        aria-label="フォルダ"
        value={group}
        options={GROUPS.map((item) => ({ value: item.key, label: `フォルダ：${item.label}` }))}
        onChange={(value) => resetPage(() => setGroup(value as GroupKey))}
      />
    </div>
  )

  const chips = (
    <div role="group" aria-label="状態で絞り込む" className={styles.chipGroup}>
      <FilterChip
        selected={filters.includes('active')}
        icon={<CircleDot size={13} aria-hidden="true" />}
        onChange={(on) => toggleFilter('active', on)}
      >
        {ready ? `計測中 ${formatNumber(activeCount)}` : '計測中'}
      </FilterChip>
      <FilterChip
        selected={filters.includes('reward')}
        icon={<Banknote size={13} aria-hidden="true" />}
        onChange={(on) => toggleFilter('reward', on)}
      >
        {ready ? `報酬あり ${formatNumber(rewardCount)}` : '報酬あり'}
      </FilterChip>
    </div>
  )

  const trailing = (
    <>
      <SavedSelect
        value={saved}
        options={SAVED_VIEWS.map((view) => ({ value: view.value, label: view.label }))}
        onChange={(value) => {
          const view = SAVED_VIEWS.find((v) => v.value === value)
          if (!view) return
          resetPage(() => {
            setSaved(value)
            setFilters([...view.filters])
            setSort(view.sort)
            setGroup(view.group ?? 'all')
          })
        }}
      />
      <PerPageSelect value={pageSize} onChange={(value) => resetPage(() => setPageSize(value))} />
    </>
  )

  const notices = (
    <ToolbarNotices
      info={approvalState === 'ready' && pendingCount > 0
        ? `承認待ちの成果が ${formatNumber(pendingCount)} 件あります。「成果承認」で認めると、次の締めで報酬に入ります。`
        : undefined}
    />
  )

  const toolbar = (
    <AffiliateToolbar
      narrow={narrow}
      notices={notices}
      search={{ placeholder: '名前・紹介コードで探す', value: query, onChange: (value) => resetPage(() => setQuery(value)) }}
      chips={chips}
      trailing={trailing}
      narrowLead={<>{createButton(false)}{folderSelect}</>}
    />
  )

  const allChecked = pagedRows.length > 0 && pagedRows.every((row) => selected.has(row.id))
  const setChecked = (ids: string[], checked: boolean) => setSelected((cur) => {
    const next = new Set(cur)
    for (const id of ids) {
      if (checked) next.add(id)
      else next.delete(id)
    }
    return next
  })

  const table = (
    <div className={styles.tableWrap}>
      <DataTable className={styles.table}>
        <thead>
          <TableHeadRow className={styles.headRow} data-table-layout="columns">
            <Th className={styles.colCheck}>
              {readonly ? null : (
                <Checkbox
                  aria-label="このページの全員を選ぶ"
                  checked={allChecked}
                  onCheckedChange={(checked) => setChecked(pagedRows.map((row) => row.id), checked)}
                />
              )}
            </Th>
            <Th className={styles.colName}>アフィリエイター</Th>
            <Th className={`${styles.colLinks} ${styles.num}`}>紹介リンク</Th>
            <Th className={`${styles.colFriends} ${styles.num}`}>友だち追加</Th>
            <Th className={`${styles.colConv} ${styles.num}`}>成果</Th>
            <Th className={`${styles.colReward} ${styles.num}`}>報酬</Th>
            <Th className={styles.colOps}>操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {pagedRows.map((row) => (
            <Tr key={row.id} className={styles.row} data-table-layout="columns">
              <Td className={styles.colCheck}>
                {readonly ? null : (
                  <Checkbox
                    aria-label={`${row.name}を選ぶ`}
                    checked={selected.has(row.id)}
                    onCheckedChange={(checked) => setChecked([row.id], checked)}
                  />
                )}
              </Td>
              <Td className={styles.colName}>
                <span className={styles.stack}>
                  {/* 左にフォルダの列がある一覧は、名前の前に丸（報酬の決め方の分け方は保存されたフォルダではないので未分類の輪）。
                      フォルダの列が選ぶ欄に畳まれる幅（1152・KdFRI）では、丸と字下げを CSS で外す（列を畳む型と同じ幅の決まり）。 */}
                  <span className={styles.nameDot}><FolderDotName folder={null}>{nameButton(row)}</FolderDotName></span>
                  <span className={`${styles.rowCode} ${styles.dotIndent}`} title={row.code}>{row.code}</span>
                  <span className={`${styles.rowPlan} ${styles.dotIndent}`}>{planText(row)}</span>
                  <span className={styles.dotIndent}>
                    <StatusPill tone={row.isActive ? 'active' : 'neutral'}>{row.isActive ? '計測中' : '停止中'}</StatusPill>
                  </span>
                </span>
              </Td>
              <Td className={`${styles.colLinks} ${styles.num}`}><span className={styles.cellNum}>{`${formatNumber(row.linkCount)}本`}</span></Td>
              <Td className={`${styles.colFriends} ${styles.num}`}><span className={styles.cellNum}>{`${formatNumber(row.friendAdds)}人`}</span></Td>
              <Td className={`${styles.colConv} ${styles.num}`}><span className={styles.cellNum}>{`${formatNumber(row.totalConversions)}件`}</span></Td>
              <Td className={`${styles.colReward} ${styles.num}`}><span className={styles.cellNum}>{formatYen(row.rewardAmount)}</span></Td>
              <Td className={styles.colOps}>
                <span className={styles.rowActions}>
                  <Button type="button" onClick={() => openDrawer(row.id, false)}>成果を見る</Button>
                  <RowMenu
                    label={`${row.name}の操作`}
                    items={[
                      { id: 'copy', label: '紹介リンクをコピー', onSelect: () => { void copyFirstLink(row) } },
                      ...(readonly ? [] : [
                        { id: 'edit', label: '編集', onSelect: () => openDrawer(row.id, true) },
                        ...(row.isActive ? [{ id: 'archive', label: '紹介を止める', tone: 'danger' as const, dividerBefore: true, onSelect: () => setArchiveTarget({ id: row.id, name: row.name }) }] : []),
                      ]),
                    ]}
                  />
                </span>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  )

  const body = loadState === 'loading' ? (
    <ListState kind="loading" title="アフィリエイターを読み込んでいます" />
  ) : loadState === 'error' ? (
    <StateCard
      tone="error"
      title="アフィリエイターを読み込めませんでした"
      description="数の帯は「—」にしています。道具はそのまま使えます。"
      action={<RetryButton onRetry={() => { void loadList() }} />}
    />
  ) : rows.length === 0 ? (
    <StateCard
      icon={<Users size={16} aria-hidden="true" />}
      title="まだアフィリエイターはいません"
      description="紹介してくれる人を登録すると、紹介リンクができます。先にコンバージョンで「何を成果にするか」を決めておきます"
      action={readonly ? undefined : (
        <Button variant="primary" href="/affiliates/new"><Plus size={14} aria-hidden="true" /> アフィリエイターを作る</Button>
      )}
    />
  ) : shownRows.length === 0 ? (
    <StateCard
      title="条件に合うものはありません"
      description="検索や絞り込みを外すと、すべて出ます"
      action={<Button type="button" onClick={resetConditions}>条件を外す</Button>}
    />
  ) : (
    <>
      {table}
      <BulkBar count={readonly ? 0 : selected.size} unit="人" hint="対象を確認してから操作を選んでください">
        <Button type="button" onClick={() => setBulkConfirm(true)} disabled={bulkTargets.length === 0}>まとめて紹介を止める</Button>
        <Button type="button" onClick={() => setSelected(new Set())}>選ぶのをやめる</Button>
      </BulkBar>
    </>
  )

  const pager = ready && shownRows.length > 0 && pageCount > 1 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>
        {`${formatNumber(shownRows.length)}人中 ${(currentPage - 1) * pageSize + 1}〜${Math.min(currentPage * pageSize, shownRows.length)}人`}
      </span>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
    </ListPagePagination>
  ) : undefined

  function nameButton(row: { id: string; name: string }) {
    return (
      <button type="button" className={styles.rowName} title={row.name} onClick={() => openDrawer(row.id, false)}>
        {row.name}
      </button>
    )
  }
  const drawerRow = drawerId ? rows.find((row) => row.id === drawerId) ?? null : null

  return (
    <AffiliateFrame
      actions={
        <Button onClick={exportCsv} disabled={shownRows.length === 0}>
          <Download size={15} aria-hidden="true" /> CSV で書き出す
        </Button>
      }
      stats={stats}
      folders={narrow ? undefined : <>{createButton(true)}{folderPanel}</>}
      toolbar={toolbar}
      pagination={pager}
      overlays={<>
        <AffiliateArchiveDialog
          target={archiveTarget}
          onClose={() => setArchiveTarget(null)}
          onChanged={() => { void loadList() }}
        />
        <ConfirmDialog
          open={bulkConfirm}
          title={`${formatNumber(bulkTargets.length)}人の紹介をまとめて止めますか？`}
          description="止めると、その人たちの紹介リンクからの成果はこれから数えません。認めるのを待っている成果がある人は、行の「…」の紹介を止めるで中身を確かめてから止めてください。"
          confirmLabel="まとめて止める"
          destructive
          busy={bulkBusy}
          onConfirm={() => { void runBulkArchive() }}
          onCancel={() => setBulkConfirm(false)}
        />
        {drawerRow ? (
          <AffiliateDrawer
            affiliate={drawerRow}
            accountId={accountId}
            readonly={readonly}
            startInEdit={drawerEdit}
            linkBaseUrl={linkBaseUrl}
            onClose={() => {
              setDrawerId(null)
              if (focusAffiliateId) router.replace('/affiliates')
            }}
            onChanged={() => { void loadList(); void loadApprovals() }}
            onStopRequest={(id, name) => setArchiveTarget({ id, name })}
          />
        ) : null}
      </>}
    >
      {body}
    </AffiliateFrame>
  )
}
