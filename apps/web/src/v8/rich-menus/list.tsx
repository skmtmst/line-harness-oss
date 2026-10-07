'use client'

/*
 * ★V8 リッチメニューの一覧（Pencil「★V8 画面の地図」のリッチメニューの行：
 * 一覧 `rZEGN`、1152 `Y9ASp`、閲覧のみ `ZoKow`、削除できない理由の窓 `yOyCg`）。
 *
 * 2026-10-06 オーナー決定により、古い V8 一覧（app/rich-menus/list-v8.tsx）を
 * 直さず、型（ListPage）と共通部品で一から書いた。データの口・権限・失敗時の
 * 扱いは古い一覧と同じ（BEHAVIOR.md）。
 */
import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { useListScrollMemory, useListUrlState, useOnAccountSwitch } from '@/components/shared/list-url-state'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowDownUp,
  CalendarClock,
  CircleCheck,
  CloudDownload,
  CloudOff,
  Eye,
  FilePen,
  Hand,
  Image as ImageIcon,
  ListOrdered,
  MoreHorizontal,
  Plus,
  Split,
  TriangleAlert,
  Trophy,
} from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { api, ApiError, type RichMenuDeleteImpact, type RichMenuGroupListItem, type RichMenuTapStats } from '@/lib/api'
import { clampSearchQuery } from '@/lib/search-query'
import type { SegmentCondition } from '@/lib/segment-condition'
import { describeCondition } from '@/components/scenarios/scenario-dialogs'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { useRowLeaving } from '@/lib/use-row-leaving'
import { formatDay, formatNumber } from '@/lib/format'
import { runOptimistic } from '@/lib/undoable'
import { isForbiddenOrRateLimited, loadFailureCopy } from '@/components/shared/api-error-message'
import { ListPage } from '@/components/templates'
import ListToolbar from '@/components/shared/list-toolbar'
import SearchField from '@/components/shared/search-field'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import IconButton from '@/components/shared/icon-button'
import Select from '@/components/shared/select'
import FilterChip from '@/components/shared/filter-chip'
import Notice from '@/components/shared/notice'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import { FolderDotName } from '@/components/shared/folder-dot'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Pagination from '@/components/shared/pagination'
import { DelayedSkeleton } from '@/components/shared/skeleton'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import ReorderGrip from '@/components/friend-fields/reorder-grip'
import { useFlipRows, useLiveReorder } from '@/lib/use-live-reorder'
import { ApplyToTagModal } from '@/components/rich-menus/apply-to-tag-modal'
import {
  audienceReason,
  audienceText,
  blockerTexts,
  canDelete as canDeleteImpact,
  impactFromError,
  impactMatchesRequest,
  nextDisplayText,
  referenceKindText,
  sameDeleteImpactRequest,
  type DeleteImpactRequest,
} from './delete-impact'
import { moveTargetingGroup, orderTargetingGroups, withNormalizedPriority } from './targeting-order'
import { ExternalImportWorkspace, type LineMenu } from './external-import'
import { richMenuError, richMenuErrorAll } from './errors'
import BlockedDeleteDialog, { type BlockedRow } from './blocked-dialog'
import styles from './list.module.css'

/** フォルダに入れていないものを選ぶための、内部だけの値。 */
const UNFILED = '__unfiled__'

type SortKey = 'taps' | 'updated' | 'name' | 'priority'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'priority', label: '出す順番' },
  { value: 'taps', label: '今月押された順' },
  { value: 'updated', label: '更新が新しい順' },
  { value: 'name', label: '名前順' },
]

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10件表示' },
  { value: '20', label: '20件表示' },
  { value: '50', label: '50件表示' },
]

/* 道具の段の札（絵 `rZEGN`：公開中・予約・下書き・出し分け）。もう一度押すと外れる（排他）。 */
const FILTER_CHIPS = [
  { key: 'published', label: '公開中', note: 'いまLINEで公開しているメニュー', icon: CircleCheck },
  { key: 'scheduled', label: '予約', note: '公開日時を予約したメニュー', icon: CalendarClock },
  { key: 'draft', label: '下書き', note: 'まだLINEで公開していないメニュー', icon: FilePen },
  { key: 'targeting', label: '出し分け', note: '出す相手の条件を指定したメニュー', icon: Split },
] as const

const PRIORITY_NOTE =
  '上のメニューが優先されます。同じ友だちが複数の条件に当てはまるときは、いちばん上の1つだけが出ます。順番は行の左のつまみで入れ替えます。'

const NO_MANAGE_NOTE =
  'リッチメニューの作成・変更・公開・削除はオーナーと管理者だけができます。一覧と切替のつながりはこのまま見られます。'

type DeleteTarget =
  | { kind: 'managed'; group: RichMenuGroupListItem }
  | { kind: 'external'; menu: LineMenu }

/** 「大・6面・切替タブ 2」の形にする。面数が取れないときは大きさだけ。 */
function menuShapeText(g: RichMenuGroupListItem): string {
  const size = g.size === 'large' ? '大' : '小'
  const areas = g.defaultPageAreaCount != null && g.defaultPageAreaCount > 0
    ? `・${g.defaultPageAreaCount}面`
    : ''
  const pages = g.pageCount ?? 0
  const tabs = pages > 1 ? `・切替タブ ${pages}` : g.pageCount != null ? '・切替タブ なし' : ''
  return `${size}${areas}${tabs}`
}

/** 「誰に出すか」の主行。タグ1つの条件なら「タグ『◯◯』」、複雑なら条件の説明。 */
function audienceMainText(g: RichMenuGroupListItem, tagNameById: Map<string, string>): string {
  if (g.status === 'draft' && !g.isDefaultForAll && !g.targetingEnabled) return 'まだ決めていない'
  if (!g.targetingEnabled || !g.targetingCondition) return 'すべての友だち'
  try {
    const condition = JSON.parse(g.targetingCondition) as SegmentCondition
    if (!condition || !Array.isArray(condition.rules)) return '条件で出し分け'
    const firstRule = condition.rules[0]
    const rest = condition.rules.length + (condition.groups ?? []).length - (firstRule ? 1 : 0)
    if (firstRule && firstRule.type.startsWith('tag_') && rest === 0) {
      const tagName = tagNameById.get(String(firstRule.value))
      if (tagName) return `タグ「${tagName}」`
    }
    return describeCondition(condition)
  } catch {
    return '条件で出し分け'
  }
}

/** 「誰に出すか」の副行。対象人数・既定・予約から既定、のどれか。 */
function audienceSubText(g: RichMenuGroupListItem): string | null {
  if (g.publishingAt && g.isDefaultForAll) return `${shortDay(g.publishingAt)} から既定`
  if (g.targetingEnabled && g.targetingCondition) {
    return g.audienceCount != null ? `対象 ${formatNumber(g.audienceCount)}人` : '対象の人数は未取得'
  }
  if (g.isDefaultForAll) return '（既定）'
  return null
}

/** 「10/5」の形（予約の札・「から既定」）。 */
const shortDay = (value: string): string => {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(d)
}

