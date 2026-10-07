'use client'


import { RovingTbody } from '@/components/shared/row-roving'
import { useDeferredDelete } from '@/lib/use-deferred-delete'
import { useLiveReorder } from '@/lib/use-live-reorder'
import { useEscapeToClearSelection } from '@/components/shared/bulk-bar'
import { ListPageBody } from '@/components/templates'
import ListToolbar from '@/components/shared/list-toolbar'
import SearchField from '@/components/shared/search-field'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
/*
 * ★V8 リマインダの一覧（Pencil「★V8 画面の地図」のリマインダの行：
 * 一覧 `apLqS`、行の「…」は `SkY9V`、一時停止は `RwVo5`、削除は `VsSyu`、
 * 状態の板は `RrYYJ`）。
 *
 * v7 の一覧（app/reminders/page.tsx 内の RemindersPageV7）とは別の部品
 * として持つ。データの口（取得・絞り込み・並び・ページ送り）は同じ。
 * 違いは置き場と見せ方だけ——「リマインダを作る」は左のフォルダの列の上、
 * 行の右端は「…」（詳細・登録者・配信予定・実行結果・編集・複製・
 * 一時停止/再開・フォルダへ移す・削除）、行の左の □ を選ぶと表の下に
 * まとめての帯（止める・再開・フォルダへ移す）。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useCallback, useDeferredValue, useEffect, useState } from 'react'
import { useListScrollMemory, useListUrlParam } from '@/components/shared/list-url-state'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bell,
  CalendarClock,
  CircleCheck,
  Copy,
  Eye,
  Folder as FolderIcon,
  FolderInput,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Search as SearchIcon,
  Send,
  Square,
  Trash2,
  TriangleAlert,
  Users,
} from 'lucide-react'
import type { ApiResponse, Folder, ReminderTriggerType } from '@line-crm/shared'
import { api, fetchApi, type ListStats } from '@/lib/api'
import { useOffsetServerList, type ServerListResponse } from '@/lib/use-server-list'
import { clampSearchQuery } from '@/lib/search-query'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import KpiCard from '@/components/shared/kpi-card'
import KpiBand from '@/components/shared/kpi-band'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import DetailPanel from '@/components/shared/detail-panel'
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu'
import { withViewTransition } from '@/components/shared/view-transition'
import Pagination from '@/components/shared/pagination'
import SheetDialog from '@/v8/reminders/sheet-dialog'
import { DelayedSkeleton } from '@/components/shared/skeleton'
import { DataTable, TableHeadRow, Tr, Td, Th, NameCell } from '@/components/shared/table'
import { runUndoable } from '@/lib/undoable'
import SortSelect from '@/components/ui/sort-select'
import PageSizeSelect from '@/components/ui/page-size-select'
import ReorderGrip from '@/components/friend-fields/reorder-grip'
import { formatTriggerOffset } from './reminder-timing'
import styles from './list-v8.module.css'

/** 未分類を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'
const PER_PAGE_OPTIONS = [20, 50, 100]
const SORT_OPTIONS = [
  { value: 'order', label: '自分で並べた順' },
  { value: 'next', label: '次の送信が近い順' },
  { value: 'created', label: '作成日が新しい順' },
  { value: 'updated', label: '更新が新しい順' },
  { value: 'name', label: '名前順' },
]
const STATUS_CHIPS = ['有効', '下書き', '停止中', '失敗あり'] as const
/* 板 `apLqS`：札には状態の図柄を付ける（有効=丸チェック・下書き=鉛筆・停止中=一時停止・失敗あり=三角注意）。 */
const STATUS_CHIP_ICONS = {
  '有効': <CircleCheck size={14} aria-hidden="true" />,
  '下書き': <Pencil size={14} aria-hidden="true" />,
  '停止中': <Pause size={14} aria-hidden="true" />,
  '失敗あり': <TriangleAlert size={14} aria-hidden="true" />,
} as const

interface ReminderRow {
  id: string
  name: string
  description: string | null
  isActive: boolean
  triggerType?: ReminderTriggerType
  deliveryMode?: 'time' | 'countdown'
  triggerOffsetMinutes?: number | null
  sendAtTime?: string | null
  folderId?: string | null
  stepCount?: number
  displayOrder?: number
  hasFailure?: boolean
  /** 送れなかった通の数（retry_wait / permanent_failed）。 */
  failedCount?: number | null
  /** これから送る通の数（queued / retry_wait）。 */
  plannedDeliveries?: number | null
  /** いちばん近い送信予定（queued / retry_wait の最小 scheduled_at）。 */
  nextScheduledAt?: string | null
  lifecycleStatus?: 'draft' | 'published' | 'stopped'
  timingSummary?: string | null
  baseDateSummary?: string | null
  createdAt: string
  updatedAt: string
}

type StatusKey = 'draft' | 'stopped' | 'active'

function statusKeyOf(row: ReminderRow): StatusKey {
  if (row.lifecycleStatus === 'draft') return 'draft'
  if (row.lifecycleStatus === 'stopped' || !row.isActive) return 'stopped'
  return 'active'
}

const BASE_LABELS: Record<string, string> = {
  booking: '予約日時',
  event: 'イベントの予約日時',
  friend_field: '友だち情報欄の日付',
  manual: '指定日時',
}

/** 行ごとに作ると件数分だけ重いため、外で1回作って使い回す。 */
function rowView(reminder: ReminderRow) {
  // 板 `apLqS`：副題は「基準日・1日前 18:00・テキスト1通」の形で「・」でつなぐ。
  const timing = reminder.timingSummary
    ? reminder.timingSummary.replace(' ／ テキスト ', '・テキスト')
    : `${formatTriggerOffset(reminder.triggerOffsetMinutes)}${reminder.sendAtTime ? ` ${reminder.sendAtTime}` : ''}・テキスト${reminder.stepCount ?? 0}通`
  const base =
    reminder.baseDateSummary ?? BASE_LABELS[reminder.triggerType ?? 'manual'] ?? '指定日時'
  return { status: statusKeyOf(reminder), subtitle: `${base}・${timing}` }
}

