'use client'

/*
 * ★V8 回答フォームの一覧（Pencil「★V8 画面の地図」の回答フォームの行）。
 * 一覧 `I3L41O`・1152 `GrnO4`・閲覧のみ `JV2oR`・アーカイブ・削除の窓 `GVizd`。
 *
 * 動き（呼ぶ API・権限・失敗の扱い・URL の指定）は今までの V8 一覧
 * （app/form-submissions/list-v8.tsx）と同じ。見た目だけを型（ListPage）と部品で組み直した。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { useState, useEffect, useCallback, useMemo, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useListScrollMemory } from '@/components/shared/list-url-state'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Archive,
  CircleCheck,
  ClipboardList,
  Eye,
  FileText,
  IdCard,
  Inbox,
  Link2,
  Percent,
  Plus,
  TriangleAlert,
} from 'lucide-react'
import { displayFormName, hasStoredDestination, type Folder } from '@line-crm/shared'
import { fetchApi, api, ApiError, type FormDeleteImpact, type ListStats } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { formatNumber } from '@/lib/format'
import { runUndoable } from '@/lib/undoable'
import { useDeferredDelete } from '@/lib/use-deferred-delete'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import ListToolbar from '@/components/shared/list-toolbar'
import FilterChip from '@/components/shared/filter-chip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import { DataTable, TableHeadRow, Th, Tr, Td, NameCell } from '@/components/shared/table'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import { FolderDotName } from '@/components/shared/folder-dot'
import { FOLDER_COLORS } from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import DetailPanel from '@/components/shared/detail-panel'
import InlineEdit from '@/components/shared/inline-edit'
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu'
import { withViewTransition } from '@/components/shared/view-transition'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { notifyToast } from '@/components/shared/toast'
import { loadFailureCopy } from '@/components/shared/api-error-message'
import {
  FORM_PAGE_SIZES,
  SORT_OPTIONS,
  UNFILED_VALUE,
  answerSubText,
  destinationText,
  formAnswerCount,
  formAnswerUrl,
  listQueryString,
  referenceLabel,
  sortForms,
  subLineText,
  validFilter,
  validPage,
  validPageSize,
  validSort,
  type Form,
  type FormFilter,
  type FormListResponse,
  type FormSort,
} from './model'
import styles from './list.module.css'

const VIEWER_NOTE = '閲覧のみで見ています。変える操作は管理者に頼んでください。'

/* 行の「…」を右クリックでも開けるように直す。中身は「…」と同じ。 */
function toContextMenuItems(menuItems: ActionMenuItem[]): ContextMenuItem[] {
  return menuItems.map((item) => ({
    id: item.id,
    label: item.label,
    danger: item.tone === 'danger',
    disabled: item.disabled,
    onSelect: () => item.onSelect(),
  }))
}

/*
 * フォルダの追加・名前の変更（右の詳細パネルの中身）。名前と色を送る。
 * 送り先・文言は今までの V8 一覧と同じ。
 */
function FolderPanelForm({
  accountId,
  folder,
  onCancel,
  onAdded,
}: {
  accountId: string
  folder: Folder | null
  onCancel: () => void
  onAdded: () => void
}) {
  const [name, setName] = useState(folder?.name ?? '')
  const [color, setColor] = useState(folder?.color ?? FOLDER_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError('')
    try {
      const folderUpdates = { name: trimmed, color }
      const res = folder
        ? await api.folders.update(folder.id, folderUpdates, accountId)
        : await api.folders.create({ kind: 'form', name: trimmed, color, accountId })
      if (!res.success) {
        setError(res.error)
        return
      }
      onAdded()
      onCancel()
    } catch {
      setError(folder ? 'フォルダを直せませんでした' : 'フォルダを追加できませんでした')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className={styles.panelNote}>
        フォームを分けてしまう箱です。消しても、入っていたフォームは未分類として残ります。
      </p>
      <label className={styles.panelField}>
        <span className={styles.panelLabel}>
          フォルダ名 <span className={styles.required}>*</span>
        </span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim()) void save()
          }}
          placeholder="例: 01_来店・予約"
          className={styles.panelInput}
        />
      </label>
      <div className={styles.panelField}>
        <span className={styles.panelLabel}>色</span>
        <div className={styles.colorRow}>
          {FOLDER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`色 ${c}`}
              aria-pressed={color === c}
              className={styles.colorSwatch}
              data-selected={color === c || undefined}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      {error ? <p className={styles.alertText} role="alert">{error}</p> : null}
      <div className={styles.panelActions}>
        <Button onClick={onCancel} disabled={saving}>キャンセル</Button>
        <Button variant="primary" onClick={() => void save()} disabled={!name.trim() || saving} busy={saving}>
          {folder ? '直す' : '追加する'}
        </Button>
      </div>
    </div>
  )
}

