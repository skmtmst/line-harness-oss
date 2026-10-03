'use client'

/*
 * ★V8 リッチメニューの一覧（Pencil「★V8 画面の地図」のリッチメニューの行：
 * 一覧 `rZEGN`、状態の板 `f3SoAm`、削除できない理由の窓 `yOyCg`）。
 *
 * v7 の一覧（app/rich-menus/page.tsx 内の RichMenusPageV7）とは別の部品として
 * 持つ。データの口は同じ。違いは置き場と見せ方だけ——
 * 「メニューを作る」は左のフォルダの列の上、見出しの右は「LINE上にあるメニュー」、
 * 行の左端は出す順番のつまみ（ドラッグまたは上下キー）、右端は「…」。
 * 行を押すと編集画面 `/rich-menus/edit` へ移る。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useState, useEffect, useCallback, useRef, useDeferredValue } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CircleCheck,
  CloudDownload,
  Hand,
  Image as ImageIcon,
  MousePointerClick,
  Search as SearchIcon,
  Split,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { api, ApiError, type RichMenuDeleteImpact, type RichMenuTapStats } from '@/lib/api'
import type { RichMenuGroupListItem } from '@/lib/api'
import { clampSearchQuery } from '@/lib/search-query'
import type { SegmentCondition } from '@/lib/segment-condition'
import { describeCondition } from '@/components/scenarios/scenario-dialogs'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { formatDay, formatNumber } from '@/lib/format'
import { isForbiddenOrRateLimited, loadFailureCopy } from '@/components/shared/api-error-message'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Pagination from '@/components/shared/pagination'
import ReorderGrip from '@/components/friend-fields/reorder-grip'
import { ApplyToTagModal } from '@/components/rich-menus/apply-to-tag-modal'
import {
  audienceReason,
  audienceText,
  blockerTexts,
  canDelete as canDeleteImpact,
  impactMatchesRequest,
  impactFromError,
  nextDisplayText,
  recommendedActionText,
  referenceKindText,
  sameDeleteImpactRequest,
  type DeleteImpactRequest,
} from './delete-impact'
import { moveTargetingGroup, orderTargetingGroups } from './targeting-order'
import { ExternalImportWorkspace, type LineMenu } from './external-import'
import { richMenuError, richMenuErrorAll } from './rich-menu-errors'
import styles from './list-v8.module.css'

/** フォルダに入れていないものを選ぶための、内部だけの値。 */
const UNFILED = '__unfiled__'

type SortKey = 'taps' | 'updated' | 'name' | 'priority'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'priority', label: '出す順番（自分で決めた順）' },
  { value: 'taps', label: '今月押された順' },
  { value: 'updated', label: '更新が新しい順' },
  { value: 'name', label: '名前順' },
]

const PAGE_SIZE_OPTIONS = [
  { value: '20', label: '20件表示' },
  { value: '50', label: '50件表示' },
  { value: '100', label: '100件表示' },
]

/*
 * 道具の段の札（設計 `rZEGN`：公開中・予約・下書き・出し分け）。
 * v7 の savedFilter と同じ4つ。もう一度押すと外れる（排他）。
 */
const FILTER_CHIPS: { key: string; label: string; note: string }[] = [
  { key: 'published', label: '公開中', note: 'いまLINEで公開しているメニュー' },
  { key: 'scheduled', label: '予約', note: '公開日時を予約したメニュー' },
  { key: 'draft', label: '下書き', note: 'まだLINEで公開していないメニュー' },
  { key: 'targeting', label: '出し分け', note: '出す相手の条件を指定したメニュー' },
]

const NO_MANAGE_NOTE =
  'リッチメニューの作成・変更・公開・削除はオーナーと管理者だけができます。一覧と切替のつながりはこのまま見られます。'

type DeleteTarget =
  | { kind: 'managed'; group: RichMenuGroupListItem }
  | { kind: 'external'; menu: LineMenu }

