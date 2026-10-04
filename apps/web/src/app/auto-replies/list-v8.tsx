'use client'

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
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CircleCheck,
  Copy,
  Folder as FolderIcon,
  MessageSquare,
  MoreHorizontal,
  Search as SearchIcon,
  Square,
  Play,
  Trash2,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { clampSearchQuery } from '@/lib/search-query'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import { notifyToast } from '@/components/shared/toast'
import { useRowLeaving } from '@/components/shared/row-leaving'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import HelpTip from '@/components/shared/help-tip'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Pagination from '@/components/shared/pagination'
import ReorderGrip from '@/components/friend-fields/reorder-grip'
import { movePriorityUpdates } from './auto-reply-order'
import {
  LOAD_STATE_WORDS,
  NO_WRITE_PERMISSION,
  actionWord,
  autoReplyMatchesQuery,
  conditionChips,
  responseTypeWord,
  stopNote,
  templateWord,
  triggerSummary,
  isCurrentAutoReplyLoad,
  visibleAutoReplyLoadState,
  type LoadState,
} from './auto-reply-words'
import styles from './list-v8.module.css'

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
    return [actionWord(type)]
  })
}

/** 行の表示名。名前があればそれ、無ければキーワード。一律応答はキーワードが無い。 */
function displayName(r: AutoReply): string {
  return r.name || (r.respondToAll ? 'すべてのメッセージ' : r.keyword)
}

const NO_MANAGE_NOTE = '自動応答の作成・変更・停止・削除はオーナーと管理者だけができます。必要なときはオーナーか管理者に頼んでください。'

