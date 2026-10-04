'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Bookmark, Megaphone, SlidersHorizontal } from 'lucide-react'
import type { Scenario, Tag } from '@line-crm/shared'
import { api, ApiError, fetchApi, type FriendListItem, type SupportMarkListItem } from '@/lib/api'
import FriendKpis from '@/components/friends/friend-kpis'
import FriendListTable from '@/components/friends/friend-list-table'
import AdvancedSearchDialog, { type AdvancedSearchResult } from '@/components/friends/advanced-search-dialog'
import SingleFriendActions from '@/components/friends/single-friend-actions'
import NoticeDialog from '@/components/friends/notice-dialog'
import SavedSearchDialog from '@/components/friends/saved-search-dialog'
import { useAccount } from '@/contexts/account-context'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { loadOperators } from '@/lib/operators-cache'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import DuplicatesPage from '@/app/duplicates/page'
import MergedUsersPage from '@/app/users/page'
import { EmbeddedPageProvider } from '@/components/layout/embedded-page-context'
import Button from '@/components/shared/button'
import BulkBar from '@/components/shared/bulk-bar'
import Chip from '@/components/shared/chip'
import FilterChip from '@/components/shared/filter-chip'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { emptyMessageOf } from './friend-list-empty'
import { csvExportLine } from './csv-export'
import BulkRunDialog from '@/components/friends/bulk-run-dialog'
import { canRunBulk } from '@/components/friends/bulk-run-view'
import { FRIENDS_MERGED_TABS } from './friends-tabs'
import { FriendsListHeadV8 } from './friends-nav-v8'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { buildBroadcastHandoff } from '@/lib/friends-broadcast-condition'
import { readFriendsListSnapshot, writeFriendsListSnapshot } from './list-state'
import { conditionsToEditorState, savedSearchParams, savedSearchSummary } from '@/components/friends/saved-search-utils'
const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const
/*
  検索行の副操作は設計 `PhxG6` で高さ38px。共通Buttonは36pxなので当てない
  （共通Buttonは設計と一致済みで、こちらへ寄せると他画面が動く）。
  幅は設計の実寸：詳細条件110 / 保存した検索130 / 検索70。
*/
const SEARCH_ROW_SECONDARY = 'inline-flex v7:h-9.5 v8:h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control border border-hairline bg-canvas text-label font-semibold text-ink hover:bg-canvas-sunken'

type SortMode = 'recent' | 'oldest'
type ResponseFilter = 'all' | 'unhandled'
type Notice = { title: string; message: string } | null
type LoadStatus = 'loading' | 'ready' | 'error'

