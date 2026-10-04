'use client'

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
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  Bell,
  CalendarClock,
  Folder as FolderIcon,
  MoreHorizontal,
  Play,
  Search as SearchIcon,
  Send,
  Square,
  TriangleAlert,
} from 'lucide-react'
import type { ApiResponse, Folder, ReminderTriggerType } from '@line-crm/shared'
import { api, fetchApi, type ListStats } from '@/lib/api'
import { useOffsetServerList, type ServerListResponse } from '@/lib/use-server-list'
import { clampSearchQuery } from '@/lib/search-query'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import DetailPanel from '@/components/shared/detail-panel'
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu'
import { withViewTransition } from '@/components/shared/view-transition'
import Pagination from '@/components/shared/pagination'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { Th } from '@/components/shared/table'
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

export default function RemindersListV8() {
  usePageTitle('リマインダ')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  const readonlyReason = 'この操作にはオーナーか管理者の権限が要ります'

  const [folders, setFolders] = useState<Folder[]>([])
  /** 「未分類」の件数。`null` は数えていない。 */
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [nameQuery, setNameQuery] = useState('')
  const deferredNameQuery = useDeferredValue(nameQuery.trim())
  const [folderFilter, setFolderFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [perPage, setPerPage] = useState(20)
  const [sort, setSort] = useState('order')
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
  })
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
  const reminders = optimisticRows && optimisticRows.key === listContextKey ? optimisticRows.rows : reminderList.items
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
    return [
      { id: 'detail', label: '詳細を見る', onSelect: () => goDetail(detailHref(row.id)) },
      { id: 'registrants', label: '登録者を管理', onSelect: () => goDetail(detailHref(row.id)) },
      { id: 'planned', label: '配信予定を見る', onSelect: () => goDetail(`${detailHref(row.id)}&status=planned`) },
      { id: 'runs', label: '実行結果を見る', onSelect: () => goDetail(detailHref(row.id)) },
      {
        id: 'edit',
        label: '編集する',
        disabled: !canEdit,
        disabledReason: canEdit ? undefined : readonlyReason,
        onSelect: () => goDetail(`/reminders/edit?id=${encodeURIComponent(row.id)}`),
      },
      {
        id: 'duplicate',
        label: '複製する',
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
              disabled: !canEdit,
              disabledReason: canEdit ? undefined : readonlyReason,
              onSelect: () => void runResume(row),
            }
          : {
              id: 'pause-none',
              label: '一時停止する',
              disabled: true,
              disabledReason: '下書きはまだ送っていないため、止める予定がありません',
              onSelect: () => {},
            },
      {
        id: 'move',
        label: 'フォルダへ移す',
        disabled: !canEdit,
        disabledReason: canEdit ? undefined : readonlyReason,
        onSelect: () => openMove([row.id]),
      },
      {
        id: 'delete',
        label: '削除',
        tone: 'danger',
        dividerBefore: true,
        disabled: !canEdit,
        disabledReason: canEdit ? undefined : readonlyReason,
        onSelect: () => {
          setDeleteError('')
          setDeleteTarget(row)
        },
      },
    ]
  }

  /* ===== 表 ===== */

  /*
   * 見出しの6列は実表と共有する。骨組み用に書き写すと直書きの見出し
   * （`direct-th`）が二重に数えられるため、同じ要素を使い回す。
   * 選択の列だけは実表が箱（Checkbox）付き・骨組みが共通 `Th` の空見出し。
   */
  const tableHeadCells = (
    <>
      <th aria-label="並び替え" />
      <th>リマインダ（基準日・いつ送るか）</th>
      <th>状態</th>
      <th>これから送る</th>
      <th>次に送る</th>
      <th aria-label="操作" />
    </>
  )

  const loadingSkeleton = (
    <table className={styles.table}>
      <colgroup>
        {canEdit && <col style={{ width: 40 }} />}
        <col style={{ width: 44 }} />
        <col />
        <col style={{ width: 96 }} />
        <col style={{ width: 112 }} />
        <col style={{ width: 128 }} />
        <col style={{ width: 44 }} />
      </colgroup>
      <thead>
        <tr>
          {canEdit && <Th aria-label="選択" />}
          {tableHeadCells}
        </tr>
      </thead>
      <tbody>
        {[0, 1, 2, 3, 4].map((n) => (
          <tr key={n}>
            {canEdit && <td className={styles.selectCell} />}
            <td className={styles.gripCell} />
            <td>
              <Skeleton width={220} height={16} />
              <span style={{ display: 'block', height: 4 }} aria-hidden="true" />
              <Skeleton width={160} height={12} />
            </td>
            <td>
              <Skeleton width={64} height={24} className="rounded-pill" />
            </td>
            <td className={styles.countCell}>
              <Skeleton width={56} height={16} />
            </td>
            <td>
              <Skeleton width={96} height={16} />
            </td>
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  )

  const table =
    reminderList.loading && reminders.length === 0 ? (
      <div className={styles.tableWrap} aria-busy="true" aria-label="読み込んでいます">
        <DelayedSkeleton loading skeleton={loadingSkeleton} />
      </div>
    ) : reminderList.error ? (
      <div className={styles.stateCard}>
        <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
          <AlertCircle size={18} aria-hidden="true" />
        </span>
        <p className={styles.stateTitle}>リマインダを読み込めませんでした</p>
        <p className={styles.stateDesc}>
          数の帯は「—」、道具はそのまま使えます。条件を変えてから試し直せます。
        </p>
        <Button type="button" onClick={reminderList.retry}>もう一度試す</Button>
      </div>
    ) : reminders.length === 0 ? (
      filterActive ? (
        <div className={styles.stateCard}>
          <span className={styles.stateIcon}>
            <SearchIcon size={18} aria-hidden="true" />
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
        <div className={styles.stateCard}>
          <span className={styles.stateIcon}>
            <Bell size={18} aria-hidden="true" />
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
          <table className={styles.table}>
            <colgroup>
              {canEdit && <col style={{ width: 64 }} />}
              <col style={{ width: 62 }} />
              <col />
              <col style={{ width: 128 }} />
              <col style={{ width: 138 }} />
              <col style={{ width: 168 }} />
              <col style={{ width: 76 }} />
            </colgroup>
            <thead>
              <tr>
                {canEdit && (
                  <th className={styles.selectCell} aria-label="選択">
                    <Checkbox
                      checked={allOnPageSelected}
                      indeterminate={!allOnPageSelected && selectedCount > 0}
                      onCheckedChange={toggleAllOnPage}
                      aria-label="このページのリマインダをすべて選択"
                    />
                  </th>
                )}
                {tableHeadCells}
              </tr>
            </thead>
            <tbody>
              {reminders.map((row) => {
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
                  <tr
                    key={row.id}
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
                    {canEdit && (
                      <td className={styles.selectCell} onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(row.id)}
                          onCheckedChange={() => toggleOne(row.id)}
                          aria-label={`${row.name}を選択`}
                        />
                      </td>
                    )}
                    <td
                      className={styles.gripCell}
                      onClick={(event) => event.stopPropagation()}
                      draggable={canEdit}
                      onDragStart={() => setDragId(row.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => dropOn(row.id)}
                      title="上下に動かして並び替え"
                    >
                      <ReorderGrip
                        label={row.name}
                        disabled={!canEdit}
                        disabledReason={readonlyReason}
                        onMove={(direction) => keyboardMove(row.id, direction)}
                      >
                        <span aria-hidden>⠿</span>
                      </ReorderGrip>
                    </td>
                    <td>
                      <div className={styles.nameRow}>
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
                      </div>
                      <p className={styles.cellSub} title={view.subtitle}>
                        <CalendarClock size={11} aria-hidden="true" className={styles.cellSubIcon} />
                        {view.subtitle}
                      </p>
                    </td>
                    <td>
                      <span
                        className={`${styles.statePill} ${
                          view.status === 'active' ? styles.statePillActive : styles.statePillStopped
                        }`}
                      >
                        <span className={styles.stateDot} aria-hidden="true" />
                        {view.status === 'active' ? '有効' : view.status === 'draft' ? '下書き' : '停止中'}
                      </span>
                    </td>
                    <td className={styles.countCell}>
                      <div className={styles.countMain}>{planned}</div>
                    </td>
                    <td className={styles.countCell}>
                      <div className={styles.countMain}>{nextSend}</div>
                    </td>
                    <td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
                        setDeleteError('')
                        setDeleteTarget(panelRow)
                        setPanelId(null)
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

  return (
    <div className={styles.board} data-design-node="apLqS">
      <div data-design="Head">
        <div className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.headTitle}>リマインダ</h2>
            <p className={styles.headDescription}>
              予約日時・誕生日・契約終了日などの「基準日」を決めて、その前や後に自動で送ります。
            </p>
          </div>
        </div>
      </div>

      {/* 数の帯 4つ。 */}
      <div data-design="KPIs" className={styles.kpis}>
        {kpis.map((kpi) => (
          <div key={kpi.title} className={styles.kpi}>
            <span className={styles.kpiLabel}>
              <kpi.icon size={13} aria-hidden="true" />
              {kpi.title}
            </span>
            <p className={styles.kpiValue}>
              {kpi.value === null ? '—' : formatNumber(kpi.value)}
              <span className={styles.kpiUnit}>{kpi.value === null ? '' : kpi.unit}</span>
            </p>
            <p className={styles.kpiDetail}>{kpi.detail}</p>
            {kpi.link && !statsFailed && kpi.value !== null && kpi.value > 0 ? (
              <button type="button" className={styles.kpiLink} onClick={kpi.link}>
                失敗を見る →
              </button>
            ) : null}
          </div>
        ))}
      </div>

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

      {/* 削除の窓（★V8 `VsSyu`）。 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        designNode="VsSyu"
        title={deleteTarget ? `「${deleteTarget.name}」を削除する` : ''}
        description="通知の予定と登録者がすべて消えます。すでに送ったメッセージは友だちのトークに残ります。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={deleteStillListed ? () => void runDelete() : undefined}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
      >
        {deleteTarget && (
          <div className="space-y-2">
            <p className={styles.warnNote}>
              <TriangleAlert size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              削除は元に戻せません。しばらく使わないだけなら「一時停止する」を使ってください。
            </p>
            {statusKeyOf(deleteTarget) === 'active' ? (
              <button
                type="button"
                className={styles.altAction}
                onClick={() => {
                                setPauseTarget(deleteTarget)
                  setDeleteTarget(null)
                }}
              >
                代わりに一時停止
              </button>
            ) : null}
            {!deleteStillListed && (
              <p className="text-warning text-xs font-medium">
                このリマインダが一覧から外れました。この窓を閉じて、いまの一覧から選び直してください。
              </p>
            )}
          </div>
        )}
      </ConfirmDialog>

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

      <div data-design="Body" className={styles.split}>
        {/* 左のフォルダの列。いちばん上は「リマインダを作る」。 */}
        <div className={styles.folderCol}>
          {canEdit ? (
            <Button href="/reminders/new" variant="primary" className="v8-folder-create w-full">
              ＋ リマインダを作る
            </Button>
          ) : (
            <Button type="button" variant="primary" className="v8-folder-create w-full" disabled>
              ＋ リマインダを作る
            </Button>
          )}
          <FolderPanel
            activeId={folderFilter}
            onSelect={setFolderFilter}
            onAddFolder={canEdit ? () => setFolderDialogOpen(true) : undefined}
            addFolderDisabled={!canEdit}
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
        </div>

        <div className={styles.listCol}>
          {/* 道具の段：検索・札 4 つ・右に並び順と件数。狭い板では「作る」とフォルダ選びがここへ畳まれる。 */}
          <div className={styles.toolbar}>
            {canEdit ? (
              <Button href="/reminders/new" variant="primary" className={styles.toolbarCreate}>
                ＋ リマインダを作る
              </Button>
            ) : (
              <Button type="button" variant="primary" className={styles.toolbarCreate} disabled>
                ＋ リマインダを作る
              </Button>
            )}
            <div className={styles.folderSelectWrap}>
              <Select
                aria-label="フォルダ"
                value={folderFilter}
                onChange={setFolderFilter}
                options={folderSelectOptions}
              />
            </div>
            <div className={styles.searchWrap}>
              <SearchField
                aria-label="名前・内容で探す"
                placeholder="名前・内容で探す"
                value={nameQuery}
                onChange={(value) => setNameQuery(clampSearchQuery(value))}
                onClear={() => setNameQuery('')}
              />
            </div>
            {STATUS_CHIPS.map((status) => (
              <FilterChip
                key={status}
                selected={statusFilter === status}
                onChange={() => setStatusFilter(statusFilter === status ? '' : status)}
              >
                {status}
              </FilterChip>
            ))}
            <span className={styles.toolbarSpacer} />
            <SortSelect value={sort} onChange={setSort} options={SORT_OPTIONS} />
            <PageSizeSelect value={perPage} onChange={setPerPage} options={PER_PAGE_OPTIONS} />
          </div>

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
        </div>
      </div>
    </div>
  )
}
