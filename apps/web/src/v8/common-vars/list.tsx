'use client'

/*
 * ★V8 共通情報の一覧（Pencil「★V8 画面の地図」の共通情報の行：
 * 一覧 `FM94M`、一覧（1152）`XIzkJ`、一覧（閲覧のみ）`OxSw8`、
 * 止める窓 `Hhl9M`、削除の窓 `xxKtW`、状態 `RqO7O`）。
 *
 * 一覧の型（ListPage）に載せて一から書いた。動き（読む API・権限・失敗時・
 * 止める／削除の確かめ方・まとめて削除・フォルダ）は今の V8 一覧
 * （app/contents/vars/list-v8.tsx）と同じ。違いは置き場と見せ方だけ——
 * 数の帯は板の横いっぱい、「共通情報を作る」は左のフォルダの列の上、
 * 空のまま使われているときの黄色の帯は表の列の上、行の右端は「…」
 * （編集・止める／再開する・削除する）。右クリックでも同じものが出る。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Archive,
  ArrowRight,
  ArrowUpDown,
  Braces,
  CalendarClock,
  CalendarX,
  Check,
  CircleDashed,
  Copy,
  Eye,
  FolderCog,
  Link2,
  Lock,
  MoreHorizontal,
  Pause,
  Plus,
  Search as SearchIcon,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { CommonVar, CommonVarDeleteImpact, Folder } from '@line-crm/shared'
import {
  api,
  ApiError,
  type CommonVarReplacementCandidate,
  type CommonVarReplacementImpact,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { clampSearchQuery } from '@/lib/search-query'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { ListPage } from '@/components/templates'
import ListToolbar from '@/components/shared/list-toolbar'
import SearchField from '@/components/shared/search-field'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Pagination from '@/components/shared/pagination'
import DetailPanel, { useDetailPanelUrl } from '@/components/shared/detail-panel'
import InlineEdit from '@/components/shared/inline-edit'
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { withViewTransition } from '@/components/shared/view-transition'
import Select from '@/components/shared/select'
import HelpTip from '@/components/shared/help-tip'
import { DataTable, TableHeadRow, Th, Tr, Td, NameCell } from '@/components/shared/table'
import { FolderDotName, type FolderDotFolder } from '@/components/shared/folder-dot'
import { classifyApiFailure, isForbidden } from '@/components/shared/api-error-message'
import { COMMON_VAR_STATE_LABELS, formatStamp } from '@/lib/common-vars'
import { formatDay, formatNumber } from '@/lib/format'
import {
  blockedReason,
  canDelete as canDeleteVar,
  checkedAtText,
  consequenceText,
  filterAndSortCommonVars,
  placeholderText,
  splitItems,
  unavailableText,
  usageText,
  type CommonVarFilter,
  type CommonVarOrder,
} from './model'
import VarsExportPanel from './export-panel'
import styles from './list.module.css'

/** 「未分類」を表す絞り込みの値。空文字だと「すべて」と区別できない。 */
const UNGROUPED = '__ungrouped__'

/*
 * 一括削除の上限。1件ごとに使用先9種の走査が走るため、
 * 件数に比例してWorker・D1が重くなる。上限を超えたら確認口を打たず、
 * 絞り込みで分けるよう案内する。
 */
const MAX_BATCH_DELETE_COUNT = 20

/** 期限が近い帯の幅。7日以内に期限切れになるものを数える。 */
const EXPIRING_SOON_MS = 7 * 24 * 3600_000


/*
 * 道具の段の絞り込み（板 `FM94M`：空のまま・期限つき・使われていない・
 * 下書き・止めた）。1つだけ選べる。選んだ札をもう一度押すと「すべて」に戻る。
 * 期限切れは絵に無いが今の機能なので、期限切れがあるとき（選んでいるとき）だけ出す。
 */
type VarsChip = 'all' | 'empty' | 'scheduled' | 'unused' | 'draftStopped' | 'expired'

const CHIP_FILTER: Record<VarsChip, CommonVarFilter> = {
  all: 'all',
  empty: 'empty',
  scheduled: 'scheduled',
  unused: 'unused',
  draftStopped: 'all',
  expired: 'expired',
}

const ORDER_OPTIONS: Array<{ value: CommonVarOrder; label: string }> = [
  { value: 'usage_desc', label: '使われている数が多い順' },
  { value: 'updated_desc', label: '更新が新しい順' },
  { value: 'name_asc', label: '名前順' },
]

/** 表示件数（絵：10・20・50件）。 */
const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10件表示' },
  { value: '20', label: '20件表示' },
  { value: '50', label: '50件表示' },
]

/*
 * 一覧の更新日は、次回変更と同じセルに収まる短い形で出す（v7 と同じ）。
 * 更新日は UTC の ISO で来るので JST 固定で出す。
 */
function formatListDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return formatDay(date)
}

