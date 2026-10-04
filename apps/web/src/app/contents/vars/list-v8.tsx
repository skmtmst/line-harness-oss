'use client'

/*
 * ★V8 共通情報の一覧（Pencil「★V8 画面の地図」の共通情報の行：
 * 一覧 `FM94M`、止める窓 `Hhl9M`、削除の窓 `xxKtW`、状態 `RqO7O`、
 * 一覧（1152）`XIzkJ`、一覧（閲覧のみ）`OxSw8`）。
 *
 * v7 の一覧（`page.tsx` 内の VarsPageInner）とは別の部品として持つ。
 * データの口は同じ。違いは置き場と見せ方だけ——上に4枚の数の帯
 * （共通情報／差し込んでいる所／空のまま使われている／期限が近い）、
 * 空のまま使われているときの黄色の帯、「共通情報を作る」は左の
 * フォルダの列の上、行の右端は「…」メニュー（編集・止める／再開する・
 * 削除する）。止める・削除の窓は `Hhl9M`・`xxKtW` の1枚ずつにまとめる。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Braces, CalendarClock, Eye, Link2, TriangleAlert } from 'lucide-react'
import type { CommonVar, CommonVarDeleteImpact, Folder } from '@line-crm/shared'
import {
  api,
  ApiError,
  type CommonVarReplacementCandidate,
  type CommonVarReplacementImpact,
} from '@/lib/api'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import CopyTextButton from '@/components/ui/copy-text-button'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import FolderPanel from '@/components/shared/folder-panel'
import ListRange from '@/components/ui/list-range'
import ListState from '@/components/shared/list-state'
import PageSizeSelect from '@/components/ui/page-size-select'
import Pagination from '@/components/shared/pagination'
import { RowActions } from '@/components/shared/row-actions'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import SortSelect from '@/components/ui/sort-select'
import StatusBadge from '@/components/shared/status-badge'
import BulkBar from '@/components/shared/bulk-bar'
import NoPermissionV8 from '@/app/no-permission/no-permission-v8'
import { classifyApiFailure, isForbidden } from '@/components/shared/api-error-message'
import { COMMON_VAR_STATE_LABELS, formatStamp } from '@/lib/common-vars'
import { formatNumber } from '@/lib/format'
import {
  blockedReason,
  canDelete as canDeleteVar,
  checkedAtText,
  consequenceText,
  placeholderText,
  splitItems,
  unavailableText,
  usageText,
} from './delete-impact'
import {
  filterAndSortCommonVars,
  type CommonVarFilter,
  type CommonVarOrder,
} from './list-model'
import VarsExportPanel from './export-panel'
import styles from './list-v8.module.css'

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
 * 道具の段の絞り込み。期限切れは「期限つき」にまとめ、状態の札で見分ける。
 * 「下書き・止めた」は1枚の札にまとめる（板 `FM94M`）。
 */
type VarsChip = 'all' | 'empty' | 'scheduled' | 'unused' | 'draftStopped'

const CHIPS: Array<{ value: VarsChip; label: string; filter: CommonVarFilter }> = [
  { value: 'all', label: 'すべて', filter: 'all' },
  { value: 'empty', label: '空のまま', filter: 'empty' },
  { value: 'scheduled', label: '期限つき', filter: 'scheduled' },
  { value: 'unused', label: '使われていない', filter: 'unused' },
  { value: 'draftStopped', label: '下書き・止めた', filter: 'all' },
]

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

