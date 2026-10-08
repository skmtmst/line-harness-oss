'use client'

/*
 * ★V8 友だち一覧（Pencil `x6QsVz`：閲覧のみ。いつもの形は同じ板からボタンを出したもの）。
 *
 * v7 の一覧（app/friends/page.tsx の FriendsPageInner）とは別の部品として持つ。
 * 呼ぶ API・送る形・保存先（sessionStorage・localStorage）は今と同じ。
 * 違いは見せ方だけ：頭（題・CSV・取り込む）→ 閲覧のみの帯 → タブ → 数の帯 →
 * 道具2段（探す・絞り込み4つ・詳細条件・保存した検索／未対応・注目のみ・件数・
 * 表示項目・件数・並び）→ 表（□・☆・友だち・対応/担当・シナリオ・最新・タグ・流入元・最終接触・…）→ ページ送り。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CircleDot,
  Bookmark,
  Columns3,
  Download,
  Eye,
  Megaphone,
  MessageSquare,
  UserRoundX,
  SlidersHorizontal,
  Star,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react'
import type { Scenario, Tag } from '@line-crm/shared'
import { api, ApiError, fetchApi, type FriendListItem, type FriendStats, type SupportMarkListItem } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { useAccount } from '@/contexts/account-context'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { loadOperators } from '@/lib/operators-cache'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { buildBroadcastHandoff } from '@/lib/friends-broadcast-condition'
import { usePageTitle } from '@/components/shell/page-chrome'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Avatar from '@/components/shared/avatar'
import KpiCard from '@/components/shared/kpi-card'
import KpiBand from '@/components/shared/kpi-band'
import FilterChip from '@/components/shared/filter-chip'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import Pagination from '@/components/shared/pagination'
import ListState from '@/components/shared/list-state'
import { notifyToast } from '@/components/shared/toast'
import { useListScrollMemory } from '@/components/shared/list-url-state'
import MenuPortal from '@/components/shared/menu-portal'
import BulkBar from '@/components/shared/bulk-bar'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import { RowMenu } from '@/components/shared/row-actions'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import AdvancedSearchDialog, { type AdvancedSearchResult } from '@/components/friends/advanced-search-dialog'
import SavedSearchDialog from '@/components/friends/saved-search-dialog'
import SingleFriendActions, { type FriendAction } from '@/components/friends/single-friend-actions'
import NoticeDialog from '@/components/friends/notice-dialog'
import BulkRunDialog from '@/components/friends/bulk-run-dialog'
import FriendRowMenu from '@/components/friends/friend-row-menu'
import { canRunBulk } from '@/components/friends/bulk-run-view'
import { conditionsToEditorState, savedSearchParams, savedSearchSummary } from '@/components/friends/saved-search-utils'
import { hasEditKey } from '../shared/nav'
import { FriendsTabs } from '../shared/head'
import { emptyMessageOf } from './empty'
import { csvExportLine } from './csv-export'
import { readFriendsListSnapshot, writeFriendsListSnapshot } from './list-state'
import { lastContactOf, monthDay, monthDayTime, statusOf, messageWord, splitTags } from './words'
import styles from './list.module.css'

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number]
type SortMode = 'recent' | 'oldest'
type ResponseFilter = 'all' | 'unhandled'
type Notice = { title: string; message: string } | null
type LoadStatus = 'loading' | 'ready' | 'error'
type Column = 'support' | 'scenario' | 'latest' | 'tags' | 'source' | 'last'

const COLUMNS: Array<{ key: Column; label: string }> = [
  { key: 'support', label: '対応・担当' },
  { key: 'scenario', label: 'シナリオ' },
  { key: 'latest', label: '最新のメッセージ' },
  { key: 'tags', label: 'タグ' },
  { key: 'source', label: '流入元' },
  { key: 'last', label: '最終接触' },
]

const VIEWER_NOTE = '閲覧のみで見ています。変える操作は管理者に頼んでください。'

function scoreBoundary(raw: string | null) {
  if (raw === null || !/^-?\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

function prefixed(label: string, options: Array<{ value: string; label: string }>) {
  return options.map((option) => ({ value: option.value, label: `${label}：${option.label}` }))
}

function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value)
}

/** 数の帯の「…」。今の「受信箱を開く」はここへ移した。 */
function KpiMenu({ title, onOpen }: { title: string; onOpen: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={styles.kpiMenu}>
      <RowMenu className={styles.kpiMenuButton} label={`${title}のメニュー`} open={open} onOpenChange={setOpen} items={[{ id: 'inbox', label: '受信箱を開く', external: true, onSelect: () => { setOpen(false); onOpen() } }]} />
    </span>
  )
}

