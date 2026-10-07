'use client'


import { RovingTbody } from '@/components/shared/row-roving'
import { ListPage, ListPagePagination } from '@/components/templates'
import ListToolbar from '@/components/shared/list-toolbar'
import SearchField from '@/components/shared/search-field'
/*
 * ★V8 自動応答の一覧（Pencil「★V8 画面の地図」の自動応答の行：
 * 一覧 `uE9gf`、行の「…」は `IIesG`、止めるは `i8F12`、削除は `u8sKN`、
 * 状態の板は `G8i4xP`）。
 *
 * v7 の一覧（app/auto-replies/page.tsx 内の AutoRepliesPageV7）とは
 * 別の部品として持つ。データの口は同じ。違いは置き場と見せ方だけ——
 * 「ルールを作る」は左のフォルダの列の上、行の右端は「…」（編集・実行結果・
 * 複製・止める/再開・フォルダへ移す・削除）、行の左の □ を選ぶと表の下に
 * まとめての帯（止める・再開・フォルダへ移す）。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useListScrollMemory, useListUrlFlag, useListUrlParam } from '@/components/shared/list-url-state'
import { useEscapeToClearSelection } from '@/components/shared/bulk-bar'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Activity,
  Ban,
  ChevronDown,
  CircleCheck,
  CircleHelp,
  Clock,
  Copy,
  Folder as FolderIcon,
  Inbox,
  Layers,
  MessageSquare,
  Pause,
  Pencil,
  Square,
  Play,
  Trash2,
  TriangleAlert,
  Zap,
  Bookmark,
  Eye,
  Plus,
} from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { clampSearchQuery } from '@/lib/search-query'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { formatNumber } from '@/lib/format'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import { notifyToast } from '@/components/shared/toast'
import { runUndoable } from '@/lib/undoable'
import { useDeferredDelete } from '@/lib/use-deferred-delete'
import { useLiveReorder } from '@/lib/use-live-reorder'
import { DelayedSkeleton } from '@/components/shared/skeleton'
import { DataTable, TableHeadRow, Th, Tr, Td, NameCell } from '@/components/shared/table'
import { FolderDotName, type FolderDotFolder } from '@/components/shared/folder-dot'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import KpiCard from '@/components/shared/kpi-card'
import Notice from '@/components/shared/notice'
import KpiBand from '@/components/shared/kpi-band'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import SortSelect from '@/components/ui/sort-select'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import DetailPanel from '@/components/shared/detail-panel'
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu'
import { withViewTransition } from '@/components/shared/view-transition'
import Pagination from '@/components/shared/pagination'
import ReorderGrip from '@/components/friend-fields/reorder-grip'
import { movePriorityUpdates } from './order'
import {
  LOAD_STATE_WORDS,
  NO_WRITE_PERMISSION,
  actionShortWord,
  autoReplyMatchesQuery,
  conditionChips,
  responseTypeWord,
  scheduleChipLabels,
  scheduleText,
  stopNote,
  templateWord,
  triggerSummary,
  isCurrentAutoReplyLoad,
  visibleAutoReplyLoadState,
  type LoadState,
} from './words'
import QuickCreateV8 from './quick-create'
import styles from './list.module.css'

/** 未分類を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'

interface AutoReply {
  id: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
  activeFrom: string | null
  activeUntil: string | null
  cooldownMinutes: number | null
  skipWhenOperatorActive: boolean
  priority: number
  messageKinds: string[] | null
  receiveSources: Array<'line' | 'email'>
  actions: unknown[] | null
  responseWeekdays: number[] | null
  responseHolidayRule: string | null
  oncePerFriend: boolean
  keywords: unknown[] | null
  friendConditions: unknown | null
  respondToAll: boolean
  name: string | null
  keywordMatchMode: string
  folderId: string | null
  internalMemo: string | null
  /** 'draft'（未公開）| 'published' | 'stopped'。再開の可否を分けるのに使う。 */
  lifecycleStatus: string
  stoppedAt: string | null
  stoppedByStaffId: string | null
  stoppedByStaffName: string | null
  stopReason: string | null
  hits?: { period: number; total: number }
  actionExecutionCount?: number | null
  /** 同じ受信に当たり得る、有効な別ルールの数。 */
  conflictAttentionCount?: number | null
  createdAt: string
}

interface TemplateLite {
  id: string
  name: string
  messageType: string
  messageContent: string
}

interface PendingDelete {
  item: AutoReply
  /** 削除対象を選んだ時点のアカウント。切替後に古い対象を消さないために固定する。 */
  accountId: string | null
}

interface PendingToggle {
  /** 単体なら1件、まとめてなら選んだ分。 */
  ids: string[]
  names: string[]
  /** 'stop' は専用の停止口、'resume' は再開。 */
  kind: 'stop' | 'resume'
  /** 対象を選んだ時点のアカウント。切替後に古い対象へ作用しないために固定する。 */
  accountId: string | null
}

type SortKey = 'hits' | 'priority' | 'name' | 'created'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'priority', label: '評価順' },
  { value: 'hits', label: 'ヒットが多い順' },
  { value: 'name', label: '名前順' },
  { value: 'created', label: '作った順' },
]

const PAGE_SIZE_OPTIONS = [
  { value: '20', label: '20件表示' },
  { value: '50', label: '50件表示' },
  { value: '100', label: '100件表示' },
]

/**
 * よく使う絞り込みの選ぶ欄（設計の札3つ＋選ぶ欄）。
 * 札は独立してON/OFFできる。選ぶ欄は「よく使う」1種だけ（数えられるものだけ）。
 */
const SAVED_FILTER_OPTIONS = [
  { value: '', label: 'よく使う絞り込み' },
  { value: 'used', label: 'よく使う（今月1回以上当たった）' },
]

/**
 * 応答したときに行うことを、短い言葉で並べる（v7 page.tsx の actionSummary と同じ）。
 */
function actionSummary(rule: { actions: unknown[] | null }): string[] {
  if (!Array.isArray(rule.actions)) return []
  return rule.actions.flatMap((item): string[] => {
    if (!item || typeof item !== 'object') return []
    const r = item as Record<string, unknown>
    const type = r.actionType ?? r.action_type
    if (typeof type !== 'string') return []
    return [actionShortWord(type)]
  })
}

/** 行の表示名。名前があればそれ、無ければキーワード。一律応答はキーワードが無い。 */
function displayName(r: AutoReply): string {
  return r.name || (r.respondToAll ? 'すべてのメッセージ' : r.keyword)
}

/** 閲覧のみでも出す行の「…」の項目（見るだけのもの）。 */
const VIEW_ONLY_MENU_IDS = new Set(['runs'])


/* 作るボタン（板 `uE9gf` の ▾）。窓は1つだけ置き、押したボタンの位置に出す。 */
function CreateRuleButton({ full, compact, disabled, disabledTitle, menuOpen, onOpenMenu }: {
  full?: boolean
  /** 1152 の板：▾ なし・＋は印（絵どおり）。押すと同じ窓が開く。 */
  compact?: boolean
  disabled: boolean
  disabledTitle?: string
  menuOpen: boolean
  onOpenMenu: (anchor: HTMLButtonElement | null) => void
}) {
  return (
    <Button
      type="button"
      variant="primary"
      className={full ? 'v8-folder-create w-full' : undefined}
      disabled={disabled}
      title={disabledTitle}
      onClick={(event) => onOpenMenu(event.currentTarget)}
      aria-expanded={menuOpen}
      aria-haspopup="menu"
    >
      {compact ? <><Plus size={15} aria-hidden="true" />ルールを作る</> : <>＋ ルールを作る <ChevronDown size={14} aria-hidden="true" /></>}
    </Button>
  )
}