export default function AutoRepliesListV8() {
  usePageTitle('自動応答')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)

  const [items, setItems] = useState<AutoReply[]>([])
  const [query, setQuery] = useState('')
  const [templates, setTemplates] = useState<TemplateLite[]>([])
  const [templateListAvailable, setTemplateListAvailable] = useState(true)
  const [conflictCount, setConflictCount] = useState<number | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<unknown>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('priority')
  const [savedFilter, setSavedFilter] = useState('')
  const [stoppedOnly, setStoppedOnly] = useState(false)
  const [timedOnly, setTimedOnly] = useState(false)
  const [zeroThisMonthOnly, setZeroThisMonthOnly] = useState(false)
  /** 「重なりあり」の絞り込み。要確認の帯・行の札から入る。 */
  const [conflictOnly, setConflictOnly] = useState(false)
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null)
  const [toggleReason, setToggleReason] = useState('')
  const [toggling, setToggling] = useState(false)
  const [toggleError, setToggleError] = useState('')
  const [moveIds, setMoveIds] = useState<string[] | null>(null)
  const [moveDraft, setMoveDraft] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState('')
  const [duplicateTarget, setDuplicateTarget] = useState<AutoReply | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState('')
  const [reordering, setReordering] = useState(false)
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

  /* ===== 数の帯 ===== */
  const hitsAllKnown = items.length > 0 && items.every((r) => r.hits !== undefined)
  const monthlyHits = hitsAllKnown
    ? items.reduce((sum, r) => sum + (r.hits?.period ?? 0), 0)
    : null
  const totalHits = hitsAllKnown
    ? items.reduce((sum, r) => sum + (r.hits?.total ?? 0), 0)
    : null
  const actionExecutionsAllKnown = items.length > 0 && items.every((r) => r.actionExecutionCount != null)
  const actionExecutionCount = actionExecutionsAllKnown
    ? items.reduce((sum, r) => sum + (r.actionExecutionCount ?? 0), 0)
    : null

  const visibleLoadState = visibleAutoReplyLoadState(loadState, loadedAccountId, selectedAccountId)
  const ready = visibleLoadState === 'ready'

  /* ===== 絞り込み ===== */
  const afterQuery = items.filter((r) => autoReplyMatchesQuery(r, query))
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
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

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
  const selectedRules = items.filter((r) => selectedIds.has(r.id))
  const stoppableIds = selectedRules.filter((r) => r.isActive).map((r) => r.id)
  const resumableIds = selectedRules.filter((r) => !r.isActive && r.lifecycleStatus !== 'draft').map((r) => r.id)

  /* ===== 操作 ===== */

  /** 停止・再開そのもの。確認窓の決定ボタンからだけ呼ぶ。 */
  const runToggle = async () => {
    if (!pendingToggle) return
    if (pendingToggle.accountId !== selectedAccountId) {
      setToggleError('アカウントが切り替わりました。操作する自動応答を選び直してください。')
      return
    }
    const requestAccountId = pendingToggle.accountId
    const ids = pendingToggle.ids
    const kind = pendingToggle.kind
    setToggling(true)
    setToggleError('')
    try {
      let failed = 0
      for (const id of ids) {
        const result = kind === 'stop'
          ? await api.autoReplies.stop(
              id,
              { reason: toggleReason.trim() === '' ? null : toggleReason.trim() },
              crypto.randomUUID(),
            )
          : await api.autoReplies.update(id, { isActive: true })
        if (!result.success) failed += 1
      }
      if (failed > 0) {
        setToggleError(
          kind === 'stop'
            ? `${failed}件を停止できませんでした。状態を読み直してからお試しください。`
            : `${failed}件を再開できませんでした。状態を読み直してからお試しください。`,
        )
        if (selectedAccountIdRef.current === requestAccountId) await load()
        return
      }
      setPendingToggle(null)
      setToggleReason('')
      setSelectedIds(new Set())
      notifyToast(kind === 'stop' ? '自動応答を停止しました' : '自動応答を再開しました')
      if (selectedAccountIdRef.current === requestAccountId) await load()
    } catch (reason) {
      setToggleError(
        reason instanceof ApiError && reason.status === 403
          ? `${NO_WRITE_PERMISSION.label}。自動応答を止めたり動かしたりするには権限が要ります。`
          : kind === 'stop'
            ? '自動応答を停止できませんでした。状態を読み直してからお試しください。'
            : '自動応答を再開できませんでした。状態を読み直してからお試しください。',
      )
    } finally {
      setToggling(false)
    }
  }

  const { isLeaving, fadeOut } = useRowLeaving()

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
      // 消えた行は 150ms 薄くしてから読み直す（V8 の動き §8）。
      if (selectedAccountIdRef.current === requestAccountId) await fadeOut([targetId], () => load())
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
    setMoveIds(ids)
    setMoveDraft('')
    setMoveError('')
  }
  const runMove = async () => {
    if (!moveIds) return
    setMoving(true)
    setMoveError('')
    try {
      let failed = 0
      for (const id of moveIds) {
        const result = await api.autoReplies.update(id, { folderId: moveDraft === '' ? null : moveDraft })
        if (!result.success) failed += 1
      }
      if (failed > 0) {
        setMoveError(`${failed}件を移動できませんでした。状態を読み直してからお試しください。`)
        await load()
        return
      }
      setMoveIds(null)
      setSelectedIds(new Set())
      notifyToast('フォルダへ移しました', { tone: 'success' })
      await load()
    } catch (reason) {
      setMoveError(
        reason instanceof ApiError && reason.status === 403
          ? `${NO_WRITE_PERMISSION.label}。${NO_WRITE_PERMISSION.note}`
          : 'フォルダへ移せませんでした。状態を読み直してからお試しください。',
      )
    } finally {
      setMoving(false)
    }
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
  const applyPriorityUpdates = async (updates: Array<{ id: string; priority: number }>) => {
    setReordering(true)
    setActionError('')
    try {
      for (const update of updates) {
        const result = await api.autoReplies.update(update.id, { priority: update.priority })
        if (!result.success) throw new Error('reorder_failed')
      }
      await load()
    } catch {
      setActionError('順番を変えられませんでした。画面を読み直してからお試しください。')
    } finally {
      setReordering(false)
    }
  }

  const keyboardMove = (id: string, direction: -1 | 1) => {
    const updates = movePriorityUpdates(sortedItems, id, direction)
    if (!updates || reordering) return
    const name = displayName(items.find((r) => r.id === id) ?? ({} as AutoReply))
    setMoveNotice(`${name}を${direction === -1 ? '1つ上' : '1つ下'}へ動かしました`)
    void applyPriorityUpdates(updates)
  }

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId || !canEdit || sortKey !== 'priority') {
      setDragId(null)
      return
    }
    const ordered = [...sortedItems]
    const fromIndex = ordered.findIndex((r) => r.id === dragId)
    const targetIndex = ordered.findIndex((r) => r.id === targetId)
    setDragId(null)
    if (fromIndex < 0 || targetIndex < 0 || reordering) return
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
    setMoveNotice(`${name}の順番を変えました`)
    void applyPriorityUpdates([...finalUpdates.entries()].map(([id, priority]) => ({ id, priority })))
  }

  /* ===== 行の「…」（Pencil `IIesG`） ===== */
  const rowMenuItems = (r: AutoReply): ActionMenuItem[] => {
    const name = displayName(r)
    const readonly = !canEdit
    const items: ActionMenuItem[] = [
      {
        id: 'edit',
        label: '編集する',
        disabled: readonly,
        disabledReason: readonly ? NO_MANAGE_NOTE : undefined,
        onSelect: () => router.push(`/auto-replies/edit?id=${r.id}`),
      },
      {
        id: 'runs',
        label: '実行結果を見る',
        external: true,
        onSelect: () => router.push(`/auto-replies/runs?id=${r.id}`),
      },
      {
        id: 'duplicate',
        label: '複製する',
        icon: <Copy size={14} aria-hidden="true" />,
        disabled: readonly,
        disabledReason: readonly ? NO_MANAGE_NOTE : undefined,
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
              icon: <Square size={14} aria-hidden="true" />,
              disabled: readonly,
              disabledReason: readonly ? NO_MANAGE_NOTE : undefined,
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
              disabled: readonly,
              disabledReason: readonly ? NO_MANAGE_NOTE : undefined,
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
      disabled: readonly,
      disabledReason: readonly ? NO_MANAGE_NOTE : undefined,
      onSelect: () => openMove([r.id]),
    })
    items.push({
      id: 'delete',
      label: '削除する',
      tone: 'danger',
      dividerBefore: true,
      disabled: readonly,
      disabledReason: readonly ? NO_MANAGE_NOTE : undefined,
      onSelect: () => {
        setDeleteError('')
        setPendingDelete({ item: r, accountId: selectedAccountId })
      },
    })
    return items
  }

  /* ===== フォルダの列 ===== */
  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: items.length },
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
      addFolderDisabled={!canEdit}
      addFolderTitle={!canEdit ? NO_MANAGE_NOTE : undefined}
      rows={folderRows}
    >
      <p className={styles.folderNote}>
        フォルダを消しても、中のルールは未分類に残ります。
      </p>
    </FolderPanel>
  )

  /* ===== 数の帯 ===== */
  const kpis = [
    {
      key: 'active',
      title: '有効',
      icon: CircleCheck,
      value: ready ? items.filter((r) => r.isActive).length : null,
      unit: '件',
      detail: ready
        ? `動いていない ${items.filter((r) => !r.isActive).length}件`
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
      value: ready ? (conflictCount === null ? null : conflictCount) : null,
      unit: '件',
      detail: ready
        ? conflictCount === null
          ? '重なりを確認できませんでした'
          : '条件が重なっているルール'
        : LOAD_STATE_WORDS[visibleLoadState].label,
    },
  ]

  /* ===== 一覧の中身 ===== */
  const deleteTargetStale =
    pendingDelete !== null && pendingDelete.accountId !== selectedAccountId
  const toggleTargetStale =
    pendingToggle !== null && pendingToggle.accountId !== selectedAccountId

  const listBody = visibleLoadState === 'loading' ? (
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
  ) : visibleLoadState === 'error' || visibleLoadState === 'forbidden' ? (
    <div className={styles.stateCard}>
      <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
        <TriangleAlert size={18} aria-hidden="true" />
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
    filterActive ? (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}>
          <SearchIcon size={18} aria-hidden="true" />
        </span>
        <p className={styles.stateTitle}>条件に合うルールはありません</p>
        <p className={styles.stateDesc}>
          「停止中のみ」「時間帯あり」「今月0回」や検索を外すと、すべて出ます。
        </p>
        <Button type="button" variant="secondary" onClick={clearFilters}>✕ 条件を外す</Button>
      </div>
    ) : (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}>
          <MessageSquare size={18} aria-hidden="true" />
        </span>
        <p className={styles.stateTitle}>まだ自動応答のルールはありません</p>
        <p className={styles.stateDesc}>
          よく届く質問や営業時間外の連絡に、自動で返せます。ひな形からも作れます。
        </p>
        {canEdit ? (
          <Button type="button" variant="primary" onClick={() => router.push('/auto-replies/edit')}>
            ＋ ルールを作る
          </Button>
        ) : (
          <Button type="button" variant="primary" disabled title={NO_MANAGE_NOTE}>
            ＋ ルールを作る
          </Button>
        )}
      </div>
    )
  ) : (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {moveNotice}
      </span>
      <div className={styles.tableWrap} data-content-in="">
        <table className={styles.table}>
          <colgroup>
            <col style={{ width: 64 }} />
            <col style={{ width: 62 }} />
            <col />
            <col style={{ width: 248 }} />
            <col style={{ width: 144 }} />
            <col style={{ width: 128 }} />
            <col style={{ width: 76 }} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.selectCell} aria-label="選択">
                <Checkbox
                  checked={allOnPageSelected}
                  indeterminate={!allOnPageSelected && selectedCount > 0}
                  onCheckedChange={() => toggleAllOnPage()}
                  aria-label="このページのルールをすべて選択"
                />
              </th>
              <th aria-label="並び替え" />
              <th>ルール</th>
              <th>返すもの</th>
              <th>今月動いた回数</th>
              <th>状態</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {shownItems.map((r) => {
              const name = displayName(r)
              const conflicts = r.conflictAttentionCount ?? 0
              const actions = actionSummary(r)
              const tpl = templateWord(
                r.templateId,
                templateById.get(r.templateId ?? '')?.name ?? null,
                templateListAvailable,
              )
              return (
                <tr
                  key={r.id}
                  className={styles.rowClick}
                  data-leaving={isLeaving(r.id) || undefined}
                  tabIndex={0}
                  onClick={() => router.push(`/auto-replies/edit?id=${r.id}`)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      router.push(`/auto-replies/edit?id=${r.id}`)
                    }
                  }}
                >
                  <td className={styles.selectCell} onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(r.id)}
                      onCheckedChange={() => toggleOne(r.id)}
                      aria-label={`${name}を選択`}
                    />
                  </td>
                  <td
                    className={styles.gripCell}
                    onClick={(event) => event.stopPropagation()}
                    draggable={canEdit && sortKey === 'priority'}
                    onDragStart={() => setDragId(r.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropOn(r.id)}
                  >
                    <ReorderGrip
                      label={name}
                      disabled={!canEdit || sortKey !== 'priority' || reordering}
                      disabledReason={
                        !canEdit
                          ? NO_MANAGE_NOTE
                          : sortKey !== 'priority'
                            ? '並びを「評価順」にすると動かせます'
                            : undefined
                      }
                      onMove={(direction) => keyboardMove(r.id, direction)}
                    >
                      <span aria-hidden>⠿</span>
                    </ReorderGrip>
                  </td>
                  <td>
                    <div className={styles.nameRow}>
                      <Link
                        href={`/auto-replies/edit?id=${r.id}`}
                        title={name}
                        className={styles.cellTitle}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {name}
                      </Link>
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
                    </div>
                    <p className={styles.cellTrigger} title={triggerSummary(r).title}>
                      {triggerSummary(r).text}
                    </p>
                    {conditionChips(r).length > 0 && (
                      <div>
                        {conditionChips(r).map((label) => (
                          <span key={label} className={styles.condChip} title={label}>
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={styles.cellSub} title={tpl.note}>
                      {tpl.label}
                    </span>
                    <span className={styles.cellSub} title={responseTypeWord(r.responseType).note}>
                      {responseTypeWord(r.responseType).label}
                    </span>
                    {actions.length > 0 && (
                      <p className={styles.cellSub} title={actions.join('・')}>
                        ＋{actions.join('・')}
                      </p>
                    )}
                  </td>
                  <td
                    className={styles.countCell}
                    title={`今月 ${r.hits?.period ?? '—'}回 ／ 累計 ${r.hits?.total ?? '—'}回`}
                  >
                    {/* 数えられていないものを 0 と書かない。0 は「当たらなかった」の意味。 */}
                    <div className={styles.countMain}>{r.hits?.period ?? '—'}<span className={styles.kpiUnit}>回</span></div>
                    <div className={styles.countSub}>累計 {r.hits?.total ?? '—'}回</div>
                  </td>
                  <td>
                    <span
                      className={`${styles.statePill} ${r.isActive ? styles.statePillActive : styles.statePillStopped}`}
                      title={stopNote(r) ?? undefined}
                    >
                      <span className={styles.stateDot} aria-hidden="true" />
                      {r.isActive ? '有効' : '停止中'}
                    </span>
                    {!r.isActive && r.stopReason && (
                      <p className={styles.stateSub} title={stopNote(r) ?? ''}>
                        {r.stopReason}
                      </p>
                    )}
                  </td>
                  <td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className={styles.menuButton}
                      title={`自動応答「${name}」の操作`}
                      aria-expanded={openMenuId === r.id}
                      onClick={() => setOpenMenuId((current) => (current === r.id ? null : r.id))}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                    <ActionMenu
                      open={openMenuId === r.id}
                      onClose={() => setOpenMenuId(null)}
                      ariaLabel={`自動応答「${name}」の操作`}
                      items={rowMenuItems(r)}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* まとめての帯（選ぶと表の下に出る）：止める・再開・フォルダへ移す。 */}
      {selectedCount > 0 ? (
        <div className={styles.bulkRow} role="region" aria-label="選択中のまとめ操作">
          <span className={styles.bulkCount}>{selectedCount}件を選択中</span>
          <Button
            type="button"
            variant="secondary"
            disabled={!canEdit || toggling || stoppableIds.length === 0}
            title={
              !canEdit
                ? NO_MANAGE_NOTE
                : stoppableIds.length === 0
                  ? '動いているルールが選ばれていません'
                  : undefined
            }
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
            disabled={!canEdit || toggling || resumableIds.length === 0}
            title={
              !canEdit
                ? NO_MANAGE_NOTE
                : resumableIds.length === 0
                  ? '停止中のルールが選ばれていません'
                  : undefined
            }
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
            disabled={!canEdit || moving}
            title={!canEdit ? NO_MANAGE_NOTE : undefined}
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

      {pageCount > 1 ? (
        <div className={styles.pagerRow}>
          <span className={styles.pagerCount}>
            {(safePage - 1) * pageSize + 1}〜{Math.min(safePage * pageSize, sortedItems.length)} / {formatNumber(sortedItems.length)}件
          </span>
          <Pagination page={safePage} pageCount={pageCount} onPageChange={setPage} />
        </div>
      ) : null}
    </>
  )

  return (
    <div className={styles.board}>
      {/*
        骨格の印（data-design）は v7 の page.tsx 側が担う。ここへ別の節名を
        足すと、設計と画面の対を調べる design-structure の検査が
        V7＋V8 の和集合で見えてしまい、どちらの設計とも一致しなくなる。
        KPIs は V7 と同じ節名なので残す。
      */}
      <div>
        <div className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.headTitle}>
              自動応答{' '}
              <HelpTip label="自動応答の動きの説明">
                上にあるルールから順に見て、最初に当てはまった1つだけが動きます。時間帯や連投の設定で見送られたときは、その次のルールを見ます。並びは「評価順」のとき、行の左のつまみで入れ替えられます。
              </HelpTip>
            </h2>
            <p className={styles.headDescription}>
              届いたメッセージに、決めた言葉・曜日・時間帯で自動で返します。
            </p>
          </div>
        </div>
      </div>

      {/* 数の帯 4つ。 */}
      <div data-design="KPIs" className={styles.kpis}>
        {kpis.map((kpi) => (
          <div key={kpi.key} className={styles.kpi}>
            <span className={styles.kpiLabel}><kpi.icon size={13} aria-hidden="true" />{kpi.title}</span>
            <p className={styles.kpiValue}>
              {kpi.value === null ? '—' : formatNumber(kpi.value)}
              <span className={styles.kpiUnit}>{kpi.value === null ? '' : kpi.unit}</span>
            </p>
            <p className={styles.kpiDetail}>{kpi.detail}</p>
            {kpi.key === 'conflict' && ready && (conflictCount ?? 0) > 0 ? (
              <button
                type="button"
                className={styles.kpiLink}
                onClick={() => {
                  setConflictOnly(true)
                  setPage(1)
                }}
              >
                重なりを見る →
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {actionError ? (
        <p className={styles.errorBand} role="alert">
          {actionError}
          <button type="button" onClick={() => void load()}>読み直す</button>
        </p>
      ) : null}

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
                ? `自動応答「${pendingToggle.names[0]}」を止めますか？`
                : `${pendingToggle.ids.length}件の自動応答を止めますか？`
        }
        description={
          pendingToggle?.kind === 'resume'
            ? 'これから届くメッセージで動き始めます。止めているあいだに届いた分は、さかのぼって動きません。あとから止め直せます。'
            : '止めているあいだ、この自動応答は動きません。いつ・誰が・なぜ止めたかが記録に残り、あとから再開できます。'
        }
        confirmLabel={pendingToggle?.kind === 'resume' ? '再開する' : '止める'}
        busy={toggling}
        error={toggleError}
        onCancel={() => {
          if (toggling) return
          setToggleError('')
          setToggleReason('')
          setPendingToggle(null)
        }}
        onConfirm={toggleTargetStale ? undefined : () => void runToggle()}
      >
        {pendingToggle?.kind === 'stop' && (
          <div>
            <label htmlFor="auto-reply-stop-reason" className={styles.reasonLabel}>
              止める理由（任意・記録に残ります）
            </label>
            <textarea
              id="auto-reply-stop-reason"
              value={toggleReason}
              onChange={(event) => setToggleReason(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder="例: キャンペーンが終わったので"
              className={styles.reasonInput}
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
        tone="destructive"
        title={`「${pendingDelete ? displayName(pendingDelete.item) : ''}」を削除する`}
        description="新しく届くメッセージへの自動返信と、タグ付けなどの後の処理が止まります。これまでの実行結果は消えません。"
        busy={deleting}
        error={deleteError}
        titleIcon={<TriangleAlert size={22} />}
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
              <Trash2 size={16} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -2 }} />
              削除する
            </Button>
            <span className={styles.deleteFooterSpacer} />
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
                variant="primary"
                disabled={deleting || deleteTargetStale}
                onClick={stopInsteadOfDelete}
              >
                <Square size={14} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -2 }} />
                代わりに止める
              </Button>
            ) : null}
          </div>
        }
      >
        <p className="text-danger text-xs leading-relaxed">
          削除は元に戻せません。しばらく使わないだけなら「止める」を使ってください。
        </p>
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
            ? `「${displayName(items.find((r) => r.id === moveIds[0]) ?? ({} as AutoReply))}」のフォルダを移す`
            : `${moveIds?.length ?? 0}件の自動応答をフォルダへ移す`
        }
        description="移動先のフォルダを選んでください。「未分類」を選ぶとフォルダから外れます。"
        confirmLabel={moving ? '移動中…' : '移動する'}
        busy={moving}
        error={moveError}
        onConfirm={() => void runMove()}
        onCancel={() => {
          if (moving) return
          setMoveIds(null)
          setMoveError('')
        }}
      >
        <div className={styles.moveBody}>
          <span className={styles.moveLabel}>移動先のフォルダ</span>
          <Select
            aria-label="移動先のフォルダ"
            size="full"
            value={moveDraft}
            onChange={(value) => setMoveDraft(value)}
            disabled={moving}
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

      <div className={styles.split}>
        {/* 左のフォルダの列。いちばん上は「ルールを作る」。 */}
        <div className={styles.folderCol}>
          <Button
            type="button"
            variant="primary"
            className="v8-folder-create w-full"
            disabled={!canEdit}
            title={!canEdit ? NO_MANAGE_NOTE : undefined}
            onClick={() => router.push('/auto-replies/edit')}
          >
            ＋ ルールを作る
          </Button>
          {folderPanel}
        </div>

        <div className={styles.listCol}>
          {/* 道具の段：検索・札 3 つ・並び・よく使う絞り込み・件数。
              狭い板では「作る」とフォルダ選びがここへ畳まれる。 */}
          <div className={styles.toolbar}>
            <Button
              type="button"
              variant="primary"
              className={styles.toolbarCreate}
              disabled={!canEdit}
              title={!canEdit ? NO_MANAGE_NOTE : undefined}
              onClick={() => router.push('/auto-replies/edit')}
            >
              ＋ ルールを作る
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
                aria-label="自動応答名で検索"
                placeholder="ルール名・言葉・返す内容で検索"
                value={query}
                onChange={(value) => {
                  setQuery(clampSearchQuery(value))
                  setPage(1)
                }}
                onClear={() => setQuery('')}
              />
            </div>
            <FilterChip
              selected={stoppedOnly}
              onChange={(next) => {
                setStoppedOnly(next)
                setPage(1)
              }}
              title="無効にしてあるルール"
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
            >
              今月0回
            </FilterChip>
            {(conflictCount ?? 0) > 0 || conflictOnly ? (
              <FilterChip
                selected={conflictOnly}
                onChange={(next) => {
                  setConflictOnly(next)
                  setPage(1)
                }}
                title="同じ受信に当たり得る、ほかのルールがあるもの"
              >
                重なりあり
              </FilterChip>
            ) : null}
            <span className={styles.toolbarSpacer} />
            <span className={styles.toolbarLabel}>並び</span>
            <Select
              aria-label="並び順"
              value={sortKey}
              onChange={(value) => setSortKey(value as SortKey)}
              options={SORT_OPTIONS}
            />
            <Select
              aria-label="よく使う絞り込み"
              value={savedFilter}
              onChange={(value) => {
                setSavedFilter(value)
                setPage(1)
              }}
              options={SAVED_FILTER_OPTIONS}
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
    </div>
  )
}
