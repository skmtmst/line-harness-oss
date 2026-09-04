'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { api, fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import KpiCard from '@/components/dashboard/kpi-card'
import { useAccount } from '@/contexts/account-context'
import type { EntryRoute, EntryRouteGenre, TrafficPool, Scenario, Tag } from '@line-crm/shared'
import EditRouteModal from './_components/edit-route-modal'
import GenreModal from './_components/create-genre-modal'
import { shouldShowReferralRow } from './visibility'
import { exportFileName, toCsv } from './inflow-export'
import { Suspense } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import AdIntegration from './ad-integration'
import SiteScript from '@/components/inflow-links/site-script'
import { TableHeadRow, Th } from '@/components/shared/table'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
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
}

interface RefSummaryData {
  routes: RefRouteStats[]
  totalFriends: number
  friendsWithRef: number
  friendsWithoutRef: number
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

function FolderIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75A1.75 1.75 0 0 1 5.5 5h4l2 2H18.5a1.75 1.75 0 0 1 1.75 1.75v8.75a1.75 1.75 0 0 1-1.75 1.75h-13a1.75 1.75 0 0 1-1.75-1.75V6.75Z" />
    </svg>
  )
}

/**
 * 並び順。**読み込んだ行から数えられるものだけ**にしてある。
 * 実流入は `/api/analytics/ref-summary` の累計で返るので、
 * 友だち追加・クリック・最新追加日は並べ替えられる。
 */
type RouteSort = 'friends-desc' | 'clicks-desc' | 'latest-desc' | 'name'

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

const MERGED_TABS = [
  { key: 'links', label: '流入経路' },
  { key: 'script', label: 'サイトスクリプト' },
  { key: 'ads', label: '広告連携' },
]

