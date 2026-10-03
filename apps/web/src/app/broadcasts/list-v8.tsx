'use client'

/*
 * ★V8 一斉配信の一覧（Pencil `l5V9a`。1152 は `jjFNi`、状態別の見え方は `A8jzaQ`。
 * 再撮の板 `EML2F`（一覧）・`bIdqV`（一覧の状態）を外枠に、`rfdmA`（一覧1152）を道具の段に付ける）。
 *
 * v7 の一覧（page.tsx の BroadcastList）とは別の部品として持つ。
 * データの口は同じ `/api/broadcasts`。違いは置き場と見せ方だけ——
 * フォルダの列・道具の段・状態の札・ページ送りは V8 の絵どおりに組み直した。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  Bookmark,
  CalendarDays,
  CalendarClock,
  Copy,
  FileText,
  Gauge,
  List as ListIcon,
  MailOpen,
  MoreHorizontal,
  Send,
  SendHorizontal,
  UserCheck,
} from 'lucide-react'
import type { Folder, Tag } from '@line-crm/shared'
import { ApiError, api, type ApiBroadcast, type BroadcastInsight, type BroadcastListKpis, type BroadcastSavedView } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole } from '@/lib/staff-role'
import { canEditFeature } from '@/lib/staff-capability'
import BroadcastForm from '@/components/broadcasts/broadcast-form'
import FolderPanel from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Select from '@/components/shared/select'
import Button from '@/components/shared/button'
import DateField from '@/components/shared/date-field'
import SearchField from '@/components/shared/search-field'
import Pagination from '@/components/shared/pagination'
import { TableHeadRow, Th } from '@/components/shared/table'
import { ApprovalBadge } from '@/components/broadcasts/broadcast-approval'
import { notifyToast } from '@/components/shared/toast'
import { audienceSummary, rowExcerpt } from '@/lib/broadcast-summary'
import { formatDateTime, formatNumber, formatYmd } from '@/lib/format'
import styles from './list-v8.module.css'

/** 未分類を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'

/**
 * 絞り込みの札（照合表 2026-10-01）：
 * すべて・予約中・下書き・承認待ち・送信済み・エラー。
 * 札は 10 の状態（displayStatus）で絞る。raw の status では
 * 「承認待ち」や「エラー」は出せないため。
 */
type StatusChipKey = 'all' | 'scheduled' | 'draft' | 'pending_approval' | 'sent' | 'error'

const STATUS_CHIPS: Array<{
  key: StatusChipKey
  label: string
  icon: typeof CalendarClock
  /** 口へ渡す displayStatus（カンマ区切り）。all は絞らない。 */
  query: string
}> = [
  { key: 'all', label: 'すべて', icon: ListIcon, query: '' },
  { key: 'scheduled', label: '予約中', icon: CalendarClock, query: 'scheduled' },
  { key: 'draft', label: '下書き', icon: FileText, query: 'draft' },
  { key: 'pending_approval', label: '承認待ち', icon: UserCheck, query: 'pending_approval' },
  { key: 'sent', label: '送信済み', icon: SendHorizontal, query: 'sent' },
  { key: 'error', label: 'エラー', icon: AlertCircle, query: 'failed,partial_failed' },
]

/** 札の件数を statusCounts から拾う。エラーは失敗系を足す。 */
function chipCount(statusCounts: Record<string, number> | null, key: StatusChipKey): number | null {
  if (!statusCounts) return null
  if (key === 'all') return statusCounts.all ?? null
  if (key === 'error') return (statusCounts.failed ?? 0) + (statusCounts.partial_failed ?? 0)
  return statusCounts[key] ?? null
}

/** 状態の札の色。10 の状態を5色に畳む（設計の札と同じ割付）。 */
const BADGE_TONE: Record<string, string> = {
  draft: styles.statusNeutral,
  pending_approval: styles.statusWarning,
  scheduled: styles.statusInfo,
  preparing: styles.statusInfo,
  sending: styles.statusWarning,
  sent: styles.statusSuccess,
  partial_failed: styles.statusWarning,
  failed: styles.statusDanger,
  stopped: styles.statusNeutral,
  expired: styles.statusNeutral,
}