/** 「10/7まで」の札の日付。年月は要らず、月日だけ出す。 */
function formatMonthDay(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getMonth() + 1}/${date.getDate()}まで`
}

/*
 * 種別が年月日・日時の値は、保存形（2027-10-01 や 2027-10-01T10:00）を
 * そのまま出すと一覧のほかの日付と区切りが違って見える。
 * `formatStamp` の「/」区切り（曜日付き）にそろえる。
 */
function formatVarValue(type: CommonVar['type'], value: string): string {
  if (!value) return ''
  if (type === 'date' || type === 'datetime') return formatStamp(value)
  return value
}

/** 札の文言と色。期限つきの使用中は「M/dまで」を青で出す（板 `FM94M`）。 */
function stateBadge(item: CommonVar): { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' } {
  const state = item.state ?? 'active'
  if (state === 'active' && item.validUntil) {
    return { label: formatMonthDay(item.validUntil), tone: 'info' }
  }
  return {
    label: COMMON_VAR_STATE_LABELS[state] ?? '使用中',
    tone: state === 'active' ? 'success' : state === 'expired' ? 'warning' : 'neutral',
  }
}

/** 差し込み名の右のコピーの印（絵：キーの横の小さな印）。押すと印が「✓」に変わる。 */
function CopyKeyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setState('idle'), 1500)
  }
  return (
    <button
      type="button"
      className={styles.copyKey}
      data-state={state}
      aria-label={label}
      title={state === 'copied' ? 'コピーしました' : state === 'failed' ? 'コピーできませんでした。文字を選んでコピーしてください' : 'コピー'}
      onClick={(event) => {
        event.stopPropagation()
        void copy()
      }}
    >
      {state === 'copied' ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
    </button>
  )
}

function CommonVarsListInner() {
  usePageTitle('共通情報')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const router = useRouter()
  const params = useSearchParams()
  /* 1152 の板（`XIzkJ`）。フォルダの列は型が畳み、道具の段を2段にする。 */
  const narrow = useNarrowViewport()

  /*
   * 書き込みの口（作成・更新・削除・状態切替・フォルダ操作）は
   * `requireRole('owner', 'admin')` で閉じている。staff へ操作を見せると
   * 押しても 403 になるだけなので、閲覧のみの帯を出して押せない形にする
   * （板 `OxSw8`）。一覧・CSVで書き出す・差し込み名のコピーは使える。
   * 役割はサーバ（/api/staff/me）で確かめ、答えが来るまでは手元の値で決める。
   */
  const [localCanWrite] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())
  const staffRole = useStaffRole()
  const canWrite = staffRole === null ? localCanWrite : canManageRole(staffRole)

  const [items, setItems] = useState<CommonVar[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [listFailure, setListFailure] = useState<unknown>(null)
  const [folderFailure, setFolderFailure] = useState<unknown>(null)
  const [folderReloading, setFolderReloading] = useState(false)
  const [listLimited, setListLimited] = useState(false)

  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [chip, setChip] = useState<VarsChip>('all')
  const [order, setOrder] = useState<CommonVarOrder>('usage_desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [orderMenuOpen, setOrderMenuOpen] = useState(false)
  const orderAnchorRef = useRef<HTMLButtonElement | null>(null)
  const [folderMenuOpen, setFolderMenuOpen] = useState(false)
  const folderMenuAnchorRef = useRef<HTMLButtonElement | null>(null)

  /** 選んでいるフォルダ。URLに出して、戻るとブックマークを壊さない（v7 と同じ `?folder=`）。 */
  const folderFilter = params.get('folder') ?? ''
  const setFolderFilter = (id: string) => {
    setPage(1)
    router.replace(id ? `/contents/vars?folder=${encodeURIComponent(id)}` : '/contents/vars')
  }

  const [addingFolder, setAddingFolder] = useState(false)
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')

  const loadFolders = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setFolders([])
      setUnfiledCount(null)
      setFolderFailure(null)
      return
    }
    setFolderReloading(true)
    setFolderFailure(null)
    try {
      const folderList = await api.folders.list('common_var', accountAtRequest)
      if (accountAtRequest !== latestAccountRef.current) return
      if (folderList.success) {
        setFolders(folderList.data)
        setUnfiledCount(folderList.unfiledCount ?? null)
      } else {
        setFolderFailure(new ApiError(500, folderList.error))
      }
    } catch (caught) {
      if (accountAtRequest === latestAccountRef.current) setFolderFailure(caught)
    } finally {
      if (accountAtRequest === latestAccountRef.current) setFolderReloading(false)
    }
  }, [selectedAccountId])

  const load = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setListFailure(null)
    try {
      const vars = await api.commonVars.list(accountAtRequest)
      if (accountAtRequest !== latestAccountRef.current) return
      if (vars.success) {
        setItems(vars.data)
        setListLimited(vars.meta?.limited ?? false)
      } else {
        setListFailure(new ApiError(500, vars.error))
        setError('読み込みに失敗しました。接続を確かめて、もう一度お試しください。')
      }
    } catch (e) {
      if (accountAtRequest === latestAccountRef.current) {
        setListFailure(e)
        setError(e instanceof ApiError && e.status === 403
          ? 'この一覧を見る権限がありません。管理者に権限を申請してください。'
          : '読み込みに失敗しました。接続を確かめて、もう一度お試しください。')
      }
    } finally {
      if (accountAtRequest === latestAccountRef.current) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
    void loadFolders()
  }, [accountLoading, load, loadFolders])

  useEffect(() => {
    setSelected(new Set())
    setListLimited(false)
  }, [selectedAccountId])

  const baseFiltered = useMemo(
    () => filterAndSortCommonVars(items, {
      query,
      folderId: folderFilter,
      ungroupedValue: UNGROUPED,
      filter: CHIP_FILTER[chip],
      order,
    }),
    [folderFilter, items, order, query, chip],
  )
  /*
   * 「下書き・止めた」は1枚の札にまとめる。絞り込みの共有関数に
   * 触らず、この画面だけで下書きと止めたの和を取る（v7 の動きは変えない）。
   */
  const filtered = useMemo(
    () => chip === 'draftStopped'
      ? baseFiltered.filter((item) => (item.state ?? 'active') === 'draft' || (item.state ?? 'active') === 'stopped')
      : baseFiltered,
    [baseFiltered, chip],
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  )

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  /** 数の帯と黄色の帯の素。取れていない数字は 0 にしない。 */
  const listFailed = listFailure != null
  const stats = useMemo(() => {
    const usageCounts = items.map((item) => item.usageCount)
    const knownUsage = usageCounts.filter((count): count is number => typeof count === 'number')
    return {
      total: items.length,
      draftCount: items.filter((item) => (item.state ?? 'active') === 'draft').length,
      stoppedCount: items.filter((item) => (item.state ?? 'active') === 'stopped').length,
      expiredCount: items.filter((item) => (item.state ?? 'active') === 'expired').length,
      usageTotal: knownUsage.length === 0 && items.length > 0 ? null : knownUsage.reduce((sum, count) => sum + count, 0),
      emptyInUse: items.filter((item) => item.value === '' && typeof item.usageCount === 'number' && item.usageCount > 0),
      expiringSoon: items.filter((item) => {
        if (!item.validUntil || (item.state ?? 'active') === 'expired') return false
        const until = new Date(item.validUntil).getTime()
        if (Number.isNaN(until)) return false
        const rest = until - Date.now()
        return rest > 0 && rest <= EXPIRING_SOON_MS
      }).length,
    }
  }, [items])

  const clearVarFilters = () => {
    setQuery('')
    setFolderFilter('')
    setChip('all')
    setPage(1)
  }

  const applyEmptyFilter = () => {
    setChip('empty')
    setPage(1)
  }

  const toggleChip = (next: VarsChip) => {
    setChip((currentChip) => (currentChip === next ? 'all' : next))
    setPage(1)
  }

  const removeFolder = async () => {
    if (!deletingFolder || !selectedAccountId || folderBusy) return
    const accountAtRequest = selectedAccountId
    setFolderBusy(true)
    setFolderError('')
    try {
      const res = await api.folders.delete(deletingFolder.id, accountAtRequest)
      if (!res.success) throw new Error(res.error)
      if (accountAtRequest !== latestAccountRef.current) return
      setDeletingFolder(null)
      if (folderFilter === deletingFolder.id) setFolderFilter('')
      void load()
      void loadFolders()
    } catch {
      if (accountAtRequest === latestAccountRef.current) setFolderError('フォルダを削除できませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

  /*
   * 止める窓（板 `Hhl9M`）。止めているあいだ、この共通情報を差し込んだ
   * 配信は送られない。あとで再開できる。理由は記録に残すので必須。
   */
  const [statusTarget, setStatusTarget] = useState<CommonVar | null>(null)
  const [statusAction, setStatusAction] = useState<'stop' | 'resume'>('stop')
  const [statusReason, setStatusReason] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState('')
  /* 右から出る詳細パネル。URL に今の行を残す（`?row=`）。 */
  const [activeId, setActiveId] = useDetailPanelUrl('row')
  /* パネルを開いている1件の止める・再開は、窓ではなくパネルの中で聞く。 */
  const [panelStatus, setPanelStatus] = useState(false)
  /* 右クリックされた行（「…」と同じ項目を出す）。 */
  const [contextId, setContextId] = useState<string | null>(null)
  /* 板 `Hhl9M`：予約中の配信があるときだけ出す帯。読めなくても止める操作は止めない。 */
  const [statusScheduled, setStatusScheduled] = useState<CommonVarDeleteImpact['items']>([])

  const openStatusDialog = (item: CommonVar, action: 'stop' | 'resume') => {
    setPanelStatus(item.id === activeId)
    setStatusTarget(item)
    setStatusAction(action)
    setStatusReason('')
    setStatusError('')
    setStatusScheduled([])
    if (action === 'stop' && selectedAccountId) {
      const varId = item.id
      const accountId = selectedAccountId
      void api.commonVars.deleteImpact(varId, accountId)
        .then((res) => {
          if (!res.success) return
          setStatusScheduled(res.data.items.filter((usage) => usage.status === '配信予約中'))
        })
        .catch(() => {
          /* 読めないときは帯を出さない。 */
        })
    }
  }

  const closeStatusDialog = () => {
    if (statusBusy) return
    setStatusTarget(null)
    setStatusReason('')
    setStatusError('')
  }

  const applyStatus = async () => {
    if (!statusTarget || !selectedAccountId || statusBusy) return
    const reason = statusReason.trim()
    if (!reason) {
      setStatusError(statusAction === 'stop' ? '止める理由を入力してください' : '再開する理由を入力してください')
      return
    }
    setStatusBusy(true)
    setStatusError('')
    try {
      const res = await api.commonVars.setStatus(statusTarget.id, selectedAccountId, {
        to: statusAction === 'stop' ? 'stopped' : 'active',
        changeReason: reason,
      })
      if (!res.success) {
        setStatusError(res.error)
        return
      }
      setStatusTarget(null)
      setPanelStatus(false)
      setStatusReason('')
      await load()
    } catch (e) {
      setStatusError(
        e instanceof ApiError && e.status === 409
          ? '別の担当者が先に更新しました。最新内容を読み直してください。'
          : '状態を変えられませんでした。通信を確かめて、もう一度お試しください。',
      )
    } finally {
      setStatusBusy(false)
    }
  }

  /*
   * 削除の窓（板 `xxKtW`）。**窓を開けてから使用先を読む。**
   * 一覧を出すたびに全件ぶん読むと、消さない人にも使用先の走査が走る。
   * 使われているものは「まだ消せません」と言い、差し替えか止めるへ導く。
   * 差し替え・削除・止めるのどれにも理由が要る（版履歴に残すため）。
   */
  const [deleteTarget, setDeleteTarget] = useState<CommonVar | null>(null)
  const [deleteImpact, setDeleteImpact] = useState<CommonVarDeleteImpact | null>(null)
  const [deletePhase, setDeletePhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteChoice, setDeleteChoice] = useState<'replace' | 'stop'>('replace')
  const [replacementCandidates, setReplacementCandidates] = useState<CommonVarReplacementCandidate[]>([])
  const [replacementId, setReplacementId] = useState('')
  const [replacementImpact, setReplacementImpact] = useState<CommonVarReplacementImpact | null>(null)
  const [replacementPhase, setReplacementPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  /** 消した理由・止める理由。差し替え・削除・止めるのどれにも必須。 */
  const [deleteReason, setDeleteReason] = useState('')
  /** 削除の確認のために打ってもらう差し込みキー。 */
  const [typedKey, setTypedKey] = useState('')
  /** 使用先が多いときは畳む（板 `xxKtW` の「ほか 5か所・すべて見る」）。 */
  const [usageExpanded, setUsageExpanded] = useState(false)
  const deleteRequestRef = useRef({ accountId: selectedAccountId, itemId: null as string | null, generation: 0 })

  const openDelete = async (item: CommonVar) => {
    setDeleteTarget(item)
    setTypedKey('')
    setDeleteReason('')
    setDeleteError('')
    setDeleteImpact(null)
    setDeletePhase('loading')
    setDeleteChoice('replace')
    setUsageExpanded(false)
    setReplacementCandidates([])
    setReplacementId('')
    setReplacementImpact(null)
    setReplacementPhase('loading')
    if (!selectedAccountId) {
      setDeletePhase('error')
      setReplacementPhase('error')
      return
    }
    /*
     * 遅れて返った別の共通情報の結果を映さない。Aを読み込み中に窓を
     * 閉じてBを開くと、あとから返るAの結果がBの窓に出る。
     */
    const request = {
      accountId: selectedAccountId,
      itemId: item.id,
      generation: deleteRequestRef.current.generation + 1,
    }
    deleteRequestRef.current = request
    const isCurrentRequest = () =>
      deleteRequestRef.current.accountId === request.accountId &&
      deleteRequestRef.current.itemId === request.itemId &&
      deleteRequestRef.current.generation === request.generation
    const [impactResult, candidatesResult] = await Promise.allSettled([
      api.commonVars.deleteImpact(request.itemId, request.accountId),
      api.commonVars.replacementCandidates(request.itemId, request.accountId),
    ])
    if (!isCurrentRequest()) return
    if (impactResult.status === 'rejected' || !impactResult.value.success) {
      setDeletePhase('error')
      setReplacementPhase('error')
      return
    }
    setDeleteImpact(impactResult.value.data)
    setDeletePhase('ready')
    if (candidatesResult.status === 'rejected' || !candidatesResult.value.success) {
      setReplacementPhase('error')
      return
    }
    setReplacementCandidates(candidatesResult.value.data.candidates)
    const first = candidatesResult.value.data.candidates[0]
    if (!first) {
      setReplacementPhase('ready')
      return
    }
    setReplacementId(first.id)
    try {
      const preview = await api.commonVars.replacementImpact(request.itemId, request.accountId, first.id)
      if (!isCurrentRequest()) return
      if (!preview.success) throw new Error('replacement_impact_failed')
      setReplacementImpact(preview.data)
      setReplacementPhase('ready')
    } catch {
      if (!isCurrentRequest()) return
      setReplacementPhase('error')
    }
  }

  const selectReplacement = async (nextId: string) => {
    if (!deleteTarget || !selectedAccountId) return
    setReplacementId(nextId)
    setReplacementImpact(null)
    if (!nextId) {
      setReplacementPhase('ready')
      return
    }
    const request = {
      accountId: selectedAccountId,
      itemId: deleteTarget.id,
      generation: deleteRequestRef.current.generation + 1,
    }
    deleteRequestRef.current = request
    setReplacementPhase('loading')
    try {
      const res = await api.commonVars.replacementImpact(request.itemId, request.accountId, nextId)
      if (deleteRequestRef.current.generation !== request.generation) return
      if (!res.success) throw new Error('replacement_impact_failed')
      setReplacementImpact(res.data)
      setReplacementPhase('ready')
    } catch {
      if (deleteRequestRef.current.generation === request.generation) setReplacementPhase('error')
    }
  }

  /** 窓の中身を空にする。処理中は `closeDelete` が止めるので、成功時はこっちを使う。 */
  const resetDeleteState = () => {
    deleteRequestRef.current = {
      accountId: selectedAccountId,
      itemId: null,
      generation: deleteRequestRef.current.generation + 1,
    }
    setDeleteTarget(null)
    setDeleteImpact(null)
    setDeletePhase('idle')
    setDeleteError('')
    setTypedKey('')
    setDeleteReason('')
    setDeleteChoice('replace')
    setUsageExpanded(false)
    setReplacementCandidates([])
    setReplacementId('')
    setReplacementImpact(null)
    setReplacementPhase('idle')
    setDeleteBusy(false)
  }

  const closeDelete = () => {
    if (deleteBusy) return
    resetDeleteState()
  }

  const confirmReplacement = async () => {
    if (!deleteTarget || !selectedAccountId || !replacementImpact?.canReplace || deleteBusy) return
    if (!deleteReason.trim()) {
      setDeleteError('消した理由を入力してください。')
      return
    }
    const request = {
      accountId: selectedAccountId,
      itemId: deleteTarget.id,
      generation: deleteRequestRef.current.generation + 1,
    }
    deleteRequestRef.current = request
    setDeleteBusy(true)
    setDeleteError('')
    try {
      const res = await api.commonVars.replace(request.itemId, request.accountId, {
        replacementId: replacementImpact.replacement.id,
        expectedVersion: replacementImpact.source.version,
        expectedRevision: replacementImpact.revision,
        changeReason: deleteReason.trim(),
      })
      if (deleteRequestRef.current.generation !== request.generation) return
      if (!res.success) throw new Error('replace_failed')
      resetDeleteState()
      await load()
    } catch (caught) {
      if (deleteRequestRef.current.generation !== request.generation) return
      if (caught instanceof ApiError && caught.status === 409) {
        setDeleteError('使用先が変わりました。影響をもう一度確認してください。')
        await selectReplacement(replacementImpact.replacement.id)
      } else {
        setDeleteError('差し替えを完了できませんでした。状態を読み直して、もう一度お試しください。')
      }
    } finally {
      if (deleteRequestRef.current.generation === request.generation) setDeleteBusy(false)
    }
  }

  const confirmDirectDelete = async () => {
    if (!deleteTarget || !selectedAccountId || deleteBusy) return
    const request = {
      accountId: selectedAccountId,
      itemId: deleteTarget.id,
      generation: deleteRequestRef.current.generation + 1,
    }
    deleteRequestRef.current = request
    const isCurrentRequest = () =>
      deleteRequestRef.current.accountId === request.accountId &&
      deleteRequestRef.current.itemId === request.itemId &&
      deleteRequestRef.current.generation === request.generation
    setDeleteBusy(true)
    setDeleteError('')
    try {
      const res = await api.commonVars.delete(request.itemId, request.accountId, deleteReason.trim())
      if (!isCurrentRequest()) return
      if (!res.success) throw new Error('delete_failed')
      resetDeleteState()
      await load()
    } catch (e) {
      if (!isCurrentRequest()) return
      if (e instanceof ApiError && e.status === 409) {
        setDeleteError('いま使われ始めたため、削除できませんでした。使用先を読み直しました。')
        try {
          const again = await api.commonVars.deleteImpact(request.itemId, request.accountId)
          if (!isCurrentRequest()) return
          if (again.success) setDeleteImpact(again.data)
        } catch {
          if (isCurrentRequest()) setDeletePhase('error')
        }
        return
      }
      setDeleteError('削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      if (isCurrentRequest()) setDeleteBusy(false)
    }
  }

  /** 「消さずに止める」を選んだとき。理由を止める理由として使う。 */
  const confirmStopInstead = async () => {
    if (!deleteTarget || !selectedAccountId || deleteBusy) return
    if (!deleteReason.trim()) {
      setDeleteError('止める理由を入力してください。')
      return
    }
    setDeleteBusy(true)
    setDeleteError('')
    try {
      const res = await api.commonVars.setStatus(deleteTarget.id, selectedAccountId, {
        to: 'stopped',
        changeReason: deleteReason.trim(),
      })
      if (!res.success) {
        setDeleteError(res.error)
        return
      }
      resetDeleteState()
      await load()
    } catch {
      setDeleteError('止められませんでした。通信を確かめて、もう一度お試しください。')
    } finally {
      setDeleteBusy(false)
    }
  }

  /*
   * まとめて削除。使う前に使用先を確かめ、使われているものが混ざって
   * いたら止める（v7 と同じ守り）。理由は版履歴に残すので必須。
   */
  const [deleteTargets, setDeleteTargets] = useState<CommonVar[]>([])
  const [batchReason, setBatchReason] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteBatchError, setDeleteBatchError] = useState('')
  const batchRequestRef = useRef({ accountId: selectedAccountId, generation: 0 })

  /* 行の「…」の中身。右クリックでも同じものを出す。 */
  const rowMenuItems = (item: CommonVar): ActionMenuItem[] => {
    const stopped = (item.status ?? 'active') === 'stopped'
    // 閲覧のみには押せない項目を置かない（2026-10-06 オーナー決定）。この「…」は変える項目だけなので空になる。
    if (!canWrite) return []
    return [
      {
        id: 'edit',
        label: '編集',
        onSelect: () => withViewTransition(() => router.push(`/contents/vars/edit?id=${item.id}`)),
      },
      stopped ? {
        id: 'resume',
        label: '再開する',
        onSelect: () => openStatusDialog(item, 'resume'),
      } : {
        id: 'stop',
        label: '止める',
        icon: <Pause size={14} aria-hidden="true" />,
        onSelect: () => openStatusDialog(item, 'stop'),
      },
      {
        id: 'delete',
        label: '削除する',
        tone: 'danger',
        dividerBefore: true,
        onSelect: () => void openDelete(item),
      },
    ]
  }

  /* 右から出る詳細パネルの今の行。 */
  const activeItem = activeId ? (items.find((v) => v.id === activeId) ?? null) : null
  const activeIndex = activeItem ? current.findIndex((v) => v.id === activeItem.id) : -1
  const activeStopped = (activeItem?.status ?? 'active') === 'stopped'

  /* 名前のその場の書き換え。Enter で保存・Esc でやめる。 */
  const renameVar = async (item: CommonVar, next: string) => {
    const accountId = selectedAccountId
    if (!accountId) return
    const name = next.trim()
    if (!name || name === item.name) return
    const res = await api.commonVars.update(item.id, accountId, { name })
    if (!res.success) throw new Error(res.error ?? 'rename_failed')
    setItems((rows) => rows.map((v) => (v.id === item.id ? { ...v, name } : v)))
  }

  /* 右クリックは「…」と同じ項目。消す操作は赤くする。 */
  const contextItem = contextId ? (items.find((v) => v.id === contextId) ?? null) : null
  const contextMenuItems: ContextMenuItem[] = contextItem
    ? rowMenuItems(contextItem).map((entry) => ({
      id: entry.id,
      label: entry.label,
      danger: entry.tone === 'danger',
      disabled: entry.disabled,
      onSelect: () => entry.onSelect(),
    }))
    : []

  const prepareRemoveSelected = async () => {
    if (selected.size === 0 || !selectedAccountId) return
    if (selected.size > MAX_BATCH_DELETE_COUNT) {
      setError(`一度に削除できるのは${MAX_BATCH_DELETE_COUNT}件までです。フォルダや検索で絞り込んで分けて削除してください。`)
      return
    }
    const request = {
      accountId: selectedAccountId,
      generation: batchRequestRef.current.generation + 1,
    }
    batchRequestRef.current = request
    const isCurrentRequest = () =>
      batchRequestRef.current.accountId === request.accountId &&
      batchRequestRef.current.generation === request.generation
    setError('')
    setDeleteBatchError('')
    try {
      const impacts = await Promise.all(
        [...selected].map(async (id) => {
          const response = await api.commonVars.deleteImpact(id, request.accountId)
          if (!response.success) throw new Error(response.error)
          return { id, impact: response.data }
        }),
      )
      if (!isCurrentRequest()) return
      const blocked = impacts.filter(({ impact }) => !impact.canDelete)
      if (blocked.length > 0) {
        const references = blocked.reduce((sum, { impact }) => sum + impact.total, 0)
        setError(`${blocked.length}件は、合計${references}か所で使用中のため削除できません。`)
        return
      }
    } catch {
      if (!isCurrentRequest()) return
      setError('使用先を確認できないため削除できません。もう一度お試しください。')
      return
    }

    if (!isCurrentRequest()) return
    const targets = items.filter((item) => selected.has(item.id))
    if (targets.length !== selected.size) {
      setError('選択した共通情報を確認できませんでした。状態を読み直してから、もう一度お試しください。')
      return
    }
    setBatchReason('')
    setDeleteTargets(targets)
  }

  const removeSelected = async () => {
    if (deleteTargets.length === 0 || !selectedAccountId || deleting) return
    if (!batchReason.trim()) {
      setDeleteBatchError('消した理由を入力してください。')
      return
    }
    const request = {
      accountId: selectedAccountId,
      generation: batchRequestRef.current.generation + 1,
    }
    batchRequestRef.current = request
    const isCurrentRequest = () =>
      batchRequestRef.current.accountId === request.accountId &&
      batchRequestRef.current.generation === request.generation
    const targets = [...deleteTargets]
    setDeleting(true)
    setDeleteBatchError('')
    const failed: CommonVar[] = []
    for (const target of targets) {
      try {
        const result = await api.commonVars.delete(target.id, request.accountId, batchReason.trim())
        if (!result.success) throw new Error(result.error)
      } catch {
        failed.push(target)
      }
      if (!isCurrentRequest()) return
    }

    try {
      if (!isCurrentRequest()) return
      if (failed.length > 0) {
        setDeleteTargets(failed)
        setSelected(new Set(failed.map((item) => item.id)))
        setDeleteBatchError(
          failed.length === targets.length
            ? '選択した共通情報を削除できませんでした。状態を読み直してから、もう一度お試しください。'
            : `${failed.length}件の共通情報を削除できませんでした。削除できなかったものだけを残しています。`,
        )
        await load()
        return
      }

      setDeleteTargets([])
      setBatchReason('')
      setSelected(new Set())
      await load()
    } finally {
      if (isCurrentRequest()) setDeleting(false)
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allOnPageSelected = current.length > 0 && current.every((item) => selected.has(item.id))
  const someOnPageSelected = current.some((item) => selected.has(item.id))

  /* ===== フォルダの列 ===== */
  const folderForbidden = folderFailure != null && classifyApiFailure(folderFailure) === 'forbidden'
  const folderFailureNote = folderFailure ? (
    <div role="alert" className={styles.folderAlert}>
      <p className={styles.folderNote}>
        {folderForbidden
          ? 'フォルダを見る権限がありません。オーナーか管理者に追加を依頼してください。'
          : 'フォルダを読み込めませんでした。登録した共通情報は消えていません。'}
      </p>
      {folderForbidden ? null : (
        <Button type="button" onClick={() => void loadFolders()} disabled={folderReloading}>
          {folderReloading ? '読み込んでいます' : 'もう一度読み込む'}
        </Button>
      )}
    </div>
  ) : null

  /* 行の名前の前の丸は、左のフォルダの列と同じフォルダ（同じ色）を引く。未分類は色の無い輪。 */
  const folderDotOf = (row: { folderId: string | null }): FolderDotFolder | null => {
    if (!row.folderId) return null
    const folder = folders.find((f) => f.id === row.folderId)
    return folder ? { name: folder.name, color: folder.color } : null
  }
  /* 並びは絵どおり：すべて → 作ったフォルダ → 未分類（最後）。 */
  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: listFailed ? null : items.length },
    ...folders.map((folder) => ({
      id: folder.id,
      label: folder.name,
      count: folder.itemCount ?? null,
      color: folder.color,
      onEdit: canWrite ? () => setEditingFolder(folder) : undefined,
      onDelete: canWrite ? () => { setFolderError(''); setDeletingFolder(folder) } : undefined,
      deleteNote: '削除しても、入っていた共通情報は未分類として残ります。',
    })),
    { id: UNGROUPED, label: '未分類', count: unfiledCount },
  ]
  const folderOptions = [
    { value: '', label: 'フォルダ：すべて' },
    ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
    { value: UNGROUPED, label: '未分類' },
  ]
  const selectedUserFolder = folders.find((folder) => folder.id === folderFilter) ?? null

  /* 閲覧のみには押せない作るボタンを置かない（2026-10-06 オーナー決定）。 */
  const createButton = (full: boolean) => canWrite ? (
    <Button href="/contents/vars/new" variant="primary" className={full ? 'v8-folder-create w-full' : undefined}>
      <Plus size={15} aria-hidden="true" />共通情報を作る
    </Button>
  ) : null

  const folderPanel = (
    <FolderPanel
      activeId={folderFilter}
      onSelect={setFolderFilter}
      onAddFolder={canWrite ? () => setAddingFolder(true) : undefined}
      addFolderLabel="フォルダを追加"
      rows={folderRows}
    >
      {folderFailureNote}
      {folderError ? <p role="alert" className={styles.folderNote}>{folderError}</p> : null}
      {/* 絵は字の途中で折る（言葉のまとまりで折ると3行目に落ちる）。 */}
      <p className={styles.folderNote}><span className={styles.breakAnywhere}>フォルダを消しても、中の共通情報は未分類に残ります</span></p>
    </FolderPanel>
  )

  /* ===== 道具の段（広い板と 1152 で同じ部品を並べ替える） ===== */
  const onSearch = (value: string) => {
    setQuery(clampSearchQuery(value))
    setPage(1)
  }
  const showExpiredChip = chip === 'expired' || stats.expiredCount > 0
  const filterChips = (
    <div role="group" aria-label="状態で絞り込む" className={styles.chipGroup}>
      <FilterChip selected={chip === 'empty'} onChange={() => toggleChip('empty')} title="中身が空のもの" icon={<CircleDashed size={13} aria-hidden="true" />}>
        空のまま
      </FilterChip>
      <FilterChip selected={chip === 'scheduled'} onChange={() => toggleChip('scheduled')} title="有効期間か、決めた日の切り替えがあるもの" icon={<CalendarClock size={13} aria-hidden="true" />}>
        期限つき
      </FilterChip>
      <FilterChip selected={chip === 'unused'} onChange={() => toggleChip('unused')} title="どこにも差し込まれていないもの" icon={<Archive size={13} aria-hidden="true" />}>
        使われていない
      </FilterChip>
      <FilterChip selected={chip === 'draftStopped'} onChange={() => toggleChip('draftStopped')} title="下書きと、止めているもの" icon={<Pause size={13} aria-hidden="true" />}>
        下書き・止めた
      </FilterChip>
      {showExpiredChip ? (
        <FilterChip selected={chip === 'expired'} onChange={() => toggleChip('expired')} title="期限が切れたもの" icon={<CalendarX size={13} aria-hidden="true" />}>
          期限切れ
        </FilterChip>
      ) : null}
    </div>
  )
  /* 並び替え：絵に無いが今の機能。場所を取らないよう印だけのボタン＋メニュー。 */
  const orderLabel = ORDER_OPTIONS.find((option) => option.value === order)?.label ?? ''
  const orderBox = (
    <>
      <IconButton
        title={`並び替え：${orderLabel}`}
        aria-label={`並び替え：${orderLabel}`}
        aria-haspopup="menu"
        aria-expanded={orderMenuOpen}
        onClick={(event) => {
          orderAnchorRef.current = event.currentTarget
          setOrderMenuOpen((open) => !open)
        }}
      >
        <ArrowUpDown size={15} aria-hidden="true" />
      </IconButton>
      <ActionMenu
        open={orderMenuOpen}
        onClose={() => setOrderMenuOpen(false)}
        anchorRef={orderAnchorRef}
        ariaLabel="並び替え"
        items={ORDER_OPTIONS.map((option) => ({
          id: option.value,
          label: option.value === order ? `${option.label}（いまの並び）` : option.label,
          onSelect: () => {
            setOrderMenuOpen(false)
            setOrder(option.value)
            setPage(1)
          },
        }))}
      />
    </>
  )
  const perPageBox = (
    <div className={styles.perPageBox}>
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

  /*
   * 1152 の板（`XIzkJ`）：1段目「作る・フォルダ・探す … 件数」、2段目「札」。
   * フォルダの追加・名前変更・削除は、縦の列が無いぶん、フォルダの印のメニューから。
   */
  const narrowToolbar = (
    <div className={styles.narrowTools}>
      <div className={styles.narrowRow}>
        {createButton(false)}
        <div className={styles.narrowFolder}>
          <Select
            aria-label="フォルダ"
            value={folderFilter}
            onChange={(value) => setFolderFilter(value)}
            options={folderOptions}
          />
        </div>
        <div className={styles.narrowSearch}>
          <SearchField
            aria-label="共通情報を検索"
            placeholder="名前・差し込み名・中身"
            value={query}
            onChange={onSearch}
            onClear={() => onSearch('')}
          />
        </div>
        {canWrite ? (
          <>
            <IconButton
              title="フォルダの操作"
              aria-label="フォルダの操作"
              aria-haspopup="menu"
              aria-expanded={folderMenuOpen}
              onClick={(event) => {
                folderMenuAnchorRef.current = event.currentTarget
                setFolderMenuOpen((open) => !open)
              }}
            >
              <FolderCog size={15} aria-hidden="true" />
            </IconButton>
            <ActionMenu
              open={folderMenuOpen}
              onClose={() => setFolderMenuOpen(false)}
              anchorRef={folderMenuAnchorRef}
              ariaLabel="フォルダの操作"
              items={[
                { id: 'add', label: 'フォルダを追加する', onSelect: () => { setFolderMenuOpen(false); setAddingFolder(true) } },
                ...(selectedUserFolder ? [
                  { id: 'rename', label: 'フォルダ名を変える', onSelect: () => { setFolderMenuOpen(false); setEditingFolder(selectedUserFolder) } },
                  {
                    id: 'delete',
                    label: 'フォルダを削除する',
                    tone: 'danger' as const,
                    dividerBefore: true,
                    onSelect: () => { setFolderMenuOpen(false); setFolderError(''); setDeletingFolder(selectedUserFolder) },
                  },
                ] : []),
              ]}
            />
          </>
        ) : null}
        <span className={styles.spacer} aria-hidden="true" />
        {orderBox}
        {perPageBox}
      </div>
      <div className={styles.narrowRow}>{filterChips}</div>
    </div>
  )

  const wideToolbar = (
    <div className={styles.wideTools}>
      <ListToolbar
        search={{
          placeholder: '名前・差し込み名・中身',
          label: '共通情報を検索',
          value: query,
          onChange: onSearch,
        }}
        filters={filterChips}
        trailing={<>{orderBox}{perPageBox}</>}
      />
    </div>
  )

  /* 空のまま使われているときの黄色の帯（絵：表の列の上・道具の段の上）。 */
  const firstEmpty = stats.emptyInUse[0] ?? null
  const alerts = (
    <>
      {firstEmpty && !listFailed ? (
        <div className={styles.alertBand} role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <span className={styles.alertText}>
            {`「${firstEmpty.name}」が空のまま ${typeof firstEmpty.usageCount === 'number' ? `${formatNumber(firstEmpty.usageCount)}か所` : '何か所か'}で使われています。差し込んだところが空欄のまま送られます。`}
          </span>
          <span className={styles.alertSpacer} aria-hidden="true" />
          <Button type="button" onClick={applyEmptyFilter}>直す</Button>
        </div>
      ) : null}
      {listLimited && !listFailed ? (
        <div className={styles.alertBand} role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <span className={styles.alertText}>表示は最初の200件までです。フォルダや検索で絞り込んでください。</span>
        </div>
      ) : null}
      {error && !listFailed ? (
        <div className={styles.alertBand} data-tone="danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span className={styles.alertText}>{error}</span>
          <span className={styles.alertSpacer} aria-hidden="true" />
          <IconButton title="閉じる" aria-label="お知らせを閉じる" onClick={() => setError('')}>
            <X size={14} aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}
    </>
  )
  const hasAlerts = Boolean((firstEmpty && !listFailed) || (listLimited && !listFailed) || (error && !listFailed))

  /* ===== 一覧の中身（読込中・読み込めない・空・0件を分ける。状態の板 `RqO7O`） ===== */
  const listBody = accountLoading || (loading && items.length === 0 && !listFailed) ? (
    <div className={styles.skeletonRows} aria-label="読み込み中">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className={styles.skeletonRow} aria-hidden="true">
            <span className={styles.skeletonDot} />
            <span className={styles.skeletonBar} />
            <span className={styles.skeletonBar} />
          </div>
        ))}
    </div>
  ) : !selectedAccountId ? (
    <div className={styles.stateCard}>
      <span className={styles.stateIcon}><Braces size={18} aria-hidden="true" /></span>
      <p className={styles.stateTitle}>LINEアカウントを選択してください</p>
      <p className={styles.stateDesc}>共通情報はLINEアカウントごとに管理します。</p>
    </div>
  ) : listFailed ? (
    isForbidden(listFailure) ? (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}><Lock size={18} aria-hidden="true" /></span>
        <p className={styles.stateTitle}>共通情報を見る権限がありません</p>
        <p className={styles.stateDesc}>オーナーか管理者に、共通情報を見られるよう頼んでください。</p>
        <Button href="/staff" variant="secondary">できることを確かめる</Button>
      </div>
    ) : (
      <div className={styles.stateCard} data-design-node="RqO7O">
        <span className={`${styles.stateIcon} ${styles.stateIconError}`}><TriangleAlert size={18} aria-hidden="true" /></span>
        <p className={styles.stateTitle}>共通情報を読み込めませんでした</p>
        <p className={styles.stateDesc}>{error || '読み込みに失敗しました。接続を確かめて、もう一度お試しください。'}</p>
        <Button type="button" onClick={() => void load()}>もう一度試す</Button>
      </div>
    )
  ) : filtered.length === 0 ? (
    items.length === 0 ? (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}><Braces size={18} aria-hidden="true" /></span>
        <p className={styles.stateTitle}>まだ共通情報はありません</p>
        <p className={styles.stateDesc}>会社名や営業時間を1か所で持つと、変えるときに1回直すだけで済みます。</p>
        {canWrite ? createButton(false) : null}
      </div>
    ) : (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}><SearchIcon size={18} aria-hidden="true" /></span>
        <p className={styles.stateTitle}>条件に合う共通情報はありません</p>
        <p className={styles.stateDesc}>「空のまま」「期限つき」「使われていない」「下書き・止めた」や検索を外すと、すべて出ます</p>
        <Button type="button" variant="secondary" onClick={clearVarFilters}>
          <X size={13} aria-hidden="true" />条件を外す
        </Button>
      </div>
    )
  ) : (
    <>
      <ContextMenu
        label={contextItem ? `共通情報「${contextItem.name}」の操作` : '共通情報の操作'}
        items={contextMenuItems}
        shouldOpen={(event) => canWrite && Boolean((event.target as HTMLElement | null)?.closest?.('tr[data-row-id]'))}
      >
        <div className={styles.tableWrap}>
          <DataTable>
            <colgroup>
              <col className={styles.colSelect} />
              <col />
              <col className={styles.colValue} />
              <col className={styles.colState} />
              {!narrow && <col className={styles.colUsage} />}
              <col className={styles.colMenu} />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th className={styles.selectCell} aria-label="選択">
                  {canWrite ? (
                    <Checkbox
                      checked={allOnPageSelected}
                      indeterminate={!allOnPageSelected && someOnPageSelected}
                      onCheckedChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev)
                          for (const item of current) {
                            if (allOnPageSelected) next.delete(item.id)
                            else next.add(item.id)
                          }
                          return next
                        })
                      }
                      aria-label="このページの共通情報をすべて選ぶ"
                    />
                  ) : null}
                </Th>
                <Th className={styles.headCell}>共通情報（差し込み名）</Th>
                <Th className={styles.headCell}>中身</Th>
                <Th className={styles.headCell}>状態</Th>
                {!narrow && <Th className={styles.headCell}>使っている所</Th>}
                <Th aria-label="操作" />
              </TableHeadRow>
            </thead>
            <tbody>
              {current.map((item) => {
                const badge = stateBadge(item)
                const valueText = formatVarValue(item.type, item.value)
                const pending = item.nextSchedule ?? null
                const updateTitle = `最終更新 ${formatListDate(item.updatedAt)}${!pending ? ' ／ 予定なし' : ` ／ ${formatStamp(pending.effectiveFrom)} に ${formatVarValue(item.type, pending.value) || '（空）'}へ${(item.pendingScheduleCount ?? 0) > 1 ? ` ほか${(item.pendingScheduleCount ?? 1) - 1}件` : ''}`}`
                return (
                  <Tr
                    interactive
                    key={item.id}
                    data-row-id={item.id}
                    className={styles.rowClick}
                    tabIndex={0}
                    title={updateTitle}
                    onClick={() => setActiveId(item.id)}
                    onContextMenuCapture={() => setContextId(item.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        setActiveId(item.id)
                      }
                    }}
                  >
                    <Td className={styles.selectCell} onClick={(event) => event.stopPropagation()}>
                      {canWrite ? (
                        <Checkbox
                          checked={selected.has(item.id)}
                          onCheckedChange={() => toggle(item.id)}
                          aria-label={`${item.name}を選ぶ`}
                        />
                      ) : null}
                    </Td>
                    <NameCell
                      name={
                        <div className={styles.dotLine}>
                          <FolderDotName folder={folderDotOf(item)} dot={!narrow}>
                            <Link
                              href={`/contents/vars/edit?id=${item.id}`}
                              title={item.name}
                              className={styles.nameLink}
                              onClick={(event) => event.stopPropagation()}
                            >
                              {item.name}
                            </Link>
                          </FolderDotName>
                        </div>
                      }
                      sub={
                        <span className={narrow ? styles.keyRow : `${styles.keyRow} ${styles.dotIndent}`}>
                          <code title={placeholderText(item.varKey)} className={styles.keyCode}>
                            {placeholderText(item.varKey)}
                          </code>
                          <CopyKeyButton value={placeholderText(item.varKey)} label={`${item.name}の差し込みキーをコピー`} />
                        </span>
                      }
                    />
                    <Td className={styles.valueCell} title={valueText || '（空）'}>
                      {valueText || <span className={styles.valueEmpty}>（空）</span>}
                    </Td>
                    <Td>
                      <span className={styles.statePill} data-tone={badge.tone}>
                        <span className={styles.stateDot} aria-hidden="true" />
                        {badge.label}
                      </span>
                    </Td>
                    {!narrow && (
                      <Td onClick={(event) => event.stopPropagation()}>
                        {item.usageCount === undefined ? (
                          <span className={styles.usageNone} title="使われている場所（未取得）">—（未取得）</span>
                        ) : item.usageCount === 0 ? (
                          <span className={styles.usageNone}>なし</span>
                        ) : (
                          <Link
                            href={`/contents/vars/edit?id=${item.id}`}
                            title={`${formatNumber(item.usageCount)}か所で使われています`}
                            className={styles.usageLink}
                          >
                            {formatNumber(item.usageCount)}か所
                          </Link>
                        )}
                      </Td>
                    )}
                    <Td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
                      {/* 横並びにして、メニューの位置の目印が行を1段増やさないようにする。
                          閲覧のみ：「…」の中は変える項目だけなので、ボタンごと置かない（列の幅は残す）。 */}
                      {canWrite ? <div className={styles.menuBox}>
                        <IconButton
                          className={styles.rowMenuButton}
                          title={`共通情報「${item.name}」の操作`}
                          aria-label={`共通情報「${item.name}」の操作`}
                          aria-haspopup="menu"
                          aria-expanded={openMenuId === item.id}
                          onClick={() => setOpenMenuId((currentId) => (currentId === item.id ? null : item.id))}
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </IconButton>
                        <ActionMenu
                          open={openMenuId === item.id}
                          onClose={() => setOpenMenuId(null)}
                          ariaLabel={`共通情報「${item.name}」の操作`}
                          items={rowMenuItems(item)}
                        />
                      </div> : null}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        </div>
      </ContextMenu>

      {/* まとめての帯（選ぶと表の下に出る）。 */}
      {canWrite && selected.size > 0 ? (
        <div className={styles.bulkRow} role="region" aria-label="選択中のまとめ操作">
          <span className={styles.bulkCount}>{selected.size}件を選択中</span>
          <span className={styles.bulkHint}>対象を確認してから操作を選んでください</span>
          <span className={styles.spacer} aria-hidden="true" />
          <Button type="button" variant="secondary" onClick={() => setSelected(new Set())}>選択を外す</Button>
          <Button type="button" variant="danger" onClick={() => void prepareRemoveSelected()}>選択した共通情報を削除</Button>
        </div>
      ) : null}
    </>
  )

  const pagerSummary = filtered.length === 0
    ? '0件'
    : pageCount > 1
      ? `${(page - 1) * pageSize + 1}〜${Math.min(page * pageSize, filtered.length)} / ${formatNumber(filtered.length)}件`
      : `${formatNumber(filtered.length)}件`
  const listPager = listFailed || !selectedAccountId || filtered.length === 0 ? null : pageCount > 1 ? (
    <Pagination page={page} pageCount={pageCount} onPageChange={setPage} summary={<span className={styles.pagerCount}>{pagerSummary}</span>} />
  ) : (
    <p className={styles.pagerSolo}>{pagerSummary}</p>
  )

  /* 数の帯。取れていない数字は「—」（0 とは言わない）。 */
  const kpis = [
    {
      key: 'total',
      title: '共通情報',
      icon: Braces,
      value: listFailed ? null : stats.total,
      unit: '件',
      detail: `下書き ${listFailed ? '—' : stats.draftCount}・止めた ${listFailed ? '—' : stats.stoppedCount}`,
    },
    {
      key: 'usage',
      title: '差し込んでいる所',
      icon: Link2,
      value: listFailed ? null : stats.usageTotal,
      unit: 'か所',
      detail: 'テンプレート・配信など',
    },
    {
      key: 'empty',
      title: '空のまま使われている',
      icon: TriangleAlert,
      value: listFailed ? null : stats.emptyInUse.length,
      unit: '件',
      detail: '空欄のまま送られます',
      fix: !listFailed && stats.emptyInUse.length > 0,
    },
    {
      key: 'expiring',
      title: '期限が近い',
      icon: CalendarClock,
      value: listFailed ? null : stats.expiringSoon,
      unit: '件',
      detail: '7日以内に期限切れ',
    },
  ]

  const overlays = (
    <>
      {/* 止める窓（板 `Hhl9M`）。下の窓を隠すため、削除の窓とは同時に出さない。 */}
      <Dialog
        open={statusTarget !== null && deleteTarget === null && !panelStatus}
        designNode="Hhl9M"
        title={statusTarget ? `「${statusTarget.name}」を${statusAction === 'stop' ? '止める' : '再開する'}` : ''}
        description={
          statusAction === 'stop'
            ? statusTarget?.usageCount === undefined
              ? '止めているあいだ、この共通情報を差し込んだ配信は送られません。あとで再開できます。'
              : `止めているあいだ、この共通情報を差し込んだ配信は送られません（${formatNumber(statusTarget.usageCount)}か所）。あとで再開できます。`
            : 'この共通情報を再び配信で使えるようにします。'
        }
        busy={statusBusy}
        error={statusError || undefined}
        onCancel={closeStatusDialog}
        footer={
          <div className={styles.centerFooter}>
            <Button type="button" onClick={closeStatusDialog} disabled={statusBusy}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void applyStatus()}
              disabled={statusBusy}
              busy={statusBusy}
              busyLabel={statusAction === 'stop' ? '止めています…' : '再開しています…'}
            >
              {statusAction === 'stop' ? (
                <>
                  <Pause size={14} aria-hidden="true" />
                  止める
                </>
              ) : '再開する'}
            </Button>
          </div>
        }
      >
        {statusTarget ? (
          <div className={styles.dialogBody}>
            {statusAction === 'stop' && statusTarget.nextSchedule ? (
              <p className={styles.dialogWarn} role="note">
                <TriangleAlert size={14} aria-hidden="true" />
                <span>
                  決めた日時に変わる予約（{formatStamp(statusTarget.nextSchedule.effectiveFrom)}に「{statusTarget.nextSchedule.value || '（空）'}」へ）があります。止める前に予定も見直してください。
                </span>
              </p>
            ) : null}
            <label className={styles.dialogField}>
              <span className={styles.dialogLabel}>
                {statusAction === 'stop' ? '止める理由（記録に残ります）' : '再開する理由（記録に残ります）'}
              </span>
              <input
                value={statusReason}
                onChange={(e) => { setStatusError(''); setStatusReason(e.target.value) }}
                placeholder={statusAction === 'stop' ? 'キャンペーンが終わったため' : '新しい期間の案内を始めるため'}
                className={styles.dialogInput}
              />
            </label>
            {statusAction === 'stop' && statusScheduled.length > 0 ? (
              <p className={styles.dialogWarn} role="note">
                <TriangleAlert size={14} aria-hidden="true" />
                <span>
                  予約中の{statusScheduled[0].kindLabel}「{statusScheduled[0].name}」が送られなくなります。
                  {statusScheduled.length > 1 ? `ほか${formatNumber(statusScheduled.length - 1)}件` : ''}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      {/* 削除の窓（板 `xxKtW`）。使われているものは差し替えか止めるへ導く。 */}
      <Dialog
        open={deleteTarget !== null}
        designNode="xxKtW"
        designWidth={600}
        designTop={240}
        designHeaderPadding="24px 24px 0"
        /* 絵 xxKtW：まだ消せないときは赤い題にしない（差し替え・止めるへ導く窓）。消せるときだけ赤。 */
        tone={deleteImpact && !deleteImpact.canDelete ? 'default' : 'destructive'}
        title={deleteTarget
          ? deleteImpact && !deleteImpact.canDelete
            ? `「${deleteTarget.name}」はまだ消せません`
            : `「${deleteTarget.name}」を消しますか？`
          : ''}
        busy={deleteBusy}
        error={deleteError || undefined}
        onCancel={closeDelete}
        footer={deleteTarget ? (
          /* 絵 xxKtW：キャンセルは真ん中、実行は右端。 */
          <div className={`${styles.splitFooter} ${styles.deleteFooter}`}>
            {/* 絵 xxKtW に理由の欄は無いが、差し替え・止めるには理由が要る（版履歴に残す）。左の空きに小さく置く。 */}
            {deletePhase === 'ready' && deleteImpact && !deleteImpact.canDelete ? (
              <input
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="理由（必須・記録に残ります）"
                aria-label="消した理由・止める理由（記録に残ります）"
                title="消した理由・止める理由（記録に残ります）"
                className={styles.footerReason}
              />
            ) : <span aria-hidden="true" />}
            <Button type="button" onClick={closeDelete} disabled={deleteBusy}>
              キャンセル
            </Button>
            <span aria-hidden="true" />
            <span className={styles.footerEnd}>
            {deletePhase === 'ready' && deleteImpact && !deleteImpact.canDelete && deleteChoice === 'replace' ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => void confirmReplacement()}
                disabled={deleteBusy || replacementPhase !== 'ready' || !replacementImpact?.canReplace || !deleteReason.trim()}
                busy={deleteBusy}
                busyLabel="差し替え中…"
              >
                差し替えて消す
              </Button>
            ) : null}
            {deletePhase === 'ready' && deleteImpact && !deleteImpact.canDelete && deleteChoice === 'stop' ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => void confirmStopInstead()}
                disabled={deleteBusy || !deleteReason.trim()}
                busy={deleteBusy}
                busyLabel="止めています…"
              >
                止める
              </Button>
            ) : null}
            {deletePhase === 'ready' && deleteImpact && deleteImpact.canDelete
              && canDeleteVar({ impact: deleteImpact, typedKey, reason: deleteReason, busy: deleteBusy }) ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => void confirmDirectDelete()}
                  busy={deleteBusy}
                  busyLabel="処理中…"
                >
                  このまま削除
                </Button>
              ) : null}
            </span>
          </div>
        ) : undefined}
      >
        {deleteTarget ? (
          <div className={`${styles.dialogBody} ${styles.deleteBody}`}>
            {/* 絵 xxKtW：説明は窓の横いっぱい（×の列の下まで）。共通の窓の説明は×の左までなので本文側に置く。 */}
            <p className={styles.deleteLead}>
              {deleteImpact && !deleteImpact.canDelete
                ? `${formatNumber(deleteImpact.total)}か所に差し込まれています。消すと、そこが空欄のまま送られます。先に差し込みを外してください。`
                : 'この共通情報と、登録値・次回予約を削除します。テンプレート・配信・フォルダ・友だちは削除しません。'}
            </p>
            {deletePhase === 'loading' ? (
              <p className={styles.dialogLead}>使われている場所を確認しています…</p>
            ) : deletePhase === 'error' ? (
              <p className={styles.dialogError} role="alert">
                使用先を確認できませんでした。読み直してから、もう一度お試しください。
              </p>
            ) : deleteImpact ? (
              <>
                {deleteImpact.canDelete ? (
                  <>
                    <p className={styles.dialogLead}>{usageText(deleteImpact)}</p>
                    {consequenceText(deleteImpact) ? (
                      <p className={styles.dialogLead}>{consequenceText(deleteImpact)}</p>
                    ) : null}
                  </>
                ) : null}

                {(() => {
                  const blocking = splitItems(deleteImpact.items).blocking
                  const visible = usageExpanded ? blocking : blocking.slice(0, 2)
                  const rest = Math.max(0, deleteImpact.blockingTotal - visible.length)
                  return blocking.length > 0 ? (
                    <div className={styles.usageList}>
                      <ul>
                        {visible.map((usageItem) => (
                          <li key={`${usageItem.kind}-${usageItem.href}`} className={styles.usageItem}>
                            <span className={styles.usageItemName}>
                              {`${usageItem.kindLabel}「${usageItem.name}」`}
                            </span>
                            <a href={usageItem.href} className={styles.usageItemLink}>開いて外す</a>
                          </li>
                        ))}
                      </ul>
                      {rest > 0 || usageExpanded ? (
                        <div className={styles.usageItem}>
                          <span className={styles.usageMore}>{usageExpanded ? `${formatNumber(blocking.length)}か所を表示中` : `ほか ${formatNumber(rest)}か所`}</span>
                          {blocking.length > 2 ? (
                            <button
                              type="button"
                              className={styles.usageItemLink}
                              onClick={() => setUsageExpanded((prev) => !prev)}
                            >
                              {usageExpanded ? '畳む' : 'すべて見る'}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null
                })()}

                {!deleteImpact.canDelete ? (
                  <div className={styles.choiceGroup} role="radiogroup" aria-label="どうしますか">
                    <p className={styles.dialogQuestion}>
                      どうしますか
                      <HelpTip label="確認した範囲">
                        {checkedAtText(deleteImpact.checkedAt)} 時点で、テンプレート・一斉配信・シナリオ・リマインダ・自動応答・回答フォーム・オートメーション・友だち追加時・共通アクションの9種類を確認しました。
                      </HelpTip>
                    </p>
                    <div
                      className={styles.choiceBox}
                      data-active={deleteChoice === 'replace' || undefined}
                      role="radio"
                      aria-checked={deleteChoice === 'replace'}
                      tabIndex={0}
                      onClick={() => setDeleteChoice('replace')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setDeleteChoice('replace')
                        }
                      }}
                    >
                      <span className={styles.choiceMark} aria-hidden="true" />
                      <span className={styles.choiceTitle}>別の共通情報に差し替えて消す（おすすめ）</span>
                    </div>
                    {deleteChoice === 'replace' ? (
                      <>
                        <Select
                          size="full"
                          value={replacementId}
                          disabled={deleteBusy || replacementCandidates.length === 0}
                          onChange={(value) => void selectReplacement(value)}
                          aria-label="差し替え先"
                          options={replacementCandidates.length > 0
                            ? replacementCandidates.map((candidate) => ({
                              value: candidate.id,
                              label: `差し替え先：${candidate.name} ${placeholderText(candidate.varKey)}`,
                            }))
                            : [{ value: '', label: replacementPhase === 'loading' ? '候補を読み込んでいます' : '差し替えられる候補がありません' }]}
                        />
                        {replacementPhase === 'loading' ? (
                          <p className={styles.dialogHint}>差し替え後の影響を確認しています…</p>
                        ) : replacementPhase === 'error' ? (
                          <p className={styles.dialogError}>差し替え後の影響を確認できませんでした。</p>
                        ) : replacementImpact ? (
                          <p className={replacementImpact.canReplace ? styles.choiceNote : styles.dialogError}>
                            {replacementImpact.canReplace
                              ? `差し替えると、${formatNumber(replacementImpact.replaceableTotal)}か所の「${formatVarValue(deleteTarget.type, deleteTarget.value) || '（空）'}」が${replacementImpact.replacement.name}の中身になります。`
                              : `${formatNumber(replacementImpact.blockedTotal)}か所は自動で差し替えられません。先に個別に確認してください。`}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    <div
                      className={styles.choiceBox}
                      data-active={deleteChoice === 'stop' || undefined}
                      role="radio"
                      aria-checked={deleteChoice === 'stop'}
                      tabIndex={0}
                      onClick={() => setDeleteChoice('stop')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setDeleteChoice('stop')
                        }
                      }}
                    >
                      <span className={styles.choiceMark} aria-hidden="true" />
                      <span className={styles.choiceTitle}>消さずに止める</span>
                    </div>
                    {deleteChoice === 'stop' ? (
                      <p className={styles.choiceNote}>止めているあいだ、差し込んだ配信は送られません。あとで再開できます。</p>
                    ) : null}
                  </div>
                ) : null}

                {unavailableText(deleteImpact) ? (
                  <p className={styles.dialogHint}>{unavailableText(deleteImpact)}</p>
                ) : null}

                {deleteImpact.canDelete ? (
                <label className={styles.dialogField}>
                  <span className={styles.dialogLabel}>消した理由（記録に残ります）</span>
                  <input
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    placeholder="店舗情報の変更のため"
                    className={styles.dialogInput}
                  />
                </label>
                ) : null}

                {deleteImpact.canDelete ? (
                  <label className={styles.dialogField}>
                    <span className={styles.dialogLabel}>
                      削除する場合は、差し込みキーを入力してください
                    </span>
                    <input
                      value={typedKey}
                      onChange={(e) => setTypedKey(e.target.value)}
                      placeholder={placeholderText(deleteImpact.variable.varKey)}
                      className={styles.dialogInput}
                    />
                  </label>
                ) : null}

                {deleteImpact.canDelete && blockedReason({ impact: deleteImpact, typedKey, reason: deleteReason }) ? (
                  <p className={styles.dialogHint}>{blockedReason({ impact: deleteImpact, typedKey, reason: deleteReason })}</p>
                ) : null}

                {deleteImpact.canDelete ? <p className={styles.dialogHint}>
                  {checkedAtText(deleteImpact.checkedAt)} 時点で、テンプレート・一斉配信・シナリオ・リマインダ・自動応答・回答フォーム・オートメーション・友だち追加時・共通アクションの9種類を確認しました。
                </p> : null}
              </>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={deleteTargets.length > 0}
        title={deleteTargets.length === 1
          ? `「${deleteTargets[0]?.name ?? ''}」を削除しますか？`
          : `「${deleteTargets[0]?.name ?? ''}」ほか${deleteTargets.length - 1}件を削除しますか？`}
        description={`選択した${deleteTargets.length}件の共通情報と、登録値・次回予約を削除します。テンプレート、配信、フォルダ、友だちは削除しません。この操作は元に戻せません。`}
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteBatchError || undefined}
        onConfirm={() => void removeSelected()}
        onCancel={() => {
          if (deleting) return
          batchRequestRef.current = {
            accountId: selectedAccountId,
            generation: batchRequestRef.current.generation + 1,
          }
          setDeleteBatchError('')
          setBatchReason('')
          setDeleteTargets([])
        }}
      >
        <label className={styles.dialogField}>
          <span className={styles.dialogLabel}>
            消した理由 <span className={styles.required}>必須</span>
          </span>
          <input
            value={batchReason}
            onChange={(e) => setBatchReason(e.target.value)}
            placeholder="店舗情報の変更のため"
            className={styles.dialogInput}
          />
        </label>
      </ConfirmDialog>

      {addingFolder ? (
        <FolderAddDialog
          kind="common_var"
          accountId={selectedAccountId}
          note="共通情報を分けてしまう箱です。削除しても、入っていた共通情報は未分類として残ります。"
          placeholder="例: 01_店舗案内"
          onClose={() => setAddingFolder(false)}
          onAdded={() => { setAddingFolder(false); void load(); void loadFolders() }}
        />
      ) : null}

      {editingFolder ? (
        <FolderAddDialog
          kind="common_var"
          folder={editingFolder}
          accountId={selectedAccountId}
          note="共通情報を分けてしまう箱です。削除しても、入っていた共通情報は未分類として残ります。"
          placeholder="例: 01_店舗案内"
          onClose={() => setEditingFolder(null)}
          onAdded={() => { setEditingFolder(null); void load(); void loadFolders() }}
        />
      ) : null}

      <ConfirmDialog
        open={deletingFolder !== null}
        title={`フォルダ「${deletingFolder?.name ?? ''}」を削除しますか？`}
        description={deletingFolder?.itemCount != null
          ? `削除しても、入っていた共通情報は未分類として残ります。いまこのフォルダに入っているのは${deletingFolder.itemCount}件です。`
          : '削除しても、入っていた共通情報は未分類として残ります。'}
        confirmLabel="削除する"
        destructive
        busy={folderBusy}
        error={folderError || undefined}
        onCancel={() => { if (!folderBusy) { setDeletingFolder(null); setFolderError('') } }}
        onConfirm={() => void removeFolder()}
      />

      {activeItem ? (
        <DetailPanel
          open
          title={activeItem.name}
          description={placeholderText(activeItem.varKey)}
          onClose={() => {
            setActiveId(null)
            setPanelStatus(false)
          }}
          hasPrev={activeIndex > 0}
          hasNext={activeIndex >= 0 && activeIndex < current.length - 1}
          onPrev={() => setActiveId(current[activeIndex - 1]?.id ?? null)}
          onNext={() => setActiveId(current[activeIndex + 1]?.id ?? null)}
          footer={
            <div className={styles.panelActions}>
              <Button
                type="button"
                variant="primary"
                onClick={() => withViewTransition(() => router.push(`/contents/vars/edit?id=${activeItem.id}`))}
              >
                編集する
              </Button>
              {canWrite ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => openStatusDialog(activeItem, activeStopped ? 'resume' : 'stop')}
                >
                  {activeStopped ? '再開する' : '止める'}
                </Button>
              ) : null}
              {canWrite ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => void openDelete(activeItem)}
                >
                  削除する
                </Button>
              ) : null}
            </div>
          }
        >
          <div className={styles.panelBody}>
            <p className={styles.panelLabel}>名前</p>
            {canWrite ? (
              <InlineEdit
                value={activeItem.name}
                label="共通情報の名前"
                maxLength={100}
                onSave={(next) => renameVar(activeItem, next)}
              />
            ) : (
              // 閲覧のみ：鉛筆は置かず、名前だけを見せる。
              <p className={styles.panelText}>{activeItem.name}</p>
            )}
            <p className={styles.panelLabel}>中身</p>
            <p className={styles.panelText}>
              {formatVarValue(activeItem.type, activeItem.value) || '（空）'}
            </p>
            <p className={styles.panelLabel}>状態</p>
            <p className={styles.panelText}>
              {activeStopped ? '止めている' : (activeItem.status ?? 'active') === 'draft' ? '下書き' : '使用中'}
            </p>
            <p className={styles.panelLabel}>使っている所</p>
            <p className={styles.panelText}>
              {activeItem.usageCount === undefined
                ? '—（未取得）'
                : activeItem.usageCount === 0
                  ? 'なし'
                  : `${formatNumber(activeItem.usageCount)}か所`}
            </p>
            <p className={styles.panelLabel}>更新・次回</p>
            <p className={styles.panelText}>
              {activeItem.nextSchedule
                ? `${formatListDate(activeItem.updatedAt)} ／ ${formatStamp(activeItem.nextSchedule.effectiveFrom)}に変更`
                : `${formatListDate(activeItem.updatedAt)} ／ 予定なし`}
            </p>
            {panelStatus && statusTarget?.id === activeItem.id ? (
              <>
                <p className={styles.panelLabel}>
                  {statusAction === 'stop' ? '止める理由（記録に残ります）' : '再開する理由（記録に残ります）'}
                </p>
                <div className={styles.panelBody}>
                  <input
                    value={statusReason}
                    onChange={(e) => { setStatusError(''); setStatusReason(e.target.value) }}
                    placeholder={statusAction === 'stop' ? 'キャンペーンが終わったため' : '新しい期間の案内を始めるため'}
                    aria-label={statusAction === 'stop' ? '止める理由' : '再開する理由'}
                    disabled={statusBusy}
                    className={styles.dialogInput}
                  />
                  <Button
                    type="button"
                    variant="primary"
                    disabled={statusBusy}
                    busy={statusBusy}
                    onClick={() => void applyStatus()}
                  >
                    {statusBusy
                      ? (statusAction === 'stop' ? '止めています…' : '再開しています…')
                      : (statusAction === 'stop' ? '止める' : '再開する')}
                  </Button>
                </div>
                {statusError ? <p className={styles.dialogError} role="alert">{statusError}</p> : null}
              </>
            ) : null}
          </div>
        </DetailPanel>
      ) : null}
    </>
  )

  return (
    <ListPage
      boardId={narrow ? 'XIzkJ' : canWrite ? 'FM94M' : 'OxSw8'}
      headingSize="regular"
      title="共通情報"
      description="会社名・営業時間・電話番号など、何度も使う文字をここで持ち、テンプレートや配信に差し込みます。ここを変えると、差し込んだ所がまとめて変わります。"
      actions={
        <VarsExportPanel
          accountId={selectedAccountId}
          folderId={folderFilter && folderFilter !== UNGROUPED ? folderFilter : null}
          ungrouped={folderFilter === UNGROUPED}
        />
      }
      tabs={canWrite ? undefined : (
        /* 閲覧のみの帯（`OxSw8`）。数の帯の上。 */
        <div className={styles.viewerBand} role="status">
          <Eye size={16} aria-hidden="true" />
          <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
        </div>
      )}
      stats={
        <KpiBand data-design="KPIs" aria-label="共通情報の集計" className={styles.kpiStrip}>
          {kpis.map((kpi) => (
            <KpiCard
              key={kpi.key}
              presentation="band"
              title={kpi.title}
              icon={<kpi.icon size={13} aria-hidden="true" />}
              value={kpi.value}
              unit={kpi.value == null ? '' : kpi.unit}
              detail={kpi.fix ? (
                /* 絵：説明の右端に「直す →」。押すと「空のまま」で絞り込む。 */
                <span className={styles.kpiDetailRow}>
                  <span className={styles.kpiDetailText}>{kpi.detail}</span>
                  <button type="button" className={styles.kpiFix} onClick={applyEmptyFilter}>
                    直す<ArrowRight size={12} aria-hidden="true" />
                  </button>
                </span>
              ) : kpi.detail}
            />
          ))}
        </KpiBand>
      }
      folders={<>{createButton(true) ?? <span className={styles.viewerCreateSpace} aria-hidden="true" />}{folderPanel}</>}
      toolbar={<>
        {hasAlerts ? <div className={styles.alertSlot}>{alerts}</div> : null}
        {narrow ? narrowToolbar : wideToolbar}
      </>}
      pagination={listPager}
      overlays={overlays}
    >
      {listBody}
    </ListPage>
  )
}

export default function CommonVarsListV8() {
  return (
    <Suspense fallback={<div className={styles.suspense}>読み込み中...</div>}>
      <CommonVarsListInner />
    </Suspense>
  )
}