function InflowLinksPageInner() {
  const { selectedAccountId } = useAccount()
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
  // poolMembers[poolId] = lineAccountId のセット。pool_accounts を真実として
  // 「この pool が選択中アカウントに配信するか」を判定するために使う。
  // pool.activeAccountId はレガシーシングル所属。マルチアカ pool では不十分。
  const [poolMembers, setPoolMembers] = useState<Record<string, Set<string>>>({})

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
      const [r, genreRes, p, s, t, tagRes, sum, tl] = await Promise.all([
        api.entryRoutes.list(),
        // Worker と Pages の反映順に短い時間差があっても、旧 Worker に対して
        // 画面全体をエラーにしない。ジャンル一覧だけ空として既存リンクを表示する。
        api.entryRouteGenres.list().catch(() => ({
          success: false as const,
          data: [] as EntryRouteGenre[],
        })),
        api.pools.list(),
        api.scenarios.list(),
        api.messageTemplates.list(),
        api.tags.list().catch(() => ({ success: false, data: [] as Tag[] })),
        fetchApi<{ success: boolean; data: RefSummaryData }>(
          `/api/analytics/ref-summary${summaryQuery}`,
        ).catch(() => ({ success: false, data: null })),
        api.trackedLinks.list().catch(() => ({ success: false, data: null })),
      ])
      if (!isCurrent()) return
      if (r.success) setRoutes(r.data)
      else setLoadFailed(true)
      if (genreRes.success) setGenres(genreRes.data)
      if (p.success) setPools(p.data)
      if (s.success) setScenarios(s.data)
      if (t.success) setTemplates(t.data)
      if (tagRes.success) setTags(tagRes.data)
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

      // Load pool→accounts mapping after we know the pool list. Done in a 2nd
      // round-trip so the table can render with summary stats immediately; the
      // filter just doesn't apply the pool-membership rule until this resolves
      // (zero-inflow rows still pass through friendCount > 0 path).
      if (p.success) {
        const entries = await Promise.all(
          p.data.map(async (pool) => {
            const res = await api.pools.accounts.list(pool.id)
            const ids = res.success
              ? new Set(res.data.filter((a) => a.isActive).map((a) => a.lineAccountId))
              : new Set<string>()
            return [pool.id, ids] as const
          }),
        )
        if (!isCurrent()) return
        setPoolMembers(Object.fromEntries(entries))
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
    setEditing(null)
    setQrRoute(null)
    setPage(1)
    void load()
    // サイドバー側でアカウントを切り替えたら、開きっぱなしの「ref 詳細」も
    // 持ち越さない (アカ A の友だちリストがアカ B の同じ ref 行に残ってしまう
    // クロスアカウントの情報漏れ防止)。stale-response guard だけでは閉じる側を
    // 担保できないので明示的に reset する。
    setExpandedRef(null)
    setRefDetail(null)
    setRefDetailLoading(false)
    return () => {
      loadRequestRef.current += 1
    }
  }, [selectedAccountId])

  const onCopy = async (refCode: string, id: string) => {
    const url = referralUrl(refCode)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1200)
    } catch {
      // silent
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
      setExpandedRef(null)
      setRefDetail(null)
      setRefDetailLoading(false)
      return
    }
    setExpandedRef(refCode)
    setRefDetail(null)
    setRefDetailLoading(true)
    const requestedFor = refCode
    const accountAtRequest = selectedAccountId
    const query = accountAtRequest ? `?lineAccountId=${accountAtRequest}` : ''
    const res = await fetchApi<{ success: boolean; data: RefDetail }>(
      `/api/analytics/ref/${encodeURIComponent(refCode)}${query}`,
    ).catch(() => ({ success: false, data: null }))
    // Skip stale updates: only commit if we are still looking at the same
    // ref AND the sidebar account hasn't changed since the request started.
    setExpandedRef((current) => {
      if (current !== requestedFor || accountAtRequest !== selectedAccountId) return current
      if ('success' in res && res.success && res.data) setRefDetail(res.data)
      setRefDetailLoading(false)
      return current
    })
  }

  // Index summary stats by ref_code for cheap lookup per row.
  const statsByRef = new Map<string, RefRouteStats>()
  summary?.routes?.forEach((r) => statsByRef.set(r.refCode, r))

  // Merge entry_routes (CRUD 対象), tracked_links (modern path), と
  // summary.routes (実流入のあった refs)。優先順位 = worker の applyRefAttribution
  // と同じ: entry_routes → tracked_links → orphan。
  //
  // tracked_links は entry_routes と別テーブルで管理されている。Worker は両方を
  // フォールバック検索するので tracked_links 登録済み ref も「設定済み」扱いに
  // すべき (Pool は仕様上持たないため "—" 表示)。これがないと「(未登録)」と
  // 表示されるが裏では tracked_links のシナリオが発火している、という UI の嘘
  // になる。
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
  const rowsByRef = new Map<string, Row>()
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
    rowsByRef.set(r.refCode, {
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
    if (rowsByRef.has(tl.id)) continue // entry_routes が優先
    // /inflow-links は「友だち獲得経路」のページ。tracked_links は /t/:id クリック
    // 計測用にも大量に作られるので、実際に友だちの ref_code に焼かれたもの
    // (= summary に出現するもの) のみ表示する。それ以外は無関係なノイズ。
    if (!statsByRef.has(tl.id)) continue
    // worker の applyRefAttribution は isActive=false の tracked_link を skip する
    // ので UI も合わせて非表示。これがないと「Tracked Link 登録済み」緑バッジ +
    // シナリオ名が出ているのにシナリオが流れない、という嘘になる。inactive で
    // 実流入だけある ref は orphan 行 (「未登録」アンバー) として正しく表示される。
    if (!tl.isActive) continue
    rowsByRef.set(tl.id, {
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
    if (rowsByRef.has(s.refCode)) continue
    rowsByRef.set(s.refCode, {
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
  const allRows = Array.from(rowsByRef.values())
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
      ...availableGenres.map((genre) => genre.name),
      ...(hasUncategorized ? [UNCATEGORIZED] : []),
    ]
    setSelectedGenre((current) => selectable.includes(current) ? current : (selectable[0] ?? ''))
  }, [availableGenres, hasUncategorized])

  const selectedGenreLabel = selectedGenre === UNCATEGORIZED ? '未分類' : selectedGenre
  const genreRows = selectedGenre === UNCATEGORIZED
    ? accountFilteredRows.filter((row) => !row.genre)
    : accountFilteredRows.filter((row) => row.genre === selectedGenre)
  const normalizedSearch = search.trim().toLocaleLowerCase('ja')
  const filteredRows = normalizedSearch
    ? genreRows.filter((row) =>
        row.name.toLocaleLowerCase('ja').includes(normalizedSearch)
        || row.refCode.toLocaleLowerCase('ja').includes(normalizedSearch))
    : genreRows
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
  // 絞り込みでページ数が縮んだら、開いているページを最後のページへ寄せる。
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])
  const genreOptions = availableGenres.map((genre) => genre.name)

  const formatDate = (iso: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  // 設計のKPI。stats は期間を受け取らないので、出せるのは累計だけ。
  // 「稼働中」は登録済みの行。orphan（外部が発行した未登録 ref）は流入実績が
  // あるだけで、こちらから止める・直すができないので数に入れない。
  // 帯は画面全体の要約なので、**フォルダの選択や検索文字で数が変わってはいけない。**
  // ここを `sortedRows`（フォルダ＋検索で絞ったもの）から数えていたため、
  // フォルダ列が「SNS 2／未分類 1」と出ている横で帯が「流入元 0件」になっていた。
  // フォルダ列の件数は `accountFilteredRows` から数えている（下の `:genreCount`）ので、
  // 同じ画面の中で数え方が2通りある状態だった。帯もそちらに揃える。
  const accountRouteCount = accountFilteredRows.length
  const activeRouteCount = accountFilteredRows.filter((r) => r.source !== 'orphan').length
  /*
    **読み込めていないときに0件と書かない。**

    一覧側は読込中・空・取得失敗を3つに言い分けているのに、帯だけが
    `sortedRows.length` をそのまま出していた。取得に失敗すると配列は空なので、
    **登録した流入元が1つも無いように読める。** 設計 `BMmxU` の主題は
    「空・読込・エラーを混ぜない」なので、帯も同じ扱いにする。
  */
  const routeCountAvailable = !loading && !loadFailed
  const totalClicks = sortedRows.reduce((sum, r) => sum + (r.stats?.clickCount ?? 0), 0)
  const totalFriends = sortedRows.reduce((sum, r) => sum + (r.stats?.friendCount ?? 0), 0)
  const addRate = summaryAvailable && totalClicks > 0
    ? Math.round((totalFriends / totalClicks) * 100)
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
    link.download = exportFileName(sortedRows.length, new Date().toISOString().slice(0, 10))
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div data-design="Head">
        <Header
          title="流入と計測"
          description="どこから友だちが来たかを計測します。発行したURLごとにクリック・友だち追加・その後の成果まで追えます。"
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                disabled
                title="マニュアルは準備中です"
              >
                マニュアル
              </Button>
              <Button
                disabled
                title="並び替えは準備中です"
              >
                並び替え
              </Button>
              <Button
                onClick={() => setEditingGenre('new')}
              >
                フォルダを追加
              </Button>
              <Button
                href="/inflow-links/new"
                variant="primary"
              >
                URLを発行
              </Button>
            </div>
          }
        />
      </div>

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="流入元"
          value={routeCountAvailable ? accountRouteCount : null}
          unit="件"
          detail={
            routeCountAvailable
              ? `稼働中 ${activeRouteCount}`
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
          detail={summaryAvailable ? '累計' : '取得できません'}
        />
        <KpiCard
          title="平均の追加率"
          value={addRate}
          unit="%"
          detail="クリックのうち"
        />
      </div>

      {/*
        設計の帯。**なぜこの画面が要るのか**を先に書く。
        「友だち追加」だけでは経路が分からないことを知らないと、
        ここで発行したURLを通さずに配って、あとから数が合わないことになる。
      */}
      <p className="bg-info-bg text-ink-secondary rounded-card mb-4 px-4 py-3 text-xs leading-relaxed">
        LINEの「友だち追加」だけでは、その人がどこから来たのかは分かりません。
        ここで発行したURLをいったん通ってもらうことで、はじめて経路が分かります。QRコードも同じURLから作れます。
      </p>

      <div className="grid gap-5 2xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside>
          <button
            onClick={() => setEditingGenre('new')}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-deep px-4 py-3 text-sm font-bold text-on-accent shadow-sm hover:brightness-92"
          >
            <span className="text-xl leading-none">＋</span>
            フォルダを追加
          </button>
          <div className="mt-3 overflow-hidden rounded-xl border border-hairline bg-canvas shadow-sm">
            <div className="border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-bold text-ink">フォルダ</h2>
              <p className="mt-0.5 text-xs text-ink-faint">選ぶと右側のリンクが切り替わります</p>
            </div>
            {availableGenres.length === 0 && !hasUncategorized ? (
              <button
                onClick={() => setEditingGenre('new')}
                className="w-full px-4 py-8 text-center text-sm text-ink-faint hover:bg-canvas-sunken"
              >
                最初のフォルダを作ってください
              </button>
            ) : (
              <div className="divide-y divide-hairline">
                {availableGenres.map((genre) => {
                  const count = accountFilteredRows.filter((row) => row.genre === genre.name).length
                  const active = selectedGenre === genre.name
                  return (
                    <div
                      key={genre.id}
                      className={`flex items-center transition ${active ? 'bg-v6-accent-soft text-v6-accent-hover' : 'text-ink-secondary hover:bg-canvas-sunken'}`}
                    >
                      <button
                        onClick={() => setSelectedGenre(genre.name)}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <FolderIcon className={`h-5 w-5 shrink-0 ${active ? 'text-v6-accent' : 'text-ink-faint'}`} />
                          <span className="truncate text-sm font-semibold">{genre.name}</span>
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-v6-accent-soft text-v6-accent-hover' : 'bg-canvas-sunken text-ink-faint'}`}>{count}</span>
                      </button>
                      {!genre.id.startsWith('legacy-') && (
                        <button
                          onClick={() => setEditingGenre(genre)}
                          className="mr-2 rounded-md px-2 py-1 text-xs font-medium text-ink-faint hover:bg-canvas hover:text-v6-action"
                          aria-label={`${genre.name}を編集`}
                        >
                          編集
                        </button>
                      )}
                    </div>
                  )
                })}
                {hasUncategorized && (
                  <button
                    onClick={() => setSelectedGenre(UNCATEGORIZED)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition ${selectedGenre === UNCATEGORIZED ? 'bg-v6-warning-bg text-v6-warning' : 'text-ink-secondary hover:bg-canvas-sunken'}`}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <FolderIcon className="h-5 w-5 shrink-0" />
                      未分類
                    </span>
                    <span className="rounded-full bg-canvas-sunken px-2 py-0.5 text-xs text-ink-faint">
                      {accountFilteredRows.filter((row) => !row.genre).length}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>

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
                placeholder="流入元名で検索"
                aria-label="流入元名で検索"
                className="w-full sm:w-64"
              />
              <Select
                aria-label="並び順"
                label="並び順"
                value={sort}
                options={SORT_OPTIONS}
                onChange={(value) => {
                  setSort(value as RouteSort)
                  setPage(1)
                }}
              />
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
              <Button
                onClick={() => setEditing('new')}
                variant="primary"
                disabled={!selectedGenre || selectedGenre === UNCATEGORIZED}
                title={selectedGenre === UNCATEGORIZED ? '先に左側でフォルダを選んでください' : undefined}
              >
                ＋ このフォルダにURLを発行
              </Button>
              {/*
                **画面に出ている行をそのまま書き出す。** 絞り込みや並び替えを
                無視して全件を出すと、画面と手元のファイルが食い違う。
              */}
              <Button onClick={exportCurrentRows} disabled={sortedRows.length === 0}>
                CSVで書き出す
              </Button>
            </div>
          </div>

          {/*
            **保存した条件は札を作らない。**
            設計には「よく使う」「今月分」など4つの札が描いてあるが、
            条件を保存する口が無い。作り物の札を押せない形で置くと、
            「保存したのに効かない」と読める。無いことを言葉で出す。
          */}
          <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-ink-faint text-xs whitespace-nowrap">保存した条件</span>
            <Chip tone="neutral">—</Chip>
            <span className="text-ink-faint text-xs">
              まだ繋がっていません。条件の保存が接続されると表示されます。
            </span>
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
              ? '「このフォルダにURLを発行」から作ると、ここに出ます。'
              : '左側の「フォルダを追加」から最初のフォルダを作ってください。'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-hairline bg-canvas">
          <table className="w-full table-fixed text-xs">
            <colgroup>
              <col className="w-[11%]" />
              <col className="w-[10%]" />
              <col className="w-[9%]" />
              <col className="w-[16%]" />
              <col className="w-[10%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
              <col className="w-[9%]" />
              <col className="w-[10%]" />
              <col className="w-[7%]" />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th>
                  流入元名
                </Th>
                <Th>
                  REF
                </Th>
                <Th>
                  Pool
                </Th>
                <Th>
                  シナリオ
                </Th>
                <Th>
                  自動付与
                </Th>
                <Th>
                  モード
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
                  >
                    <td className="px-2 py-3 font-medium text-ink">
                      {r.source === 'entry_route' && r.entryRouteId ? (
                        <Link
                          href={`/inflow-links/detail?id=${r.entryRouteId}`}
                          className="block truncate whitespace-nowrap text-v6-action hover:underline"
                          onClick={(e) => e.stopPropagation()}
                          title={r.name}
                        >
                          {r.name}
                        </Link>
                      ) : r.source === 'tracked_link' ? (
                        <span className="flex min-w-0 items-center gap-1 text-ink-secondary" title={r.name}>
                          <span className="truncate whitespace-nowrap">{r.name}</span>
                          <span
                            className="shrink-0 rounded border border-v6-accent-border bg-v6-accent-soft px-1 py-0.5 text-[9px] text-v6-accent-hover"
                            title="tracked_links 登録済み — クリック計測 + シナリオ起動が設定されています。Pool 振り分けは持ちません。"
                          >
                            計測済
                          </span>
                        </span>
                      ) : (
                        <span className="flex min-w-0 items-center gap-1 text-ink-secondary" title={r.name}>
                          <span className="truncate whitespace-nowrap">{r.name}</span>
                          <span
                            className="shrink-0 rounded border border-v6-warning-bg bg-v6-warning-bg px-1 py-0.5 text-[9px] text-v6-warning"
                            title="entry_routes / tracked_links いずれにも未登録 — X Harness など外部システムが発行した ref。流入実績のみ集計。"
                          >
                            未登録
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3 font-mono text-v6-action" title={r.refCode}>
                      <span className="block truncate whitespace-nowrap">{r.refCode}</span>
                    </td>
                    <td className="px-2 py-3 text-ink-secondary">
                      {pool ? (
                        <span className="block truncate whitespace-nowrap" title={pool.name}>{pool.name}</span>
                      ) : r.source === 'tracked_link' ? (
                        <span
                          className="text-ink-faint"
                          title="tracked_links は Pool 振り分けを持ちません (グローバルデフォルトに従う)。"
                        >
                          —
                        </span>
                      ) : (
                        <span
                          className="text-ink-faint"
                          title="DB に pool_id 未設定。実行時は URL クエリ ?pool= で振り分けられている可能性あり。"
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
                      {summaryAvailable ? (r.stats?.friendCount ?? 0) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-right text-ink-secondary">
                      {summaryAvailable ? (r.stats?.clickCount ?? 0) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-ink-faint">
                      {summaryAvailable ? formatDate(r.stats?.latestAt ?? null) : '—'}
                    </td>
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <button
                          onClick={() => onCopy(r.refCode, r.refCode)}
                          className="text-[11px] font-medium text-v6-action hover:underline"
                          aria-label={`${r.name}のURLをコピー`}
                        >
                          {copiedId === r.refCode ? '済み' : 'コピー'}
                        </button>
                        <button
                          onClick={() => setQrRoute({ refCode: r.refCode, name: r.name, genre: r.genre })}
                          className="text-[11px] font-medium text-v6-accent-hover hover:underline"
                          aria-label={`${r.name}のQRコードを表示`}
                        >
                          QR
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {editTarget ? (
                        <button
                          onClick={() => setEditing(editTarget)}
                          className="whitespace-nowrap rounded-md border border-hairline bg-v6-action-soft px-2 py-1 text-[11px] font-medium text-v6-action hover:bg-v6-surface"
                          aria-label={`${r.name}のリンクを編集`}
                        >
                          編集
                        </button>
                      ) : r.source === 'tracked_link' ? (
                        // tracked_links は別管理 (Web app に編集 UI 未提供)。
                        // entry_routes への "昇格登録" は worker 優先順位的に
                        // tracked_link を上書きすることになり混乱の元なので、
                        // ここではアクション非表示にして tracked_links 側の
                        // 編集導線 (MCP / API) に委ねる。
                        <span className="text-xs text-ink-faint">—</span>
                      ) : (
                        <button
                          onClick={() => setEditing({ register: r.refCode })}
                          className="text-xs text-v6-action hover:underline"
                          title="未登録 ref を entry_routes に登録します。流入実績はそのまま引き継がれます。"
                        >
                          登録
                        </button>
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
  children,
}: {
  isExpanded: boolean
  onToggle: () => void
  refDetailLoading: boolean
  refDetail: RefDetail | null
  refCode: string
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
          <td colSpan={11} className="px-6 py-4 bg-canvas-sunken border-t border-hairline">
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
                      className="flex items-center justify-between bg-canvas rounded-lg px-3 py-2 border border-hairline hover:border-v6-action"
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
            <p className="text-xs font-medium text-v6-accent-hover">リファラルリンク・QRコード</p>
            <h2 className="mt-1 text-lg font-bold text-ink">{route.name}</h2>
            <p className="mt-1 text-sm text-ink-faint">{route.genre ?? '未分類'}</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-ink-faint" aria-label="閉じる">×</button>
        </div>
        <div className="mt-5 rounded-xl bg-canvas-sunken p-3">
          <p className="break-all font-mono text-xs text-ink-secondary">{url}</p>
          <button onClick={copy} className="mt-3 w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm font-medium text-v6-action">
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

function InflowLinksPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  return (
    <div>
      <MergedTabs basePath="/inflow-links" tabs={MERGED_TABS} active={tab} />
      {tab === 'links' && <InflowLinksPageInner />}
      {tab === 'script' && <SiteScript />}
      {tab === 'ads' && <AdIntegration />}
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
