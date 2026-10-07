'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ApiError, api, fetchApi } from '@/lib/api'
import PageHeader from '@/components/shared/page-header'
import SearchField from '@/components/shared/search-field'
import PageSizeSelect from '@/components/ui/page-size-select'
import Notice, { type NoticeTone } from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'
import { Link2, Megaphone, MoreHorizontal, CircleAlert, Users } from 'lucide-react'
import styles from './inflow-list-v8.module.css'
import { useAccount } from '@/contexts/account-context'
import type { ApiResponse, EntryRoute, EntryRouteGenre, TrafficPool, Scenario, Tag } from '@line-crm/shared'
import EditRouteModal from './_components/edit-route-modal'
import GenreModal from './_components/create-genre-modal'
import { shouldShowReferralRow } from './visibility'
import { Suspense } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import { FeatureDisabledScreen } from '@/components/feature-disabled-gate'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'
import type { FeatureKey } from '@/lib/feature-settings'
import AdIntegration from './ad-integration'
import { AdConnectionsV8, AdHistoryV8 } from './ad-integration-v8'
import SiteScriptV8 from '@/v8/inflow-links/site-script'
import AdsV8 from '@/v8/inflow-links/ads'
import { useAdminTheme } from '@/lib/use-admin-theme'
import InflowListV8 from '@/v8/inflow-links/list'
import ReferralQrModal, { type ReferralQrRoute } from './referral-qr-modal'
import SiteScript from '@/components/inflow-links/site-script'
import { TableHeadRow, Th } from '@/components/shared/table'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Dialog from '@/components/shared/dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import { loadFailureCopy } from '@/components/shared/api-error-message'
import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { formatDay, formatNumber } from '@/lib/format'

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
  /*
   * M029: 引けなかった原因そのもの。403は権限の案内にし、押しても
   * 直らない再試行の口は出さない。429は待ち秒数を添えて再試行を残す。
   * `ListState kind="error"` に `error` ごと渡す（m23mの共通文）。
   */
  const [loadError, setLoadError] = useState<unknown>(null)
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
  const [qrRoute, setQrRoute] = useState<ReferralQrRoute | null>(null)
  // 行の「…」。開いている行の refCode。
  const [openMenuRefCode, setOpenMenuRefCode] = useState<string | null>(null)
  // 「よく使う絞り込み」の開き。残りの絞り込みと並び順をここに置く。
  const [presetOpen, setPresetOpen] = useState(false)
  // 広告とつないだ数（板 xbHxg の4枚目）。取れなければ null で「—」。
  const [adConnected, setAdConnected] = useState<{ total: number; names: string[] } | null>(null)
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
  /*
   * EMUl9（一覧・閲覧のみ）: staff は変える操作を隠して帯を出す。
   * 役職が読めないときは管理者扱いのままにする（一覧の既存の動きを
   * 変えない。止めるのは口の403が担う）。
   */
  const [canManage, setCanManage] = useState(true)
  const [roleResolved, setRoleResolved] = useState(false)
  const readonly = roleResolved && !canManage

  const load = async () => {
    const requestGeneration = ++loadRequestRef.current
    const accountAtRequest = selectedAccountId
    const isCurrent = () =>
      requestGeneration === loadRequestRef.current && accountAtRequest === latestAccountRef.current
    setLoading(true)
    setLoadFailed(false)
    setLoadError(null)
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
    } catch (e) {
      if (!isCurrent()) return
      // 一覧そのものが引けない。空と言い分けるため、失敗として覚える。
      // M029: 原因も残し、403・429を言い分けた1枚にする。
      setLoadFailed(true)
      setLoadError(e)
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
    setOpenMenuRefCode(null)
    setPresetOpen(false)
    setAdConnected(null)
    setPage(1)
    void load()
    return () => {
      loadRequestRef.current += 1
    }
  }, [selectedAccountId])

  // EMUl9: 自分の役職だけを軽く取る。一覧の行を待たせない補助取得。
  // staff（閲覧のみ）だけ変える操作を隠す。読めなければ管理者扱いのまま。
  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (!active) return
      if (response.success && response.data.role !== undefined && response.data.role !== 'owner' && response.data.role !== 'admin') {
        setCanManage(false)
      }
      setRoleResolved(true)
    }).catch(() => {
      if (active) setRoleResolved(true)
    })
    return () => { active = false }
  }, [])

  // 広告とつないだ数だけを軽く取る。一覧の行を待たせない補助取得。
  // 失敗しても帯の4枚目が「—」になるだけで、一覧は巻き込まない。
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
    } catch {
      notifyToast('通信できませんでした')
    }
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
    /**
     * entry_route は登録の有効・無効。tracked_link 行は有効のみ並ぶので true、
     * 未登録 ref は概念が無いので null。停止中は QR を出さない判定に使う。
     */
    isActive: boolean | null
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
        isActive: r.isActive,
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
        isActive: true,
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
        isActive: null,
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

  // ★V7：他の一覧と同じ「8月25日（月）」。今年でないときだけ年を付ける。
  const formatDate = (iso: string | null) => formatDay(iso)

  // 設計のKPI。stats は期間を受け取らないので、出せるのは累計だけ。
  // R273: 「受付中」は isActive が真の登録済み行だけを数える。orphan（外部が
  // 発行した未登録 ref）は流入実績があるだけで、こちらから止める・直すが
  // できないので数に入れない。停止中も別に数え、一覧・一括操作・詳細と同じ
  // 言葉（受付中・停止中）で出す。
  // 帯は画面全体の要約なので、**フォルダの選択や検索文字で数が変わってはいけない。**
  // ここを `sortedRows`（フォルダ＋検索で絞ったもの）から数えていたため、
  // フォルダ列が「SNS 2／未分類 1」と出ている横で帯が「流入元 0件」になっていた。
  // フォルダ列の件数は `accountFilteredRows` から数えている（下の `:genreCount`）ので、
  // 同じ画面の中で数え方が2通りある状態だった。帯もそちらに揃える。
  const accountRouteCount = summary?.routeTotal ?? accountFilteredRows.length
  /*
    **読み込めていないときに0件と書かない。**

    一覧側は読込中・空・取得失敗を3つに言い分けているのに、帯だけが
    `sortedRows.length` をそのまま出していた。取得に失敗すると配列は空なので、
    **登録した流入元が1つも無いように読める。** 設計 `BMmxU` の主題は
    「空・読込・エラーを混ぜない」なので、帯も同じ扱いにする。
  */
  const routeCountAvailable = !loading && !loadFailed
  /*
   * M029: 取得失敗の1枚の中身。403は権限の案内で再試行なし、
   * 429は待ち秒数つきで再試行あり、それ以外は今までどおりの1枚。
   * 原因が無い（成功応答の失敗）は共通の1枚に倒す。
   */
  const loadFailure = loadError ? loadFailureCopy(loadError, '流入経路') : null
  /*
    #980: 「流入経路」タブの件数は一覧と同じ集合から数えてホストへ渡す。
    フォルダ選択・検索・絞り込みで変わる数ではなく、「このアカウントに
    見えている流入経路の総数」= accountFilteredRows（FolderPanel の
    「すべて」と同じ数え方）。読み込み前・失敗時は null を渡して数字を出さない。
  */
  useEffect(() => {
    onRouteCountChange?.(routeCountAvailable ? accountFilteredRows.length : null)
  }, [onRouteCountChange, routeCountAvailable, accountFilteredRows.length])
  /*
    帯は画面全体の要約なので、クリックと平均の追加率もフォルダの選択・
    検索文字・友だち有無の絞り込みで変わってはいけない。実 Worker の
    ref-summary は routeTotal / totalClicks / averageAddRate を返さないので、
    通常はここで選択アカウント範囲（絞り込みの前）から数える。
    summary が全体値を返しているときはそちらを優先する。
  */
  /*
    実 Worker の ref-summary は routeTotal / totalClicks / averageAddRate を
    返さないので、通常は選択アカウント範囲（絞り込みの前）から数える。
    summary が全体値を返しているときはそちらを優先する。
  */
  /*
    板 xbHxg の帯と案内で使う数。帯は画面全体の要約なので、フォルダの選択・
    検索文字・絞り込みの前（accountFilteredRows）から数える。
  */
  const unconfiguredCount = accountFilteredRows.filter(
    (row) => !row.scenarioId && !row.tagId && row.source === 'entry_route',
  ).length
  const hasFriendsCount = accountFilteredRows.filter((row) => (row.stats?.friendCount ?? 0) > 0).length
  const genreNames = availableGenres.map((genre) => genre.name)
  const tileGenreSub = genreNames.length === 0
    ? 'フォルダはまだありません'
    : genreNames.slice(0, 3).join('・') + (genreNames.length > 3 ? 'など' : '')
  const adNamesSub = adConnected === null
    ? '取得できません'
    : adConnected.names.length === 0
      ? 'まだ接続がありません'
      : adConnected.names.slice(0, 2).join('・') + (adConnected.names.length > 2 ? 'など' : '')

  // 「友だちになったら」の2行。絵の「シナリオ・タグ・同時配信なし」の並びに寄せる。
  const becameLines = (row: Row, sc: Scenario | undefined, tag: Tag | undefined): [string, string] => {
    const first = sc ? `シナリオ「${sc.name}」` : '—'
    if (tag) {
      const suffix = row.runAccountFriendAddScenarios === false ? '・同時配信なし' : ''
      return [first, `タグ「${tag.name}」${suffix}`]
    }
    if (sc) {
      return [first, row.runAccountFriendAddScenarios === false ? '同時配信なし' : '—']
    }
    return ['—', '何も付けない']
  }

  // 流入元名の下の札。測れていない受付中は何も付けない（測ったふりをしない）。
  const routeStatus = (row: Row): 'measured' | 'unregistered' | 'stopped' | null => {
    if (row.isActive === false) return 'stopped'
    if (row.source === 'orphan') return 'unregistered'
    if (row.source === 'tracked_link') return 'measured'
    return row.stats ? 'measured' : null
  }

  // 行の「…」。絵の注にある操作（QR表示・コピー・編集・止める／再開）だけ出す。
  const rowMenuItems = (row: Row): ActionMenuItem[] => {
    const items: ActionMenuItem[] = []
    if (row.isActive !== false) {
      items.push({
        id: 'qr',
        label: 'QRコードを表示',
        onSelect: () => {
          setOpenMenuRefCode(null)
          setQrRoute({ refCode: row.refCode, name: row.name, genre: row.genre, isActive: row.isActive })
        },
      })
    }
    items.push({
      id: 'copy',
      label: 'URLをコピー',
      onSelect: () => {
        setOpenMenuRefCode(null)
        void onCopy(row.refCode, row.refCode)
      },
    })
    if (!readonly && row.entryRouteId) {
      const target = routes.find((entry) => entry.id === row.entryRouteId) ?? null
      if (target) {
        items.push({
          id: 'edit',
          label: 'リンクを編集',
          onSelect: () => {
            setOpenMenuRefCode(null)
            setEditing(target)
          },
        })
      }
      items.push(row.isActive === false
        ? {
          id: 'resume',
          label: '受付を再開する',
          onSelect: () => void toggleRouteActive(row.entryRouteId!, true, row.name),
        }
        : {
          id: 'stop',
          label: '受付を止める',
          tone: 'danger' as const,
          onSelect: () => void toggleRouteActive(row.entryRouteId!, false, row.name),
        })
    }
    return items
  }

  const applyPresetFilter = (value: string) => {
    setFilter(value as RouteFilter)
    setPage(1)
    setPresetOpen(false)
  }

  return (
    <div className={styles.board} data-design-node="xbHxg">
      <PageHeader
        breadcrumb={[{ label: '成果と分析' }, { label: '流入と計測' }]}
        title="流入と計測"
        description="QRコード・URLごとに、どこから友だちになったかを数えます。友だちになったときに、タグ・メッセージ・シナリオを自動で動かせます。"
        actions={<>
          <Button variant="secondary" href="/inflow-links?tab=connections">広告とのつなぎ</Button>
          {/*
            #859: site_tracking が切れているときはタブと同じく口を出さない。
            直URL（?tab=script）はホスト側の停止画面が出す。
          */}
          {visibility.enabled('site_tracking') ? (
            <Button variant="secondary" href="/inflow-links?tab=script">サイトスクリプト</Button>
          ) : visibility.status === 'loading' ? (
            /* 機能の見え方を読む間も場所を取る。後から出すと説明が折り返し直し、下が 19px 跳ねていた（動きの点検 8 番）。 */
            <span aria-hidden="true" className="invisible"><Button variant="secondary" tabIndex={-1}>サイトスクリプト</Button></span>
          ) : null}
        </>}
      />
      <p data-design="Head" className="sr-only">
        どこから友だちが来たかを計測します。発行したURLごとにクリック・友だち追加・その後の成果まで追えます。
      </p>
      {readonly ? (
        <div data-design-node="EMUl9">
          <Notice tone="info">
            閲覧のみで見ています。変える操作は管理者に頼んでください。
          </Notice>
        </div>
      ) : null}
      {/*
        板 xbHxg の数の帯。項目は絵どおり、数は実データ。
        「今月の友だち追加」は月で絞る口が無いので、累計と分かる書き方にする。
      */}
      <div data-design="KPIs" className={styles.band} role="group" aria-label="流入と計測の概要">
        <div className={styles.tile}>
          <div className={styles.tileTop}>
            <span className={styles.tileIcon} aria-hidden="true"><Link2 size={14} /></span>
            <span className={styles.tileTitle}>経路</span>
          </div>
          <div className={styles.tileValue}>
            {routeCountAvailable ? formatNumber(accountRouteCount) : '—'}
            <span className={styles.tileUnit}>件</span>
          </div>
          <div className={styles.tileSub} title={routeCountAvailable ? tileGenreSub : undefined}>
            {routeCountAvailable ? tileGenreSub : loading ? '読み込んでいます' : '読み込めませんでした'}
          </div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileTop}>
            <span className={styles.tileIcon} aria-hidden="true"><Users size={14} /></span>
            <span className={styles.tileTitle}>友だち追加</span>
          </div>
          <div className={styles.tileValue}>
            {summaryAvailable && summary ? formatNumber(summary.totalFriends) : '—'}
            <span className={styles.tileUnit}>人</span>
          </div>
          <div className={styles.tileSub}>
            {summaryAvailable && summary
              ? `累計。そのうち経路が分かる人 ${formatNumber(summary.friendsWithRef)}人`
              : loading ? '読み込んでいます' : '取得できません'}
          </div>
        </div>
        <button
          type="button"
          className={styles.tile}
          onClick={() => {
            setFilter('unconfigured')
            setPage(1)
          }}
          title="動きが未設定の経路だけに絞ります"
        >
          <div className={styles.tileTop}>
            <span className={styles.tileIcon} aria-hidden="true"><CircleAlert size={14} /></span>
            <span className={styles.tileTitle}>動きが未設定</span>
          </div>
          <div className={styles.tileValue}>
            {routeCountAvailable ? formatNumber(unconfiguredCount) : '—'}
            <span className={styles.tileUnit}>件</span>
          </div>
          <div className={styles.tileSub}>友だちになっても何も起きない</div>
        </button>
        <div className={styles.tile}>
          <div className={styles.tileTop}>
            <span className={styles.tileIcon} aria-hidden="true"><Megaphone size={14} /></span>
            <span className={styles.tileTitle}>広告とつないだ</span>
          </div>
          <div className={styles.tileValue}>
            {adConnected ? formatNumber(adConnected.total) : '—'}
            <span className={styles.tileUnit}>件</span>
          </div>
          <div className={styles.tileSub} title={adNamesSub}>{adNamesSub}</div>
        </div>
      </div>

      {!readonly ? (
        <div className={styles.createRow}>
          <Button href="/inflow-links/new" variant="primary">＋ 流入リンクを作る</Button>
          {selectedRouteIds.size > 0 ? (
            <Button variant="secondary" onClick={() => setBulkOpen(true)}>
              まとめて操作（{selectedRouteIds.size}件選択中）
            </Button>
          ) : null}
        </div>
      ) : null}

      <div style={FOLDER_RAIL_STYLE} className={styles.columns}>
        <div className="min-w-0">
          <FolderPanel
            total={`${accountFilteredRows.length}件`}
            activeId={selectedGenre}
            onSelect={(id) => { setSelectedGenre(id); setPage(1) }}
            onAddFolder={readonly ? undefined : () => setEditingGenre('new')}
            rows={[
              { id: '', label: 'すべて', count: accountFilteredRows.length },
              ...availableGenres.map((genre) => ({
                id: genre.name,
                label: genre.name,
                count: accountFilteredRows.filter((row) => row.genre === genre.name).length,
                ...(!readonly && !genre.id.startsWith('legacy-') ? { onEdit: () => setEditingGenre(genre) } : {}),
              })),
              ...(hasUncategorized ? [{ id: UNCATEGORIZED, label: '未分類', count: accountFilteredRows.filter((row) => !row.genre).length }] : []),
            ]}
          />
          <p className={styles.folderNote}>フォルダを消しても、中の経路は未分類に残ります</p>
        </div>

        <section className="flex min-w-0 flex-col gap-4" aria-label={`${selectedGenreLabel}の流入経路（${genreRows.length}件）`}>
          {/*
            未設定の知らせは絵（xbHxg）どおり一覧の列の頭に置く。以前は数の帯と作るボタンの
            間に後から差し込まれ、フォルダの列ごと 56px 押し下げていた（動きの点検 8 番）。
          */}
          {routeCountAvailable && unconfiguredCount > 0 ? (
            <Notice tone="info">
              友だちになっても何も起きない経路が {formatNumber(unconfiguredCount)}件あります。「動きが未設定」で絞って、タグやメッセージを決めてください。
            </Notice>
          ) : null}
          {/*
            板 xbHxg の道具。絵どおり、よく使う2枚だけ外に出し、残りの絞り込みと
            並び順は「よく使う絞り込み」の中に置く。
          */}
          <div className={styles.tools}>
            <div className={styles.toolsSearch}>
              <SearchField
                aria-label="経路の名前・URLで探す"
                placeholder="経路の名前・URLで探す"
                value={search}
                onChange={(value) => {
                  setSearch(value)
                  setPage(1)
                }}
              />
            </div>
            <div className="contents" aria-label="流入経路の絞り込み">
              <FilterChip
                selected={filter === 'has-friends'}
                onChange={() => {
                  setFilter(filter === 'has-friends' ? 'all' : 'has-friends')
                  setPage(1)
                }}
                count={hasFriendsCount}
              >
                友だち追加あり
              </FilterChip>
              <FilterChip
                selected={filter === 'unconfigured'}
                onChange={() => {
                  setFilter(filter === 'unconfigured' ? 'all' : 'unconfigured')
                  setPage(1)
                }}
                count={unconfiguredCount}
              >
                動きが未設定
              </FilterChip>
            </div>
            <div className={styles.toolsRight}>
              <div className={styles.presetWrap}>
                <Button
                  variant="secondary"
                  onClick={() => setPresetOpen((current) => !current)}
                  aria-expanded={presetOpen}
                >
                  よく使う絞り込み
                </Button>
                {presetOpen ? (
                  <div className={styles.presetPanel} role="dialog" aria-label="よく使う絞り込み">
                    <span className={styles.presetLabel}>絞り込み</span>
                    <div className={styles.presetChips}>
                      {([
                        ['all', 'すべて', genreRows.length],
                        ['has-friends', '友だち追加あり', genreRows.filter((row) => (row.stats?.friendCount ?? 0) > 0).length],
                        ['no-friends', '友だち追加なし', genreRows.filter((row) => (row.stats?.friendCount ?? 0) === 0).length],
                        ['unconfigured', '動きが未設定', genreRows.filter((row) => !row.scenarioId && !row.tagId && row.source === 'entry_route').length],
                      ] as Array<[RouteFilter, string, number]>).map(([value, label, total]) => (
                        <FilterChip
                          key={value}
                          selected={filter === value}
                          onChange={() => applyPresetFilter(value)}
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
                      onChange={(value) => {
                        setSort(value as RouteSort)
                        setPage(1)
                        setPresetOpen(false)
                      }}
                    />
                  </div>
                ) : null}
              </div>
              <PageSizeSelect
                value={pageSize}
                options={[10, 20, 50]}
                onChange={(value) => {
                  setPageSize(value)
                  setPage(1)
                }}
                aria-label="表示件数"
              />
            </div>
          </div>


      {loading ? (
        <ListState kind="loading" title="流入経路を読み込んでいます" />
      ) : loadFailed ? (
        /*
         * M029: 原因をそのまま渡す。403は権限の案内になり再試行の口は
         * 出ない（押しても直らない）。429とそれ以外は同じ画面から
         * 取り直せる（`onRetry` が再取得する）。
         */
        <ListState
          kind="error"
          title={loadFailure?.title}
          description={loadFailure?.description}
          error={loadError ?? undefined}
          onRetry={loadFailure?.retryable ? () => void load() : undefined}
        />
      ) : sortedRows.length === 0 ? (
        /*
         * R173: 絞り込み・検索で0件のときは「まだ無い」と言わない。
         * 登録があるのに未登録向けの案内（最初のフォルダ作り）を出すと、
         * あるはずの経路が消えたように見える。条件を変える案内にする。
         */
        accountFilteredRows.length > 0 && (normalizedSearch !== '' || filter !== 'all' || selectedGenre !== '') ? (
          <ListState
            kind="empty"
            title="条件に合う流入経路がありません"
            description="検索や絞り込みの条件を変えてください。"
          />
        ) : (
          <ListState
            kind="empty"
            title={selectedGenre ? `「${selectedGenreLabel}」にはまだリンクがありません` : 'まだ流入経路がありません'}
            description={
              selectedGenre
                ? '上の「＋ 流入リンクを作る」から作ると、ここに出ます。'
                : '左側の「フォルダを追加」から最初のフォルダを作ってください。'
            }
          />
        )
      ) : (
        <div className={styles.tableShell} data-scroll-x style={{ '--scroll-min': '1060px' } as CSSProperties}>
          <table>
            <thead>
              <TableHeadRow>
                {readonly ? null : (
                  <Th className="pl-5">
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
                )}
                <Th>流入元名</Th>
                <Th>追加先</Th>
                <Th>友だちになったら</Th>
                <Th align="right">友だち追加</Th>
                <Th align="right">クリック</Th>
                <Th>最新追加</Th>
                <Th>発行URL</Th>
                <Th aria-label="その他の操作"><span className="sr-only">その他の操作</span></Th>
                {readonly ? null : (
                  <Th align="right" className="pr-5">操作</Th>
                )}
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
                const status = routeStatus(r)
                const [becameFirst, becameSecond] = becameLines(r, sc, tag)
                const menuItems = rowMenuItems(r)
                return (
                  <tr key={r.refCode} className="hover:bg-canvas-sunken">
                    {readonly ? null : (
                      <td className="py-3 pr-2 pl-5">
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
                    )}
                    <td className={`px-5 py-[9px] font-medium text-ink ${styles.nameCell}`}>
                      {r.source === 'entry_route' && r.entryRouteId ? (
                        <Link
                          href={`/inflow-links/detail?id=${r.entryRouteId}`}
                          className={styles.nameLink}
                          title={r.name}
                        >
                          {r.name}
                        </Link>
                      ) : (
                        <span className={styles.nameLink} title={r.name} style={{ color: 'inherit' }}>
                          {r.name}
                        </span>
                      )}
                      <span className={styles.refCode} title={r.refCode}>
                        {r.refCode}
                      </span>
                      {status === 'measured' ? (
                        <span
                          className={`${styles.statusChip} ${styles.statusMeasured}`}
                          title={r.source === 'tracked_link'
                            ? 'クリック計測とシナリオ起動が設定されています。追加先の振り分けは全体設定に従います。'
                            : '流入の計測ができています。'}
                        >
                          計測済
                        </span>
                      ) : status === 'unregistered' ? (
                        <span
                          className={`${styles.statusChip} ${styles.statusUnregistered}`}
                          title="外部で発行されたREFです。流入実績だけを集計しています。"
                        >
                          未登録
                        </span>
                      ) : status === 'stopped' ? (
                        <span
                          className={`${styles.statusChip} ${styles.statusStopped}`}
                          title="受付を止めています。このURLを開いても友だち追加できません。"
                        >
                          停止中
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-[9px] text-ink-secondary">
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
                    <td className="px-5 py-[9px] text-ink-secondary">
                      <span className={styles.twoLine} title={becameFirst}>{becameFirst}</span>
                      <span className={styles.twoLineSub} title={becameSecond}>{becameSecond}</span>
                    </td>
                    <td className={`px-5 py-[9px] font-semibold text-ink ${styles.numCell}`}>
                      {summaryAvailable && r.stats ? (
                        <>
                          <span className={styles.twoLine}>{formatNumber(r.stats.friendCount)}人</span>
                          <span className={styles.twoLineSub}>累計 {formatNumber(r.stats.friendCount)}人</span>
                        </>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className={`px-5 py-[9px] text-ink-secondary ${styles.numCell}`}>
                      {summaryAvailable && r.stats ? formatNumber(r.stats.clickCount) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-5 py-[9px] text-ink-faint">
                      {summaryAvailable ? formatDate(r.stats?.latestAt ?? null) : '—'}
                    </td>
                    <td className={`px-5 py-[9px] ${styles.urlCell}`}>
                      {r.isActive === false ? (
                        /*
                          停止中の経路のURLとQRは出さない。開いても友だち追加
                          できないURLを配る事故を防ぐ。押せない飾りは置かず、
                          理由（停止中）だけを同じ場所に出す。
                        */
                        <span className={styles.stoppedLabel} title="停止中のためURLとQRコードは表示できません">
                          停止中
                        </span>
                      ) : (
                        <span className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => void onCopy(r.refCode, r.refCode)}
                            className={styles.linkButton}
                            aria-label={`${r.name}のURLをコピー`}
                          >
                            {copyFailedId === r.refCode ? 'コピー失敗' : copiedId === r.refCode ? '済み' : 'コピー'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setQrRoute({ refCode: r.refCode, name: r.name, genre: r.genre, isActive: r.isActive })}
                            className={styles.linkButton}
                            aria-label={`${r.name}のQRコードを表示`}
                          >
                            QR
                          </button>
                        </span>
                      )}
                    </td>
                    <td className={`px-5 py-[9px] ${styles.moreCell}`}>
                      {menuItems.length > 0 ? (
                        <>
                          <button
                            type="button"
                            className={styles.moreButton}
                            title={`「${r.name}」のその他の操作`}
                            aria-label={`「${r.name}」のその他の操作（QRコードの表示・URLのコピー・編集・受付の停止と再開）`}
                            aria-expanded={openMenuRefCode === r.refCode}
                            onClick={() => setOpenMenuRefCode((current) => (current === r.refCode ? null : r.refCode))}
                          >
                            <MoreHorizontal size={16} aria-hidden="true" />
                          </button>
                          <ActionMenu
                            open={openMenuRefCode === r.refCode}
                            onClose={() => setOpenMenuRefCode(null)}
                            ariaLabel={`「${r.name}」の操作`}
                            items={menuItems}
                          />
                        </>
                      ) : (
                        <span className="text-xs text-ink-faint">—</span>
                      )}
                    </td>
                    {readonly ? null : (
                      <td className="py-3 pr-5 pl-2 text-right">
                        {editTarget ? (
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
                          <Button
                            variant="secondary"
                            onClick={() => setEditing({ register: r.refCode })}
                            title="未登録 ref を entry_routes に登録します。流入実績はそのまま引き継がれます。"
                          >
                            登録する
                          </Button>
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
      <p className={styles.tableFoot}>
        {readonly
          ? '行の「…」からQRコードを表示・URLをコピーできます。'
          : '行の「…」からQRコードを表示・URLをコピー・リンクを編集・受付の停止と再開。左のチェックで、まとめて操作できます。'}
      </p>
      <div data-design="tf" className={styles.pager}>
        <span className="tabular-nums">全 {sortedRows.length} 件</span>
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
          accountId={selectedAccountId}
          onClose={() => setEditing(null)}
          onSaved={(savedRoute, created) => {
            setEditing(null)
            load()
            if (created) setQrRoute({ refCode: savedRoute.refCode, name: savedRoute.name, genre: savedRoute.genre, isActive: savedRoute.isActive })
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
            <Button type="button" variant="primary" disabled={busy} onClick={() => { void run() }} busy={busy} busyLabel="実行中…">
              {`${formatNumber(affected.length)}件に実行する`}
            </Button>
          ) : null}
        </div>
      )}
    >
      {result ? (
        <div className="space-y-3">
          <p className="text-ink text-sm">
            {formatNumber(result.succeeded.length)}件に反映しました。
          </p>
          {result.failed.length > 0 ? (
            <div className="space-y-2">
              <p className="text-danger text-sm font-semibold">
                {formatNumber(result.failed.length)}件は実行できませんでした。
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
              対象 {formatNumber(remaining.length)}件
            </p>
            <p className="text-ink-faint mt-1 text-xs leading-5">
              {remaining.slice(0, 8).map((route) => route.name).join('、')}
              {remaining.length > 8 ? ` ほか${formatNumber((remaining.length - 8))}件` : ''}
            </p>
          </div>
          <RadioCardGroup legend="どの操作をしますか？">
            {([
              {
                value: 'pause' as const,
                label: 'まとめて停止する',
                note: `選んだ中の受付中 ${formatNumber(pauseTargets.length)}件が対象です。`,
                count: pauseTargets.length,
              },
              {
                value: 'resume' as const,
                label: 'まとめて再開する',
                note: `選んだ中の停止中 ${formatNumber(resumeTargets.length)}件が対象です。`,
                count: resumeTargets.length,
              },
              {
                value: 'move' as const,
                label: 'フォルダをまとめて移動する',
                note: `選んだ中の ${formatNumber(moveTargets.length)}件が変わります。`,
                count: -1,
              },
            ]).map((option) => {
              const unavailable = option.count === 0
              return (
                <RadioCard
                  key={option.value}
                  name="inflow-bulk-action"
                  value={option.value}
                  checked={action === option.value}
                  disabled={unavailable}
                  disabledReason="今の選択には効きません"
                  onChange={() => setAction(option.value)}
                  title={option.label}
                  note={option.note}
                />
              )
            })}
          </RadioCardGroup>
          {action === 'move' ? (
            <Select
              aria-label="移動先のフォルダ"
              value={genre}
              size="full"
              onChange={setGenre}
              options={[
                { value: '', label: '未分類' },
                ...genreOptions.map((name) => ({ value: name, label: name })),
              ]}
              className="mt-2"
            />
          ) : null}
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
  const theme = useAdminTheme()
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
  /*
    ★V8 の一覧（src/v8/inflow-links）は絵（xbHxg）どおりタブを出さない。
    ほかのページへは見出しの「広告とのつなぎ」「サイトスクリプト」と、
    数の帯の「広告連携」から行く。V8 以外と、ほかのタブは今のまま。
  */
  const v8List = theme === 'v8' && tab === 'links' && !tabBlocked
  if (v8List) return <InflowListV8 onRouteCountChange={setLinksCount} />
  /*
    ★V8 のサイトスクリプト（XjOte）・広告連携（qSTVR）の絵にもタブは無い。見出しの「流入と計測へ」で戻る。
  */
  const v8NoTabs = theme === 'v8' && !tabBlocked
  return (
    <div>
      {v8NoTabs ? null : <MergedTabs basePath="/inflow-links" tabs={visibleTabs} active={tab} />}
      {tabBlocked ? (
        <FeatureDisabledScreen featureId={tabFeature} />
      ) : (
        <>
          {tab === 'links' && <InflowLinksPageInner onRouteCountChange={setLinksCount} />}
          {/* 機能状態が確定するまで SiteScript を載せない。読み込み中の
              一瞬に計測APIを呼ぶと、offのaccountで403が画面全体のゲートを
              起こしてしまう。 */}
          {tab === 'script' && visibility.status === 'ready' && (theme === 'v8' ? <SiteScriptV8 /> : <SiteScript />)}
          {tab === 'ads' && (theme === 'v8' ? <AdsV8 /> : <AdIntegration view="metrics" onPlatformCountsChange={handleAdCounts} />)}
          {tab === 'connections' && (theme === 'v8' ? adView === 'history' ? <AdHistoryV8 /> : <AdConnectionsV8 /> : <AdIntegration view={adView} onPlatformCountsChange={handleAdCounts} />)}
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