function statusBadge(broadcast: ApiBroadcast) {
  const label = broadcast.displayStatusLabel ?? broadcast.displayStatus ?? broadcast.status
  const tone = BADGE_TONE[broadcast.displayStatus ?? broadcast.status] ?? styles.statusNeutral
  return (
    <span className={`${styles.statusBadge} ${tone}`}>
      <span className={styles.statusDot} aria-hidden="true" />
      {label}
    </span>
  )
}

/** 「配信日」の欄の題字。絞っているときは期間を出す。 */
function dateRangeLabel(dateFrom: string, dateTo: string): string {
  if (!dateFrom && !dateTo) return '配信日：指定なし'
  if (dateFrom && dateTo) return `配信日：${dateFrom}〜${dateTo}`
  return `配信日：${dateFrom || dateTo}〜`
}

export default function BroadcastListV8() {
  usePageTitle('一斉配信')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const staffRole = useStaffRole()
  /*
   * 閲覧のみ（夕18）：作る・保存する・フォルダを足す・…の変える項目は
   * 押せない形にする。役割が読めていない間は今までどおり出す
   * （最後の守りはサーバの 403）。
   */
  const canEdit = staffRole === null || canEditFeature('broadcast.definition.edit')

  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [listKpis, setListKpis] = useState<BroadcastListKpis | null | undefined>(undefined)
  const [statusCounts, setStatusCounts] = useState<Record<string, number> | null>(null)
  const [quota, setQuota] = useState<{ limit: number | null; used: number | null } | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusChipKey>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [openTemplatePicker, setOpenTemplatePicker] = useState(false)
  const [titleQuery, setTitleQuery] = useState('')
  const [savedViewId, setSavedViewId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [datePopoverOpen, setDatePopoverOpen] = useState(false)
  const datePopoverRef = useRef<HTMLDivElement>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [folderFilter, setFolderFilter] = useState('')
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
  /* 行の「…」メニュー。フォルダへ移すは同じメニューの2段目で選ぶ。 */
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuMoveFor, setMenuMoveFor] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [savedViews, setSavedViews] = useState<BroadcastSavedView[]>([])
  const [savedViewsSeq, setSavedViewsSeq] = useState(0)
  const [savedViewName, setSavedViewName] = useState('')
  const [savedViewOpen, setSavedViewOpen] = useState(false)
  const [savedViewBusy, setSavedViewBusy] = useState(false)
  const [savedViewError, setSavedViewError] = useState('')

  const summaryInsight = (summary: ApiBroadcast['insightSummary']): BroadcastInsight | undefined => {
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

  /*
   * ページ送りは口側の cursor（= オフセット）で行う。
   * ページ番号は画面だけの形で、口には (page-1)*limit を渡す。
   */
  const load = useCallback(async (cursor = 0) => {
    setLoading(true)
    setError('')
    setForbidden(false)
    try {
      const chip = STATUS_CHIPS.find((item) => item.key === statusFilter)
      const [broadcastsRes, tagsRes, scenariosRes] = await Promise.all([
        api.broadcasts.list({
          accountId: selectedAccountId || undefined,
          limit: pageSize,
          cursor,
          displayStatus: chip && chip.query !== '' ? chip.query : undefined,
          folderId: folderFilter === UNFILED ? 'unfiled' : folderFilter || undefined,
          sort: sortKey,
        }),
        api.tags.list(selectedAccountId ? { accountId: selectedAccountId } : undefined),
        api.scenarios.list(selectedAccountId ? { accountId: selectedAccountId } : undefined).catch(() => null),
      ])
      if (broadcastsRes.success) {
        setBroadcasts(broadcastsRes.data)
        setListKpis(broadcastsRes.kpis)
        setStatusCounts(broadcastsRes.statusCounts ?? null)
        setListTotal(broadcastsRes.pagination?.total ?? null)
      } else {
        setError(broadcastsRes.error)
      }
      if (tagsRes && tagsRes.success) setTags(tagsRes.data)
      if (scenariosRes && scenariosRes.success) {
        setScenarios(scenariosRes.data.map((item) => ({ id: item.id, name: item.name })))
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true)
      else setError('データの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, pageSize, sortKey, statusFilter, folderFilter])

  /* 条件を変えたら1ページ目へ戻して取り直す。 */
  useEffect(() => {
    setPage(1)
    void load(0)
  }, [load])

  const goPage = (next: number) => {
    setPage(next)
    void load((next - 1) * pageSize)
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
        if (res.success) {
          setQuota({ limit: res.data.delivery.quotaLimit, used: res.data.delivery.quotaUsed })
        }
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

  /* 「配信日」のポップオーバーは外を押したら閉じる。 */
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
    if (id === '__save__') {
      setSavedViewId('')
      setSavedViewOpen(true)
      return
    }
    const view = savedViews.find((item) => item.id === id)
    if (!view) return
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
      await load((page - 1) * pageSize)
    } catch {
      setDeleteError('この配信を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  /* 行の「…」→「フォルダへ移す」。宛先フォルダを同じメニューで選ぶ。 */
  const moveBroadcastToFolder = async (broadcast: ApiBroadcast, folderId: string | null) => {
    if (moving) return
    setMoving(true)
    try {
      const res = await api.broadcasts.update(broadcast.id, {
        folderId,
        expectedVersion: broadcast.version ?? 0,
      })
      if (!res.success) throw new Error(res.error)
      await load((page - 1) * pageSize)
      await loadFolders()
    } catch {
      notifyToast('フォルダへ移せませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setMoving(false)
      setOpenMenuId(null)
      setMenuMoveFor(null)
    }
  }

  const getTagName = (tagId: string | null) => {
    if (!tagId) return null
    return tags.find((t) => t.id === tagId)?.name ?? null
  }
  const getScenarioName = (scenarioId: string) =>
    scenarios.find((s) => s.id === scenarioId)?.name ?? null

  /* タイトルと配信日は手元で絞る（口は状態・フォルダまで）。 */
  const visibleBroadcasts = broadcasts.filter((b) => {
    const query = titleQuery.trim().toLowerCase()
    if (query && !`${b.title} ${b.messageContent}`.toLowerCase().includes(query)) return false
    if (dateFrom || dateTo) {
      const iso = b.status === 'sent' ? b.sentAt : b.scheduledAt
      if (!iso) return false
      const ymd = formatYmd(iso)
      if (dateFrom && ymd < dateFrom) return false
      if (dateTo && ymd > dateTo) return false
    }
    return true
  })

  const filterActive = statusFilter !== 'all'
    || folderFilter !== ''
    || titleQuery.trim() !== ''
    || dateFrom !== ''
    || dateTo !== ''
    || savedViewId !== ''
  const clearFilters = () => {
    setStatusFilter('all')
    setFolderFilter('')
    setTitleQuery('')
    setDateFrom('')
    setDateTo('')
    setSavedViewId('')
  }

  const quotaRemaining = quota?.limit != null && quota?.used != null
    ? quota.limit - quota.used
    : null
  const kpis = [
    {
      key: 'scheduled',
      label: '予約中',
      icon: CalendarClock,
      value: listKpis === undefined ? null : (listKpis?.scheduled ?? null),
      unit: '件',
      detail: '今日 —（未取得）',
    },
    {
      key: 'quota',
      label: '今月の送信枠',
      icon: Gauge,
      value: quotaRemaining,
      unit: '通残り',
      detail: quota?.limit != null && quota?.used != null
        ? `${formatNumber(quota.limit)}通のうち ${formatNumber(quota.used)}通使用`
        : '送信枠を確認できません',
    },
    {
      key: 'thisMonth',
      label: '今月の配信',
      icon: Send,
      value: listKpis === undefined ? null : (listKpis?.thisMonth ?? null),
      unit: '件',
      detail: `${listKpis?.delivered == null ? '—' : `${formatNumber(listKpis.delivered)}人`}に届いた`,
    },
    {
      key: 'openRate',
      label: '平均開封率',
      icon: MailOpen,
      value: listKpis === undefined ? null : (listKpis?.openRate ?? null),
      unit: '%',
      detail: '過去28日',
    },
  ]

  const pageCount = listTotal == null ? 1 : Math.max(1, Math.ceil(listTotal / pageSize))
  const rangeFirst = visibleBroadcasts.length === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeLast = (page - 1) * pageSize + visibleBroadcasts.length

  const folderRows = [
    { id: '', label: 'すべて', count: statusCounts?.all ?? listTotal },
    ...folders.map((f, index) => ({
      id: f.id,
      label: f.name,
      count: f.itemCount ?? null,
      color: f.color,
      qaOpen: index === 1 ? 'xkRDb' : undefined,
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

  /** 行の「…」。複製・フォルダへ移す・削除（下書き・予約は「編集を続ける」も）。 */
  const rowMenuItems = (broadcast: ApiBroadcast): ActionMenuItem[] => {
    if (menuMoveFor === broadcast.id) {
      return [
        { id: 'move-back', label: '← 操作にもどる', onSelect: () => setMenuMoveFor(null) },
        { id: 'move-unfiled', label: '未分類', onSelect: () => void moveBroadcastToFolder(broadcast, null) },
        ...folders.map((f) => ({
          id: `move-${f.id}`,
          label: f.name,
          onSelect: () => void moveBroadcastToFolder(broadcast, f.id),
        })),
      ]
    }
    const items: ActionMenuItem[] = []
    /* 閲覧のみ（夕18）：変える項目は押せない形。理由も添える。 */
    const readonly = !canEdit
    const readonlyReason = '閲覧のみのため変更できません'
    if (broadcast.status === 'draft' || broadcast.status === 'scheduled') {
      items.push({
        id: 'resume',
        label: '編集を続ける',
        external: true,
        disabled: readonly,
        disabledReason: readonly ? readonlyReason : undefined,
        onSelect: () => router.push(`/broadcasts/new?draft=${encodeURIComponent(broadcast.id)}`),
      })
    }
    items.push({
      id: 'duplicate',
      label: '複製',
      external: true,
      icon: <Copy size={14} aria-hidden="true" />,
      disabled: readonly,
      disabledReason: readonly ? readonlyReason : undefined,
      onSelect: () => router.push(`/broadcasts/new?duplicateFrom=${encodeURIComponent(broadcast.id)}`),
    })
    items.push({
      id: 'move-folder',
      label: 'フォルダへ移す',
      disabled: readonly || folders.length === 0,
      disabledReason: readonly ? readonlyReason : '移せるフォルダがありません',
      onSelect: () => setMenuMoveFor(broadcast.id),
    })
    items.push({
      id: 'delete',
      label: '削除する',
      tone: 'danger',
      dividerBefore: true,
      disabled: readonly,
      disabledReason: readonly ? readonlyReason : undefined,
      onSelect: () => { setDeleteError(''); setDeleteTarget(broadcast) },
    })
    return items
  }

  return (
    <div className={styles.board} data-design-node="EML2F bIdqV">
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

      <div className={styles.head}>
        <h2 className={styles.headTitle}>一斉配信</h2>
        <p className={styles.headDescription}>
          友だちにまとめて送るメッセージの一覧です。予約・下書き・送った結果をここで見ます。
        </p>
      </div>

      {/* 数の帯：予約中・今月の送信枠・今月の配信・平均開封率（アイコンつき）。 */}
      <div className={styles.kpis} role="group" aria-label="配信の数">
        {kpis.map((kpi) => (
          <div key={kpi.key} className={styles.kpi}>
            <div className={styles.kpiHead}>
              <span className={styles.kpiLabel}>
                <kpi.icon size={14} aria-hidden="true" />
                {kpi.label}
              </span>
            </div>
            <p className={styles.kpiValue}>
              {kpi.value == null ? '—' : formatNumber(kpi.value)}
              <span className={styles.kpiUnit}>{kpi.unit}</span>
            </p>
            <p className={styles.kpiDetail}>{kpi.detail}</p>
          </div>
        ))}
      </div>

      <div className={styles.split}>
        {/* フォルダの列。作る入口は列のいちばん上（オーナー決定）。 */}
        <div className={styles.folderCol}>
          <Button
            type="button"
            variant="primary"
            className="v8-folder-create"
            disabled={!canEdit}
            onClick={() => { setOpenTemplatePicker(false); setShowCreate(true) }}
          >
            ＋ 配信を作る
          </Button>
          <FolderPanel
            activeId={folderFilter}
            onSelect={setFolderFilter}
            onAddFolder={canEdit ? () => setFolderDialogOpen(true) : undefined}
            addFolderDisabled={!canEdit}
            addFolderLabel="＋ フォルダを追加"
            rows={folderRows}
          >
            <p className={styles.folderNote}>
              フォルダを消しても、入っていた配信は未分類として残ります。
            </p>
            {folderError && (broadcasts.length > 0 || showCreate || !error) ? (
              <p role="alert" className={styles.folderNote}>
                {folderError}
                <button type="button" onClick={() => void loadFolders()} className="text-action ml-2 font-semibold hover:underline">
                  もう一度
                </button>
              </p>
            ) : null}
          </FolderPanel>
        </div>

        <div className={styles.listCol}>
          {/* 道具の段。狭い板では「＋配信を作る」とフォルダ選びがここへ畳まれる（1152 は `rfdmA`）。 */}
          <div className={styles.toolbar} data-design-node="rfdmA">
            <Button
              type="button"
              variant="primary"
              className={styles.toolbarCreate}
              disabled={!canEdit}
              onClick={() => { setOpenTemplatePicker(false); setShowCreate(true) }}
            >
              ＋ 配信を作る
            </Button>
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
                aria-label="タイトル・内容で探す"
                placeholder="タイトル・内容で探す"
                value={titleQuery}
                onChange={setTitleQuery}
                onClear={() => setTitleQuery('')}
              />
            </div>
            <div className={styles.datePopoverWrap} ref={datePopoverRef}>
              <button
                type="button"
                className={styles.dateButton}
                data-active={Boolean(dateFrom || dateTo)}
                aria-expanded={datePopoverOpen}
                onClick={() => setDatePopoverOpen((open) => !open)}
              >
                <CalendarDays size={14} aria-hidden="true" />
                {dateRangeLabel(dateFrom, dateTo)}
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
            <button
              type="button"
              className={`${styles.dateButton} ${styles.saveCurrentButton}`}
              disabled={!canEdit}
              onClick={() => setSavedViewOpen((open) => !open)}
            >
              <Bookmark size={14} aria-hidden="true" />
              この条件を保存する
            </button>
            <span className={styles.toolbarSpacer} />
            <Select
              aria-label="保存した検索"
              value={savedViewId}
              onChange={(value) => { setSavedViewId(value); applySavedView(value) }}
              options={[
                { value: '', label: '保存した検索' },
                ...savedViews.map((view) => ({ value: view.id, label: view.name })),
                { value: '__save__', label: '＋ この条件を保存する', disabled: !canEdit },
              ]}
            />
          </div>

          {savedViewOpen && (
            <div className={styles.saveRow}>
              <input
                aria-label="保存する検索の名前"
                placeholder="検索条件の名前"
                value={savedViewName}
                onChange={(event) => setSavedViewName(event.target.value)}
                className={styles.saveInput}
              />
              <Button type="button" variant="primary" disabled={!savedViewName.trim() || savedViewBusy} onClick={() => void saveCurrentView()} busy={savedViewBusy}>保存する</Button>
              <Button type="button" onClick={() => setSavedViewOpen(false)}>閉じる</Button>
            </div>
          )}
          {savedViewError && (
            <p role="alert" className={styles.folderNote}>
              {savedViewError}
              <button type="button" onClick={() => setSavedViewsSeq((n) => n + 1)} className="text-action ml-2 font-semibold hover:underline">
                もう一度
              </button>
            </p>
          )}

          {/* 2段目：状態の札（件数つき）。板が狭いときは選ぶ欄。右は表示件数・並び順。 */}
          <div className={styles.filterRow}>
            <div className={styles.chips} role="group" aria-label="状態で絞る">
              {STATUS_CHIPS.map((chip) => {
                const count = chipCount(statusCounts, chip.key)
                return (
                  <button
                    key={chip.key}
                    type="button"
                    className={styles.chip}
                    data-selected={statusFilter === chip.key}
                    aria-pressed={statusFilter === chip.key}
                    onClick={() => setStatusFilter(chip.key)}
                  >
                    <chip.icon size={13} aria-hidden="true" />
                    {chip.label}
                    {count == null ? null : <span className={styles.chipCount}>{count}</span>}
                  </button>
                )
              })}
            </div>
            <div className={styles.statusSelectWrap}>
              <Select
                aria-label="状態で絞る"
                value={statusFilter}
                onChange={(value) => setStatusFilter(value as StatusChipKey)}
                options={STATUS_CHIPS.map((chip) => ({
                  value: chip.key,
                  label: `${chip.label}${chipCount(statusCounts, chip.key) == null ? '' : `（${chipCount(statusCounts, chip.key)}）`}`,
                }))}
              />
            </div>
            <div className={styles.filterRight}>
              <Select
                aria-label="表示件数"
                size="page-size"
                value={String(pageSize)}
                onChange={(value) => setPageSize(Number(value) || 20)}
                options={[
                  { value: '20', label: '20件表示' },
                  { value: '50', label: '50件表示' },
                  { value: '100', label: '100件表示' },
                ]}
              />
              <Select
                aria-label="並び順"
                value={sortKey}
                onChange={(value) => setSortKey(value === 'oldest' ? 'oldest' : 'newest')}
                options={[
                  { value: 'newest', label: '新しい順' },
                  { value: 'oldest', label: '古い順' },
                ]}
              />
            </div>
          </div>

          {showCreate && (
            <BroadcastForm
              tags={tags}
              onSuccess={() => { setShowCreate(false); void load(); void loadFolders() }}
              onDraftSaved={() => { void load(); void loadFolders() }}
              onCancel={() => setShowCreate(false)}
              openTemplatePickerInitially={openTemplatePicker}
            />
          )}

          {loading ? (
            <div className={styles.skeletonRows} role="status">
              <span className="sr-only">読み込んでいます</span>
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className={styles.skeletonRow}>
                  <span className={styles.skeletonDot} />
                  <span className={styles.skeletonBar} />
                  <span className={styles.skeletonBar} style={{ maxWidth: 120 }} />
                  <span className={styles.skeletonBar} style={{ maxWidth: 160 }} />
                </div>
              ))}
            </div>
          ) : forbidden ? (
            <div className={styles.stateCard}>
              <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
                <AlertCircle size={20} aria-hidden="true" />
              </span>
              <p className={styles.stateTitle}>配信を見る権限がありません</p>
              <p className={styles.stateDesc}>見るには権限が要ります。オーナーか管理者に追加を依頼してください。</p>
            </div>
          ) : error ? (
            <div className={styles.stateCard}>
              <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
                <AlertCircle size={20} aria-hidden="true" />
              </span>
              <p className={styles.stateTitle}>一斉配信を読み込めませんでした</p>
              <Button type="button" onClick={() => void load((page - 1) * pageSize)}>もう一度試す</Button>
            </div>
          ) : visibleBroadcasts.length === 0 ? (
            filterActive ? (
              <div className={styles.stateCard}>
                <p className={styles.stateTitle}>条件に合う配信はありません</p>
                <p className={styles.stateDesc}>「予約中のみ」「下書き」や配信日を外すと、すべて出ます。</p>
                <Button type="button" onClick={clearFilters}>条件を外す</Button>
              </div>
            ) : (
              <div className={styles.stateCard}>
                <span className={styles.stateIcon}>
                  <Send size={20} aria-hidden="true" />
                </span>
                <p className={styles.stateTitle}>まだ一斉配信はありません</p>
                <p className={styles.stateDesc}>友だちにまとめてお知らせを送れます。</p>
                <Button type="button" variant="primary" disabled={!canEdit} onClick={() => { setOpenTemplatePicker(false); setShowCreate(true) }}>
                  ＋ 配信を作る
                </Button>
              </div>
            )
          ) : (
            <>
              <div className={styles.tableWrap} data-content-in="">
                <table className={styles.table}>
                  <thead>
                    <TableHeadRow>
                      <Th>タイトル・内容</Th>
                      <Th>状態</Th>
                      <Th className={styles.audienceCol}>配信条件</Th>
                      <Th>配信日時</Th>
                      <Th>結果</Th>
                      <Th className={styles.menuCell}><span className="sr-only">操作</span></Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {visibleBroadcasts.map((broadcast) => {
                      const approvalDuplicatesStatus = (broadcast.displayStatus === 'pending_approval' && broadcast.approvalStatus === 'pending')
                        || (broadcast.displayStatus === 'expired' && broadcast.approvalStatus === 'expired')
                      const insight = insights[broadcast.id] ?? summaryInsight(broadcast.insightSummary)
                      const audience = audienceSummary(broadcast, getTagName, getScenarioName)
                      const detailHref = `/broadcasts/detail?id=${encodeURIComponent(broadcast.id)}`
                      return (
                        <tr
                          key={broadcast.id}
                          className={styles.rowClick}
                          tabIndex={0}
                          onClick={() => router.push(detailHref)}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              router.push(detailHref)
                            }
                          }}
                        >
                          <td>
                            {/* 長いタイトルは1行で …、全文は title で。 */}
                            <Link
                              href={detailHref}
                              className={styles.cellTitle}
                              title={broadcast.title}
                              onClick={(event) => event.stopPropagation()}
                            >
                              {broadcast.title}
                            </Link>
                            <p className={styles.cellSub}>{rowExcerpt(broadcast.messageType, broadcast.messageContent)}</p>
                            <p className={styles.cellAudience} title={audience}>{audience}</p>
                          </td>
                          <td className={styles.statusCell}>
                            {approvalDuplicatesStatus
                              ? <ApprovalBadge status={broadcast.approvalStatus} />
                              : statusBadge(broadcast)}
                          </td>
                          <td className={styles.audienceCol}>
                            <span className={styles.audienceText} title={audience}>{audience}</span>
                          </td>
                          <td className="text-ink-faint tabular-nums whitespace-nowrap">
                            {broadcast.status === 'sent'
                              ? (broadcast.sentAt ? formatDateTime(broadcast.sentAt) : '—')
                              : (broadcast.scheduledAt ? formatDateTime(broadcast.scheduledAt) : '未設定')}
                            {/*
                              予約は「予約」の2行目（絵 `l5V9a`）。
                              下書きの「◯日 更新」は broadcasts 表に updated_at が
                              無いので出せない（API が来るまで出さない決まり）。
                            */}
                            {broadcast.status === 'scheduled' && broadcast.scheduledAt ? (
                              <span className={styles.dateSecond}>予約</span>
                            ) : null}
                          </td>
                          <td>
                            {broadcast.status !== 'sent' ? (
                              <span className="text-ink-faint">—</span>
                            ) : (
                              <>
                                <span className={styles.resultMain}>
                                  {formatNumber(insight?.delivered ?? broadcast.successCount)}人に届いた
                                </span>
                                {insight && (insight.openRate != null || insight.clickRate != null) ? (
                                  <p className={styles.resultSub}>
                                    {insight.openRate != null ? `開封 ${(insight.openRate * 100).toFixed(1)}%` : ''}
                                    {insight.openRate != null && insight.clickRate != null ? '・' : ''}
                                    {insight.clickRate != null ? `クリック ${(insight.clickRate * 100).toFixed(1)}%` : ''}
                                  </p>
                                ) : null}
                              </>
                            )}
                          </td>
                          <td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className={styles.menuButton}
                              aria-label={`配信「${broadcast.title}」の操作`}
                              aria-haspopup="menu"
                              aria-expanded={openMenuId === broadcast.id}
                              title={`配信「${broadcast.title}」の操作`}
                              onClick={() => {
                                setMenuMoveFor(null)
                                setOpenMenuId((current) => (current === broadcast.id ? null : broadcast.id))
                              }}
                            >
                              <MoreHorizontal size={16} aria-hidden="true" />
                            </button>
                            <ActionMenu
                              open={openMenuId === broadcast.id}
                              onClose={() => { setOpenMenuId(null); setMenuMoveFor(null) }}
                              ariaLabel={`配信「${broadcast.title}」の操作`}
                              items={rowMenuItems(broadcast)}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* 件数とページ送り。1ページしか無いときは件数だけ出す。 */}
              <div className={styles.pagerRow}>
                <span className={styles.pagerCount}>
                  {(listTotal ?? visibleBroadcasts.length)}件中 {rangeFirst}〜{rangeLast}件
                </span>
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  onPageChange={goPage}
                  ariaLabel="一斉配信のページ送り"
                  disabled={moving}
                />
              </div>
            </>
          )}
        </div>
      </div>

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
    </div>
  )
}
