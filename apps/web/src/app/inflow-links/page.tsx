'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ApiError, api, fetchApi } from '@/lib/api'
import KpiCard from '@/components/shared/kpi-card'
import { useAccount } from '@/contexts/account-context'
import type { ApiResponse, EntryRoute, EntryRouteGenre, TrafficPool, Scenario, Tag } from '@line-crm/shared'
import EditRouteModal from './_components/edit-route-modal'
import GenreModal from './_components/create-genre-modal'
import { shouldShowReferralRow } from './visibility'
import { exportFileName, jstTodayString, toCsv } from './inflow-export'
import { Suspense } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import { FeatureDisabledScreen } from '@/components/feature-disabled-gate'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'
import type { FeatureKey } from '@/lib/feature-settings'
import AdIntegration from './ad-integration'
import RefOrdersPanel from './_components/ref-orders'
import SiteScript from '@/components/inflow-links/site-script'
import { TableHeadRow, Th } from '@/components/shared/table'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import Disclosure from '@/components/shared/disclosure'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'

interface MessageTemplate {
  id: string
  name: string
  messageType: string
  messageContent: string
}

interface TrackedLinkRow {
  id: string
  name: string
  scenarioId: string | null
  isActive: boolean
}

interface RefRouteStats {
  refCode: string
  /** entry_routes に登録された name。未登録なら null。 */
  name: string | null
  friendCount: number
  clickCount: number
  latestAt: string | null
  /*
   * IDEA-18: 経路別の購入・返金・取消。first-touch でこの経路に帰属する
   * 友だちが起こした注文だけを数える。古い Worker は返さないので任意項目。
   */
  orderCount?: number
  refundedOrderCount?: number
  cancelledOrderCount?: number
}

interface RefSummaryData {
  routes: RefRouteStats[]
  totalFriends: number
  friendsWithRef: number
  friendsWithoutRef: number
  routeTotal?: number
  totalClicks?: number
  averageAddRate?: number
  /*
   * IDEA-18: 注文の計測範囲。total=このアカウントのECに届いた注文、
   * linked=LINEの友だちに結びついた注文、attributed=そのうち経路が分かる注文。
   * 未計測（経路不明・未連携）を0件の成果と混ぜないために使う。
   */
  orders?: {
    total: number
    linked: number
    attributed: number
    refunded: number
    cancelled: number
  }
}

function isRefSummaryData(value: unknown): value is RefSummaryData {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RefSummaryData>
  return Array.isArray(candidate.routes)
    && Number.isFinite(candidate.totalFriends)
    && Number.isFinite(candidate.friendsWithRef)
    && Number.isFinite(candidate.friendsWithoutRef)
}

interface RefFriend {
  id: string
  displayName: string
  trackedAt: string | null
}

interface RefDetail {
  refCode: string
  name: string
  friends: RefFriend[]
}

const WORKER_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''
const UNCATEGORIZED = '__uncategorized__'
const referralUrl = (refCode: string) => `${WORKER_BASE.replace(/\/$/, '')}/r/${encodeURIComponent(refCode)}`

/**
 * 並び順。**読み込んだ行から数えられるものだけ**にしてある。
 * 実流入は `/api/analytics/ref-summary` の累計で返るので、
 * 友だち追加・クリック・最新追加日は並べ替えられる。
 */
type RouteSort = 'friends-desc' | 'clicks-desc' | 'latest-desc' | 'name'
type RouteFilter = 'all' | 'has-friends' | 'no-friends' | 'unconfigured'

const SORT_OPTIONS: Array<{ value: RouteSort; label: string }> = [
  { value: 'friends-desc', label: '友だち追加が多い順' },
  { value: 'clicks-desc', label: 'クリックが多い順' },
  { value: 'latest-desc', label: '最近追加された順' },
  { value: 'name', label: '流入元名順' },
]

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10件表示' },
  { value: '20', label: '20件表示' },
  { value: '50', label: '50件表示' },
]

/*
  **タブの件数は直書きしない（#980）。**
  設計が描いた「24」「3」「5」は作り物の数で、一覧が0件のアカウントでも
  そのまま出ていた。件数は各タブの一覧と同じ集計から InflowLinksPageHost
  が付ける：「流入経路」は一覧が数える accountFilteredRows、「広告連携」
  「広告とのつなぎ」は広告タブが取得する ad-platforms の件数。
  取得前・失敗時は数字を出さない。
*/
const MERGED_TABS = [
  { key: 'links', label: '流入経路' },
  { key: 'script', label: 'サイトスクリプト' },
  { key: 'ads', label: '広告連携' },
  { key: 'connections', label: '広告とのつなぎ' },
]

/**
 * タブと機能キーの対応。サイトスクリプトは site_tracking(#859)で止める。
 * 流入経路・広告連携は inflow_tracking のまま（ページ自体のキー）。
 */
const TAB_FEATURE: Partial<Record<string, FeatureKey>> = {
  script: 'site_tracking',
}

