'use client'

/*
 * ★V8 一斉配信の一覧（Pencil `l5V9a`・1152 は `jjFNi`・閲覧のみは `NtCE3`）。
 *
 * 今までの V8 一覧（app/broadcasts/list-v8.tsx）の動きを写し、見た目は
 * 型（ListPage）と共通部品で一から組み直した。データの口・保存先は今と同じ。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { RovingTbody } from '@/components/shared/row-roving'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useListScrollMemory, useListUrlParam } from '@/components/shared/list-url-state'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowUpDown,
  Bookmark,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  Copy,
  Eye,
  FilePen,
  FileText,
  Gauge,
  List as ListIcon,
  MailOpen,
  MoreHorizontal,
  Plus,
  Send,
  SendHorizontal,
  UserCheck,
  X,
} from 'lucide-react'
import type { Folder, Tag } from '@line-crm/shared'
import { ApiError, api, type ApiBroadcast, type BroadcastInsight, type BroadcastListKpis, type BroadcastSavedView } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { ListPage, ListPagePagination } from '@/components/templates'
import BroadcastForm from '@/components/broadcasts/broadcast-form'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import { FolderDotName } from '@/components/shared/folder-dot'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import DetailPanel from '@/components/shared/detail-panel'
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu'
import { withViewTransition } from '@/components/shared/view-transition'
import Select from '@/components/shared/select'
import Button from '@/components/shared/button'
import DateField from '@/components/shared/date-field'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Pagination from '@/components/shared/pagination'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { audienceSummary, messageTypeLabel } from '@/lib/broadcast-summary'
import { runOptimistic } from '@/lib/undoable'
import { formatDateTime, formatNumber } from '@/lib/format'
import QuickSendV8 from './quick-send'
import styles from './list.module.css'

/** 未分類を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'
const READONLY_REASON = '閲覧のみのため変更できません'
const EDIT_KEY = 'broadcast.definition.edit'

/**
 * サーバが「運用担当」と答えたときは、配信の編集キーを持つかだけを見る。
 * 手元の役割（lh_staff_role）は古いことがあるので、ここでは読まない。
 */
function hasStaffEditKey(permission: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem('lh_staff_permissions') ?? '[]')
    return Array.isArray(parsed) && parsed.includes(permission)
  } catch {
    return false
  }
}

/**
 * 絞り込みの札：すべて・予約中・下書き・承認待ち・送信済み・エラー。
 * 札は 10 の状態（displayStatus）で絞る。
 */
type StatusChipKey = 'all' | 'scheduled' | 'draft' | 'pending_approval' | 'sent' | 'error'

const STATUS_CHIPS: Array<{ key: StatusChipKey; label: string; icon: typeof CalendarClock; query: string }> = [
  { key: 'all', label: 'すべて', icon: ListIcon, query: '' },
  { key: 'scheduled', label: '予約中', icon: CalendarClock, query: 'scheduled' },
  { key: 'draft', label: '下書き', icon: FileText, query: 'draft' },
  { key: 'pending_approval', label: '承認待ち', icon: UserCheck, query: 'pending_approval' },
  { key: 'sent', label: '送信済み', icon: SendHorizontal, query: 'sent' },
  { key: 'error', label: 'エラー', icon: AlertCircle, query: 'failed,partial_failed' },
]

function chipCount(statusCounts: Record<string, number> | null, key: StatusChipKey): number | null {
  if (!statusCounts) return null
  if (key === 'all') return statusCounts.all ?? null
  if (key === 'error') return (statusCounts.failed ?? 0) + (statusCounts.partial_failed ?? 0)
  return statusCounts[key] ?? null
}

/** 札の文字は「すべて 24」の1つの文字列（絵どおり）。件数が無いときは名前だけ。 */
function chipText(label: string, count: number | null): string {
  return count == null ? label : `${label} ${count}`
}

/** 状態の札の色。10 の状態を5色に畳む（色は CSS の data-tone）。 */
const BADGE_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  pending_approval: 'warning',
  scheduled: 'info',
  preparing: 'info',
  sending: 'warning',
  sent: 'success',
  partial_failed: 'warning',
  failed: 'danger',
  stopped: 'neutral',
  expired: 'neutral',
}

function StatusBadge({ broadcast }: { broadcast: ApiBroadcast }) {
  const key = broadcast.displayStatus ?? broadcast.status
  const label = broadcast.displayStatusLabel ?? key
  return (
    <span className={styles.badge} data-tone={BADGE_TONE[key] ?? 'neutral'}>
      <span className={styles.badgeDot} aria-hidden="true" />
      {label}
    </span>
  )
}

function dateRangeLabel(dateFrom: string, dateTo: string): string {
  if (!dateFrom && !dateTo) return '配信日：指定なし'
  if (dateFrom && dateTo) return `配信日：${dateFrom}〜${dateTo}`
  return `配信日：${dateFrom || dateTo}〜`
}

function summaryInsight(summary: ApiBroadcast['insightSummary']): BroadcastInsight | undefined {
  if (!summary) return undefined
  if (summary.delivered == null && summary.uniqueImpression == null
    && summary.uniqueClick == null && summary.openRate == null && summary.clickRate == null) {
    return undefined
  }
  return {
    delivered: summary.delivered,
    uniqueImpression: summary.uniqueImpression,
    uniqueClick: summary.uniqueClick,
    uniqueMediaPlayed: null,
    openRate: summary.openRate,
    clickRate: summary.clickRate,
  }
}

