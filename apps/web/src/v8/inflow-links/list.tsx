'use client'

/*
 * ★V8-B 流入と計測の一覧（Pencil「★V8-B 画面の地図」：
 * 一覧 `xbHxg`、1152 `y1ztx`、閲覧のみ `EMUl9`、QR コードの小窓 `GtI4Y`）。
 *
 * 型（ListPage）に、数の帯・左のフォルダの列（上に「流入リンクを作る」）・
 * 案内の帯・道具の段・表を置く。行は「コピー」「…」「編集」。
 * データの口と判断は今の一覧（app/inflow-links/page.tsx の InflowLinksPageInner）と同じ。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Bookmark,
  CircleAlert,
  Code,
  Eye,
  Inbox,
  Link2,
  Megaphone,
  MoreHorizontal,
  Plus,
  UserPlus,
  Users,
} from 'lucide-react'
import type { ApiResponse, EntryRoute, EntryRouteGenre, Scenario, Tag, TrafficPool } from '@line-crm/shared'
import { ApiError, api, fetchApi } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'
import type { FeatureKey } from '@/lib/feature-settings'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { ListPage, ListPagePagination } from '@/components/templates'
import ListToolbar from '@/components/shared/list-toolbar'
import SearchField from '@/components/shared/search-field'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import IconButton from '@/components/shared/icon-button'
import Checkbox from '@/components/shared/checkbox'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Notice from '@/components/shared/notice'
import FilterChip from '@/components/shared/filter-chip'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import { FolderDotName } from '@/components/shared/folder-dot'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import BulkBar from '@/components/shared/bulk-bar'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import { loadFailureCopy } from '@/components/shared/api-error-message'
import { notifyToast } from '@/components/shared/toast'
import EditRouteDialog from './edit-route-dialog'
import GenreDialog from './genre-dialog'
import BulkDialog, { type BulkRouteAction } from './bulk-dialog'
import QrDialog, { referralUrl, type QrRoute } from './qr-dialog'
import {
  becameLines,
  buildRows,
  formatLatest,
  isRefSummaryData,
  isUnconfigured,
  matchesFilter,
  routeStatus,
  shouldShowRow,
  sortRows,
  type RefSummaryData,
  type RouteFilter,
  type RouteRow,
  type RouteSort,
  type TrackedLinkRow,
} from './rows'
import styles from './list.module.css'

interface MessageTemplate {
  id: string
  name: string
  messageType: string
  messageContent: string
}

/** フォルダの「未分類」。空文字は「すべて」なので別の値にする。 */
const UNCATEGORIZED = '__uncategorized__'
const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'

const SORT_OPTIONS: Array<{ value: RouteSort; label: string }> = [
  { value: 'friends-desc', label: '友だち追加が多い順' },
  { value: 'clicks-desc', label: 'クリックが多い順' },
  { value: 'latest-desc', label: '最近追加された順' },
  { value: 'name', label: '流入元名順' },
]