const NEXT_SEND_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 「次に送る」の表示（板 `apLqS`：`10/1（水）18:00`）。店舗時間帯（JST）で出す。 */
function formatNextSend(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const weekday = NEXT_SEND_WEEKDAYS.includes(get('weekday') as (typeof NEXT_SEND_WEEKDAYS)[number])
    ? get('weekday')
    : ''
  return `${get('month')}/${get('day')}（${weekday}）${get('hour')}:${get('minute')}`
}

/** 閲覧のみでも出す行の「…」の項目（見るだけのもの）。 */
const VIEW_ONLY_MENU_IDS = new Set(['detail', 'registrants', 'planned', 'runs'])

export default function RemindersListV8() {
  usePageTitle('リマインダ')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  const readonlyReason = 'この操作にはオーナーか管理者の権限が要ります'
  // 1152の板（`Iffil`）。折り畳みはCSSのコンテナ問い合わせが担い、
  // ここでは板IDだけを切り替える。
  const narrow = useNarrowViewport()

  const [folders, setFolders] = useState<Folder[]>([])
  /** 「未分類」の件数。`null` は数えていない。 */
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  /* 絞り込み・検索語・並び順・ページは URL に置く（戻ると同じ一覧に戻る。動きの点検 5 番）。 */
  const [nameQuery, setNameQuery] = useListUrlParam('q')
  const deferredNameQuery = useDeferredValue(nameQuery.trim())
  const [folderFilter, setFolderFilter] = useListUrlParam('folder')
  const [statusFilter, setStatusFilter] = useListUrlParam('status')
  const [perPage, setPerPage] = useState(20)
  // apLqS・Iffil の一覧は、次に送る予定が近いものから確認する。
  const [sort, setSort] = useListUrlParam('sort', 'next')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  /* 行の詳細パネル（V8「サクサク感」C①・D・E）。開いている行のID。 */
  const [panelId, setPanelId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [foldersError, setFoldersError] = useState(false)

  /* 数の帯。 */
  const [stats, setStats] = useState<ListStats | null>(null)
  const [statsFailed, setStatsFailed] = useState(false)

  /* 窓・まとめての帯の状態。 */
  const [pauseTarget, setPauseTarget] = useState<ReminderRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ReminderRow | null>(null)
  const deferredDelete = useDeferredDelete()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [moveIds, setMoveIds] = useState<string[] | null>(null)
  const [moveDraft, setMoveDraft] = useState('')
  const [duplicateTarget, setDuplicateTarget] = useState<ReminderRow | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [moveNotice, setMoveNotice] = useState('')

  const loadFolders = useCallback(async () => {
    setFoldersError(false)
    try {
      const res = await api.folders.list('reminder')
      if (res.success) {
        setFolders(res.data)
        setUnfiledCount(res.unfiledCount ?? null)
      } else {
        setFoldersError(true)
      }
    } catch {
      setFoldersError(true)
    }
  }, [])

  const loadStats = useCallback(async () => {
    setStatsFailed(false)
    try {
      const res = await api.listStats.get(selectedAccountId ?? undefined)
      if (res.success) setStats(res.data)
      else setStatsFailed(true)
    } catch {
      setStatsFailed(true)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])
  useEffect(() => {
    void loadStats()
  }, [loadStats])

  const loadReminderPage = useCallback(
    async (
      request: { page: number; limit: number },
      signal: AbortSignal,
    ): Promise<ServerListResponse<ReminderRow>> => {
      const query = new URLSearchParams({
        page: String(request.page),
        limit: String(request.limit),
      })
      if (selectedAccountId) query.set('lineAccountId', selectedAccountId)
      if (deferredNameQuery) query.set('q', deferredNameQuery)
      if (folderFilter) query.set('folderId', folderFilter)
      if (statusFilter) {
        query.set(
          'status',
          statusFilter === '有効'
            ? 'active'
            : statusFilter === '下書き'
              ? 'draft'
              : statusFilter === '停止中'
                ? 'stopped'
                : 'failed',
        )
      }
      query.set('sort', sort)
      const response = await fetchApi<ApiResponse<ServerListResponse<ReminderRow>>>(
        `/api/reminders?${query}`,
        { signal },
      )
      if (!response.success) throw new Error(response.error)
      return response.data
    },
    [deferredNameQuery, folderFilter, selectedAccountId, sort, statusFilter],
  )
  const reminderList = useOffsetServerList({
    requestKey: JSON.stringify([selectedAccountId, deferredNameQuery, folderFilter, statusFilter, perPage, sort]),
    load: loadReminderPage,
    initialLimit: perPage,
    pageUrlKey: 'page',
  })
  useListScrollMemory(reminderList.loaded)
  /*
   * 押した瞬間の見せ方（★V8 サクサク感 B）。軽い操作は先にこの重ねで
   * 描き換え、裏で保存する。確定・失敗・取り消しで重ねを外し、読み直す。
   * ページ・絞り込みが変わったら重ねは捨てる（違う一覧に貼らない）。
   */
  const [optimisticRows, setOptimisticRows] = useState<{ key: string; rows: ReminderRow[] } | null>(null)
  const listContextKey = JSON.stringify({
    account: selectedAccountId ?? '',
    query: deferredNameQuery,
    folder: folderFilter,
    status: statusFilter,
    perPage,
    sort,
    page: reminderList.page,
  })
  const listedReminders = optimisticRows && optimisticRows.key === listContextKey ? optimisticRows.rows : reminderList.items
  // 消して「元に戻す」を待っている行は出さない（動きの点検 17 番）。
  const reminders = deferredDelete.hiddenCount > 0
    ? listedReminders.filter((row) => !deferredDelete.isHidden(row.id))
    : listedReminders
  const detailHref = (id: string) => `/reminders/detail?id=${encodeURIComponent(id)}`
  const filterActive = Boolean(nameQuery.trim() || folderFilter || statusFilter)

  /* ===== 行の操作 ===== */

  /*
   * 1件の「一時停止／再開」は押した瞬間に描き換え、裏で保存する
   * （★V8 サクサク感 B）。5秒のあいだ知らせの「元に戻す」で
   * 送らずに戻せる。一時停止の窓（`RwVo5`）は残し、確定で即反映する。
   */
  const runToggle = (row: ReminderRow, next: boolean) => {
    setActionError('')
    const key = listContextKey
    setOptimisticRows({
      key,
      rows: reminders.map((item) =>
        item.id === row.id
          ? { ...item, isActive: next, lifecycleStatus: next ? 'published' : 'stopped' }
          : item,
      ),
    })
    runUndoable({
      message: next ? `「${row.name}」を再開しました` : `「${row.name}」を一時停止しました`,
      commit: async () => {
        const res = await api.reminders.update(row.id, { isActive: next })
        if (!res.success) throw new Error(res.error)
      },
      undo: () => setOptimisticRows(null),
      failureMessage: next
        ? `「${row.name}」を再開できませんでした。`
        : `「${row.name}」を一時停止できませんでした。`,
      onCommitted: () => {
        setOptimisticRows(null)
        reminderList.retry()
        void loadStats()
      },
    })
  }

  const runPause = () => {
    if (!pauseTarget) return
    const row = pauseTarget
    setPauseTarget(null)
    runToggle(row, false)
  }

  const runResume = (row: ReminderRow) => runToggle(row, true)

  /* ===== 削除 ===== */

  /*
   * 下書きのまま一度も予定を作っていないリマインダは、消しても誰にも影響しない。
   * 確かめの窓を出さずに一覧から外し、5秒は「元に戻す」で取り消せる（動きの点検 17 番）。
   * 公開済み・止めたもの（登録者や予定が消える）は、今までどおり確かめの窓（VsSyu）。
   */
  const requestDelete = (row: ReminderRow) => {
    setDeleteError('')
    if (statusKeyOf(row) !== 'draft' || (row.plannedDeliveries ?? 0) > 0) {
      setDeleteTarget(row)
      return
    }
    setSelectedIds((current) => {
      if (!current.has(row.id)) return current
      const next = new Set(current)
      next.delete(row.id)
      return next
    })
    deferredDelete.schedule({
      ids: [row.id],
      message: `リマインダ「${row.name}」を削除しました`,
      commit: () => api.reminders.delete(row.id),
      onCommitted: () => {
        reminderList.retry()
        void loadStats()
      },
      failureMessage: 'リマインダを削除できませんでした。もう一度お試しください。',
    })
  }

  const deleteStillListed =
    deleteTarget !== null && reminders.some((row) => row.id === deleteTarget.id)

  const runDelete = async () => {
    if (!deleteTarget || deleting || !deleteStillListed) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.reminders.delete(deleteTarget.id)
      if (!res.success) throw new Error(res.error)
      setDeleteTarget(null)
      setSelectedIds((current) => {
        const next = new Set(current)
        next.delete(deleteTarget.id)
        return next
      })
      reminderList.retry()
      void loadStats()
    } catch {
      setDeleteError('このリマインダを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  /* ===== 複製（下書きとして写す） ===== */

  const runDuplicate = async () => {
    if (!duplicateTarget || duplicating) return
    setDuplicating(true)
    setDuplicateError('')
    try {
      const draft = await api.reminders.getDraft(duplicateTarget.id)
      if (!draft.success) throw new Error(draft.error)
      const settings = draft.data.settings
      const res = await api.reminders.createDraft({
        ...settings,
        name: `${duplicateTarget.name} のコピー`,
      })
      if (!res.success) throw new Error(res.error)
      const newId = String(res.data.reminderId)
      setDuplicateTarget(null)
      reminderList.retry()
      router.push(`/reminders/edit?id=${encodeURIComponent(newId)}&stage=target`)
    } catch {
      setDuplicateError('複製できませんでした。通信を確かめて、もう一度お試しください。')
      reminderList.retry()
    } finally {
      setDuplicating(false)
    }
  }

  /* ===== フォルダ移動 ===== */

  const openMove = (ids: string[]) => {
    if (ids.length === 0) return
    setMoveDraft('')
    setMoveIds(ids)
  }

  /*
   * フォルダ移動は窓で行き先だけ選び、押した瞬間に描き換えて裏で保存する
   * （★V8 サクサク感 B）。5秒のあいだ知らせの「元に戻す」で送らずに戻せる。
   */
  const runMove = () => {
    if (!moveIds || moveIds.length === 0) return
    const ids = moveIds
    const folderId = moveDraft || null
    const key = listContextKey
    setOptimisticRows({
      key,
      rows: reminders.map((row) => (ids.includes(row.id) ? { ...row, folderId } : row)),
    })
    setMoveIds(null)
    runUndoable({
      message: folderId ? 'フォルダへ移しました' : 'フォルダから外しました',
      commit: async () => {
        const results = await Promise.all(
          ids.map((id) => api.reminders.update(id, { folderId }).catch(() => null)),
        )
        const failed = results.filter((res) => !res || !res.success).length
        if (failed > 0) throw new Error(`${failed}件のフォルダを移動できませんでした`)
      },
      undo: () => setOptimisticRows(null),
      failureMessage: 'フォルダを移動できませんでした。',
      onCommitted: () => {
        setOptimisticRows(null)
        const moved = new Set(ids)
        setSelectedIds((current) => new Set([...current].filter((id) => !moved.has(id))))
        reminderList.retry()
      },
    })
  }

  /* ===== まとめて「止める／再開」 ===== */

  const allOnPageSelected = reminders.length > 0 && reminders.every((row) => selectedIds.has(row.id))
  const selectedCount = selectedIds.size
  // 選んでいる間は Esc で選択を外す（動きの点検 12・20 番）。
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  useEscapeToClearSelection(selectedCount > 0, clearSelection)
  const selectedRows = reminders.filter((row) => selectedIds.has(row.id))
  const stoppableIds = selectedRows.filter((row) => statusKeyOf(row) === 'active').map((row) => row.id)
  const resumableIds = selectedRows.filter((row) => statusKeyOf(row) === 'stopped').map((row) => row.id)

  const toggleAllOnPage = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allOnPageSelected) reminders.forEach((row) => next.delete(row.id))
      else reminders.forEach((row) => next.add(row.id))
      return next
    })
  }
  const toggleOne = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /*
   * まとめて「一時停止／再開」は押した瞬間に描き換え、裏で保存する
   * （★V8 サクサク感 B）。確認の窓は出さず、5秒のあいだ知らせの
   * 「元に戻す」で送らずに戻せる。
   */
  const runBulkToggle = (next: boolean, ids: string[]) => {
    if (ids.length === 0) return
    const key = listContextKey
    setOptimisticRows({
      key,
      rows: reminders.map((row) =>
        ids.includes(row.id)
          ? { ...row, isActive: next, lifecycleStatus: next ? 'published' : 'stopped' }
          : row,
      ),
    })
    runUndoable({
      message: next ? `${ids.length}件を再開しました` : `${ids.length}件を一時停止しました`,
      commit: async () => {
        const results = await Promise.all(
          ids.map((id) => api.reminders.update(id, { isActive: next }).catch(() => null)),
        )
        const failed = results.filter((res) => !res || !res.success).length
        if (failed > 0) throw new Error(`${failed}件の保存に失敗しました`)
      },
      undo: () => setOptimisticRows(null),
      failureMessage: next ? '再開できませんでした。' : '一時停止できませんでした。',
      onCommitted: () => {
        setOptimisticRows(null)
        setSelectedIds(new Set())
        reminderList.retry()
        void loadStats()
      },
    })
  }

  /* ===== 並び替え ===== */

  /*
   * 掴んで入れ替えた並びを先に描き換え、裏で保存する（★V8 サクサク感 B）。
   * 5秒のあいだは知らせの「元に戻す」で送らずに戻せる。
   */
  const handleReorder = (order: string[]) => {
    setActionError('')
    const key = listContextKey
    const byId = new Map(reminders.map((row) => [row.id, row]))
    const nextRows = order.map((id) => byId.get(id)).filter((row): row is ReminderRow => row !== undefined)
    if (nextRows.length !== reminders.length) {
      reminderList.retry()
      return
    }
    setOptimisticRows({ key, rows: nextRows })
    runUndoable({
      message: '並び順を変えました',
      commit: async () => {
        const res = await api.reminders.reorder(order)
        if (!res.success) throw new Error(res.error)
      },
      undo: () => setOptimisticRows(null),
      failureMessage: '並び替えを保存できませんでした。',
      onCommitted: () => {
        setOptimisticRows(null)
        reminderList.retry()
      },
    })
  }

  /* 動かしている間、置き場所を入れ替えて見せ、ほかの行は滑らかに場所を空ける（フルード ②）。 */
  const liveOrder = useLiveReorder(reminders, (row) => row.id, dragId)

  const dropOn = (targetId: string) => {
    const from = dragId
    setDragId(null)
    if (!from || from === targetId || !canEdit) return
    const order = reminders.map((row) => row.id)
    const fromIdx = order.indexOf(from)
    const toIdx = order.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))
    void handleReorder(order)
  }

  const keyboardMove = (id: string, direction: -1 | 1) => {
    const order = reminders.map((row) => row.id)
    const fromIdx = order.indexOf(id)
    const toIdx = fromIdx + direction
    const name = reminders.find((row) => row.id === id)?.name ?? 'このリマインダ'
    if (fromIdx < 0 || !canEdit) return
    if (toIdx < 0 || toIdx >= order.length) {
      setMoveNotice(`「${name}」は${direction < 0 ? '先頭' : '末尾'}にあるため、これ以上動かせません`)
      return
    }
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))
    setMoveNotice(`「${name}」を${direction < 0 ? '上' : '下'}へ移動しました。${toIdx + 1}番目です`)
    void handleReorder(order)
  }

  /* ===== フォルダの列 ===== */

  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: reminderList.total ?? null, color: 'var(--color-accent)' },
    ...folders.map((folder) => ({
      id: folder.id,
      label: folder.name,
      count: folder.itemCount ?? null,
      color: folder.color,
    })),
    { id: UNFILED, label: '未分類', count: unfiledCount, color: 'var(--color-ink-disabled)' },
  ]

  const folderSelectOptions = [
    { value: '', label: 'フォルダ：すべて' },
    ...folders.map((folder) => ({ value: folder.id, label: `フォルダ：${folder.name}` })),
    { value: UNFILED, label: 'フォルダ：未分類' },
  ]

  const reminderStats = stats?.reminders as (ListStats['reminders'] & { failed?: number | null }) | undefined

  const kpis = [
    {
      title: 'リマインダ',
      icon: Bell,
      value: statsFailed ? null : reminderStats?.total ?? null,
      unit: '件',
      detail: reminderStats ? `有効 ${reminderStats.active}件` : '—',
      link: null as null | (() => void),
    },
    {
      title: 'これから送る',
      icon: Send,
      value: statsFailed ? null : reminderStats?.waiting ?? null,
      unit: '通',
      detail: '今後7日',
      link: null,
    },
    {
      title: '今月送った',
      icon: CalendarClock,
      value: statsFailed ? null : reminderStats?.sentThisMonth ?? null,
      unit: '通',
      detail: '正常に送れた分',
      link: null,
    },
    {
      title: '送れなかった',
      icon: TriangleAlert,
      value: statsFailed ? null : reminderStats?.failed ?? null,
      unit: '通',
      detail: '理由を見る',
      link: () => setStatusFilter('失敗あり'),
    },
  ]

  /* ===== 行の「…」の中身（★V8 `SkY9V`） ===== */

  /** 一覧の行→詳細はつながる移り変わりで開く。 */
  const goDetail = (href: string) => {
    withViewTransition(() => {
      router.push(href)
    })
  }

  /** 右クリックは「…」と同じ項目をマウスの位置に出す。 */
  const rowContextItems = (row: ReminderRow): ContextMenuItem[] =>
    rowMenuItems(row).map((item) => ({
      id: item.id,
      label: item.label,
      danger: item.tone === 'danger',
      disabled: item.disabled,
      onSelect: () => item.onSelect(),
    }))

  const panelIndex = panelId === null ? -1 : reminders.findIndex((row) => row.id === panelId)
  const panelRow = panelIndex >= 0 ? reminders[panelIndex] : null

  const rowMenuItems = (row: ReminderRow): ActionMenuItem[] => {
    const status = statusKeyOf(row)
    const items: ActionMenuItem[] = [
      { id: 'detail', label: '詳細を見る', icon: <ArrowRight size={15} aria-hidden="true" />, onSelect: () => goDetail(detailHref(row.id)) },
      { id: 'registrants', label: '登録者を管理', icon: <Users size={15} aria-hidden="true" />, onSelect: () => goDetail(detailHref(row.id)) },
      { id: 'planned', label: '配信予定を見る', icon: <CalendarClock size={15} aria-hidden="true" />, onSelect: () => goDetail(`${detailHref(row.id)}&status=planned`) },
      { id: 'runs', label: '実行結果を見る', icon: <Activity size={15} aria-hidden="true" />, onSelect: () => goDetail(detailHref(row.id)) },
      {
        id: 'edit',
        label: '編集する',
        icon: <Pencil size={15} aria-hidden="true" />,
        dividerBefore: true,
        disabled: !canEdit,
        disabledReason: canEdit ? undefined : readonlyReason,
        onSelect: () => goDetail(`/reminders/edit?id=${encodeURIComponent(row.id)}`),
      },
      {
        id: 'duplicate',
        label: '複製する',
        icon: <Copy size={15} aria-hidden="true" />,
        disabled: !canEdit,
        disabledReason: canEdit ? undefined : readonlyReason,
        onSelect: () => {
          setDuplicateError('')
          setDuplicateTarget(row)
        },
      },
      status === 'active'
        ? {
            id: 'pause',
            label: '一時停止する',
            icon: <Pause size={15} aria-hidden="true" />,
            disabled: !canEdit,
            disabledReason: canEdit ? undefined : readonlyReason,
            onSelect: () => {
                        setPauseTarget(row)
            },
          }
        : status === 'stopped'
          ? {
              id: 'resume',
              label: '再開する',
              icon: <Play size={15} aria-hidden="true" />,
              disabled: !canEdit,
              disabledReason: canEdit ? undefined : readonlyReason,
              onSelect: () => void runResume(row),
            }
          : {
              id: 'pause-none',
              label: '一時停止する',
              icon: <Pause size={15} aria-hidden="true" />,
              disabled: true,
              disabledReason: '下書きはまだ送っていないため、止める予定がありません',
              onSelect: () => {},
            },
      {
        id: 'move',
        label: 'フォルダへ移す',
        icon: <FolderInput size={15} aria-hidden="true" />,
        disabled: !canEdit,
        disabledReason: canEdit ? undefined : readonlyReason,
        onSelect: () => openMove([row.id]),
      },
      {
        id: 'delete',
        label: '削除',
        icon: <Trash2 size={15} aria-hidden="true" />,
        tone: 'danger',
        dividerBefore: true,
        disabled: !canEdit,
        disabledReason: canEdit ? undefined : readonlyReason,
        onSelect: () => requestDelete(row),
      },
    ]
    // 閲覧のみには押せない項目を置かない（2026-10-06 オーナー決定）。見る項目だけ残す。
    return canEdit ? items : items.filter((item) => VIEW_ONLY_MENU_IDS.has(item.id))
  }

  /* ===== 表 ===== */

  /*
   * 見出しの6列は実表と共有する。骨組み用に書き写すと直書きの見出し
   * （`direct-th`）が二重に数えられるため、同じ要素を使い回す。
   * 選択の列だけは実表が箱（Checkbox）付き・骨組みが共通 `Th` の空見出し。
   */
  const tableHeadCells = (
    <>
      <Th aria-label="並び替え" />
      <Th>リマインダ（基準日・いつ送るか）</Th>
      <Th>状態</Th>
      <Th>これから送る</Th>
      <Th>次に送る</Th>
      <Th aria-label="操作" />
    </>
  )

  /* 板 `RrYYJ`「読み込み中」：見出しなしの骨4行。 */
  const loadingSkeleton = (
    <div className={styles.skeletonRows} aria-label="読み込み中">
      {[0, 1, 2, 3].map((n) => (
        <div key={n} className={styles.skeletonRow} data-skeleton aria-hidden="true">
          <span className={styles.skeletonDot} />
          <span className={styles.skeletonBar} />
          <span className={styles.skeletonBar} />
          <span className={styles.skeletonBar} />
          <span className={styles.skeletonBar} />
        </div>
      ))}
    </div>
  )

  const table =
    reminderList.loading && reminders.length === 0 ? (
      <div className={styles.tableWrap} aria-busy="true" aria-label="読み込んでいます">
        <DelayedSkeleton loading skeleton={loadingSkeleton} />
      </div>
    ) : reminderList.error ? (
      <div className={styles.stateCard} data-design-node="RrYYJ">
        <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
          <AlertCircle size={16} aria-hidden="true" />
        </span>
        <p className={styles.stateTitle}>リマインダを読み込めませんでした</p>
        <p className={styles.stateDesc}>
          数の帯は「—」、道具はそのまま使えます。条件を変えてから試し直せます。
        </p>
        <Button type="button" onClick={reminderList.retry}>もう一度試す</Button>
      </div>
    ) : reminders.length === 0 ? (
      filterActive ? (
        <div className={styles.stateCard} data-design-node="RrYYJ">
          <span className={styles.stateIcon}>
            <SearchIcon size={16} aria-hidden="true" />
          </span>
          <p className={styles.stateTitle}>条件に合うリマインダはありません</p>
          <p className={styles.stateDesc}>
            「有効」「下書き」「停止中」「失敗あり」や検索を外すと、すべて出ます。
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setNameQuery('')
              setFolderFilter('')
              setStatusFilter('')
            }}
          >
            条件を外す
          </Button>
        </div>
      ) : (
        <div className={styles.stateCard} data-design-node="RrYYJ">
          <span className={styles.stateIcon}>
            <Bell size={16} aria-hidden="true" />
          </span>
          <p className={styles.stateTitle}>まだリマインダはありません</p>
          <p className={styles.stateDesc}>
            日付を決めておくと、その前と後に自動で送れます。ひな形からも作れます。
          </p>
          {canEdit ? (
            <Button type="button" variant="primary" href="/reminders/new">
              ＋ リマインダを作る
            </Button>
          ) : null}
        </div>
      )
    ) : (
      <>
        {/* キーボードで動かした結果を読み上げる。画面には出さない。 */}
        <span className="sr-only" role="status" aria-live="polite">
          {moveNotice}
        </span>
        <div className={styles.tableWrap}>
          <DataTable>
            <colgroup>
              {/* ★V8 列の幅＝絵の中身の幅＋欄の間16（左右8ずつ）。端の列は端の24も足す（apLqS：選ぶ16・並べ替え14・状態80・予定90・次120・操作28） */}
              {/* 閲覧のみでも選ぶ列の幅は残す（箱は出さない）。名前の位置を絵どおりに保つ。 */}
              <col style={{ width: 16 + 24 + 8 }} />
              <col style={{ width: 14 + 16 }} />
              <col />
              <col style={{ width: 80 + 16 }} />
              <col style={{ width: 90 + 16 }} />
              <col style={{ width: 120 + 16 }} />
              <col style={{ width: 28 + 8 + 24 }} />
            </colgroup>
            <thead>
              <TableHeadRow>
                {canEdit ? (
                  <Th className={styles.selectCell} aria-label="選択">
                    <Checkbox
                      checked={allOnPageSelected}
                      indeterminate={!allOnPageSelected && selectedCount > 0}
                      onCheckedChange={toggleAllOnPage}
                      aria-label="このページのリマインダをすべて選択"
                    />
                  </Th>
                ) : <Th className={styles.selectCell}><span className="sr-only">選択できません</span></Th>}
                {tableHeadCells}
              </TableHeadRow>
            </thead>
            <RovingTbody reorderKey={liveOrder.shown.map((row) => row.id).join(',')}>
              {liveOrder.shown.map((row) => {
                const view = rowView(row)
                const planned =
                  view.status === 'draft' || view.status === 'stopped'
                    ? '—'
                    : row.plannedDeliveries == null
                      ? '—'
                      : `${formatNumber(row.plannedDeliveries)}通`
                const nextSend =
                  view.status === 'active' ? formatNextSend(row.nextScheduledAt) : '—'
                return (
                  <Tr interactive
                    key={row.id}
                    data-reorder-id={row.id}
                    onDragEnter={() => liveOrder.enter(row.id)}
                    onDragOver={dragId ? (event) => event.preventDefault() : undefined}
                    onDrop={dragId ? () => dropOn(liveOrder.dropTarget(row.id)) : undefined}
                    className={styles.rowClick}
                    tabIndex={0}
                    onClick={() => setPanelId(row.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        setPanelId(row.id)
                      }
                    }}
                  >
                    {canEdit ? (
                      <Td className={styles.selectCell} onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(row.id)}
                          onCheckedChange={() => toggleOne(row.id)}
                          aria-label={`${row.name}を選択`}
                        />
                      </Td>
                    ) : <Td className={styles.selectCell} />}
                    <Td
                      className={styles.gripCell}
                      onClick={(event) => event.stopPropagation()}
                      draggable={canEdit}
                      onDragStart={() => setDragId(row.id)}
                      onDragEnd={() => setDragId(null)}
                      title="上下に動かして並び替え"
                    >
                      {/* 閲覧のみ：つまみは隠し、同じ大きさの見えない印で位置を保つ。 */}
                      {canEdit ? (
                        <ReorderGrip
                          label={row.name}
                          onMove={(direction) => keyboardMove(row.id, direction)}
                        >
                          <span aria-hidden>⠿</span>
                        </ReorderGrip>
                      ) : <span className={styles.gripSpace} aria-hidden="true">⠿</span>}
                    </Td>
                    <NameCell
                      name={<div className={styles.nameRow}>
                        <Link
                          href={detailHref(row.id)}
                          title={row.name}
                          className={styles.cellTitle}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                            event.preventDefault()
                            goDetail(detailHref(row.id))
                          }}
                        >
                          {row.name}
                        </Link>
                        {row.hasFailure || (row.failedCount ?? 0) > 0 ? (
                          <button
                            type="button"
                            className={styles.miniBadgeDanger}
                            title="失敗があるリマインダだけに絞り込みます"
                            onClick={(event) => {
                              event.stopPropagation()
                              setStatusFilter('失敗あり')
                            }}
                          >
                            <span className={styles.miniBadgeDot} aria-hidden="true" />
                            失敗{row.failedCount != null && row.failedCount > 0 ? ` ${row.failedCount}` : ''}
                          </button>
                        ) : null}
                      </div>}
                      sub={<span title={view.subtitle}>
                        <CalendarClock size={11} aria-hidden="true" className={styles.cellSubIcon} />
                        {view.subtitle}
                      </span>}
                    />
                    <Td>
                      <span
                        className={`${styles.statePill} ${
                          view.status === 'active' ? styles.statePillActive : styles.statePillStopped
                        }`}
                      >
                        <span className={styles.stateDot} aria-hidden="true" />
                        {view.status === 'active' ? '有効' : view.status === 'draft' ? '下書き' : '停止中'}
                      </span>
                    </Td>
                    <Td className={styles.countCell}>
                      <div className={styles.countMain}>{planned}</div>
                    </Td>
                    <Td className={styles.countCell}>
                      <div className={styles.countMain}>{nextSend}</div>
                    </Td>
                    <Td className={styles.menuCell} onClick={(event) => event.stopPropagation()} data-design-node={openMenuId === row.id ? 'SkY9V' : undefined}>
                      {/* 横並びにして、メニューの位置の目印（空の span）が行を1段増やさないようにする。 */}
                      <div className={styles.menuBox}>
                      <ContextMenu
                        label={`リマインダ「${row.name}」の操作`}
                        items={rowContextItems(row)}
                      >
                        <button
                          type="button"
                          className={styles.menuButton}
                          title={`リマインダ「${row.name}」の操作`}
                          aria-label={`リマインダ「${row.name}」の操作`}
                          aria-haspopup="menu"
                          onClick={() =>
                            setOpenMenuId((current) => (current === row.id ? null : row.id))
                          }
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </button>
                      </ContextMenu>
                      <ActionMenu
                        open={openMenuId === row.id}
                        onClose={() => setOpenMenuId(null)}
                        ariaLabel={`リマインダ「${row.name}」の操作`}
                        items={rowMenuItems(row)}
                      />
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
            const view = rowView(panelRow)
            const planned =
              view.status === 'draft' || view.status === 'stopped'
                ? '—'
                : panelRow.plannedDeliveries == null
                  ? '—'
                  : `${formatNumber(panelRow.plannedDeliveries)}通`
            const nextSend = view.status === 'active' ? formatNextSend(panelRow.nextScheduledAt) : '—'
            return (
              <DetailPanel
                open
                title={panelRow.name}
                description={view.subtitle}
                onClose={() => setPanelId(null)}
                onPrev={panelIndex > 0 ? () => setPanelId(reminders[panelIndex - 1].id) : undefined}
                onNext={
                  panelIndex < reminders.length - 1
                    ? () => setPanelId(reminders[panelIndex + 1].id)
                    : undefined
                }
                hasPrev={panelIndex > 0}
                hasNext={panelIndex < reminders.length - 1}
                footer={
                  <>
                    <Button variant="primary" onClick={() => goDetail(detailHref(panelRow.id))}>
                      詳細を見る
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!canEdit}
                      onClick={() => goDetail(`/reminders/edit?id=${encodeURIComponent(panelRow.id)}`)}
                    >
                      編集する
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!canEdit}
                      onClick={() => {
                        setDuplicateError('')
                        setDuplicateTarget(panelRow)
                        setPanelId(null)
                      }}
                    >
                      複製する
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!canEdit}
                      onClick={() => {
                        setPanelId(null)
                        requestDelete(panelRow)
                      }}
                    >
                      削除する
                    </Button>
                  </>
                }
              >
                <p>
                  {view.status === 'active' ? '有効' : view.status === 'draft' ? '下書き' : '停止中'} ／
                  これから送る {planned} ／ 次に送る {nextSend}
                </p>
              </DetailPanel>
            )
          })()}

        {/* まとめての帯（選ぶと表の下に出る）：止める・再開・フォルダへ移す。 */}
        {canEdit && selectedCount > 0 ? (
          <div className={styles.bulkRow} role="region" aria-label="選択中のまとめ操作">
            <span className={styles.bulkCount}>{selectedCount}件を選択中</span>
            <Button
              type="button"
              variant="secondary"
              disabled={stoppableIds.length === 0}
              title={stoppableIds.length === 0 ? '有効なリマインダが選ばれていません' : undefined}
              onClick={() => runBulkToggle(false, stoppableIds)}
            >
              <Square size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
              止める
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={resumableIds.length === 0}
              title={resumableIds.length === 0 ? '停止中のリマインダが選ばれていません' : undefined}
              onClick={() => runBulkToggle(true, resumableIds)}
            >
              <Play size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
              再開
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => openMove([...selectedIds])}
            >
              <FolderIcon size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
              フォルダへ移す
            </Button>
          </div>
        ) : null}

        <div className={styles.pagerRow}>
          <span className={styles.pagerCount}>
            {reminderList.pageCount > 1
              ? `${(reminderList.page - 1) * reminderList.limit + 1}〜${Math.min(reminderList.page * reminderList.limit, reminderList.total)} / ${formatNumber(reminderList.total)}件`
              : `${formatNumber(reminderList.total)}件`}
          </span>
          {reminderList.pageCount > 1 ? (
            <Pagination
              page={reminderList.page}
              pageCount={reminderList.pageCount}
              onPageChange={reminderList.setPage}
            />
          ) : null}
        </div>
      </>
    )

  const folderSelect = (
    <Select
      aria-label="フォルダ"
      value={folderFilter}
      onChange={setFolderFilter}
      options={folderSelectOptions}
    />
  )
  const statusChips = (
    <div role="group" aria-label="状態で絞り込む">
      {STATUS_CHIPS.map((status) => (
        <FilterChip
          key={status}
          selected={statusFilter === status}
          onChange={() => setStatusFilter(statusFilter === status ? '' : status)}
          icon={STATUS_CHIP_ICONS[status]}
        >
          {status}
        </FilterChip>
      ))}
    </div>
  )
  const sortSelect = <SortSelect value={sort} onChange={setSort} options={SORT_OPTIONS} label="並び：" />
  const perPageSelect = <PageSizeSelect value={perPage} onChange={setPerPage} options={PER_PAGE_OPTIONS} label={null} />

  return (
    <PageFrame kind="list" boardId={narrow ? 'Iffil' : 'apLqS'}>
      <PageHeading headingSize="regular" title={<>リマインダ</>} description={<>
            予約日時・誕生日・契約終了日などの「基準日」を決めて、その前や後に自動で送ります。
          </>}  />

      {/* 見るだけの人への帯（`a5C1p`）。押せない操作は置かずに隠す（2026-10-06 オーナー決定）。 */}
      {role !== null && !canEdit && (
        <p className={styles.viewerBand} role="status" data-design-node="a5C1p">
          <Eye size={16} aria-hidden="true" />
          閲覧のみで見ています。変える操作は管理者に頼んでください。
        </p>
      )}

      {/* 数の帯 4つ。並びと間は共有の帯（KpiStrip）に任せ、画面CSSで書かない。 */}
      <KpiBand data-design="KPIs">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.title} presentation="band" title={kpi.title} icon={<kpi.icon size={14} aria-hidden="true" />} value={kpi.value} unit={kpi.value == null ? '' : kpi.unit} detail={kpi.detail} onRetry={kpi.link && !statsFailed && kpi.value !== null && kpi.value > 0 ? kpi.link : undefined} retryLabel="失敗を見る →" />
        ))}
      </KpiBand>

      {folderDialogOpen && (
        <FolderAddDialog
          kind="reminder"
          note="リマインダを整理するフォルダです。消しても、入っていたリマインダは未分類として残ります。"
          placeholder="例：予約"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      )}

      {/* 一時停止の窓（★V8 `RwVo5`）。確定で即反映し、裏で保存する。 */}
      <ConfirmDialog
        open={pauseTarget !== null}
        designNode="RwVo5"
        title={pauseTarget ? `「${pauseTarget.name}」を一時停止する` : ''}
        description="再開するまで、このリマインダの通知は送られません。"
        confirmLabel="一時停止する"
        onConfirm={() => runPause()}
        onCancel={() => {
          setPauseTarget(null)
              }}
      >
        {pauseTarget && (
          <p className={styles.warnNote}>
            <TriangleAlert size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            {pauseTarget.plannedDeliveries != null && pauseTarget.plannedDeliveries > 0
              ? `これから送る予定の ${formatNumber(pauseTarget.plannedDeliveries)}通 が送られなくなります。`
              : 'これから送る予定の通知があれば、送られなくなります。'}
          </p>
        )}
      </ConfirmDialog>

      {/* 削除の窓（★V8 `VsSyu`）：幅600・上から260。危ない操作は左端、取消と「代わりに一時停止」は真ん中。 */}
      <SheetDialog
        open={deleteTarget !== null}
        designNode="VsSyu"
        title={deleteTarget ? `「${deleteTarget.name}」を削除する` : ''}
        description="通知の予定と登録者がすべて消えます。すでに送ったメッセージは友だちのトークに残ります。"
        band="削除は元に戻せません。しばらく使わないだけなら「一時停止する」を使ってください。"
        bandTone="danger"
        busy={deleting}
        error={deleteError || (deleteTarget && !deleteStillListed ? 'このリマインダが一覧から外れました。この窓を閉じて、いまの一覧から選び直してください。' : undefined)}
        onClose={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
        destructive={(
          <Button variant="danger" onClick={() => void runDelete()} disabled={deleting || !deleteStillListed} busy={deleting} busyLabel="削除しています…">
            削除する
          </Button>
        )}
        actions={(
          <>
            <Button
              onClick={() => {
                setDeleteTarget(null)
                setDeleteError('')
              }}
              disabled={deleting}
            >
              キャンセル
            </Button>
            {deleteTarget && statusKeyOf(deleteTarget) === 'active' ? (
              <Button
                onClick={() => {
                  setPauseTarget(deleteTarget)
                  setDeleteTarget(null)
                }}
                disabled={deleting}
              >
                <Pause size={15} aria-hidden="true" />代わりに一時停止
              </Button>
            ) : null}
          </>
        )}
      />

      {/* 複製の窓。下書きとして写し、確認してから有効にする。 */}
      <ConfirmDialog
        open={duplicateTarget !== null}
        title={duplicateTarget ? `「${duplicateTarget.name}」を複製しますか？` : ''}
        description="設定と通知の中身を写して、新しいリマインダを「下書き」で作ります。登録者と送信履歴は写りません。作ったあとは確認してから有効にしてください。"
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

      {/* フォルダ移動の窓。1件でも複数件でも同じ形。 */}
      <ConfirmDialog
        open={moveIds !== null}
        title={
          moveIds && moveIds.length === 1
            ? `「${reminders.find((row) => row.id === moveIds[0])?.name ?? 'リマインダ'}」のフォルダを移動`
            : `${moveIds?.length ?? 0}件のリマインダのフォルダを移動`
        }
        description="移動先のフォルダを選んでください。「未分類」を選ぶとフォルダから外れます。"
        confirmLabel="移動する"
        onConfirm={() => runMove()}
        onCancel={() => {
          setMoveIds(null)
        }}
      >
        <div className={styles.moveBody}>
          <label className="block">
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
          </label>
        </div>
      </ConfirmDialog>

      <ListPageBody folders={<>
          {canEdit ? (
            <Button href="/reminders/new" variant="primary" className="v8-folder-create w-full">
              ＋ リマインダを作る
            </Button>
          ) : (
            /* 閲覧のみ：作るボタンは隠し、場所だけ空ける（並びを絵どおりに保つ）。 */
            <span className={`v8-folder-create ${styles.viewerCreateSpace}`} aria-hidden="true" />
          )}
          <FolderPanel
            activeId={folderFilter}
            onSelect={setFolderFilter}
            onAddFolder={canEdit ? () => setFolderDialogOpen(true) : undefined}
            addFolderLabel="フォルダを追加"
            rows={folderRows}
          >
            <p className={styles.folderNote}>
              フォルダを消しても、中のリマインダは未分類に残ります。
            </p>
            {foldersError && (reminders.length > 0 || !reminderList.error) ? (
              <p role="alert" className={styles.folderNote}>
                フォルダを読み込めませんでした。
                <button
                  type="button"
                  onClick={() => void loadFolders()}
                  className="text-action ml-2 font-semibold hover:underline"
                >
                  もう一度
                </button>
              </p>
            ) : null}
          </FolderPanel>
        </>}
        collapsedFolders={narrow ? undefined : <>
          {canEdit ? (
            <Button href="/reminders/new" variant="primary">
              ＋ リマインダを作る
            </Button>
          ) : null}
          {folderSelect}
        </>}
        toolbar={!narrow ? <>
          {/* 道具の段は型の toolbar 枠に渡す（中身だけ渡す）。 */}
          <ListToolbar
            search={{
              placeholder: '名前・内容で探す',
              width: 200,
              value: nameQuery,
              onChange: (value) => setNameQuery(clampSearchQuery(value)),
            }}
            actions={<>{statusChips}</>}
            trailing={<>
              {sortSelect}
              {perPageSelect}
            </>}
          />
        </> : (
          /* 1152 の板（Iffil）：1段目「作る・フォルダ・探す … 件数」→ 2段目「札・並び」。部品と動きは広い板と同じ。 */
          <div className={styles.narrowTools}>
            <div className={styles.narrowRow}>
              {canEdit ? (
                <Button href="/reminders/new" variant="primary"><Plus size={15} aria-hidden="true" />リマインダを作る</Button>
              ) : null}
              <div className={styles.narrowFolder}>{folderSelect}</div>
              <div className={styles.narrowSearch}>
                <SearchField
                  placeholder="名前・内容で探す"
                  aria-label="名前・内容で探す"
                  value={nameQuery}
                  onChange={(value) => setNameQuery(clampSearchQuery(value))}
                  onClear={() => setNameQuery('')}
                />
              </div>
              <span className={styles.narrowSpacer} aria-hidden="true" />
              {perPageSelect}
            </div>
            <div className={styles.narrowRow}>
              {statusChips}
              {sortSelect}
            </div>
          </div>
        )}>

          {filterActive && reminderList.loaded && (
            <p className={styles.folderNote} style={{ fontVariantNumeric: 'tabular-nums' }}>
              条件に一致したリマインダ：{formatNumber(reminderList.total)}件
            </p>
          )}

          {actionError && (
            <p className={styles.errorBand} role="alert">
              <AlertCircle size={14} aria-hidden="true" />
              {actionError}
              <button type="button" onClick={() => setActionError('')}>閉じる</button>
            </p>
          )}

          {table}
        </ListPageBody>
    </PageFrame>
  )
}