export default function AutoRepliesListV8() {
  usePageTitle('自動応答')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)
  // 1152の板（`WPrd5`）。折り畳みはCSSのコンテナ問い合わせが担い、
  // ここでは板IDだけを切り替える。
  const narrow = useNarrowViewport()

  const [items, setItems] = useState<AutoReply[]>([])
  /* 絞り込み・検索語・ページは URL に置く（戻ると同じ一覧に戻る。動きの点検 5 番）。 */
  const [query, setQuery] = useListUrlParam('q')
  const [templates, setTemplates] = useState<TemplateLite[]>([])
  const [templateListAvailable, setTemplateListAvailable] = useState(true)
  const [conflictCount, setConflictCount] = useState<number | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<unknown>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [folderFilter, setFolderFilter] = useListUrlParam('folder')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('priority')
  const [savedFilter, setSavedFilter] = useListUrlParam('view')
  const [stoppedOnly, setStoppedOnly] = useListUrlFlag('stopped')
  const [timedOnly, setTimedOnly] = useListUrlFlag('timed')
  const [zeroThisMonthOnly, setZeroThisMonthOnly] = useListUrlFlag('zero')
  /** 「重なりあり」の絞り込み。要確認の帯・行の札から入る。 */
  const [conflictOnly, setConflictOnly] = useListUrlFlag('conflict')
  const [pageSize, setPageSize] = useState(20)
  const [pageParam, setPageParam] = useListUrlParam('page', '1')
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1)
  const setPage = useCallback((next: number) => setPageParam(String(next)), [setPageParam])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  /* 板 `uE9gf`：作るボタンは ▾ で作り方を選ぶ。 */
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const createMenuAnchorRef = useRef<HTMLButtonElement | null>(null)
  /* ★V8 かんたんに作る（板 `G4GejG`）。詳しい分け方（Xr6eu）は P6vbxn 待ち。 */
  const [quickOpen, setQuickOpen] = useState(false)
  /* 行の詳細パネル（V8「サクサク感」C①・D・E）。開いている行のID。 */
  const [panelId, setPanelId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null)
  const [toggleReason, setToggleReason] = useState('')
  const [toggleError, setToggleError] = useState('')
  const [moveIds, setMoveIds] = useState<string[] | null>(null)
  const [moveDraft, setMoveDraft] = useState('')
  const [duplicateTarget, setDuplicateTarget] = useState<AutoReply | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState('')
  const [actionError, setActionError] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [moveNotice, setMoveNotice] = useState('')

  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null | undefined>(undefined)

  const load = useCallback(async () => {
    const requestAccountId = selectedAccountId
    const requestGeneration = ++loadGenerationRef.current
    setLoadState('loading')
    setLoadError(null)
    setConflictCount(null)
    try {
      const [arRes, tplRes, summaryRes] = await Promise.all([
        api.autoReplies.list({ accountId: selectedAccountId || undefined }),
        api.templates.list(undefined, selectedAccountId || undefined),
        selectedAccountId
          ? api.autoReplies.summary(selectedAccountId).catch(() => null)
          : Promise.resolve(null),
      ])
      if (!isCurrentAutoReplyLoad(
        requestAccountId,
        selectedAccountIdRef.current,
        requestGeneration,
        loadGenerationRef.current,
      )) return
      if (!arRes.success) {
        setLoadedAccountId(requestAccountId)
        setLoadState('error')
        return
      }
      setItems(arRes.data as AutoReply[])
      setConflictCount(summaryRes?.success ? summaryRes.data.conflictCount : null)
      setTemplateListAvailable(tplRes.success)
      setTemplates(tplRes.success
        ? tplRes.data.map((t) => ({
            id: t.id,
            name: t.name,
            messageType: t.messageType,
            messageContent: t.messageContent,
          }))
        : [])
      setLoadedAccountId(requestAccountId)
      setLoadState('ready')
    } catch (reason) {
      if (!isCurrentAutoReplyLoad(
        requestAccountId,
        selectedAccountIdRef.current,
        requestGeneration,
        loadGenerationRef.current,
      )) return
      setLoadedAccountId(requestAccountId)
      setLoadError(reason)
      setLoadState(reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error')
    }
  }, [selectedAccountId])

  const loadFolders = useCallback(async () => {
    try {
      const res = await api.folders.list('auto_reply')
      if (res.success) {
        setFolders(res.data)
        setUnfiledCount(res.unfiledCount ?? null)
      }
    } catch {
      // 置き場が取れなくても一覧は出す。取れない失敗で画面を落とさない。
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { void loadFolders() }, [loadFolders])

  const templateById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates])

  /*
   * 押した瞬間の見せ方（★V8 サクサク感 B）。軽い操作は先にこの重ねで
   * 描き換え、裏で保存する。確定・失敗・取り消しで重ねを外し、読み直す。
   * ページ・絞り込みが変わったら重ねは捨てる（違う一覧に貼らない）。
   */
  const [optimisticRows, setOptimisticRows] = useState<{ key: string; rows: AutoReply[] } | null>(null)
  const listContextKey = JSON.stringify({
    account: selectedAccountId ?? '',
    query,
    folder: folderFilter,
    sort: sortKey,
    chips: [conflictOnly, stoppedOnly, timedOnly, zeroThisMonthOnly, savedFilter],
    pageSize,
    page,
  })
  const rules = optimisticRows && optimisticRows.key === listContextKey ? optimisticRows.rows : items
  /*
   * 止まっている自動応答の削除は、どこにも影響しない（もう返信していない）。確かめの窓を出さずに
   * 一覧から外し、5秒は「元に戻す」で取り消せる（動きの点検 17 番）。動いているものは今までどおり窓。
   */
  const deferredDelete = useDeferredDelete()
  const requestDelete = (r: AutoReply) => {
    setDeleteError('')
    if (r.isActive) {
      setPendingDelete({ item: r, accountId: selectedAccountId })
      return
    }
    const requestAccountId = selectedAccountId
    if (panelId === r.id) setPanelId(null)
    setSelectedIds((current) => {
      if (!current.has(r.id)) return current
      const next = new Set(current)
      next.delete(r.id)
      return next
    })
    deferredDelete.schedule({
      ids: [r.id],
      message: `自動応答「${displayName(r)}」を削除しました`,
      commit: () => api.autoReplies.delete(r.id),
      onCommitted: () => (selectedAccountIdRef.current === requestAccountId ? load() : undefined),
      failureMessage: '自動応答を削除できませんでした。状態を読み直してからお試しください。',
    })
  }

  /* ===== 数の帯 ===== */
  const hitsAllKnown = rules.length > 0 && rules.every((r) => r.hits !== undefined)
  const monthlyHits = hitsAllKnown
    ? rules.reduce((sum, r) => sum + (r.hits?.period ?? 0), 0)
    : null
  const totalHits = hitsAllKnown
    ? rules.reduce((sum, r) => sum + (r.hits?.total ?? 0), 0)
    : null
  const actionExecutionsAllKnown = rules.length > 0 && rules.every((r) => r.actionExecutionCount != null)
  const actionExecutionCount = actionExecutionsAllKnown
    ? rules.reduce((sum, r) => sum + (r.actionExecutionCount ?? 0), 0)
    : null

  const visibleLoadState = visibleAutoReplyLoadState(loadState, loadedAccountId, selectedAccountId)
  const ready = visibleLoadState === 'ready'

  /* ===== 絞り込み ===== */
  const afterQuery = rules.filter((r) => !deferredDelete.isHidden(r.id) && autoReplyMatchesQuery(r, query))
  const inFolder = afterQuery.filter((r) => {
    if (folderFilter === UNFILED) return !r.folderId
    if (folderFilter) return r.folderId === folderFilter
    return true
  })
  const inChips = inFolder.filter((r) => {
    if (conflictOnly && (r.conflictAttentionCount ?? 0) <= 0) return false
    if (stoppedOnly && r.isActive) return false
    if (timedOnly && !Boolean(r.activeFrom || r.activeUntil || (r.responseWeekdays?.length ?? 0) > 0)) return false
    /* ヒット数が分からないルールを「今月0回」に混ぜない。0 は「当たらなかった」の意味。 */
    if (zeroThisMonthOnly && (r.hits === undefined || r.hits.period !== 0)) return false
    if (savedFilter === 'used' && (r.hits?.period ?? 0) <= 0) return false
    return true
  })
  const sortedItems = useMemo(() => [...inChips].sort((a, b) => {
    switch (sortKey) {
      case 'hits':
        return (b.hits?.period ?? 0) - (a.hits?.period ?? 0)
      case 'name':
        return displayName(a).localeCompare(displayName(b), 'ja')
      case 'created':
        return b.createdAt.localeCompare(a.createdAt)
      default:
        // 評価順は「実際に見る順」。一覧の並びと動く順を合わせる。
        return a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)
    }
  }), [inChips, sortKey])

  const filterActive = Boolean(
    query || folderFilter || conflictOnly || stoppedOnly || timedOnly || zeroThisMonthOnly || savedFilter,
  )
  const clearFilters = () => {
    setQuery('')
    setFolderFilter('')
    setConflictOnly(false)
    setStoppedOnly(false)
    setTimedOnly(false)
    setZeroThisMonthOnly(false)
    setSavedFilter('')
  }

  const pageCount = Math.max(1, Math.ceil(sortedItems.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const shownItems = sortedItems.slice((safePage - 1) * pageSize, safePage * pageSize)

  // 絞り込みや件数の変更でページが溢れたら先頭へ戻す。
  // 読み込みが終わる前は件数が 0 なので戻さない（URL のページを先頭へ潰さない）。
  useEffect(() => {
    if (loadState !== 'ready') return
    if (page > pageCount) setPage(pageCount)
  }, [loadState, page, pageCount, setPage])
  useListScrollMemory(loadState === 'ready')

  const nextPriority = items.length === 0
    ? 0
    : Math.min(9999, Math.max(...items.map((item) => item.priority)) + 1)

  /* ===== 選択 ===== */
  const toggleOne = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const pageIds = shownItems.map((r) => r.id)
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const toggleAllOnPage = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }
  const selectedCount = selectedIds.size
  /* 選んでいる間は Esc で選択を外す（動きの点検 12 番）。 */
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  useEscapeToClearSelection(selectedCount > 0, clearSelection)
  const selectedRules = rules.filter((r) => selectedIds.has(r.id))
  const stoppableIds = selectedRules.filter((r) => r.isActive).map((r) => r.id)
  const resumableIds = selectedRules.filter((r) => !r.isActive && r.lifecycleStatus !== 'draft').map((r) => r.id)

  /* ===== 操作 ===== */

  /*
   * 停止・再開は確認窓の決定で窓を閉じて即反映し、すぐ裏で送る
   * （裁定 C：5秒待たない）。止める理由（任意）は窓で受け取り、そのまま
   * 記録へ送る。知らせの「元に戻す」は逆の操作を送る（止めたなら再開・
   * 再開したなら止める。止め直すときは変える前の理由を使う）。
   * 送れなかったら戻して「もう一度」の知らせを出す。
   */
  const runToggle = () => {
    if (!pendingToggle) return
    if (pendingToggle.accountId !== selectedAccountId) {
      setToggleError('アカウントが切り替わりました。操作する自動応答を選び直してください。')
      return
    }
    const requestAccountId = pendingToggle.accountId
    const ids = pendingToggle.ids
    const kind = pendingToggle.kind
    const reason = toggleReason.trim() === '' ? null : toggleReason.trim()
    const key = listContextKey
    // 逆操作のために、変える前の止めた理由を覚えておく。
    const beforeStopReason = new Map(
      rules.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.stopReason ?? null] as const),
    )
    const applyOptimistic = (active: boolean, stopReasonOf: (id: string) => string | null) => {
      setOptimisticRows({
        key,
        rows: rules.map((r) =>
          ids.includes(r.id)
            ? { ...r, isActive: active, stopReason: active ? r.stopReason : stopReasonOf(r.id) }
            : r,
        ),
      })
    }
    const doneMessage = (targetKind: 'stop' | 'resume') =>
      ids.length === 1
        ? targetKind === 'resume'
          ? '自動応答を再開しました'
          : '自動応答を停止しました'
        : targetKind === 'resume'
          ? `${ids.length}件の自動応答を再開しました`
          : `${ids.length}件の自動応答を停止しました`
    const failedMessage = (targetKind: 'stop' | 'resume', forbidden: boolean) =>
      forbidden
        ? `${NO_WRITE_PERMISSION.label}。自動応答を止めたり動かしたりするには権限が要ります。`
        : targetKind === 'stop'
          ? '自動応答を停止できませんでした。状態を読み直してからお試しください。'
          : '自動応答を再開できませんでした。状態を読み直してからお試しください。'
    const reloadIfSameAccount = () => {
      if (selectedAccountIdRef.current === requestAccountId) void load()
    }
    const sendToggle = (targetKind: 'stop' | 'resume', targetReasonOf: (id: string) => string | null) => {
      applyOptimistic(targetKind === 'resume', targetReasonOf)
      void (async () => {
        let failed = 0
        let forbidden = false
        for (const id of ids) {
          try {
            const result = targetKind === 'stop'
              ? await api.autoReplies.stop(id, { reason: targetReasonOf(id) }, crypto.randomUUID())
              : await api.autoReplies.update(id, { isActive: true })
            if (!result.success) failed += 1
          } catch (error) {
            if (error instanceof ApiError && error.status === 403) forbidden = true
            failed += 1
          }
        }
        if (failed > 0) {
          setOptimisticRows(null)
          reloadIfSameAccount()
          notifyToast(failedMessage(targetKind, forbidden), {
            tone: 'error',
            actionLabel: 'もう一度',
            onAction: () => sendToggle(targetKind, targetReasonOf),
          })
          return
        }
        setOptimisticRows(null)
        setSelectedIds(new Set())
        reloadIfSameAccount()
        const reverseKind = targetKind === 'stop' ? 'resume' : 'stop'
        notifyToast(doneMessage(targetKind), {
          actionLabel: '元に戻す',
          onAction: () =>
            sendToggle(reverseKind, (id) =>
              reverseKind === 'stop' ? (beforeStopReason.get(id) ?? null) : null,
            ),
        })
      })()
    }
    setPendingToggle(null)
    setToggleReason('')
    setToggleError('')
    sendToggle(kind, () => reason)
  }

  const runDelete = async () => {
    if (!pendingDelete) return
    if (pendingDelete.accountId !== selectedAccountId) {
      setDeleteError('アカウントが切り替わりました。削除する自動応答を選び直してください。')
      return
    }
    const requestAccountId = pendingDelete.accountId
    const targetId = pendingDelete.item.id
    setDeleting(true)
    setDeleteError('')
    try {
      const result = await api.autoReplies.delete(targetId)
      if (!result.success) {
        setDeleteError('自動応答を削除できませんでした。状態を読み直してからお試しください。')
        return
      }
      setPendingDelete(null)
      if (selectedAccountIdRef.current === requestAccountId) await load()
    } catch (reason) {
      setDeleteError(
        reason instanceof ApiError && reason.status === 403
          ? `${NO_WRITE_PERMISSION.label}。${NO_WRITE_PERMISSION.note}`
          : '自動応答を削除できませんでした。状態を読み直してからお試しください。',
      )
    } finally {
      setDeleting(false)
    }
  }

  /** 削除の窓の「代わりに止める」。削除をやめて、停止の窓へ移す。 */
  const stopInsteadOfDelete = () => {
    if (!pendingDelete) return
    setToggleError('')
    setToggleReason('')
    setPendingToggle({
      ids: [pendingDelete.item.id],
      names: [displayName(pendingDelete.item)],
      kind: 'stop',
      accountId: pendingDelete.accountId,
    })
    setPendingDelete(null)
    setDeleteError('')
  }

  /** フォルダへ移す（1件でもまとめてでも同じ窓）。 */
  const openMove = (ids: string[]) => {
    if (ids.length === 0) return
    setMoveIds(ids)
    setMoveDraft('')
  }
  /*
   * フォルダ移動は窓で行き先だけ選び、押した瞬間に描き換えて裏で保存する
   * （★V8 サクサク感 B）。5秒のあいだ知らせの「元に戻す」で送らずに戻せる。
   */
  const runMove = () => {
    if (!moveIds || moveIds.length === 0) return
    const ids = moveIds
    const requestAccountId = selectedAccountId
    const folderId = moveDraft === '' ? null : moveDraft
    const key = listContextKey
    setOptimisticRows({
      key,
      rows: rules.map((r) => (ids.includes(r.id) ? { ...r, folderId } : r)),
    })
    setMoveIds(null)
    runUndoable({
      message: folderId ? 'フォルダへ移しました' : 'フォルダから外しました',
      commit: async () => {
        let failed = 0
        for (const id of ids) {
          try {
            const result = await api.autoReplies.update(id, { folderId })
            if (!result.success) failed += 1
          } catch {
            failed += 1
          }
        }
        if (failed > 0) throw new Error(`${failed}件のフォルダ移動に失敗しました`)
      },
      undo: () => setOptimisticRows(null),
      failureMessage: 'フォルダへ移せませんでした。状態を読み直してからお試しください。',
      onCommitted: () => {
        setOptimisticRows(null)
        const moved = new Set(ids)
        setSelectedIds((current) => new Set([...current].filter((id) => !moved.has(id))))
        if (selectedAccountIdRef.current === requestAccountId) {
          void load()
          void loadFolders()
        }
      },
    })
  }

  /*
   * 複製（行の「…」→「複製する」）。複製の口は無いので、同じ内容で新しく作る。
   * コピーは必ず「停止中」で作る（AUTOREPLY-08：動かすのは別の操作）。
   * 元ルールが残っているあいだだけ確認窓を出す（stale guard）。
   */
  const runDuplicate = async () => {
    if (!duplicateTarget) return
    setDuplicating(true)
    setDuplicateError('')
    const source = duplicateTarget
    try {
      const result = await api.autoReplies.create({
        keyword: source.keyword,
        matchType: source.matchType,
        responseType: source.responseType,
        responseContent: source.responseContent,
        templateId: source.templateId,
        lineAccountId: source.lineAccountId,
        isActive: false,
        activeFrom: source.activeFrom,
        activeUntil: source.activeUntil,
        cooldownMinutes: source.cooldownMinutes,
        skipWhenOperatorActive: source.skipWhenOperatorActive,
        priority: nextPriority,
        messageKinds: source.messageKinds,
        receiveSources: source.receiveSources,
        actions: source.actions,
        responseWeekdays: source.responseWeekdays,
        responseHolidayRule: source.responseHolidayRule,
        oncePerFriend: source.oncePerFriend,
        keywords: source.keywords,
        friendConditions: source.friendConditions,
        respondToAll: source.respondToAll,
        name: `${displayName(source)}（コピー）`,
        keywordMatchMode: source.keywordMatchMode === 'all' ? 'all' : 'any',
        folderId: source.folderId,
        internalMemo: source.internalMemo,
      })
      if (!result.success) {
        setDuplicateError('複製できませんでした。状態を読み直してからお試しください。')
        return
      }
      setDuplicateTarget(null)
      notifyToast(`「${displayName(source)}」をコピーしました（停止中で作られました）`, { tone: 'success' })
      await load()
    } catch (reason) {
      setDuplicateError(
        reason instanceof ApiError && reason.status === 403
          ? `${NO_WRITE_PERMISSION.label}。${NO_WRITE_PERMISSION.note}`
          : '複製できませんでした。状態を読み直してからお試しください。',
      )
    } finally {
      setDuplicating(false)
    }
  }

  /*
   * R28: 順番は一覧で上下を入れ替えて決める。入れ替えは隣との数字の交換
   * （同点だけ1ずらし）で、既存の更新口を使う。ドラッグで任意の位置へ
   * 落としたときは、隣との交換を目的の位置まで繰り返す。
   */
  /*
   * 並べ替えは押した瞬間に描き換え、裏で番号を保存する（★V8 サクサク感 B）。
   * 5秒のあいだ知らせの「元に戻す」で送らずに戻せる。読み上げには
   * 動かした結果をそのまま知らせる（`moveNotice` は残す）。
   */
  const applyPriorityUpdates = (updates: Array<{ id: string; priority: number }>, notice: string) => {
    if (updates.length === 0) return
    const requestAccountId = selectedAccountId
    const nextById = new Map(updates.map((u) => [u.id, u.priority] as const))
    const key = listContextKey
    setOptimisticRows({
      key,
      rows: rules.map((r) =>
        nextById.has(r.id) ? { ...r, priority: nextById.get(r.id) as number } : r,
      ),
    })
    setMoveNotice(notice)
    setActionError('')
    runUndoable({
      message: '並び順を変えました',
      commit: async () => {
        for (const update of updates) {
          const result = await api.autoReplies.update(update.id, { priority: update.priority })
          if (!result.success) throw new Error('reorder_failed')
        }
      },
      undo: () => setOptimisticRows(null),
      failureMessage: '順番を変えられませんでした。画面を読み直してからお試しください。',
      onCommitted: () => {
        setOptimisticRows(null)
        if (selectedAccountIdRef.current === requestAccountId) void load()
      },
    })
  }

  const keyboardMove = (id: string, direction: -1 | 1) => {
    const updates = movePriorityUpdates(sortedItems, id, direction)
    if (!updates) return
    const name = displayName(rules.find((r) => r.id === id) ?? ({} as AutoReply))
    applyPriorityUpdates(updates, `${name}を${direction === -1 ? '1つ上' : '1つ下'}へ動かしました`)
  }

  /* 動かしている間、置き場所を入れ替えて見せ、ほかの行は滑らかに場所を空ける（フルード ②）。 */
  const liveOrder = useLiveReorder(shownItems, (r) => r.id, dragId)

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId || !canEdit || sortKey !== 'priority') {
      setDragId(null)
      return
    }
    const ordered = [...sortedItems]
    const fromIndex = ordered.findIndex((r) => r.id === dragId)
    const targetIndex = ordered.findIndex((r) => r.id === targetId)
    setDragId(null)
    if (fromIndex < 0 || targetIndex < 0) return
    // 目的の位置まで隣との交換を繰り返し、各行の最終の番号だけを送る。
    const working = [...ordered]
    const direction = targetIndex > fromIndex ? 1 : -1
    const finalUpdates = new Map<string, number>()
    let current = fromIndex
    while (current !== targetIndex) {
      const step = movePriorityUpdates(working, dragId, direction as -1 | 1)
      if (!step) return
      for (const u of step) finalUpdates.set(u.id, u.priority)
      const [moved] = working.splice(current, 1)
      working.splice(current + direction, 0, moved)
      current += direction
    }
    const name = displayName(ordered[fromIndex])
    applyPriorityUpdates(
      [...finalUpdates.entries()].map(([id, priority]) => ({ id, priority })),
      `${name}の順番を変えました`,
    )
  }

  /* ===== 行の「…」（Pencil `IIesG`） ===== */
  const rowMenuItems = (r: AutoReply): ActionMenuItem[] => {
    const name = displayName(r)
    const readonly = !canEdit
    const items: ActionMenuItem[] = [
      {
        id: 'edit',
        label: '編集する',
        icon: <Pencil size={14} aria-hidden="true" />,
        onSelect: () => goEdit(r.id),
      },
      {
        id: 'runs',
        label: '実行結果を見る',
        icon: <Activity size={14} aria-hidden="true" />,
        onSelect: () =>
          withViewTransition(() => {
            router.push(`/auto-replies/runs?id=${r.id}`)
          }),
      },
      {
        id: 'duplicate',
        label: '複製する',
        icon: <Copy size={14} aria-hidden="true" />,
        onSelect: () => {
          setDuplicateError('')
          setDuplicateTarget(r)
        },
      },
    ]
    // 下書き（未公開）は公開の前段なので、動かす口は出さず公開の流れに任せる。
    if (r.isActive || r.lifecycleStatus !== 'draft') {
      items.push(
        r.isActive
          ? {
              id: 'stop',
              label: '止める',
              icon: <Pause size={14} aria-hidden="true" />,
              dividerBefore: true,
              onSelect: () => {
                setToggleError('')
                setToggleReason('')
                setPendingToggle({ ids: [r.id], names: [name], kind: 'stop', accountId: selectedAccountId })
              },
            }
          : {
              id: 'resume',
              label: '再開する',
              icon: <Play size={14} aria-hidden="true" />,
              dividerBefore: true,
              onSelect: () => {
                setToggleError('')
                setPendingToggle({ ids: [r.id], names: [name], kind: 'resume', accountId: selectedAccountId })
              },
            },
      )
    }
    items.push({
      id: 'move',
      label: 'フォルダへ移す',
      icon: <FolderIcon size={14} aria-hidden="true" />,
      onSelect: () => openMove([r.id]),
    })
    items.push({
      id: 'delete',
      label: '削除',
      icon: <Trash2 size={14} aria-hidden="true" />,
      tone: 'danger',
      dividerBefore: true,
      onSelect: () => requestDelete(r),
    })
    // 閲覧のみには押せない項目を置かない（2026-10-06 オーナー決定）。見る項目だけ残す。
    return readonly ? items.filter((item) => VIEW_ONLY_MENU_IDS.has(item.id)) : items
  }

  /* ===== 行の詳細パネル（V8「サクサク感」C①・D・E） ===== */

  /** 一覧の行→詳細はつながる移り変わりで開く。 */
  const goEdit = (id: string) => {
    withViewTransition(() => {
      router.push(`/auto-replies/edit?id=${id}`)
    })
  }

  /** 右クリックは「…」と同じ項目をマウスの位置に出す。 */
  const rowContextItems = (r: AutoReply): ContextMenuItem[] =>
    rowMenuItems(r).map((item) => ({
      id: item.id,
      label: item.label,
      danger: item.tone === 'danger',
      disabled: item.disabled,
      onSelect: () => item.onSelect(),
    }))

  const panelIndex = panelId === null ? -1 : items.findIndex((r) => r.id === panelId)
  const panelRow = panelIndex >= 0 ? items[panelIndex] : null

  /** パネルから止める・再開する。窓の流れは「…」と同じ。 */
  const toggleFromPanel = (r: AutoReply) => {
    const name = displayName(r)
    setToggleError('')
    setToggleReason('')
    setPendingToggle({
      ids: [r.id],
      names: [name],
      kind: r.isActive ? 'stop' : 'resume',
      accountId: selectedAccountId,
    })
    setPanelId(null)
  }

  /* ===== フォルダの列 ===== */
  /* 行の名前の前の丸は、左のフォルダの列と同じフォルダ（同じ色）を引く。未分類は色の無い輪。 */
  const folderDotOf = (r: { folderId: string | null }): FolderDotFolder | null => {
    if (!r.folderId) return null
    const folder = folders.find((f) => f.id === r.folderId)
    return folder ? { name: folder.name, color: folder.color } : null
  }
  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: rules.length, icon: <Inbox size={15} aria-hidden="true" /> },
    ...folders.map((f) => ({
      id: f.id,
      label: f.name,
      // フォルダ件数は API(itemCount) をそのまま出す。来ないときは null（出さない）。
      count: f.itemCount ?? null,
      color: f.color,
    })),
    { id: UNFILED, label: '未分類', count: unfiledCount },
  ]
  const folderSelectOptions = [
    { value: '', label: 'フォルダ：すべて' },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
    { value: UNFILED, label: '未分類' },
  ]

  const folderPanel = (
    <FolderPanel
      activeId={folderFilter}
      onSelect={(id) => {
        setFolderFilter(id)
        setPage(1)
      }}
      onAddFolder={canEdit ? () => setFolderDialogOpen(true) : undefined}
      addFolderLabel="フォルダを追加"
      rows={folderRows}
    >
      <p className={styles.folderNote}>
        フォルダを消しても、中のルールは未分類に残ります。
      </p>
    </FolderPanel>
  )

  /* ===== 数の帯 ===== */
  const kpis: Array<{
    key: string
    title: string
    icon: typeof CircleCheck
    help?: string
    helpLabel?: string
    value: number | null
    unit: string
    detail: React.ReactNode
  }> = [
    {
      key: 'active',
      title: '有効',
      icon: CircleCheck,
      value: ready ? rules.filter((r) => r.isActive).length : null,
      unit: '件',
      detail: ready
        ? `動いていない ${rules.filter((r) => !r.isActive).length}件`
        : LOAD_STATE_WORDS[visibleLoadState].label,
    },
    {
      key: 'monthly',
      title: '今月の応答',
      icon: MessageSquare,
      value: ready ? (monthlyHits === null ? null : monthlyHits) : null,
      unit: '回',
      detail: ready
        ? monthlyHits === null
          ? '実行結果を読み込めませんでした'
          : `累計 ${totalHits === null ? '—' : formatNumber(totalHits)}回`
        : LOAD_STATE_WORDS[visibleLoadState].label,
    },
    {
      key: 'actions',
      title: '後続の処理',
      icon: Zap,
      help: '返したあとに動いた処理の回数',
      helpLabel: '後続の処理',
      value: ready ? (actionExecutionCount === null ? null : actionExecutionCount) : null,
      unit: '回',
      detail: ready
        ? actionExecutionCount === null
          ? '実行結果を読み込めませんでした'
          : 'タグ・シナリオ・対応マークなど'
        : LOAD_STATE_WORDS[visibleLoadState].label,
    },
    {
      key: 'conflict',
      title: '要確認',
      icon: TriangleAlert,
      help: '同じ受信に当たり得る、ほかのルールがあるもの',
      helpLabel: '要確認',
      value: ready ? (conflictCount === null ? null : conflictCount) : null,
      unit: '件',
      detail: ready
        ? conflictCount === null
          ? '重なりを確認できませんでした'
          : <span className={styles.kpiDetailBreak}>条件が重なっているルール</span>
        : LOAD_STATE_WORDS[visibleLoadState].label,
    },
  ]

  /* ===== 一覧の中身 ===== */
  const deleteTargetStale =
    pendingDelete !== null && pendingDelete.accountId !== selectedAccountId
  const toggleTargetStale =
    pendingToggle !== null && pendingToggle.accountId !== selectedAccountId

  /*
   * 見出しの6列は実表と共有する。骨組み用に書き写すと直書きの見出し
   * （`direct-th`）が二重に数えられるため、同じ要素を使い回す。
   * 選択の列だけは実表が箱（Checkbox）付き・骨組みが共通 `Th` の空見出し。
   */
  // 見出しは本文と同じ左揃え（絵どおり）。Th（.cell の左余白20）だと本文より20右へずれる。型の持ち主へ依頼済み。
  // 狭い板（WPrd5）は回数の列だけ出さない（絵どおり。選ぶ・つまみ・操作は残す）。フォルダの列は型が畳む。
  const tableHeadCells = (
    <>
      <Th aria-label="並び替え" />
      <Th className={styles.headCell}>ルール（どんなときに動くか）</Th>
      <Th className={styles.headCell}>返すもの</Th>
      {!narrow && <Th className={styles.headCell}>今月動いた回数</Th>}
      <Th className={styles.headCell}>状態</Th>
      <Th aria-label="操作" />
    </>
  )

  /* 板 `G8i4xP`「読み込み中」：見出しなしの骨4行。 */
  const loadingSkeleton = (
    <div className={styles.skeletonRows} aria-label="読み込み中">
      {[0, 1, 2, 3].map((n) => (
        <div key={n} className={styles.skeletonRow} style={{ gap: 16, padding: '14px 24px' }} data-skeleton aria-hidden="true">
          <span className={styles.skeletonDot} style={{ width: 32, height: 32 }} />
          <span className={styles.skeletonBar} style={{ height: 10 }} />
          <span className={styles.skeletonBar} style={{ height: 10 }} />
          <span className={styles.skeletonBar} style={{ height: 10 }} />
          <span className={styles.skeletonBar} style={{ height: 10 }} />
        </div>
      ))}
    </div>
  )

  const listBody = visibleLoadState === 'loading' ? (
    <div className={styles.tableWrap} aria-busy="true" aria-label="読み込んでいます">
      <DelayedSkeleton loading skeleton={loadingSkeleton} />
    </div>
  ) : visibleLoadState === 'error' || visibleLoadState === 'forbidden' ? (
    <div className={styles.stateCard} style={{ padding: '28px 24px' }} data-design-node="G8i4xP">
      <span className={`${styles.stateIcon} ${styles.stateIconError}`} style={{ width: 32, height: 32 }}>
        <TriangleAlert size={16} aria-hidden="true" />
      </span>
      <p className={styles.stateTitle}>
        {visibleLoadState === 'forbidden' ? LOAD_STATE_WORDS.forbidden.label : '自動応答を読み込めませんでした'}
      </p>
      <p className={styles.stateDesc}>
        {visibleLoadState === 'forbidden'
          ? LOAD_STATE_WORDS.forbidden.note
          : isForbiddenOrRateLimited(loadError)
            ? LOAD_STATE_WORDS.error.note
            : '登録したルールは消えていません。数の帯は「—」、道具はそのまま使えます（条件を変えてから試し直せる）。'}
      </p>
      {visibleLoadState === 'error' && (
        <Button type="button" onClick={() => void load()}>もう一度試す</Button>
      )}
    </div>
  ) : sortedItems.length === 0 ? (
    /* 修正案 D-2：空の一覧。閲覧のみには作るボタンを出さない。 */
    <EmptyList
      data-design-node="G8i4xP"
      icon={<MessageSquare aria-hidden="true" />}
      title="まだ自動応答がありません"
      description="届いた言葉に合わせて、決めた返事を自動で送ります。"
      create={{ label: '最初の自動応答を作る', onClick: () => router.push('/auto-replies/edit') }}
      canCreate={canEdit}
      filtered={filterActive}
      onClearFilters={clearFilters}
      filteredDescription="「停止中のみ」「時間帯あり」「今月0回」や検索を外すと、すべて出ます"
    />
  ) : (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {moveNotice}
      </span>
      <div className={narrow ? `${styles.tableWrap} ${styles.narrowTable}` : styles.tableWrap} data-content-in="">
        <DataTable>
          <colgroup>
            {/* ★V8 列の幅＝絵の中身の幅＋欄の間16。端の列は端の24も足す（uE9gf：選ぶ16・つまみ14・返すもの200・回数96・状態60・操作28） */}
            <col style={{ width: 16 + 24 + 8 }} />
            <col style={{ width: 14 + 16 }} />
            {!narrow ? <col style={{ width: 426 }} /> : <col />}
            <col style={{ width: 200 + 16 }} />
            {!narrow && <col style={{ width: 96 + 16 }} />}
            <col style={{ width: 80 + 16 }} />
            <col style={{ width: 28 + 8 + 24 }} />
          </colgroup>
          <thead>
            <TableHeadRow>
                <Th className={styles.selectCell} aria-label="選択">
                  {canEdit && <Checkbox
                    checked={allOnPageSelected}
                    indeterminate={!allOnPageSelected && selectedCount > 0}
                    onCheckedChange={() => toggleAllOnPage()}
                    aria-label="このページのルールをすべて選択"
                  />}
                </Th>
              {tableHeadCells}
            </TableHeadRow>
          </thead>
          <RovingTbody reorderKey={liveOrder.shown.map((r) => r.id).join(',')}>
            {liveOrder.shown.map((r) => {
              const name = displayName(r)
              const conflicts = r.conflictAttentionCount ?? 0
              const actions = actionSummary(r)
              // 曜日・時間帯は札にせず条件の行の中に書く（絵どおり）。それ以外の札だけ残す。
              const trigger = triggerSummary(r)
              const schedule = scheduleText(r)
              const scheduleLabels = scheduleChipLabels(r)
              const extraChips = conditionChips(r).filter(
                (label) => !scheduleLabels.includes(label),
              )
              const tpl = templateWord(
                r.templateId,
                templateById.get(r.templateId ?? '')?.name ?? null,
                templateListAvailable,
              )
              return (
                <Tr interactive
                  key={r.id}
                  data-reorder-id={r.id}
                  onDragEnter={() => liveOrder.enter(r.id)}
                  onDragOver={dragId ? (event) => event.preventDefault() : undefined}
                  onDrop={dragId ? () => dropOn(liveOrder.dropTarget(r.id)) : undefined}
                  className={styles.rowClick}
                  tabIndex={0}
                  onClick={() => setPanelId(r.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      setPanelId(r.id)
                    }
                  }}
                >
                    <Td className={styles.selectCell} onClick={(event) => event.stopPropagation()}>
                      {canEdit && <Checkbox
                        checked={selectedIds.has(r.id)}
                        onCheckedChange={() => toggleOne(r.id)}
                        aria-label={`${name}を選択`}
                      />}
                    </Td>
                  <Td
                    className={styles.gripCell}
                    onClick={(event) => event.stopPropagation()}
                    draggable={canEdit && sortKey === 'priority'}
                    onDragStart={() => setDragId(r.id)}
                    onDragEnd={() => setDragId(null)}
                  >
                    {canEdit && <ReorderGrip
                      label={name}
                      disabled={sortKey !== 'priority'}
                      disabledReason={sortKey !== 'priority' ? '並びを「評価順」にすると動かせます' : undefined}
                      onMove={(direction) => keyboardMove(r.id, direction)}
                    >
                      <span aria-hidden>⠿</span>
                    </ReorderGrip>}
                  </Td>
                  <NameCell
                    name={<div className={styles.nameRow}>
                      <FolderDotName folder={folderDotOf(r)}>
                        <Link
                          href={`/auto-replies/edit?id=${r.id}`}
                          title={name}
                          className={styles.cellTitle}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                            event.preventDefault()
                            goEdit(r.id)
                          }}
                        >
                          {name}
                        </Link>
                      </FolderDotName>
                      {conflicts > 0 && (
                        <button
                          type="button"
                          className={styles.miniBadgeWarn}
                          title="同じ受信に先に当たるルールがあります。押すと重なりのあるルールだけを表示します"
                          onClick={(event) => {
                            event.stopPropagation()
                            setConflictOnly(true)
                            setPage(1)
                          }}
                        >
                          <span>重なり {conflicts}</span>
                        </button>
                      )}
                    </div>}
                    sub={<span className={narrow ? undefined : styles.dotIndent} title={schedule ? `${trigger.title} ／ ${schedule}` : trigger.title}>
                      {trigger.text}
                      {schedule ? (
                        <>
                          {' '}
                          <Clock size={11} aria-hidden="true" className={styles.cellSubIcon} />
                          {' '}{schedule}
                        </>
                      ) : null}
                    </span>}
                    memo={extraChips.length > 0 ? (
                      <div className={narrow ? undefined : styles.dotIndent}>
                        {extraChips.map((label) => (
                          <span key={label} className={styles.condChip} title={label}>
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  />
                  <Td className={styles.middleCell}>
                    {/* 絵 uE9gf：1行目「テキストで返す」／「テンプレート『〇〇』」、2行目「＋対応マーク・担当者へ通知」／「なし」。 */}
                    <span className={styles.cellMain} title={tpl.linked ? tpl.note : responseTypeWord(r.responseType).note}>
                      {r.responseType === 'silent'
                        ? '返信しない'
                        : tpl.linked
                          ? `テンプレート「${tpl.label}」`
                          : `${responseTypeWord(r.responseType).label}で返す`}
                    </span>
                    <span className={styles.cellSub} title={actions.join('・') || 'なし'}>
                      {actions.length > 0 ? `＋${actions.join('・')}` : 'なし'}
                    </span>
                  </Td>
                  {!narrow && (
                    <Td
                      className={styles.countCell}
                      title={`今月 ${r.hits?.period ?? '—'}回 ／ 累計 ${r.hits?.total ?? '—'}回`}
                    >
                      {/* 数えられていないものを 0 と書かない。0 は「当たらなかった」の意味。 */}
                      <div className={styles.countMain}>{r.hits?.period ?? '—'}<span className={styles.kpiUnit}>回</span></div>
                      <div className={styles.countSub}>累計 {r.hits?.total == null ? '—' : formatNumber(r.hits.total)}回</div>
                    </Td>
                  )}
                  <Td>
                    <span
                      className={`${styles.statePill} ${r.isActive ? styles.statePillActive : styles.statePillStopped}`}
                      title={stopNote(r) ?? undefined}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: 'var(--radius-pill)', background: 'currentColor' }} aria-hidden="true" />
                      {r.isActive ? '有効' : '停止中'}
                    </span>
                    {!r.isActive && r.stopReason && (
                      <p className={styles.stateSub} style={{ maxWidth: 140 }} title={stopNote(r) ?? ''}>
                        {r.stopReason}
                      </p>
                    )}
                  </Td>
                    <Td className={styles.menuCell} onClick={(event) => event.stopPropagation()} data-design-node={openMenuId === r.id ? 'IIesG' : undefined}>
                      {/* 横並びにして、メニューの位置の目印（空の span）が行を1段増やさないようにする。 */}
                      <div className={styles.menuBox}>
                      <ContextMenu
                        label={`自動応答「${name}」の操作`}
                        items={rowContextItems(r)}
                      >
                        <RowMenu
                          label={`自動応答「${name}」の操作`}
                          items={rowMenuItems(r)}
                          open={openMenuId === r.id}
                          onOpenChange={(next) => setOpenMenuId(next ? r.id : null)}
                        />
                      </ContextMenu>
                      </div>
                    </Td>
                </Tr>
              )
            })}
          </RovingTbody>
        </DataTable>
      </div>

      {/* 行の詳細パネル（V8「サクサク感」C①・E）。一覧は左に見えたまま。 */}
      {panelRow &&
        (() => {
          const name = displayName(panelRow)
          const trigger = triggerSummary(panelRow)
          const canToggle = panelRow.isActive || panelRow.lifecycleStatus !== 'draft'
          return (
            <DetailPanel
              open
              title={name}
              description={trigger.text}
              onClose={() => setPanelId(null)}
              onPrev={panelIndex > 0 ? () => setPanelId(items[panelIndex - 1].id) : undefined}
              onNext={
                panelIndex < items.length - 1 ? () => setPanelId(items[panelIndex + 1].id) : undefined
              }
              hasPrev={panelIndex > 0}
              hasNext={panelIndex < items.length - 1}
              footer={
                <>
                  <Button variant="primary" onClick={() => goEdit(panelRow.id)}>
                    開く
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      withViewTransition(() => {
                        router.push(`/auto-replies/runs?id=${panelRow.id}`)
                      })
                    }
                  >
                    実行結果を見る
                  </Button>
                  {canEdit && <Button
                    variant="secondary"
                    onClick={() => {
                      setDuplicateError('')
                      setDuplicateTarget(panelRow)
                      setPanelId(null)
                    }}
                  >
                    複製する
                  </Button>}
                  {canEdit && canToggle && (
                    <Button
                      variant="secondary"
                      onClick={() => toggleFromPanel(panelRow)}
                    >
                      {panelRow.isActive ? '止める' : '再開する'}
                    </Button>
                  )}
                  {canEdit && <Button
                    variant="secondary"
                    onClick={() => {
                      setPanelId(null)
                      requestDelete(panelRow)
                    }}
                  >
                    削除する
                  </Button>}
                </>
              }
            >
              <p>
                {panelRow.isActive ? '有効' : '停止中'} ／ 今月 {panelRow.hits?.period ?? '—'}回 ／
                累計 {panelRow.hits?.total ?? '—'}回
              </p>
            </DetailPanel>
          )
        })()}

      {/* まとめての帯（選ぶと表の下に出る）：止める・再開・フォルダへ移す。 */}
      {canEdit && selectedCount > 0 ? (
        <div className={styles.bulkRow} style={{ padding: '10px 14px' }} role="region" aria-label="選択中のまとめ操作">
          <span className={styles.bulkCount} aria-live="polite" aria-atomic="true">{selectedCount}件を選択中</span>
          <Button
            type="button"
            variant="secondary"
            disabled={stoppableIds.length === 0}
            title={stoppableIds.length === 0 ? '動いているルールが選ばれていません' : undefined}
            onClick={() => {
              setToggleError('')
              setToggleReason('')
              setPendingToggle({ ids: stoppableIds, names: [], kind: 'stop', accountId: selectedAccountId })
            }}
          >
            <Square size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
            まとめて止める
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={resumableIds.length === 0}
            title={resumableIds.length === 0 ? '停止中のルールが選ばれていません' : undefined}
            onClick={() => {
              setToggleError('')
              setPendingToggle({ ids: resumableIds, names: [], kind: 'resume', accountId: selectedAccountId })
            }}
          >
            <Play size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
            まとめて再開
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => openMove([...selectedIds])}
          >
            <FolderIcon size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
            フォルダへ移す
          </Button>
          <Button type="button" variant="secondary" onClick={() => setSelectedIds(new Set())}>
            選択を外す
          </Button>
        </div>
      ) : null}

      <p className={styles.footNote}>
        □ で選ぶと、下に「まとめて止める・再開・フォルダへ移す」の帯が出ます。行を押すと編集。「…」に 停止・複製・実行結果・削除。「重なり」の札は、同じ受信に先に当たるルールがあるという印（押すと重なりのあるルールだけを表示します）。
      </p>

    </>
  )

  /* ページ送りは型の pagination 枠へ（余白は型）。 */
  const listPager = pageCount > 1 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>
        {(safePage - 1) * pageSize + 1}〜{Math.min(safePage * pageSize, sortedItems.length)} / {formatNumber(sortedItems.length)}件
      </span>
      <Pagination page={safePage} pageCount={pageCount} onPageChange={setPage} />
    </ListPagePagination>
  ) : null

  const filterChips = (
            <div role="group" aria-label="状態で絞り込む">
            <FilterChip
              selected={stoppedOnly}
              onChange={(next) => {
                setStoppedOnly(next)
                setPage(1)
              }}
              title="無効にしてあるルール"
              icon={<Pause size={14} aria-hidden="true" />}
            >
              停止中のみ
            </FilterChip>
            <FilterChip
              selected={timedOnly}
              onChange={(next) => {
                setTimedOnly(next)
                setPage(1)
              }}
              title="曜日か時間帯を決めているルール"
              icon={<CircleHelp size={14} aria-hidden="true" />}
            >
              時間帯あり
            </FilterChip>
<FilterChip
              selected={zeroThisMonthOnly}
              onChange={(next) => {
                setZeroThisMonthOnly(next)
                setPage(1)
              }}
              title="今月1度も当たっていないルール"
              icon={<Ban size={14} aria-hidden="true" />}
            >
              今月0回
            </FilterChip>
            {conflictOnly ? (
              <FilterChip
                selected={conflictOnly}
                onChange={(next) => {
                  setConflictOnly(next)
                  setPage(1)
                }}
                title="同じ受信に当たり得る、ほかのルールがあるもの"
                icon={<Layers size={14} aria-hidden="true" />}
              >
                重なりあり
              </FilterChip>
            ) : null}
            </div>
  )
  const sortBox = (
              <div data-sort-select className={styles.sortBox}>
                <SortSelect value={sortKey} onChange={(value) => setSortKey(value as SortKey)} options={SORT_OPTIONS} label="並び：" />
              </div>
  )
  const savedBox = (
              <div className={styles.savedBox}>
              <Bookmark size={14} aria-hidden="true" className={styles.savedIcon} />
              <Select
                aria-label="よく使う絞り込み"
                value={savedFilter}
                onChange={(value) => {
                  if (value === 'toggle-zero') setZeroThisMonthOnly(!zeroThisMonthOnly)
                  else if (value === 'toggle-conflict') setConflictOnly(!conflictOnly)
                  else setSavedFilter(value)
                  setPage(1)
                }}
                options={[
                  ...SAVED_FILTER_OPTIONS,
                  { value: 'toggle-zero', label: zeroThisMonthOnly ? '今月0回の絞り込みを外す' : '今月0回で絞り込む' },
                  ...((conflictCount ?? 0) > 0 || conflictOnly ? [{ value: 'toggle-conflict', label: conflictOnly ? '重なりの絞り込みを外す' : '重なりありで絞り込む' }] : []),
                ]}
              />
              </div>
  )
  const perPageBox = (
              <div data-per-page-select>
                <Select
                  className="w-full"
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
  const createButton = (<>

          {canEdit && <CreateRuleButton
            disabled={false}
            menuOpen={createMenuOpen}
            onOpenMenu={(anchor) => { createMenuAnchorRef.current = anchor; setCreateMenuOpen(true) }}
          />}
  </>)
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

  /*
   * 1152 の板（WPrd5）：案内の帯 → 1段目「作る・フォルダ・探す … 件数」→ 2段目「札・並び・よく使う絞り込み（印だけ）」。
   * 部品は広い板と同じもの（動きは同じ）。並びと段だけを変える。
   */
  const narrowToolbar = (
    <div className={styles.narrowTools}>
      <Notice tone="info">上のルールから順に見て、最初に当たった1つだけが動きます。順番は行の左のつまみで入れ替えます。</Notice>
      <div className={styles.narrowRow}>
        {canEdit && <CreateRuleButton
          compact
          disabled={false}
          menuOpen={createMenuOpen}
          onOpenMenu={(anchor) => { createMenuAnchorRef.current = anchor; setCreateMenuOpen(true) }}
        />}
        <div className={styles.narrowFolder}>{folderSelect}</div>
        <div className={styles.narrowSearch}>
          <SearchField
            placeholder="ルール名・言葉で探す"
            aria-label="ルール名・言葉で探す"
            value={query}
            onChange={(value) => {
              setQuery(clampSearchQuery(value))
              setPage(1)
            }}
            onClear={() => {
              setQuery('')
              setPage(1)
            }}
          />
        </div>
        <span className={styles.narrowSpacer} aria-hidden="true" />
        {perPageBox}
      </div>
      <div className={styles.narrowRow}>
        {filterChips}
        {sortBox}
        <div className={styles.savedIconOnly} title="よく使う絞り込み">{savedBox}</div>
      </div>
    </div>
  )

  return (
    <ListPage boardId={narrow ? 'WPrd5' : 'uE9gf'} headingSize="regular" title={<>
        自動応答
      </>} description={<>
        届いたメッセージに、決めた言葉・曜日・時間帯で自動で返します。上のルールから順に、最初に当たった1つだけが動きます。
      </>}
      stats={<>
        {/* 見るだけの人への帯（`Q5lOCc`）。数の帯の上。 */}
        {!canEdit && (
          <div className={styles.viewerBand} role="status" data-design-node="Q5lOCc">
            <Eye size={16} aria-hidden="true" />
            <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
          </div>
        )}
        {/* 数の帯 4つ。並びと間は共有の帯（KpiStrip）に任せ、画面CSSで書かない。 */}
        <KpiBand data-design="KPIs">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.key} presentation="band" title={kpi.title} icon={<kpi.icon size={14} aria-hidden="true" />} help={kpi.help} helpLabel={kpi.helpLabel} value={kpi.value} unit={kpi.value == null ? '' : kpi.unit} detail={kpi.detail} onRetry={kpi.key === 'conflict' && ready && (conflictCount ?? 0) > 0 ? () => { setConflictOnly(true); setPage(1) } : undefined} retryLabel="重なりを見る →" />
          ))}
        </KpiBand>
      </>}
      overlays={<>
      {/*
        骨格の印（data-design）は v7 の page.tsx 側が担う。ここへ別の節名を
        足すと、設計と画面の対を調べる design-structure の検査が
        V7＋V8 の和集合で見えてしまい、どちらの設計とも一致しなくなる。
        KPIs は V7 と同じ節名なので残す。
      */}
      {folderDialogOpen && (
        <FolderAddDialog
          kind="auto_reply"
          note="自動応答を分けてしまう箱です。消しても、入っていた応答は未分類として残ります。"
          placeholder="例: 01_営業時間外"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      )}

      {/* 止める・再開の確認窓（`i8F12`：理由つき）。単体でもまとめてでも同じ形。 */}
      <ConfirmDialog
        open={pendingToggle !== null}
        title={
          pendingToggle === null
            ? ''
            : pendingToggle.kind === 'resume'
              ? pendingToggle.ids.length === 1
                ? `自動応答「${pendingToggle.names[0]}」を再開しますか？`
                : `${pendingToggle.ids.length}件の自動応答を再開しますか？`
              : pendingToggle.ids.length === 1
                ? `「${pendingToggle.names[0]}」を止める`
                : `${pendingToggle.ids.length}件の自動応答を止めますか？`
        }
        description={
          pendingToggle?.kind === 'resume'
            ? 'これから届くメッセージで動き始めます。止めているあいだに届いた分は、さかのぼって動きません。あとから止め直せます。'
            : '止めているあいだ、このルールは動きません。届いたメッセージは、下のルールが代わりに見ます。いつ・誰が・なぜ止めたかが記録に残り、あとから再開できます。'
        }
        confirmLabel={pendingToggle?.kind === 'resume' ? '再開する' : '止める'}
        confirmIcon={pendingToggle?.kind === 'stop' ? <Pause size={16} aria-hidden="true" /> : undefined}
        designNode="i8F12"
        error={toggleError}
        onCancel={() => {
          setToggleError('')
          setToggleReason('')
          setPendingToggle(null)
        }}
        onConfirm={toggleTargetStale ? undefined : () => runToggle()}
      >
        {pendingToggle?.kind === 'stop' && (
          <div>
            <label htmlFor="auto-reply-stop-reason" className={styles.reasonLabel}>
              止める理由{' '}
              <span className="bg-canvas-sunken text-ink-faint rounded-pill inline-flex items-center px-1.5 py-0.5 text-nano font-medium">
                任意
              </span>
            </label>
            <input
              id="auto-reply-stop-reason"
              value={toggleReason}
              onChange={(event) => setToggleReason(event.target.value)}
              maxLength={500}
              placeholder="例：キャンペーンが終わったので"
              className={styles.reasonInput}
              style={{ padding: '8px 12px' }}
            />
          </div>
        )}
        {toggleTargetStale && (
          <p className="text-danger text-sm leading-relaxed" role="alert">
            アカウントが切り替わりました。操作する自動応答を選び直してください。
          </p>
        )}
      </ConfirmDialog>

      {/*
        削除の確認窓（`u8sKN`）。
        「削除は元に戻せない」ので、残す側の「代わりに止める」を一緒に出す。
        止まっている・下書きのルールでは「代わりに止める」は出さない（押しても意味が無い）。
      */}
      <Dialog
        open={pendingDelete !== null}
        title={`「${pendingDelete ? displayName(pendingDelete.item) : ''}」を削除する`}
        description="新しく届くメッセージへの自動返信と、タグ付けなどの後の処理が止まります。これまでの実行結果は消えません。"
        busy={deleting}
        error={deleteError}
        designNode="u8sKN"
        onCancel={() => {
          if (deleting) return
          setDeleteError('')
          setPendingDelete(null)
        }}
        footer={
          <div className={styles.deleteFooter}>
            <Button
              type="button"
              variant="danger"
              disabled={deleting || deleteTargetStale}
              busy={deleting}
              busyLabel="削除中…"
              onClick={() => void runDelete()}
            >
              削除する
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={deleting}
              onClick={() => {
                if (deleting) return
                setDeleteError('')
                setPendingDelete(null)
              }}
            >
              キャンセル
            </Button>
            {pendingDelete?.item.isActive ? (
              <Button
                type="button"
                variant="secondary"
                disabled={deleting || deleteTargetStale}
                onClick={stopInsteadOfDelete}
              >
                代わりに止める
              </Button>
            ) : null}
          </div>
        }
      >
        <Notice tone="danger" message="削除は元に戻せません。しばらく使わないだけなら「止める」を使ってください。" />
        {deleteTargetStale && (
          <p className="text-danger text-sm leading-relaxed" role="alert">
            アカウントが切り替わりました。削除する自動応答を選び直してください。
          </p>
        )}
      </Dialog>

      {/* フォルダへ移すの窓。1件でもまとめてでも同じ形。 */}
      <ConfirmDialog
        open={moveIds !== null}
        title={
          moveIds && moveIds.length === 1
            ? `「${displayName(rules.find((r) => r.id === moveIds[0]) ?? ({} as AutoReply))}」のフォルダを移す`
            : `${moveIds?.length ?? 0}件の自動応答をフォルダへ移す`
        }
        description="移動先のフォルダを選んでください。「未分類」を選ぶとフォルダから外れます。"
        confirmLabel="移動する"
        onConfirm={() => runMove()}
        onCancel={() => {
          setMoveIds(null)
        }}
      >
        <div className={styles.moveBody}>
          <span className={styles.moveLabel}>移動先のフォルダ</span>
          <Select
            aria-label="移動先のフォルダ"
            size="full"
            value={moveDraft}
            onChange={(value) => setMoveDraft(value)}
            options={[
              { value: '', label: '未分類' },
              ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
            ]}
          />
        </div>
      </ConfirmDialog>

      {/* 複製の確認窓。コピーは停止中で作る（動かすのは別の操作）。 */}
      <ConfirmDialog
        open={duplicateTarget !== null}
        title={duplicateTarget ? `「${displayName(duplicateTarget)}」を複製しますか？` : ''}
        description="同じ条件と返し方のルールをもう1つ作ります。コピーは「停止中」で作られるので、確認してから動かしてください。名前に「（コピー）」を付けます。"
        confirmLabel={duplicating ? '複製中…' : '複製する'}
        busy={duplicating}
        error={duplicateError}
        onConfirm={() => void runDuplicate()}
        onCancel={() => {
          if (duplicating) return
          setDuplicateTarget(null)
          setDuplicateError('')
        }}
      />
      {quickOpen ? (
        <QuickCreateV8
          accountId={selectedAccountId}
          onClose={() => setQuickOpen(false)}
          onCreated={() => void load()}
        />
      ) : null}
      </>}

      folders={<>
          {/* 閲覧のみ：作るボタンは隠し、場所だけ空ける（並びを絵どおりに保つ。2026-10-06 オーナー決定） */}
          {!canEdit && <span className={styles.viewerCreateSpace} aria-hidden="true" />}
          {canEdit && <CreateRuleButton
            full
            disabled={false}
            menuOpen={createMenuOpen}
            onOpenMenu={(anchor) => { createMenuAnchorRef.current = anchor; setCreateMenuOpen(true) }}
          />}
          <ActionMenu
            open={createMenuOpen}
            onClose={() => setCreateMenuOpen(false)}
            anchorRef={createMenuAnchorRef}
            ariaLabel="ルールの作り方"
            items={[
              { id: 'full', label: 'くわしく作る', onSelect: () => { setCreateMenuOpen(false); router.push('/auto-replies/edit') } },
              { id: 'quick', label: 'かんたんに作る', onSelect: () => { setCreateMenuOpen(false); setQuickOpen(true) } },
            ]}
          />
          {folderPanel}
        </>}
        collapsedFolders={narrow ? undefined : <>{createButton}{folderSelect}</>}
        toolbar={narrow ? narrowToolbar : <>
          {/* 案内の帯は表の上の主列に置く（板 uE9gf）。左のフォルダの列を押し下げないよう toolbar 枠の先頭に置き、一行を取る。 */}
          <div style={{ flexBasis: '100%' }}><Notice tone="info">上のルールから順に見て、最初に当たった1つだけが動きます。順番は行の左のつまみで入れ替えます。</Notice></div>
          {/* 道具の段は型の toolbar 枠に渡す（中身だけ渡す）。 */}
          <ListToolbar
            search={{
              placeholder: 'ルール名・言葉で探す',
              width: 200,
              value: query,
              onChange: (value) => {
                setQuery(clampSearchQuery(value))
                setPage(1)
              },
            }}
            filters={<>
            {filterChips}
            </>}
            trailing={<>
              {/* 絵 uE9gf：「並び：評価順」（合格したリマインダ一覧と同じ並びの部品）→ 印つきの「よく使う絞り込み」→ 件数。 */}
              {sortBox}
              {savedBox}
              {perPageBox}
            </>}
          />
        </>}

          pagination={listPager}
      >
        {actionError ? (
          <p className={styles.errorBand} style={{ padding: '10px 14px' }} role="alert">
            {actionError}
            <button type="button" onClick={() => void load()}>読み直す</button>
          </p>
        ) : null}
        {listBody}
      </ListPage>
  )
}