/** 消せない理由の短い言い方（yOyCg：「何になっているか」だけ。外し方は右の操作）。 */
function blockerLabel(key: string, impact: RichMenuDeleteImpact): string {
  switch (key) {
    case 'default_for_all': return 'すべての友だちの既定になっている'
    case 'published': return 'LINEに登録されている'
    case 'line_resources': return 'LINE上にこのメニューが残っている'
    case 'publishing': return 'いまLINEへ反映している'
    case 'incoming_switches': {
      const names = [...new Set(impact.incomingSwitches.map((sw) => sw.sourceGroupName))]
      return names.length === 1 ? `「${names[0]}」の切替先になっている` : `${names.length}つのメニューの切替先になっている`
    }
    case 'operational_references': {
      const refs = impact.operationalReferences.map((ref) => `${referenceKindText(ref.kind)}「${ref.ownerName}」`)
      return refs.length > 0 ? `${refs.join('・')}から使われている` : '自動処理から使われている'
    }
    default: return blockerTexts([key as RichMenuDeleteImpact['blockers'][number]])[0]
  }
}

/** 見本の面の数（大は 2段×3、小は 1段×3。面数が 2 のときは上下2面）。 */
function thumbCells(g: RichMenuGroupListItem): { rows: number; cols: number } {
  const n = g.defaultPageAreaCount ?? (g.size === 'large' ? 6 : 3)
  if (n <= 2) return { rows: 2, cols: 1 }
  if (n <= 3) return { rows: 1, cols: 3 }
  if (n <= 4) return { rows: 2, cols: 2 }
  return { rows: 2, cols: 3 }
}