function scoreBoundary(raw: string | null) {
  if (raw === null || !/^-?\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

/*
 * #984 LAY-14: 主タブの定義は friends-tabs.ts が正本。
 * UID移行（/accounts?tab=migration）側も同じ一覧・同じ部品を使う。
 */
const MERGED_TABS = FRIENDS_MERGED_TABS

function FriendsPageInner({
  onNotice,
  onExportReady,
}: {
  onNotice: (notice: Notice) => void
  onExportReady: (exporter: (() => void) | null) => void
}) {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  /*
    保存した検索・対応マークは任意機能。オフのaccountではAPIを呼ばず、
    入口も出さない（呼ぶと 403 で画面全体が共通ゲートへ切り替わる）。
    読み込み中・失敗は fail-closed で隠す（サイドバーと同じ）。
  */
  const featureVisibility = useFeatureVisibility(selectedAccountId)
  const marksEnabled = featureVisibility.enabled('support_marks')
  const savedSearchEnabled = featureVisibility.enabled('saved_searches')
  /* 一括操作はオーナーと管理者だけ。個別操作の権限を越えるため。 */
  const [bulkOpen, setBulkOpen] = useState(false)
  /*
   * R115: できるかは入り直した本人の役割（`api.staff.me()`）で決める。
   * 選んでいるLINEアカウントの「役割メモ」（`selectedAccount.role`）は
   * 自由記述のメモで、ログイン担当者の権限ではない。そちらで判定すると、
   * 権限のある管理者が一括操作を始められなくなる。
   * 確認が終わるまで（staffRole === null）は押し口も理由も出さない。
   */
  const [staffRole, setStaffRole] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        setStaffRole(response.data.role)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  const searchParams = useSearchParams()
  const scoreMin = scoreBoundary(searchParams.get('scoreMin'))
  const scoreMax = scoreBoundary(searchParams.get('scoreMax'))
  const hasScoreRange = scoreMin !== undefined || scoreMax !== undefined
  // R300: 行動スコアの帯からの引き継ぎは「点数がついている人」だけ。未採点の0点を除く。
  const scoredOnly = searchParams.get('scoredOnly') === '1'
  const audienceId = searchParams.get('audienceId')?.trim() || ''
  const directSavedSearchId = searchParams.get('savedSearch')
  /* タグ一覧の人数リンクからの受け口（/friends?tag=…）。 */
  const directTagId = (searchParams.get('tag') ?? '').trim()
  /*
   * ★V8：上の帯の探す欄からの受け口（`/friends?q=…`）。URL に語が
   * あれば最初からその言葉で絞る。保存してある一覧の状態では
   * 上書きしない（明示の指示を優先）。
   */
  const directQuery = (searchParams.get('q') ?? '').trim()
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [marks, setMarks] = useState<SupportMarkListItem[]>([])
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [advanced, setAdvanced] = useState<AdvancedSearchResult | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20)
  const [selectedTagId, setSelectedTagId] = useState(directTagId)
  const [searchInput, setSearchInput] = useState(directQuery)
  const [searchSubmitted, setSearchSubmitted] = useState(directQuery)
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all')
  const [operatorId, setOperatorId] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  /*
   * 読み直し中（★V7 sTJsh §2）。行が出ているあとの再取得では
   * 一覧を消さず、表を薄めて上に線の帯を出す。
   */
  const [refreshing, setRefreshing] = useState(false)
  const hasRowsRef = useRef(false)
  const [optionsFailed, setOptionsFailed] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectedFriendIds = useMemo(() => [...selectedIds], [selectedIds])
  const loadRequestRef = useRef(0)
  /*
   * 応答が「どのアカウント・どのページのものか」を照合する現在値。
   * 要求IDだけでは同じ並びで発行した別対象の応答を区別できない。
   * 切替直後に遅れて届いた別アカウント・別ページの応答を捨てる(#964)。
   * 描画のたびに同期する(chats画面の listFilterKeyRef と同じ型)。
   */
  const loadContextRef = useRef({ accountId: selectedAccountId, page, pageSize })
  loadContextRef.current = { accountId: selectedAccountId, page, pageSize }
  hasRowsRef.current = friends.length > 0

  /*
   * IDEA-03「3ページ以上の移動と戻る操作で条件・位置を保持」。
   * 一覧 → 詳細 → 戻る で React 状態は消えるので、絞り込みとページを
   * sessionStorage へ写し、戻ってきた mount で復元する。
   * URL 直指定の絞り込み（?scoreMin= ?audienceId= ?savedSearch= ?tag=）が
   * あるときはそちらを優先し、保存値で上書きしない。
   */
  const restoredRef = useRef(false)
  const [restored, setRestored] = useState(false)
  const hasExplicitUrlFilters = hasScoreRange || audienceId !== '' || Boolean(directSavedSearchId) || directTagId !== '' || directQuery !== ''
  useEffect(() => {
    if (restoredRef.current || accountLoading) return
    restoredRef.current = true
    if (!hasExplicitUrlFilters && selectedAccountId) {
      const snapshot = readFriendsListSnapshot(selectedAccountId)
      if (snapshot) {
        setSearchInput(snapshot.searchInput)
        setSearchSubmitted(snapshot.searchSubmitted)
        setSelectedTagId(snapshot.selectedTagId)
        setResponseFilter(snapshot.responseFilter)
        setOperatorId(snapshot.operatorId)
        setScenarioId(snapshot.scenarioId)
        setAttentionOnly(snapshot.attentionOnly)
        setSortMode(snapshot.sortMode)
        setPageSize(snapshot.pageSize as (typeof PAGE_SIZE_OPTIONS)[number])
        setPage(snapshot.page)
        setAdvanced(snapshot.advanced)
      }
    }
    setRestored(true)
  }, [accountLoading, selectedAccountId, hasExplicitUrlFilters])

  useEffect(() => {
    if (!restored || !selectedAccountId) return
    writeFriendsListSnapshot(selectedAccountId, {
      searchInput,
      searchSubmitted,
      selectedTagId,
      responseFilter,
      operatorId,
      scenarioId,
      attentionOnly,
      sortMode,
      page,
      pageSize,
      advanced,
    })
  }, [restored, selectedAccountId, searchInput, searchSubmitted, selectedTagId, responseFilter, operatorId, scenarioId, attentionOnly, sortMode, page, pageSize, advanced])

  /*
    **URLから来る絞り込みも数える。** 行動スコアの「この帯の人を見る」は
    `?scoreMin=` で開く。数え落とすと、その帯に誰もいないときに
    「まだ友だちがいません」と出て、絞り込んだ結果だと分からなくなる。
  */
  const emptyMessage = emptyMessageOf({
    search: searchSubmitted,
    tagId: selectedTagId,
    advanced: advanced !== null,
    others: responseFilter !== 'all'
      || operatorId !== ''
      || scenarioId !== ''
      || attentionOnly
      || hasScoreRange
      || audienceId !== '',
  })

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  /*
   * IDEA-03「検索から配信等へ進むときは対象条件を引き継ぐ」。
   * 条件そのものを配信作成へ渡し、人数は配信側が最新の友だちへ
   * 再評価する（表示中の友だちのID一覧を対象にはしない）。
   * 引き継げない条件が混ざるときは出さない（対象が広がって誤配信になる）。
   */
  const broadcastHandoff = useMemo(
    () =>
      buildBroadcastHandoff({
        searchSubmitted,
        selectedTagId,
        responseFilter,
        operatorId,
        scenarioId,
        attentionOnly,
        scoreMin,
        scoreMax,
        scoredOnly,
        audienceId,
        advanced,
      }),
    [searchSubmitted, selectedTagId, responseFilter, operatorId, scenarioId, attentionOnly, scoreMin, scoreMax, scoredOnly, audienceId, advanced],
  )
  const broadcastHandoffHref =
    broadcastHandoff.kind === 'ready' && canRunBulk(staffRole)
      ? `/broadcasts/new?condition=${encodeURIComponent(JSON.stringify(broadcastHandoff.condition))}`
      : null

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const loadOptions = useCallback(async () => {
    // 要求が向かったアカウントを固定する(#964)。シナリオ・対応マークの
    // 候補はアカウントごとの中身なので、切替後に届いた前のアカウントの
    // 応答で絞り込みの選択肢を上書きしない。
    const requestedAccountId = selectedAccountId
    try {
      const [tagResponse, operatorResponse, scenarioResponse] = await Promise.all([
        // R23横展開: タグ候補も今のアカウントだけ（絞り込みの選択肢混入防止）。
        api.tags.list(requestedAccountId ? { accountId: requestedAccountId } : undefined),
        // 友だち詳細の対応編集と同じ名簿を共有する。保存の可否はサーバ側。
        loadOperators(),
        api.scenarios.list(requestedAccountId ? { accountId: requestedAccountId } : undefined),
      ])
      if (loadContextRef.current.accountId !== requestedAccountId) return
      if (tagResponse.success) setAllTags(tagResponse.data)
      if (operatorResponse.success) setOperators(operatorResponse.data)
      if (scenarioResponse.success) setScenarios(scenarioResponse.data)
      setOptionsFailed(false)
    } catch {
      // 選択肢の取得に失敗しても、友だち一覧と検索は使える。
      // ただし「タグがない」と「取れなかった」の区別が付くよう一言出す(#496-19)。
      setOptionsFailed(true)
    }
  }, [selectedAccountId])

  /*
   * 対応マークの候補だけは別に取る（V6R-S1-b）。
   *
   * 以前は上の選択肢と同じ Promise.all に入れ、依存に marksEnabled を持っていた。
   * 対応マークの有効は表示可否が届いてから分かるので、届いた瞬間にタグ・担当者・
   * シナリオまで取り直していた（検証環境の実測で3本が2回ずつ）。
   */
  const loadMarks = useCallback(async () => {
    const requestedAccountId = selectedAccountId
    if (!requestedAccountId || !marksEnabled) {
      setMarks([])
      return
    }
    try {
      const markResponse = await api.supportMarks.list(requestedAccountId, { suppressFeatureDisabledEvent: true })
      if (loadContextRef.current.accountId !== requestedAccountId) return
      if (markResponse.success) setMarks(markResponse.data)
    } catch {
      // 上の選択肢と同じく、取れなかったことだけを一言出す(#496-19)。
      setOptionsFailed(true)
    }
  }, [selectedAccountId, marksEnabled])

  const loadFriends = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    // 要求が向かった対象を固定する。応答時に現在値と照合し、
    // 別アカウント・別ページへ切り替わったあとの遅い応答は捨てる(#964)。
    const requestedAccountId = selectedAccountId
    const requestedPage = page
    const requestedPageSize = pageSize
    /*
     * 前の一覧を残したまま読み直す（★V7 sTJsh §2）。すでに行が出て
     * いるときは消さず薄めるだけにし、件数・ページ番号も新しい答えが
     * 来るまで前のままにする。行が無いとき（初回・失敗あと）は
     * 従来どおり読み込みの1枚を出す。
     */
    if (hasRowsRef.current) {
      setRefreshing(true)
    } else {
      setLoadStatus('loading')
      setFriends([])
      setTotal(0)
    }
    setBulkOpen(false)
    setSelectedIds(new Set())
    try {
      const response = await api.friends.list({
        ...(advanced?.params ?? {}),
        offset: String((page - 1) * pageSize),
        limit: pageSize,
        tagId: selectedTagId || undefined,
        accountId: selectedAccountId || undefined,
        audienceId: audienceId || undefined,
        search: searchSubmitted || undefined,
        includeChatStatus: true,
        sort: sortMode,
        handled: responseFilter === 'unhandled' ? 'unhandled' : undefined,
        operatorId: operatorId || undefined,
        scenarioId: scenarioId || undefined,
        metadata: attentionOnly ? { __attention: '1' } : undefined,
        scoreMin,
        scoreMax,
        scoredOnly: scoredOnly || undefined,
      })
      if (requestId !== loadRequestRef.current) return
      const context = loadContextRef.current
      if (context.accountId !== requestedAccountId
        || context.page !== requestedPage
        || context.pageSize !== requestedPageSize) return
      if (response.success) {
        setFriends(response.data.items)
        setTotal(response.data.total)
        setSelectedIds(new Set())
        setLoadStatus('ready')
        setRefreshing(false)
      } else {
        setFriends([])
        setTotal(0)
        setLoadStatus('error')
        setRefreshing(false)
      }
    } catch {
      if (requestId !== loadRequestRef.current) return
      const context = loadContextRef.current
      if (context.accountId !== requestedAccountId
        || context.page !== requestedPage
        || context.pageSize !== requestedPageSize) return
      setFriends([])
      setTotal(0)
      setLoadStatus('error')
      setRefreshing(false)
    }
  }, [advanced, attentionOnly, audienceId, operatorId, page, pageSize, responseFilter, scenarioId, scoreMax, scoreMin, scoredOnly, searchSubmitted, selectedAccountId, selectedTagId, sortMode])

  useEffect(() => void loadOptions(), [loadOptions])
  /*
   * タグの付け外しは押した瞬間に一覧へ反映する（★V7 sTJsh §1）。
   * 返す関数を呼ぶと変更前の並びへ戻る（元に戻す・失敗時の復元用）。
   */
  const applyFriendTags = useCallback((friendId: string, next: Tag[]) => {
    const previous = friends.find((friend) => friend.id === friendId)?.tags ?? []
    setFriends((current) =>
      current.map((friend) => (friend.id === friendId ? { ...friend, tags: next } : friend)),
    )
    return () => {
      setFriends((current) =>
        current.map((friend) => (friend.id === friendId ? { ...friend, tags: previous } : friend)),
      )
    }
  }, [friends])

  useEffect(() => void loadMarks(), [loadMarks])
  useEffect(() => setPage(1), [selectedAccountId])
  useEffect(() => {
    // 保存した検索がオフのaccountでは ?savedSearch= 直URLも適用しない。
    if (!directSavedSearchId || !savedSearchEnabled || !selectedAccountId) return
    /*
     * R187: 直URLでも保存した並び順・表示件数を使う。IDだけ渡すと
     * 新しい順・20件に戻り、検索ダイアログからの適用と食い違う。
     * 取れなければIDだけの適用に倒し、一覧自体は止めない。
     */
    let cancelled = false
    const accountId = selectedAccountId
    const savedId = directSavedSearchId
    setAdvanced({
      params: { savedSearchId: savedId },
      summary: ['保存した検索を適用中'],
    })
    setPage(1)
    void api.savedSearches.detail(savedId, accountId).then((res) => {
      if (cancelled || !res.success) return
      const params = savedSearchParams(savedId, res.data.conditions)
      setAdvanced({
        params,
        summary: [`対象：${res.data.name}`, ...savedSearchSummary(res.data.conditions, allTags)],
        editorState: conditionsToEditorState(res.data.conditions),
      })
      if (params.sort) setSortMode(params.sort)
      if (params.limit && PAGE_SIZE_OPTIONS.includes(Number(params.limit) as (typeof PAGE_SIZE_OPTIONS)[number])) {
        setPageSize(Number(params.limit) as (typeof PAGE_SIZE_OPTIONS)[number])
      }
      setPage(1)
    }).catch(() => {})
    return () => { cancelled = true }
    /* タグ名の解決に使うため、タグ一覧の到着後にも要約を作り直す。 */
  }, [directSavedSearchId, savedSearchEnabled, selectedAccountId, allTags])
  useEffect(() => {
    // 復元を評価するまでは読まない。既定条件で一度読んでから
    // 保存条件で読み直すと、一瞬別の一覧が見えて条件を2回取る。
    if (!restored) return
    void loadFriends()
    return () => {
      loadRequestRef.current += 1
    }
  }, [loadFriends, restored])
  useEffect(() => {
    /*
     * 読み込みの間は loadFriends が total を 0 に落とすので、ここで
     * クランプを評価すると 2ページ目以降の取得中に totalPages が 1 へ
     * 下がり、勝手に1ページ目へ戻ってしまう(#979 A03-01)。
     * 範囲外ページの補正そのものは残し、応答が届いて ready になった
     * 時点でだけ行う。
     */
    if (loadStatus === 'ready' && page > totalPages) setPage(totalPages)
  }, [loadStatus, page, totalPages])

  const resetPageWith = (update: () => void) => {
    update()
    setPage(1)
  }

  const exportCurrentPage = useCallback(() => {
    const header = ['友だち名', '対応', 'シナリオ', '最新メッセージ', '流入元', '登録日']
    const rows = friends.map((friend) => [
      friend.displayName,
      friend.chatStatus === 'unread'
        ? '未対応'
        : friend.chatStatus === 'in_progress'
          ? '対応中'
          : friend.chatStatus === 'on_hold'
            ? '保留'
            : '対応済み',
      friend.activeScenario?.name ?? '',
      friend.latestIncomingMessage?.content ?? '',
      friend.firstTrackedLinkName ?? '',
      friend.createdAt.slice(0, 10),
    ])
    // 先頭 =+-@ の数式インジェクション対策つき(#496-4)。出るのは表示中のページ分だけ(#496-21)。
    const csv = [header, ...rows].map((row) => csvExportLine(row)).join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `friends-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [friends])

  useEffect(
    () => onExportReady(loadStatus === 'ready' ? exportCurrentPage : null),
    [exportCurrentPage, loadStatus, onExportReady],
  )

  const toggleAttention = useCallback(async (friend: FriendListItem) => {
    const current = String(friend.metadata?.__attention ?? '') === '1'
    try {
      // N-040(#808): 読んだ改訂値を付けて送り、競合は上書きしない。
      await fetchApi<{ success: boolean; data: unknown }>(
        `/api/friends/${friend.id}/metadata?expectedUpdatedAt=${encodeURIComponent(friend.updatedAt)}`,
        { method: 'PUT', body: JSON.stringify({ __attention: current ? null : '1' }) },
      )
      await loadFriends()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await loadFriends()
        onNotice({ title: '注目がほかの変更と重なりました', message: '最新の状態を読み直しました。確認してもう一度お試しください。' })
      } else {
        onNotice({ title: '注目の変更に失敗しました。通信を確かめて、もう一度お試しください。', message: '通信状態を確認して、もう一度お試しください。' })
      }
    }
  }, [loadFriends, onNotice])

  return (
    <div data-friends-design="v6" className="flex flex-col gap-4">
      <FriendKpis />

      {hasScoreRange ? (
        <div className="flex items-center justify-between rounded-control border border-accent-border bg-accent-soft px-4 py-2.5 text-xs text-ink-secondary">
          <span>
            行動スコア：{scoreMin !== undefined ? `${scoreMin}点以上` : ''}
            {scoreMin !== undefined && scoreMax !== undefined ? '〜' : ''}
            {scoreMax !== undefined ? `${scoreMax}点以下` : ''}
            {scoredOnly ? '（点数がついている人のみ）' : ''}
          </span>
          <Link href="/friends" className="font-semibold text-action hover:underline">この条件を外す</Link>
        </div>
      ) : null}

      <section className={`rounded-card border border-hairline bg-canvas px-4 py-3.5 shadow-card`} data-design="V6SearchPanel" data-design-node="pRHvc">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            resetPageWith(() => setSearchSubmitted(searchInput.trim()))
          }}
          /*
            #636: 768/390pxでは右端（詳細条件・保存した検索・並び順・
            検索ボタン）がviewport外へはみ出し、横スクロールしないと
            押せなかった。flex-wrap で収まらない分を次の行へ折り返す。
            1440pxでは1行に収まるので見た目は変わらない。
          */
          className="flex min-w-0 flex-wrap items-center gap-2.5"
        >
          {/*
            検索欄は共通 SearchField。★V7 `Xn1Mz`：検索は幅320・
            「保存した検索」と同じ行に置く。横いっぱいに伸ばさない。
            狭い幅では240まで縮み、入りきらない分は折り返す。
          */}
          <div className="w-80 max-w-full min-w-60 shrink-0">
            <SearchField
              className="w-full"
              aria-label="友だち名で検索"
              value={searchInput}
              onChange={(value) => {
                setSearchInput(value)
                if (!value.trim() && searchSubmitted) resetPageWith(() => setSearchSubmitted(''))
              }}
              onClear={() => {
                setSearchInput('')
                if (searchSubmitted) resetPageWith(() => setSearchSubmitted(''))
              }}
              placeholder="名前・LINE名・タグ・メモで検索"
            />
          </div>
          <button
            type="button"
            aria-pressed={advanced !== null}
            onClick={() => setAdvancedOpen(true)}
            className={`${SEARCH_ROW_SECONDARY} w-27.5 ${advanced ? 'border-accent text-accent-deep' : ''}`}
          >
            <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
            詳細条件
          </button>
          {savedSearchEnabled ? (
            <button
              type="button"
              onClick={() => setSavedOpen(true)}
              className={`${SEARCH_ROW_SECONDARY} w-32.5 text-action`}
            >
              <Bookmark aria-hidden="true" className="h-4 w-4" />
              保存した検索
            </button>
          ) : null}
          <Button variant="primary" className="v7:h-9.5 w-17.5 shrink-0 items-center justify-center whitespace-nowrap text-label v7:font-medium border-0" type="submit">検索</Button>
        </form>

        {advanced?.summary.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-control bg-accent-soft px-3 py-2">
            <span className="text-xs font-medium text-accent-deep">絞り込み中</span>
            {/* 保存条件の札は共通 Chip（設計の印：高さ17 / 文字10・700 / 丸）。 */}
            {advanced.summary.map((summary) => <Chip key={summary} tone="neutral">{summary}</Chip>)}
            <button type="button" onClick={() => resetPageWith(() => setAdvanced(null))} className="ml-auto text-xs font-medium text-action hover:underline">条件を外す</button>
          </div>
        ) : null}

        <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="shrink-0 text-sm font-semibold text-ink-secondary">絞り込み</span>
          {/*
            絞り込み4つは共通 Select（設計 h42 / r8 / 文字13・600）。
            幅は設計の実寸：タグ156 / 対応156 / 担当者176 / シナリオ184。
            共通Selectの standard は176px固定なので、size="full" で外枠に幅を持たせる。
          */}
          <div className="w-39 shrink-0" data-filter="tag">
            <Select
              aria-label="タグで絞り込む"
              size="full"
              label="タグ"
              value={selectedTagId}
              onChange={(value) => resetPageWith(() => setSelectedTagId(value))}
              options={[{ value: '', label: 'すべて' }, ...allTags.map((tag) => ({ value: tag.id, label: tag.name }))]}
            />
          </div>
          <div className="w-39 shrink-0" data-filter="response">
            <Select
              aria-label="対応状況で絞り込む"
              size="full"
              label="対応"
              value={responseFilter}
              onChange={(value) => resetPageWith(() => setResponseFilter(value as ResponseFilter))}
              options={[
                { value: 'all', label: 'すべて' },
                { value: 'unhandled', label: '未対応のみ' },
              ]}
            />
          </div>
          <div className="w-44 shrink-0" data-filter="operator">
            <Select
              aria-label="担当で絞り込む"
              size="full"
              label="担当"
              value={operatorId}
              onChange={(value) => resetPageWith(() => setOperatorId(value))}
              options={[{ value: '', label: 'すべて' }, ...operators.map((operator) => ({ value: operator.id, label: operator.name }))]}
            />
          </div>
          <div className="w-46 shrink-0" data-filter="scenario">
            <Select
              aria-label="シナリオで絞り込む"
              size="full"
              label="シナリオ"
              value={scenarioId}
              onChange={(value) => resetPageWith(() => setScenarioId(value))}
              options={[{ value: '', label: 'すべて' }, ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))]}
            />
          </div>
          <FilterChip selected={responseFilter === 'unhandled'} onChange={() => resetPageWith(() => setResponseFilter(responseFilter === 'unhandled' ? 'all' : 'unhandled'))}>
            未対応
          </FilterChip>
          <FilterChip selected={attentionOnly} onChange={() => resetPageWith(() => setAttentionOnly(!attentionOnly))}>
            注目のみ
          </FilterChip>
          {/*
            絞り込みの行の件数は出さない。一覧の見出しの横とページ送りの
            表示に同じ数があり、1画面に3回出ていた。件数はあの2か所で足りる。
          */}
          {/*
            ★V7 `Xn1Mz`：2行目の右端に並び順。#670 02 の見える見出しは残す。
            幅は現行210pxを保つ。
          */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <span className="shrink-0 text-sm font-semibold whitespace-nowrap text-ink-secondary">並び順</span>
            <div className="w-52.5 shrink-0">
              <Select
                aria-label="並び順"
                size="full"
                value={sortMode}
                onChange={(value) => resetPageWith(() => setSortMode(value as SortMode))}
                options={[
                  { value: 'recent', label: '友だち追加の新しい順' },
                  { value: 'oldest', label: '友だち追加の古い順' },
                ]}
              />
            </div>
          </div>
          {broadcastHandoffHref ? (
            <Link
              href={broadcastHandoffHref}
              data-broadcast-handoff
              className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border border-accent-border bg-accent-soft px-3 text-xs font-medium text-accent-deep hover:brightness-95"
              title="今の絞り込み条件を対象に一斉配信を作ります。人数は送信時に最新の友だちへ計算し直します。"
            >
              <Megaphone aria-hidden="true" className="h-3.5 w-3.5" />
              この条件で配信を作成
            </Link>
          ) : null}
        </div>
        {optionsFailed ? (
          <p className="mt-2 text-xs text-ink-secondary">
            絞り込みの選択肢を読み込めませんでした。タグが空なのは、取れなかっただけかもしれません。
            <button type="button" onClick={() => { void loadOptions(); void loadMarks() }} className="font-semibold text-action hover:underline">再読み込み</button>
          </p>
        ) : null}
      </section>

      <BulkRunDialog
        open={bulkOpen}
        friendIds={selectedFriendIds}
        selectedFriends={friends.filter((friend) => selectedIds.has(friend.id))}
        tags={allTags}
        accountId={selectedAccountId}
        onClose={() => setBulkOpen(false)}
        onDone={() => void loadFriends()}
      />

      <FriendListTable
          friends={friends}
          status={loadStatus}
          refreshing={refreshing}
          emptyTitle={emptyMessage.title}
          emptyDescription={emptyMessage.description}
          onRetry={() => void loadFriends()}
          total={total}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleAll={(select) => setSelectedIds(select ? new Set(friends.map((friend) => friend.id)) : new Set())}
          page={page}
          pageCount={totalPages}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={setPage}
          onPageSizeChange={(size) => resetPageWith(() => setPageSize(size as (typeof PAGE_SIZE_OPTIONS)[number]))}
          onToggleAttention={toggleAttention}
      />

      {/*
        ★V7 仕上げ §2: 一括バーは表のすぐ下に置き、1件でも選ぶと
        下端から8px上がって出る。0件で下がって消える。
      */}
      <span data-design="V4BulkBar" className="block">
        <BulkBar
          count={selectedIds.size}
          unit="人"
          hint="対象を確認してから操作を選んでください"
          below={selectedIds.size === 1 ? (
            <div className="mt-2">
              <SingleFriendActions
                friendId={[...selectedIds][0]}
                friendName={friends.find((friend) => friend.id === [...selectedIds][0])?.displayName ?? 'この友だち'}
                tags={allTags}
                accountId={selectedAccountId}
                onDone={loadFriends}
                friendTags={friends.find((friend) => friend.id === [...selectedIds][0])?.tags ?? []}
                onFriendTagsChange={(next) => applyFriendTags([...selectedIds][0], next)}
              />
            </div>
          ) : undefined}
        >
          {selectedIds.size > 1 && canRunBulk(staffRole) ? (
            <Button
              variant="secondary"
              data-qa-open="IAf7j"
              onClick={() => setBulkOpen(true)}
            >
              操作を選ぶ
            </Button>
          ) : null}
          {selectedIds.size > 1 && staffRole !== null && !canRunBulk(staffRole) ? (
            /* 権限が無いときは押し口を出さない。理由だけ書く。 */
            <span className="text-ink-faint text-xs">一括操作ができるのはオーナーと管理者だけです</span>
          ) : null}
        </BulkBar>
      </span>

      {advancedOpen ? (
        <style>{`
          [data-friends-advanced-search] > div {
            background-color: var(--color-scrim) !important;
          }
          [data-friends-advanced-search] > div > div {
            max-height: min(944px, calc(100vh - 32px)) !important;
            /* U011-U013: パネルをコンテナにして、内側の組み換えをパネル幅で切り替える。
               「内幅672px未満」= パネル幅720px（左右の余白48pxを含む）未満。 */
            container-type: inline-size;
          }
          @container (max-width: 720px) {
            /* U011: 条件ブロックを1列にする。
               「項目・比較方法・値」の縦3段化は #984 でダイアログ自身の
               コンテナクエリ（@3xl 未満で縦積み）へ移した。ここに残していた
               「div:has(> input[list=...])」は、入力が label の子なので
               実DOMには当たらない規則だった。 */
            [data-friends-advanced-search] section.grid { grid-template-columns: minmax(0, 1fr); }
            [data-friends-advanced-search] section.grid > * { grid-column: 1 / -1; }
            [data-friends-advanced-search] section.grid > button { justify-self: end; }
            /* U012: タグ選択を全幅にして「付いている／付いていない」は次の行へ。
               選んだタグは複数行に折り返して全文読めるようにする。 */
            [data-friends-advanced-search] input[aria-label="タグ名を選ぶ"] { flex: 1 1 100%; }
            [data-friends-advanced-search] span.rounded-pill:has(> button) {
              max-width: 100%;
              overflow-wrap: anywhere;
            }
            /* U013: 補助操作（読み込む・リセット・条件を保存）を上の行に残し、
               確定操作（キャンセル＋この条件で表示）を下の行に固定する。 */
            [data-friends-advanced-search] > div > div > div:last-child::before {
              content: '';
              flex-basis: 100%;
              order: 1;
              height: 0;
            }
            [data-friends-advanced-search] > div > div > div:last-child > button.ml-auto { order: 2; }
            [data-friends-advanced-search] > div > div > div:last-child > :last-child { order: 3; }
          }
        `}</style>
      ) : null}
      <div data-friends-advanced-search>
        <AdvancedSearchDialog
          open={advancedOpen}
          accountId={selectedAccountId}
          tags={allTags}
          fieldNames={[]}
          marks={marks}
          scenarios={scenarios}
          onClose={() => setAdvancedOpen(false)}
          onLoadSaved={() => {
            if (!savedSearchEnabled) return
            setAdvancedOpen(false)
            setSavedOpen(true)
          }}
          /*
           * FRIEND-04/32: 条件・並び順・件数を1つの適用結果として受け取り、
           * 一覧側の選択状態も同じ値へそろえる。ダイアログを再度開いたときは
           * 適用中の編集状態（applied.editorState）から再開する。
           */
          applied={advanced}
          initialSort={sortMode}
          initialLimit={pageSize}
          onApply={(result) => {
            setAdvanced(result)
            if (result.params.sort) setSortMode(result.params.sort)
            if (result.params.limit && PAGE_SIZE_OPTIONS.includes(Number(result.params.limit) as (typeof PAGE_SIZE_OPTIONS)[number])) {
              setPageSize(Number(result.params.limit) as (typeof PAGE_SIZE_OPTIONS)[number])
            }
            setAdvancedOpen(false)
            setPage(1)
          }}
          features={{ savedSearch: savedSearchEnabled, marks: marksEnabled, fields: featureVisibility.enabled('friend_fields') }}
        />
      </div>
      {savedOpen && savedSearchEnabled ? (
        <SavedSearchDialog
          accountId={selectedAccountId}
          tags={allTags}
          onClose={() => setSavedOpen(false)}
          onApply={(result) => {
            setAdvanced(result)
            if (result.params.sort) setSortMode(result.params.sort)
            if (result.params.limit && PAGE_SIZE_OPTIONS.includes(Number(result.params.limit) as (typeof PAGE_SIZE_OPTIONS)[number])) {
              setPageSize(Number(result.params.limit) as (typeof PAGE_SIZE_OPTIONS)[number])
            }
            setSavedOpen(false)
            setPage(1)
          }}
          onOpenAdvanced={() => {
            setSavedOpen(false)
            setAdvancedOpen(true)
          }}
        />
      ) : null}

      <div className="hidden" data-friends-v6-contract="10,20,30,40,50|compact-pagination|前へ|次へ|no-native-alert|1px-right-1px-down" />
    </div>
  )
}

function FriendsPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  const theme = useAdminTheme()
  const [notice, setNotice] = useState<Notice>(null)
  const [exportCurrentPage, setExportCurrentPage] = useState<(() => void) | null>(null)
  const registerExporter = useCallback(
    (exporter: (() => void) | null) => setExportCurrentPage(() => exporter),
    [],
  )

  /*
   * ★V8（specs/friends-data-menu.md・採用 D）：タブの段は出さず、低頻度の
   * 管理画面は右上の「データ管理 ▾」へまとめる。道筋（URL）は変えない。
   * 一覧タブは板の頭に「データ管理 ▾」（副）と「友だちを取り込む」（主）。
   * 管理画面側（重複検出・統合ユーザー）は各 -v8 ファイルが
   * 「← 友だち一覧 › データ管理 › 今の画面」の段を自分で出す。
   */
  /*
   * ★V8 `ywJ5H` 友だち一覧・`x6QsVz` 閲覧のみ。同じ画面の状態で、
   * 閲覧のみは操作が押せない形になる（切り替えの分岐は無い）。
   */
  if (theme === 'v8') {
    return (
      <div data-friends-page="v8" data-design-node="sdbsQ ywJ5H x6QsVz" className="flex flex-col gap-4">
        {tab === 'list' ? (
          <>
            <FriendsListHeadV8 onExportCurrentPage={exportCurrentPage} />
            <FriendsPageInner onNotice={setNotice} onExportReady={registerExporter} />
          </>
        ) : null}
        {tab === 'duplicates' ? <EmbeddedPageProvider><DuplicatesPage /></EmbeddedPageProvider> : null}
        {tab === 'merged' ? <EmbeddedPageProvider><MergedUsersPage /></EmbeddedPageProvider> : null}
        {notice ? <NoticeDialog notice={notice} onClose={() => setNotice(null)} /> : null}
      </div>
    )
  }

  return (
    <div data-friends-page="v6" data-design-node="PhxG6" className="flex flex-col gap-4">
      {/*
        画面名は共通トップバーだけに置く。本文側のタイトル・説明・マニュアルは
        重複させない（Pencil `PhxG6` / トップバー `cBSCb`）。
        操作は独立した見出し行にせず、タブ `JB0Ki` の右端へ置く。
      */}
      <div data-design="V6Tabs" data-design-node="JB0Ki">
        <MergedTabs
          basePath="/friends"
          paramName="tab"
          tabs={MERGED_TABS}
          active={tab}
          actions={(
            <div className="flex flex-wrap items-center justify-end gap-2">
              {tab === 'list' ? <Button variant="secondary" className="v7:h-9.5 v7:px-4 text-ink-secondary disabled:text-ink-disabled whitespace-normal" type="button" onClick={() => exportCurrentPage?.()} disabled={!exportCurrentPage}>表示中をCSVで書き出す</Button> : null}
            </div>
          )}
        />
      </div>
      {tab === 'list' ? <FriendsPageInner onNotice={setNotice} onExportReady={registerExporter} /> : null}
      {tab === 'duplicates' ? <EmbeddedPageProvider><DuplicatesPage /></EmbeddedPageProvider> : null}
      {tab === 'merged' ? <EmbeddedPageProvider><MergedUsersPage /></EmbeddedPageProvider> : null}
      {notice ? <NoticeDialog notice={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  )
}

export default function FriendsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}>
      <FriendsPageHost />
    </Suspense>
  )
}