export default function FormsListV8() {
  usePageTitle('回答フォーム')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId, selectedAccount, loading: accountLoading } = useAccount()
  /*
   * 箱の作成・名前変更・削除・並び替えは `/api/folders` が owner/admin で閉じている。
   * 役割はサーバ（/api/staff/me）で確かめ、答えが来るまでは手元の値で決める。
   * 変えられない人には操作を出さず、閲覧のみの帯（`JV2oR`）を出す。
   */
  const [localCanManage] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())
  const staffRole = useStaffRole()
  // 役割が読めない（null・空の返事）あいだは手元の値。読めた役割だけで決め直す。
  const canManageFolders = staffRole ? canManageRole(staffRole) : localCanManage
  /* 1152 の板（`GrnO4`）。フォルダの列は型が畳み、道具の段を2段にする。 */
  const narrow = useNarrowViewport()

  const [forms, setForms] = useState<Form[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  /** 消す箱に入っているフォーム数。`null` はまだ数えていない。 */
  const [deletingFolderCount, setDeletingFolderCount] = useState<number | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  /** 箱の読み込み・操作の失敗。箱の場所に小さく出す。一覧は普通に出す。 */
  const [folderError, setFolderError] = useState('')
  const [moveTarget, setMoveTarget] = useState<Form | null>(null)
  const [moveFolderId, setMoveFolderId] = useState<string>(UNFILED_VALUE)
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveError, setMoveError] = useState('')
  const [formTotal, setFormTotal] = useState(0)
  /** フォルダ欄の「すべて」件数。絞り込み前の件数（all_total）。 */
  const [folderTotal, setFolderTotal] = useState(0)
  const [activeFolderId, setActiveFolderId] = useState('all')
  const [loading, setLoading] = useState(true)
  /* 戻ってきたら前のスクロール位置へ（絞り込みは前から URL に置いている）。 */
  useListScrollMemory(!loading)
  const [loadError, setLoadError] = useState('')
  /** 掴んだ失敗そのもの。403（権限不足）と 503（通信失敗）の案内を言い分ける。 */
  const [loadFailure, setLoadFailure] = useState<unknown>(null)
  const [query, setQuery] = useState(() => searchParams.get('q') || '')
  /** 実際の取得に使う遅らせた検索語（1打鍵ごとの往復を避ける）。 */
  const [fetchQuery, setFetchQuery] = useState(() => searchParams.get('q') || '')
  /** 管理者確認（担当未割り当て）。URL には載せない。選んだときだけ専用口を読む。 */
  const [reviewMode, setReviewMode] = useState(false)
  const [reviewForbidden, setReviewForbidden] = useState(false)
  const [formFilter, setFormFilter] = useState<FormFilter>(() => validFilter(searchParams.get('filter')))
  const [formSort, setFormSort] = useState<FormSort>(() => validSort(searchParams.get('sort')))
  const [pageSize, setPageSize] = useState(() => validPageSize(searchParams.get('limit')))
  const [page, setPage] = useState(() => validPage(searchParams.get('page')))
  const [duplicateTarget, setDuplicateTarget] = useState<Form | null>(null)
  const [duplicateName, setDuplicateName] = useState('')
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState('')
  /* アーカイブ・削除の窓（`GVizd`）。開いたら影響を読んでから2つの道を出す。 */
  const [deleteTarget, setDeleteTarget] = useState<Form | null>(null)
  const [deleteImpact, setDeleteImpact] = useState<FormDeleteImpact | null>(null)
  const [deleteImpactLoading, setDeleteImpactLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  /* 名前を変更。保存は編集保存と同じ口なので版を添える。 */
  const [renameTarget, setRenameTarget] = useState<Form | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameRevision, setRenameRevision] = useState<number | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState('')
  /* 受付を止める。止めるにも編集の版が要るので影響口で読む。 */
  const [stopTarget, setStopTarget] = useState<Form | null>(null)
  const [stopRevision, setStopRevision] = useState<number | null>(null)
  const [stopImpactLoading, setStopImpactLoading] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  /** 数の帯。取れないときは全部「—」（0 とは言わない）。 */
  const [stats, setStats] = useState<ListStats | null>(null)
  const [statsFailed, setStatsFailed] = useState(false)
  /** 行の「…」。開いている行のID。 */
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  /* 右から出る詳細パネル。管理者確認は読み取り専用なので開かない。 */
  const [activeId, setActiveId] = useState<string | null>(null)
  /* 右クリックされた行（「…」と同じ項目を出す）。 */
  const [contextId, setContextId] = useState<string | null>(null)
  const formRequest = useRef(0)
  const activeAccountRef = useRef<string | null>(selectedAccountId)

  useEffect(() => {
    activeAccountRef.current = selectedAccountId
    // フォルダはアカウント単位。切り替えたら前の帯・窓・選択を残さない。
    setFolders([])
    setUnfiledCount(null)
    setActiveFolderId('all')
    setFolderDialogOpen(false)
    setEditingFolder(null)
    setDeletingFolder(null)
    setFolderError('')
    setDeleteTarget(null)
    setDeleteImpact(null)
    setStopTarget(null)
    setMoveTarget(null)
    setDuplicateTarget(null)
    setRenameTarget(null)
    setOpenMenuId(null)
    setStats(null)
    setStatsFailed(false)
    setPage(1)
  }, [selectedAccountId])

  const clearList = () => {
    setForms([])
    setFolders([])
    setUnfiledCount(null)
    setFormTotal(0)
    setFolderTotal(0)
  }

  const loadForms = useCallback(async () => {
    const request = ++formRequest.current
    if (reviewMode && selectedAccountId) {
      setLoading(true)
      setLoadError('')
      setLoadFailure(null)
      setReviewForbidden(false)
      try {
        const account = `account_id=${encodeURIComponent(selectedAccountId)}`
        const res = await fetchApi<{ success: boolean; data: Form[] }>(`/api/forms/unassigned?${account}`)
        if (!res.success) throw new Error('load_failed')
        if (request !== formRequest.current) return
        // 未割り当て口は配列で返す契約。配列でない応答では一覧を空にして描く。
        const unassigned = Array.isArray(res.data) ? res.data : []
        setForms(unassigned)
        setFolders([])
        setUnfiledCount(null)
        setFormTotal(unassigned.length)
        setFolderTotal(unassigned.length)
      } catch (error) {
        if (request !== formRequest.current) return
        // 権限が無い人は専用口が 403/404 を返す。エラー画面にせず「確認できるものは無い」と伝える。
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setReviewForbidden(true)
        } else {
          setLoadFailure(error)
          setLoadError('回答フォームを読み込めませんでした。')
        }
        clearList()
      } finally {
        if (request === formRequest.current) setLoading(false)
      }
      return
    }
    if (!selectedAccountId) {
      clearList()
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    setLoadFailure(null)
    try {
      const account = `account_id=${encodeURIComponent(selectedAccountId)}`
      const folder = `&folder_id=${encodeURIComponent(activeFolderId)}`
      /* 絞り込み・検索・並び替え・ページ切りは Worker に任せる（1ページ分だけ届く）。 */
      const paging = `&with_list_summary=1&page=${page}&limit=${pageSize}`
        + `&filter=${formFilter}&sort=${formSort}`
        + (fetchQuery.trim() ? `&q=${encodeURIComponent(fetchQuery.trim())}` : '')
      /* フォームと箱は別々に回収する。箱だけ失敗しても一覧と件数は残す。 */
      const [formsResult, foldersResult] = await Promise.allSettled([
        fetchApi<{ success: boolean; data: FormListResponse }>(`/api/forms?${account}${folder}${paging}`),
        api.folders.list('form', selectedAccountId),
      ])
      if (request !== formRequest.current) return
      const formsData = formsResult.status === 'fulfilled' && formsResult.value.success
        ? formsResult.value.data
        : null
      if (formsData === null) {
        setLoadFailure(formsResult.status === 'rejected' ? formsResult.reason : new Error('load_failed'))
        setLoadError('回答フォームを読み込めませんでした。')
        clearList()
        return
      }
      const items = Array.isArray(formsData) ? formsData : formsData.items
      setForms(items)
      setFormTotal(Array.isArray(formsData) ? items.length : formsData.total)
      setFolderTotal(Array.isArray(formsData) ? items.length : (formsData.all_total ?? formsData.total))
      const folderResponse = foldersResult.status === 'fulfilled' && foldersResult.value.success
        ? foldersResult.value
        : null
      if (folderResponse === null) {
        setFolders([])
        setUnfiledCount(null)
        setFolderError('フォルダを読み込めませんでした。')
      } else {
        setFolderError('')
        setFolders(folderResponse.data)
        setUnfiledCount(folderResponse.unfiledCount ?? null)
      }
    } catch (error) {
      if (request !== formRequest.current) return
      setLoadFailure(error)
      setLoadError('回答フォームを読み込めませんでした。')
      clearList()
    } finally {
      if (request === formRequest.current) setLoading(false)
    }
  }, [reviewMode, selectedAccountId, activeFolderId, page, pageSize, formFilter, formSort, fetchQuery])

  useEffect(() => {
    void loadForms()
  }, [loadForms])

  /* 数の帯の4枚。取れなくても一覧は出す。 */
  const loadStats = useCallback(async () => {
    if (!selectedAccountId) {
      setStats(null)
      setStatsFailed(false)
      return
    }
    const accountId = selectedAccountId
    try {
      const res = await api.listStats.get(accountId)
      if (activeAccountRef.current !== accountId) return
      if (res.success) {
        setStats(res.data)
        setStatsFailed(false)
      } else {
        setStatsFailed(true)
      }
    } catch {
      if (activeAccountRef.current === accountId) setStatsFailed(true)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  /* URL（?q=&filter=&sort=&limit=&page=）が替わったら画面の状態へ写す。 */
  const searchKey = searchParams.toString()
  useEffect(() => {
    const params = new URLSearchParams(searchKey)
    setQuery(params.get('q') || '')
    setFormFilter(validFilter(params.get('filter')))
    setFormSort(validSort(params.get('sort')))
    setPageSize(validPageSize(params.get('limit')))
    setPage(validPage(params.get('page')))
  }, [searchKey])

  // 検索語のサーバー取得は少し遅らせ、1打鍵ごとの往復を避ける。
  useEffect(() => {
    const timer = window.setTimeout(() => setFetchQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const listState = { query, filter: formFilter, sort: formSort, pageSize, page }
  const listHref = (next: Partial<typeof listState>) => {
    const queryString = listQueryString({ ...listState, ...next })
    return queryString ? `/form-submissions?${queryString}` : '/form-submissions'
  }
  const updateListState = (next: Partial<typeof listState>) => {
    if (next.query !== undefined) setQuery(next.query)
    if (next.filter !== undefined) setFormFilter(next.filter)
    if (next.sort !== undefined) setFormSort(next.sort)
    if (next.pageSize !== undefined) setPageSize(next.pageSize)
    if (next.page !== undefined) setPage(next.page)
    router.replace(listHref(next), { scroll: false })
  }

  const createDraft = async () => {
    if (creating || !selectedAccountId) return
    setCreating(true)
    setCreateError('')
    try {
      const res = await api.forms.createDraft(selectedAccountId)
      if (!res.success) throw new Error(res.error)
      router.push(`/form-submissions/edit?id=${encodeURIComponent(res.data.id)}&tab=basic`)
    } catch {
      setCreateError('フォームの下書きを作れませんでした。もう一度お試しください。')
    } finally {
      setCreating(false)
    }
  }

  /* ===== 詳細パネル（行の名前→右から出る） ===== */
  const clientFilteredForms = useMemo(() => {
    /*
     * 管理者確認（未割り当て一覧）は専用口が全件を返すので、画面側で絞り込み・並び替え・
     * ページ切りをする。通常一覧は Worker が同じ規則で済ませた1ページ分だけを返す。
     */
    const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP')
    return sortForms(forms, formSort).filter((form) => {
      if (formFilter === 'published' && !form.isActive) return false
      if (formFilter === 'draft' && form.isActive) return false
      if (formFilter === 'stored' && !hasStoredDestination(form.layout, form.onSubmitTagId)) return false
      if (formFilter === 'pending' && !(form.pendingPostActionCount ?? 0)) return false
      if (!normalizedQuery) return true
      return (
        displayFormName(form.name).toLocaleLowerCase('ja-JP').includes(normalizedQuery)
        || form.fields.some((field) => field.label.toLocaleLowerCase('ja-JP').includes(normalizedQuery))
        || form.usedByAccounts.some((account) => account.name.toLocaleLowerCase('ja-JP').includes(normalizedQuery))
      )
    })
  }, [formFilter, query, formSort, forms])

  /* 取り消し待ちの削除（5秒）の行は一覧から外して描く（動きの点検 17 番）。 */
  const deferredDelete = useDeferredDelete()
  const listTotal = reviewMode ? clientFilteredForms.length : formTotal
  const pageCount = Math.max(1, Math.ceil(listTotal / pageSize))
  const visiblePage = Math.min(page, pageCount)
  const pageStart = (visiblePage - 1) * pageSize
  const pageForms = reviewMode
    ? clientFilteredForms.slice(pageStart, pageStart + pageSize)
    : forms
  const visibleForms = deferredDelete.hiddenCount === 0 ? pageForms : pageForms.filter((form) => !deferredDelete.isHidden(form.id))
  /* 行の名前の前の丸は、左のフォルダの列と同じフォルダ（同じ色）を引く。無ければ未分類の輪。 */
  const folderDotOf = (folderId: string | null | undefined) => {
    const folder = folderId ? folders.find((f) => f.id === folderId) : undefined
    return folder ? { name: folder.name, color: folder.color } : null
  }

  const activeIndex = reviewMode ? -1 : visibleForms.findIndex((form) => form.id === activeId)
  const active = activeIndex >= 0 ? visibleForms[activeIndex] : null
  const openDetail = useCallback((id: string) => {
    withViewTransition(() => setActiveId(id))
  }, [])
  const closeDetail = useCallback(() => {
    withViewTransition(() => setActiveId(null))
  }, [])
  const goDetail = (direction: -1 | 1) => {
    const next = visibleForms[activeIndex + direction]
    if (!next) return
    withViewTransition(() => setActiveId(next.id))
  }

  const openDuplicate = (form: Form) => {
    closeDetail()
    setDuplicateTarget(form)
    setDuplicateName(`${displayFormName(form.name)}の複製`)
    setDuplicateError('')
  }

  const duplicateForm = async () => {
    if (!duplicateTarget || duplicating || !selectedAccountId) return
    const name = duplicateName.trim()
    if (!name) {
      setDuplicateError('複製の名前を入力してください。')
      return
    }
    setDuplicating(true)
    setDuplicateError('')
    try {
      const res = await api.forms.duplicate(duplicateTarget.id, selectedAccountId, name)
      if (!res.success) throw new Error(res.error)
      setDuplicateTarget(null)
      // 複製は停止中の下書き。用途に合わせて直せるよう、編集画面を開く。
      router.push(`/form-submissions/edit?id=${encodeURIComponent(res.data.id)}&tab=basic`)
    } catch (error) {
      setDuplicateError(error instanceof ApiError && error.status === 404
        ? '元のフォームが見つかりませんでした。一覧を開き直してください。'
        : 'フォームを複製できませんでした。もう一度お試しください。')
    } finally {
      setDuplicating(false)
    }
  }

  /* アーカイブ・削除の窓を開く。影響（回答数・利用先・版）を先に読む。 */
  const openDelete = async (form: Form) => {
    closeDetail()
    setDeleteTarget(form)
    setDeleteImpact(null)
    setDeleteImpactLoading(true)
    setDeleteError('')
    if (!selectedAccountId) {
      setDeleteImpactLoading(false)
      setDeleteError('LINE公式アカウントを選んでください。')
      return
    }
    try {
      const result = await api.forms.deleteImpact(form.id, selectedAccountId)
      if (!result.success) throw new Error(result.error)
      setDeleteImpact(result.data)
    } catch {
      setDeleteError('アーカイブしたときの影響を確認できませんでした。もう一度開き直してください。')
    } finally {
      setDeleteImpactLoading(false)
    }
  }

  /*
   * 「削除」：影響を先に読み、消しても何も失われないフォーム（未公開・回答 0・利用先 0 で、
   * 完全削除ができるもの）だけ、確かめの窓を出さずに一覧から外し、5秒は「元に戻す」で
   * 取り消せる（動きの点検 17 番）。そうでなければ今までどおり窓（アーカイブを勧める）。
   */
  const requestDelete = async (form: Form) => {
    const accountId = selectedAccountId
    if (!accountId) {
      void openDelete(form)
      return
    }
    let impact: FormDeleteImpact | null = null
    try {
      const result = await api.forms.deleteImpact(form.id, accountId)
      if (result.success) impact = result.data
    } catch {
      impact = null
    }
    const harmless = impact !== null && impact.canDelete && impact.submissionCount === 0 && impact.referenceCount === 0 && !impact.form.isActive
    if (!impact || !harmless) {
      void openDelete(form)
      return
    }
    const revision = impact.revision
    closeDetail()
    deferredDelete.schedule({
      ids: [form.id],
      message: `回答フォーム「${displayFormName(form.name)}」を削除しました`,
      commit: async () => {
        try {
          const result = await api.forms.remove(form.id, accountId, revision)
          if (!result.success) throw new Error('delete_failed')
        } catch (reason) {
          // 応答が失われても、もう消えていれば成功（窓の扱いと同じ）。
          try {
            await api.forms.get(form.id, accountId)
          } catch (checkError) {
            if (checkError instanceof ApiError && checkError.status === 404) return
          }
          throw reason
        }
      },
      onCommitted: () => Promise.all([loadForms(), loadStats()]),
      failureMessage: 'この回答フォームを削除できませんでした。状態を読み直してから、もう一度お試しください。',
    })
  }

  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteImpact(null)
    setDeleteError('')
  }

  /*
   * 窓の実行。完全削除（できるときだけ）と保管で口と文言を分ける。
   * 応答が失われたときは対象を読み直し、既に消えていれば成功として扱う。
   */
  const removeForm = async (permanentDelete: boolean) => {
    if (!deleteTarget || !deleteImpact || deleting || !selectedAccountId) return
    const targetId = deleteTarget.id
    setDeleting(true)
    setDeleteError('')
    const finish = () => {
      setForms((current) => current.filter((form) => form.id !== targetId))
      setDeleteTarget(null)
      setDeleteImpact(null)
      // ページの欠け・件数のずれを残さないよう、サーバー側の一覧を読み直す。
      void loadForms()
      void loadStats()
    }
    try {
      const result = permanentDelete
        ? await api.forms.remove(targetId, selectedAccountId, deleteImpact.revision)
        : await api.forms.archive(targetId, selectedAccountId, deleteImpact.revision)
      if (!result.success) throw new Error('delete_failed')
      finish()
    } catch {
      let gone = false
      try {
        await api.forms.get(targetId, selectedAccountId)
      } catch (checkError) {
        if (checkError instanceof ApiError && checkError.status === 404) gone = true
      }
      if (gone) {
        finish()
      } else {
        setDeleteError(permanentDelete
          ? 'この回答フォームを削除できませんでした。状態を読み直してから、もう一度お試しください。'
          : 'この回答フォームをアーカイブできませんでした。状態を読み直してから、もう一度お試しください。')
      }
    } finally {
      setDeleting(false)
    }
  }

  /* 名前を変更（「…」の中の操作）。一覧は版を持たないので、窓を開くときに1件取得で読む。 */
  const readContentRevision = async (formId: string, accountId: string): Promise<number> => {
    const res = await fetchApi<{ success: boolean; data: { contentRevision?: number } }>(
      `/api/forms/${formId}?account_id=${encodeURIComponent(accountId)}`,
    )
    if (!res.success || !Number.isInteger(res.data.contentRevision)) throw new Error('rename_revision_failed')
    return res.data.contentRevision as number
  }

  const openRename = async (form: Form) => {
    setRenameTarget(form)
    setRenameName(displayFormName(form.name))
    setRenameError('')
    setRenameRevision(null)
    if (!selectedAccountId) {
      setRenameError('LINE公式アカウントを選んでください。')
      return
    }
    try {
      setRenameRevision(await readContentRevision(form.id, selectedAccountId))
    } catch {
      setRenameError('フォームの状態を確認できませんでした。開き直してください。')
    }
  }

  const saveRename = async () => {
    if (!renameTarget || !renameName.trim() || renaming || !selectedAccountId) return
    const name = displayFormName(renameName)
    setRenaming(true)
    setRenameError('')
    try {
      let revision = renameRevision
      if (revision === null) {
        revision = await readContentRevision(renameTarget.id, selectedAccountId)
        setRenameRevision(revision)
      }
      const res = await api.forms.update(renameTarget.id, selectedAccountId, {
        name,
        expectedContentRevision: revision,
      })
      if (!res.success) throw new Error('rename_failed')
      setForms((current) => current.map((form) => (
        form.id === renameTarget.id ? { ...form, name } : form
      )))
      setRenameTarget(null)
      // 名前は検索・名前順の対象。サーバー側の絞り込み・並びとずれないよう読み直す。
      void loadForms()
    } catch (error) {
      setRenameError(error instanceof ApiError && error.status === 409
        ? 'ほかの人が先にこの回答フォームを保存しました。開き直して、もう一度お試しください。'
        : 'フォーム名を変更できませんでした。もう一度お試しください。')
    } finally {
      setRenaming(false)
    }
  }

  const closeRename = () => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError('')
  }

  const openStop = async (form: Form) => {
    closeDetail()
    setStopTarget(form)
    setStopRevision(null)
    setStopImpactLoading(true)
    setStopError('')
    if (!selectedAccountId) {
      setStopImpactLoading(false)
      setStopError('LINE公式アカウントを選んでください。')
      return
    }
    try {
      const result = await api.forms.deleteImpact(form.id, selectedAccountId)
      if (!result.success) throw new Error(result.error)
      setStopRevision(result.data.contentRevision)
    } catch {
      setStopError('フォームの状態を確認できませんでした。もう一度開き直してください。')
    } finally {
      setStopImpactLoading(false)
    }
  }

  const stopAccepting = async () => {
    if (!stopTarget || stopping || !selectedAccountId) return
    setStopping(true)
    setStopError('')
    try {
      /* 受付停止も編集保存と同じ口（`PUT /api/forms/:id`）なので版を免除しない。 */
      let revision = stopRevision
      if (revision === null) {
        const impact = await api.forms.deleteImpact(stopTarget.id, selectedAccountId)
        if (!impact.success) throw new Error('revision_failed')
        revision = impact.data.contentRevision
        setStopRevision(revision)
      }
      const result = await api.forms.update(stopTarget.id, selectedAccountId, {
        isActive: false,
        expectedContentRevision: revision,
      })
      if (!result.success) throw new Error(result.error)
      setForms((current) => current.map((form) => (
        form.id === stopTarget.id ? { ...form, isActive: false } : form
      )))
      setStopTarget(null)
      setStopRevision(null)
      // 公開中/下書きの絞り込み対象が変わるため読み直す。
      void loadForms()
      void loadStats()
    } catch (error) {
      setStopError(error instanceof ApiError && error.status === 409
        ? 'ほかの人が先にこの回答フォームを保存しました。開き直して、もう一度お試しください。'
        : '回答の受付を止められませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setStopping(false)
    }
  }

  /* フォルダの並べ替えは押した瞬間に画面を変え、裏で保存する（5秒は「元に戻す」）。 */
  const moveFolder = (index: number, direction: -1 | 1) => {
    const target = folders[index]
    const neighbor = folders[index + direction]
    if (!target || !neighbor || folderBusy || !selectedAccountId) return
    const before = folders
    const swapped = [...folders]
    swapped[index] = neighbor
    swapped[index + direction] = target
    setFolders(swapped)
    setFolderError('')
    runUndoable({
      message: `フォルダ「${target.name}」の並び順を変えました`,
      commit: async () => {
        const result = await api.folders.swapOrder(target.id, neighbor.id, selectedAccountId)
        if (!result.success) return { success: false, error: result.error }
      },
      undo: () => setFolders(before),
      onCommitted: () => {
        void loadForms()
      },
      failureMessage: '並び順を変えられませんでした。',
    })
  }

  const openFolderDelete = async (folder: Folder) => {
    setDeletingFolder(folder)
    setDeletingFolderCount(null)
    setFolderError('')
    if (!selectedAccountId) return
    try {
      const account = `account_id=${encodeURIComponent(selectedAccountId)}`
      const res = await fetchApi<{ success: boolean; data: FormListResponse }>(
        `/api/forms?${account}&folder_id=${encodeURIComponent(folder.id)}&with_list_summary=1&page=1&limit=1&filter=all&sort=latest-answer`,
      )
      if (res.success) {
        setDeletingFolderCount(Array.isArray(res.data) ? res.data.length : res.data.total)
      }
    } catch {
      setDeletingFolderCount(null)
    }
  }

  const removeFolder = async () => {
    if (!deletingFolder || folderBusy || !selectedAccountId) return
    const targetId = deletingFolder.id
    setFolderBusy(true)
    setFolderError('')
    try {
      const res = await api.folders.delete(targetId, selectedAccountId)
      if (!res.success) throw new Error(res.error)
      setDeletingFolder(null)
      if (activeFolderId === targetId) setActiveFolderId('all')
      await loadForms()
    } catch {
      setFolderError('フォルダを削除できませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

  const openMove = (form: Form) => {
    closeDetail()
    setMoveTarget(form)
    setMoveFolderId(form.folderId ?? UNFILED_VALUE)
    setMoveError('')
  }

  const closeMove = () => {
    if (moveBusy) return
    setMoveTarget(null)
    setMoveError('')
  }

  const moveForm = async () => {
    if (!moveTarget || moveBusy || !selectedAccountId) return
    const nextFolderId = moveFolderId === UNFILED_VALUE ? null : moveFolderId
    if ((moveTarget.folderId ?? null) === nextFolderId) {
      setMoveTarget(null)
      return
    }
    /* 押した瞬間に移した形を見せて窓を閉じ、裏で保存する（動きの点検・7）。失敗したら戻して知らせる。 */
    const target = moveTarget
    const previousFolderId = target.folderId ?? null
    const setFolderOf = (folderId: string | null) => setForms((current) => current.map((form) => (form.id === target.id ? { ...form, folderId } : form)))
    setFolderOf(nextFolderId)
    setMoveTarget(null)
    setMoveError('')
    try {
      const res = await fetchApi<{ success: boolean; data: Form }>(
        `/api/forms/${target.id}?account_id=${encodeURIComponent(selectedAccountId)}`,
        { method: 'PUT', body: JSON.stringify({ folderId: nextFolderId }) },
      )
      if (!res.success) throw new Error('move_failed')
      void loadForms()
    } catch (error) {
      setFolderOf(previousFolderId)
      notifyToast(error instanceof ApiError && error.status === 422
        ? 'そのフォルダはありません。開き直して、もう一度お試しください。'
        : 'フォルダへ移せませんでした。', { tone: 'error' })
    }
  }

  const copyAnswerUrl = async (form: Form) => {
    const url = formAnswerUrl(selectedAccount?.liffId, form.id)
    if (!url) {
      notifyToast('このアカウントの公開URLをまだ作れません。', { tone: 'error' })
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      notifyToast('回答フォームのURLをコピーしました')
    } catch {
      notifyToast('URLをコピーできませんでした。', { tone: 'error' })
    }
  }

  /* 名前のその場の書き換え（詳細パネル）。影響口で読んだ版を付けて同じ更新口へ送る。 */
  const renameForm = async (target: Form, next: string) => {
    if (!selectedAccountId) throw new Error('no_account')
    const trimmed = next.trim()
    if (!trimmed) throw new Error('empty_name')
    if (trimmed === target.name) return
    const impact = await api.forms.deleteImpact(target.id, selectedAccountId)
    if (!impact.success) throw new Error('revision_failed')
    const result = await api.forms.update(target.id, selectedAccountId, {
      name: trimmed,
      expectedContentRevision: impact.data.contentRevision,
    })
    if (!result.success) throw new Error(result.error)
    setForms((current) => current.map((form) => (form.id === target.id ? { ...form, name: trimmed } : form)))
  }

  useEffect(() => {
    if (!loading && !loadError && page > pageCount) updateListState({ page: pageCount })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadError, loading, page, pageCount])

  const filterActive = formFilter !== 'all' || query.trim() !== '' || activeFolderId !== 'all'
  const clearFilters = () => {
    setActiveFolderId('all')
    updateListState({ query: '', filter: 'all', page: 1 })
  }

  /* ===== 数の帯（4枚）。値が無いときは「—」（0とは言わない）。 ===== */
  const formStats = stats?.forms
  const kpis = [
    {
      key: 'published',
      title: '公開中',
      icon: CircleCheck,
      value: statsFailed ? null : formStats?.published ?? null,
      unit: '件',
      detail: `下書き ${statsFailed || !formStats ? '—' : formatNumber(formStats.draft)}件`,
    },
    {
      key: 'monthly-submits',
      title: '今月の回答',
      icon: Inbox,
      value: statsFailed ? null : formStats?.monthlySubmits ?? null,
      unit: '件',
      detail: `先月 ${statsFailed || !formStats ? '—' : formatNumber(formStats.prevMonthSubmits)}件`,
    },
    {
      key: 'completion-rate',
      title: '答え終えた割合',
      icon: Percent,
      value: statsFailed ? null : formStats?.monthlyCompletionRate ?? null,
      unit: '%',
      detail: '開いた人のうち',
    },
    {
      key: 'pending-post-actions',
      title: '後処理の未完',
      icon: TriangleAlert,
      value: statsFailed ? null : formStats?.pendingPostActions ?? null,
      unit: '件',
      detail: 'タグ・シナリオが失敗',
      action: { label: '未完を見る', href: listHref({ filter: 'pending', page: 1 }) },
    },
  ]

  /* ===== 行の「…」（編集・名前を変更・集まった回答・複製・受付を止める・フォルダへ移す・アーカイブ・削除） ===== */
  const rowMenuItems = (form: Form): ActionMenuItem[] => [
    {
      id: 'edit',
      label: '編集',
      onSelect: () => router.push(`/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic`),
    },
    { id: 'rename', label: '名前を変更', onSelect: () => void openRename(form) },
    {
      id: 'responses',
      label: '集まった回答',
      external: true,
      onSelect: () => router.push(`/form-submissions/responses?id=${encodeURIComponent(form.id)}`),
    },
    { id: 'duplicate', label: '複製', onSelect: () => openDuplicate(form) },
    ...(form.isActive
      ? [{ id: 'stop', label: '受付を止める', onSelect: () => void openStop(form) }]
      : []),
    { id: 'move', label: 'フォルダへ移す', onSelect: () => openMove(form) },
    { id: 'archive', label: 'アーカイブ', dividerBefore: true, onSelect: () => void openDelete(form) },
    { id: 'delete', label: '削除', tone: 'danger' as const, onSelect: () => void requestDelete(form) },
  ]

  /* ===== フォルダの列 ===== */
  const folderRows: FolderPanelRow[] = [
    { kind: 'all' as const, id: 'all', label: 'すべて', count: loading || loadError ? null : folderTotal },
    ...folders.map((folder, index) => ({
      kind: 'folder' as const,
      id: folder.id,
      label: folder.name,
      count: folder.itemCount ?? null,
      color: folder.color,
      onEdit: canManageFolders ? () => { closeDetail(); setEditingFolder(folder) } : undefined,
      onMoveUp: canManageFolders && index > 0 ? () => void moveFolder(index, -1) : undefined,
      onMoveDown: canManageFolders && index < folders.length - 1 ? () => void moveFolder(index, 1) : undefined,
      onDelete: canManageFolders ? () => void openFolderDelete(folder) : undefined,
      deleteNote: '削除しても、中のフォームは未分類に残ります。',
    })),
    { kind: 'unfiled' as const, id: UNFILED_VALUE, label: '未分類', count: loading || loadError ? null : unfiledCount },
  ]

  const folderSelectOptions = [
    { value: 'all', label: 'フォルダ：すべて' },
    ...folders.map((folder) => ({ value: folder.id, label: `フォルダ：${folder.name}` })),
    { value: UNFILED_VALUE, label: 'フォルダ：未分類' },
  ]
  const selectFolder = (folderId: string) => {
    setActiveFolderId(folderId)
    updateListState({ page: 1 })
  }

  const createButton = (full: boolean) => (
    <Button
      type="button"
      variant="primary"
      className={full ? 'v8-folder-create w-full' : undefined}
      onClick={createDraft}
      disabled={creating}
      busy={creating}
      busyLabel="下書きを作成中"
    >
      <Plus size={15} aria-hidden="true" />フォームを作る
    </Button>
  )

  const folderPanel = (
    <FolderPanel
      activeId={activeFolderId}
      onSelect={selectFolder}
      onAddFolder={canManageFolders ? () => { closeDetail(); setFolderDialogOpen(true) } : undefined}
      addFolderLabel="フォルダを追加"
      rows={folderRows}
    >
      <p className={styles.folderNote}>フォルダを消しても、中のフォームは未分類に残ります。</p>
      {folderError ? (
        <p role="alert" className={styles.folderNote}>
          {folderError}
          <button type="button" onClick={() => void loadForms()} className={styles.textButton}>
            もう一度
          </button>
        </p>
      ) : null}
    </FolderPanel>
  )

  /* ===== 道具の段の部品（広い板と 1152 で同じものを並べ替える） ===== */
  const onSearch = (value: string) => updateListState({ query: value, page: 1 })
  const filterChips = (
    <div role="group" aria-label="状態で絞り込む" className={styles.chipGroup}>
      <FilterChip
        selected={formFilter === 'published'}
        onChange={(next) => updateListState({ filter: next ? 'published' : 'all', page: 1 })}
        icon={<CircleCheck size={13} aria-hidden="true" />}
      >
        公開中
      </FilterChip>
      <FilterChip
        selected={formFilter === 'draft'}
        onChange={(next) => updateListState({ filter: next ? 'draft' : 'all', page: 1 })}
        icon={<FileText size={13} aria-hidden="true" />}
      >
        下書き
      </FilterChip>
      <FilterChip
        selected={formFilter === 'stored'}
        onChange={(next) => updateListState({ filter: next ? 'stored' : 'all', page: 1 })}
        icon={<IdCard size={13} aria-hidden="true" />}
      >
        情報欄に保存
      </FilterChip>
      {/* 「後処理未完」は数の帯の「未完を見る」から入る絞り込み。選んでいる間だけ札を出す。 */}
      {formFilter === 'pending' ? (
        <FilterChip selected onChange={() => updateListState({ filter: 'all', page: 1 })}>
          後処理未完
        </FilterChip>
      ) : null}
    </div>
  )
  const sortBox = (
    <div className={styles.sortBox}>
      <Select
        aria-label="並び順"
        label="並び"
        value={formSort}
        options={SORT_OPTIONS}
        onChange={(value) => updateListState({ sort: value as FormSort, page: 1 })}
      />
    </div>
  )
  const perPageBox = (
    <div className={styles.perPageBox}>
      <Select
        aria-label="表示件数"
        size="page-size"
        value={String(pageSize)}
        options={FORM_PAGE_SIZES.map((size) => ({ value: String(size), label: `${size}件表示` }))}
        onChange={(value) => updateListState({ pageSize: Number(value), page: 1 })}
      />
    </div>
  )

  /* 1152 の板（GrnO4）：1段目「作る・フォルダ・探す … 件数」、2段目「札・並び」。 */
  const narrowToolbar = (
    <div className={styles.narrowTools}>
      <div className={styles.narrowRow}>
        {reviewMode ? null : createButton(false)}
        {reviewMode ? null : (
          <div className={styles.narrowFolder}>
            <Select aria-label="フォルダ" value={activeFolderId} onChange={selectFolder} options={folderSelectOptions} />
          </div>
        )}
        <div className={styles.narrowSearch}>
          <SearchField
            aria-label="フォーム名・質問文で検索"
            placeholder="フォーム名・質問文"
            value={query}
            onChange={onSearch}
            onClear={() => onSearch('')}
          />
        </div>
        <span className={styles.spacer} aria-hidden="true" />
        {perPageBox}
      </div>
      <div className={styles.narrowRow}>
        {filterChips}
        {sortBox}
      </div>
    </div>
  )

  const wideToolbar = (
    <div className={styles.wideTools}>
      <ListToolbar
        search={{
          placeholder: 'フォーム名・質問文',
          label: 'フォーム名・質問文で検索',
          value: query,
          onChange: onSearch,
        }}
        filters={filterChips}
        trailing={<>{sortBox}{perPageBox}</>}
      />
    </div>
  )

  /* ===== 一覧の中身（読込中・失敗・空・0件・表を分ける） ===== */
  const stateCard = (icon: ReactNode, title: string, desc: string, action?: ReactNode, error = false, node?: string) => (
    <div className={styles.stateCard} data-design-node={node}>
      <span className={styles.stateIcon} data-tone={error ? 'error' : undefined}>{icon}</span>
      <p className={styles.stateTitle}>{title}</p>
      <p className={styles.stateDesc}>{desc}</p>
      {action}
    </div>
  )

  const tableHead = (
    <>
      <colgroup>
        <col />
        {!narrow && <col className={styles.colDest} />}
        <col className={styles.colStatus} />
        <col className={styles.colAnswers} />
        <col className={styles.colUrl} />
        {!reviewMode ? <col className={styles.colMenu} /> : null}
      </colgroup>
      <thead>
        <TableHeadRow>
          <Th className={styles.headCell}>フォーム（質問の数）</Th>
          {!narrow && <Th className={styles.headCell}>保存先</Th>}
          <Th className={styles.headCell}>状態</Th>
          <Th className={styles.headCell}>回答</Th>
          <Th aria-label="URL" />
          {!reviewMode ? <Th aria-label="操作" /> : null}
        </TableHeadRow>
      </thead>
    </>
  )

  const skeleton = (
    <div className={styles.tableWrap} aria-busy="true">
      <span className="sr-only">回答フォームの一覧を読み込んでいます</span>
      <DelayedSkeleton
        loading
        skeleton={
          <DataTable>
            {tableHead}
            <tbody aria-hidden="true">
              {[0, 1, 2, 3, 4].map((index) => (
                <Tr key={index}>
                  <Td><Skeleton className={styles.skeletonName} /></Td>
                  {!narrow && <Td><Skeleton className={styles.skeletonShort} /></Td>}
                  <Td><Skeleton className={styles.skeletonShort} /></Td>
                  <Td><Skeleton className={styles.skeletonShort} /></Td>
                  <Td><Skeleton className={styles.skeletonShort} /></Td>
                  {!reviewMode ? <Td /> : null}
                </Tr>
              ))}
            </tbody>
          </DataTable>
        }
      />
    </div>
  )

  let listBody: ReactNode
  if (accountLoading || (loading && selectedAccountId)) {
    listBody = skeleton
  } else if (!selectedAccountId) {
    listBody = stateCard(
      <ClipboardList size={18} aria-hidden="true" />,
      'LINE公式アカウントを選んでください',
      '上のアカウント切替から、回答フォームを使う公式アカウントを選びます。',
    )
  } else if (loadError) {
    // 403は再試行せず、429は待ち秒数を添える。
    const failure = loadFailureCopy(loadFailure, '回答フォーム')
    listBody = stateCard(
      <TriangleAlert size={18} aria-hidden="true" />,
      failure.title,
      failure.description,
      failure.retryable ? (
        <Button type="button" variant="secondary" onClick={() => void loadForms()}>もう一度読み込む</Button>
      ) : null,
      true,
    )
  } else if (reviewMode && reviewForbidden) {
    listBody = stateCard(
      <ClipboardList size={18} aria-hidden="true" />,
      '確認できる未割り当てフォームはありません',
      '管理者確認は既定テナントの管理者のみ利用できます。',
    )
  } else if (reviewMode && forms.length === 0) {
    listBody = stateCard(
      <ClipboardList size={18} aria-hidden="true" />,
      '担当未割り当てのフォームはありません',
      '担当の決まっていない旧フォームはここに出ます。',
    )
  } else if (listTotal === 0 || folderTotal === 0) {
    /* 修正案 D-2：空の一覧。閲覧のみには作るボタンを出さない。 */
    listBody = (
      <EmptyList
        icon={<ClipboardList aria-hidden="true" />}
        title="まだ回答フォームがありません"
        description="アンケートや申し込みを LINE の中で受け付け、答えを友だち情報に保存します。"
        canCreate={canManageFolders}
        action={
          <Button type="button" variant="primary" onClick={createDraft} disabled={creating} busy={creating} busyLabel="下書きを作成中">
            <Plus size={15} aria-hidden="true" />最初のフォームを作る
          </Button>
        }
        filtered={filterActive}
        onClearFilters={clearFilters}
        filteredDescription="「公開中」「下書き」「情報欄に保存」や検索を外すと、すべて出ます"
        data-design-node="I3L41O-empty"
      />
    )
  } else {
    listBody = (
      <div className={styles.tableWrap}>
        <DataTable>
          {tableHead}
          <tbody>
            {visibleForms.map((form) => {
              const name = displayFormName(form.name)
              const answerCount = formAnswerCount(form)
              const sub = subLineText(form)
              const answerSub = answerSubText(form)
              const destination = destinationText(form)
              const pendingCount = form.pendingPostActionCount ?? 0
              const answerUrl = formAnswerUrl(selectedAccount?.liffId, form.id)
              const nameNode = reviewMode ? (
                <span className={styles.cellTitle} title={name}>{name}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => openDetail(form.id)}
                  title={`${name}の詳細を見る`}
                  aria-label={`「${name}」の詳細を見る`}
                  className={styles.cellTitleButton}
                >
                  {name}
                </button>
              )
              const row = (
                <Tr key={form.id} data-row-id={form.id}>
                  <NameCell
                    name={
                      <span className={styles.nameLine}>
                        <FolderDotName folder={folderDotOf(form.folderId)}>{nameNode}</FolderDotName>
                        {reviewMode && form.accountScopeReviewRequired ? (
                          <span className={styles.reviewBadge}>管理者確認</span>
                        ) : null}
                        {pendingCount > 0 ? (
                          <span className={styles.pendingBadge}>
                            <span className={styles.dot} aria-hidden="true" />
                            {`後処理の未完 ${pendingCount}`}
                          </span>
                        ) : null}
                      </span>
                    }
                    sub={<span className={styles.cellSub} title={sub}>{sub}</span>}
                  />
                  {!narrow && (
                    <Td className={styles.destCell} title={destination}>{destination}</Td>
                  )}
                  <Td>
                    <span className={styles.statusPill} data-tone={form.isActive ? 'live' : 'draft'}>
                      <span className={styles.dot} aria-hidden="true" />
                      {form.isActive ? '公開中' : '下書き'}
                    </span>
                  </Td>
                  <Td className={styles.answerCell}>
                    {reviewMode ? (
                      <span className={styles.answerCount}>{answerCount ? `${formatNumber(answerCount)}件` : '—'}</span>
                    ) : (
                      <Link
                        href={`/form-submissions/responses?id=${encodeURIComponent(form.id)}`}
                        aria-label={`${name}の集まった回答を見る`}
                        title="集まった回答を見る"
                        className={styles.answerCount}
                        data-zero={answerCount === 0 || undefined}
                      >
                        {`${formatNumber(answerCount)}件`}
                      </Link>
                    )}
                    {/*
                      今月は日本時間の1日から数える。完了率＝今月の回答完了÷今月開いた人。
                      試しの回答は入れない。取れていない数は「—」だけ出す（0 とは言わない）。
                    */}
                    <span className={styles.answerSub} title={answerSub}>{answerSub}</span>
                  </Td>
                  <Td>
                    <button
                      type="button"
                      className={styles.urlButton}
                      disabled={!answerUrl}
                      title={answerUrl ? '配っているURLをコピー' : 'このアカウントは公開URLをまだ作れません'}
                      aria-label={`${name}のURLをコピー`}
                      onClick={() => void copyAnswerUrl(form)}
                    >
                      <Link2 size={15} aria-hidden="true" />
                      URL
                    </button>
                  </Td>
                  {!reviewMode ? (
                    /* 管理者確認は読み取り専用。編集・削除・回答の口は担当アカウント経由しか受けない。 */
                    <Td className={styles.menuCell}>
                      {/* 横並びにして、メニューの位置の目印が行を1段増やさないようにする。 */}
                      <div className={styles.menuBox}>
                        <RowMenu
                          title={`「${name}」のその他の操作（編集・集まった回答・複製・受付を止める・フォルダへ移す・アーカイブ・削除）`}
                          label={`「${name}」のその他の操作`}
                          menuLabel={`「${name}」の操作`}
                          items={rowMenuItems(form)}
                          open={openMenuId === form.id}
                          onOpenChange={(next) => setOpenMenuId(next ? form.id : null)}
                        />
                      </div>
                    </Td>
                  ) : null}
                </Tr>
              )
              return row
            })}
          </tbody>
        </DataTable>
      </div>
    )
  }

  /*
   * 右クリックでも「…」と同じ項目（行のどこでも）。管理者確認では出さない。
   * 項目は押した瞬間の行から作る（itemsFor）。state に入れた行から作ると、
   * 1回目は空で開かず、2回目は前に押した行の中身が出ていた。
   */
  const contextForm = visibleForms.find((form) => form.id === contextId) ?? null
  const rowIdOf = (event: ReactMouseEvent) =>
    (event.target as HTMLElement | null)?.closest?.('tr[data-row-id]')?.getAttribute('data-row-id') ?? null
  const listContent = reviewMode || !selectedAccountId || loading || loadError || visibleForms.length === 0 ? listBody : (
    <ContextMenu
      label={contextForm ? `「${displayFormName(contextForm.name)}」の操作` : '回答フォームの操作'}
      items={contextForm ? toContextMenuItems(rowMenuItems(contextForm)) : []}
      shouldOpen={(event) => {
        const id = rowIdOf(event)
        setContextId(id)
        return Boolean(id)
      }}
      itemsFor={(event) => {
        const form = visibleForms.find((item) => item.id === rowIdOf(event))
        return form ? toContextMenuItems(rowMenuItems(form)) : []
      }}
    >
      {listBody}
    </ContextMenu>
  )

  /* ページ送り（絵：左に件数、右に頁）。1ページに収まるときは件数だけ。 */
  const showPager = !loading && !loadError && visibleForms.length > 0
  const listPager = !showPager ? null : pageCount > 1 ? (
    <Pagination
      page={visiblePage}
      pageCount={pageCount}
      onPageChange={(next) => updateListState({ page: next })}
      ariaLabel="回答フォームのページ送り"
      summary={(
        <ListRange
          bare
          className={styles.pagerCount}
          total={listTotal}
          first={pageStart + 1}
          last={Math.min(pageStart + visibleForms.length, listTotal)}
        />
      )}
    />
  ) : (
    <p className={styles.pagerSolo}>{`${formatNumber(listTotal)}件`}</p>
  )

  /* 閲覧のみの帯（`JV2oR`）。見出しの下・数の帯の上。 */
  const viewerBand = !canManageFolders ? (
    <div className={styles.viewerBand} role="status" data-design-node="JV2oR">
      <Eye size={16} aria-hidden="true" />
      <span>{VIEWER_NOTE}</span>
    </div>
  ) : null

  const overlays = (
    <>
      {(folderDialogOpen || editingFolder) && selectedAccountId ? (
        <DetailPanel
          open
          title={editingFolder ? 'フォルダを直す' : 'フォルダを追加'}
          description={editingFolder ? `「${editingFolder.name}」の名前と色を変えます。` : undefined}
          onClose={() => {
            if (folderBusy) return
            withViewTransition(() => {
              setFolderDialogOpen(false)
              setEditingFolder(null)
            })
          }}
        >
          <FolderPanelForm
            key={editingFolder?.id ?? 'new'}
            accountId={selectedAccountId}
            folder={editingFolder}
            onCancel={() => {
              if (folderBusy) return
              setFolderDialogOpen(false)
              setEditingFolder(null)
            }}
            onAdded={() => { setEditingFolder(null); void loadForms() }}
          />
        </DetailPanel>
      ) : null}

      <ConfirmDialog
        open={deletingFolder !== null}
        title={`フォルダ「${deletingFolder?.name ?? ''}」を削除しますか？`}
        description={`削除しても、中のフォームは未分類に残ります。${
          deletingFolderCount === null
            ? 'いまこのフォルダに入っている件数を確認できませんでした。'
            : `いまこのフォルダに入っているのは${formatNumber(deletingFolderCount)}件です。`
        }`}
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

      {moveTarget !== null ? (
        <DetailPanel
          open
          title={`「${displayFormName(moveTarget.name)}」をどのフォルダへ移しますか？`}
          description="回答やURLは変わりません。入れる箱だけが変わります。"
          onClose={() => withViewTransition(closeMove)}
          footer={(
            <div className={styles.panelFooter}>
              <Button type="button" variant="secondary" disabled={moveBusy} onClick={closeMove}>キャンセル</Button>
              <Button type="button" variant="primary" busy={moveBusy} busyLabel="処理中" disabled={moveBusy} onClick={() => void moveForm()}>
                移動する
              </Button>
            </div>
          )}
        >
          {moveError ? <p className={styles.alertText} role="alert">{moveError}</p> : null}
          <RadioCardGroup legend="移動先のフォルダ" className={styles.radioList}>
            {[{ id: UNFILED_VALUE, name: '未分類' }, ...folders.map((folder) => ({ id: folder.id, name: folder.name }))].map((folder) => (
              <RadioCard
                key={folder.id}
                name="move-folder"
                value={folder.id}
                checked={moveFolderId === folder.id}
                onChange={() => setMoveFolderId(folder.id)}
                title={folder.name}
              />
            ))}
          </RadioCardGroup>
        </DetailPanel>
      ) : null}

      {duplicateTarget !== null ? (
        <DetailPanel
          open
          title={`「${displayFormName(duplicateTarget.name)}」を複製しますか？`}
          description="質問・分岐・デザイン・回答後の設定を引き継いだ、受付停止中のフォームを作ります。集まった回答・公開状態・集計は引き継ぎません。"
          onClose={() => {
            if (duplicating) return
            withViewTransition(() => {
              setDuplicateTarget(null)
              setDuplicateError('')
            })
          }}
          footer={(
            <div className={styles.panelFooter}>
              <Button
                type="button"
                variant="secondary"
                disabled={duplicating}
                onClick={() => {
                  if (duplicating) return
                  setDuplicateTarget(null)
                  setDuplicateError('')
                }}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                variant="primary"
                busy={duplicating}
                busyLabel="処理中"
                disabled={duplicating || !duplicateName.trim()}
                onClick={() => void duplicateForm()}
              >
                複製する
              </Button>
            </div>
          )}
        >
          <label className={styles.panelField}>
            <span className={styles.panelLabel}>複製の名前</span>
            <input
              value={duplicateName}
              onChange={(event) => setDuplicateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void duplicateForm()
              }}
              className={styles.panelInput}
            />
          </label>
          {duplicateError ? <p className={styles.alertText} role="alert">{duplicateError}</p> : null}
        </DetailPanel>
      ) : null}

      <DetailPanel
        open={active !== null}
        title={active ? displayFormName(active.name) : ''}
        description={active ? subLineText(active) : undefined}
        onClose={closeDetail}
        hasPrev={activeIndex > 0}
        hasNext={activeIndex >= 0 && activeIndex < visibleForms.length - 1}
        onPrev={activeIndex > 0 ? () => goDetail(-1) : undefined}
        onNext={activeIndex >= 0 && activeIndex < visibleForms.length - 1 ? () => goDetail(1) : undefined}
        footer={active ? (
          <div className={styles.panelFooterSplit}>
            <Button type="button" variant="secondary" href={`/form-submissions/responses?id=${encodeURIComponent(active.id)}`}>
              集まった回答
            </Button>
            <Button type="button" variant="primary" href={`/form-submissions/edit?id=${encodeURIComponent(active.id)}&tab=basic`}>
              編集する
            </Button>
          </div>
        ) : undefined}
      >
        {active ? (
          <div>
            <p className={styles.panelLabel}>フォーム名</p>
            <InlineEdit
              value={active.name}
              label="フォーム名"
              placeholder="名称未設定のフォーム"
              onSave={(next) => renameForm(active, next)}
            />
            <p className={styles.panelLabel}>状態</p>
            <p className={styles.panelValueRow}>
              <span className={styles.statusPill} data-tone={active.isActive ? 'live' : 'draft'}>
                <span className={styles.dot} aria-hidden="true" />
                {active.isActive ? '公開中' : '下書き'}
              </span>
              {(active.pendingPostActionCount ?? 0) > 0 ? (
                <span className={styles.pendingBadge}>
                  <span className={styles.dot} aria-hidden="true" />
                  {`後処理の未完 ${active.pendingPostActionCount}`}
                </span>
              ) : null}
            </p>
            <p className={styles.panelLabel}>保存先</p>
            <p className={styles.panelValue}>{destinationText(active)}</p>
            <p className={styles.panelLabel}>回答</p>
            <p className={styles.panelValue}>
              {`${formatNumber(formAnswerCount(active))}件　${answerSubText(active)}`}
            </p>
            <div className={styles.panelButtons}>
              <Button type="button" variant="secondary" onClick={() => { closeDetail(); openDuplicate(active) }}>複製</Button>
              {active.isActive ? (
                <Button type="button" variant="secondary" onClick={() => { closeDetail(); void openStop(active) }}>受付を止める</Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={() => { closeDetail(); openMove(active) }}>フォルダへ移す</Button>
              <Button type="button" variant="secondary" onClick={() => { closeDetail(); void openDelete(active) }}>アーカイブ・削除</Button>
              <Button type="button" variant="secondary" onClick={() => void copyAnswerUrl(active)}>URLをコピー</Button>
            </div>
          </div>
        ) : null}
      </DetailPanel>

      {/* 受付を止める（メニューから直行）。止めると URL を開いた人には「受付を終了しました」が出る。 */}
      <ConfirmDialog
        open={stopTarget !== null}
        title={stopTarget ? `「${displayFormName(stopTarget.name)}」の受付を止めますか？` : '受付を止めますか？'}
        description="配っている URL を開いた人には「受付を終了しました」と出ます。集まった回答と一覧への表示は残ります。"
        confirmLabel="受付を止める"
        destructive
        busy={stopping || stopImpactLoading}
        error={stopError || undefined}
        onConfirm={stopError || stopRevision !== null ? () => void stopAccepting() : undefined}
        onCancel={() => {
          if (stopping) return
          setStopTarget(null)
          setStopRevision(null)
          setStopError('')
        }}
      >
        {stopImpactLoading ? <p className={styles.dialogNote}>フォームの状態を確認しています。</p> : null}
      </ConfirmDialog>

      {/*
       * アーカイブ・削除の窓（`GVizd`）。2枚の説明カード（アーカイブ＝おすすめ・削除）と
       * 利用先の注意、下に「削除する｜キャンセル・アーカイブする」。
       * 削除できるのは「未公開・回答なし・利用先なし」のときだけ。
       */}
      <Dialog
        open={deleteTarget !== null}
        designNode="GVizd"
        /* 絵は幅 640・上から 220。 */
        designWidth={640}
        designTop={220}
        title={deleteTarget ? `「${displayFormName(deleteTarget.name)}」をどうしますか` : 'フォームをどうしますか'}
        designHeaderPadding="var(--tpl-fm2-dialog-head-pad)"
        busy={deleting || deleteImpactLoading}
        onCancel={closeDelete}
        footer={(
          <div className={styles.dialogActions}>
            <span className={styles.dialogActionsSide}>
              <Button
                type="button"
                variant="danger"
                disabled={deleting || deleteImpactLoading || !deleteImpact?.canDelete}
                title={deleteImpact && !deleteImpact.canDelete ? '未公開・回答なし・利用先なしのフォームだけ削除できます' : undefined}
                onClick={() => void removeForm(true)}
              >
                削除する
              </Button>
            </span>
            <Button type="button" variant="secondary" disabled={deleting || deleteImpactLoading} onClick={closeDelete}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant="primary"
              busy={deleting}
              busyLabel="処理中"
              disabled={deleting || deleteImpactLoading || !deleteImpact?.canArchive}
              onClick={() => void removeForm(false)}
            >
              <Archive size={15} aria-hidden="true" />
              アーカイブする
            </Button>
            <span className={styles.dialogActionsSide} aria-hidden="true" />
          </div>
        )}
      >
        {/* 絵は頭（題と×）・説明・2枚のカード・注意の帯・ボタンを 14 ずつで並べる。共通の窓の中身の余白（上下24）を詰める。 */}
        <div className={styles.archiveBody}>
        {deleteImpact?.form.isActive ? (
          <p className={styles.archiveLead}>配っている URL を開いた人には「受付を終了しました」と出ます。</p>
        ) : null}
        {deleteImpactLoading ? (
          <p className={styles.dialogNote}>公開状態・回答数・利用中の場所を確認しています。</p>
        ) : deleteImpact ? (
          <>
          <div className={styles.impactOptions}>
            <div className={styles.impactOption} data-tone="recommended">
              <p className={styles.impactOptionTitle}>アーカイブする（おすすめ）</p>
              <p className={styles.impactOptionDesc}>
                {`一覧から隠します。集まった回答 ${formatNumber(deleteImpact.submissionCount)}件 と友だち情報に保存した答えは残ります。`}
              </p>
            </div>
            <div className={styles.impactOption} data-disabled={deleteImpact.canDelete ? undefined : ''}>
              <p className={styles.impactOptionTitle} data-tone="danger">削除する</p>
              <p className={styles.impactOptionDesc}>
                {deleteImpact.canDelete
                  ? '未公開・回答なし・利用先なしのため、完全に削除できます。この操作は元に戻せません。'
                  : '回答や利用先があるので削除できません。削除できるのは、未公開・回答なし・利用先なしのフォームだけです。'}
              </p>
            </div>
          </div>
            {deleteImpact.references.length > 0 ? (
              <p className={styles.impactWarn} title={deleteImpact.answerUrl ? `開けなくなる公開URL：${deleteImpact.answerUrl}` : undefined}>
                <TriangleAlert size={16} aria-hidden="true" />
                <span>{`${deleteImpact.references.map(referenceLabel).join('と')}がこのフォームを開きます。`}</span>
              </p>
            ) : null}
            {/* 利用先の注意があるときは、その札の title に URL を入れる（絵の窓に URL の行は無い）。 */}
            {deleteImpact.answerUrl && deleteImpact.references.length === 0 ? (
              <p className={styles.dialogNote}>
                開けなくなる公開URL：<span className={styles.breakAll}>{deleteImpact.answerUrl}</span>
              </p>
            ) : null}
          </>
        ) : null}
        {deleteError ? <p className={styles.alertText} role="alert">{deleteError}</p> : null}
        </div>
      </Dialog>

      {/* 名前を変更。回答データやURLは変わらない。 */}
      <Dialog
        open={renameTarget !== null}
        title="フォーム名を変更"
        description="回答データやURLは変わりませんが、回答者に表示されるフォーム名も変わります。"
        busy={renaming}
        onCancel={closeRename}
        footer={(
          <div className={styles.panelFooter}>
            <Button type="button" variant="secondary" disabled={renaming} onClick={closeRename}>キャンセル</Button>
            <Button
              type="button"
              variant="primary"
              busy={renaming}
              busyLabel="保存中"
              disabled={renaming || !renameName.trim()}
              onClick={() => void saveRename()}
            >
              保存する
            </Button>
          </div>
        )}
      >
        <label className={styles.panelField}>
          <span className={styles.panelLabel}>フォーム名</span>
          <input
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            disabled={renaming}
            maxLength={100}
            className={styles.panelInput}
          />
        </label>
        {renameError ? <p className={styles.alertText} role="alert">{renameError}</p> : null}
      </Dialog>
    </>
  )

  return (
    /* 一覧の状態（読込中・失敗・空・表）を外から待てるように出す。箱は作らない（display: contents）。 */
    <div
      className={styles.root}
      data-list-state={accountLoading || loading ? 'loading' : loadError ? 'error' : visibleForms.length === 0 ? 'empty' : 'ready'}
    >
      <ListPage
        boardId={narrow ? 'GrnO4' : 'I3L41O'}
        headingSize="regular"
        title="回答フォーム"
        description="LINEの中で開くアンケート・申し込みフォームです。答えは友だち情報に保存できます。"
        /* 絵に無い機能（管理者確認）は見出しの右に小さく残す。 */
        actions={(
          <FilterChip selected={reviewMode} onChange={(next) => { setReviewMode(next); setPage(1) }}>
            {reviewMode ? '通常の一覧に戻る' : '管理者確認（担当未割り当て）'}
          </FilterChip>
        )}
        tabs={viewerBand}
        stats={reviewMode ? undefined : (
          /* 数の帯 4つ。管理者確認は別のアカウント群の数なので出さない。 */
          <KpiBand data-design="KPIs" className={styles.kpiStrip}>
            {kpis.map((kpi) => (
              <KpiCard
                key={kpi.key}
                presentation="band"
                title={kpi.title}
                icon={<kpi.icon size={13} aria-hidden="true" />}
                value={kpi.value}
                unit={kpi.value == null ? '' : kpi.unit}
                detail={narrow ? <span className={styles.kpiDetailWrap}>{kpi.detail}</span> : kpi.detail}
                action={kpi.action}
              />
            ))}
          </KpiBand>
        )}
        folderNav={narrow ? undefined : { rows: folderRows, activeId: activeFolderId, onSelect: selectFolder, createAction: createButton(false) }}
        folders={reviewMode ? undefined : <>{createButton(true)}{folderPanel}</>}
        toolbar={(
          <>
            {narrow ? narrowToolbar : wideToolbar}
            {reviewMode ? (
              <div className={styles.reviewNote}>
                <p><strong>管理者確認中のフォーム</strong> — 担当アカウントが決まっていない旧フォームだけを出しています。公開URLは生きているため回答は入り続けます。</p>
                <p>担当の割り当ては後続の対応で行います。この画面では割り当て操作はできません。</p>
              </div>
            ) : null}
            {createError ? (
              <p className={styles.errorBand} role="alert">
                {createError}
                <button type="button" className={styles.textButton} onClick={() => setCreateError('')}>閉じる</button>
              </p>
            ) : null}
          </>
        )}
        pagination={listPager}
        overlays={overlays}
      >
        {listContent}
      </ListPage>
    </div>
  )
}