export default function RichMenusListV8() {
  usePageTitle('リッチメニュー')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccount } = useAccount()
  const narrow = useNarrowViewport()
  /*
   * 作成・公開・削除などの書き込み口は API が requireRole('owner','admin') で閉じている。
   * 役割はサーバ（/api/staff/me）から読む。読めるまでは今までどおり操作を出す。
   */
  const role = useStaffRole()
  const canEdit = role === null ? true : canManageRole(role)

  const [showExternal, setShowExternal] = useState(false)
  const activeAccountRef = useRef<string | null>(selectedAccount?.id ?? null)
  const importRequestGenerationRef = useRef(0)
  const externalLoadedRef = useRef(false)
  const [groups, setGroups] = useState<RichMenuGroupListItem[]>([])
  const [external, setExternal] = useState<{ currentDefault: string | null; lineMenus: LineMenu[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [applyTo, setApplyTo] = useState<RichMenuGroupListItem | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  /*
   * 検索語・フォルダ・絞り込み・並び順・件数・ページは URL に置く（動きの点検 5 番）。
   * 詳細・編集へ行って「戻る」と同じ一覧に戻る。絞り込みを変えたらページは 1 へ
   * （同じ書き込みの中で戻す。効果で戻すと、来た瞬間に URL から戻したページまで消える）。
   */
  const [view, setView] = useListUrlState({ q: '', folder: '', view: '', sort: 'priority', size: '20', page: '1' })
  const query = view.q
  const folderFilter = view.folder
  const savedFilter = view.view
  const sortKey: SortKey = (['taps', 'updated', 'name', 'priority'] as const).includes(view.sort as SortKey) ? view.sort as SortKey : 'priority'
  const pageSize = [10, 20, 50].includes(Number(view.size)) ? Number(view.size) : 20
  const page = Math.max(1, Number.parseInt(view.page, 10) || 1)
  const setPage = useCallback((next: number) => setView({ page: String(next) }), [setView])
  const setQuery = useCallback((next: string) => setView({ q: next, page: '1' }), [setView])
  const setFolderFilter = useCallback((next: string) => setView({ folder: next, page: '1' }), [setView])
  const setSavedFilter = useCallback((next: string) => setView({ view: next, page: '1' }), [setView])
  const setSortKey = useCallback((next: SortKey) => setView({ sort: next, page: '1' }), [setView])
  const setPageSize = useCallback((next: number) => setView({ size: String(next), page: '1' }), [setView])
  const [groupTotal, setGroupTotal] = useState(0)
  const [groupFacets, setGroupFacets] = useState<{
    total: number
    published: number
    targeting: number
    folderCounts: Record<string, number>
  } | null>(null)
  const [tapStats, setTapStats] = useState<RichMenuTapStats | null>(null)
  const [tapStatsStatus, setTapStatsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [externalStatus, setExternalStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [externalError, setExternalError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const { leavingId, leave } = useRowLeaving()
  const [impact, setImpact] = useState<RichMenuDeleteImpact | null>(null)
  const [impactPhase, setImpactPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const impactRequestRef = useRef<DeleteImpactRequest | null>(null)
  const impactRequestGenerationRef = useRef(0)
  const impactLoadGenerationRef = useRef(0)
  const [importTarget, setImportTarget] = useState<LineMenu | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importedMenuName, setImportedMenuName] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [duplicateTarget, setDuplicateTarget] = useState<RichMenuGroupListItem | null>(null)
  const [duplicateBusy, setDuplicateBusy] = useState(false)
  const [duplicateError, setDuplicateError] = useState<string | null>(null)
  const [reorderBusy, setReorderBusy] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [moveNotice, setMoveNotice] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [tagNameById, setTagNameById] = useState<Map<string, string>>(new Map())
  const deferredQuery = useDeferredValue(query.trim())

  /*
   * 消せない理由があるとき（板 `yOyCg`）。見出しを「まだ消せません」にし、
   * 理由を外す順に並べ、実行は「LINEから取り下げる」（公開中のとき）だけにする。
   */
  const blockedDelete = deleteTarget?.kind === 'managed'
    && impactPhase === 'ready'
    && impact !== null
    && impact.blockers.length > 0

  useEffect(() => {
    activeAccountRef.current = selectedAccount?.id ?? null
    importRequestGenerationRef.current += 1
    setGroups([])
    setGroupTotal(0)
    setGroupFacets(null)
    setExternal(null)
    setTapStats(null)
    setTapStatsStatus('loading')
    setExternalStatus('idle')
    externalLoadedRef.current = false
    setError(null)
    setActionError(null)
    setExternalError(null)
    setApplyTo(null)
    setDeleteTarget(null)
    setImportTarget(null)
    setImportBusy(false)
    setImportError(null)
    setImportedMenuName(null)
    setDeleteBusy(false)
    setDeleteError(null)
    setDuplicateTarget(null)
    setDuplicateBusy(false)
    setDuplicateError(null)
    setTagNameById(new Map())
    setOpenMenuId(null)
    impactRequestGenerationRef.current += 1
    impactLoadGenerationRef.current += 1
    impactRequestRef.current = null
    setImpact(null)
    setImpactPhase('idle')
    if (!selectedAccount?.id) setLoading(false)
  }, [selectedAccount?.id])

  /* 一覧の検索・ページングはD1の一覧だけを取り直す（PERF-05）。 */
  const loadList = useCallback(async () => {
    if (!selectedAccount?.id) {
      setLoading(false)
      return
    }
    const accountId = selectedAccount.id
    setLoading(true)
    setError(null)
    setLoadError(null)
    try {
      const groupsRes = await api.richMenuGroups.listPage(accountId, {
        page,
        limit: pageSize,
        query: deferredQuery,
        folderId: folderFilter,
        filter: savedFilter,
        sort: sortKey,
      })
      if (activeAccountRef.current !== accountId) return
      if (!groupsRes.success) throw new Error('load_failed')
      setGroups(groupsRes.data.items)
      setGroupTotal(groupsRes.data.total)
      setGroupFacets(groupsRes.data.facets ?? null)
    } catch (e) {
      if (activeAccountRef.current === accountId) {
        setError(richMenuError(e, 'load'))
        setLoadError(e)
      }
    } finally {
      if (activeAccountRef.current === accountId) setLoading(false)
    }
  }, [deferredQuery, folderFilter, page, pageSize, savedFilter, selectedAccount?.id, sortKey])

  /** タップ集計。数が取れなくても一覧は出す。 */
  const loadTapStats = useCallback(async () => {
    const accountId = selectedAccount?.id
    if (!accountId) {
      setTapStatsStatus('error')
      return
    }
    setTapStatsStatus('loading')
    try {
      const res = await api.richMenuGroups.tapStats(accountId)
      if (activeAccountRef.current !== accountId) return
      if (res.success) {
        setTapStats(res.data)
        setTapStatsStatus('ready')
      } else {
        setTapStatsStatus('error')
      }
    } catch {
      if (activeAccountRef.current === accountId) setTapStatsStatus('error')
    }
  }, [selectedAccount?.id])

  /* 「誰に出すか」の「タグ『◯◯』」を解くためのタグ一覧。取れなくても一覧は出す。 */
  const loadTags = useCallback(async () => {
    const accountId = selectedAccount?.id
    if (!accountId) return
    try {
      const res = await api.tags.list({ accountId })
      if (activeAccountRef.current !== accountId) return
      if (res.success) setTagNameById(new Map(res.data.map((t) => [t.id, t.name])))
    } catch {
      // タグ名が取れなくても一覧は出す。条件は説明の文へ落ちる。
    }
  }, [selectedAccount?.id])

  /* LINE上の外部状態。重い口なので作業画面を開いてから取る。 */
  const loadExternal = useCallback(async () => {
    const accountId = selectedAccount?.id
    if (!accountId) return
    externalLoadedRef.current = true
    setExternalStatus('loading')
    setExternalError(null)
    try {
      const res = await api.richMenuGroups.external(accountId)
      if (activeAccountRef.current !== accountId) return
      if (res.success) {
        setExternal(res.data)
        setExternalStatus('ready')
      } else {
        setExternalError('LINE上の状態を確認できませんでした。少し待ってから、もう一度読み込んでください。')
        setExternal(null)
        setExternalStatus('error')
      }
    } catch {
      if (activeAccountRef.current === accountId) {
        setExternalError('LINE上の状態を確認できませんでした。少し待ってから、もう一度読み込んでください。')
        setExternal(null)
        setExternalStatus('error')
      }
    }
  }, [selectedAccount?.id])

  /** 公開・削除・取り込みのあとの更新。読み込み済みのものだけ取り直す。 */
  const reload = useCallback(async () => {
    await Promise.allSettled([
      loadList(),
      loadTapStats(),
      externalLoadedRef.current ? loadExternal() : Promise.resolve(),
    ])
  }, [loadList, loadTapStats, loadExternal])

  const loadFolders = useCallback(async () => {
    try {
      const res = await api.folders.list('rich_menu', selectedAccount?.id ?? undefined)
      if (res.success) setFolders(res.data)
    } catch {
      // 置き場が取れなくても一覧は出す。
    }
  }, [selectedAccount?.id])

  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => { void loadTapStats() }, [loadTapStats])
  useEffect(() => { void loadTags() }, [loadTags])
  useEffect(() => {
    if (showExternal && !externalLoadedRef.current) void loadExternal()
  }, [showExternal, loadExternal])
  useEffect(() => { void loadFolders() }, [loadFolders])

  /*
   * 出す順番の入れ替え（行の左のつまみ）。動かせるのは「出す順番」の並びで
   * 絞り込みが無いときだけ。ページに収まりきらないときは全件を取り直してから計算する。
   */
  const reorderDisabledReason = !canEdit
    ? '閲覧のみ'
    : sortKey !== 'priority'
      ? '並びを「出す順番」にすると動かせます'
      : query.trim() !== '' || savedFilter !== '' || folderFilter !== ''
        ? '絞り込みを外すと動かせます'
        : reorderBusy
          ? '順番を保存しています'
          : null

  const fullOrderedGroups = useCallback(async (): Promise<RichMenuGroupListItem[] | null> => {
    if (!selectedAccount?.id) return null
    if (groups.length === groupTotal) return orderTargetingGroups(groups)
    const res = await api.richMenuGroups.listPage(selectedAccount.id, {
      page: 1,
      limit: 200,
      query: '',
      folderId: '',
      filter: '',
      sort: 'priority',
    })
    if (!res.success) return null
    if (activeAccountRef.current !== selectedAccount.id) return null
    return orderTargetingGroups(res.data.items)
  }, [groups, groupTotal, selectedAccount?.id])

  /* 押した瞬間に並べ、裏で保存する。失敗したら元に戻し「もう一度」でやり直せる。 */
  const applyOrderedIds = useCallback((orderedIds: string[], notice: string) => {
    if (!selectedAccount?.id || reorderBusy) return
    const accountId = selectedAccount.id
    const fullView = groups.length === groupTotal && orderedIds.length === groups.length
    const previous = groups
    const optimistic = fullView ? withNormalizedPriority(groups, orderedIds) : null
    if (optimistic) setGroups(optimistic)
    setMoveNotice(notice)
    setReorderBusy(true)
    runOptimistic({
      request: async () => {
        const res = await api.richMenuGroups.reorderPriorities(accountId, orderedIds)
        if (!res.success) throw new Error(res.error ?? 'reorder_failed')
      },
      revert: () => {
        if (optimistic) setGroups(previous)
        setReorderBusy(false)
      },
      failureMessage: '順番を変えられませんでした。通信を確かめて、もう一度お試しください。',
      retry: () => applyOrderedIds(orderedIds, notice),
      onSuccess: () => {
        setReorderBusy(false)
        setActionError(null)
        void loadList()
      },
    })
  }, [groups, groupTotal, loadList, reorderBusy, selectedAccount?.id])

  const keyboardMove = useCallback(async (id: string, direction: -1 | 1) => {
    if (reorderDisabledReason) return
    const ordered = await fullOrderedGroups()
    if (!ordered) {
      setActionError(richMenuError(new Error('load_failed'), 'reorder'))
      return
    }
    const updates = moveTargetingGroup(ordered, id, direction)
    if (!updates) return
    applyOrderedIds(
      updates.map((u) => u.id),
      `「${ordered.find((g) => g.id === id)?.name ?? 'メニュー'}」を${direction === -1 ? '1つ上' : '1つ下'}へ動かしました`,
    )
  }, [applyOrderedIds, fullOrderedGroups, reorderDisabledReason])

  /* 動かしている間、置き場所を入れ替えて見せ、ほかの行は滑らかに場所を空ける（自動応答と同じ動き）。 */
  const liveOrder = useLiveReorder(groups, (g) => g.id, dragId)
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  useFlipRows(bodyRef, liveOrder.shown.map((g) => g.id).join(','))

  const dropOn = useCallback(async (targetId: string) => {
    const dragging = dragId
    setDragId(null)
    if (!dragging || dragging === targetId || reorderDisabledReason) return
    const ordered = await fullOrderedGroups()
    if (!ordered) {
      setActionError(richMenuError(new Error('load_failed'), 'reorder'))
      return
    }
    const fromIndex = ordered.findIndex((g) => g.id === dragging)
    const targetIndex = ordered.findIndex((g) => g.id === targetId)
    if (fromIndex < 0 || targetIndex < 0) return
    const working = [...ordered]
    const [moved] = working.splice(fromIndex, 1)
    working.splice(targetIndex, 0, moved)
    applyOrderedIds(working.map((g) => g.id), `「${moved.name}」の順番を変えました`)
  }, [applyOrderedIds, dragId, fullOrderedGroups, reorderDisabledReason])

  function beginImpactRequest(accountId: string, groupId: string): DeleteImpactRequest {
    const request = { accountId, groupId, generation: impactRequestGenerationRef.current + 1 }
    impactRequestGenerationRef.current = request.generation
    impactRequestRef.current = request
    return request
  }

  async function loadImpact(request: DeleteImpactRequest) {
    /* 遅れて返った別のメニューの結果を映さない（世代管理）。 */
    const loadGeneration = impactLoadGenerationRef.current + 1
    impactLoadGenerationRef.current = loadGeneration
    setImpactPhase('loading')
    setImpact(null)
    try {
      const res = await api.richMenuGroups.deleteImpact(request.groupId)
      if (
        !sameDeleteImpactRequest(impactRequestRef.current, request)
        || impactLoadGenerationRef.current !== loadGeneration
      ) return
      if (!res.success) throw new Error('impact_failed')
      if (!impactMatchesRequest(res.data, request)) throw new Error('impact_scope_mismatch')
      setImpact(res.data)
      setImpactPhase('ready')
    } catch {
      if (
        !sameDeleteImpactRequest(impactRequestRef.current, request)
        || impactLoadGenerationRef.current !== loadGeneration
      ) return
      /* 影響が読めないときは消させない。 */
      setImpactPhase('error')
    }
  }

  function handleDelete(group: RichMenuGroupListItem) {
    setDeleteError(null)
    setDeleteTarget({ kind: 'managed', group })
    if (!selectedAccount?.id) return
    void loadImpact(beginImpactRequest(selectedAccount.id, group.id))
  }

  function closeDelete() {
    if (deleteBusy) return
    impactRequestGenerationRef.current += 1
    impactLoadGenerationRef.current += 1
    impactRequestRef.current = null
    setDeleteTarget(null)
    setDeleteError(null)
    setImpact(null)
    setImpactPhase('idle')
  }

  async function confirmDuplicate() {
    if (!duplicateTarget || duplicateBusy) return
    setDuplicateBusy(true)
    setDuplicateError(null)
    try {
      const res = await api.richMenuGroups.duplicate(duplicateTarget.id, crypto.randomUUID())
      if (!res.success) throw new ApiError(500, res.error ?? 'duplicate_failed')
      setDuplicateTarget(null)
      router.push(`/rich-menus/edit?id=${res.data.id}`)
    } catch (e) {
      setDuplicateError(richMenuErrorAll(e, 'duplicate'))
    } finally {
      setDuplicateBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteBusy) return
    const request = impactRequestRef.current
    if (!request) return
    const action = deleteTarget.kind === 'managed'
      ? deleteTarget.group.status === 'published' ? 'unpublish' : 'delete'
      : 'externalDelete'
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      if (deleteTarget.kind === 'managed') {
        const res = deleteTarget.group.status === 'published'
          ? await api.richMenuGroups.unpublish(deleteTarget.group.id)
          : await api.richMenuGroups.delete(deleteTarget.group.id)
        if (!res.success) throw new Error('delete_failed')
      } else {
        if (!selectedAccount?.id) throw new Error('account_missing')
        const res = await api.richMenuGroups.deleteExternal(deleteTarget.menu.richMenuId, selectedAccount.id)
        if (!res.success) throw new Error('delete_failed')
      }
      if (!sameDeleteImpactRequest(impactRequestRef.current, request)) return
      // 公開の取り下げは行が残るのでそのまま読み直す。消えた行だけ薄くして外す。
      const goneId = deleteTarget.kind === 'managed' && deleteTarget.group.status !== 'published'
        ? deleteTarget.group.id
        : null
      setDeleteTarget(null)
      if (goneId) leave(goneId, () => reload())
      else await reload()
    } catch (e) {
      if (!sameDeleteImpactRequest(impactRequestRef.current, request)) return
      /* 409は「読んだあとに状態が変わった」。新しい影響を描き直す。 */
      if (e instanceof ApiError && e.status === 409) {
        const latest = impactFromError(e.data)
        if (latest && impactMatchesRequest(latest, request)) {
          setImpact(latest)
          setImpactPhase('ready')
        } else if (deleteTarget.kind === 'managed') {
          void loadImpact(request)
        }
      }
      setDeleteError(richMenuError(e, action))
    } finally {
      if (sameDeleteImpactRequest(impactRequestRef.current, request)) setDeleteBusy(false)
    }
  }

  function handleImport(menu: LineMenu) {
    if (!selectedAccount?.id) return
    setImportError(null)
    setImportTarget(menu)
  }

  async function confirmImport() {
    if (!selectedAccount?.id || !importTarget || importBusy) return
    const menu = importTarget
    const accountId = selectedAccount.id
    const requestGeneration = ++importRequestGenerationRef.current
    setImportBusy(true)
    setImportError(null)
    try {
      const res = await api.richMenuGroups.importFromLine(menu.richMenuId, accountId)
      if (importRequestGenerationRef.current !== requestGeneration || activeAccountRef.current !== accountId) return
      if (!res.success) throw new Error('import_failed')
      setImportTarget(null)
      setImportedMenuName(res.data?.name ?? menu.name)
      await reload()
    } catch (e) {
      if (importRequestGenerationRef.current !== requestGeneration || activeAccountRef.current !== accountId) return
      setImportError(richMenuError(e, 'import'))
    } finally {
      if (importRequestGenerationRef.current === requestGeneration && activeAccountRef.current === accountId) {
        setImportBusy(false)
      }
    }
  }

  /* ===== 数の帯 ===== */
  const tapsByGroup = new Map((tapStats?.byGroup ?? []).map((g) => [g.groupId, g.taps]))
  const topArea = tapStats?.byArea[0] ?? null
  const topAreaGroupName = topArea ? groups.find((g) => g.id === topArea.groupId)?.name ?? null : null
  const groupKpiState = !selectedAccount?.id ? 'unselected' : loading ? 'loading' : error ? 'error' : 'ready'
  const groupKpiReady = groupKpiState === 'ready'
  const groupKpiUnavailableText =
    groupKpiState === 'unselected'
      ? 'LINEアカウントを選ぶと表示します'
      : groupKpiState === 'loading'
        ? '読み込んでいます'
        : '一覧を読み込めませんでした'
  const tapKpiState = !selectedAccount?.id
    ? 'unselected'
    : tapStatsStatus === 'loading'
      ? 'loading'
      : tapStatsStatus === 'ready'
        ? 'ready'
        : 'error'
  const tapKpiReady = tapKpiState === 'ready'
  const tapKpiUnavailableText =
    tapKpiState === 'unselected'
      ? 'LINEアカウントを選ぶと表示します'
      : tapKpiState === 'loading'
        ? '読み込んでいます'
        : '集計を取れませんでした'

  /* ===== 絞り込み・ページ ===== */
  const pageCount = Math.max(1, Math.ceil(groupTotal / pageSize))
  const currentPage = Math.min(page, pageCount)
  const filterActive = query.trim() !== '' || savedFilter !== '' || folderFilter !== ''
  const clearFilters = () => {
    setView({ q: '', view: '', folder: '', page: '1' })
  }

  // アカウントを替えたらページは 1 へ（来た瞬間は URL のまま）。
  useOnAccountSwitch(selectedAccount?.id, () => setPage(1))

  // 読み終わってから。読み込み中（件数 0）に詰めると、URL から戻したページが 1 になる。
  useEffect(() => {
    if (!loading && !error && page > pageCount) setPage(pageCount)
  }, [loading, error, page, pageCount, setPage])

  useListScrollMemory(!loading)

  /* ===== 行の「…」（編集・表示先・切替のつながり・複製・取り下げ／削除） ===== */
  const rowMenuItems = (g: RichMenuGroupListItem): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [
      { id: 'edit', label: '編集', onSelect: () => router.push(`/rich-menus/edit?id=${g.id}`) },
    ]
    if (g.status === 'published') {
      items.push({
        id: 'apply',
        label: '表示先を変える',
        onSelect: () => setApplyTo(g),
      })
    }
    items.push({
      id: 'connections',
      label: '切替のつながりを見る',
      onSelect: () => router.push(`/rich-menus/connections?id=${encodeURIComponent(g.id)}`),
    })
    items.push({
      id: 'duplicate',
      label: '複製する',
      onSelect: () => {
        setDuplicateError(null)
        setDuplicateTarget(g)
      },
    })
    items.push({
      id: 'delete',
      label: g.status === 'published' ? '取り下げ・削除する' : '削除する',
      tone: 'danger',
      dividerBefore: true,
      onSelect: () => handleDelete(g),
    })
    // 閲覧のみには押せない項目を置かない（2026-10-06 オーナー決定）。見る項目だけ残す。
    return canEdit ? items : items.filter((item) => item.id === 'edit' || item.id === 'connections')
  }

  /* ===== フォルダ ===== */
  /* 行の名前の前の丸は、左のフォルダの列と同じフォルダ（同じ色）を引く。無ければ未分類の輪。 */
  const folderDotOf = (folderId: string | null | undefined) => {
    const folder = folderId ? folders.find((f) => f.id === folderId) : undefined
    return folder ? { name: folder.name, color: folder.color } : null
  }
  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: groupFacets?.total ?? groupTotal },
    ...folders.map((f) => ({
      id: f.id,
      label: f.name,
      count: groupFacets?.folderCounts[f.id] ?? 0,
      color: f.color,
    })),
    { id: UNFILED, label: '未分類', count: groupFacets?.folderCounts[UNFILED] ?? 0 },
  ]
  const folderSelectOptions = [
    { value: '', label: 'フォルダ：すべて' },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
    { value: UNFILED, label: '未分類' },
  ]

  const goCreate = () => router.push('/rich-menus/new')
  const createButton = canEdit ? (
    <Button
      type="button"
      variant="primary"
      className={narrow ? undefined : styles.createWide}
      onClick={goCreate}
    >
      <Plus size={15} aria-hidden="true" />
      メニューを作る
    </Button>
  ) : null

  const folderPanel = (
    <FolderPanel
      createAction={createButton ?? <span className={styles.viewerCreateSpace} aria-hidden="true" />}
      activeId={folderFilter}
      onSelect={(id) => {
        setFolderFilter(id)
        setPage(1)
      }}
      onAddFolder={canEdit ? () => setFolderDialogOpen(true) : undefined}
      addFolderLabel="フォルダを追加"
      rows={folderRows}
    >
      <p className={styles.folderNote}>フォルダを消しても、中のメニューは未分類に残ります</p>
    </FolderPanel>
  )

  const folderSelect = (
    <Select
      aria-label="フォルダ"
      value={folderFilter}
      onChange={(value) => {
        setFolderFilter(value)
        setPage(1)
      }}
      options={folderSelectOptions}
    />
  )

  /* ===== 道具の段 ===== */
  const filterChips = (
    <div role="group" aria-label="絞り込み" className={styles.chips}>
      {FILTER_CHIPS.map((f) => (
        <FilterChip
          key={f.key}
          selected={savedFilter === f.key}
          onChange={() => setSavedFilter(savedFilter === f.key ? '' : f.key)}
          title={f.note}
          icon={<f.icon size={13} aria-hidden="true" />}
        >
          {f.label}
        </FilterChip>
      ))}
    </div>
  )
  /* 並び（絵に無いが機能がある）。右端の件数の左に、印だけの小さな箱で置く。 */
  const sortBox = (
    <div className={styles.sortBox} title={`並び：${SORT_OPTIONS.find((o) => o.value === sortKey)?.label ?? ''}`}>
      <ArrowDownUp size={14} aria-hidden="true" className={styles.sortIcon} />
      <Select
        aria-label="並び順"
        value={sortKey}
        onChange={(value) => setSortKey(value as SortKey)}
        options={SORT_OPTIONS}
      />
    </div>
  )
  const perPageBox = (
    <div className={styles.perPageBox} data-per-page-select>
      <Select
        aria-label="1ページに出す件数"
        size="page-size"
        value={String(pageSize)}
        onChange={(value) => {
          setPageSize(Number(value))
          setPage(1)
        }}
        options={PAGE_SIZE_OPTIONS}
      />
    </div>
  )
  const priorityNotice = (
    <Notice tone="info" icon={<ListOrdered size={16} />} className={styles.priorityNotice}>
      {PRIORITY_NOTE}
    </Notice>
  )

  /* 1152 の板（Y9ASp）：案内の帯 → 1段目「作る・フォルダ・探す … 件数」→ 2段目「札」。 */
  const narrowToolbar = (
    <div className={styles.narrowTools}>
      {priorityNotice}
      <div className={styles.narrowRow}>
        {createButton}
        <div className={styles.narrowFolder}>{folderSelect}</div>
        <div className={styles.narrowSearch}>
          <SearchField
            placeholder="メニュー名・ボタン名"
            aria-label="メニュー名・ボタン名で検索"
            value={query}
            onChange={(value) => {
              setQuery(clampSearchQuery(value))
              setPage(1)
            }}
            onClear={() => setQuery('')}
          />
        </div>
        <span className={styles.spacer} aria-hidden="true" />
        {sortBox}
        {perPageBox}
      </div>
      <div className={styles.narrowRow}>{filterChips}</div>
    </div>
  )

  const wideToolbar = (
    <>
      <div className={styles.noticeRow}>{priorityNotice}</div>
      <ListToolbar
        search={{
          placeholder: 'メニュー名・ボタン名',
          label: 'メニュー名・ボタン名で検索',
          width: 200,
          value: query,
          onChange: (value) => {
            setQuery(clampSearchQuery(value))
            setPage(1)
          },
        }}
        filters={filterChips}
        trailing={<>{sortBox}{perPageBox}</>}
      />
    </>
  )

  /* ===== 一覧の中身（空・絞り込み0件・読み込み中・読み込めなかった） ===== */
  const loadFailure = isForbiddenOrRateLimited(loadError) ? loadFailureCopy(loadError, 'リッチメニュー') : null
  const listLoading = loading && groups.length === 0 && !error

  const tableCols = (
    <colgroup>
      <col className={styles.colOrder} />
      <col className={styles.colThumb} />
      <col />
      <col className={styles.colAudience} />
      <col className={styles.colState} />
      <col className={styles.colCount} />
      <col className={styles.colMenu} />
    </colgroup>
  )
  const tableHead = (
    <thead>
      <TableHeadRow>
        <Th>順</Th>
        <Th aria-label="見本" />
        <Th>メニュー（大きさ・ボタン）</Th>
        <Th>誰に出すか</Th>
        <Th>状態</Th>
        <Th>今月押された</Th>
        <Th aria-label="操作" />
      </TableHeadRow>
    </thead>
  )

  const loadingSkeleton = (
    <div className={styles.skeletonRows} aria-label="読み込み中">
      {[0, 1, 2, 3].map((n) => (
        <div key={n} className={styles.skeletonRow} data-skeleton aria-hidden="true">
          <span className={styles.skeletonThumb} />
          <span className={styles.skeletonBar} />
          <span className={styles.skeletonBar} />
          <span className={styles.skeletonBar} />
        </div>
      ))}
    </div>
  )

  const stateCard = (icon: React.ReactNode, title: string, desc: string, action: React.ReactNode, tone?: 'error') => (
    <div className={styles.stateCard}>
      <span className={tone === 'error' ? `${styles.stateIcon} ${styles.stateIconError}` : styles.stateIcon}>{icon}</span>
      <p className={styles.stateTitle}>{title}</p>
      <p className={styles.stateDesc}>{desc}</p>
      {action}
    </div>
  )

  const listBody = !selectedAccount ? (
    stateCard(<ImageIcon size={16} aria-hidden="true" />, 'LINEアカウントを選んでください', 'LINEアカウントを選ぶと表示します。', null)
  ) : listLoading ? (
    <div aria-busy="true" aria-label="読み込んでいます">
      <DelayedSkeleton loading skeleton={loadingSkeleton} />
    </div>
  ) : error ? (
    stateCard(
      <TriangleAlert size={16} aria-hidden="true" />,
      loadFailure?.title ?? 'リッチメニューを読み込めませんでした',
      loadFailure?.description
        ?? '登録したメニューは消えていません。数の帯は「—」、道具はそのまま使えます（条件を変えてから試し直せる）。',
      loadFailure === null || loadFailure.retryable
        ? <Button type="button" onClick={() => void reload()}>もう一度試す</Button>
        : null,
      'error',
    )
  ) : groups.length === 0 ? (
    /* 修正案 D-2：空の一覧。 */
    <EmptyList
      icon={<ImageIcon aria-hidden="true" />}
      title="まだリッチメニューがありません"
      description="トーク画面の下に、ボタンのメニューを出します。"
      create={{ label: '最初のリッチメニューを作る', onClick: goCreate }}
      canCreate={canEdit}
      filtered={filterActive}
      onClearFilters={clearFilters}
      filteredDescription="「公開中」「予約」「下書き」「出し分け」や検索を外すと、すべて出ます"
    />
  ) : (
    <>
      <span className="sr-only" role="status" aria-live="polite">{moveNotice}</span>
      <div className={styles.tableWrap} aria-busy={loading || undefined}>
        <DataTable>
          {tableCols}
          {tableHead}
          <tbody ref={bodyRef}>
            {liveOrder.shown.map((g) => {
              const cells = thumbCells(g)
              const shape = menuShapeText(g)
              const audienceMain = audienceMainText(g, tagNameById)
              const audienceSub = audienceSubText(g)
              const taps = g.monthlyStats
                ? g.monthlyStats.taps
                : tapStats
                  ? tapsByGroup.get(g.id) ?? null
                  : null
              const menuLabel = `リッチメニュー「${g.name}」の操作`
              return (
                <Tr
                  interactive
                  key={g.id}
                  data-reorder-id={g.id}
                  onDragEnter={() => liveOrder.enter(g.id)}
                  onDragOver={dragId ? (event) => event.preventDefault() : undefined}
                  onDrop={dragId ? () => void dropOn(liveOrder.dropTarget(g.id)) : undefined}
                  className={styles.row}
                  leaving={leavingId === g.id}
                  tabIndex={0}
                  onClick={() => router.push(`/rich-menus/edit?id=${g.id}`)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      router.push(`/rich-menus/edit?id=${g.id}`)
                    }
                  }}
                >
                  <Td
                    className={styles.orderCell}
                    onClick={(event) => event.stopPropagation()}
                    draggable={reorderDisabledReason === null}
                    onDragStart={() => setDragId(g.id)}
                    onDragEnd={() => setDragId(null)}
                  >
                    <span className={styles.orderInner}>
                      {/* 閲覧のみ：つまみは隠し、幅だけ空けて順番の数字の位置を保つ */}
                      {!canEdit && <span className={styles.gripSpace} aria-hidden="true">⠿</span>}
                      {canEdit && <ReorderGrip
                        label={g.name}
                        disabled={reorderDisabledReason !== null}
                        disabledReason={reorderDisabledReason ?? undefined}
                        onMove={(direction) => void keyboardMove(g.id, direction)}
                      >
                        <span aria-hidden>⠿</span>
                      </ReorderGrip>}
                      <span className={styles.orderNumber}>{g.targetingPriority + 1}</span>
                    </span>
                  </Td>
                  <Td>
                    <span className={styles.thumb} data-rows={cells.rows} aria-hidden="true">
                      {g.thumbnailR2Key ? (
                        // eslint-disable-next-line @next/next/no-img-element -- 管理画面内のサムネ。Worker の認証つき口をそのまま使う
                        <img src={api.richMenuGroups.imageUrl(g.thumbnailR2Key)} alt="" loading="lazy" />
                      ) : (
                        Array.from({ length: cells.rows }, (_, r) => (
                          <span key={r} className={styles.thumbRow}>
                            {Array.from({ length: cells.cols }, (_, c) => <span key={c} className={styles.thumbCellPart} />)}
                          </span>
                        ))
                      )}
                    </span>
                  </Td>
                  <Td className={styles.nameCell}>
                    <FolderDotName folder={folderDotOf(g.folderId)}>
                      <Link
                        href={`/rich-menus/edit?id=${g.id}`}
                        title={g.name}
                        className={styles.name}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {g.name}
                      </Link>
                    </FolderDotName>
                    <span className={`${styles.sub} ${styles.nameSub}`} title={`${shape}・ボタン「${g.chatBarText}」・${formatDay(g.updatedAt)} 更新`}>
                      {`${shape}・ボタン「${g.chatBarText}」・${formatDay(g.updatedAt)} 更新`}
                    </span>
                  </Td>
                  <Td className={styles.audienceCell}>
                    <span className={audienceSub ? styles.audienceMain : `${styles.audienceMain} ${styles.audienceAlone}`} title={audienceMain}>{audienceMain}</span>
                    {audienceSub ? <span className={styles.sub} title={audienceSub}>{audienceSub}</span> : null}
                  </Td>
                  <Td>
                    {g.publishingAt ? (
                      <span className={`${styles.pill} ${styles.pillScheduled}`}>
                        <span className={styles.pillDot} aria-hidden="true" />
                        {`${shortDay(g.publishingAt)} 公開`}
                      </span>
                    ) : (
                      <span className={`${styles.pill} ${g.status === 'published' ? styles.pillLive : styles.pillDraft}`}>
                        <span className={styles.pillDot} aria-hidden="true" />
                        {g.status === 'published' ? '公開中' : '下書き'}
                      </span>
                    )}
                  </Td>
                  <Td
                      className={styles.countMain}
                      title={g.monthlyStats?.uniqueAudience.value != null
                        ? `のべ${formatNumber(g.monthlyStats.uniqueAudience.value)}人${g.monthlyStats.uniqueAudience.state === 'partial' ? '（記録開始後）' : ''}`
                        : undefined}
                    >
                      {taps == null ? '—' : `${formatNumber(taps)}回`}
                    </Td>
                  <Td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
                    <div className={styles.menuBox}>
                      <IconButton
                        className={styles.menuBtn}
                        title={menuLabel}
                        aria-label={menuLabel}
                        aria-expanded={openMenuId === g.id}
                        onClick={() => setOpenMenuId((current) => (current === g.id ? null : g.id))}
                      >
                        <MoreHorizontal size={16} aria-hidden="true" />
                      </IconButton>
                      <ActionMenu
                        open={openMenuId === g.id}
                        onClose={() => setOpenMenuId(null)}
                        ariaLabel={menuLabel}
                        items={rowMenuItems(g)}
                      />
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </DataTable>
      </div>
    </>
  )

  /* 表の下：件数（1ページでも出す・絵どおり）とページ送り。 */
  const listPager = selectedAccount && !listLoading && !error && groups.length > 0 ? (
    <div className={styles.pagerRow}>
      <span className={styles.pagerCount}>
        {pageCount > 1
          ? `${(currentPage - 1) * pageSize + 1}〜${Math.min(currentPage * pageSize, groupTotal)} / ${formatNumber(groupTotal)}件`
          : `${formatNumber(groupTotal)}件`}
      </span>
      {pageCount > 1 ? (
        <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} ariaLabel="リッチメニューのページ送り" />
      ) : null}
    </div>
  ) : null

  /* ===== 削除の窓（yOyCg：消せない理由を外す順に。読めないときは消させない） ===== */
  const managedDelete = deleteTarget?.kind === 'managed' ? deleteTarget.group : null
  /*
   * 理由は「何になっているか」を短く1行ずつ、外す操作を右に（yOyCg）。
   * 「LINEに登録中」と「LINE上に残っている」はどちらも取り下げで外れるので1行にまとめる。
   */
  const blockerRows: BlockedRow[] = []
  if (blockedDelete && impact && managedDelete) {
    const keys = impact.blockers
    const unpublish = managedDelete.status === 'published' && canEdit
      ? { label: 'LINEから取り下げる', onSelect: () => void confirmDelete() }
      : null
    for (const key of keys) {
      if (key === 'default_for_all') {
        blockerRows.push({
          key,
          text: blockerLabel(key, impact),
          action: canEdit ? { label: 'ほかのメニューを既定に', onSelect: closeDelete } : null,
        })
      } else if (key === 'published' || key === 'line_resources') {
        if (blockerRows.some((row) => row.key === 'published' || row.key === 'line_resources')) continue
        blockerRows.push({ key, text: blockerLabel(key, impact), action: unpublish })
      } else if (key === 'incoming_switches') {
        blockerRows.push({
          key,
          text: blockerLabel(key, impact),
          action: { label: '切替を外す', onSelect: () => router.push(`/rich-menus/connections?id=${encodeURIComponent(managedDelete.id)}`) },
        })
      } else {
        blockerRows.push({ key, text: blockerLabel(key, impact), action: null })
      }
    }
  }

  const blockedDialog = blockedDelete && managedDelete && impact ? (
    <BlockedDeleteDialog
      title={`「${managedDelete.name}」はまだ消せません`}
      description={impact.nextDisplay.candidates.length === 0
        ? `消すと、リッチメニューが出なくなる友だちがいます（${audienceText(impact.currentAudience)}）。先に下の順に外してください。`
        : `${nextDisplayText(impact.nextDisplay)}先に下の順に外してください。`}
      rows={blockerRows}
      busy={deleteBusy}
      error={deleteError}
      onClose={closeDelete}
      footer={<>
        <Button type="button" variant="secondary" onClick={closeDelete} disabled={deleteBusy}>閉じる</Button>
        {managedDelete.status === 'published' && canEdit ? (
          <Button type="button" variant="secondary" onClick={() => void confirmDelete()} disabled={deleteBusy}>
            <CloudOff size={15} aria-hidden="true" />
            LINEから取り下げる
          </Button>
        ) : null}
      </>}
    />
  ) : null

  const deleteConfirm = (
    <ConfirmDialog
      open={deleteTarget !== null && !blockedDelete}
      title={
        deleteTarget
          ? `「${deleteTarget.kind === 'managed' ? deleteTarget.group.name : deleteTarget.menu.name}」を削除しますか？`
          : 'リッチメニューを削除しますか？'
      }
      description={
        deleteTarget?.kind === 'managed'
          ? deleteTarget.group.status === 'published'
            ? 'いま表示中の人と使用先を確認し、まずLINEから取り下げます。取り下げても管理画面の設定は残ります。'
            : '管理画面に保存したこのリッチメニューを削除します。元には戻せません。'
          : 'この管理画面外で作成されたリッチメニューを、LINE公式アカウントから削除します。'
      }
      confirmLabel={deleteTarget?.kind === 'external' ? 'LINEから削除' : deleteTarget?.kind === 'managed' && deleteTarget.group.status === 'published' ? 'LINEから取り下げる' : '削除する'}
      destructive={deleteTarget?.kind === 'external' || (deleteTarget?.kind === 'managed' && deleteTarget.group.status === 'draft')}
      busy={deleteBusy}
      error={deleteError ?? undefined}
      onCancel={closeDelete}
      {...(deleteTarget?.kind === 'external' || (deleteTarget?.kind === 'managed' && deleteTarget.group.status === 'published') || canDeleteImpact({ impact, busy: deleteBusy })
        ? { onConfirm: () => void confirmDelete() }
        : {})}
    >
      {deleteTarget?.kind === 'managed' ? (
        <div className={styles.impact}>
          <p>
            <strong>{deleteTarget.group.status === 'published' ? '取り下げるもの：' : '消えるもの：'}</strong>
            {deleteTarget.group.status === 'published' ? 'LINE上のこのリッチメニュー' : 'このリッチメニューの設定と画像'}
          </p>
          <p>
            <strong>残るもの：</strong>
            {deleteTarget.group.status === 'published' ? '管理画面の設定と、これまでのタップ記録' : '同じフォルダのほかのメニューと、これまでのタップ記録'}
          </p>
          {deleteTarget.group.status === 'draft'
            ? <p className={styles.impactDanger}>元に戻せません。</p>
            : <p>取り下げは、もう一度公開すれば戻せます。取り下げたあと、管理画面から削除できます。</p>}
          {impactPhase === 'loading' ? (
            <p className={styles.impactFaint}>消したときの影響を確認しています…</p>
          ) : impactPhase === 'error' ? (
            <p className={styles.impactDanger} role="alert">消したときの影響を確認できませんでした。読み直してから、もう一度お試しください。</p>
          ) : impact ? (
            <div className={styles.impactDetail}>
              <p>
                <strong>いま表示している人数：</strong>
                {audienceText(impact.currentAudience)}
                {audienceReason(impact.currentAudience) ? `（${audienceReason(impact.currentAudience)}）` : ''}
              </p>
              <p><strong>次に出るメニュー：</strong>{nextDisplayText(impact.nextDisplay)}</p>
              <p>
                <strong>切替元：</strong>
                {impact.incomingSwitches.length === 0
                  ? 'ありません'
                  : impact.incomingSwitches.map((sw) => `${sw.sourceGroupName}の「${sw.areaLabel ?? sw.sourcePageName}」`).join('・')}
              </p>
              <p>
                <strong>使っている自動処理：</strong>
                {impact.operationalReferences.length === 0
                  ? 'ありません'
                  : impact.operationalReferences.map((ref) => `${referenceKindText(ref.kind)}「${ref.ownerName}」`).join('・')}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.impact}>
          <p><strong>消えるもの：</strong>LINE公式アカウント上のこのリッチメニュー</p>
          <p><strong>残るもの：</strong>管理画面で作成・編集しているほかのリッチメニュー</p>
          <p className={styles.impactDanger}>元に戻せません。</p>
        </div>
      )}
    </ConfirmDialog>
  )

  return (
    <ListPage
      boardId={!canEdit ? 'ZoKow' : narrow ? 'Y9ASp' : 'rZEGN'}
      headingSize="regular"
      title="リッチメニュー"
      description="トーク画面の下に出るボタンのメニューです。友だちの条件ごとに出し分けられます。"
      actions={
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowExternal(true)}
          title="LINEの画面で直接作ったメニューを見て、取り込めます"
        >
          <CloudDownload size={15} aria-hidden="true" />
          LINE上にあるメニュー
        </Button>
      }
      stats={<>
        {/* 見るだけの人への帯（ZoKow）。数の帯の上。 */}
        {!canEdit ? (
          <div className={styles.viewerBand} role="status">
            <Eye size={16} aria-hidden="true" />
            <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
          </div>
        ) : null}
        <KpiBand data-design="KPIs" className={styles.kpis}>
          <KpiCard
            presentation="band"
            title="公開中"
            icon={<CircleCheck size={13} aria-hidden="true" />}
            value={groupKpiReady ? groupFacets?.published ?? null : null}
            unit={groupKpiReady && groupFacets?.published != null ? '件' : ''}
            detail={groupKpiReady
              ? groupFacets?.published != null
                ? `下書き ${(groupFacets?.total ?? groupTotal) - groupFacets.published}件`
                : '下書き —'
              : groupKpiUnavailableText}
          />
          <KpiCard
            presentation="band"
            title="今月押された"
            icon={<Hand size={13} aria-hidden="true" />}
            value={tapKpiReady ? tapStats?.total ?? null : null}
            unit={tapKpiReady && tapStats?.total != null ? '回' : ''}
            detail={tapKpiReady ? 'ボタンが押された回数' : tapKpiUnavailableText}
          />
          <KpiCard
            presentation="band"
            title="いちばん押された"
            icon={<Trophy size={13} aria-hidden="true" />}
            value={null}
            unit=""
            valueText={topArea ? topArea.label || '名前のないボタン' : '—'}
            detail={topArea
              ? `${topAreaGroupName ? `${topAreaGroupName}・` : ''}${formatNumber(topArea.taps)}回`
              : tapKpiReady
                ? (tapStats?.total ?? 0) > 0
                  ? '内訳はまだ集まっていません'
                  : 'まだ押されていません'
                : tapKpiUnavailableText}
          />
          <KpiCard
            presentation="band"
            title="出し分け"
            icon={<Split size={13} aria-hidden="true" />}
            value={groupKpiReady ? groupFacets?.targeting ?? null : null}
            unit={groupKpiReady && groupFacets?.targeting != null ? '件' : ''}
            detail={groupKpiReady
              ? (groupFacets?.targeting ?? 0) > 0
                ? 'タグの条件で切り替わる'
                : 'タグ条件で出し分けているメニューはありません'
              : groupKpiUnavailableText}
          />
        </KpiBand>
      </>}
      folders={narrow ? undefined : folderPanel}
      toolbar={narrow ? narrowToolbar : wideToolbar}
      pagination={listPager}
      overlays={<>
        {folderDialogOpen ? (
          <FolderAddDialog
            kind="rich_menu"
            note="メニューを分けてしまう箱です。消しても、入っていたメニューは未分類として残ります。"
            placeholder="例: 01_会員向け"
            onClose={() => setFolderDialogOpen(false)}
            onAdded={() => void loadFolders()}
          />
        ) : null}

        {/* 「LINE上にあるメニュー」の作業画面。 */}
        {showExternal && selectedAccount ? (
          <div className={styles.externalLayer}>
            <ExternalImportWorkspace
              external={external}
              loading={externalStatus === 'loading'}
              error={externalError}
              onBack={() => setShowExternal(false)}
              onReload={() => void reload()}
              onImport={handleImport}
            />
          </div>
        ) : null}

        {applyTo ? (
          <ApplyToTagModal groupId={applyTo.id} groupName={applyTo.name} onClose={() => setApplyTo(null)} />
        ) : null}

        <ConfirmDialog
          open={duplicateTarget !== null}
          title={duplicateTarget ? `「${duplicateTarget.name}」を複製しますか？` : 'リッチメニューを複製しますか？'}
          description="名前・画像・ボタン・出し分けの設定を写した下書きを新しく作ります。LINE上の表示は変わりません。"
          confirmLabel="下書きとして複製する"
          busy={duplicateBusy}
          error={duplicateError ?? undefined}
          onCancel={() => {
            if (duplicateBusy) return
            setDuplicateTarget(null)
            setDuplicateError(null)
          }}
          onConfirm={() => void confirmDuplicate()}
        />

        <ConfirmDialog
          open={importTarget !== null}
          designNode="TL7tp"
          title={importTarget ? `「${importTarget.name}」を管理画面に取り込みますか？` : 'LINE上のメニューを管理画面に取り込みますか？'}
          description="LINE公式アカウント上にある設定を読み取り、管理画面へ新しく追加します。"
          confirmLabel="管理画面に取り込む"
          busy={importBusy}
          error={importError ?? undefined}
          onCancel={() => {
            if (importBusy) return
            setImportTarget(null)
            setImportError(null)
          }}
          onConfirm={() => void confirmImport()}
        >
          <div className={styles.impact}>
            <p><strong>管理画面に追加するもの：</strong>名前・画像・ボタンの設定</p>
            <p><strong>上書きするもの：</strong>ありません。すでに管理中のメニューは重ねて取り込みません。</p>
            <p><strong>LINE上に残るもの：</strong>現在のメニューと、友だちに表示している状態</p>
          </div>
        </ConfirmDialog>

        <ConfirmDialog
          open={importedMenuName !== null}
          designNode="TL7tp"
          title={importedMenuName ? `「${importedMenuName}」を管理画面に取り込みました` : '管理画面に取り込みました'}
          description="LINE上の表示は変更していません。管理画面で編集できるようになりました。"
          onCancel={() => setImportedMenuName(null)}
        />

        {blockedDialog}
        {deleteConfirm}
      </>}
    >
      {actionError ? (
        <p className={styles.errorBand} role="alert">
          {actionError}
          <button type="button" onClick={() => void reload()}>読み直す</button>
        </p>
      ) : null}
      {listBody}
    </ListPage>
  )
}