export default function InflowListV8({
  onRouteCountChange,
}: {
  /** 入口（page.tsx）へ「この一覧に見えている経路の数」を渡す。読み込み前・失敗は null。 */
  onRouteCountChange?: (count: number | null) => void
}) {
  usePageTitle('流入と計測')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  // PERF-03: 編集窓の候補が属する機能のオン・オフ。切られている系統は取らない。
  const visibility = useFeatureVisibility(selectedAccountId)
  const narrow = useNarrowViewport()
  const role = useStaffRole()
  // 役割が読めるまでは今までどおり操作を出す。staff と分かったら押せない形にする（最後の守りは口の 403）。
  const readonly = role !== null && !canManageRole(role)

  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const loadRequestRef = useRef(0)
  const [routes, setRoutes] = useState<EntryRoute[]>([])
  const [genres, setGenres] = useState<EntryRouteGenre[]>([])
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [trackedLinks, setTrackedLinks] = useState<TrackedLinkRow[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [summary, setSummary] = useState<RefSummaryData | null>(null)
  const [summaryAvailable, setSummaryAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [sort, setSort] = useState<RouteSort>('friends-desc')
  const [filter, setFilter] = useState<RouteFilter>('all')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  // null＝閉じている／'new'＝作る／EntryRoute＝直す／{register}＝未登録 ref を登録する
  const [editing, setEditing] = useState<EntryRoute | 'new' | { register: string } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null)
  const [selectedGenre, setSelectedGenre] = useState('')
  const [search, setSearch] = useState('')
  const [editingGenre, setEditingGenre] = useState<EntryRouteGenre | 'new' | null>(null)
  const [qrRoute, setQrRoute] = useState<QrRoute | null>(null)
  const [openMenuRefCode, setOpenMenuRefCode] = useState<string | null>(null)
  const [presetOpen, setPresetOpen] = useState(false)
  const [adConnected, setAdConnected] = useState<{ total: number; names: string[] } | null>(null)
  const [poolMembers, setPoolMembers] = useState<Record<string, Set<string>>>({})
  const [poolMemberNames, setPoolMemberNames] = useState<Record<string, string[]>>({})
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(() => new Set())
  const [bulkAction, setBulkAction] = useState<BulkRouteAction | null>(null)
  // 数の帯のマスの「…」。開いているマスの名前。
  const [openTileMenu, setOpenTileMenu] = useState<string | null>(null)

  const load = useCallback(async () => {
    const requestGeneration = ++loadRequestRef.current
    const accountAtRequest = latestAccountRef.current
    const isCurrent = () =>
      requestGeneration === loadRequestRef.current && accountAtRequest === latestAccountRef.current
    setLoading(true)
    setLoadFailed(false)
    setLoadError(null)
    try {
      // ref-summary は lineAccountId でそのアカウントに実流入があった ref だけに絞れる。
      const summaryQuery = accountAtRequest ? `?lineAccountId=${accountAtRequest}` : ''
      // N-011: 経路一覧も選んでいるアカウントで絞る。
      const routeQuery = accountAtRequest ? `?account_id=${encodeURIComponent(accountAtRequest)}` : ''
      const [r, genreRes, sum, tl] = await Promise.all([
        fetchApi<{ success: boolean; data: EntryRoute[] }>(`/api/entry-routes${routeQuery}`),
        // 古い Worker でもフォルダだけ空にして一覧は出す。
        api.entryRouteGenres.list().catch(() => ({ success: false as const, data: [] as EntryRouteGenre[] })),
        fetchApi<{ success: boolean; data: RefSummaryData }>(`/api/analytics/ref-summary${summaryQuery}`)
          .catch(() => ({ success: false, data: null })),
        api.trackedLinks.list().catch(() => ({ success: false, data: null })),
      ])
      if (!isCurrent()) return
      if (r.success) {
        setRoutes(r.data)
        // 消えた経路を「まとめて操作」の対象に残さない。
        const alive = new Set(r.data.map((route) => route.id))
        setSelectedRouteIds((current) => {
          const next = new Set([...current].filter((id) => alive.has(id)))
          return next.size === current.size ? current : next
        })
      } else {
        setLoadFailed(true)
      }
      if (genreRes.success) setGenres(genreRes.data)
      if ('success' in sum && sum.success && isRefSummaryData(sum.data)) {
        setSummary(sum.data)
        setSummaryAvailable(true)
      } else {
        setSummary(null)
        setSummaryAvailable(false)
      }
      if (tl.success && tl.data) {
        setTrackedLinks(tl.data.map((row) => ({
          id: row.id,
          name: row.name,
          scenarioId: row.scenarioId,
          isActive: row.isActive,
        })))
      }
    } catch (e) {
      if (!isCurrent()) return
      // 空（1件も無い）と言い分けるため、失敗として覚える。403・429 は ListState が言い分ける。
      setLoadFailed(true)
      setLoadError(e)
      setSummary(null)
      setSummaryAvailable(false)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // アカウントを変えた瞬間に前の一覧・集計・開いた操作を捨てる。
    setRoutes([])
    setGenres([])
    setPools([])
    setScenarios([])
    setTemplates([])
    setTrackedLinks([])
    setTags([])
    setSummary(null)
    setSummaryAvailable(false)
    setPoolMembers({})
    setPoolMemberNames({})
    setEditing(null)
    setQrRoute(null)
    setSelectedRouteIds(new Set())
    setBulkAction(null)
    setOpenMenuRefCode(null)
    setPresetOpen(false)
    setAdConnected(null)
    setPage(1)
    void load()
    return () => {
      loadRequestRef.current += 1
    }
  }, [selectedAccountId, load])

  // 広告とつないだ数だけを軽く取る。失敗しても帯の4枚目が「—」になるだけ。
  useEffect(() => {
    let cancelled = false
    setAdConnected(null)
    void (async () => {
      try {
        const res = await api.adPlatforms.list(selectedAccountId)
        if (cancelled || !res.success) return
        const connected = res.data.filter((platform) => platform.isActive)
        setAdConnected({
          total: connected.length,
          names: connected.map((platform) => platform.displayName ?? platform.name),
        })
      } catch {
        if (!cancelled) setAdConnected(null)
      }
    })()
    return () => { cancelled = true }
  }, [selectedAccountId])

  /*
   * PERF-03: 編集窓の候補（プール・シナリオ・テンプレート・タグ）。一覧の行を待たせない補助取得。
   * 機能を切っている系統は呼ばず、補助の失敗は一覧を巻き込まない。
   */
  useEffect(() => {
    if (selectedAccountId && visibility.status === 'loading') return
    const accountAtRequest = selectedAccountId
    const generation = loadRequestRef.current
    const featureAllowed = (key: FeatureKey) =>
      visibility.features == null || visibility.features[key] === true
    let cancelled = false
    const isCurrent = () =>
      !cancelled && generation === loadRequestRef.current && accountAtRequest === latestAccountRef.current
    const loadAuxiliary = async () => {
      // プールは multi_store_hierarchy が有効と分かるときだけ呼ぶ（403 を出さない、#703）。
      const poolsDisabled = { success: false as const, error: 'feature_disabled' }
      const fetchPools = () => api.pools.list({ suppressFeatureDisabledEvent: true })
        .catch((): ApiResponse<TrafficPool[]> => poolsDisabled)
      const poolsPromise: Promise<ApiResponse<TrafficPool[]>> = visibility.features != null
        ? (visibility.features['multi_store_hierarchy'] === true ? fetchPools() : Promise.resolve(poolsDisabled))
        : isPoolsFeatureAvailable(selectedAccountId ? [selectedAccountId] : null)
          .then((ok) => (ok ? fetchPools() : poolsDisabled))
      // R23横展開: 行の名前解決に使う候補は今のアカウントだけ。
      const candidateParams = accountAtRequest ? { accountId: accountAtRequest } : undefined
      const [p, s, t, tagRes] = await Promise.all([
        poolsPromise,
        featureAllowed('scenarios')
          ? api.scenarios.list(candidateParams).catch(() => ({ success: false as const, data: [] as Scenario[] }))
          : Promise.resolve({ success: false as const, data: [] as Scenario[] }),
        featureAllowed('templates')
          ? api.messageTemplates.list().catch(() => ({ success: false as const, data: [] as MessageTemplate[] }))
          : Promise.resolve({ success: false as const, data: [] as MessageTemplate[] }),
        api.tags.list(candidateParams).catch(() => ({ success: false, data: [] as Tag[] })),
      ])
      if (!isCurrent()) return
      // 形の違う返事（古い Worker など）で行の描画ごと落ちないよう、配列のときだけ受け取る。
      if (p.success && Array.isArray(p.data)) setPools(p.data)
      if (s.success && Array.isArray(s.data)) setScenarios(s.data)
      if (t.success && Array.isArray(t.data)) setTemplates(t.data)
      if (tagRes.success && Array.isArray(tagRes.data)) setTags(tagRes.data)
      if (p.success && Array.isArray(p.data)) {
        // プール→所属アカウントは1回でまとめて取る。
        const batch = p.data.length > 0
          ? await api.pools.listAccounts(p.data.map((pool) => pool.id), { suppressFeatureDisabledEvent: true })
          : { success: true as const, data: [] }
        if (!isCurrent()) return
        if (batch.success) {
          setPoolMembers(Object.fromEntries(batch.data.map(({ poolId, accounts }) => [
            poolId,
            new Set(accounts.filter((account) => account.isActive).map((account) => account.lineAccountId)),
          ])))
          setPoolMemberNames(Object.fromEntries(batch.data.map(({ poolId, accounts }) => [
            poolId,
            accounts.filter((account) => account.isActive).map((account) => account.accountName ?? '—'),
          ])))
        }
      }
    }
    void loadAuxiliary()
    return () => { cancelled = true }
  }, [selectedAccountId, visibility.status, visibility.features])

  const onCopy = async (refCode: string) => {
    try {
      await navigator.clipboard.writeText(referralUrl(refCode))
      setCopiedId(refCode)
      setCopyFailedId(null)
      setTimeout(() => setCopiedId(null), 1200)
    } catch {
      // 失敗に気づかず URL 未コピーのまま配布作業が進むのを防ぐ。
      setCopyFailedId(refCode)
      setTimeout(() => setCopyFailedId(null), 3000)
    }
  }

  // 行の受付・停止を切り替える（行の「…」から）。終わったら取り直す。
  const toggleRouteActive = async (entryRouteId: string, nextActive: boolean, name: string) => {
    setOpenMenuRefCode(null)
    try {
      const res = await api.entryRoutes.update(entryRouteId, { isActive: nextActive })
      if (res.success) {
        notifyToast(nextActive ? `「${name}」の受付を再開しました` : `「${name}」の受付を停止しました`)
        void load()
      } else {
        notifyToast(res.error || '更新できませんでした')
      }
    } catch (cause) {
      notifyToast(cause instanceof ApiError && cause.status === 403 ? 'この操作を行う権限がありません' : '通信できませんでした')
    }
  }

  /* ===== 行づくり（今の一覧と同じ判断） ===== */
  const allRows = useMemo(() => buildRows(routes, trackedLinks, summary), [routes, trackedLinks, summary])
  const mainPool = pools.find((p) => p.slug === 'main')
  const poolRoutesToAccount = (poolId: string | null, accountId: string): boolean => {
    const targetPoolId = poolId ?? mainPool?.id
    if (!targetPoolId) return false
    return poolMembers[targetPoolId]?.has(accountId) ?? false
  }
  const accountRows = allRows.filter((row) => shouldShowRow({
    source: row.source,
    poolId: row.poolId,
    friendCount: row.stats?.friendCount ?? 0,
  }, selectedAccountId, poolRoutesToAccount))

  const availableGenres = useMemo(() => {
    const routeGenreNames = routes.map((route) => route.genre).filter((genre): genre is string => !!genre)
    return [
      ...genres,
      ...Array.from(new Set(routeGenreNames))
        .filter((name) => !genres.some((genre) => genre.name === name))
        .map((name) => ({ id: `legacy-${name}`, name, createdAt: '', updatedAt: '' })),
    ]
  }, [genres, routes])
  const hasUncategorized = accountRows.some((row) => !row.genre)
  useEffect(() => {
    const selectable = ['', ...availableGenres.map((genre) => genre.name), ...(hasUncategorized ? [UNCATEGORIZED] : [])]
    setSelectedGenre((current) => (selectable.includes(current) ? current : ''))
  }, [availableGenres, hasUncategorized])

  const selectedGenreLabel = selectedGenre === UNCATEGORIZED ? '未分類' : selectedGenre || 'すべて'
  const genreRows = selectedGenre === ''
    ? accountRows
    : selectedGenre === UNCATEGORIZED
      ? accountRows.filter((row) => !row.genre)
      : accountRows.filter((row) => row.genre === selectedGenre)
  const normalizedSearch = search.trim().toLocaleLowerCase('ja')
  const searchedRows = normalizedSearch
    ? genreRows.filter((row) =>
        row.name.toLocaleLowerCase('ja').includes(normalizedSearch)
        || row.refCode.toLocaleLowerCase('ja').includes(normalizedSearch))
    : genreRows
  const sortedRows = sortRows(searchedRows.filter((row) => matchesFilter(row, filter)), sort)
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const currentRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  // まとめて操作の対象は、絞り込んだ行のうち登録済み（entry_routes）だけ。
  const selectableIds = sortedRows.flatMap((row) => (row.entryRouteId ? [row.entryRouteId] : []))
  const allShownSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedRouteIds.has(id))
  const selectedRoutes = routes.filter((route) => selectedRouteIds.has(route.id))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  /* ===== 帯の数（フォルダ・検索・絞り込みの前で数える） ===== */
  const routeCountAvailable = !loading && !loadFailed
  const accountRouteCount = summary?.routeTotal ?? accountRows.length
  const unconfiguredCount = accountRows.filter(isUnconfigured).length
  const hasFriendsCount = accountRows.filter((row) => (row.stats?.friendCount ?? 0) > 0).length
  const genreNames = availableGenres.map((genre) => genre.name)
  const tileGenreSub = genreNames.length === 0
    ? 'フォルダはまだありません'
    : genreNames.slice(0, 3).join('・') + (genreNames.length > 3 ? 'など' : '')
  const adNamesSub = adConnected === null
    ? '読み込めませんでした'
    : adConnected.names.length === 0
      ? 'まだ接続がありません'
      : adConnected.names.slice(0, 2).join('・') + (adConnected.names.length > 2 ? 'など' : '')
  const loadFailure = loadError ? loadFailureCopy(loadError, '流入経路') : null

  // #980: 入口へ「この一覧に見えている経路の数」を渡す（読み込み前・失敗は null）。
  useEffect(() => {
    onRouteCountChange?.(routeCountAvailable ? accountRows.length : null)
  }, [onRouteCountChange, routeCountAvailable, accountRows.length])

  /* ===== 行の「…」 ===== */
  const qrFor = (row: RouteRow): QrRoute => ({
    refCode: row.refCode,
    name: row.name,
    genre: row.genre,
    isActive: row.isActive,
    id: row.entryRouteId ?? undefined,
  })
  const rowMenuItems = (row: RouteRow): ActionMenuItem[] => {
    const items: ActionMenuItem[] = []
    if (row.isActive !== false) {
      items.push({ id: 'qr', label: 'QRコードを見る', onSelect: () => { setOpenMenuRefCode(null); setQrRoute(qrFor(row)) } })
      items.push({ id: 'copy', label: 'URLをコピー', onSelect: () => { setOpenMenuRefCode(null); void onCopy(row.refCode) } })
    }
    if (row.entryRouteId) {
      const target = routes.find((entry) => entry.id === row.entryRouteId) ?? null
      if (target) {
        items.push({
          id: 'edit',
          label: 'リンクを編集',
          disabled: readonly,
          disabledReason: readonly ? READONLY_REASON : undefined,
          onSelect: () => { setOpenMenuRefCode(null); setEditing(target) },
        })
      }
      items.push(row.isActive === false
        ? {
          id: 'resume',
          label: '受付を再開する',
          disabled: readonly,
          disabledReason: readonly ? READONLY_REASON : undefined,
          onSelect: () => void toggleRouteActive(row.entryRouteId!, true, row.name),
        }
        : {
          id: 'stop',
          label: '受付を止める',
          tone: 'danger' as const,
          disabled: readonly,
          disabledReason: readonly ? READONLY_REASON : undefined,
          onSelect: () => void toggleRouteActive(row.entryRouteId!, false, row.name),
        })
    }
    return items
  }

  /* ===== フォルダ ===== */
  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: accountRows.length, icon: <Inbox size={15} aria-hidden="true" /> },
    ...availableGenres.map((genre) => ({
      id: genre.name,
      label: genre.name,
      count: accountRows.filter((row) => row.genre === genre.name).length,
      // 名前の変更は選んだフォルダの「…」から（選んでいない行に「…」の箱を出すと件数が左へずれる）。
      ...(!readonly && !genre.id.startsWith('legacy-') && selectedGenre === genre.name
        ? { onEdit: () => setEditingGenre(genre) }
        : {}),
    })),
    ...(hasUncategorized
      ? [{ id: UNCATEGORIZED, label: '未分類', count: accountRows.filter((row) => !row.genre).length }]
      : []),
  ]
  const selectGenre = (id: string) => { setSelectedGenre(id); setPage(1) }
  const folderSelect = (
    <Select
      aria-label="フォルダ"
      value={selectedGenre}
      onChange={selectGenre}
      options={[
        { value: '', label: 'フォルダ：すべて' },
        ...availableGenres.map((genre) => ({ value: genre.name, label: `フォルダ：${genre.name}` })),
        ...(hasUncategorized ? [{ value: UNCATEGORIZED, label: 'フォルダ：未分類' }] : []),
      ]}
    />
  )
  const createButton = readonly
    ? <Button variant="primary" disabled title={READONLY_REASON}><Plus size={15} aria-hidden="true" />流入リンクを作る</Button>
    : <Button variant="primary" href="/inflow-links/new"><Plus size={15} aria-hidden="true" />流入リンクを作る</Button>

  /* ===== 道具の段 ===== */
  const toggleFilter = (next: RouteFilter) => {
    setFilter((current) => (current === next ? 'all' : next))
    setPage(1)
  }
  const filterChips = (
    <div role="group" aria-label="流入経路の絞り込み" className={styles.chips}>
      <FilterChip
        selected={filter === 'has-friends'}
        onChange={() => toggleFilter('has-friends')}
        icon={<UserPlus size={13} aria-hidden="true" />}
        title={routeCountAvailable ? `友だち追加あり ${formatNumber(hasFriendsCount)}件` : undefined}
      >
        友だち追加あり
      </FilterChip>
      <FilterChip
        selected={filter === 'unconfigured'}
        onChange={() => toggleFilter('unconfigured')}
        icon={<CircleAlert size={13} aria-hidden="true" />}
      >
        {routeCountAvailable ? `動きが未設定 ${formatNumber(unconfiguredCount)}` : '動きが未設定'}
      </FilterChip>
    </div>
  )
  const presetCounts: Array<[RouteFilter, string, number]> = [
    ['all', 'すべて', genreRows.length],
    ['has-friends', '友だち追加あり', genreRows.filter((row) => matchesFilter(row, 'has-friends')).length],
    ['no-friends', '友だち追加なし', genreRows.filter((row) => matchesFilter(row, 'no-friends')).length],
    ['unconfigured', '動きが未設定', genreRows.filter(isUnconfigured).length],
  ]
  const presetBox = (
    <div className={styles.presetWrap}>
      <Button variant="secondary" onClick={() => setPresetOpen((current) => !current)} aria-expanded={presetOpen}>
        <Bookmark size={15} aria-hidden="true" />よく使う絞り込み
      </Button>
      {presetOpen ? (
        <div className={styles.presetPanel} role="dialog" aria-label="よく使う絞り込みと並び順">
          <span className={styles.presetLabel}>絞り込み</span>
          <div className={styles.presetChips}>
            {presetCounts.map(([value, label, total]) => (
              <FilterChip
                key={value}
                selected={filter === value}
                onChange={() => { setFilter(value); setPage(1); setPresetOpen(false) }}
                count={total}
              >
                {label}
              </FilterChip>
            ))}
          </div>
          <span className={styles.presetLabel}>並び順</span>
          <Select
            aria-label="並び順"
            value={sort}
            options={SORT_OPTIONS}
            onChange={(value) => { setSort(value as RouteSort); setPage(1); setPresetOpen(false) }}
          />
        </div>
      ) : null}
    </div>
  )
  const perPageBox = (
    <PageSizeSelect
      value={pageSize}
      options={[10, 20, 50]}
      label={null}
      aria-label="表示件数"
      onChange={(value) => { setPageSize(value); setPage(1) }}
    />
  )
  const notice = routeCountAvailable && unconfiguredCount > 0 ? (
    <div className={styles.noticeRow}>
      <Notice tone="info">
        {`友だちになっても何も起きない経路が ${formatNumber(unconfiguredCount)} 件あります。「動きが未設定」で絞って、タグやメッセージを決めてください。`}
      </Notice>
    </div>
  ) : null
  const searchLabel = '経路の名前・URLで探す'
  const onSearch = (value: string) => { setSearch(value); setPage(1) }
  // 1152 の板（y1ztx）：案内の帯 → 1段目「作る・フォルダ・探す」→ 2段目「札 … よく使う絞り込み・件数」。
  const narrowToolbar = (
    <div className={styles.narrowTools}>
      {notice}
      <div className={styles.narrowRow}>
        {createButton}
        <div className={styles.narrowFolder}>{folderSelect}</div>
        <div className={styles.narrowSearch}>
          <SearchField value={search} onChange={onSearch} onClear={() => onSearch('')} placeholder={searchLabel} aria-label={searchLabel} />
        </div>
      </div>
      <div className={styles.narrowRow}>
        {filterChips}
        <span className={styles.spacer} aria-hidden="true" />
        {presetBox}
        {perPageBox}
      </div>
    </div>
  )
  const wideToolbar = (
    <>
      {notice}
      <ListToolbar
        search={{ placeholder: searchLabel, label: searchLabel, width: 240, value: search, onChange: onSearch }}
        filters={filterChips}
        trailing={<>{presetBox}{perPageBox}</>}
      />
    </>
  )

  /* ===== 表 ===== */
  let listBody: ReactNode
  if (loading) {
    listBody = <ListState kind="loading" title="流入経路を読み込んでいます" />
  } else if (loadFailed) {
    listBody = (
      <ListState
        kind="error"
        /* URzvC：分からない失敗のときだけ「流入リンクを読み込めませんでした」と言う（権限・混雑は言い分けたまま）。 */
        title={loadFailure && loadFailure.title !== '表示できませんでした' ? loadFailure.title : '流入リンクを読み込めませんでした'}
        description={loadFailure?.description}
        error={loadError ?? undefined}
        onRetry={loadFailure === null || loadFailure.retryable ? () => void load() : undefined}
      />
    )
  } else if (sortedRows.length === 0) {
    // 絞り込み・検索で0件のときは「まだ無い」と言わない（R173）。修正案 D-2：空の一覧。
    listBody = (
      <EmptyList
        icon={<Link2 aria-hidden="true" />}
        title={selectedGenre && accountRows.length === 0 ? `「${selectedGenreLabel}」にはまだ流入リンクがありません` : 'まだ流入リンクがありません'}
        description="QR コードや URL ごとに、どこから友だちになったかを数えます。"
        create={{ label: '最初の流入リンクを作る', href: '/inflow-links/new' }}
        canCreate={!readonly}
        filtered={accountRows.length > 0 && (normalizedSearch !== '' || filter !== 'all' || selectedGenre !== '')}
        onClearFilters={() => { setSearch(''); setFilter('all'); setSelectedGenre(''); setPage(1) }}
      />
    )
  } else {
    listBody = (
      <>
        <div className={styles.tableWrap}>
          <DataTable className={styles.table}>
            <thead>
              <TableHeadRow className={styles.headRow} data-table-layout="columns">
                <Th className={styles.colCheck}>
                  <Checkbox
                    aria-label="表示中の登録済み経路をすべて選ぶ"
                    checked={allShownSelected}
                    indeterminate={!allShownSelected && selectableIds.some((id) => selectedRouteIds.has(id))}
                    disabled={readonly || selectableIds.length === 0}
                    title={readonly ? READONLY_REASON : selectableIds.length === 0 ? 'まとめて操作できる登録済みの経路がありません' : undefined}
                    onCheckedChange={(checked) => setSelectedRouteIds(checked ? new Set(selectableIds) : new Set())}
                  />
                </Th>
                <Th className={styles.colName}>流入元名</Th>
                <Th className={styles.colPool}>追加先</Th>
                <Th className={styles.colBecame}>友だちになったら</Th>
                <Th className={styles.colFriends}>友だち追加</Th>
                <Th className={styles.colClicks}>クリック</Th>
                <Th className={styles.colLatest}>最新追加</Th>
                <Th className={styles.colUrl}>発行URL</Th>
                <Th className={styles.colOps}>操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {currentRows.map((r) => {
                const pool = pools.find((p) => p.id === r.poolId)
                const sc = scenarios.find((s) => s.id === r.scenarioId)
                const tag = tags.find((t) => t.id === r.tagId)
                const editTarget = r.source === 'entry_route' ? routes.find((e) => e.id === r.entryRouteId) ?? null : null
                const status = routeStatus(r)
                const [becameFirst, becameSecond] = becameLines(r, sc, tag)
                const menuItems = rowMenuItems(r)
                const menuLabel = `「${r.name}」の操作`
                const nameNode = r.source === 'entry_route' && r.entryRouteId ? (
                  <Link href={`/inflow-links/detail?id=${r.entryRouteId}`} className={styles.nameLink} title={r.name}>
                    {r.name}
                  </Link>
                ) : (
                  <span className={styles.nameText} title={r.name}>{r.name}</span>
                )
                return (
                  <Tr key={r.refCode} interactive className={styles.row} data-table-layout="columns" data-row-id={r.refCode}>
                    <Td className={styles.colCheck}>
                      {r.entryRouteId ? (
                        <Checkbox
                          aria-label={`${r.name}をまとめて操作の対象にする`}
                          checked={selectedRouteIds.has(r.entryRouteId)}
                          disabled={readonly}
                          title={readonly ? READONLY_REASON : undefined}
                          onCheckedChange={(checked) => {
                            const id = r.entryRouteId!
                            setSelectedRouteIds((current) => {
                              const next = new Set(current)
                              if (checked) next.add(id)
                              else next.delete(id)
                              return next
                            })
                          }}
                        />
                      ) : (
                        <span className="sr-only">まとめて操作は登録済みの流入経路だけに使えます</span>
                      )}
                    </Td>
                    <Td className={styles.colName}>
                      {/* 名前の前にフォルダの色の丸（2026-10-07 オーナー決定・絵 xbHxg「フォルダの丸」）。
                          流入のフォルダには色の値が無いので、丸は薄い灰（未分類は輪）。1152（y1ztx）はフォルダの列が無いので出さない。 */}
                      {narrow ? nameNode : (
                        <div className={styles.nameLine}>
                          <FolderDotName folder={r.genre ? { name: r.genre } : null}>{nameNode}</FolderDotName>
                        </div>
                      )}
                      <span className={narrow ? styles.refCode : `${styles.refCode} ${styles.dotIndentPad}`} title={r.refCode}>{r.refCode}</span>
                      {status ? (
                        <span
                          className={narrow ? styles.pill : `${styles.pill} ${styles.dotIndentMargin}`}
                          data-tone={status}
                          title={status === 'measured'
                            ? (r.source === 'tracked_link'
                              ? 'クリック計測とシナリオ起動が設定されています。追加先の振り分けは全体設定に従います。'
                              : '流入の計測ができています。')
                            : status === 'unregistered'
                              ? '外部で発行されたREFです。流入実績だけを集計しています。'
                              : '受付を止めています。このURLを開いても友だち追加できません。'}
                        >
                          <span className={styles.pillDot} aria-hidden="true" />
                          {status === 'measured' ? '計測済' : status === 'unregistered' ? '未登録' : '停止中'}
                        </span>
                      ) : null}
                    </Td>
                    <Td className={styles.colPool}>
                      {pool ? (
                        <span className={styles.cellMain} title={pool.name}>{pool.name}</span>
                      ) : r.source === 'tracked_link' ? (
                        <span className={styles.cellMain} title="追加先の振り分けは全体設定に従います。">—</span>
                      ) : (
                        <span className={styles.cellMain} title="追加先が設定されていません。">未設定</span>
                      )}
                    </Td>
                    <Td className={styles.colBecame}>
                      <span className={styles.cellMain} title={becameFirst}>{becameFirst}</span>
                      <span className={styles.cellSub} title={becameSecond}>{becameSecond}</span>
                    </Td>
                    <Td className={styles.colFriends}>
                      {summaryAvailable && r.stats ? (
                        <>
                          <span className={styles.cellMain}>{`${formatNumber(r.stats.friendCount)}人`}</span>
                          <span className={styles.cellSub}>{`累計 ${formatNumber(r.stats.friendCount)}人`}</span>
                        </>
                      ) : (
                        <span className={styles.cellMain}>—</span>
                      )}
                    </Td>
                    <Td className={styles.colClicks}>
                      <span className={styles.cellMain}>{summaryAvailable && r.stats ? formatNumber(r.stats.clickCount) : '—'}</span>
                    </Td>
                    <Td className={styles.colLatest}>
                      <span className={styles.cellMain}>{summaryAvailable ? formatLatest(r.stats?.latestAt) : '—'}</span>
                    </Td>
                    <Td className={styles.colUrl}>
                      <div className={styles.opsBox}>
                        {r.isActive === false ? (
                          // 停止中の経路の URL と QR は出さない（開いても友だち追加できない URL を配らない）。
                          <Button disabled title="停止中のためURLとQRコードは表示できません">停止中</Button>
                        ) : (
                          <Button onClick={() => void onCopy(r.refCode)} aria-label={`${r.name}のURLをコピー`}>
                            {copyFailedId === r.refCode ? 'コピー失敗' : copiedId === r.refCode ? '済み' : 'コピー'}
                          </Button>
                        )}
                        {menuItems.length > 0 ? (
                          <>
                            <IconButton
                              title={menuLabel}
                              aria-label={menuLabel}
                              aria-haspopup="menu"
                              aria-expanded={openMenuRefCode === r.refCode}
                              onClick={() => setOpenMenuRefCode((current) => (current === r.refCode ? null : r.refCode))}
                            >
                              <MoreHorizontal size={16} aria-hidden="true" />
                            </IconButton>
                            <ActionMenu
                              open={openMenuRefCode === r.refCode}
                              onClose={() => setOpenMenuRefCode(null)}
                              ariaLabel={menuLabel}
                              note={readonly ? READONLY_REASON : undefined}
                              items={menuItems}
                            />
                          </>
                        ) : null}
                      </div>
                    </Td>
                    <Td className={styles.colOps}>
                      <div className={styles.opsBox}>
                        {editTarget ? (
                          <Button
                            disabled={readonly}
                            title={readonly ? READONLY_REASON : undefined}
                            onClick={() => setEditing(editTarget)}
                            aria-label={`${r.name}のリンクを編集`}
                          >
                            編集
                          </Button>
                        ) : r.source === 'tracked_link' ? (
                          // tracked_links は別管理（画面に編集の口が無い）。昇格登録は上書きになるので出さない。
                          <span className={styles.cellMain} title="この経路は別の仕組み（クリック計測）で管理しています">—</span>
                        ) : (
                          <Button
                            disabled={readonly}
                            onClick={() => setEditing({ register: r.refCode })}
                            title={readonly ? READONLY_REASON : '未登録 ref を登録します。流入実績はそのまま引き継がれます。'}
                          >
                            登録する
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        </div>
        <p className={styles.footNote}>
          {readonly
            ? '行の「…」から QRコードを表示・URLをコピーできます。'
            : '行の「…」から QRコードを表示・URLをコピー・リンクを編集・止める。左のチェックで、まとめて操作できます。'}
        </p>
        <BulkBar count={selectedRouteIds.size} hint="まとめて操作できるのは登録済みの経路だけです">
          <Button onClick={() => setBulkAction('pause')}>まとめて止める</Button>
          <Button onClick={() => setBulkAction('resume')}>まとめて再開する</Button>
          <Button onClick={() => setBulkAction('move')}>フォルダへ移す</Button>
        </BulkBar>
      </>
    )
  }

  const pager = !loading && !loadFailed && pageCount > 1 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>
        {(currentPage - 1) * pageSize + 1}〜{(currentPage - 1) * pageSize + currentRows.length} / {formatNumber(sortedRows.length)}件
      </span>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} ariaLabel="流入経路のページ送り" />
    </ListPagePagination>
  ) : null

  return (
    <ListPage
      boardId="xbHxg"
      headingSize="regular"
      title="流入と計測"
      description="QRコード・URLごとに、どこから友だちになったかを数えます。友だちになったときに、タグ・メッセージ・シナリオを自動で動かせます。"
      actions={<div className={styles.headActions}>
        <Button href="/inflow-links?tab=connections"><Megaphone size={15} aria-hidden="true" />広告とのつなぎ</Button>
        {/* #859: site_tracking が切れているときは口を出さない。直 URL はホスト側の停止画面が出す。 */}
        {visibility.enabled('site_tracking') ? (
          <Button href="/inflow-links?tab=script"><Code size={15} aria-hidden="true" />サイトスクリプト</Button>
        ) : null}
      </div>}
      stats={<>
        {readonly ? (
          <div className={styles.viewerBand} role="status">
            <Eye size={16} aria-hidden="true" />
            <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
          </div>
        ) : null}
        <KpiBand>
          <KpiCard
            presentation="band"
            title="経路"
            icon={<Link2 size={13} aria-hidden="true" />}
            value={routeCountAvailable ? accountRouteCount : null}
            unit={routeCountAvailable ? '件' : ''}
            loading={loading}
            detail={routeCountAvailable ? tileGenreSub : loading ? '読み込んでいます' : '読み込めませんでした'}
          />
          <KpiCard
            presentation="band"
            title="友だち追加"
            icon={<Users size={13} aria-hidden="true" />}
            help="集計は累計です（月ごとの内訳は出せません）。経路が分かる人は、流入リンクから友だちになった人です。"
            value={summaryAvailable && summary ? summary.totalFriends : null}
            unit={summaryAvailable && summary ? '人' : ''}
            loading={loading}
            detail={summaryAvailable && summary
              ? `累計。経路が分かる人 ${formatNumber(summary.friendsWithRef)}人`
              : loading ? '読み込んでいます' : '読み込めませんでした'}
          />
          <KpiCard
            presentation="band"
            title="動きが未設定"
            icon={<CircleAlert size={13} aria-hidden="true" />}
            value={routeCountAvailable ? unconfiguredCount : null}
            unit={routeCountAvailable ? '件' : ''}
            loading={loading}
            detail="友だちになっても何も起きない"
            menu={<TileMenu
              id="unconfigured"
              title="動きが未設定"
              openId={openTileMenu}
              onOpenChange={setOpenTileMenu}
              items={[{
                id: 'filter',
                label: '動きが未設定の経路だけに絞る',
                disabled: !routeCountAvailable || unconfiguredCount === 0,
                disabledReason: !routeCountAvailable || unconfiguredCount === 0 ? '動きが未設定の経路はありません' : undefined,
                onSelect: () => { setFilter('unconfigured'); setPage(1) },
              }]}
            />}
          />
          <KpiCard
            presentation="band"
            title="広告とつないだ"
            icon={<Megaphone size={13} aria-hidden="true" />}
            value={adConnected ? adConnected.total : null}
            unit={adConnected ? '件' : ''}
            detail={adNamesSub}
            menu={<TileMenu
              id="ads"
              title="広告とつないだ"
              openId={openTileMenu}
              onOpenChange={setOpenTileMenu}
              items={[
                { id: 'ads', label: '広告連携を開く', external: true, onSelect: () => router.push('/inflow-links?tab=ads') },
                { id: 'connections', label: '広告とのつなぎを開く', external: true, onSelect: () => router.push('/inflow-links?tab=connections') },
              ]}
            />}
          />
        </KpiBand>
      </>}
      folders={<>
        {createButton}
        <FolderPanel
          activeId={selectedGenre}
          onSelect={selectGenre}
          onAddFolder={readonly ? undefined : () => setEditingGenre('new')}
          addFolderLabel="フォルダを追加"
          addFolderDisabled={readonly}
          addFolderTitle={readonly ? READONLY_REASON : undefined}
          rows={folderRows}
        >
          <p className={styles.folderNote}>フォルダを消しても、中の経路は未分類に残ります</p>
        </FolderPanel>
      </>}
      collapsedFolders={narrow ? undefined : <>{createButton}{folderSelect}</>}
      toolbar={narrow ? narrowToolbar : wideToolbar}
      pagination={pager}
      overlays={<>
        {editing ? (
          <EditRouteDialog
            route={editing === 'new' || (typeof editing === 'object' && 'register' in editing) ? null : editing}
            initialRefCode={typeof editing === 'object' && editing !== null && 'register' in editing ? editing.register : undefined}
            initialGenre={editing === 'new' && selectedGenre !== UNCATEGORIZED ? selectedGenre : undefined}
            pools={pools}
            scenarios={scenarios}
            templates={templates}
            tags={tags}
            existingGenres={genreNames}
            poolMemberNames={poolMemberNames}
            accountId={selectedAccountId}
            onClose={() => setEditing(null)}
            onSaved={(savedRoute, created) => {
              setEditing(null)
              void load()
              if (created) setQrRoute({ refCode: savedRoute.refCode, name: savedRoute.name, genre: savedRoute.genre, isActive: savedRoute.isActive, id: savedRoute.id })
            }}
          />
        ) : null}
        {editingGenre ? (
          <GenreDialog
            genre={editingGenre === 'new' ? null : editingGenre}
            onClose={() => setEditingGenre(null)}
            onSaved={(savedGenre, previousName) => {
              setGenres((current) => previousName
                ? current.map((genre) => (genre.id === savedGenre.id ? savedGenre : genre))
                : [...current, savedGenre])
              if (previousName) {
                setRoutes((current) => current.map((route) => (route.genre === previousName ? { ...route, genre: savedGenre.name } : route)))
              }
              setSelectedGenre(savedGenre.name)
              setEditingGenre(null)
            }}
          />
        ) : null}
        {qrRoute ? <QrDialog route={qrRoute} onClose={() => setQrRoute(null)} /> : null}
        {bulkAction ? (
          <BulkDialog
            targets={selectedRoutes}
            genreOptions={genreNames}
            initialAction={bulkAction}
            onApplied={(remainingIds) => {
              // 反映できなかった分だけを選んだ状態に戻す。
              setSelectedRouteIds(new Set(remainingIds))
              void load()
            }}
            onClose={() => setBulkAction(null)}
          />
        ) : null}
      </>}
    >
      {listBody}
    </ListPage>
  )
}

/** 数の帯のマスの右上の「…」（絵のマスの「…」）。押すとそのマスから行ける操作を出す。 */
function TileMenu({
  id,
  title,
  items,
  openId,
  onOpenChange,
}: {
  id: string
  title: string
  items: ActionMenuItem[]
  openId: string | null
  onOpenChange: (id: string | null) => void
}) {
  const open = openId === id
  const label = `「${title}」のほかの操作`
  return (
    <span className={styles.tileMenu}>
      <button
        type="button"
        className={styles.tileMenuButton}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(open ? null : id)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      <ActionMenu
        open={open}
        onClose={() => onOpenChange(null)}
        ariaLabel={label}
        items={items.map((item) => ({ ...item, onSelect: () => { onOpenChange(null); item.onSelect() } }))}
      />
    </span>
  )
}