export default function BroadcastListV8() {
  usePageTitle('一斉配信')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  /* かんたんに送る（板 `P6vbxn`）の窓。 */
  const [quickSendOpen, setQuickSendOpen] = useState(false)
  const staffRole = useStaffRole()
  const narrow = useNarrowViewport()
  /*
   * 閲覧のみ：作る・保存する・フォルダを足す・…の変える項目は押せない形にする。
   * 役割が読めていない間は今までどおり出す（最後の守りはサーバの 403）。
   * 管理者・オーナーと、配信の編集キーを持つ運用担当が変えられる（役割はサーバの答え）。
   */
  const canEdit = staffRole === null || canManageRole(staffRole) || hasStaffEditKey(EDIT_KEY)

  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [listKpis, setListKpis] = useState<BroadcastListKpis | null | undefined>(undefined)
  const [statusCounts, setStatusCounts] = useState<Record<string, number> | null>(null)
  const [quota, setQuota] = useState<{ limit: number | null; used: number | null } | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  /* 絞り込み・検索語は URL に置く（戻ると同じ一覧に戻る。動きの点検 5 番）。 */
  const [statusParam, setStatusParam] = useListUrlParam('status', 'all')
  const statusFilter: StatusChipKey = STATUS_CHIPS.some((chip) => chip.key === statusParam) ? (statusParam as StatusChipKey) : 'all'
  const setStatusFilter = setStatusParam as (next: StatusChipKey) => void
  const [showCreate, setShowCreate] = useState(false)
  const [openTemplatePicker, setOpenTemplatePicker] = useState(false)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const createAnchorRef = useRef<HTMLElement | null>(null)
  const [titleQuery, setTitleQuery] = useListUrlParam('q')
  const [savedViewId, setSavedViewId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [datePopoverOpen, setDatePopoverOpen] = useState(false)
  const datePopoverRef = useRef<HTMLDivElement>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [folderFilter, setFolderFilter] = useListUrlParam('folder')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [insights, setInsights] = useState<Record<string, BroadcastInsight>>({})
  const [pageSize, setPageSize] = useState(20)
  const [sortKey, setSortKey] = useState<'newest' | 'oldest'>('newest')
  const [page, setPage] = useState(1)
  const [listTotal, setListTotal] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ApiBroadcast | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [panelId, setPanelId] = useState<string | null>(null)
  const [menuMoveFor, setMenuMoveFor] = useState<string | null>(null)
  /* 「フォルダへ移す」を選んだ直後の onClose は2段目への切り替えなので閉じない。 */
  const keepMenuOpenRef = useRef(false)
  const [moving, setMoving] = useState(false)
  const [savedViews, setSavedViews] = useState<BroadcastSavedView[]>([])
  const [savedViewsSeq, setSavedViewsSeq] = useState(0)
  const [savedMenuOpen, setSavedMenuOpen] = useState(false)
  const savedAnchorRef = useRef<HTMLElement | null>(null)
  const [savedViewName, setSavedViewName] = useState('')
  const [savedViewOpen, setSavedViewOpen] = useState(false)
  const [savedViewBusy, setSavedViewBusy] = useState(false)
  const [savedViewError, setSavedViewError] = useState('')

  /* 一覧同梱の集計が無い送信済みだけ1回ずつ取る（v7 と同じ補充）。 */
  const fetchedInsightIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const missing = broadcasts.filter((b) =>
      b.status === 'sent'
      && !insights[b.id]
      && !summaryInsight(b.insightSummary)
      && !fetchedInsightIdsRef.current.has(b.id))
    if (missing.length === 0) return
    missing.forEach((b) => {
      fetchedInsightIdsRef.current.add(b.id)
      api.broadcasts.getInsight(b.id).then((res) => {
        if (res.success && res.data) {
          setInsights((prev) => ({ ...prev, [b.id]: res.data as BroadcastInsight }))
        }
      }).catch(() => undefined)
    })
  }, [broadcasts, insights])

  const loadFolders = useCallback(async () => {
    setFolderError('')
    try {
      const res = await api.folders.list('broadcast')
      if (res.success) {
        setFolders(res.data)
        setUnfiledCount(res.unfiledCount ?? null)
      } else {
        setFolderError('フォルダを読み込めませんでした。')
      }
    } catch {
      setFolderError('フォルダを読み込めませんでした。')
    }
  }, [])

  useEffect(() => { void loadFolders() }, [loadFolders])

  const moveFolderOrder = async (index: number, direction: -1 | 1) => {
    const target = folders[index]
    const neighbor = folders[index + direction]
    if (!target || !neighbor || folderBusy) return
    setFolderBusy(true)
    setFolderError('')
    try {
      const result = await api.folders.swapOrder(target.id, neighbor.id)
      if (!result.success) throw new Error(result.error)
      await loadFolders()
    } catch {
      setFolderError('並び順を変えられませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

  const removeFolder = async () => {
    if (!deletingFolder || folderBusy) return
    const targetId = deletingFolder.id
    setFolderBusy(true)
    setFolderError('')
    try {
      const res = await api.folders.delete(targetId)
      if (!res.success) throw new Error(res.error)
      setDeletingFolder(null)
      if (folderFilter === targetId) setFolderFilter('')
      await loadFolders()
    } catch {
      setFolderError('フォルダを削除できませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

  /* ページ送りは口側の cursor（= オフセット）。条件を変えたら一覧の口だけ取り直す。 */
  /* 遅れて返った前の条件の答えで、今の一覧を上書きしない（URL から条件が入る直後など）。 */
  const loadSeqRef = useRef(0)
  const loadList = useCallback(async (cursor = 0) => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    setError('')
    setForbidden(false)
    try {
      const chip = STATUS_CHIPS.find((item) => item.key === statusFilter)
      const res = await api.broadcasts.list({
        accountId: selectedAccountId || undefined,
        limit: pageSize,
        cursor,
        displayStatus: chip && chip.query !== '' ? chip.query : undefined,
        folderId: folderFilter === UNFILED ? 'unfiled' : folderFilter || undefined,
        sort: sortKey,
        from: dateFrom || undefined,
        to: dateTo || undefined,
      })
      if (seq !== loadSeqRef.current) return
      if (res.success) {
        setBroadcasts(res.data)
        setListKpis(res.kpis)
        setStatusCounts(res.statusCounts ?? null)
        setListTotal(res.pagination?.total ?? null)
      } else {
        setError(res.error)
      }
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      if (err instanceof ApiError && err.status === 403) setForbidden(true)
      else setError('データの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [selectedAccountId, pageSize, sortKey, statusFilter, folderFilter, dateFrom, dateTo])
  /* 戻ってきたら前のスクロール位置へ（中身が描けてから）。 */
  useListScrollMemory(!loading)

  /* タグ・シナリオは宛先の名前解決だけ。アカウントが変わったときだけ取り直す。 */
  const loadCandidates = useCallback(async () => {
    try {
      const [tagsRes, scenariosRes] = await Promise.all([
        api.tags.list(selectedAccountId ? { accountId: selectedAccountId } : undefined),
        api.scenarios.list(selectedAccountId ? { accountId: selectedAccountId } : undefined).catch(() => null),
      ])
      if (tagsRes && tagsRes.success) setTags(tagsRes.data)
      if (scenariosRes && scenariosRes.success) {
        setScenarios(scenariosRes.data.map((item) => ({ id: item.id, name: item.name })))
      }
    } catch {
      // 名前が引けない行はID表示に倒す（一覧の取得とは別物）。
    }
  }, [selectedAccountId])

  useEffect(() => {
    setPage(1)
    void loadList(0)
  }, [loadList])

  useEffect(() => { void loadCandidates() }, [loadCandidates])

  const goPage = (next: number) => {
    setPage(next)
    void loadList((next - 1) * pageSize)
  }

  /* 今月の送信枠（ダッシュボードの口から quota を借りる）。 */
  useEffect(() => {
    if (!selectedAccountId) {
      setQuota(null)
      return
    }
    let cancelled = false
    api.dashboard.overview({ accountId: selectedAccountId })
      .then((res) => {
        if (cancelled) return
        if (res.success) setQuota({ limit: res.data.delivery.quotaLimit, used: res.data.delivery.quotaUsed })
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedAccountId])

  useEffect(() => {
    if (!selectedAccountId) {
      setSavedViews([])
      return
    }
    let cancelled = false
    setSavedViewError('')
    api.broadcasts.savedViews.list(selectedAccountId).then((res) => {
      if (cancelled) return
      if (res.success) setSavedViews(res.data)
      else setSavedViewError('保存した検索を読み込めませんでした。')
    }).catch(() => {
      if (!cancelled) setSavedViewError('保存した検索を読み込めませんでした。')
    })
    return () => { cancelled = true }
  }, [selectedAccountId, savedViewsSeq])

  /* 「配信日」のポップオーバーは外を押したら・Esc で閉じる。 */
  useEffect(() => {
    if (!datePopoverOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!datePopoverRef.current?.contains(event.target as Node)) setDatePopoverOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDatePopoverOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [datePopoverOpen])

  const applySavedView = (id: string) => {
    const view = savedViews.find((item) => item.id === id)
    if (!view) return
    setSavedViewId(id)
    const filters = view.filters
    const legacyStatuses = Array.isArray(filters.statuses) ? filters.statuses : []
    const legacyStatus = legacyStatuses.includes('scheduled')
      ? 'scheduled'
      : legacyStatuses.includes('draft')
        ? 'draft'
        : null
    setTitleQuery(typeof filters.titleQuery === 'string' ? filters.titleQuery : '')
    setStatusFilter(
      filters.statusFilter === 'scheduled' || filters.statusFilter === 'draft'
        ? (filters.statusFilter as StatusChipKey)
        : legacyStatus ?? 'all',
    )
    setDateFrom(typeof filters.dateFrom === 'string' ? filters.dateFrom : '')
    setDateTo(typeof filters.dateTo === 'string' ? filters.dateTo : '')
    setFolderFilter(typeof filters.folderFilter === 'string' ? filters.folderFilter : '')
  }

  const saveCurrentView = async () => {
    if (!selectedAccountId || !savedViewName.trim() || savedViewBusy) return
    setSavedViewBusy(true)
    setSavedViewError('')
    try {
      const res = await api.broadcasts.savedViews.create(selectedAccountId, {
        name: savedViewName.trim(),
        filters: { titleQuery, statusFilter, dateFrom, dateTo, folderFilter },
        sortKey: 'scheduled',
        pageSize: 20,
      })
      if (!res.success) throw new Error(res.error)
      setSavedViews((current) => [...current, res.data])
      setSavedViewName('')
      setSavedViewOpen(false)
    } catch {
      setSavedViewError('この検索条件を保存できませんでした。')
    } finally {
      setSavedViewBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return
    const targetId = deleteTarget.id
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.broadcasts.delete(targetId)
      if (!res.success) throw new Error(res.error)
      setDeleteTarget(null)
      await loadList((page - 1) * pageSize)
    } catch {
      setDeleteError('この配信を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  /* 行の「…」→「フォルダへ移す」。押した瞬間に移した形を見せて裏で保存し、失敗したら戻す。 */
  const moveBroadcastToFolder = (broadcast: ApiBroadcast, folderId: string | null) => {
    if (moving) return
    setMoving(true)
    const previous = broadcasts
    setBroadcasts((current) => current.map((item) => (item.id === broadcast.id ? { ...item, folderId } : item)))
    setOpenMenuId(null)
    setMenuMoveFor(null)
    runOptimistic({
      request: () => api.broadcasts.update(broadcast.id, { folderId, expectedVersion: broadcast.version ?? 0 }),
      revert: () => { setBroadcasts(previous); setMoving(false) },
      failureMessage: 'フォルダへ移せませんでした。',
      retry: () => moveBroadcastToFolder(broadcast, folderId),
      onSuccess: () => {
        setMoving(false)
        void loadList((page - 1) * pageSize)
        void loadFolders()
      },
    })
  }

  const getTagName = (tagId: string | null) => (tagId ? tags.find((t) => t.id === tagId)?.name ?? null : null)
  const getScenarioName = (scenarioId: string) => scenarios.find((s) => s.id === scenarioId)?.name ?? null

  /* タイトル・内容は手元で絞る。フォルダも手元で当て直す（移動の重ねをすぐ表へ出すため）。 */
  const visibleBroadcasts = broadcasts.filter((b) => {
    if (folderFilter === UNFILED && b.folderId) return false
    if (folderFilter && folderFilter !== UNFILED && b.folderId !== folderFilter) return false
    const query = titleQuery.trim().toLowerCase()
    if (query && !`${b.title} ${b.messageContent}`.toLowerCase().includes(query)) return false
    return true
  })

  const filterActive = statusFilter !== 'all' || folderFilter !== '' || titleQuery.trim() !== ''
    || dateFrom !== '' || dateTo !== '' || savedViewId !== ''
  const clearFilters = () => {
    setStatusFilter('all')
    setFolderFilter('')
    setTitleQuery('')
    setDateFrom('')
    setDateTo('')
    setSavedViewId('')
  }

  const openCreate = (withTemplate: boolean) => {
    setCreateMenuOpen(false)
    setOpenTemplatePicker(withTemplate)
    setShowCreate(true)
  }

  /* ===== 数の帯（1440：予約中・今月の送信枠・今月の配信・平均の開封率。1152：送信枠の代わりに下書き） ===== */
  const quotaRemaining = quota?.limit != null && quota?.used != null ? quota.limit - quota.used : null
  const kpiPending = listKpis === undefined
  const kpis = [
    {
      key: 'scheduled',
      title: '予約中',
      icon: CalendarClock,
      value: kpiPending ? null : (listKpis?.scheduled ?? null),
      unit: '件',
      detail: '今日 —（未取得）',
    },
    narrow
      ? {
          key: 'draft',
          title: '下書き',
          icon: FilePen,
          value: kpiPending ? null : (listKpis?.drafts ?? chipCount(statusCounts, 'draft')),
          unit: '件',
          detail: '編集の途中',
        }
      : {
          key: 'quota',
          title: '今月の送信枠',
          icon: Gauge,
          value: quotaRemaining,
          unit: '通 残り',
          detail: quota?.limit != null && quota?.used != null
            ? `${formatNumber(quota.limit)} 通のうち ${formatNumber(quota.used)} 通を使用`
            : '送信枠を確認できません',
        },
    {
      key: 'thisMonth',
      title: '今月の配信',
      icon: Send,
      value: kpiPending ? null : (listKpis?.thisMonth ?? null),
      unit: '件',
      detail: `${listKpis?.delivered == null ? '—' : `${formatNumber(listKpis.delivered)}人`}に届いた`,
    },
    {
      key: 'openRate',
      title: '平均の開封率',
      icon: MailOpen,
      value: kpiPending ? null : (listKpis?.openRate ?? null),
      unit: '%',
      detail: '過去28日',
    },
  ]

  const pageCount = listTotal == null ? 1 : Math.max(1, Math.ceil(listTotal / pageSize))
  const rangeFirst = visibleBroadcasts.length === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeLast = (page - 1) * pageSize + visibleBroadcasts.length

  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: statusCounts?.all ?? listTotal },
    ...folders.map((f, index) => ({
      id: f.id,
      label: f.name,
      count: f.itemCount ?? null,
      color: f.color,
      onEdit: canEdit ? () => setEditingFolder(f) : undefined,
      onMoveUp: canEdit && index > 0 ? () => void moveFolderOrder(index, -1) : undefined,
      onMoveDown: canEdit && index < folders.length - 1 ? () => void moveFolderOrder(index, 1) : undefined,
      onDelete: canEdit ? () => setDeletingFolder(f) : undefined,
      deleteNote: '削除しても、中の配信は未分類に残ります。',
    })),
    { id: UNFILED, label: '未分類', count: unfiledCount },
  ]

  const folderSelectOptions = [
    { value: '', label: 'フォルダ：すべて' },
    ...folders.map((f) => ({ value: f.id, label: `フォルダ：${f.name}` })),
    { value: UNFILED, label: 'フォルダ：未分類' },
  ]

  /** 行の「…」。編集を続ける（下書き・予約）・複製・フォルダへ移す・削除。 */
  const rowMenuItems = (broadcast: ApiBroadcast): ActionMenuItem[] => {
    if (menuMoveFor === broadcast.id) {
      return [
        { id: 'move-back', label: '← 操作にもどる', onSelect: () => { keepMenuOpenRef.current = true; setMenuMoveFor(null) } },
        { id: 'move-unfiled', label: '未分類', onSelect: () => void moveBroadcastToFolder(broadcast, null) },
        ...folders.map((f) => ({ id: `move-${f.id}`, label: f.name, onSelect: () => void moveBroadcastToFolder(broadcast, f.id) })),
      ]
    }
    const readonly = !canEdit
    const items: ActionMenuItem[] = []
    if (broadcast.status === 'draft' || broadcast.status === 'scheduled') {
      items.push({
        id: 'resume',
        label: '編集を続ける',
        external: true,
        disabled: readonly,
        disabledReason: readonly ? READONLY_REASON : undefined,
        onSelect: () => router.push(`/broadcasts/new?draft=${encodeURIComponent(broadcast.id)}`),
      })
    }
    items.push({
      id: 'duplicate',
      label: '複製',
      external: true,
      icon: <Copy size={14} aria-hidden="true" />,
      disabled: readonly,
      disabledReason: readonly ? READONLY_REASON : undefined,
      onSelect: () => router.push(`/broadcasts/new?duplicateFrom=${encodeURIComponent(broadcast.id)}`),
    })
    items.push({
      id: 'move-folder',
      label: 'フォルダへ移す',
      disabled: readonly || folders.length === 0,
      disabledReason: readonly ? READONLY_REASON : '移せるフォルダがありません',
      onSelect: () => {
        keepMenuOpenRef.current = true
        setMenuMoveFor(broadcast.id)
      },
    })
    items.push({
      id: 'delete',
      label: '削除する',
      tone: 'danger',
      dividerBefore: true,
      disabled: readonly,
      disabledReason: readonly ? READONLY_REASON : undefined,
      onSelect: () => { setDeleteError(''); setDeleteTarget(broadcast) },
    })
    return items
  }

  /** 右クリックは「…」と同じ品ぞろえ（「…」でも必ず開ける）。 */
  const rowContextItems = (broadcast: ApiBroadcast): ContextMenuItem[] =>
    rowMenuItems(broadcast).map((item) => ({
      id: item.id,
      label: item.label,
      external: item.external,
      dividerBefore: item.dividerBefore,
      icon: item.icon,
      danger: item.tone === 'danger',
      disabled: item.disabled,
      disabledReason: item.disabledReason,
      onSelect: item.onSelect,
    }))

  const goDetail = (id: string) => {
    withViewTransition(() => {
      router.push(`/broadcasts/detail?id=${encodeURIComponent(id)}`)
    })
  }

  const panelIndex = visibleBroadcasts.findIndex((b) => b.id === panelId)
  const panelRow = panelIndex >= 0 ? visibleBroadcasts[panelIndex] : null

  /* ===== 部品（広い板・1152 で同じものを並べ替えて使う） ===== */
  /* 閲覧のみには押せない「配信を作る」を置かずに隠す（2026-10-06 オーナー決定）。
     広い板では場所だけ空けて、フォルダの列の並びを絵（NtCE3）どおりに保つ。 */
  const createButton = (full: boolean) => (!canEdit ? (full ? <span className={styles.viewerCreateSpace} aria-hidden="true" /> : null) : (
    <Button
      type="button"
      variant="primary"
      className={full ? `v8-folder-create ${styles.createFull}` : undefined}
      aria-haspopup="menu"
      aria-expanded={createMenuOpen}
      onClick={(event) => { createAnchorRef.current = event.currentTarget; setCreateMenuOpen(true) }}
    >
      <Plus size={15} aria-hidden="true" />
      {full ? <>配信を作る<ChevronDown size={14} aria-hidden="true" /></> : '配信を作る'}
    </Button>
  ))

  const searchBox = (
    <div className={narrow ? `${styles.searchBox} ${styles.searchNarrow}` : styles.searchBox}>
      <SearchField
        aria-label="タイトル・内容で探す"
        placeholder="タイトル・内容で探す"
        value={titleQuery}
        onChange={setTitleQuery}
        onClear={() => setTitleQuery('')}
      />
    </div>
  )

  const dateBox = (
    <div className={styles.datePopoverWrap} ref={datePopoverRef}>
      <button
        type="button"
        className={styles.dateButton}
        data-active={Boolean(dateFrom || dateTo)}
        aria-expanded={datePopoverOpen}
        onClick={() => setDatePopoverOpen((open) => !open)}
      >
        {dateRangeLabel(dateFrom, dateTo)}
        <CalendarDays size={14} aria-hidden="true" />
      </button>
      {datePopoverOpen ? (
        <div className={styles.datePopover} role="dialog" aria-label="配信日で絞る">
          <p className={styles.datePopoverLabel}>配信日で絞る（開始〜終了）</p>
          <DateField value={dateFrom} onChange={setDateFrom} max={dateTo || undefined} aria-label="配信日（開始）" placeholder="開始日" />
          <DateField value={dateTo} onChange={setDateTo} min={dateFrom || undefined} aria-label="配信日（終了）" placeholder="終了日" />
          <div className={styles.datePopoverActions}>
            {(dateFrom || dateTo) ? (
              <Button type="button" onClick={() => { setDateFrom(''); setDateTo('') }}>外す</Button>
            ) : null}
            <Button type="button" variant="primary" onClick={() => setDatePopoverOpen(false)}>閉じる</Button>
          </div>
        </div>
      ) : null}
    </div>
  )

  /* 閲覧のみは保存できないので置かない。場所だけ空けて「保存した検索」までの並びを保つ。 */
  const saveCurrentButton = canEdit ? (
    <button
      type="button"
      className={styles.ghostButton}
      onClick={() => setSavedViewOpen((open) => !open)}
    >
      <Bookmark size={14} aria-hidden="true" />
      この条件を保存する
    </button>
  ) : (
    <span className={`${styles.ghostButton} ${styles.viewerSpace}`} aria-hidden="true">
      <Bookmark size={14} aria-hidden="true" />
      この条件を保存する
    </span>
  )

  const savedSearchBox = (
    <div className={styles.savedBox}>
      <Button
        type="button"
        aria-haspopup="menu"
        aria-expanded={savedMenuOpen}
        onClick={(event) => { savedAnchorRef.current = event.currentTarget; setSavedMenuOpen(true) }}
      >
        <Bookmark size={14} aria-hidden="true" />
        {savedViews.find((view) => view.id === savedViewId)?.name ?? '保存した検索'}
      </Button>
      <ActionMenu
        open={savedMenuOpen}
        onClose={() => setSavedMenuOpen(false)}
        anchorRef={savedAnchorRef}
        ariaLabel="保存した検索"
        items={[
          ...savedViews.map((view) => ({
            id: `view-${view.id}`,
            label: view.name,
            onSelect: () => { setSavedMenuOpen(false); applySavedView(view.id) },
          })),
          ...(savedViewId ? [{ id: 'view-clear', label: '保存した検索を外す', onSelect: () => { setSavedMenuOpen(false); clearFilters() } }] : []),
          // 閲覧のみは保存できないので、押せない項目を置かない
          ...(canEdit ? [{
            id: 'view-save',
            label: '＋ この条件を保存する',
            dividerBefore: savedViews.length > 0,
            onSelect: () => { setSavedMenuOpen(false); setSavedViewOpen(true) },
          }] : []),
        ]}
      />
    </div>
  )

  const statusChips = (
    <div className={styles.chips} role="group" aria-label="状態で絞る">
      {STATUS_CHIPS.map((chip) => (
        <FilterChip
          key={chip.key}
          selected={statusFilter === chip.key}
          onChange={() => setStatusFilter(chip.key)}
          icon={<chip.icon size={13} aria-hidden="true" />}
        >
          {chipText(chip.label, chipCount(statusCounts, chip.key))}
        </FilterChip>
      ))}
    </div>
  )

  const statusSelect = (
    <div className={styles.statusSelect}>
      <Select
        aria-label="状態で絞る"
        value={statusFilter}
        onChange={(value) => setStatusFilter(value as StatusChipKey)}
        options={STATUS_CHIPS.map((chip) => ({
          value: chip.key,
          label: `状態：${chipText(chip.label, chipCount(statusCounts, chip.key))}`,
        }))}
      />
    </div>
  )

  const pageSizeBox = (
    <div className={styles.pageSizeBox}>
      <Select
        aria-label="表示件数"
        size="page-size"
        value={String(pageSize)}
        onChange={(value) => setPageSize(Number(value) || 20)}
        options={[
          { value: '10', label: '10件表示' },
          { value: '20', label: '20件表示' },
          { value: '50', label: '50件表示' },
        ]}
      />
    </div>
  )

  const sortButton = (
    <button
      type="button"
      className={styles.sortButton}
      aria-label={`並び順：${sortKey === 'newest' ? '新しい順' : '古い順'}（押すと入れ替え）`}
      onClick={() => setSortKey((current) => (current === 'newest' ? 'oldest' : 'newest'))}
    >
      <ArrowUpDown size={14} aria-hidden="true" />
      {sortKey === 'newest' ? '新しい順' : '古い順'}
    </button>
  )

  const folderSelect = (
    <div className={styles.folderSelect}>
      <Select aria-label="フォルダ" value={folderFilter} onChange={setFolderFilter} options={folderSelectOptions} />
    </div>
  )

  /* 道具の段：1440 は「探す・配信日・保存 … 保存した検索」／「札 … 件数・並び」。1152 は作る・フォルダが前に入り、札は選ぶ欄。 */
  const toolbar = (
    <div className={styles.tools}>
      <div className={styles.toolRow}>
        {narrow ? createButton(false) : null}
        {narrow ? folderSelect : null}
        {searchBox}
        {dateBox}
        {narrow ? null : saveCurrentButton}
        <span className={styles.spacer} aria-hidden="true" />
        {savedSearchBox}
      </div>
      <div className={styles.toolRow}>
        {narrow ? statusSelect : statusChips}
        <span className={styles.spacer} aria-hidden="true" />
        {pageSizeBox}
        {sortButton}
      </div>
      {savedViewOpen ? (
        <div className={styles.saveRow}>
          <input
            aria-label="保存する検索の名前"
            placeholder="検索条件の名前"
            value={savedViewName}
            onChange={(event) => setSavedViewName(event.target.value)}
            className={styles.saveInput}
          />
          <Button type="button" variant="primary" disabled={!savedViewName.trim() || savedViewBusy} onClick={() => void saveCurrentView()} busy={savedViewBusy} busyLabel="保存中">保存する</Button>
          <Button type="button" onClick={() => setSavedViewOpen(false)}>閉じる</Button>
        </div>
      ) : null}
      {savedViewError ? (
        <p role="alert" className={styles.note}>
          {savedViewError}
          <button type="button" onClick={() => setSavedViewsSeq((n) => n + 1)} className={styles.inlineRetry}>もう一度</button>
        </p>
      ) : null}
    </div>
  )

  /* ===== 表 ===== */
  const folderDotOf = (folderId: string | null | undefined) => {
    const folder = folderId ? folders.find((f) => f.id === folderId) : undefined
    return folder ? { name: folder.name, color: folder.color } : null
  }

  const tableHead = (
    <thead>
      <TableHeadRow>
        <Th className={styles.colTitle}>タイトル・内容</Th>
        <Th className={styles.colStatus}>状態</Th>
        {narrow ? null : <Th className={styles.colAudience}>配信条件</Th>}
        <Th className={styles.colDate}>配信日時</Th>
        <Th className={narrow ? styles.colResult : styles.colResultWide}>結果</Th>
        <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
      </TableHeadRow>
    </thead>
  )

  const loadingSkeleton = (
    <DataTable className={styles.table}>
      {tableHead}
      <tbody>
        {[0, 1, 2, 3, 4].map((n) => (
          <Tr key={n} className={styles.row}>
            <Td><Skeleton width={200} height={16} /><Skeleton width={140} height={12} /></Td>
            <Td><Skeleton width={72} height={22} className="rounded-pill" /></Td>
            {narrow ? null : <Td><Skeleton width={120} height={12} /></Td>}
            <Td><Skeleton width={96} height={16} /></Td>
            <Td><Skeleton width={64} height={16} /></Td>
            <Td />
          </Tr>
        ))}
      </tbody>
    </DataTable>
  )

  const stateCard = (icon: React.ReactNode, title: string, desc: string | null, action: React.ReactNode, danger = false) => (
    <div className={styles.stateCard}>
      {icon ? <span className={danger ? `${styles.stateIcon} ${styles.stateIconError}` : styles.stateIcon}>{icon}</span> : null}
      <p className={styles.stateTitle}>{title}</p>
      {desc ? <p className={styles.stateDesc}>{desc}</p> : null}
      {action}
    </div>
  )

  const listBody = loading ? (
    <div aria-busy="true" aria-label="読み込んでいます">
      <DelayedSkeleton loading skeleton={loadingSkeleton} />
    </div>
  ) : forbidden ? (
    stateCard(<AlertCircle size={20} aria-hidden="true" />, '配信を見る権限がありません', '見るには権限が要ります。オーナーか管理者に追加を依頼してください。', null, true)
  ) : error ? (
    stateCard(<AlertCircle size={20} aria-hidden="true" />, '一斉配信を読み込めませんでした', null,
      <Button type="button" onClick={() => void loadList((page - 1) * pageSize)}>もう一度試す</Button>, true)
  ) : visibleBroadcasts.length === 0 ? (
    filterActive
      ? stateCard(null, '条件に合う配信はありません', '「予約中のみ」「下書き」や配信日を外すと、すべて出ます',
        <Button type="button" onClick={clearFilters}><X size={14} aria-hidden="true" />条件を外す</Button>)
      : stateCard(<Send size={20} aria-hidden="true" />, 'まだ一斉配信はありません', '友だちにまとめてお知らせを送れます',
        /* 閲覧のみには押せない「配信を作る」を置かずに隠す（2026-10-06 オーナー決定）。 */
        canEdit ? <Button type="button" variant="primary" onClick={() => openCreate(false)}><Plus size={15} aria-hidden="true" />配信を作る</Button> : null)
  ) : (
    <DataTable className={styles.table}>
      {tableHead}
      <RovingTbody>
        {visibleBroadcasts.map((broadcast) => {
          const insight = insights[broadcast.id] ?? summaryInsight(broadcast.insightSummary)
          const audience = audienceSummary(broadcast, getTagName, getScenarioName)
          const detailHref = `/broadcasts/detail?id=${encodeURIComponent(broadcast.id)}`
          const menuLabel = `配信「${broadcast.title}」の操作`
          const titleLink = (
            <Link
              href={detailHref}
              className={styles.cellTitle}
              title={broadcast.title}
              onClick={(event) => {
                event.stopPropagation()
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                event.preventDefault()
                goDetail(broadcast.id)
              }}
            >
              {broadcast.title}
            </Link>
          )
          return (
            <Tr
              key={broadcast.id}
              className={styles.row}
              interactive
              tabIndex={0}
              onClick={() => setPanelId(broadcast.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter') {
                  event.preventDefault()
                  setPanelId(broadcast.id)
                }
              }}
            >
              <Td>
                {/* 左にフォルダの列がある広い板は、名前の前にフォルダの色の丸（絵 l5V9a・NtCE3）。1152（jjFNi）は列が無いので出さない。 */}
                {narrow ? titleLink : <div className={styles.titleLine}><FolderDotName folder={folderDotOf(broadcast.folderId)}>{titleLink}</FolderDotName></div>}
                <span className={narrow ? styles.cellSub : `${styles.cellSub} ${styles.dotIndent}`}>{messageTypeLabel(broadcast.messageType)}</span>
              </Td>
              <Td><StatusBadge broadcast={broadcast} /></Td>
              {narrow ? null : (
                <Td><span className={styles.audience} title={audience}>{audience}</span></Td>
              )}
              <Td>
                <span className={styles.cellMain}>
                  {broadcast.status === 'sent'
                    ? (broadcast.sentAt ? formatDateTime(broadcast.sentAt) : '—')
                    : (broadcast.scheduledAt ? formatDateTime(broadcast.scheduledAt) : '未設定')}
                </span>
                {broadcast.status === 'scheduled' && broadcast.scheduledAt ? <span className={styles.cellSub}>予約</span> : null}
              </Td>
              <Td>
                {broadcast.status !== 'sent' ? (
                  <span className={styles.cellMain}>—</span>
                ) : (
                  <>
                    <span className={styles.resultMain}>{formatNumber(insight?.delivered ?? broadcast.successCount)}人に届いた</span>
                    {insight && (insight.openRate != null || insight.clickRate != null) ? (
                      <span className={styles.cellSub}>
                        {[
                          insight.openRate != null ? `開封 ${(insight.openRate * 100).toFixed(1)}%` : '',
                          insight.clickRate != null ? `クリック ${(insight.clickRate * 100).toFixed(1)}%` : '',
                        ].filter(Boolean).join('・')}
                      </span>
                    ) : null}
                  </>
                )}
              </Td>
              <Td className={styles.colMenu} onClick={(event) => event.stopPropagation()}>
                <div className={styles.menuBox}>
                  <ContextMenu label={menuLabel} items={rowContextItems(broadcast)}>
                    <button
                      type="button"
                      className={styles.menuButton}
                      aria-label={menuLabel}
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === broadcast.id}
                      title={menuLabel}
                      onClick={() => {
                        setMenuMoveFor(null)
                        setOpenMenuId((current) => (current === broadcast.id ? null : broadcast.id))
                      }}
                    >
                      <MoreHorizontal size={14} aria-hidden="true" />
                    </button>
                  </ContextMenu>
                  <ActionMenu
                    open={openMenuId === broadcast.id}
                    onClose={() => {
                      if (keepMenuOpenRef.current) {
                        keepMenuOpenRef.current = false
                        return
                      }
                      setOpenMenuId(null)
                    }}
                    ariaLabel={menuLabel}
                    items={rowMenuItems(broadcast)}
                  />
                </div>
              </Td>
            </Tr>
          )
        })}
      </RovingTbody>
    </DataTable>
  )

  const pager = !loading && !error && !forbidden && visibleBroadcasts.length > 0 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>
        {pageCount > 1
          ? `${formatNumber(listTotal ?? visibleBroadcasts.length)}件中 ${rangeFirst}〜${rangeLast}件`
          : `${formatNumber(listTotal ?? visibleBroadcasts.length)}件`}
      </span>
      {pageCount > 1 ? (
        <Pagination page={page} pageCount={pageCount} onPageChange={goPage} ariaLabel="一斉配信のページ送り" />
      ) : null}
    </ListPagePagination>
  ) : null

  const boardId = narrow ? 'jjFNi' : canEdit ? 'l5V9a' : 'NtCE3'

  return (
    <ListPage
      boardId={boardId}
      headingSize="compact"
      title="一斉配信"
      description="友だちにまとめて送るメッセージの一覧です。予約・下書き・送った結果をここで見ます。"
      stats={<>
        {canEdit ? null : (
          <div className={styles.viewerBand} role="status">
            <Eye size={16} aria-hidden="true" />
            <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
          </div>
        )}
        <KpiBand>
          {kpis.map((kpi) => (
            <KpiCard
              key={kpi.key}
              presentation="band"
              density="compact"
              title={kpi.title}
              icon={<kpi.icon size={14} aria-hidden="true" />}
              value={kpi.value}
              unit={kpi.value == null ? '' : kpi.unit}
              detail={kpi.detail}
            />
          ))}
        </KpiBand>
      </>}
      folders={narrow ? undefined : (
        <FolderPanel
          createAction={createButton(true)}
          activeId={folderFilter}
          onSelect={setFolderFilter}
          onAddFolder={canEdit ? () => setFolderDialogOpen(true) : undefined}
          addFolderLabel="フォルダを追加"
          rows={folderRows}
        >
          {/* 閲覧のみ：「フォルダを追加」は置かず、場所だけ空ける */}
          {canEdit ? null : <span className={styles.viewerAddSpace} aria-hidden="true" />}
          <p className={styles.note}>フォルダを消しても、入っていたものは未分類に残ります</p>
          {folderError ? (
            <p role="alert" className={styles.note}>
              {folderError}
              <button type="button" onClick={() => void loadFolders()} className={styles.inlineRetry}>もう一度</button>
            </p>
          ) : null}
        </FolderPanel>
      )}
      toolbar={toolbar}
      pagination={pager}
      overlays={<>
        <ActionMenu
          open={createMenuOpen}
          onClose={() => setCreateMenuOpen(false)}
          anchorRef={createAnchorRef}
          ariaLabel="配信の作り方"
          items={[
            /* 絵 `Xr6eu` の分け方：かんたんに送る（1画面・板 `P6vbxn`）と詳しく作る（5つの手順 `/broadcasts/new`）。
               テンプレートから作るは絵に無いが今ある機能なので、その下に残す。 */
            { id: 'create-quick', label: 'かんたんに送る', description: '文字1通を、全員かタグで。1画面で送れる', onSelect: () => { setCreateMenuOpen(false); setQuickSendOpen(true) } },
            { id: 'create-new', label: '詳しく作る', description: '画像・カード・細かい絞り込み・承認（5つの手順）', onSelect: () => { setCreateMenuOpen(false); router.push('/broadcasts/new') } },
            { id: 'create-template', label: 'テンプレートから作る', onSelect: () => openCreate(true) },
          ]}
        />
        <QuickSendV8
          open={quickSendOpen}
          accountId={selectedAccountId || null}
          onClose={() => setQuickSendOpen(false)}
          onSent={() => void loadList(0)}
        />
        {folderDialogOpen && (
          <FolderAddDialog
            kind="broadcast"
            note="配信を分けてしまう箱です。消しても、入っていた配信は未分類として残ります。"
            placeholder="例: 01_キャンペーン"
            onClose={() => setFolderDialogOpen(false)}
            onAdded={() => void loadFolders()}
          />
        )}
        {editingFolder && (
          <FolderAddDialog
            kind="broadcast"
            folder={editingFolder}
            note="配信を分けてしまう箱です。削除しても、中の配信は未分類に残ります。"
            placeholder="例: 01_キャンペーン"
            onClose={() => setEditingFolder(null)}
            onAdded={() => { setEditingFolder(null); void loadFolders() }}
          />
        )}
        {panelRow ? (() => {
          const audience = audienceSummary(panelRow, getTagName, getScenarioName)
          const insight = insights[panelRow.id] ?? summaryInsight(panelRow.insightSummary)
          const canResume = panelRow.status === 'draft' || panelRow.status === 'scheduled'
          return (
            <DetailPanel
              open
              title={panelRow.title}
              description={audience}
              onClose={() => setPanelId(null)}
              onPrev={panelIndex > 0 ? () => setPanelId(visibleBroadcasts[panelIndex - 1].id) : undefined}
              onNext={panelIndex < visibleBroadcasts.length - 1 ? () => setPanelId(visibleBroadcasts[panelIndex + 1].id) : undefined}
              hasPrev={panelIndex > 0}
              hasNext={panelIndex < visibleBroadcasts.length - 1}
              footer={<>
                <Button variant="primary" onClick={() => goDetail(panelRow.id)}>開く</Button>
                {canResume && canEdit ? (
                  <Button
                    variant="secondary"
                    onClick={() => withViewTransition(() => { router.push(`/broadcasts/new?draft=${encodeURIComponent(panelRow.id)}`) })}
                  >
                    編集を続ける
                  </Button>
                ) : null}
                {/* 閲覧のみには押せない操作を置かない */}
                {canEdit ? <>
                  <Button
                    variant="secondary"
                    onClick={() => withViewTransition(() => { router.push(`/broadcasts/new?duplicateFrom=${encodeURIComponent(panelRow.id)}`) })}
                  >
                    複製する
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => { setDeleteError(''); setDeleteTarget(panelRow); setPanelId(null) }}
                  >
                    削除する
                  </Button>
                </> : null}
              </>}
            >
              <p>
                {panelRow.status === 'sent'
                  ? (panelRow.sentAt ? `送信済み：${formatDateTime(panelRow.sentAt)}` : '送信済み')
                  : (panelRow.scheduledAt ? `予約：${formatDateTime(panelRow.scheduledAt)}` : '下書き')}
                {panelRow.status === 'sent' ? ` ／ ${formatNumber(insight?.delivered ?? panelRow.successCount)}人に届いた` : ''}
              </p>
            </DetailPanel>
          )
        })() : null}
        <ConfirmDialog
          open={deletingFolder !== null}
          title={`フォルダ「${deletingFolder?.name ?? ''}」を削除しますか？`}
          description={`削除しても、中の配信は未分類に残ります。いまこのフォルダに入っているのは${
            deletingFolder ? broadcasts.filter((b) => b.folderId === deletingFolder.id).length : 0
          }件です。`}
          confirmLabel="削除する"
          destructive
          busy={folderBusy}
          error={folderError || undefined}
          onConfirm={() => void removeFolder()}
          onCancel={() => {
            if (folderBusy) return
            setDeletingFolder(null)
            setFolderError('')
          }}
        />
        <ConfirmDialog
          open={deleteTarget !== null}
          title={`「${deleteTarget?.title ?? ''}」を削除しますか？`}
          description="削除すると配信設定と確認画面から消えます。予約中の配信は中止され、この操作は取り消せません。"
          confirmLabel="削除する"
          destructive
          busy={deleting}
          error={deleteError}
          onConfirm={() => void handleDelete()}
          onCancel={() => {
            if (deleting) return
            setDeleteTarget(null)
            setDeleteError('')
          }}
        />
      </>}
    >
      {showCreate ? (
        <div className={styles.createForm}>
          <BroadcastForm
            tags={tags}
            onSuccess={() => { setShowCreate(false); void loadList(); void loadFolders() }}
            onDraftSaved={() => { void loadList(); void loadFolders() }}
            onCancel={() => setShowCreate(false)}
            openTemplatePickerInitially={openTemplatePicker}
          />
        </div>
      ) : null}
      {listBody}
    </ListPage>
  )
}