export default function FriendsListV8() {
  usePageTitle('友だち')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const featureVisibility = useFeatureVisibility(selectedAccountId)
  const marksEnabled = featureVisibility.enabled('support_marks')
  const savedSearchEnabled = featureVisibility.enabled('saved_searches')
  const staffRole = useStaffRole()
  /*
   * 変えられるか。役割はサーバの答え。担当者でも項目キーで任されていれば変えられる。
   * 役割が読めるまでは今までどおり出す（最後の守りはサーバの 403）。
   */
  const [keys, setKeys] = useState({ friends: false, chats: false })
  useEffect(() => { setKeys({ friends: hasEditKey('/friends'), chats: hasEditKey('/chats') }) }, [])
  const manager = staffRole === null || canManageRole(staffRole)
  const canEditFriends = manager || keys.friends
  const canEditChats = manager || keys.chats
  const readOnly = !canEditFriends && !canEditChats
  const canImport = manager

  const router = useRouter()
  const searchParams = useSearchParams()
  const scoreMin = scoreBoundary(searchParams.get('scoreMin'))
  const scoreMax = scoreBoundary(searchParams.get('scoreMax'))
  const hasScoreRange = scoreMin !== undefined || scoreMax !== undefined
  const scoredOnly = searchParams.get('scoredOnly') === '1'
  const audienceId = searchParams.get('audienceId')?.trim() || ''
  const directSavedSearchId = searchParams.get('savedSearch')
  const directTagId = (searchParams.get('tag') ?? '').trim()
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
  const [pageSize, setPageSize] = useState<PageSize>(20)
  const [selectedTagId, setSelectedTagId] = useState(directTagId)
  const [searchInput, setSearchInput] = useState(directQuery)
  const [searchSubmitted, setSearchSubmitted] = useState(directQuery)
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all')
  const [operatorId, setOperatorId] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [refreshing, setRefreshing] = useState(false)
  const [optionsFailed, setOptionsFailed] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [rowAction, setRowAction] = useState<{ friend: FriendListItem; action: FriendAction } | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const hasRowsRef = useRef(false)
  const loadRequestRef = useRef(0)
  const loadContextRef = useRef({ accountId: selectedAccountId, page, pageSize })
  loadContextRef.current = { accountId: selectedAccountId, page, pageSize }
  hasRowsRef.current = friends.length > 0

  useEffect(() => { setRowAction(null) }, [selectedAccountId])

  /* ── 表示項目（今と同じ保存先 `friends.visibleColumns`） ── */
  const [visible, setVisible] = useState<Set<Column>>(() => new Set(COLUMNS.map((column) => column.key)))
  const [columnsReady, setColumnsReady] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const columnsButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('friends.visibleColumns') ?? 'null') as unknown
      if (Array.isArray(stored)) setVisible(new Set(stored.filter((key): key is Column => COLUMNS.some((column) => column.key === key))))
    } catch {
      // 壊れた保存値は既定の列で開く。
    } finally {
      setColumnsReady(true)
    }
  }, [])
  useEffect(() => {
    if (!columnsReady) return
    try { localStorage.setItem('friends.visibleColumns', JSON.stringify([...visible])) } catch { /* 保存できなくても一覧は動く */ }
  }, [columnsReady, visible])

  /* ── 数の帯（今の FriendKpis と同じ口・同じ守り） ── */
  const [stats, setStats] = useState<FriendStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsFailed, setStatsFailed] = useState(false)
  const statsRequestRef = useRef(0)
  const loadStats = useCallback(async (accountId: string | null) => {
    const requestId = ++statsRequestRef.current
    setStats(null)
    setStatsFailed(false)
    setStatsLoading(true)
    try {
      const res = await api.friendStats.get(accountId ?? undefined)
      if (statsRequestRef.current !== requestId) return
      if (res.success) setStats(res.data)
      else setStatsFailed(true)
    } catch {
      if (statsRequestRef.current === requestId) setStatsFailed(true)
    } finally {
      if (statsRequestRef.current === requestId) setStatsLoading(false)
    }
  }, [])
  useEffect(() => { void loadStats(selectedAccountId) }, [selectedAccountId, loadStats])

  /* ── 一覧の状態の保存・復元（IDEA-03・今と同じ） ── */
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
        if (isPageSize(snapshot.pageSize)) setPageSize(snapshot.pageSize)
        setPage(snapshot.page)
        setAdvanced(snapshot.advanced)
      }
    }
    setRestored(true)
  }, [accountLoading, selectedAccountId, hasExplicitUrlFilters])

  useEffect(() => {
    if (!restored || !selectedAccountId) return
    writeFriendsListSnapshot(selectedAccountId, {
      searchInput, searchSubmitted, selectedTagId, responseFilter, operatorId, scenarioId,
      attentionOnly, sortMode, page, pageSize, advanced,
    })
  }, [restored, selectedAccountId, searchInput, searchSubmitted, selectedTagId, responseFilter, operatorId, scenarioId, attentionOnly, sortMode, page, pageSize, advanced])
  /*
   * 打って 300ms 止まったら自動で絞り込む（Enter 不要。動きの点検・9）。Enter はすぐ絞る。
   * 控えから戻した直後（入力と絞り込みが同じ）は何もしない。
   */
  useEffect(() => {
    if (!restored) return
    const next = searchInput.trim()
    if (next === searchSubmitted) return
    const timer = window.setTimeout(() => { setSearchSubmitted(next); setPage(1) }, 300)
    return () => window.clearTimeout(timer)
  }, [restored, searchInput, searchSubmitted])

  /* 絞り込みは上の控えが戻す。スクロール位置も、戻ったときだけ同じ所へ戻す（動きの点検 5 番）。 */
  useListScrollMemory(restored && loadStatus === 'ready')

  const emptyMessage = emptyMessageOf({
    search: searchSubmitted,
    tagId: selectedTagId,
    advanced: advanced !== null,
    others: responseFilter !== 'all' || operatorId !== '' || scenarioId !== '' || attentionOnly || hasScoreRange || audienceId !== '',
  })
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const broadcastHandoff = useMemo(() => buildBroadcastHandoff({
    searchSubmitted, selectedTagId, responseFilter, operatorId, scenarioId, attentionOnly,
    scoreMin, scoreMax, scoredOnly, audienceId, advanced,
  }), [searchSubmitted, selectedTagId, responseFilter, operatorId, scenarioId, attentionOnly, scoreMin, scoreMax, scoredOnly, audienceId, advanced])
  const broadcastHandoffHref = broadcastHandoff.kind === 'ready' && canRunBulk(staffRole)
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
    const requestedAccountId = selectedAccountId
    try {
      const [tagResponse, operatorResponse, scenarioResponse] = await Promise.all([
        api.tags.list(requestedAccountId ? { accountId: requestedAccountId } : undefined),
        loadOperators(),
        api.scenarios.list(requestedAccountId ? { accountId: requestedAccountId } : undefined),
      ])
      if (loadContextRef.current.accountId !== requestedAccountId) return
      if (tagResponse.success) setAllTags(tagResponse.data)
      if (operatorResponse.success) setOperators(operatorResponse.data)
      if (scenarioResponse.success) setScenarios(scenarioResponse.data)
      setOptionsFailed(false)
    } catch {
      setOptionsFailed(true)
    }
  }, [selectedAccountId])

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
      setOptionsFailed(true)
    }
  }, [selectedAccountId, marksEnabled])

  const loadFriends = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    const requestedAccountId = selectedAccountId
    const requestedPage = page
    const requestedPageSize = pageSize
    if (hasRowsRef.current) {
      setRefreshing(true)
    } else {
      setLoadStatus('loading')
      setFriends([])
      setTotal(0)
    }
    setBulkOpen(false)
    setSelectedIds(new Set())
    const stale = () => {
      const context = loadContextRef.current
      return requestId !== loadRequestRef.current
        || context.accountId !== requestedAccountId
        || context.page !== requestedPage
        || context.pageSize !== requestedPageSize
    }
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
      if (stale()) return
      if (response.success) {
        setFriends(response.data.items)
        setTotal(response.data.total)
        setLoadStatus('ready')
      } else {
        setFriends([])
        setTotal(0)
        setLoadStatus('error')
      }
      setSelectedIds(new Set())
      setRefreshing(false)
    } catch {
      if (stale()) return
      setFriends([])
      setTotal(0)
      setLoadStatus('error')
      setRefreshing(false)
    }
  }, [advanced, attentionOnly, audienceId, operatorId, page, pageSize, responseFilter, scenarioId, scoreMax, scoreMin, scoredOnly, searchSubmitted, selectedAccountId, selectedTagId, sortMode])

  useEffect(() => void loadOptions(), [loadOptions])
  useEffect(() => void loadMarks(), [loadMarks])
  useEffect(() => setPage(1), [selectedAccountId])
  useEffect(() => {
    if (!directSavedSearchId || !savedSearchEnabled || !selectedAccountId) return
    let cancelled = false
    const accountId = selectedAccountId
    const savedId = directSavedSearchId
    setAdvanced({ params: { savedSearchId: savedId }, summary: ['保存した検索を適用中'] })
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
      if (params.limit && isPageSize(Number(params.limit))) setPageSize(Number(params.limit) as PageSize)
      setPage(1)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [directSavedSearchId, savedSearchEnabled, selectedAccountId, allTags])
  useEffect(() => {
    if (!restored) return
    void loadFriends()
    return () => { loadRequestRef.current += 1 }
  }, [loadFriends, restored])
  useEffect(() => {
    if (loadStatus === 'ready' && page > totalPages) setPage(totalPages)
  }, [loadStatus, page, totalPages])

  const resetPageWith = (update: () => void) => {
    update()
    setPage(1)
  }

  const applyFriendTags = useCallback((friendId: string, next: Tag[]) => {
    const previous = friends.find((friend) => friend.id === friendId)?.tags ?? []
    setFriends((current) => current.map((friend) => (friend.id === friendId ? { ...friend, tags: next } : friend)))
    return () => {
      setFriends((current) => current.map((friend) => (friend.id === friendId ? { ...friend, tags: previous } : friend)))
    }
  }, [friends])

  const exportCurrentPage = useCallback(() => {
    const header = ['友だち名', '対応', 'シナリオ', '最新メッセージ', '流入元', '登録日']
    const rows = friends.map((friend) => [
      friend.displayName,
      statusOf(friend.chatStatus).label,
      friend.activeScenario?.name ?? '',
      friend.latestIncomingMessage?.content ?? '',
      friend.firstTrackedLinkName ?? '',
      friend.createdAt.slice(0, 10),
    ])
    // 先頭 =+-@ の数式インジェクション対策つき。出るのは表示中のページ分だけ。
    const csv = [header, ...rows].map((row) => csvExportLine(row)).join('\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `friends-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [friends])

  /*
   * 注目の ★ は押した瞬間に変え、裏で保存する（動きの点検・7）。失敗したら元に戻して知らせる。
   * ほかの変更と重なった（409）ときは、最新を読み直して知らせる。
   */
  const toggleAttention = useCallback(async (friend: FriendListItem) => {
    const current = String(friend.metadata?.__attention ?? '') === '1'
    const apply = (on: boolean) => setFriends((rows) => rows.map((row) => (
      row.id === friend.id ? { ...row, metadata: { ...(row.metadata ?? {}), __attention: on ? '1' : null } } : row
    )))
    apply(!current)
    try {
      await fetchApi<{ success: boolean; data: unknown }>(
        `/api/friends/${friend.id}/metadata?expectedUpdatedAt=${encodeURIComponent(friend.updatedAt)}`,
        { method: 'PUT', body: JSON.stringify({ __attention: current ? null : '1' }) },
      )
      void loadFriends()
    } catch (error) {
      apply(current)
      if (error instanceof ApiError && error.status === 409) {
        await loadFriends()
        notifyToast('注目がほかの変更と重なりました。最新の状態を読み直したので、確かめてもう一度押してください。', { tone: 'error' })
      } else {
        notifyToast('注目を変えられませんでした。', { tone: 'error', actionLabel: 'もう一度', onAction: () => { void toggleAttentionRef.current(friend) } })
      }
    }
  }, [loadFriends])
  const toggleAttentionRef = useRef(toggleAttention)
  toggleAttentionRef.current = toggleAttention

  const allowedActions: FriendAction[] = [
    ...(canRunBulk(staffRole) || canEditFriends ? ['tag', 'field'] as FriendAction[] : []),
    ...(canRunBulk(staffRole) || canEditChats ? ['status', 'operator', 'template'] as FriendAction[] : []),
    ...(canRunBulk(staffRole) ? ['scenario', 'reminder'] as FriendAction[] : []),
  ]
  const rowCanEdit = canRunBulk(staffRole) || canEditFriends
  const selectedCount = friends.filter((friend) => selectedIds.has(friend.id)).length
  const allSelected = friends.length > 0 && selectedCount === friends.length
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  /* ── 数の帯 ── */
  const addedDiff = stats ? stats.addedThisMonth - stats.addedLastMonth : 0
  const activeDelta = stats?.activeMonthDelta ?? null
  const kpis = [
    {
      key: 'active', title: '有効な友だち', icon: Users, value: stats?.active ?? null,
      detail: stats ? `総友だち ${formatNumber(stats.total)}` : statsFailed ? '読み込めませんでした' : '—',
      delta: activeDelta != null ? { text: `${activeDelta >= 0 ? '+' : ''}${formatNumber(activeDelta)}`, tone: activeDelta < 0 ? 'neutral' : 'up' } : null,
      href: '/chats',
    },
    {
      key: 'blocked', title: 'ブロック・非表示', icon: UserRoundX, value: stats ? stats.blockedByThem + stats.hiddenByUs : null,
      detail: stats ? `相手から ${stats.blockedByThem}・自分から ${stats.hiddenByUs}` : statsFailed ? '読み込めませんでした' : '—',
      delta: null,
      href: '/chats',
    },
    {
      key: 'unanswered', title: '未対応', icon: MessageSquare, value: stats?.unanswered ?? null,
      detail: stats ? `対応済み ${formatNumber(stats.resolved)}` : statsFailed ? '読み込めませんでした' : '—',
      delta: stats && stats.unanswered > 0 ? { text: '要確認', tone: 'warn' } : null,
      href: '/chats?status=unread',
    },
    {
      key: 'added', title: '今月の追加', icon: UserPlus, value: stats?.addedThisMonth ?? null,
      detail: stats ? `前月 ${formatNumber(stats.addedLastMonth)}人` : statsFailed ? '読み込めませんでした' : '—',
      delta: stats ? { text: `${addedDiff >= 0 ? '+' : ''}${addedDiff}`, tone: addedDiff < 0 ? 'neutral' : 'up' } : null,
      href: '/chats',
    },
  ] as const

  const statsBand = (
    <KpiBand className={styles.kpiBand} data-design="V8FriendKpis">
      {kpis.map((kpi) => (
        <KpiCard
          key={kpi.key}
          presentation="band"
          density="compact"
          title={kpi.title}
          icon={<kpi.icon size={14} aria-hidden="true" />}
          value={kpi.value}
          unit="人"
          loading={statsLoading}
          detail={kpi.detail}
          onRetry={statsFailed ? () => void loadStats(selectedAccountId) : undefined}
          delta={kpi.delta ? (
            <span className={kpi.delta.tone === 'warn' ? `${styles.delta} ${styles.deltaWarn}` : kpi.delta.tone === 'up' ? `${styles.delta} ${styles.deltaUp}` : styles.delta}>
              {kpi.delta.tone === 'up' ? <TrendingUp size={12} aria-hidden="true" /> : null}
              {kpi.delta.text}
            </span>
          ) : undefined}
          menu={<KpiMenu title={kpi.title} onOpen={() => router.push(kpi.href)} />}
        />
      ))}
    </KpiBand>
  )

  const headActions = (
    <>
      <Button type="button" variant="secondary" onClick={exportCurrentPage} disabled={loadStatus !== 'ready'}>
        <Download size={14} aria-hidden="true" />
        表示中をCSVで書き出す
      </Button>
      {canImport ? (
        <Button variant="primary" href="/friends/migrations">
          <Upload size={14} aria-hidden="true" />
          友だちを取り込む
        </Button>
      ) : (
        /* 閲覧のみは押せないボタンを置かない。場所だけ空けて、隣のボタンを動かさない。 */
        <span className={styles.hiddenSlot} aria-hidden="true">
          <Upload size={14} aria-hidden="true" />
          友だちを取り込む
        </span>
      )}
    </>
  )

  const toolbar = (
    <div className={styles.tools} data-design="V8SearchPanel">
      <form
        className={styles.toolRow}
        onSubmit={(event) => {
          event.preventDefault()
          resetPageWith(() => setSearchSubmitted(searchInput.trim()))
        }}
      >
        <div className={styles.search}>
          <SearchField
            className={styles.searchField}
            aria-label="名前・LINE名・タグ・メモで探す"
            value={searchInput}
            onChange={(value) => {
              setSearchInput(value)
              if (!value.trim() && searchSubmitted) resetPageWith(() => setSearchSubmitted(''))
            }}
            onClear={() => {
              setSearchInput('')
              if (searchSubmitted) resetPageWith(() => setSearchSubmitted(''))
            }}
            placeholder="名前・LINE名・タグ・メモで探す"
          />
        </div>
        {/* 選んだ値は「タグ：すべて」の1つの文字で出す（絵どおり。部品の label は文字が2つに割れる）。 */}
        <Select aria-label="タグで絞り込む" width={119} value={selectedTagId}
          onChange={(value) => resetPageWith(() => setSelectedTagId(value))}
          options={prefixed('タグ', [{ value: '', label: 'すべて' }, ...allTags.map((tag) => ({ value: tag.id, label: tag.name }))])} />
        <Select aria-label="対応状況で絞り込む" width={119} value={responseFilter}
          onChange={(value) => resetPageWith(() => setResponseFilter(value as ResponseFilter))}
          options={prefixed('対応', [{ value: 'all', label: 'すべて' }, { value: 'unhandled', label: '未対応のみ' }])} />
        <Select aria-label="担当で絞り込む" width={132} value={operatorId}
          onChange={(value) => resetPageWith(() => setOperatorId(value))}
          options={prefixed('担当者', [{ value: '', label: 'すべて' }, ...operators.map((operator) => ({ value: operator.id, label: operator.name }))])} />
        <Select aria-label="シナリオで絞り込む" width={147} value={scenarioId}
          onChange={(value) => resetPageWith(() => setScenarioId(value))}
          options={prefixed('シナリオ', [{ value: '', label: 'すべて' }, ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))])} />
        <button
          type="button"
          aria-pressed={advanced !== null}
          onClick={() => setAdvancedOpen(true)}
          className={advanced ? `${styles.textButton} ${styles.textButtonOn}` : styles.textButton}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          詳細条件
        </button>
        <span className={styles.spacer} />
        {savedSearchEnabled ? (
          <Button type="button" variant="secondary" onClick={() => setSavedOpen(true)}>
            <Bookmark size={14} aria-hidden="true" />
            保存した検索
          </Button>
        ) : null}
      </form>
      <div className={styles.toolRow}>
        <div role="group" aria-label="すばやく絞り込む" className={styles.chips}>
          <FilterChip selected={responseFilter === 'unhandled'} icon={<CircleDot size={14} aria-hidden="true" />} onChange={() => resetPageWith(() => setResponseFilter(responseFilter === 'unhandled' ? 'all' : 'unhandled'))}>
            未対応
          </FilterChip>
          <FilterChip selected={attentionOnly} onChange={() => resetPageWith(() => setAttentionOnly(!attentionOnly))} icon={<Star size={14} aria-hidden="true" />}>
            注目のみ
          </FilterChip>
        </div>
        <span className={styles.count}>{loadStatus === 'ready' && !refreshing ? `${formatNumber(total)}件` : '—'}</span>
        {broadcastHandoffHref ? (
          <Link href={broadcastHandoffHref} data-broadcast-handoff className={styles.handoff} title="今の絞り込み条件を対象に一斉配信を作ります。人数は送信時に最新の友だちへ計算し直します。">
            <Megaphone size={14} aria-hidden="true" />
            この条件で配信を作成
          </Link>
        ) : null}
        <span className={styles.spacer} />
        {selectedCount > 0 ? <span className={styles.selectedCount}>{selectedCount}件選択中</span> : null}
        <span className={styles.columnsBox}>
          <button ref={columnsButtonRef} type="button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen((current) => !current)} className={styles.textButton}>
            <Columns3 size={16} aria-hidden="true" />
            表示項目を編集
          </button>
          <MenuPortal open={columnsOpen} align="end" getAnchor={() => columnsButtonRef.current} onClose={() => setColumnsOpen(false)}>
            <div className={styles.columnsMenu}>
              {COLUMNS.map((column) => (
                <div key={column.key} className={styles.columnsItem}>
                  <Checkbox
                    checked={visible.has(column.key)}
                    onCheckedChange={(checked) => setVisible((previous) => {
                      const next = new Set(previous)
                      if (checked) next.add(column.key)
                      else next.delete(column.key)
                      return next
                    })}
                  >
                    {column.label}
                  </Checkbox>
                </div>
              ))}
            </div>
          </MenuPortal>
        </span>
        <Select
          aria-label="表示件数"
          width={98}
          value={String(pageSize)}
          onChange={(value) => resetPageWith(() => setPageSize(Number(value) as PageSize))}
          options={PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: `${size}件表示` }))}
        />
        <Select
          aria-label="並び順"
          treatment="text"
          width={171}
          value={sortMode}
          onChange={(value) => resetPageWith(() => setSortMode(value as SortMode))}
          options={[{ value: 'recent', label: '友だち追加の新しい順' }, { value: 'oldest', label: '友だち追加の古い順' }]}
        />
      </div>
      {advanced?.summary.length ? (
        <div className={styles.applied}>
          <span className={styles.appliedLabel}>絞り込み中</span>
          {advanced.summary.map((summary) => <Chip key={summary} tone="neutral">{summary}</Chip>)}
          <button type="button" onClick={() => resetPageWith(() => setAdvanced(null))} className={styles.linkButton}>条件を外す</button>
        </div>
      ) : null}
      {hasScoreRange ? (
        <div className={styles.applied}>
          <span>
            行動スコア：{scoreMin !== undefined ? `${scoreMin}点以上` : ''}
            {scoreMin !== undefined && scoreMax !== undefined ? '〜' : ''}
            {scoreMax !== undefined ? `${scoreMax}点以下` : ''}
            {scoredOnly ? '（点数がついている人のみ）' : ''}
          </span>
          <Link href="/friends" className={styles.linkButton}>この条件を外す</Link>
        </div>
      ) : null}
      {optionsFailed ? (
        <p className={styles.optionsFailed}>
          絞り込みの選択肢を読み込めませんでした。タグが空なのは、取れなかっただけかもしれません。
          <button type="button" onClick={() => { void loadOptions(); void loadMarks() }} className={styles.linkButton}>再読み込み</button>
        </p>
      ) : null}
    </div>
  )

  const colCount = 4 + [...visible].length
  const table = (
    <div className={refreshing ? `${styles.tableWrap} ${styles.refreshing}` : styles.tableWrap} aria-busy={loadStatus === 'loading' || refreshing || undefined}>
      <DataTable className={styles.table} data-design="V8FriendTable">
        <colgroup>
          <col className={styles.colCheck} />
          <col className={styles.colStar} />
          <col />
          {visible.has('support') ? <col className={styles.colSupport} /> : null}
          {visible.has('scenario') ? <col className={styles.colScenario} /> : null}
          {visible.has('latest') ? <col className={styles.colLatest} /> : null}
          {visible.has('tags') ? <col className={styles.colTags} /> : null}
          {visible.has('source') ? <col className={styles.colSource} /> : null}
          {visible.has('last') ? <col className={styles.colLast} /> : null}
          <col className={styles.colMenu} />
        </colgroup>
        <thead>
          <TableHeadRow>
            <Th className={styles.thCheck}>
              <Checkbox
                checked={allSelected}
                indeterminate={selectedCount > 0 && !allSelected}
                onCheckedChange={(checked) => setSelectedIds(checked ? new Set(friends.map((friend) => friend.id)) : new Set())}
                aria-label="表示中の友だちをすべて選ぶ"
              />
            </Th>
            <Th colSpan={2} className={styles.thFriend}>
              <span className={styles.thFriendInner}><Star size={14} aria-label="注目" className={styles.thStar} />友だち</span>
            </Th>
            {COLUMNS.filter((column) => visible.has(column.key)).map((column) => (
              <Th key={column.key} className={styles.th}>{column.label}</Th>
            ))}
            <Th className={styles.thMenu}><span className="sr-only">操作</span></Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {loadStatus === 'loading' ? (
            <tr>
              <td colSpan={colCount}>
                <DelayedSkeleton
                  loading
                  skeleton={(
                    <div aria-hidden="true">
                      {[0, 1, 2, 3, 4, 5].map((row) => (
                        <div key={row} className={styles.skeletonRow}>
                          <Skeleton className={styles.skelBox} />
                          <Skeleton circle className={styles.skelAvatar} />
                          <Skeleton className={styles.skelName} />
                          <Skeleton className={styles.skelCell} />
                          <Skeleton className={styles.skelCell} />
                        </div>
                      ))}
                    </div>
                  )}
                />
              </td>
            </tr>
          ) : loadStatus === 'error' ? (
            <tr>
              <td colSpan={colCount} className={styles.stateCell}>
                <ListState kind="error" title="友だちを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度試してください。" onRetry={() => void loadFriends()} />
              </td>
            </tr>
          ) : friends.length === 0 ? (
            <tr>
              <td colSpan={colCount} className={styles.stateCell}>
                <ListState kind="empty" title={emptyMessage.title} description={emptyMessage.description} />
              </td>
            </tr>
          ) : friends.map((friend) => {
            const status = statusOf(friend.chatStatus)
            const latest = friend.latestIncomingMessage
            const lastContact = lastContactOf(friend)
            const attention = String(friend.metadata?.__attention ?? '') === '1'
            const tags = splitTags(friend.tags)
            return (
              <Tr key={friend.id} interactive selected={selectedIds.has(friend.id) || undefined} className={styles.row} data-friend-row>
                <Td className={styles.tdCheck} onClick={(event) => event.stopPropagation()}>
                  <Checkbox checked={selectedIds.has(friend.id)} onCheckedChange={() => toggleSelect(friend.id)} aria-label={`${friend.displayName}を選ぶ`} />
                </Td>
                <Td className={styles.tdStar}>
                  {rowCanEdit ? (
                    <button
                      type="button"
                      className={attention ? `${styles.star} ${styles.starOn}` : styles.star}
                      aria-pressed={attention}
                      aria-label={`${friend.displayName}の注目を${attention ? '外す' : '付ける'}`}
                      onClick={() => void toggleAttention(friend)}
                    >
                      <Star size={16} aria-hidden="true" />
                    </button>
                  ) : (
                    /* 閲覧のみは押せない星を置かない。注目の印だけ見せる。 */
                    <span className={attention ? `${styles.star} ${styles.starOn}` : styles.star} title={attention ? '注目' : undefined}>
                      <Star size={16} aria-hidden="true" />
                    </span>
                  )}
                </Td>
                <Td className={styles.td}>
                  <div className={styles.friendCell}>
                    <Avatar name={friend.displayName} src={friend.pictureUrl} size={32} />
                    <div className={styles.friendText}>
                      <Link href={`/friends/detail?id=${friend.id}`} title={friend.displayName} className={styles.friendName}>{friend.displayName}</Link>
                      <span className={styles.sub}>{monthDay(friend.createdAt)}に登録</span>
                    </div>
                  </div>
                </Td>
                {visible.has('support') ? (
                  <Td className={styles.td}>
                    <div className={styles.supportCell}>
                      <span className={styles.statusRow}>
                        <span className={status.tone === 'danger' ? `${styles.status} ${styles.status_danger}` : status.tone === 'warn' ? `${styles.status} ${styles.status_warn}` : status.tone === 'info' ? `${styles.status} ${styles.status_info}` : `${styles.status} ${styles.status_ok}`}><span className={styles.dot} aria-hidden="true" />{status.label}</span>
                        {friend.supportMark ? <span className={styles.mark} title={`対応マーク：${friend.supportMark.name}`}>{friend.supportMark.name}</span> : null}
                      </span>
                      <span className={styles.sub}>{`担当：${friend.operator?.name ?? '担当なし'}`}</span>
                    </div>
                  </Td>
                ) : null}
                {visible.has('scenario') ? (
                  <Td className={styles.td}><span className={styles.cellText} title={friend.activeScenario?.name}>{friend.activeScenario?.name ?? 'なし'}</span></Td>
                ) : null}
                {visible.has('latest') ? (
                  <Td className={styles.td}>
                    {latest ? (
                      <div className={styles.twoLine}>
                        <span className={styles.cellText} title={latest.content}>{messageWord(latest)}</span>
                        <span className={styles.sub}>{monthDayTime(latest.createdAt)}</span>
                      </div>
                    ) : <span className={styles.cellText}>受信なし</span>}
                  </Td>
                ) : null}
                {visible.has('tags') ? (
                  <Td className={styles.td}>
                    <div className={styles.tags} title={friend.tags.map((tag) => tag.name).join('・') || undefined}>
                      {tags.shown.map((tag) => <span key={tag.id} className={styles.tag}>{tag.name}</span>)}
                      {tags.rest > 0 ? <span className={styles.tagRest}>+{tags.rest}</span> : null}
                      {friend.tags.length === 0 ? <span className={styles.faint}>—</span> : null}
                    </div>
                  </Td>
                ) : null}
                {visible.has('source') ? (
                  <Td className={styles.td}><span className={styles.cellText} title={friend.firstTrackedLinkName || '不明'}>{friend.firstTrackedLinkName || '不明'}</span></Td>
                ) : null}
                {visible.has('last') ? (
                  <Td className={styles.td}><span className={styles.cellText} title={monthDayTime(lastContact)}>{monthDay(lastContact)}</span></Td>
                ) : null}
                <Td className={styles.tdMenu}>
                  <div className={styles.menuBox}>
                    <FriendRowMenu
                      friendId={friend.id}
                      friendName={friend.displayName}
                      attention={attention}
                      canEdit={rowCanEdit}
                      allowedActions={allowedActions}
                      onAction={(action) => setRowAction({ friend, action })}
                      onToggleAttention={() => void toggleAttention(friend)}
                    />
                  </div>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    </div>
  )

  const pager = (
    <div className={styles.pager}>
      <span className={styles.pagerCount}>
        {loadStatus === 'ready' ? `${formatNumber(total)}人中 ${formatNumber(rangeStart)}〜${formatNumber(rangeEnd)}人` : '—'}
      </span>
      <Pagination page={page} pageCount={totalPages} onPageChange={setPage} disabled={loadStatus !== 'ready'} ariaLabel="友だち一覧のページ" />
    </div>
  )

  return (
    <ListPage
      boardId="x6QsVz"
      headingSize="compact"
      title="友だち"
      description="LINE でつながっている人の一覧です。タグと対応の状態で絞り込めます。"
      actions={headActions}
      tabs={(
        <>
          {readOnly ? (
            <div className={styles.viewerBand} role="status">
              <Eye size={16} aria-hidden="true" />
              <span>{VIEWER_NOTE}</span>
            </div>
          ) : null}
          <FriendsTabs current="list" />
        </>
      )}
      stats={statsBand}
      toolbar={toolbar}
      overlays={(
        <>
          <span className={styles.bulkWrap} data-design="V8BulkBar">
            <BulkBar count={selectedIds.size} unit="人" hint="対象を確認してから操作を選んでください" onClear={clearSelection}>
              {selectedIds.size > 1 && canRunBulk(staffRole) ? (
                <Button variant="secondary" data-qa-open="IAf7j" onClick={() => setBulkOpen(true)}>操作を選ぶ</Button>
              ) : null}
              {selectedIds.size > 1 && staffRole !== null && !canRunBulk(staffRole) ? (
                <span className={styles.faint}>一括操作ができるのはオーナーと管理者だけです</span>
              ) : null}
            </BulkBar>
          </span>
          <BulkRunDialog
            open={bulkOpen}
            friendIds={[...selectedIds]}
            selectedFriends={friends.filter((friend) => selectedIds.has(friend.id))}
            tags={allTags}
            accountId={selectedAccountId}
            supportMarksEnabled={marksEnabled}
            onClose={() => setBulkOpen(false)}
            onDone={() => void loadFriends()}
          />
          {rowAction ? (
            <Dialog open title={`${rowAction.friend.displayName}への操作`} onCancel={() => setRowAction(null)} footer={<Button onClick={() => setRowAction(null)}>閉じる</Button>}>
              <SingleFriendActions
                friendId={rowAction.friend.id}
                friendName={rowAction.friend.displayName}
                accountId={selectedAccountId}
                tags={allTags}
                initialAction={rowAction.action}
                hideActions
                friendTags={rowAction.friend.tags}
                onFriendTagsChange={(next) => applyFriendTags(rowAction.friend.id, next)}
                onDone={() => { setRowAction(null); void loadFriends() }}
              />
            </Dialog>
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
              applied={advanced}
              initialSort={sortMode}
              initialLimit={pageSize}
              onApply={(result) => {
                setAdvanced(result)
                if (result.params.sort) setSortMode(result.params.sort)
                if (result.params.limit && isPageSize(Number(result.params.limit))) setPageSize(Number(result.params.limit) as PageSize)
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
                if (result.params.limit && isPageSize(Number(result.params.limit))) setPageSize(Number(result.params.limit) as PageSize)
                setSavedOpen(false)
                setPage(1)
              }}
              onOpenAdvanced={() => {
                setSavedOpen(false)
                setAdvancedOpen(true)
              }}
            />
          ) : null}
          {notice ? <NoticeDialog notice={notice} onClose={() => setNotice(null)} /> : null}
        </>
      )}
      pagination={pager}
    >
      {table}
    </ListPage>
  )
}