function InflowLinksPageInner({
  onRouteCountChange,
}: {
  /**
   * #980: タブの件数をホストへ渡す。一覧が描くのと同じ集合
   * （accountFilteredRows）の件数で、読み込み前・失敗時は null。
   */
  onRouteCountChange?: (count: number | null) => void
}) {
  const { selectedAccountId } = useAccount()
  // PERF-03: 編集・作成窓の候補が属する機能（シナリオ/テンプレート/プール）の
  // オン・オフ。切られている系統は候補の取得ごと呼ばない。
  const visibility = useFeatureVisibility(selectedAccountId)
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
  // 一覧そのものを引けなかったとき。空（1件も無い）と言い分けるために持つ。
  const [loadFailed, setLoadFailed] = useState(false)
  const [sort, setSort] = useState<RouteSort>('friends-desc')
  const [filter, setFilter] = useState<RouteFilter>('all')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  // editing state:
  //   - null       — modal closed
  //   - 'new'      — blank "create" modal
  //   - EntryRoute — edit existing registered route
  //   - { register: refCode } — "register an unregistered ref" — opens create
  //     modal with refCode pre-locked so the prior inflow stats stay attached.
  const [editing, setEditing] = useState<
    EntryRoute | 'new' | { register: string } | null
  >(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null)
  const [selectedGenre, setSelectedGenre] = useState('')
  const [search, setSearch] = useState('')
  const [editingGenre, setEditingGenre] = useState<EntryRouteGenre | 'new' | null>(null)
  const [qrRoute, setQrRoute] = useState<{ refCode: string; name: string; genre: string | null } | null>(null)
  // Expanded-row state for showing friends acquired through a given ref.
  // Mirrors the legacy /affiliates page UX — click row → load via
  // /api/analytics/ref/:refCode → render friend list inline.
  const [expandedRef, setExpandedRef] = useState<string | null>(null)
  const [refDetail, setRefDetail] = useState<RefDetail | null>(null)
  const [refDetailLoading, setRefDetailLoading] = useState(false)
  // 開いた行の取得の世代。すばやく別行へ移ったとき、遅れて届いた古い応答を
  // 捨てるために使う。更新関数の内側で副作用を呼ばないための番号。
  const expandRequestRef = useRef(0)
  // poolMembers[poolId] = lineAccountId のセット。pool_accounts を真実として
  // 「この pool が選択中アカウントに配信するか」を判定するために使う。
  // pool.activeAccountId はレガシーシングル所属。マルチアカ pool では不十分。
  const [poolMembers, setPoolMembers] = useState<Record<string, Set<string>>>({})
  // #514-5: 同じ取得から作るプール別の所属名。編集窓へ渡して取り直しを無くす。
  const [poolMemberNames, setPoolMemberNames] = useState<Record<string, string[]>>({})
  /*
    NEXT-21: 「まとめて操作」。表の左のチェックで選んだ登録済み経路へ、
    件数を確認してから同じ操作を行う。計測専用・未登録の行は
    entry_routes の口が無いので対象にしない。
  */
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(() => new Set())
  const [bulkOpen, setBulkOpen] = useState(false)

  const load = async () => {
    const requestGeneration = ++loadRequestRef.current
    const accountAtRequest = selectedAccountId
    const isCurrent = () =>
      requestGeneration === loadRequestRef.current && accountAtRequest === latestAccountRef.current
    setLoading(true)
    setLoadFailed(false)
    // ref-summary は selectedAccountId を渡すと「そのアカで実流入があった
    // ref_code のみ」に絞れる。pool_id NULL のリンクが多い現状ではアカ別の
    // pool 紐付け判定よりも、こちらの実流入ベースの方が運用実態に合う。
    try {
      const summaryQuery = accountAtRequest ? `?lineAccountId=${accountAtRequest}` : ''
      // N-011: 経路一覧も選択accountで絞る。api.tsの共通呼び出し層は変えず、
      // この画面だけfetchApiで直接account_idを渡す。
      const routeQuery = accountAtRequest ? `?account_id=${encodeURIComponent(accountAtRequest)}` : ''
      /*
        PERF-03: 行を作るのに必要な4系統だけを待つ。
        編集・作成窓の候補（プール・シナリオ・テンプレート・タグ）は
        一覧を使える状態にするために要らないので、下の別購読で取る。
        補助系統の失敗が一覧を止めることも無くなる。
      */
      const [r, genreRes, sum, tl] = await Promise.all([
        fetchApi<{ success: boolean; data: EntryRoute[] }>(`/api/entry-routes${routeQuery}`),
        // Worker と Pages の反映順に短い時間差があっても、旧 Worker に対して
        // 画面全体をエラーにしない。ジャンル一覧だけ空として既存リンクを表示する。
        api.entryRouteGenres.list().catch(() => ({
          success: false as const,
          data: [] as EntryRouteGenre[],
        })),
        fetchApi<{ success: boolean; data: RefSummaryData }>(
          `/api/analytics/ref-summary${summaryQuery}`,
        ).catch(() => ({ success: false, data: null })),
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
        setTrackedLinks(
          tl.data.map((row) => ({
            id: row.id,
            name: row.name,
            scenarioId: row.scenarioId,
            isActive: row.isActive,
          })),
        )
      }
    } catch {
      if (!isCurrent()) return
      // 一覧そのものが引けない。空と言い分けるため、失敗として覚える。
      setLoadFailed(true)
      setSummary(null)
      setSummaryAvailable(false)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    // アカウントを変えた瞬間に前の一覧・集計・開いた操作を捨てる。
    // 新しい取得が失敗しても、前のアカウントの値を表示しない。
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
    setBulkOpen(false)
    setPage(1)
    void load()
    // サイドバー側でアカウントを切り替えたら、開きっぱなしの「ref 詳細」も
    // 持ち越さない (アカ A の友だちリストがアカ B の同じ ref 行に残ってしまう
    // クロスアカウントの情報漏れ防止)。stale-response guard だけでは閉じる側を
    // 担保できないので明示的に reset する。
    expandRequestRef.current += 1
    setExpandedRef(null)
    setRefDetail(null)
    setRefDetailLoading(false)
    return () => {
      loadRequestRef.current += 1
    }
  }, [selectedAccountId])

  /*
   * PERF-03: 編集・作成窓の候補（プール・シナリオ・テンプレート・タグ）。
   * 一覧の行を待たせない補助取得。機能を切っている系統は呼ばず、
   * 補助の失敗は一覧を巻き込まない。
   * 可視性の確認中は待つ。確認自体が失敗したときは従来どおり全部試す
   * （各口は自身の失敗で落ちるだけ）。
   */
  useEffect(() => {
    if (selectedAccountId && visibility.status === 'loading') return
    const accountAtRequest = selectedAccountId
    const generation = loadRequestRef.current
    const featureAllowed = (key: FeatureKey) =>
      visibility.features == null || visibility.features[key] === true
    let cancelled = false
    const isCurrent = () =>
      !cancelled
      && generation === loadRequestRef.current
      && accountAtRequest === latestAccountRef.current
    const loadAuxiliary = async () => {
      // プールは補助データ。multi_store_hierarchy がオフでも画面全体を
      // 共通ゲートへ切り替えず、プール列だけ無しで既存リンクを表示する。
      // 403 の応答自体が console error になるため、有効と分からない限り
      // 口を発行しない（#703）。可視性が未確定のときだけ共有判定で確かめる。
      const poolsPromise: Promise<ApiResponse<TrafficPool[]>> = visibility.features != null
        ? (visibility.features['multi_store_hierarchy'] === true
          ? api.pools.list({ suppressFeatureDisabledEvent: true }).catch((): ApiResponse<TrafficPool[]> => ({
            success: false as const,
            error: 'feature_disabled',
          }))
          : Promise.resolve({ success: false as const, error: 'feature_disabled' }))
        : isPoolsFeatureAvailable(selectedAccountId ? [selectedAccountId] : null).then((ok) =>
          ok
            ? api.pools.list({ suppressFeatureDisabledEvent: true }).catch((): ApiResponse<TrafficPool[]> => ({
              success: false as const,
              error: 'feature_disabled',
            }))
            : { success: false as const, error: 'feature_disabled' },
        )
      const [p, s, t, tagRes] = await Promise.all([
        poolsPromise,
        featureAllowed('scenarios')
          ? api.scenarios.list().catch(() => ({ success: false as const, data: [] as Scenario[] }))
          : Promise.resolve({ success: false as const, data: [] as Scenario[] }),
        featureAllowed('templates')
          ? api.messageTemplates.list().catch(() => ({ success: false as const, data: [] as MessageTemplate[] }))
          : Promise.resolve({ success: false as const, data: [] as MessageTemplate[] }),
        api.tags.list().catch(() => ({ success: false, data: [] as Tag[] })),
      ])
      if (!isCurrent()) return
      if (p.success) setPools(p.data)
      if (s.success) setScenarios(s.data)
      if (t.success) setTemplates(t.data)
      if (tagRes.success) setTags(tagRes.data)

      // Load pool→accounts mapping in one request after the pool ids are known.
      // This is a second round-trip, but it stays one request regardless of how
      // many pools exist.
      if (p.success) {
        const batch = p.data.length > 0
          ? await api.pools.listAccounts(
              p.data.map((pool) => pool.id),
              { suppressFeatureDisabledEvent: true },
            )
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

  const onCopy = async (refCode: string, id: string) => {
    const url = referralUrl(refCode)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setCopyFailedId(null)
      setTimeout(() => setCopiedId(null), 1200)
    } catch {
      // 失敗に気づかず URL 未コピーのまま配布作業が進むのを防ぐ。
      setCopyFailedId(id)
      setTimeout(() => setCopyFailedId(null), 3000)
    }
  }

  // Toggle the expandable friend list for a row. Loads on first expand,
  // collapses on second click, swaps detail when expanding a different row.
  // Uses /api/analytics/ref/:refCode (the same API the legacy /affiliates
  // page used) so registered + unregistered refs both work.
  //
  // Race-condition guard: an operator who clicks row A then quickly clicks
  // row B can have request A resolve after B. Without a stale-check, the
  // late A response would overwrite B's detail. We capture the refCode at
  // request time and bail out of state updates when it no longer matches
  // the currently-expanded row.
  const toggleExpand = async (refCode: string) => {
    if (expandedRef === refCode) {
      expandRequestRef.current += 1
      setExpandedRef(null)
      setRefDetail(null)
      setRefDetailLoading(false)
      return
    }
    const requestId = expandRequestRef.current + 1
    expandRequestRef.current = requestId
    setExpandedRef(refCode)
    setRefDetail(null)
    setRefDetailLoading(true)
    const accountAtRequest = selectedAccountId
    const query = accountAtRequest ? `?lineAccountId=${accountAtRequest}` : ''
    const res = await fetchApi<{ success: boolean; data: RefDetail }>(
      `/api/analytics/ref/${encodeURIComponent(refCode)}${query}`,
    ).catch(() => ({ success: false, data: null }))
    // Skip stale updates: only commit if no newer expand/collapse happened
    // AND the sidebar account hasn't changed since the request started.
    // (StrictMode は更新関数を二重実行するため、副作用は外側で番号を見て捨てる。)
    if (expandRequestRef.current !== requestId) return
    if (accountAtRequest !== latestAccountRef.current) return
    if ('success' in res && res.success && res.data) setRefDetail(res.data)
    setRefDetailLoading(false)
  }

  type Row = {
    source: 'entry_route' | 'tracked_link' | 'orphan'
    /** entry_routes に登録があれば id。tracked_link / orphan は null。 */
    entryRouteId: string | null
    refCode: string
    genre: string | null
    name: string
    poolId: string | null
    tagId: string | null
    scenarioId: string | null
    /** entry_route のみ意味を持つ (並走/上書き)。他は null。 */
    runAccountFriendAddScenarios: boolean | null
    stats: RefRouteStats | undefined
  }

  // Merge entry_routes (CRUD 対象), tracked_links (modern path), と
  // summary.routes (実流入のあった refs)。優先順位 = worker の applyRefAttribution
  // と同じ: entry_routes → tracked_links → orphan。
  //
  // tracked_links は entry_routes と別テーブルで管理されている。Worker は両方を
  // フォールバック検索するので tracked_links 登録済み ref も「設定済み」扱いに
  // すべき (Pool は仕様上持たないため "—" 表示)。これがないと「(未登録)」と
  // 表示されるが裏では tracked_links のシナリオが発火している、という UI の嘘
  // になる。
  //
  // ref が数千件になると描画ごとの再構築が重くなるので、一覧の入力が変わった
  // ときだけ作り直す。
  const rowsByRef = useMemo(() => {
    // Index summary stats by ref_code for cheap lookup per row.
    const statsByRef = new Map<string, RefRouteStats>()
    summary?.routes?.forEach((r) => statsByRef.set(r.refCode, r))
    const built = new Map<string, Row>()
    // 「inactive entry_route を譲るべき相手」の refCode 集合。entry_routes と
    // tracked_links の両方に同じ refCode があった場合、worker の
    // getEntryRouteByRefCode は is_active=1 のみ拾うので、inactive な entry_route
    // は applyRefAttribution で通過されず tracked_links にフォールバックされる。
    // 判定軸は「active tracked_link が存在するか」だけ。実流入 (statsByRef) の
    // 有無に依存させると、最初のクリック前は衝突判定が空回りして UI が嘘の
    // entry_route データを見せてしまう (worker は初回クリックでもう tracked_link
    // を使う)。
    const activeTrackedLinkRefCodes = new Set(
      trackedLinks.filter((tl) => tl.isActive).map((tl) => tl.id),
    )
    for (const r of routes) {
      // Inactive entry_route + active tracked_link が同 refCode に共存する場合、
      // 実際に発火するのは tracked_link。停止中 entry_route の Pool/scenario を
      // 表示すると「設定されてるのに違う挙動」の謎が生まれるのでこのケースだけ
      // 譲る。tracked_link が無ければ inactive でも従来通り表示する。
      if (!r.isActive && activeTrackedLinkRefCodes.has(r.refCode)) continue
      built.set(r.refCode, {
        source: 'entry_route',
        entryRouteId: r.id,
        refCode: r.refCode,
        genre: r.genre,
        name: r.name,
        poolId: r.poolId,
        tagId: r.tagId,
        scenarioId: r.scenarioId,
        runAccountFriendAddScenarios: r.runAccountFriendAddScenarios,
        stats: statsByRef.get(r.refCode),
      })
    }
    for (const tl of trackedLinks) {
      if (built.has(tl.id)) continue // entry_routes が優先
      // /inflow-links は「友だち獲得経路」のページ。tracked_links は /t/:id クリック
      // 計測用にも大量に作られるので、実際に友だちの ref_code に焼かれたもの
      // (= summary に出現するもの) のみ表示する。それ以外は無関係なノイズ。
      if (!statsByRef.has(tl.id)) continue
      // worker の applyRefAttribution は isActive=false の tracked_link を skip する
      // ので UI も合わせて非表示。これがないと「Tracked Link 登録済み」緑バッジ +
      // シナリオ名が出ているのにシナリオが流れない、という嘘になる。inactive で
      // 実流入だけある ref は orphan 行 (「未登録」アンバー) として正しく表示される。
      if (!tl.isActive) continue
      built.set(tl.id, {
        source: 'tracked_link',
        entryRouteId: null,
        refCode: tl.id,
        genre: null,
        name: tl.name,
        poolId: null, // tracked_links は pool を持たない
        tagId: null,
        scenarioId: tl.scenarioId,
        runAccountFriendAddScenarios: null,
        stats: statsByRef.get(tl.id),
      })
    }
    for (const s of summary?.routes ?? []) {
      if (built.has(s.refCode)) continue
      built.set(s.refCode, {
        source: 'orphan',
        entryRouteId: null,
        refCode: s.refCode,
        genre: null,
        name: s.name ?? '(未登録)',
        poolId: null,
        tagId: null,
        scenarioId: null,
        runAccountFriendAddScenarios: null,
        stats: s,
      })
    }
    return built
  }, [routes, summary, trackedLinks])

  // Filter by sidebar's selected account.
  //   - 全アカウント表示: entry_routes 全件 + 未登録 ref 全件
  //   - アカ選択中:
  //       a) 未登録 ref: そのアカで実流入があった分のみ (friendCount > 0)
  //       b) 登録済み行: 実流入 > 0 OR pool未設定 OR
  //          その pool に選択中アカが所属
  //
  // 登録済み行を friendCount > 0 やPool所属だけで絞ると、Poolがまだない環境で
  // 作りたての行が一覧から消えて「保存したのに出てこない」事故になる。
  // 一方でPool割当済みをすべて表示すると
  // X Harness 1 サイドバー選択中に main プール向けの lp/lp2 が並んで紛らわしい。
  // ルーティングの真実は pool_accounts (worker の getRandomPoolAccount が
  // ここから抽選する) なので、poolMembers を見て所属判定する。
  // マルチアカウント pool でも正しく動く。
  const allRows = useMemo(() => Array.from(rowsByRef.values()), [rowsByRef])
  const mainPool = pools.find((p) => p.slug === 'main')
  const poolRoutesToAccount = (poolId: string | null, accountId: string): boolean => {
    const targetPoolId = poolId ?? mainPool?.id
    if (!targetPoolId) return false
    return poolMembers[targetPoolId]?.has(accountId) ?? false
  }
  const accountFilteredRows = allRows.filter((row) => shouldShowReferralRow({
    source: row.source,
    poolId: row.poolId,
    friendCount: row.stats?.friendCount ?? 0,
  }, selectedAccountId, poolRoutesToAccount))

  const availableGenres = useMemo(() => {
    const routeGenreNames = routes
      .map((route) => route.genre)
      .filter((genre): genre is string => !!genre)
    return [
      ...genres,
      ...Array.from(new Set(routeGenreNames))
        .filter((name) => !genres.some((genre) => genre.name === name))
        .map((name) => ({ id: `legacy-${name}`, name, createdAt: '', updatedAt: '' })),
    ]
  }, [genres, routes])
  const hasUncategorized = accountFilteredRows.some((row) => !row.genre)
  useEffect(() => {
    const selectable = [
      '',
      ...availableGenres.map((genre) => genre.name),
      ...(hasUncategorized ? [UNCATEGORIZED] : []),
    ]
    setSelectedGenre((current) => selectable.includes(current) ? current : '')
  }, [availableGenres, hasUncategorized])

  const selectedGenreLabel = selectedGenre === UNCATEGORIZED ? '未分類' : selectedGenre || 'すべて'
  const genreRows = selectedGenre === ''
    ? accountFilteredRows
    : selectedGenre === UNCATEGORIZED
    ? accountFilteredRows.filter((row) => !row.genre)
    : accountFilteredRows.filter((row) => row.genre === selectedGenre)
  const normalizedSearch = search.trim().toLocaleLowerCase('ja')
  const searchedRows = normalizedSearch
    ? genreRows.filter((row) =>
        row.name.toLocaleLowerCase('ja').includes(normalizedSearch)
        || row.refCode.toLocaleLowerCase('ja').includes(normalizedSearch))
    : genreRows
  const filteredRows = searchedRows.filter((row) => {
    if (filter === 'has-friends') return (row.stats?.friendCount ?? 0) > 0
    if (filter === 'no-friends') return (row.stats?.friendCount ?? 0) === 0
    if (filter === 'unconfigured') {
      return !row.scenarioId && !row.tagId && row.source === 'entry_route'
    }
    return true
  })
  const sortedRows = [...filteredRows].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'ja')
    if (sort === 'clicks-desc') return (b.stats?.clickCount ?? 0) - (a.stats?.clickCount ?? 0)
    if (sort === 'friends-desc') return (b.stats?.friendCount ?? 0) - (a.stats?.friendCount ?? 0)
    const sa = a.stats?.latestAt ?? ''
    const sb = b.stats?.latestAt ?? ''
    if (!sa && !sb) return 0
    if (!sa) return 1
    if (!sb) return -1
    return sb.localeCompare(sa)
  })
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const currentRows = sortedRows.slice((page - 1) * pageSize, page * pageSize)
  /*
    まとめて操作の対象は、絞り込み済みの行のうち entry_routes に登録が
    あるものだけ。「計測済」「未登録」の行はこの口では動かせない。
  */
  const selectableIds = sortedRows.flatMap((row) => row.entryRouteId ? [row.entryRouteId] : [])
  const allShownSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedRouteIds.has(id))
  const selectedRoutes = routes.filter((route) => selectedRouteIds.has(route.id))
  // 絞り込みでページ数が縮んだら、開いているページを最後のページへ寄せる。
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])
  const genreOptions = availableGenres.map((genre) => genre.name)

  const formatDate = (iso: string | null) => {
    if (!iso) return '—'
    // ★V7：他の一覧と同じ「8月25日」。今年でないときだけ年を付ける。
    const date = new Date(iso)
    const sameYear = date.getFullYear() === new Date().getFullYear()
    return date.toLocaleDateString('ja-JP', sameYear ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' })
  }

  // 設計のKPI。stats は期間を受け取らないので、出せるのは累計だけ。
  // 「稼働中」は登録済みの行。orphan（外部が発行した未登録 ref）は流入実績が
  // あるだけで、こちらから止める・直すができないので数に入れない。
  // 帯は画面全体の要約なので、**フォルダの選択や検索文字で数が変わってはいけない。**
  // ここを `sortedRows`（フォルダ＋検索で絞ったもの）から数えていたため、
  // フォルダ列が「SNS 2／未分類 1」と出ている横で帯が「流入元 0件」になっていた。
  // フォルダ列の件数は `accountFilteredRows` から数えている（下の `:genreCount`）ので、
  // 同じ画面の中で数え方が2通りある状態だった。帯もそちらに揃える。
  const accountRouteCount = summary?.routeTotal ?? accountFilteredRows.length
  const activeRouteCount = accountFilteredRows.filter((r) => r.source !== 'orphan').length
  /*
    **読み込めていないときに0件と書かない。**

    一覧側は読込中・空・取得失敗を3つに言い分けているのに、帯だけが
    `sortedRows.length` をそのまま出していた。取得に失敗すると配列は空なので、
    **登録した流入元が1つも無いように読める。** 設計 `BMmxU` の主題は
    「空・読込・エラーを混ぜない」なので、帯も同じ扱いにする。
  */
  const routeCountAvailable = !loading && !loadFailed
  /*
    #980: 「流入経路」タブの件数は一覧と同じ集合から数えてホストへ渡す。
    フォルダ選択・検索・絞り込みで変わる数ではなく、「このアカウントに
    見えている流入経路の総数」= accountFilteredRows（FolderPanel の
    「すべて」と同じ数え方）。読み込み前・失敗時は null を渡して数字を出さない。
  */
  useEffect(() => {
    onRouteCountChange?.(routeCountAvailable ? accountFilteredRows.length : null)
  }, [onRouteCountChange, routeCountAvailable, accountFilteredRows.length])
  const totalClicks = summary?.totalClicks ?? sortedRows.reduce((sum, r) => sum + (r.stats?.clickCount ?? 0), 0)
  const totalFriends = sortedRows.reduce((sum, r) => sum + (r.stats?.friendCount ?? 0), 0)
  const addRate = summaryAvailable && totalClicks > 0
    ? summary?.averageAddRate ?? Math.round((totalFriends / totalClicks) * 100)
    : null

  const exportCurrentRows = () => {
    const csv = toCsv(sortedRows.map((row) => ({
      name: row.name,
      ref: row.refCode,
      /*
        **取れていない数を 0 にしない。** 書き出したあとは画面の断り書きが
        付いてこないので、ここで 0 と書くと**手元のファイルだけが残って、
        あとから「クリックが1回も無かった」と読まれる。**
      */
      clicks: row.stats?.clickCount ?? null,
      friendAdds: row.stats?.friendCount ?? null,
      lastAddedAt: row.stats?.latestAt ?? null,
    })))
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = exportFileName(sortedRows.length, jstTodayString())
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <p data-design="Head" className="mb-4 text-sm text-ink-faint">
        どこから友だちが来たかを計測します。発行したURLごとにクリック・友だち追加・その後の成果まで追えます。
      </p>
      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="流入元"
          value={routeCountAvailable ? accountRouteCount : null}
          unit="件"
          detail={
            routeCountAvailable
              ? summary?.routeTotal != null
                ? '4つのフォルダ・今月 8/01〜8/25'
                : `稼働中 ${activeRouteCount}`
              : loading
                ? '読み込んでいます'
                : '読み込めませんでした'
          }
        />
        {/*
          設計は「今月 友だちになった 312人／そのうち経路が分かる人 289人」。
          **今月ぶんに絞る術が無い**（`stats` は期間を受け取らず累計で返る）ので、
          今月とは名乗らずに累計で出す。**経路が分かる人の数は口が返している**
          （`friendsWithRef`）ので、設計が分けて見せたかった値はここで出せる。
        */}
        <KpiCard
          title="友だちになった"
          value={summaryAvailable ? (summary?.totalFriends ?? null) : null}
          unit="人"
          detail={
            summaryAvailable && summary
              ? `累計。そのうち経路が分かる人 ${summary.friendsWithRef.toLocaleString('ja-JP')}人`
              : loading
                ? '読み込んでいます'
                : '取得できません'
          }
        />
        <KpiCard
          title="クリック"
          value={summaryAvailable ? totalClicks : null}
          unit="回"
          detail={summaryAvailable ? '累計' : loading ? '読み込んでいます' : '取得できません'}
        />
        <KpiCard
          title="平均の追加率"
          value={addRate}
          unit="%"
          detail={summaryAvailable ? 'クリックのうち' : loading ? '読み込んでいます' : '取得できません'}
        />
      </div>

      {/*
        ★V7：説明の帯2枚（なぜこの画面が要るか・IDEA-18 の集計の断り書き）は
        毎回読むものではないので、開閉する欄に畳む。表と数字を先に見せる。
        未計測の注文を0件と読ませないための件数は、開けば必ず読める。
      */}
      <Disclosure size="compact" className="mb-4" title="数え方と経路の分かり方" hint="累計・はじめて来た経路に数えます">
        <div className="text-ink-secondary space-y-2 text-xs leading-relaxed">
          <p>        LINEの「友だち追加」だけでは、その人がどこから来たのかは分かりません。
        ここで発行したURLをいったん通ってもらうことで、はじめて経路が分かります。QRコードも同じURLから作れます。
      </p>
          <p>        集計は累計（全期間）です。購入・返金は、LINEの友だちと結びついた注文だけを、
        その人がはじめて来た経路に数えます（同じ人・同じ注文は二重に数えません）。
        {summary?.orders
          ? `いまの範囲では注文${summary.orders.total.toLocaleString('ja-JP')}件のうち、経路が分かるのは${summary.orders.attributed.toLocaleString('ja-JP')}件、経路が分からないのは${(summary.orders.total - summary.orders.attributed).toLocaleString('ja-JP')}件（うち友だち未連携${(summary.orders.total - summary.orders.linked).toLocaleString('ja-JP')}件）です。`
          : '注文の集計を取得できたら、経路が分かる件数と分からない件数をここに出します。'}
      </p>
        </div>
      </Disclosure>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><Button href="/inflow-links/new" variant="primary">＋ 流入リンクをつくる</Button><div className="flex gap-2"><Button variant="secondary" onClick={() => setBulkOpen(true)}>まとめて操作{selectedRouteIds.size > 0 ? `（${selectedRouteIds.size}件選択中）` : ''}</Button></div></div>

      <div style={FOLDER_RAIL_STYLE} className="grid gap-5 lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]">
        <FolderPanel
          total={`${accountFilteredRows.length}件`}
          activeId={selectedGenre}
          onSelect={(id) => { setSelectedGenre(id); setPage(1) }}
          onAddFolder={() => setEditingGenre('new')}
          rows={[
            { id: '', label: 'すべて', count: accountFilteredRows.length },
            ...availableGenres.map((genre) => ({
              id: genre.name,
              label: genre.name,
              count: accountFilteredRows.filter((row) => row.genre === genre.name).length,
              ...(!genre.id.startsWith('legacy-') ? { onEdit: () => setEditingGenre(genre) } : {}),
            })),
            ...(hasUncategorized ? [{ id: UNCATEGORIZED, label: '未分類', count: accountFilteredRows.filter((row) => !row.genre).length }] : []),
          ]}
        />

        <section className="min-w-0">
          <div className="mb-3 flex flex-col gap-3 rounded-xl border border-hairline bg-canvas p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-medium text-ink-faint">選択中のフォルダ</p>
              <h2 className="mt-0.5 text-lg font-bold text-ink">{selectedGenreLabel || 'フォルダを選んでください'}</h2>
              <p className="text-xs text-ink-faint">{genreRows.length} リンク</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SearchField
                value={search}
                onChange={(value) => {
                  setSearch(value)
                  setPage(1)
                }}
                onClear={() => {
                  setSearch('')
                  setPage(1)
                }}
                placeholder="流入元の名前・REFで検索"
                aria-label="流入元の名前・REFで検索"
                className="w-full sm:w-64"
              />
              {/* ★V7：「並び順：友だち追加が多い順」が標準幅では「友だち…」で切れるので、この欄だけ広げる。 */}
              <div className="w-full sm:w-64">
                <Select
                  aria-label="並び順"
                  label="並び順"
                  size="full"
                  value={sort}
                  options={SORT_OPTIONS}
                  onChange={(value) => {
                    setSort(value as RouteSort)
                    setPage(1)
                  }}
                />
              </div>
              <Select
                aria-label="表示件数"
                value={String(pageSize)}
                options={PAGE_SIZE_OPTIONS}
                onChange={(value) => {
                  setPageSize(Number(value))
                  setPage(1)
                }}
                size="page-size"
              />
              {/*
                #734: 「このフォルダに流入リンクをつくる」「CSVで書き出す」の
                2つ目は置かない。同じ意図の主操作は画面上部の1系統に揃える
                （新規作成はフォルダ選択を持つ /inflow-links/new が正規口）。
              */}
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="流入経路の絞り込み">
            {([
              ['all', `すべて ${genreRows.length}`],
              ['has-friends', `友だち追加あり ${genreRows.filter((row) => (row.stats?.friendCount ?? 0) > 0).length}`],
              ['no-friends', `友だち追加なし ${genreRows.filter((row) => (row.stats?.friendCount ?? 0) === 0).length}`],
              ['unconfigured', `動きが未設定 ${genreRows.filter((row) => !row.scenarioId && !row.tagId && row.source === 'entry_route').length}`],
            ] as Array<[RouteFilter, string]>).map(([value, label]) => (
              <FilterChip
                key={value}
                selected={filter === value}
                onChange={() => {
                  setFilter(value)
                  setPage(1)
                }}
              >
                {label}
              </FilterChip>
            ))}
          </div>


      {/*
        設計 `BMmxU`（18-1-F 空・読込・エラー）。**3つを言い分ける。**
        いままでは枠2つしか無く、取得に失敗しても「まだリンクがありません」と
        出ていた。運用する人からは、登録したリンクが消えたように見える。
      */}
      <div data-design-node="BMmxU">
      {loading ? (
        <ListState kind="loading" title="流入経路を読み込んでいます" />
      ) : loadFailed ? (
        <ListState
          kind="error"
          title="流入経路を読み込めませんでした"
          description="再読み込みしても直らない場合は、エラー報告へ連絡してください。"
          action={
            <Button variant="secondary" onClick={() => void load()}>
              流入経路を再読み込み
            </Button>
          }
        />
      ) : sortedRows.length === 0 ? (
        <ListState
          kind="empty"
          title={selectedGenre ? `「${selectedGenreLabel}」にはまだリンクがありません` : 'まだ流入経路がありません'}
          description={
            selectedGenre
              ? '上の「流入リンクをつくる」から作ると、ここに出ます。'
              : '左側の「フォルダを追加」から最初のフォルダを作ってください。'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-hairline bg-canvas">
          <table className="w-full table-fixed text-xs">
            <colgroup>
              {/* ★V7：REF は流入元名の下へ。名前が「Googl…」まで削られていたので列を1つ減らし、
                  編集ボタンは割合でなく固定幅にして右端で切れないようにする。 */}
              <col className="w-10" />
              <col className="w-[20%]" />
              <col className="w-[8%]" />
              <col className="w-[13%]" />
              <col className="w-[9%]" />
              <col className="w-[8%]" />
              <col className="w-[9%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              <col className="w-[9%]" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th>
                  <Checkbox
                    aria-label="表示中の登録済み経路をすべて選ぶ"
                    checked={allShownSelected}
                    indeterminate={!allShownSelected && selectableIds.some((id) => selectedRouteIds.has(id))}
                    disabled={selectableIds.length === 0}
                    title={selectableIds.length === 0 ? 'まとめて操作できる登録済みの経路がありません' : undefined}
                    onCheckedChange={(checked) => {
                      setSelectedRouteIds(checked ? new Set(selectableIds) : new Set())
                    }}
                  />
                </Th>
                <Th>
                  流入元名
                </Th>
                <Th>
                  追加先
                </Th>
                <Th>
                  シナリオ
                </Th>
                <Th>
                  自動付与
                </Th>
                <Th>
                  <span title="同時に動く配信">同時配信</span>
                </Th>
                <Th align="right">
                  友だち追加
                </Th>
                <Th align="right">
                  クリック
                </Th>
                <Th>
                  最新追加
                </Th>
                <Th>
                  発行URL
                </Th>
                <Th align="right">編集</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-y divide-hairline">
              {currentRows.map((r) => {
                const pool = pools.find((p) => p.id === r.poolId)
                const sc = scenarios.find((s) => s.id === r.scenarioId)
                const tag = tags.find((t) => t.id === r.tagId)
                const editTarget =
                  r.source === 'entry_route'
                    ? routes.find((e) => e.id === r.entryRouteId) ?? null
                    : null
                const isExpanded = expandedRef === r.refCode
                return (
                  <FragmentRow
                    key={r.refCode}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpand(r.refCode)}
                    refDetailLoading={refDetailLoading}
                    refDetail={refDetail}
                    refCode={r.refCode}
                    accountId={selectedAccountId}
                    orderStats={r.stats}
                  >
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      {r.entryRouteId ? (
                        <Checkbox
                          aria-label={`${r.name}をまとめて操作の対象にする`}
                          checked={selectedRouteIds.has(r.entryRouteId)}
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
                    </td>
                    <td className="px-2 py-3 font-medium text-ink">
                      {r.source === 'entry_route' && r.entryRouteId ? (
                        <Link
                          href={`/inflow-links/detail?id=${r.entryRouteId}`}
                          className="block truncate whitespace-nowrap text-action hover:underline"
                          onClick={(e) => e.stopPropagation()}
                          title={r.name}
                        >
                          {r.name}
                        </Link>
                      ) : r.source === 'tracked_link' ? (
                        <span className="flex min-w-0 items-center gap-1 text-ink-secondary" title={r.name}>
                          <span className="truncate whitespace-nowrap">{r.name}</span>
                          <span
                            className="shrink-0 rounded border border-accent-border bg-accent-soft px-1 py-0.5 text-micro text-accent-deep"
                            title="クリック計測とシナリオ起動が設定されています。追加先の振り分けは全体設定に従います。"
                          >
                            計測済
                          </span>
                        </span>
                      ) : (
                        <span className="flex min-w-0 items-center gap-1 text-ink-secondary" title={r.name}>
                          <span className="truncate whitespace-nowrap">{r.name}</span>
                          <span
                            className="shrink-0 rounded border border-status-warn-soft bg-status-warn-soft px-1 py-0.5 text-micro text-status-warn-deep"
                            title="外部で発行されたREFです。流入実績だけを集計しています。"
                          >
                            未登録
                          </span>
                        </span>
                      )}
                      <span className="text-ink-faint mt-0.5 block truncate font-mono text-micro font-normal whitespace-nowrap" title={r.refCode}>
                        {r.refCode}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-ink-secondary">
                      {pool ? (
                        <span className="block truncate whitespace-nowrap" title={pool.name}>{pool.name}</span>
                      ) : r.source === 'tracked_link' ? (
                        <span
                          className="text-ink-faint"
                          title="追加先の振り分けは全体設定に従います。"
                        >
                          —
                        </span>
                      ) : (
                        <span
                          className="text-ink-faint"
                          title="追加先が設定されていません。"
                        >
                          未設定
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-ink-secondary" title={sc?.name ?? undefined}>
                      <span className="block truncate whitespace-nowrap">{sc?.name ?? '—'}</span>
                    </td>
                    <td className="px-2 py-3 text-ink-secondary">
                      {tag ? (
                        <span
                          className="block truncate whitespace-nowrap rounded-full px-2 py-0.5 text-center text-[11px] font-medium"
                          style={{
                            backgroundColor: `${tag.color}22`,
                            color: tag.color,
                          }}
                          title={tag.name}
                        >
                          {tag.name}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-ink-secondary">
                      {r.source === 'entry_route'
                        ? r.runAccountFriendAddScenarios
                          ? '並走'
                          : '上書き'
                        : r.source === 'tracked_link'
                          ? // tracked_links は account-level friend_add scenarios を
                            // 抑制する仕組みを持たない (runAccountFriendAddScenarios
                            // フラグは entry_routes 専用)。worker 上は常に並走挙動。
                            '並走'
                          : '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-right font-semibold text-ink">
                      {summaryAvailable ? (r.stats?.friendCount ?? 0).toLocaleString('ja-JP') : '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-right text-ink-secondary">
                      {summaryAvailable ? (r.stats?.clickCount ?? 0).toLocaleString('ja-JP') : '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-ink-faint">
                      {summaryAvailable ? formatDate(r.stats?.latestAt ?? null) : '—'}
                    </td>
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <button
                          onClick={() => onCopy(r.refCode, r.refCode)}
                          className="text-[11px] font-medium text-action hover:underline"
                          aria-label={`${r.name}のURLをコピー`}
                        >
                          {copyFailedId === r.refCode ? 'コピー失敗' : copiedId === r.refCode ? '済み' : 'コピー'}
                        </button>
                        <button
                          onClick={() => setQrRoute({ refCode: r.refCode, name: r.name, genre: r.genre })}
                          className="text-[11px] font-medium text-action hover:underline"
                          aria-label={`${r.name}のQRコードを表示`}
                        >
                          QR
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {editTarget ? (
                        /* #641: 編集は共通の枠つきボタン */
                        <Button
                          variant="secondary"
                          onClick={() => setEditing(editTarget)}
                          aria-label={`${r.name}のリンクを編集`}
                        >
                          編集
                        </Button>
                      ) : r.source === 'tracked_link' ? (
                        // tracked_links は別管理 (Web app に編集 UI 未提供)。
                        // entry_routes への "昇格登録" は worker 優先順位的に
                        // tracked_link を上書きすることになり混乱の元なので、
                        // ここではアクション非表示にして tracked_links 側の
                        // 編集導線 (MCP / API) に委ねる。
                        <span className="text-xs text-ink-faint">—</span>
                      ) : (
                        /* #641: 登録も同じ枠つきボタン */
                        <Button
                          variant="secondary"
                          onClick={() => setEditing({ register: r.refCode })}
                          title="未登録 ref を entry_routes に登録します。流入実績はそのまま引き継がれます。"
                        >
                          登録
                        </Button>
                      )}
                    </td>
                  </FragmentRow>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>

          <div data-design="tf" className="mt-3 flex items-center justify-end gap-2 text-xs">
            <span className="text-ink-faint tabular-nums">全 {sortedRows.length} 件</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </div>
        </section>
      </div>

      {editing && (
        <EditRouteModal
          route={
            editing === 'new' || (typeof editing === 'object' && 'register' in editing)
              ? null
              : editing
          }
          initialRefCode={
            typeof editing === 'object' && editing !== null && 'register' in editing
              ? editing.register
              : undefined
          }
          initialGenre={editing === 'new' && selectedGenre !== UNCATEGORIZED ? selectedGenre : undefined}
          pools={pools}
          scenarios={scenarios}
          templates={templates}
          tags={tags}
          existingGenres={genreOptions}
          poolMemberNames={poolMemberNames}
          onClose={() => setEditing(null)}
          onSaved={(savedRoute, created) => {
            setEditing(null)
            load()
            if (created) setQrRoute({ refCode: savedRoute.refCode, name: savedRoute.name, genre: savedRoute.genre })
          }}
        />
      )}
      {editingGenre && (
        <GenreModal
          genre={editingGenre === 'new' ? null : editingGenre}
          onClose={() => setEditingGenre(null)}
          onSaved={(savedGenre, previousName) => {
            setGenres((current) => previousName
              ? current.map((genre) => genre.id === savedGenre.id ? savedGenre : genre)
              : [...current, savedGenre])
            if (previousName) {
              setRoutes((current) => current.map((route) => route.genre === previousName
                ? { ...route, genre: savedGenre.name }
                : route))
            }
            setSelectedGenre(savedGenre.name)
            setEditingGenre(null)
          }}
        />
      )}
      {qrRoute && <ReferralQrModal route={qrRoute} onClose={() => setQrRoute(null)} />}
      {bulkOpen && (
        <BulkRoutesDialog
          targets={selectedRoutes}
          genreOptions={availableGenres.map((genre) => genre.name)}
          onApplied={(remainingIds) => {
            // 反映できなかった分だけを選んだ状態に戻す。
            setSelectedRouteIds(new Set(remainingIds))
            void load()
          }}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * Expandable row wrapper. Renders the main `<tr>` plus an optional second
 * `<tr>` underneath it with the friend list for this ref. Whole-row click
 * toggles expansion; nested clickable cells use `stopPropagation` so the
 * 名前 link / コピー / 編集 buttons don't accidentally trigger expand.
 */
function FragmentRow({
  isExpanded,
  onToggle,
  refDetailLoading,
  refDetail,
  refCode,
  accountId,
  orderStats,
  children,
}: {
  isExpanded: boolean
  onToggle: () => void
  refDetailLoading: boolean
  refDetail: RefDetail | null
  refCode: string
  accountId: string | null
  /** 経路別集計の購入・返金・取消（古い Worker では undefined）。 */
  orderStats: RefRouteStats | undefined
  children: ReactNode
}) {
  const friends = isExpanded && refDetail?.refCode === refCode ? refDetail.friends : null
  return (
    <Fragment>
      <tr className="hover:bg-canvas-sunken cursor-pointer" onClick={onToggle}>
        {children}
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={12} className="px-6 py-4 bg-canvas-sunken border-t border-hairline">
            {refDetailLoading ? (
              <p className="text-sm text-ink-faint">読み込み中…</p>
            ) : !friends ? (
              <p className="text-sm text-ink-faint">読み込めませんでした</p>
            ) : friends.length === 0 ? (
              <p className="text-sm text-ink-faint">この ref から追加した友だちはまだいません</p>
            ) : (
              <div>
                <p className="text-xs font-semibold text-ink-faint uppercase mb-3">
                  この ref から追加した友だち ({friends.length}人)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {friends.map((f) => (
                    <Link
                      key={f.id}
                      href={`/chats?friend=${f.id}`}
                      className="flex items-center justify-between bg-canvas rounded-lg px-3 py-2 border border-hairline hover:border-action"
                    >
                      <span className="text-sm text-ink font-medium truncate">
                        {f.displayName}
                      </span>
                      <span className="text-xs text-ink-faint ml-2 shrink-0">
                        {f.trackedAt
                          ? new Date(f.trackedAt).toLocaleDateString('ja-JP', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                            })
                          : '—'}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {/*
              IDEA-18: 経路別集計と同じ条件の注文明細。
              集計の購入件数は orderStats.orderCount（一覧が持つ行の数）で、
              明細の全件数はこのパネルの total。同じ母集団で数えるので一致する。
              集計自体が届いていない(古いWorker)ときは件数の行を出さない。
            */}
            <div className="mt-4 border-t border-hairline pt-3" onClick={(e) => e.stopPropagation()}>
              {orderStats?.orderCount !== undefined ? (
                <p className="mb-2 text-xs text-ink-faint">
                  集計では、この経路からの購入は {orderStats.orderCount.toLocaleString('ja-JP')}件
                  （返金 {(orderStats.refundedOrderCount ?? 0).toLocaleString('ja-JP')}件・
                  取消 {(orderStats.cancelledOrderCount ?? 0).toLocaleString('ja-JP')}件）です。
                </p>
              ) : null}
              <RefOrdersPanel refCode={refCode} accountId={accountId} pageSize={10} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function ReferralQrModal({
  route,
  onClose,
}: {
  route: { refCode: string; name: string; genre: string | null }
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const url = referralUrl(route.refCode)
  const qrBase = `${WORKER_BASE.replace(/\/$/, '')}/api/qr?size=320x320&data=${encodeURIComponent(url)}`
  const downloadUrl = `${qrBase}&download=1&filename=${encodeURIComponent(`referral-${route.refCode}`)}`
  const copy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-md rounded-2xl bg-canvas p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-ink-faint">リファラルリンク・QRコード</p>
            <h2 className="mt-1 text-lg font-bold text-ink">{route.name}</h2>
            <p className="mt-1 text-sm text-ink-faint">{route.genre ?? '未分類'}</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-ink-faint" aria-label="閉じる">×</button>
        </div>
        <div className="mt-5 rounded-xl bg-canvas-sunken p-3">
          <p className="break-all font-mono text-xs text-ink-secondary">{url}</p>
          <button onClick={copy} className="mt-3 w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm font-medium text-action hover:bg-canvas-sunken">
            {copied ? 'コピーしました' : 'URLをコピー'}
          </button>
        </div>
        <div className="mt-5 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- Workerが動的生成するQRコード */}
          <img src={qrBase} alt={`${route.name}のQRコード`} className="mx-auto h-64 w-64 rounded-xl border border-hairline bg-canvas p-2" />
          <a href={downloadUrl} download={`referral-${route.refCode}.png`} className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-accent-deep px-4 py-2.5 text-sm font-semibold text-on-accent hover:brightness-92">
            QRコードをダウンロード
          </a>
        </div>
      </div>
    </div>
  )
}

type BulkRouteAction = 'pause' | 'resume' | 'move'

/**
 * 「まとめて操作」の窓（NEXT-21）。
 *
 * 対象（表のチェックで選んだ登録済み経路）→ できる操作 → 何件に効くか、
 * の順に見せてから実行する。実行は1件ずつ既存の更新口へ投げ、結果を
 * 成功・失敗に分けて出す。失敗分だけを残して閉じると、一覧では
 * 失敗分だけが選ばれた状態に戻る。
 */
function BulkRoutesDialog({
  targets,
  genreOptions,
  onApplied,
  onClose,
}: {
  /** entry_routes に登録済みの経路だけが対象。 */
  targets: EntryRoute[]
  genreOptions: string[]
  /** 実行が1回でも終わったら呼ぶ。残った対象のIDを渡す。 */
  onApplied: (remainingIds: string[]) => void
  onClose: () => void
}) {
  // 失敗した分だけ残して試し直せるよう、対象は窓の中で持ち直す。
  const [remaining, setRemaining] = useState<EntryRoute[]>(targets)
  const [action, setAction] = useState<BulkRouteAction | null>(null)
  const [genre, setGenre] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    succeeded: EntryRoute[]
    failed: Array<{ route: EntryRoute; error: string }>
  } | null>(null)

  const pauseTargets = remaining.filter((route) => route.isActive)
  const resumeTargets = remaining.filter((route) => !route.isActive)
  const moveTargets = remaining.filter((route) => (route.genre ?? '') !== genre)
  const affected = action === 'pause' ? pauseTargets
    : action === 'resume' ? resumeTargets
    : action === 'move' ? moveTargets
    : []

  const run = async () => {
    if (!action || busy || affected.length === 0) return
    setBusy(true)
    const succeeded: EntryRoute[] = []
    const failed: Array<{ route: EntryRoute; error: string }> = []
    for (const route of affected) {
      try {
        const res = action === 'move'
          ? await api.entryRoutes.update(route.id, { genre: genre === '' ? null : genre })
          : await api.entryRoutes.update(route.id, { isActive: action === 'resume' })
        if (res.success) succeeded.push(route)
        else failed.push({ route, error: res.error || '更新できませんでした' })
      } catch (cause) {
        failed.push({
          route,
          error: cause instanceof ApiError && cause.status === 403
            ? 'この操作を行う権限がありません'
            : '通信できませんでした',
        })
      }
    }
    setResult({ succeeded, failed })
    setRemaining(failed.map((entry) => entry.route))
    setAction(null)
    setBusy(false)
    onApplied(failed.map((entry) => entry.route.id))
  }

  const close = () => {
    if (busy) return
    onClose()
  }

  return (
    <Dialog
      open
      title="流入経路をまとめて操作"
      description="選んだ経路に同じ操作をまとめて行います。実行前に、実際に変わる件数を確認できます。"
      busy={busy}
      onCancel={close}
      footer={result ? undefined : (
        <div className="border-hairline flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button type="button" onClick={close} disabled={busy}>
            キャンセル
          </Button>
          {action && affected.length > 0 ? (
            <Button type="button" variant="primary" disabled={busy} onClick={() => { void run() }}>
              {busy ? '実行中…' : `${affected.length.toLocaleString('ja-JP')}件に実行する`}
            </Button>
          ) : null}
        </div>
      )}
    >
      {result ? (
        <div className="space-y-3">
          <p className="text-ink text-sm">
            {result.succeeded.length.toLocaleString('ja-JP')}件に反映しました。
          </p>
          {result.failed.length > 0 ? (
            <div className="space-y-2">
              <p className="text-danger text-sm font-semibold">
                {result.failed.length.toLocaleString('ja-JP')}件は実行できませんでした。
              </p>
              <ul className="divide-hairline divide-y rounded-control border border-hairline text-sm">
                {result.failed.map(({ route, error }) => (
                  <li key={route.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-ink min-w-0 truncate">{route.name}</span>
                    <span className="text-danger shrink-0 text-xs">{error}</span>
                  </li>
                ))}
              </ul>
              {result.failed.every((entry) => entry.error === 'この操作を行う権限がありません') ? (
                <p className="text-ink-faint text-xs leading-5">
                  すべて権限で止められました。統括または管理者に依頼してください。
                </p>
              ) : null}
              <p className="text-ink-faint text-xs leading-5">
                閉じると、実行できなかった分だけが選ばれた状態に戻ります。
              </p>
            </div>
          ) : null}
        </div>
      ) : remaining.length === 0 ? (
        <p className="text-ink-secondary text-sm leading-6">
          まとめて操作する流入経路が選ばれていません。
          一覧の左はしにあるチェックで対象を選んでから、もう一度開いてください。
          まとめて操作できるのは登録済みの経路だけです（「計測済」「未登録」の行は対象外）。
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-ink text-sm font-semibold">
              対象 {remaining.length.toLocaleString('ja-JP')}件
            </p>
            <p className="text-ink-faint mt-1 text-xs leading-5">
              {remaining.slice(0, 8).map((route) => route.name).join('、')}
              {remaining.length > 8 ? ` ほか${(remaining.length - 8).toLocaleString('ja-JP')}件` : ''}
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-ink mb-1 text-sm font-bold">どの操作をしますか？</legend>
            {([
              {
                value: 'pause' as const,
                label: 'まとめて停止する',
                note: `選んだ中の稼働中 ${pauseTargets.length.toLocaleString('ja-JP')}件が対象です。`,
                count: pauseTargets.length,
              },
              {
                value: 'resume' as const,
                label: 'まとめて再開する',
                note: `選んだ中の停止中 ${resumeTargets.length.toLocaleString('ja-JP')}件が対象です。`,
                count: resumeTargets.length,
              },
              {
                value: 'move' as const,
                label: 'フォルダをまとめて移動する',
                note: `選んだ中の ${moveTargets.length.toLocaleString('ja-JP')}件が変わります。`,
                count: -1,
              },
            ]).map((option) => {
              const unavailable = option.count === 0
              return (
                <label
                  key={option.value}
                  className={`block rounded-control border p-3 ${unavailable ? 'border-hairline bg-canvas-sunken' : action === option.value ? 'border-accent bg-accent-soft' : 'border-hairline bg-canvas cursor-pointer'}`}
                >
                  <span className="flex gap-3">
                    <input
                      type="radio"
                      name="inflow-bulk-action"
                      value={option.value}
                      checked={action === option.value}
                      disabled={unavailable}
                      onChange={() => setAction(option.value)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-semibold ${unavailable ? 'text-ink-faint' : 'text-ink'}`}>
                        {option.label}
                      </span>
                      <span className="text-ink-faint mt-0.5 block text-xs">
                        {unavailable ? `${option.note} 今の選択には効きません。` : option.note}
                      </span>
                      {option.value === 'move' && action === 'move' ? (
                        <span className="mt-2 block" onClick={(event) => event.stopPropagation()}>
                          <Select
                            aria-label="移動先のフォルダ"
                            value={genre}
                            size="full"
                            onChange={setGenre}
                            options={[
                              { value: '', label: '未分類' },
                              ...genreOptions.map((name) => ({ value: name, label: name })),
                            ]}
                          />
                        </span>
                      ) : null}
                    </span>
                  </span>
                </label>
              )
            })}
          </fieldset>
        </div>
      )}
    </Dialog>
  )
}

function InflowLinksPageHost() {
  const { selectedAccountId } = useAccount()
  const visibility = useFeatureVisibility(selectedAccountId)
  const tab = useMergedTab(MERGED_TABS)
  const params = useSearchParams()
  const adView = params.get('view') === 'history' ? 'history' : 'connections'
  /*
    #980: タブの件数。各タブの一覧が実際に取得・表示している集計から
    報告された値だけを出す。報告が無い（未取得・失敗・そのタブをまだ
    開いていない）間は数字を付けない。
  */
  const [linksCount, setLinksCount] = useState<number | null>(null)
  const [adCounts, setAdCounts] = useState<{ total: number; connected: number } | null>(null)
  useEffect(() => {
    // アカウントを切り替えたら前の件数を捨てる。次の報告が来るまで数字は出ない。
    setLinksCount(null)
    setAdCounts(null)
  }, [selectedAccountId])
  // 同じ値の再報告で描画を回さないよう、中身が変わったときだけ入れ替える。
  const handleAdCounts = useCallback((counts: { total: number; connected: number } | null) => {
    setAdCounts((current) => {
      if (counts === null) return current === null ? current : null
      if (current && current.total === counts.total && current.connected === counts.connected) {
        return current
      }
      return counts
    })
  }, [])
  const countedTabs = MERGED_TABS.map((item) => {
    if (item.key === 'links' && linksCount !== null) {
      return { ...item, label: `${item.label} ${linksCount}` }
    }
    if (item.key === 'ads' && adCounts !== null) {
      return { ...item, label: `${item.label} ${adCounts.total}` }
    }
    if (item.key === 'connections' && adCounts !== null) {
      return { ...item, label: `${item.label} ${adCounts.connected}` }
    }
    return item
  })
  const visibleTabs = countedTabs.filter(
    (item) => !TAB_FEATURE[item.key] || visibility.enabled(TAB_FEATURE[item.key]!),
  )
  const tabFeature = TAB_FEATURE[tab]
  // 直URL（?tab=script）でも本文へ進ませず、機能設定への導線を出す。
  const tabBlocked =
    !!tabFeature && visibility.status === 'ready' && !visibility.enabled(tabFeature)
  return (
    <div>
      <MergedTabs basePath="/inflow-links" tabs={visibleTabs} active={tab} />
      {tabBlocked ? (
        <FeatureDisabledScreen featureId={tabFeature} />
      ) : (
        <>
          {tab === 'links' && <InflowLinksPageInner onRouteCountChange={setLinksCount} />}
          {/* 機能状態が確定するまで SiteScript を載せない。読み込み中の
              一瞬に計測APIを呼ぶと、offのaccountで403が画面全体のゲートを
              起こしてしまう。 */}
          {tab === 'script' && visibility.status === 'ready' && <SiteScript />}
          {tab === 'ads' && <AdIntegration view="metrics" onPlatformCountsChange={handleAdCounts} />}
          {tab === 'connections' && <AdIntegration view={adView} onPlatformCountsChange={handleAdCounts} />}
        </>
      )}
    </div>
  )
}

export default function InflowLinksPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <InflowLinksPageHost />
    </Suspense>
  )
}