/** 「大・6面・切替タブ 2」の形にする。面数が取れないときは大きさだけ。 */
function menuShapeText(g: RichMenuGroupListItem): string {
  const size = g.size === 'large' ? '大' : '小'
  const areas = g.defaultPageAreaCount != null && g.defaultPageAreaCount > 0
    ? `${g.defaultPageAreaCount}面`
    : '面の区切りなし'
  const pages = g.pageCount ?? 0
  const tabs = pages > 1 ? `・切替タブ ${pages}` : '・切替タブ なし'
  return `${size}・${areas}${tabs}`
}

/** 「誰に出すか」の主行。タグ1つの条件なら「タグ『◯◯』」、複雑なら件数で言う。 */
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
  if (g.publishingAt && g.isDefaultForAll) return `${formatDay(g.publishingAt)} から既定`
  if (g.targetingEnabled && g.targetingCondition) {
    return g.audienceCount != null ? `対象 ${formatNumber(g.audienceCount)}人` : '対象の人数は未取得'
  }
  if (g.isDefaultForAll) return '（既定）'
  if (g.status === 'draft') return null
  return null
}

export default function RichMenusListV8() {
  usePageTitle('リッチメニュー')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccount } = useAccount()
  /*
   * 作成・公開・削除などの書き込み口は API が requireRole('owner','admin') で
   * 閉じている（設計 `f3SoAm` の「閲覧のみ」）。staff へ押せる形で出すと
   * 403 になるだけなので、押せない形で出す（閲覧は残す）。
   */
  const [canEdit] = useState(() => (typeof window === 'undefined' ? true : isOwnerOrAdmin()))

  const [showExternal, setShowExternal] = useState(false)
  const activeAccountRef = useRef<string | null>(selectedAccount?.id ?? null)
  const importRequestGenerationRef = useRef(0)
  /** PERF-05: このアカウントで外部状態を一度でも取ったか。変更有後の取り直し判定に使う。 */
  const externalLoadedRef = useRef(false)
  const [groups, setGroups] = useState<RichMenuGroupListItem[]>([])
  const [query, setQuery] = useState('')
  const [external, setExternal] = useState<{
    currentDefault: string | null
    lineMenus: LineMenu[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  /* 並び替えなど一覧とは別の操作の失敗。読み込み失敗は状態カードが担うので分ける。 */
  const [actionError, setActionError] = useState<string | null>(null)
  const [applyTo, setApplyTo] = useState<RichMenuGroupListItem | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('priority')
  const [savedFilter, setSavedFilter] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
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
  /* 消したときの影響（契約 #608）。窓を開けてから読む（v7 と同じ）。 */
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
    setPage(1)
    if (!selectedAccount?.id) setLoading(false)
  }, [selectedAccount?.id])

  /* 一覧の検索・ページングはD1の一覧だけを取り直す（v7 と同じ PERF-05 の判断）。 */
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

  /** タップ集計。数が取れなくても一覧は出す（付随情報なので本体は止めない）。 */
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
      if (res.success) {
        setTagNameById(new Map(res.data.map((t) => [t.id, t.name])))
      }
    } catch {
      // タグ名が取れなくても一覧は出す。条件は件数表記へ落ちる。
    }
  }, [selectedAccount?.id])

  /* LINE上の外部状態。外部APIへの重い口なので作業画面を開いてから取る（v7 と同じ）。 */
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
      const accountId = selectedAccount?.id ?? undefined
      const res = await api.folders.list('rich_menu', accountId)
      if (res.success) setFolders(res.data)
    } catch {
      // 置き場が取れなくても一覧は出す。取れない失敗で画面を落とさない。
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
   * 出す順番の入れ替え（設計 `rZEGN` の行の左のつまみ）。
   * つまみが動かせるのは「出す順番」の並びで絞り込みが無いときだけ——
   * 絞り込み中の一部だけを基準にすると、隠れているメニューとの優先関係が壊れる。
   * ページに収まりきらないときは、動かす直前に全件を取り直してから計算する
   * （v7 の「出す順番を変える」が全件で計算していたのと同じ）。
   */
  const reorderDisabledReason = !canEdit
    ? NO_MANAGE_NOTE
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

  const applyOrderedIds = useCallback(async (orderedIds: string[]) => {
    if (!selectedAccount?.id) return
    setReorderBusy(true)
    try {
      const res = await api.richMenuGroups.reorderPriorities(selectedAccount.id, orderedIds)
      if (!res.success) throw new Error(res.error ?? '並び替え失敗')
      // 並び替えで変わるのは一覧だけ。集計・外部状態は取り直さない（v7 と同じ）。
      await loadList()
      setActionError(null)
    } catch (e) {
      setActionError(richMenuError(e, 'reorder'))
    } finally {
      setReorderBusy(false)
    }
  }, [loadList, selectedAccount?.id])

  const keyboardMove = useCallback(async (id: string, direction: -1 | 1) => {
    if (reorderDisabledReason) return
    const ordered = await fullOrderedGroups()
    if (!ordered) {
      setActionError(richMenuError(new Error('load_failed'), 'reorder'))
      return
    }
    const updates = moveTargetingGroup(ordered, id, direction)
    if (!updates) return
    setMoveNotice(`「${ordered.find((g) => g.id === id)?.name ?? 'メニュー'}」を${direction === -1 ? '1つ上' : '1つ下'}へ動かしました`)
    void applyOrderedIds(updates.map((u) => u.id))
  }, [applyOrderedIds, fullOrderedGroups, reorderDisabledReason])

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
    setMoveNotice(`「${moved.name}」の順番を変えました`)
    void applyOrderedIds(working.map((g) => g.id))
  }, [applyOrderedIds, dragId, fullOrderedGroups, reorderDisabledReason])

  function beginImpactRequest(accountId: string, groupId: string): DeleteImpactRequest {
    const request = {
      accountId,
      groupId,
      generation: impactRequestGenerationRef.current + 1,
    }
    impactRequestGenerationRef.current = request.generation
    impactRequestRef.current = request
    return request
  }

  async function loadImpact(request: DeleteImpactRequest) {
    /* 遅れて返った別のメニューの結果を映さない（v7 と同じ世代管理）。 */
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
    const request = beginImpactRequest(selectedAccount.id, group.id)
    void loadImpact(request)
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
        const res = await api.richMenuGroups.deleteExternal(
          deleteTarget.menu.richMenuId,
          selectedAccount.id,
        )
        if (!res.success) throw new Error('delete_failed')
      }
      if (!sameDeleteImpactRequest(impactRequestRef.current, request)) return
      setDeleteTarget(null)
      await reload()
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
      if (
        importRequestGenerationRef.current !== requestGeneration ||
        activeAccountRef.current !== accountId
      ) return
      if (!res.success) throw new Error('import_failed')
      setImportTarget(null)
      setImportedMenuName(res.data?.name ?? menu.name)
      await reload()
    } catch (e) {
      if (
        importRequestGenerationRef.current !== requestGeneration ||
        activeAccountRef.current !== accountId
      ) return
      setImportError(richMenuError(e, 'import'))
    } finally {
      if (
        importRequestGenerationRef.current === requestGeneration &&
        activeAccountRef.current === accountId
      ) setImportBusy(false)
    }
  }

  /* ===== 数の帯 ===== */
  const topArea = tapStats?.byArea[0] ?? null
  const topAreaGroupName = topArea
    ? groups.find((g) => g.id === topArea.groupId)?.name ?? null
    : null
  const groupKpiState = !selectedAccount?.id
    ? 'unselected'
    : loading
      ? 'loading'
      : error
        ? 'error'
        : 'ready'
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

  /* 検索・札・フォルダのいずれかが効いているか（0件の出し分けに使う）。 */
  const filterActive = query.trim() !== '' || savedFilter !== '' || folderFilter !== ''
  const clearFilters = () => {
    setQuery('')
    setSavedFilter('')
    setFolderFilter('')
  }

  useEffect(() => {
    setPage(1)
  }, [folderFilter, pageSize, query, savedFilter, sortKey])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  /* ===== 行の「…」 ===== */
  const rowMenuItems = (g: RichMenuGroupListItem): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [
      {
        id: 'edit',
        label: '編集する',
        onSelect: () => router.push(`/rich-menus/edit?id=${g.id}`),
      },
    ]
    if (g.status === 'published') {
      items.push({
        id: 'apply',
        label: '表示先を変える',
        disabled: !canEdit,
        disabledReason: !canEdit ? NO_MANAGE_NOTE : undefined,
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
      disabled: !canEdit,
      disabledReason: !canEdit ? NO_MANAGE_NOTE : undefined,
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
      disabled: !canEdit,
      disabledReason: !canEdit ? NO_MANAGE_NOTE : undefined,
      onSelect: () => handleDelete(g),
    })
    return items
  }

  /* ===== フォルダの列 ===== */
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

  /* 403・429は共通の案内文へ。それ以外はこの画面の文。 */
  const loadFailure = isForbiddenOrRateLimited(loadError)
    ? loadFailureCopy(loadError, 'リッチメニュー')
    : null

  /* ===== 一覧の中身（設計 `f3SoAm`：空・絞り込み0件・読み込み中・読み込めなかった） ===== */
  const listBody = loading ? (
    <div className={styles.skeletonRows} aria-label="読み込み中">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={styles.skeletonRow}>
          <span className={styles.skeletonDot} />
          <span className={styles.skeletonBar} />
          <span className={styles.skeletonBar} style={{ flex: 0.6 }} />
          <span className={styles.skeletonBar} style={{ flex: 0.4 }} />
        </div>
      ))}
    </div>
  ) : error ? (
    <div className={styles.stateCard}>
      <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
        <TriangleAlert size={18} aria-hidden="true" />
      </span>
      <p className={styles.stateTitle}>
        {loadFailure?.title ?? 'リッチメニューを読み込めませんでした'}
      </p>
      <p className={styles.stateDesc}>
        {loadFailure?.description
          ?? '登録したメニューは消えていません。数の帯は「—」、道具はそのまま使えます（条件を変えてから試し直せる）。'}
      </p>
      {loadFailure === null || loadFailure.retryable ? (
        <Button type="button" onClick={() => void reload()}>もう一度試す</Button>
      ) : null}
    </div>
  ) : groups.length === 0 ? (
    filterActive ? (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}>
          <SearchIcon size={18} aria-hidden="true" />
        </span>
        <p className={styles.stateTitle}>条件に合うメニューはありません</p>
        <p className={styles.stateDesc}>
          「公開中」「予約」「下書き」「出し分け」や検索を外すと、すべて出ます。
        </p>
        <Button type="button" variant="secondary" onClick={clearFilters}>✕ 条件を外す</Button>
      </div>
    ) : (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}>
          <ImageIcon size={18} aria-hidden="true" />
        </span>
        <p className={styles.stateTitle}>まだリッチメニューはありません</p>
        <p className={styles.stateDesc}>
          トーク画面の下にボタンのメニューを出せます。LINEにあるメニューを取り込むこともできます。
        </p>
        {canEdit ? (
          <Button type="button" variant="primary" onClick={() => router.push('/rich-menus/new')}>
            ＋ メニューを作る
          </Button>
        ) : (
          <Button type="button" variant="primary" disabled title={NO_MANAGE_NOTE}>
            ＋ メニューを作る
          </Button>
        )}
      </div>
    )
  ) : (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {moveNotice}
      </span>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <colgroup>
            <col style={{ width: 72 }} />
            <col />
            <col style={{ width: '18%' }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr>
              <th>順</th>
              <th>メニュー（大きさ・ボタン）</th>
              <th>誰に出すか</th>
              <th>状態</th>
              <th>今月押された</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr
                key={g.id}
                className={styles.rowClick}
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
                <td
                  className={styles.orderCell}
                  onClick={(event) => event.stopPropagation()}
                  draggable={reorderDisabledReason === null}
                  onDragStart={() => setDragId(g.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => void dropOn(g.id)}
                >
                  <span className={styles.orderInner}>
                    <ReorderGrip
                      label={g.name}
                      disabled={reorderDisabledReason !== null}
                      disabledReason={reorderDisabledReason ?? undefined}
                      onMove={(direction) => void keyboardMove(g.id, direction)}
                    >
                      <span aria-hidden>⠿</span>
                    </ReorderGrip>
                    <span className={styles.orderNumber}>{g.targetingPriority + 1}</span>
                  </span>
                </td>
                <td>
                  <div className={styles.menuCell}>
                    <span className={styles.thumb}>
                      {g.thumbnailR2Key ? (
                        // eslint-disable-next-line @next/next/no-img-element -- 管理画面内のサムネ。Worker の認証つき口をそのまま使う
                        <img src={api.richMenuGroups.imageUrl(g.thumbnailR2Key)} alt="" loading="lazy" />
                      ) : (
                        <ImageIcon size={16} aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <Link
                        href={`/rich-menus/edit?id=${g.id}`}
                        title={g.name}
                        className={styles.cellTitle}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {g.name}
                      </Link>
                      <span
                        className={styles.cellSub}
                        title={`${menuShapeText(g)}・ボタン「${g.chatBarText}」`}
                      >
                        {menuShapeText(g)}
                      </span>
                    </span>
                  </div>
                </td>
                <td>
                  <p className={styles.audienceMain} title={audienceMainText(g, tagNameById)}>
                    {audienceMainText(g, tagNameById)}
                  </p>
                  {audienceSubText(g) ? (
                    <p className={styles.audienceSub}>{audienceSubText(g)}</p>
                  ) : null}
                </td>
                <td>
                  {g.publishingAt ? (
                    <>
                      <span className={`${styles.statePill} ${styles.statePillScheduled}`}>
                        <span className={styles.stateDot} aria-hidden="true" />
                        {formatDay(g.publishingAt)} 公開
                      </span>
                    </>
                  ) : (
                    <span
                      className={`${styles.statePill} ${g.status === 'published' ? styles.statePillLive : styles.statePillDraft}`}
                    >
                      <span className={styles.stateDot} aria-hidden="true" />
                      {g.status === 'published' ? '公開中' : '下書き'}
                    </span>
                  )}
                </td>
                <td className={styles.countCell}>
                  <div className={styles.countMain}>
                    {g.monthlyStats ? `${formatNumber(g.monthlyStats.taps)}回` : '—'}
                  </div>
                  {g.monthlyStats?.uniqueAudience.value != null ? (
                    <div className={styles.countSub}>
                      のべ{formatNumber(g.monthlyStats.uniqueAudience.value)}人
                      {g.monthlyStats.uniqueAudience.state === 'partial' ? '（記録開始後）' : ''}
                    </div>
                  ) : null}
                </td>
                <td className={styles.menuCellActions} onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className={styles.menuButton}
                    title={`リッチメニュー「${g.name}」の操作`}
                    aria-expanded={openMenuId === g.id}
                    onClick={() => setOpenMenuId((current) => (current === g.id ? null : g.id))}
                  >
                    ⋯
                  </button>
                  <ActionMenu
                    open={openMenuId === g.id}
                    onClose={() => setOpenMenuId(null)}
                    ariaLabel={`リッチメニュー「${g.name}」の操作`}
                    items={rowMenuItems(g)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className={styles.pagerRow}>
          <span className={styles.pagerCount}>
            {(currentPage - 1) * pageSize + 1}〜{Math.min(currentPage * pageSize, groupTotal)} / {formatNumber(groupTotal)}件
          </span>
          <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} ariaLabel="リッチメニューのページ送り" />
        </div>
      ) : (
        <p className={styles.pagerCount}>{formatNumber(groupTotal)}件</p>
      )}
    </>
  )

  return (
    <div className={styles.board} data-design-node={canEdit ? 'rZEGN' : 'ZoKow'}>
      {/*
        骨格の印（data-design）は v7 の page.tsx 側が担う。ここへ別の節名を
        足すと design-structure の検査が V7＋V8 の和集合で見えてしまう。
        KPIs は V7 と同じ節名なので残す。
        板IDは V8 の枠にだけ付ける（`rZEGN` 一覧／`ZoKow` 閲覧のみ）。
      */}
      <div>
        <div className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.headTitle}>リッチメニュー</h2>
            <p className={styles.headDescription}>
              トーク画面の下に出るボタンのメニューです。友だちの条件ごとに出し分けられます。
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowExternal(true)}
            title="LINEの画面で直接作ったメニューを見て、取り込めます"
          >
            <CloudDownload size={14} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -2 }} />
            LINE上にあるメニュー
          </Button>
        </div>
      </div>

      {/* 数の帯 4つ（設計 `rZEGN`：公開中・今月押された・いちばん押された・出し分け）。 */}
      <div data-design="KPIs" className={styles.kpis}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}><CircleCheck size={13} aria-hidden="true" />公開中</span>
          <p className={styles.kpiValue}>
            {groupKpiReady ? (groupFacets?.published ?? '—') : '—'}
            <span className={styles.kpiUnit}>{groupKpiReady ? '件' : ''}</span>
          </p>
          <p className={styles.kpiDetail}>
            {groupKpiReady
              ? groupFacets?.published != null
                ? `下書き ${(groupFacets?.total ?? groupTotal) - groupFacets.published}件`
                : '下書き —'
              : `下書き —・${groupKpiUnavailableText}`}
          </p>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}><MousePointerClick size={13} aria-hidden="true" />今月押された</span>
          <p className={styles.kpiValue}>
            {tapKpiReady && tapStats?.total != null ? formatNumber(tapStats.total) : '—'}
            <span className={styles.kpiUnit}>{tapKpiReady && tapStats?.total != null ? '回' : ''}</span>
          </p>
          <p className={styles.kpiDetail}>
            {tapKpiReady ? 'ボタンが押された回数' : tapKpiUnavailableText}
          </p>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}><Zap size={13} aria-hidden="true" />いちばん押された</span>
          <p className={styles.kpiValue} title={topArea?.label ?? undefined}>
            {topArea ? (topArea.label || '名前のないボタン') : '—'}
          </p>
          <p className={styles.kpiDetail}>
            {topArea
              ? `${topAreaGroupName ? `${topAreaGroupName}・` : ''}${formatNumber(topArea.taps)}回`
              : tapKpiReady
                ? (tapStats?.total ?? 0) > 0
                  ? '内訳はまだ集まっていません'
                  : 'まだ押されていません'
                : tapKpiUnavailableText}
          </p>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}><Split size={13} aria-hidden="true" />出し分け</span>
          <p className={styles.kpiValue}>
            {groupKpiReady ? (groupFacets?.targeting ?? '—') : '—'}
            <span className={styles.kpiUnit}>{groupKpiReady ? '件' : ''}</span>
          </p>
          <p className={styles.kpiDetail}>
            {groupKpiReady
              ? (groupFacets?.targeting ?? 0) > 0
                ? 'タグの条件で切り替わる'
                : 'タグ条件で出し分けているメニューはありません'
              : groupKpiUnavailableText}
          </p>
        </div>
      </div>

      {!selectedAccount ? (
        <div className={styles.stateCard}>
          <p className={styles.stateDesc}>LINEアカウントを選ぶと表示します。</p>
        </div>
      ) : (
        <div className={styles.split}>
          {/* 左のフォルダの列。いちばん上は「メニューを作る」。 */}
          <div className={styles.folderCol}>
            {canEdit ? (
              <Button
                type="button"
                variant="primary"
                className="v8-folder-create w-full"
                onClick={() => router.push('/rich-menus/new')}
              >
                ＋ メニューを作る
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                className="v8-folder-create w-full"
                disabled
                title={NO_MANAGE_NOTE}
              >
                ＋ メニューを作る
              </Button>
            )}
            <FolderPanel
              activeId={folderFilter}
              onSelect={(id) => {
                setFolderFilter(id)
                setPage(1)
              }}
              onAddFolder={canEdit ? () => setFolderDialogOpen(true) : undefined}
              addFolderLabel="フォルダを追加"
              addFolderDisabled={!canEdit}
              addFolderTitle={!canEdit ? NO_MANAGE_NOTE : undefined}
              rows={folderRows}
            >
              <p className={styles.folderNote}>
                フォルダを消しても、中のメニューは未分類に残ります。
              </p>
            </FolderPanel>
          </div>

          <div className={styles.listCol}>
            {/* 「上のメニューが優先されます」の帯（設計 `rZEGN` の青い帯）。 */}
            <p className={styles.noteBand}>
              <Hand size={14} aria-hidden="true" />
              上のメニューが優先されます。同じ友だちが複数の条件に当てはまるときは、いちばん上の1つだけが出ます。順番は行の左のつまみで入れ替えます。
            </p>

            {/* 道具の段：検索・札 4つ・並び・件数。
                狭い板では「作る」とフォルダ選びがここへ畳まれる。 */}
            <div className={styles.toolbar}>
              <Button
                type="button"
                variant="primary"
                className={styles.toolbarCreate}
                disabled={!canEdit}
                title={!canEdit ? NO_MANAGE_NOTE : undefined}
                onClick={() => router.push('/rich-menus/new')}
              >
                ＋ メニューを作る
              </Button>
              <div className={styles.folderSelectWrap}>
                <Select
                  aria-label="フォルダ"
                  value={folderFilter}
                  onChange={(value) => {
                    setFolderFilter(value)
                    setPage(1)
                  }}
                  options={folderSelectOptions}
                />
              </div>
              <div className={styles.searchWrap}>
                <SearchField
                  aria-label="メニュー名・ボタン名で検索"
                  placeholder="メニュー名・ボタン名"
                  value={query}
                  onChange={(value) => {
                    setQuery(clampSearchQuery(value))
                    setPage(1)
                  }}
                  onClear={() => setQuery('')}
                />
              </div>
              {FILTER_CHIPS.map((f) => (
                <FilterChip
                  key={f.key}
                  selected={savedFilter === f.key}
                  onChange={() => setSavedFilter(savedFilter === f.key ? '' : f.key)}
                  title={f.note}
                >
                  {f.label}
                </FilterChip>
              ))}
              <span className={styles.toolbarSpacer} />
              <span className={styles.toolbarLabel}>並び</span>
              <Select
                aria-label="並び順"
                value={sortKey}
                onChange={(value) => setSortKey(value as SortKey)}
                options={SORT_OPTIONS}
              />
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

            {listBody}
          </div>
        </div>
      )}

      {/* 操作の失敗の帯。一覧の読み込み失敗は表の中の状態カードが担う。 */}
      {actionError ? (
        <p className={styles.errorBand} role="alert">
          {actionError}
          <button type="button" onClick={() => void reload()}>読み直す</button>
        </p>
      ) : null}

      {folderDialogOpen && (
        <FolderAddDialog
          kind="rich_menu"
          note="メニューを分けてしまう箱です。消しても、入っていたメニューは未分類として残ります。"
          placeholder="例: 01_会員向け"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      )}

      {/* 「LINE上にあるメニュー」の作業画面（v7 と同じ部品）。 */}
      {showExternal && selectedAccount ? (
        <div className="bg-canvas-sunken fixed inset-x-0 bottom-0 top-[var(--mobile-header-height)] z-40 overflow-y-auto p-4 sm:p-6 xl:left-64 xl:top-14">
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

      {applyTo && (
        <ApplyToTagModal
          groupId={applyTo.id}
          groupName={applyTo.name}
          onClose={() => setApplyTo(null)}
        />
      )}

      {/* 複製の確認窓。 */}
      <ConfirmDialog
        open={duplicateTarget !== null}
        title={
          duplicateTarget
            ? `「${duplicateTarget.name}」を複製しますか？`
            : 'リッチメニューを複製しますか？'
        }
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
        title={
          importTarget
            ? `「${importTarget.name}」を管理画面に取り込みますか？`
            : 'LINE上のメニューを管理画面に取り込みますか？'
        }
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
        <ul className="space-y-2 text-sm text-ink-secondary">
          <li>
            <strong className="text-ink">管理画面に追加するもの：</strong>
            名前・画像・ボタンの設定
          </li>
          <li>
            <strong className="text-ink">上書きするもの：</strong>
            ありません。すでに管理中のメニューは重ねて取り込みません。
          </li>
          <li>
            <strong className="text-ink">LINE上に残るもの：</strong>
            現在のメニューと、友だちに表示している状態
          </li>
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={importedMenuName !== null}
        designNode="TL7tp"
        title={
          importedMenuName
            ? `「${importedMenuName}」を管理画面に取り込みました`
            : '管理画面に取り込みました'
        }
        description="LINE上の表示は変更していません。管理画面で編集できるようになりました。"
        onCancel={() => setImportedMenuName(null)}
      />

      {/* 削除（設計 `yOyCg`：消せない理由を外す順に並べる）。読めないときは消させない。 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        designNode="yOyCg"
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
        onCancel={() => {
          if (deleteBusy) return
          impactRequestGenerationRef.current += 1
          impactLoadGenerationRef.current += 1
          impactRequestRef.current = null
          setDeleteTarget(null)
          setDeleteError(null)
          setImpact(null)
          setImpactPhase('idle')
        }}
        {...(deleteTarget?.kind === 'external' || (deleteTarget?.kind === 'managed' && deleteTarget.group.status === 'published') || canDeleteImpact({ impact, busy: deleteBusy })
          ? { onConfirm: () => void confirmDelete() }
          : {})}
      >
        {deleteTarget?.kind === 'managed' ? (
          <>
            <ul className="space-y-2 text-sm text-ink-secondary">
              <li>
                <strong className="text-ink">{deleteTarget.group.status === 'published' ? '取り下げるもの：' : '消えるもの：'}</strong>
                {deleteTarget.group.status === 'published' ? 'LINE上のこのリッチメニュー' : 'このリッチメニューの設定と画像'}
              </li>
              <li>
                <strong className="text-ink">残るもの：</strong>
                {deleteTarget.group.status === 'published' ? '管理画面の設定と、これまでのタップ記録' : '同じフォルダのほかのメニューと、これまでのタップ記録'}
              </li>
              {deleteTarget.group.status === 'draft' ? <li>
                 <strong className="text-danger">元に戻せません。</strong>
              </li> : <>
                <li><strong className="text-ink">取り下げは、もう一度公開すれば戻せます。</strong></li>
                <li>取り下げたあと、管理画面から削除できます。</li>
              </>}
            </ul>
            {impactPhase === 'loading' ? (
              <p className="mt-3 text-xs text-ink-faint">消したときの影響を確認しています…</p>
            ) : impactPhase === 'error' ? (
              <p className="mt-3 text-xs font-semibold text-danger" role="alert">
                消したときの影響を確認できませんでした。読み直してから、もう一度お試しください。
              </p>
            ) : impact ? (
              <div className="border-hairline mt-3 space-y-1.5 border-t pt-3 text-xs leading-5 text-ink-secondary">
                <p>
                  <strong className="text-ink">いま表示している人数：</strong>
                  {audienceText(impact.currentAudience)}
                  {audienceReason(impact.currentAudience)
                    ? `（${audienceReason(impact.currentAudience)}）`
                    : ''}
                </p>
                <p>
                  <strong className="text-ink">次に出るメニュー：</strong>
                  {nextDisplayText(impact.nextDisplay)}
                </p>
                <p>
                  <strong className="text-ink">切替元：</strong>
                  {impact.incomingSwitches.length === 0
                    ? 'ありません'
                    : impact.incomingSwitches
                        .map((sw) => `${sw.sourceGroupName}の「${sw.areaLabel ?? sw.sourcePageName}」`)
                        .join('・')}
                </p>
                <p>
                  <strong className="text-ink">使っている自動処理：</strong>
                  {impact.operationalReferences.length === 0
                    ? 'ありません'
                    : impact.operationalReferences
                        .map((ref) => `${referenceKindText(ref.kind)}「${ref.ownerName}」`)
                        .join('・')}
                </p>
                {blockerTexts(impact.blockers).map((text) => (
                  <p key={text} className="font-semibold text-danger" role="alert">{text}</p>
                ))}
                {impact.blockers.length === 0 ? null : (
                  <p className="text-ink-faint">{recommendedActionText(impact.recommendedAction)}</p>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <ul className="space-y-2 text-sm text-ink-secondary">
            <li>
              <strong className="text-ink">消えるもの：</strong>
              LINE公式アカウント上のこのリッチメニュー
            </li>
            <li>
              <strong className="text-ink">残るもの：</strong>
              管理画面で作成・編集しているほかのリッチメニュー
            </li>
            <li>
              <strong className="text-danger">元に戻せません。</strong>
            </li>
          </ul>
        )}
      </ConfirmDialog>
    </div>
  )
}