function CommonVarsListV8Inner() {
  usePageTitle('共通情報')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const router = useRouter()
  const params = useSearchParams()

  /*
   * 書き込みの口（作成・更新・削除・状態切替・フォルダ操作）は
   * `requireRole('owner', 'admin')` で閉じている。staff へ操作を見せると
   * 押しても 403 になるだけなので、閲覧のみの帯を出して操作ごと出さない
   * （板 `OxSw8`）。一覧・CSVで書き出す・差し込み名のコピーは使える。
   */
  const [canWrite] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())

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

  /** 選んでいるフォルダ。URLに出して、戻るとブックマークを壊さない。 */
  const folderFilter = params.get('folder') ?? ''
  const setFolderFilter = (id: string) => {
    setPage(1)
    router.replace(id ? `/contents/vars?folder=${encodeURIComponent(id)}` : '/contents/vars')
  }

  const [addingFolder, setAddingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)

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

  const activeChip = CHIPS.find((entry) => entry.value === chip) ?? CHIPS[0]
  const baseFiltered = useMemo(
    () => filterAndSortCommonVars(items, {
      query,
      folderId: folderFilter,
      ungroupedValue: UNGROUPED,
      filter: activeChip.filter,
      order,
    }),
    [folderFilter, items, order, query, activeChip],
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

  const addFolder = async () => {
    const name = folderName.trim()
    if (!name || savingFolder) return
    setSavingFolder(true)
    setError('')
    try {
      const res = await api.folders.create({ kind: 'common_var', name })
      if (!res.success) {
        setError(res.error)
        return
      }
      setFolderName('')
      setAddingFolder(false)
      void load()
      void loadFolders()
    } catch {
      setError('フォルダを作れませんでした')
    } finally {
      setSavingFolder(false)
    }
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

  const openStatusDialog = (item: CommonVar, action: 'stop' | 'resume') => {
    setStatusTarget(item)
    setStatusAction(action)
    setStatusReason('')
    setStatusError('')
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
  /** 使用先が多いときは畳む（板 `xxKtW` の「ほか5か所」）。 */
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
    } catch (error) {
      if (deleteRequestRef.current.generation !== request.generation) return
      if (error instanceof ApiError && error.status === 409) {
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

  const folderForbidden = folderFailure != null && classifyApiFailure(folderFailure) === 'forbidden'
  const folderFailureNote = folderFailure ? (
    <div role="alert" className="space-y-1.5">
      <p className="text-ink-secondary text-xs">
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

  const folderOptions = [
    { value: '', label: listFailed ? 'すべて（—）' : `すべて（${items.length}件）` },
    { value: UNGROUPED, label: `未分類（${unfiledCount === null ? '—' : `${unfiledCount}件`}）` },
    ...folders.map((folder) => ({
      value: folder.id,
      label: folder.itemCount === null || folder.itemCount === undefined
        ? folder.name
        : `${folder.name}（${folder.itemCount}件）`,
    })),
  ]

  const folderRows = [
    { id: '', label: 'すべて', count: listFailed ? null : items.length },
    { id: UNGROUPED, label: '未分類', count: unfiledCount },
    ...folders.map((folder) => ({
      id: folder.id,
      label: folder.name,
      count: folder.itemCount ?? null,
      color: folder.color,
      onEdit: canWrite ? () => setEditingFolder(folder) : undefined,
      onDelete: canWrite ? () => { setFolderError(''); setDeletingFolder(folder) } : undefined,
      deleteNote: '削除しても、入っていた共通情報は未分類として残ります。',
    })),
  ]

  /* 閲覧のみでは押せない形にする（閉さない）。行き先のある押し口に disabled は付けられないため描き分ける。 */
  const createButton = canWrite ? (
    <Button href="/contents/vars/new" variant="primary">
      ＋ 共通情報を作る
    </Button>
  ) : (
    <Button type="button" variant="primary" disabled title="閲覧のみのため作れません">
      ＋ 共通情報を作る
    </Button>
  )

  const firstEmpty = stats.emptyInUse[0] ?? null

  return (
    <div data-design-node="FM94M" className={styles.board}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>共通情報</h1>
          <p className={styles.headDescription}>
            会社名・営業時間・電話番号など、何度も使う文字をここで持ち、テンプレートや配信に差し込みます。ここを変えると、差し込んだ所がまとめて変わります。
          </p>
        </div>
        <div className={styles.headActions}>
          <VarsExportPanel
            accountId={selectedAccountId}
            folderId={folderFilter && folderFilter !== UNGROUPED ? folderFilter : null}
            ungrouped={folderFilter === UNGROUPED}
          />
        </div>
      </div>

      {/* 板 `OxSw8`：閲覧のみの帯。数の帯の上。 */}
      {canWrite ? null : (
        <div className={styles.roBand} role="status">
          <Eye size={16} aria-hidden="true" />
          <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
        </div>
      )}

      {/* 数の帯。取れていない数字は「—」（0 とは言わない）。 */}
      <div className={styles.kpis} aria-label="共通情報の集計">
        <div className={styles.kpi}>
          <div className={styles.kpiHead}>
            <span className={styles.kpiTile} aria-hidden="true"><Braces size={14} /></span>
            <span className={styles.kpiLabel}>共通情報</span>
          </div>
          <p className={styles.kpiValue}>
            {listFailed ? '—' : formatNumber(stats.total)}<span className={styles.kpiUnit}>件</span>
          </p>
          <p className={styles.kpiDetail}>下書き {listFailed ? '—' : stats.draftCount}・止めた {listFailed ? '—' : stats.stoppedCount}</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiHead}>
            <span className={styles.kpiTile} aria-hidden="true"><Link2 size={14} /></span>
            <span className={styles.kpiLabel}>差し込んでいる所</span>
          </div>
          <p className={styles.kpiValue}>
            {listFailed || stats.usageTotal === null ? '—' : formatNumber(stats.usageTotal)}<span className={styles.kpiUnit}>か所</span>
          </p>
          <p className={styles.kpiDetail}>テンプレート・配信など</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiHead}>
            <span className={styles.kpiTile} aria-hidden="true"><TriangleAlert size={14} /></span>
            <span className={styles.kpiLabel}>空のまま使われている</span>
          </div>
          <p className={styles.kpiValue}>
            {listFailed ? '—' : formatNumber(stats.emptyInUse.length)}<span className={styles.kpiUnit}>件</span>
          </p>
          <p className={styles.kpiDetail}>空欄のまま送られます</p>
          {stats.emptyInUse.length > 0 && !listFailed ? (
            <button type="button" className={styles.kpiLink} onClick={applyEmptyFilter}>
              直す →
            </button>
          ) : null}
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiHead}>
            <span className={styles.kpiTile} aria-hidden="true"><CalendarClock size={14} /></span>
            <span className={styles.kpiLabel}>期限が近い</span>
          </div>
          <p className={styles.kpiValue}>
            {listFailed ? '—' : formatNumber(stats.expiringSoon)}<span className={styles.kpiUnit}>件</span>
          </p>
          <p className={styles.kpiDetail}>7日以内に期限切れ</p>
        </div>
      </div>

      {!selectedAccountId && !accountLoading ? (
        <div className={styles.stateCard}>
          <ListState kind="empty" title="LINEアカウントを選択してください" description="共通情報はLINEアカウントごとに管理します。" />
        </div>
      ) : (
        <>
          {firstEmpty && !listFailed ? (
            <div className={styles.alertBand} role="status">
              <TriangleAlert size={16} aria-hidden="true" />
              <span className={styles.alertText}>
                「{firstEmpty.name}」が空のまま{typeof firstEmpty.usageCount === 'number' ? `${formatNumber(firstEmpty.usageCount)}か所` : '何か所か'}で使われています。差し込んだところが空欄のまま送られます。
              </span>
              <span className={styles.alertAction}>
                <Button type="button" onClick={applyEmptyFilter}>直す</Button>
              </span>
            </div>
          ) : null}

          {listLimited && !listFailed ? (
            <div className={styles.alertBand} role="status">
              <TriangleAlert size={16} aria-hidden="true" />
              <span className={styles.alertText}>
                表示は最初の200件までです。フォルダや検索で絞り込んでください。
              </span>
            </div>
          ) : null}

          <div className={styles.split}>
            <div className={styles.folderCol}>
              {createButton}
              <div>
                <FolderPanel
                  activeId={folderFilter}
                  onSelect={setFolderFilter}
                  onAddFolder={canWrite ? () => setAddingFolder(true) : undefined}
                  rows={folderRows}
                >
                  {folderFailureNote}
                  {folderError ? <p role="alert" className="text-ink-secondary text-xs">{folderError}</p> : null}
                  {addingFolder ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        autoFocus
                        value={folderName}
                        onChange={(e) => setFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void addFolder()
                          if (e.key === 'Escape') setAddingFolder(false)
                        }}
                        placeholder="フォルダ名を入力"
                        aria-label="フォルダ名"
                        className="border-hairline rounded-control focus:ring-accent w-full border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none"
                      />
                      <div className="flex justify-end gap-2">
                        <Button type="button" onClick={() => { setAddingFolder(false); setFolderName('') }}>
                          キャンセル
                        </Button>
                        <Button type="button" variant="primary" onClick={() => void addFolder()} disabled={!folderName.trim() || savingFolder}>
                          決定
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className={styles.folderNote}>
                      フォルダを消しても、入っていた共通情報は未分類として残ります。
                    </p>
                  )}
                </FolderPanel>
              </div>
            </div>

            <div className={styles.main}>
              <div className={styles.toolbar} role="search">
                <span className={styles.toolbarCreate}>{createButton}</span>
                <span className={styles.folderSelectWrap}>
                  <Select
                    size="full"
                    aria-label="フォルダ"
                    value={folderFilter}
                    onChange={(value) => setFolderFilter(value)}
                    options={folderOptions}
                  />
                </span>
                <span className={styles.searchWrap}>
                  <SearchField
                    value={query}
                    onChange={(value) => {
                      setQuery(value)
                      setPage(1)
                    }}
                    onClear={() => {
                      setQuery('')
                      setPage(1)
                    }}
                    placeholder="名前・差し込み名・中身"
                    aria-label="共通情報を検索"
                  />
                </span>
                {CHIPS.map((entry) => (
                  <FilterChip
                    key={entry.value}
                    selected={chip === entry.value}
                    onChange={() => {
                      setChip(entry.value)
                      setPage(1)
                    }}
                  >
                    {entry.label}
                  </FilterChip>
                ))}
                <span className={styles.pageSizeWrap}>
                  <SortSelect
                    value={order}
                    onChange={(value) => setOrder(value as CommonVarOrder)}
                    options={[
                      { value: 'usage_desc', label: '使われている数が多い順' },
                      { value: 'updated_desc', label: '更新が新しい順' },
                      { value: 'name_asc', label: '名前順' },
                    ]}
                  />
                  <PageSizeSelect
                    value={pageSize}
                    onChange={(value) => {
                      setPageSize(value)
                      setPage(1)
                    }}
                  />
                </span>
              </div>

              {loading ? (
                <div className={styles.stateCard}>
                  <ListState kind="loading" title="共通情報を読み込んでいます" />
                </div>
              ) : error ? (
                <div className={styles.stateCard}>
                  {isForbidden(listFailure) ? (
                    <NoPermissionV8
                      featureName="共通情報"
                      capabilitiesHref="/staff"
                    />
                  ) : (
                    <ListState
                      kind="error"
                      title="共通情報を読み込めませんでした"
                      description={error}
                      error={listFailure ?? undefined}
                      onRetry={() => void load()}
                    />
                  )}
                </div>
              ) : current.length === 0 ? (
                <div className={styles.stateCard}>
                  <ListState
                    kind="empty"
                    emptyPreset={items.length === 0 ? 'createable' : 'filtered'}
                    title={items.length === 0
                      ? 'まだ共通情報はありません'
                      : '条件に合う共通情報はありません'}
                    description={items.length === 0
                      ? '会社名や営業時間を1か所で持つと、変えるときに1回直すだけで済みます。'
                      : '「空のまま」「期限つき」「使われていない」「下書き・止めた」や検索を外すと、すべて出ます'}
                    action={items.length === 0
                      ? (canWrite ? <Button href="/contents/vars/new" variant="secondary">共通情報を作る</Button> : undefined)
                      : <Button type="button" onClick={clearVarFilters}>条件を外す</Button>}
                  />
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        {canWrite ? (
                          <th className={styles.cellCheck} scope="col">
                            <Checkbox
                              checked={allOnPageSelected}
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
                          </th>
                        ) : null}
                        <th scope="col">共通情報（差し込み名）</th>
                        <th scope="col">中身</th>
                        <th scope="col">状態</th>
                        <th scope="col">使っている所</th>
                        <th scope="col" className={styles.cellMenu}>
                          <span className="sr-only">操作</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.map((item) => {
                        const badge = stateBadge(item)
                        const valueText = formatVarValue(item.type, item.value)
                        const stopped = (item.status ?? 'active') === 'stopped'
                        return (
                          <tr key={item.id}>
                            {canWrite ? (
                              <td className={styles.cellCheck}>
                                <Checkbox
                                  checked={selected.has(item.id)}
                                  onCheckedChange={() => toggle(item.id)}
                                  aria-label={`${item.name}を選ぶ`}
                                />
                              </td>
                            ) : null}
                            <td>
                              <Link
                                href={`/contents/vars/edit?id=${item.id}`}
                                title={item.name}
                                className={styles.nameLink}
                              >
                                {item.name}
                              </Link>
                              <span className={styles.keyRow}>
                                <code title={placeholderText(item.varKey)} className={styles.keyCode}>
                                  {placeholderText(item.varKey)}
                                </code>
                                <CopyTextButton
                                  value={placeholderText(item.varKey)}
                                  aria-label={`${item.name}の差し込みキーをコピー`}
                                />
                              </span>
                            </td>
                            <td title={valueText || '（空）'} className={styles.valueCell}>
                              {valueText || <span className={styles.valueEmpty}>（空）</span>}
                            </td>
                            <td>
                              <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                            </td>
                            <td>
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
                            </td>
                            <td className={styles.cellMenu}>
                              <RowActions
                                subjectName={item.name}
                                menuNote={canWrite ? undefined : '閲覧のみのため、変える操作は使えません。'}
                                menuItems={[
                                  {
                                    id: 'edit',
                                    label: '編集',
                                    disabled: !canWrite,
                                    disabledReason: canWrite ? undefined : '閲覧のみのため編集できません。',
                                    onSelect: () => router.push(`/contents/vars/edit?id=${item.id}`),
                                  },
                                  stopped ? {
                                    id: 'resume',
                                    label: '再開する',
                                    disabled: !canWrite,
                                    disabledReason: canWrite ? undefined : '閲覧のみのため再開できません。',
                                    onSelect: () => openStatusDialog(item, 'resume'),
                                  } : {
                                    id: 'stop',
                                    label: '止める',
                                    disabled: !canWrite,
                                    disabledReason: canWrite ? undefined : '閲覧のみのため止められません。',
                                    onSelect: () => openStatusDialog(item, 'stop'),
                                  },
                                ]}
                                destructiveItem={{
                                  id: 'delete',
                                  label: '削除する',
                                  qaOpen: 'xxKtW',
                                  disabled: !canWrite,
                                  disabledReason: canWrite ? undefined : '閲覧のみのため削除できません。',
                                  onSelect: () => void openDelete(item),
                                }}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {listFailed ? null : (
                <div className={styles.foot}>
                  <span className={styles.footCount}>{formatNumber(filtered.length)}件</span>
                  <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
                </div>
              )}

              {canWrite ? (
                <BulkBar
                  count={selected.size}
                  hint="対象を確認してから操作を選んでください"
                >
                  <Button type="button" variant="secondary" onClick={() => setSelected(new Set())}>
                    選択を外す
                  </Button>
                  <Button type="button" variant="danger" onClick={() => void prepareRemoveSelected()}>
                    選択した共通情報を削除
                  </Button>
                </BulkBar>
              ) : null}
            </div>
          </div>
        </>
      )}

      {/* 止める窓（板 `Hhl9M`）。下の窓を隠すため、削除の窓とは同時に出さない。 */}
      <Dialog
        open={statusTarget !== null && deleteTarget === null}
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
          <div className="flex flex-wrap items-center justify-end gap-2">
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
              {statusAction === 'stop' ? '止める' : '再開する'}
            </Button>
          </div>
        }
      >
        {statusTarget ? (
          <div>
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
                placeholder={statusAction === 'stop' ? '例：キャンペーンが終わったため' : '例：新しい期間の案内を始めるため'}
                className={styles.dialogInput}
              />
            </label>
          </div>
        ) : null}
      </Dialog>

      {/* 削除の窓（板 `xxKtW`）。使われているものは差し替えか止めるへ導く。 */}
      <Dialog
        open={deleteTarget !== null}
        designNode="xxKtW"
        tone="destructive"
        title={deleteTarget
          ? deleteImpact && !deleteImpact.canDelete
            ? `「${deleteTarget.name}」はまだ消せません`
            : `「${deleteTarget.name}」を消しますか？`
          : ''}
        description={deleteTarget
          ? deleteImpact && !deleteImpact.canDelete
            ? `${formatNumber(deleteImpact.total)}か所に差し込まれています。消すと、そこが空欄のまま送られます。先に差し込みを外してください。`
            : 'この共通情報と、登録値・次回予約を削除します。テンプレート・配信・フォルダ・友だちは削除しません。'
          : ''}
        busy={deleteBusy}
        error={deleteError || undefined}
        onCancel={closeDelete}
        footer={deleteTarget ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" onClick={closeDelete} disabled={deleteBusy}>
              キャンセル
            </Button>
            {deletePhase === 'ready' && deleteImpact && !deleteImpact.canDelete && deleteChoice === 'replace' ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => void confirmReplacement()}
                disabled={deleteBusy || replacementPhase !== 'ready' || !replacementImpact?.canReplace || !deleteReason.trim()}
                busy={deleteBusy}
                busyLabel="差し替え中…"
              >
                差し替えて削除
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
          </div>
        ) : undefined}
      >
        {deleteTarget ? (
          <div>
            {deletePhase === 'loading' ? (
              <p className={styles.dialogLead}>使われている場所を確認しています…</p>
            ) : deletePhase === 'error' ? (
              <p className={styles.dialogError} role="alert">
                使用先を確認できませんでした。読み直してから、もう一度お試しください。
              </p>
            ) : deleteImpact ? (
              <div>
                <p className={deleteImpact.total > 0 ? styles.dialogError : styles.dialogLead}>
                  {usageText(deleteImpact)}
                </p>
                {consequenceText(deleteImpact) ? (
                  <p className={styles.dialogLead}>{consequenceText(deleteImpact)}</p>
                ) : null}

                {(() => {
                  const blocking = splitItems(deleteImpact.items).blocking
                  const visible = usageExpanded ? blocking : blocking.slice(0, 2)
                  return blocking.length > 0 ? (
                    <div>
                      <ul className={styles.usageList}>
                        {visible.map((usageItem) => (
                          <li key={`${usageItem.kind}-${usageItem.href}`} className={styles.usageItem}>
                            <span className={styles.usageItemName}>
                              {usageItem.kindLabel}「{usageItem.name}」
                            </span>
                            <a href={usageItem.href} className={styles.usageItemLink}>開いて外す</a>
                          </li>
                        ))}
                      </ul>
                      {blocking.length > 2 ? (
                        <button
                          type="button"
                          className={styles.usageItemLink}
                          onClick={() => setUsageExpanded((prev) => !prev)}
                        >
                          {usageExpanded ? '畳む' : `ほか${formatNumber(blocking.length - 2)}か所を見る`}
                        </button>
                      ) : null}
                    </div>
                  ) : null
                })()}

                {!deleteImpact.canDelete ? (
                  <div>
                    <p className={styles.dialogLabel} style={{ marginTop: 12 }}>どうしますか</p>
                    <div
                      className={`${styles.choiceBox} ${deleteChoice === 'replace' ? styles.choiceBoxActive : ''}`}
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
                      <p className={styles.choiceTitle}>別の共通情報に差し替えて削除（おすすめ）</p>
                      <p className={styles.choiceNote}>
                        {formatNumber(deleteImpact.blockingTotal)}か所の差し込みを、選んだ別のキーへ置き換えます。置き換え後は元の共通情報を履歴が残る形で保管します。
                      </p>
                      <label className={styles.dialogField} onClick={(e) => e.stopPropagation()}>
                        <span className={styles.dialogLabel}>差し替え先</span>
                        <Select
                          size="full"
                          value={replacementId}
                          disabled={deleteBusy || replacementCandidates.length === 0}
                          onChange={(value) => void selectReplacement(value)}
                          aria-label="差し替え先"
                          options={replacementCandidates.length > 0
                            ? replacementCandidates.map((candidate) => ({
                              value: candidate.id,
                              label: `${placeholderText(candidate.varKey)} — ${candidate.value || '（空）'}`,
                            }))
                            : [{ value: '', label: replacementPhase === 'loading' ? '候補を読み込んでいます' : '差し替えられる候補がありません' }]}
                        />
                      </label>
                      {replacementPhase === 'loading' ? (
                        <p className={styles.dialogHint}>差し替え後の影響を確認しています…</p>
                      ) : replacementPhase === 'error' ? (
                        <p className={styles.dialogError}>差し替え後の影響を確認できませんでした。</p>
                      ) : replacementImpact ? (
                        <p className={replacementImpact.canReplace ? styles.dialogHint : styles.dialogError}>
                          {replacementImpact.canReplace
                            ? `${formatNumber(replacementImpact.replaceableTotal)}か所を差し替え、元の共通情報を保管できます。`
                            : `${formatNumber(replacementImpact.blockedTotal)}か所は自動で差し替えられません。先に個別に確認してください。`}
                        </p>
                      ) : null}
                    </div>
                    <div
                      className={`${styles.choiceBox} ${deleteChoice === 'stop' ? styles.choiceBoxActive : ''}`}
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
                      <p className={styles.choiceTitle}>消さずに止める</p>
                      <p className={styles.choiceNote}>
                        止めているあいだ、差し込んだ配信は送られません。あとで再開できます。
                      </p>
                    </div>
                  </div>
                ) : null}

                {unavailableText(deleteImpact) ? (
                  <p className={styles.dialogHint}>{unavailableText(deleteImpact)}</p>
                ) : null}

                <label className={styles.dialogField}>
                  <span className={styles.dialogLabel}>
                    {deleteImpact.canDelete ? '消した理由（記録に残ります）' : '消した理由・止める理由（記録に残ります）'}
                  </span>
                  <input
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    placeholder="例：店舗情報の変更のため"
                    className={styles.dialogInput}
                  />
                </label>

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

                <p className={styles.dialogHint}>
                  {checkedAtText(deleteImpact.checkedAt)} 時点で、テンプレート・一斉配信・シナリオ・リマインダ・自動応答・回答フォーム・オートメーション・友だち追加時・共通アクションの9種類を確認しました。
                </p>
              </div>
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
        <label className="block">
          <span className="text-ink-secondary text-xs font-semibold">
            消した理由 <span className="text-danger">必須</span>
          </span>
          <input
            value={batchReason}
            onChange={(e) => setBatchReason(e.target.value)}
            placeholder="例：店舗情報の変更のため"
            className="border-hairline rounded-control bg-canvas text-ink mt-1 w-full border px-3 py-2 text-sm"
          />
        </label>
      </ConfirmDialog>

      {editingFolder && (
        <FolderAddDialog
          kind="common_var"
          folder={editingFolder}
          accountId={selectedAccountId}
          note="共通情報を分けてしまう箱です。削除しても、入っていた共通情報は未分類として残ります。"
          placeholder="例: 01_店舗案内"
          onClose={() => setEditingFolder(null)}
          onAdded={() => { setEditingFolder(null); void load() }}
        />
      )}

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
    </div>
  )
}

function CommonVarsListV8Switch() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <CommonVarsListV8Inner /> : null
}

export default function CommonVarsListV8() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <CommonVarsListV8Switch />
    </Suspense>
  )
}
