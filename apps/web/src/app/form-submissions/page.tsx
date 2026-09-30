'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { X } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { fetchApi } from '@/lib/api'
import { api, ApiError, type FormDeleteImpact } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { displayFormName, sortFormsByLatestAnswer } from './form-list'
import Button from '@/components/shared/button'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ListState from '@/components/shared/list-state'
import { RowActions } from '@/components/shared/row-actions'
import Select from '@/components/shared/select'
import ListToolbar from '@/components/shared/list-toolbar'
import FilterChip from '@/components/shared/filter-chip'
import Pagination from '@/components/shared/pagination'
import StatusBadge from '@/components/shared/status-badge'
import type { Folder, FormLayout } from '@line-crm/shared'
import { hasStoredDestination, summarizeFormDestinations } from './form-destination-summary'
import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'
import CopyTextButton from '@/components/ui/copy-text-button'
import HelpTip from '@/components/shared/help-tip'
import ListRange from '@/components/ui/list-range'
import { TableHeadRow, Th } from '@/components/shared/table'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import './form-submissions.css'
import { formatDay, formatNumber } from '@/lib/format'

interface UsedByAccount {
  id: string
  name: string
  country: string | null
  displayOrder: number
  count: number
}

interface Form {
  id: string
  name: string
  description: string | null
  fields: Array<{ name: string; label: string; type?: string }>
  layout: FormLayout
  onSubmitTagId: string | null
  isActive: boolean
  status: 'active' | 'archived'
  revision: number
  submitCount?: number
  /**
   * P（一覧の数）：日本時間の1日から数えた今月の回答完了数・開いた人数・完了率。
   * 取れていないときは null（「—」と出す。0 とは言わない）。
   */
  monthlySubmitCount?: number | null
  monthlyOpenCount?: number | null
  monthlyCompletionRate?: number | null
  folderId?: string | null
  destinationSummary?: { friendFieldCount: number; tagCount: number }
  createdAt: string
  updatedAt: string | null
  lastSubmittedAt: string | null
  usedByAccounts: UsedByAccount[]
  accountScopeReviewRequired?: boolean
}

/**
 * 「未分類」の送り値。`GET /api/forms` の `folder_id=unfiled` と同じ。
 * フォルダのIDとは重ならないよう、予約語として扱う。
 */
const UNFILED_VALUE = 'unfiled'

type FormListResponse = Form[] | {
  items: Form[]
  /** 絞り込み後の総件数（ページ送りの母数）。 */
  total: number
  /** フォルダ範囲だけの総件数（フォルダ欄の「すべて」表示用。#1060で追加）。 */
  all_total?: number
  page: number
  limit: number
}

type FormFilter = 'all' | 'published' | 'draft' | 'stored'
type FormSort = 'latest-answer' | 'answers' | 'updated' | 'name'

const FORM_PAGE_SIZES = [20, 50, 100] as const

function formAnswerCount(form: Form): number {
  return form.submitCount ?? form.usedByAccounts.reduce((sum, account) => sum + account.count, 0)
}

function validSort(value: string | null): FormSort {
  return value === 'answers' || value === 'updated' || value === 'name' ? value : 'latest-answer'
}

function validFilter(value: string | null): FormFilter {
  return value === 'published' || value === 'draft' || value === 'stored' ? value : 'all'
}

function validPageSize(value: string | null): number {
  const parsed = Number(value)
  return FORM_PAGE_SIZES.includes(parsed as (typeof FORM_PAGE_SIZES)[number]) ? parsed : 20
}

function validPage(value: string | null): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function compareDatesNewest(first: string | null | undefined, second: string | null | undefined): number {
  if (first && second) return new Date(second).getTime() - new Date(first).getTime()
  if (first) return -1
  if (second) return 1
  return 0
}

function sortForms(forms: Form[], sort: FormSort): Form[] {
  if (sort === 'latest-answer') return sortFormsByLatestAnswer(forms)
  return [...forms].sort((first, second) => {
    if (sort === 'answers') {
      const countDifference = formAnswerCount(second) - formAnswerCount(first)
      if (countDifference !== 0) return countDifference
      return compareDatesNewest(first.updatedAt, second.updatedAt) || first.id.localeCompare(second.id)
    }
    if (sort === 'updated') {
      return compareDatesNewest(first.updatedAt, second.updatedAt) || first.id.localeCompare(second.id)
    }
    return displayFormName(first.name).localeCompare(displayFormName(second.name), 'ja-JP') || first.id.localeCompare(second.id)
  })
}

function displayUpdatedAt(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDay(date)
}

export default function FormSubmissionsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  /*
   * 箱の作成・名前変更・削除・並び替えは `POST/PATCH/DELETE /api/folders` が
   * `requireRole('owner', 'admin')` で閉じている。staff へ操作を見せると
   * 押しても 403 になるだけなので、操作ごと出さない（テンプレート一覧と同じ）。
   * 自動化の操作可否（useCanManage）では見ない。あれは項目キーがあれば
   * staff も通るが、箱の口は役割だけを見るため食い違う。
   */
  const [canManageFolders] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())
  const [forms, setForms] = useState<Form[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
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
  const [loadError, setLoadError] = useState('')
  /**
   * R602: 掴んだ失敗そのもの。描画側で `ListState error=` に渡し、
   * 403（権限不足）と 503（通信失敗）の案内を言い分ける。
   */
  const [loadFailure, setLoadFailure] = useState<unknown>(null)
  const [query, setQuery] = useState(() => searchParams.get('q') || '')
  /**
   * #1060: 検索は Worker 側で絞る。1打鍵ごとの往復を避けるため、
   * 実際の取得には遅延した語を使う。
   */
  const [fetchQuery, setFetchQuery] = useState(() => searchParams.get('q') || '')
  /**
   * 管理者確認モード(#724)。通常一覧へ混ぜず、選んだときだけ未割当専用口を叩く。
   * URLには載せない。通常一覧の絞り込み・ページ送りの挙動を変えないため。
   */
  const [reviewMode, setReviewMode] = useState(false)
  const [reviewForbidden, setReviewForbidden] = useState(false)
  const [formFilter, setFormFilter] = useState<FormFilter>(() => validFilter(searchParams.get('filter')))
  const [formSort, setFormSort] = useState<FormSort>(() => validSort(searchParams.get('sort')))
  const [pageSize, setPageSize] = useState(() => validPageSize(searchParams.get('limit')))
  const [page, setPage] = useState(() => validPage(searchParams.get('page')))
  const [editingForm, setEditingForm] = useState<Form | null>(null)
  const [editingName, setEditingName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [renameError, setRenameError] = useState('')
  /** 名前変更の保存に添える編集の版。一覧は持っていないので開くときに読む。 */
  const [renameRevision, setRenameRevision] = useState<number | null>(null)
  // 名前変更の窓も共通の約束へ: Escapeで閉じる（保存中は止める）・
  // Tabは窓の中・閉じたら起点へ戻す。
  const renamePanelRef = useOverlayFocus(!!editingForm, () => setEditingForm(null), savingName)
  /*
   * R230: フォーム全体の複製。質問・分岐・デザイン・受付設定を引き継いだ
   * 別IDの停止中フォームを作る。回答・公開状態・集計は引き継がない。
   */
  const [duplicateTarget, setDuplicateTarget] = useState<Form | null>(null)
  const [duplicateName, setDuplicateName] = useState('')
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Form | null>(null)
  const [deleteImpact, setDeleteImpact] = useState<FormDeleteImpact | null>(null)
  const [deleteImpactLoading, setDeleteImpactLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const formRequest = useRef(0)

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
        setForms(res.data)
        setFolders([])
        setFormTotal(res.data.length)
        setFolderTotal(res.data.length)
      } catch (error) {
        if (request !== formRequest.current) return
        // 権限が無い人（staff・制限付き・別テナント）は専用口が403/404を返す。
        // エラー画面にせず「確認できるものは無い」と伝える(#724)。
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setReviewForbidden(true)
          setForms([])
          setFolders([])
          setFormTotal(0)
          setFolderTotal(0)
        } else {
          setLoadFailure(error)
          setLoadError('回答フォームを読み込めませんでした。')
          setForms([])
          setFolders([])
          setFormTotal(0)
          setFolderTotal(0)
        }
      } finally {
        if (request === formRequest.current) setLoading(false)
      }
      return
    }
    if (!selectedAccountId) {
      setForms([])
      setFolders([])
      setFormTotal(0)
      setFolderTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    setLoadFailure(null)
    try {
      const account = `account_id=${encodeURIComponent(selectedAccountId)}`
      // N-175 (#805): フォルダ絞りはサーバーが正本。選択をfolder_idで渡す。
      const folder = `&folder_id=${encodeURIComponent(activeFolderId)}`
      /*
       * #1060: 絞り込み・検索・並び替え・ページ切りは Worker と同じ規則で
       * サーバー側に任せる（規則の正本は @line-crm/shared）。応答は
       * 1ページ分だけで、全件をブラウザへ運ばない。
       */
      const paging = `&with_list_summary=1&page=${page}&limit=${pageSize}`
        + `&filter=${formFilter}&sort=${formSort}`
        + (fetchQuery.trim() ? `&q=${encodeURIComponent(fetchQuery.trim())}` : '')
      /*
       * R603: フォームと箱は別々に回収する（allSettled）。
       * 箱だけ 503 のときに Promise.all だとフォーム7件まで消え
       * 全面エラーになっていた。一覧と件数は残し、箱の場所にだけ
       * 失敗と再試行を出す。
       */
      const [formsResult, foldersResult] = await Promise.allSettled([
        fetchApi<{ success: boolean; data: FormListResponse }>(`/api/forms?${account}${folder}${paging}`),
        api.folders.list('form', selectedAccountId),
      ])
      if (request !== formRequest.current) return
      const formsData = formsResult.status === 'fulfilled' && formsResult.value.success
        ? formsResult.value.data
        : null
      if (formsData === null) {
        // R602: フォーム自体が取れないときだけ全面エラーにする。
        // 403 は描画側で権限の案内へ切り替えるため、失敗を残す。
        setLoadFailure(formsResult.status === 'rejected' ? formsResult.reason : new Error('load_failed'))
        setLoadError('回答フォームを読み込めませんでした。')
        setForms([])
        setFolders([])
        setFormTotal(0)
        setFolderTotal(0)
        return
      }
      const items = Array.isArray(formsData) ? formsData : formsData.items
      setForms(items)
      setFormTotal(Array.isArray(formsData) ? items.length : formsData.total)
      setFolderTotal(Array.isArray(formsData) ? items.length : (formsData.all_total ?? formsData.total))
      // 箱だけ取れないときは一覧を落とさない。箱の場所に小さく出す。
      const foldersData = foldersResult.status === 'fulfilled' && foldersResult.value.success
        ? foldersResult.value.data
        : null
      if (foldersData === null) {
        setFolders([])
        setFolderError('フォルダを読み込めませんでした。')
      } else {
        setFolderError('')
        setFolders(foldersData)
      }
    } catch (error) {
      if (request !== formRequest.current) return
      // 両方を回収しているため、ここへ来るのは想定外の失敗だけ。
      setLoadFailure(error)
      setLoadError('回答フォームを読み込めませんでした。')
      setForms([])
      setFolders([])
      setFormTotal(0)
      setFolderTotal(0)
    } finally {
      if (request === formRequest.current) setLoading(false)
    }
  }, [reviewMode, selectedAccountId, activeFolderId, page, pageSize, formFilter, formSort, fetchQuery])

  useEffect(() => {
    void loadForms()
  }, [loadForms])

  const searchKey = searchParams.toString()
  useEffect(() => {
    const params = new URLSearchParams(searchKey)
    setQuery(params.get('q') || '')
    setFormFilter(validFilter(params.get('filter')))
    setFormSort(validSort(params.get('sort')))
    setPageSize(validPageSize(params.get('limit')))
    setPage(validPage(params.get('page')))
  }, [searchKey])

  // #1060: 検索語のサーバー取得は少し遅らせ、1打鍵ごとの往復を避ける。
  useEffect(() => {
    const timer = window.setTimeout(() => setFetchQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const updateListState = (next: Partial<{
    query: string
    filter: FormFilter
    sort: FormSort
    pageSize: number
    page: number
  }>) => {
    const state = {
      query: next.query ?? query,
      filter: next.filter ?? formFilter,
      sort: next.sort ?? formSort,
      pageSize: next.pageSize ?? pageSize,
      page: next.page ?? page,
    }
    if (next.query !== undefined) setQuery(next.query)
    if (next.filter !== undefined) setFormFilter(next.filter)
    if (next.sort !== undefined) setFormSort(next.sort)
    if (next.pageSize !== undefined) setPageSize(next.pageSize)
    if (next.page !== undefined) setPage(next.page)

    const params = new URLSearchParams()
    if (state.query) params.set('q', state.query)
    if (state.filter !== 'all') params.set('filter', state.filter)
    if (state.sort !== 'latest-answer') params.set('sort', state.sort)
    if (state.pageSize !== 20) params.set('limit', String(state.pageSize))
    if (state.page !== 1) params.set('page', String(state.page))
    const queryString = params.toString()
    router.replace(queryString ? `/form-submissions?${queryString}` : '/form-submissions', { scroll: false })
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

  /*
   * R27: 名前の変更は「…」の中の操作。保存は編集保存と同じ口を通るので、
   * 確認した編集の版を添える。一覧は版を持っていないため、窓を開くときに
   * 1件取得で読む。版なしで送ると口が 400 にする（#723）。
   */
  const openRename = async (form: Form) => {
    setEditingForm(form)
    setEditingName(displayFormName(form.name))
    setRenameError('')
    setRenameRevision(null)
    if (!selectedAccountId) {
      setRenameError('LINE公式アカウントを選んでください。')
      return
    }
    try {
      const res = await fetchApi<{ success: boolean; data: { contentRevision?: number } }>(
        `/api/forms/${form.id}?account_id=${encodeURIComponent(selectedAccountId)}`,
      )
      if (!res.success) throw new Error('rename_revision_failed')
      const revision = res.data.contentRevision
      if (!Number.isInteger(revision)) throw new Error('rename_revision_failed')
      setRenameRevision(revision as number)
    } catch {
      setRenameError('フォームの状態を確認できませんでした。開き直してください。')
    }
  }

  const saveName = async () => {
    if (!editingForm || !editingName.trim() || savingName || !selectedAccountId) return
    const name = displayFormName(editingName)
    setSavingName(true)
    setRenameError('')
    try {
      let revision = renameRevision
      if (revision === null) {
        const res = await fetchApi<{ success: boolean; data: { contentRevision?: number } }>(
          `/api/forms/${editingForm.id}?account_id=${encodeURIComponent(selectedAccountId)}`,
        )
        if (!res.success || !Number.isInteger(res.data.contentRevision)) {
          throw new Error('rename_revision_failed')
        }
        revision = res.data.contentRevision as number
        setRenameRevision(revision)
      }
      const res = await fetchApi<{ success: boolean; data: Form }>(`/api/forms/${editingForm.id}?account_id=${encodeURIComponent(selectedAccountId)}`, {
        method: 'PUT',
        body: JSON.stringify({ name, expectedContentRevision: revision }),
      })
      if (!res.success) throw new Error('rename_failed')
      setForms((current) => current.map((form) => (
        form.id === editingForm.id ? { ...form, name } : form
      )))
      setEditingForm(null)
      // 名前は検索・名前順の対象。サーバー側の絞り込み・並びとずれないよう読み直す。
      void loadForms()
    } catch (error) {
      setRenameError(error instanceof ApiError && error.status === 409
        ? 'ほかの人が先にこの回答フォームを保存しました。開き直して、もう一度お試しください。'
        : 'フォーム名を変更できませんでした。もう一度お試しください。')
    } finally {
      setSavingName(false)
    }
  }

  const openDuplicate = (form: Form) => {
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

  const openDelete = async (form: Form) => {
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

  const removeForm = async () => {
    if (!deleteTarget || !deleteImpact || deleting || stopping || !selectedAccountId) return
    const targetId = deleteTarget.id
    // 完全削除と保管で文言を分ける。削除したのに「アーカイブできなかった」と
    // 出ると、結果を誤認して不要な再試行が起きる（R199）。
    const permanentDelete = deleteImpact.canDelete
    setDeleting(true)
    setDeleteError('')
    try {
      const result = permanentDelete
        ? await api.forms.remove(targetId, selectedAccountId, deleteImpact.revision)
        : await api.forms.archive(targetId, selectedAccountId, deleteImpact.revision)
      if (!result.success) throw new Error('delete_failed')
      setForms((current) => current.filter((form) => form.id !== targetId))
      setDeleteTarget(null)
      // ページの欠け・件数のずれを残さないよう、サーバー側の一覧を読み直す。
      void loadForms()
    } catch {
      /*
       * R199: 処理済みなのに失敗を返す経路をなくす。応答が失われたときは
       * 対象を読み直し、既に消えていれば成功として扱う（行を外して閉じる）。
       * 残っているときだけ失敗文を出す。どちらの操作をしたかが分かる文言にする。
       */
      let gone = false
      try {
        await api.forms.get(targetId, selectedAccountId)
      } catch (checkError) {
        // 保管済みも取得口では見つからない（404）。どちらも一覧には戻らない。
        if (checkError instanceof ApiError && checkError.status === 404) gone = true
      }
      if (gone) {
        setForms((current) => current.filter((form) => form.id !== targetId))
        setDeleteTarget(null)
        void loadForms()
      } else {
        setDeleteError(permanentDelete
          ? 'この回答フォームを削除できませんでした。状態を読み直してから、もう一度お試しください。'
          : 'この回答フォームをアーカイブできませんでした。状態を読み直してから、もう一度お試しください。')
      }
    } finally {
      setDeleting(false)
    }
  }

  /*
   * R25: 箱の並び替え。2つの更新は口が1回で行う。途中で片方だけ変わらない。
   */
  const moveFolder = async (index: number, direction: -1 | 1) => {
    const target = folders[index]
    const neighbor = folders[index + direction]
    if (!target || !neighbor || folderBusy || !selectedAccountId) return
    setFolderBusy(true)
    setFolderError('')
    try {
      const result = await api.folders.swapOrder(target.id, neighbor.id, selectedAccountId)
      if (!result.success) throw new Error(result.error)
      await loadForms()
    } catch {
      setFolderError('並び順を変えられませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

  const openFolderDelete = async (folder: Folder) => {
    setDeletingFolder(folder)
    setDeletingFolderCount(null)
    setFolderError('')
    if (!selectedAccountId) return
    // 消す前に中の件数を読む。取れなくても消す操作自体はできる。
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
    setMoveTarget(form)
    setMoveFolderId(form.folderId ?? UNFILED_VALUE)
    setMoveError('')
  }

  const moveForm = async () => {
    if (!moveTarget || moveBusy || !selectedAccountId) return
    const nextFolderId = moveFolderId === UNFILED_VALUE ? null : moveFolderId
    if ((moveTarget.folderId ?? null) === nextFolderId) {
      setMoveTarget(null)
      return
    }
    setMoveBusy(true)
    setMoveError('')
    try {
      const res = await fetchApi<{ success: boolean; data: Form }>(
        `/api/forms/${moveTarget.id}?account_id=${encodeURIComponent(selectedAccountId)}`,
        { method: 'PUT', body: JSON.stringify({ folderId: nextFolderId }) },
      )
      if (!res.success) throw new Error('move_failed')
      setMoveTarget(null)
      await loadForms()
    } catch (error) {
      setMoveError(error instanceof ApiError && error.status === 422
        ? 'そのフォルダはありません。開き直して、もう一度お試しください。'
        : 'フォルダへ移せませんでした。もう一度お試しください。')
    } finally {
      setMoveBusy(false)
    }
  }

  const stopAccepting = async () => {
    if (!deleteTarget || !deleteImpact || stopping || deleting || !selectedAccountId) return
    setStopping(true)
    setDeleteError('')
    try {
      /*
       * #723: 受付停止も編集保存と同じ口（`PUT /api/forms/:id`）を通る。
       * だから版を免除しない。免除すると、止めたはずのフォームが編集画面の
       * 保存で公開中に戻り、回答が入り続ける。
       *
       * 版は押す直前に読み直した `deleteImpact` から渡す。`revision`（影響の版）
       * ではなく `contentRevision`（編集の版）を渡す。
       */
      const result = await api.forms.update(deleteTarget.id, selectedAccountId, {
        isActive: false,
        expectedContentRevision: deleteImpact.contentRevision,
      })
      if (!result.success) throw new Error(result.error)
      setForms((current) => current.map((form) => (
        form.id === deleteTarget.id ? { ...form, isActive: false } : form
      )))
      setDeleteTarget(null)
      setDeleteImpact(null)
      // 公開中/下書きの絞り込み対象が変わるため読み直す。
      void loadForms()
    } catch (error) {
      setDeleteError(error instanceof ApiError && error.status === 409
        ? 'ほかの人が先にこの回答フォームを保存しました。開き直して、もう一度お試しください。'
        : '回答の受付を止められませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setStopping(false)
    }
  }

  /*
   * 管理者確認モード（未割り当て一覧）は専用口が全件を返すので、従来どおり
   * 画面側で絞り込み・並び替え・ページ切りをする。通常一覧は Worker が
   * 同じ規則（@line-crm/shared）で済ませた1ページ分だけを返す（#1060）。
   */
  const clientFilteredForms = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP')
    return sortForms(forms, formSort).filter((form) => {
      // N-175 (#805): フォルダ絞りはサーバーが済ませている。画面では絞らない。
      if (formFilter === 'published' && !form.isActive) return false
      if (formFilter === 'draft' && form.isActive) return false
      if (formFilter === 'stored' && !hasStoredDestination(form.layout, form.onSubmitTagId)) return false
      if (!normalizedQuery) return true
      return (
        displayFormName(form.name).toLocaleLowerCase('ja-JP').includes(normalizedQuery)
        || form.fields.some((field) => field.label.toLocaleLowerCase('ja-JP').includes(normalizedQuery))
        || form.usedByAccounts.some((account) => account.name.toLocaleLowerCase('ja-JP').includes(normalizedQuery))
      )
    })
  }, [formFilter, query, formSort, forms])

  const listTotal = reviewMode ? clientFilteredForms.length : formTotal
  const pageCount = Math.max(1, Math.ceil(listTotal / pageSize))
  const visiblePage = Math.min(page, pageCount)
  const pageStart = (visiblePage - 1) * pageSize
  const visibleForms = reviewMode
    ? clientFilteredForms.slice(pageStart, pageStart + pageSize)
    : forms

  useEffect(() => {
    if (!loading && !loadError && page > pageCount) updateListState({ page: pageCount })
    // updateListState intentionally uses the current list state. Running only when the
    // calculated last page changes avoids replacing the URL after unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadError, loading, page, pageCount])

  return (
    <div data-design-node="EMBIK" className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <div data-design="Bar" className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={createDraft} disabled={creating} busy={creating} busyLabel="下書きを作成中">＋ フォームを作る
          </Button>
        </div>
      </div>

      <div style={FOLDER_RAIL_STYLE} className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]">
        <FolderPanel
          /* R12: 総数は「すべて」の行と同じ数なので見出しには出さない。 */
          activeId={activeFolderId}
          onSelect={(folder) => {
            setActiveFolderId(folder)
            updateListState({ page: 1 })
          }}
          // R25: 箱は選んだアカウントに付けて作る。staff には操作ごと出さない。
          onAddFolder={canManageFolders ? () => setFolderDialogOpen(true) : undefined}
          rows={[
            { id: 'all', label: 'すべて', count: loading || loadError ? 0 : folderTotal },
            ...folders.map((folder, index) => ({
              id: folder.id,
              label: folder.name,
              // 箱ごとの件数はまだ数えていない（#631 の流儀で出さない）。
              count: folder.itemCount ?? null,
              color: folder.color,
              onEdit: canManageFolders ? () => setEditingFolder(folder) : undefined,
              onMoveUp: canManageFolders && index > 0 ? () => void moveFolder(index, -1) : undefined,
              onMoveDown: canManageFolders && index < folders.length - 1 ? () => void moveFolder(index, 1) : undefined,
              onDelete: canManageFolders ? () => void openFolderDelete(folder) : undefined,
              deleteNote: '削除しても、中のフォームは未分類に残ります。',
            })),
            // 未分類の件数も数えていない。0 とは言わない。
            { id: UNFILED_VALUE, label: '未分類', count: null },
          ]}
        >
          <p className="text-ink-faint text-xs leading-relaxed">
            フォルダを消しても、入っていたフォームは未分類として残ります。
          </p>
          {folderError ? (
            <p role="alert" className="text-ink-secondary text-xs">
              {folderError}
              <button type="button" onClick={() => void loadForms()} className="text-action ml-2 font-semibold hover:underline">
                もう一度
              </button>
            </p>
          ) : null}
        </FolderPanel>

        <section className="min-w-0">
          {/*
            ★V7 `Xn1Mz`：検索は幅320で1行目、2行目は左に絞り込み・
            右端に並び順と表示件数。管理者確認の切り替えは2行目の右へ。
            設計の Saved（絞り込み行）は共通 ListToolbar の2行目にいる。
            印だけここに残し、設計との突き合わせを保つ（Bar の印は上の
            作成行にある）。
          */}
          <div data-design="Saved">
          <ListToolbar
            search={{
              placeholder: 'フォーム名・質問文で検索',
              value: query,
              onChange: (value) => updateListState({ query: value, page: 1 }),
            }}
            filters={
              <>
                <span className="text-xs text-ink-faint">絞り込み</span>
                {([
                  ['all', 'すべて'],
                  ['published', '公開中'],
                  ['draft', '下書き'],
                  ['stored', '情報欄に保存している'],
                ] as Array<[FormFilter, string]>).map(([value, label]) => (
                  <FilterChip key={value} selected={formFilter === value} onChange={() => updateListState({ filter: value, page: 1 })}>
                    {label}
                  </FilterChip>
                ))}
              </>
            }
            trailing={
              <>
                <Select
                  aria-label="並び順"
                  value={formSort}
                  options={[
                    { value: 'latest-answer', label: '最新の回答順' },
                    { value: 'answers', label: '回答が多い順' },
                    { value: 'updated', label: '更新が新しい順' },
                    { value: 'name', label: '名前順' },
                  ]}
                  onChange={(value) => updateListState({ sort: value as FormSort, page: 1 })}
                />
                <Select
                  aria-label="表示件数"
                  size="page-size"
                  value={String(pageSize)}
                  options={FORM_PAGE_SIZES.map((size) => ({ value: String(size), label: `${size}件表示` }))}
                  onChange={(value) => updateListState({ pageSize: Number(value), page: 1 })}
                />
                <FilterChip
                  selected={reviewMode}
                  onChange={(next) => { setReviewMode(next); setPage(1) }}
                >
                  {reviewMode ? '通常の一覧に戻る' : '管理者確認（担当未割り当て）'}
                </FilterChip>
              </>
            }
          />
          </div>
          {reviewMode && (
            <div className="border-hairline rounded-card border bg-canvas p-3 text-xs text-ink-secondary">
              <p><span className="font-bold text-ink">管理者確認中のフォーム</span> — 担当アカウントが決まっていない旧フォームだけを出しています。公開URLは生きているため回答は入り続けます。</p>
              <p className="mt-1">担当の割り当ては後続の対応（#771）で行います。この画面では割り当て操作はできません。</p>
            </div>
          )}

          {createError && <p className="text-sm text-danger">{createError}</p>}
          {accountLoading ? (
          <ListState kind="loading" title="LINE公式アカウントを確認しています" />
        ) : !selectedAccountId ? (
          <div className="bg-canvas rounded-card border-hairline border">
            <ListState
              kind="empty"
              title="LINE公式アカウントを選んでください"
              description="上のアカウント切替から、回答フォームを使う公式アカウントを選びます。"
            />
          </div>
        ) : loading ? (
          <ListState
            kind="loading"
            title="読み込んでいます"
            description="このまま少しお待ちください。"
          />
        ) : loadError ? (
          <ListState
            kind="error"
            // R602/m23m: 403・429は共通の1枚（権限の案内・待ち案内）へ
            // 切り替える。503などは従来どおり再試行を残す（scenarios と同じ形）。
            description={isForbiddenOrRateLimited(loadFailure) ? undefined : '再読み込みしても直らないときは、エラー報告へお知らせください。'}
            error={loadFailure ?? undefined}
            onRetry={() => void loadForms()}
          />
        ) : reviewMode && reviewForbidden ? (
          <div className="bg-canvas rounded-card border-hairline border">
            <ListState
              kind="empty"
              title="確認できる未割り当てフォームはありません"
              description="管理者確認は既定テナントの管理者のみ利用できます。"
            />
          </div>
        ) : reviewMode && forms.length === 0 ? (
          <div className="bg-canvas rounded-card border-hairline border">
            <ListState
              kind="empty"
              title="担当未割り当てのフォームはありません"
              description="担当の決まっていない旧フォームはここに出ます。"
            />
          </div>
        ) : folderTotal === 0 ? (
          <div className="bg-canvas rounded-card border-hairline border">
            <ListState
              kind="empty"
              title="まだフォームがありません"
              description="最初の1つを作ると、集まった回答もここから見られます。"
            action={(
              <Button variant="primary" onClick={createDraft} disabled={creating} busy={creating} busyLabel="下書きを作成中">＋ フォームを作る
              </Button>
            )}
            />
          </div>
        ) : (
          listTotal === 0 ? (
            <div className="bg-canvas rounded-card border-hairline border">
              <ListState
                kind="empty"
                title="条件に合うフォームはありません"
                description="検索語や絞り込み条件を変えてください。"
              />
            </div>
          ) : (
          <div className="border-hairline rounded-card overflow-hidden border bg-canvas">
            {/*
              ★V7：1440px で右端の「編集」と削除が切れていた（表の最小幅＞実幅）。
              最小幅は1440pxの実幅（約835px）より小さい800pxにし、名前の列を伸び縮みさせる。操作の列は2つのボタンが収まる固定幅。
              狭い画面だけ表の中で横に流れる。回答数は「回答を見る」の入口を兼ねる。
            */}
            {/* @container: 谷間帯の列削減。表の幅が足りない間だけ「更新」を畳む。 */}
            <div className="overflow-x-auto @container">
            <table className="w-full min-w-[720px] table-fixed text-sm @[800px]:min-w-[800px]">
              <thead>
                <TableHeadRow>
                  <Th>フォーム</Th>
                  <Th className="w-20">状態</Th>
                  <Th className="w-32">回答の保存先</Th>
                  <Th className="w-36" align="right">
                    回答数
                    {' '}
                    <HelpTip label="今月の完了率の説明">
                      今月の件数は日本時間の1日から数えています。完了率は今月の回答完了を今月開いた人で割った割合で、試しの回答は入れていません。
                    </HelpTip>
                  </Th>
                  <Th className="cq-hide-below-800 w-20">更新</Th>
                  {/* #768: 表が横に流れる帯でも操作列は右端に留める。 */}
                  <Th className="bg-surface-pearl sticky right-0 w-32" align="right">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody className="divide-hairline divide-y">
            {visibleForms.map((form) => {
              const totalCount = form.usedByAccounts.reduce((sum, a) => sum + a.count, 0)
              const displayCount = form.submitCount ?? totalCount
              const normalizedName = displayFormName(form.name)
              const destinationSummary = summarizeFormDestinations(form.layout, form.onSubmitTagId)
              const listDestinationSummary = form.destinationSummary
                ? [
                    form.destinationSummary.friendFieldCount > 0 ? `友だち情報欄${form.destinationSummary.friendFieldCount}` : '',
                    form.destinationSummary.tagCount > 0 ? `タグ${form.destinationSummary.tagCount}` : '',
                  ].filter(Boolean).join('・') || '—'
                : destinationSummary.label
              return (
                <tr key={form.id} className="text-ink-secondary">
                  <td className="px-3 py-2.5">
                    {/*
                     * フォーム名は識別子として別の文面へ写すことがある。
                     * 省略表示は title で読めるが取り出せないため、差し込みキー
                     * と同じく全文コピーの口を添える（監査6 #665）。
                     */}
                    <div className="flex items-center gap-1">
                      {reviewMode ? (
                        <span className="block min-w-0 flex-1 truncate font-semibold text-ink" title={normalizedName}>
                          {normalizedName}
                          {form.accountScopeReviewRequired && <span className="border-accent bg-accent-soft rounded-pill ml-2 border px-2 py-0.5 text-xs text-ink">管理者確認</span>}
                        </span>
                      ) : (
                        <>
                          <Link href={`/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic`} className="block min-w-0 truncate font-semibold text-ink hover:underline" title={normalizedName}>{normalizedName}</Link>
                          {/* 管理者確認は読み取り専用なので、通常の一覧にだけコピー口を出す。 */}
                          <CopyTextButton
                            value={normalizedName}
                            aria-label={`${normalizedName}のフォーム名をコピー`}
                          />
                        </>
                      )}
                    </div>
                    <span className="block truncate text-xs text-ink-faint">{form.description || `${form.fields.length}ブロック`}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <StatusBadge size="compact" tone={form.isActive ? 'success' : 'neutral'}>{form.isActive ? '公開中' : '下書き'}</StatusBadge>
                  </td>
                  <td className="truncate px-3 py-2.5 text-xs" title={listDestinationSummary}>{listDestinationSummary}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                    {/* ★V7：回答数そのものを「回答を見る」の入口にし、操作の列を細くして名前を読めるようにする。 */}
                    {reviewMode ? (
                      <span className="block">{displayCount ? `${formatNumber(displayCount)}件` : '—'}</span>
                    ) : (
                      <Link
                        href={`/form-submissions/responses?id=${encodeURIComponent(form.id)}`}
                        aria-label={`${normalizedName}の集まった回答を見る`}
                        title="集まった回答を見る"
                        className="text-action block font-medium hover:underline"
                      >
                        {displayCount ? `${formatNumber(displayCount)}件` : '0件'}
                      </Link>
                    )}
                    {/*
                      P（一覧の数）：今月は日本時間の1日から数える。
                      完了率 ＝ 今月の回答完了 ÷ 今月開いた人。試しの回答は入れない。
                      取れていない数は「—」だけ出す（0 とは言わない）。
                      定義・分母は見出しの「？」に1つだけ置き、行には置かない。
                    */}
                    <span className="text-ink-faint block">
                      {form.monthlySubmitCount == null
                        ? '今月 —'
                        : `今月 ${formatNumber(form.monthlySubmitCount)}件`}
                    </span>
                    <span className="text-ink-faint block">
                      {form.monthlyCompletionRate == null
                        ? '完了率 —'
                        : `完了率 ${formatNumber(form.monthlyCompletionRate)}%`}
                    </span>
                  </td>
                  <td className="cq-hide-below-800 px-3 py-2.5 text-xs tabular-nums" title={form.updatedAt ? undefined : '更新日時を取得できません'}>{displayUpdatedAt(form.updatedAt)}</td>
                  <td className="bg-canvas sticky right-0 px-3 py-2.5 text-right text-xs">
                    {/*
                     * 管理者確認モードは読み取り専用(#724)。編集・削除・回答の口は
                     * 担当アカウント経由しか受けないため、未割当フォームには使えない。
                     * 押せる口を置くと失敗するだけなので、割り当て（#771）まで置かない。
                     */}
                    {reviewMode ? (
                      <span className="sr-only">読み取り専用</span>
                    ) : (
                      /*
                       * R27: 行の主ボタン「編集」は質問の編集（編集画面）へ。
                       * 名前の変更と箱への移動は「…」の中。削除は区切りの後の
                       * 危ない操作へ。共通の RowActions にそろえる。
                       */
                      <RowActions
                        edit={{ href: `/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic` }}
                        menuItems={[
                          { id: 'rename', label: '名前を変更', onSelect: () => void openRename(form) },
                          { id: 'move', label: 'フォルダへ移す', onSelect: () => openMove(form) },
                          // R230: フォーム全体の複製。質問・分岐・受付設定を引き継いだ別IDの下書きを作る。
                          { id: 'duplicate', label: '複製する', onSelect: () => openDuplicate(form) },
                        ]}
                        destructiveItem={{ id: 'delete', label: '削除する', onSelect: () => void openDelete(form) }}
                        subjectName={normalizedName}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
              </tbody>
            </table>
            </div>
          </div>
          )
        )}
          {!loading && !loadError && visibleForms.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p>
                <ListRange total={listTotal} first={listTotal === 0 ? 0 : pageStart + 1} last={Math.min(pageStart + visibleForms.length, listTotal)} />
              </p>
              <Pagination page={visiblePage} pageCount={pageCount} onPageChange={(next) => updateListState({ page: next })} ariaLabel="回答フォームのページ送り" />
            </div>
          ) : null}
        </section>
      </div>

      {/* Rename dialog */}
      {editingForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-scrim"
            onClick={() => !savingName && setEditingForm(null)}
            aria-label="名前変更を閉じる"
          />
          <div ref={renamePanelRef} role="dialog" aria-modal="true" aria-labelledby="rename-form-title" className="relative w-full max-w-md rounded-card bg-canvas p-5 shadow-float">
            <div className="flex items-start justify-between gap-3">
              <h3 id="rename-form-title" className="text-base font-semibold text-ink">フォーム名を変更</h3>
              <button
                type="button"
                onClick={() => !savingName && setEditingForm(null)}
                disabled={savingName}
                aria-label="閉じる"
                className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              回答データやURLは変わりませんが、回答者に表示されるフォーム名も変わります。
            </p>
            <p className="mt-1 text-xs text-ink-faint">推奨：サービス名｜目的（対象・導線）</p>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-ink-faint">
              <span className="rounded-mini bg-shell px-2 py-1">質問 {editingForm.fields.length}項目</span>
              {editingForm.usedByAccounts.map((account) => (
                <span key={account.id} className="rounded-mini bg-shell px-2 py-1">
                  {account.name}
                </span>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-medium text-ink-secondary">フォーム名</span>
              <input
                autoFocus
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveName()
                }}
                className="w-full rounded-control border border-hairline px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
            </label>
            {renameError && <p className="mt-2 text-xs text-status-danger">{renameError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" className="px-4 py-2 text-ink-secondary hover:bg-surface-pearl disabled:opacity-50 h-auto whitespace-normal" type="button" onClick={() => setEditingForm(null)} disabled={savingName}>
                キャンセル
              </Button>
              <Button variant="primary" className="px-4 py-2 font-medium disabled:opacity-50 border-0 h-auto whitespace-normal" type="button" onClick={() => void saveName()} disabled={!editingName.trim() || savingName}>
                {savingName ? '保存中...' : '保存する'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {folderDialogOpen && (
        <FolderAddDialog
          kind="form"
          accountId={selectedAccountId}
          note="フォームを分けてしまう箱です。消しても、入っていたフォームは未分類として残ります。"
          placeholder="例: 01_来店・予約"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadForms()}
        />
      )}

      {editingFolder && (
        <FolderAddDialog
          kind="form"
          folder={editingFolder}
          accountId={selectedAccountId}
          note="フォームを分けてしまう箱です。削除しても、中のフォームは未分類に残ります。"
          placeholder="例: 01_来店・予約"
          onClose={() => setEditingFolder(null)}
          onAdded={() => { setEditingFolder(null); void loadForms() }}
        />
      )}

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

      <ConfirmDialog
        open={moveTarget !== null}
        title={moveTarget ? `「${displayFormName(moveTarget.name)}」をどのフォルダへ移しますか？` : 'フォルダへ移しますか？'}
        description="回答やURLは変わりません。入れる箱だけが変わります。"
        confirmLabel="移動する"
        busy={moveBusy}
        error={moveError || undefined}
        onConfirm={() => void moveForm()}
        onCancel={() => {
          if (moveBusy) return
          setMoveTarget(null)
          setMoveError('')
        }}
      >
        <RadioCardGroup legend="移動先のフォルダ" className="space-y-1">
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
      </ConfirmDialog>

      <ConfirmDialog
        open={duplicateTarget !== null}
        title={duplicateTarget ? `「${displayFormName(duplicateTarget.name)}」を複製しますか？` : 'フォームを複製しますか？'}
        description="質問・分岐・デザイン・回答後の設定を引き継いだ、受付停止中のフォームを作ります。集まった回答・公開状態・集計は引き継ぎません。"
        confirmLabel="複製する"
        busy={duplicating}
        error={duplicateError || undefined}
        onConfirm={() => void duplicateForm()}
        onCancel={() => {
          if (duplicating) return
          setDuplicateTarget(null)
          setDuplicateError('')
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">複製の名前</span>
          <input
            value={duplicateName}
            onChange={(event) => setDuplicateName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void duplicateForm()
            }}
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        designNode="gBp2J"
        title={deleteTarget
          ? `「${displayFormName(deleteTarget.name)}」を${deleteImpact?.canDelete ? '削除' : 'アーカイブ'}しますか？`
          : '回答フォームをアーカイブしますか？'}
        description={deleteImpact?.canDelete
          ? '未公開で回答も利用先もないため、フォームを完全に削除できます。この操作は元に戻せません。'
          : '公開中・回答あり・利用中のフォームは削除せず、回答と利用先を残してアーカイブします。公開URLは開けなくなります。'}
        confirmLabel={deleteImpact?.canDelete ? '削除する' : 'アーカイブする'}
        destructive={deleteImpact?.canDelete ?? false}
        busy={deleting || stopping || deleteImpactLoading}
        error={deleteError}
        onCancel={() => {
          if (deleting || stopping) return
          setDeleteTarget(null)
          setDeleteImpact(null)
          setDeleteError('')
        }}
        onConfirm={deleteImpact && deleteImpact.recommendedAction !== 'none'
          ? () => void removeForm()
          : undefined}
      >
        {deleteImpactLoading ? (
          <p className="text-ink-faint text-sm">公開状態・回答数・利用中の場所を確認しています。</p>
        ) : deleteImpact ? (
          <div className="space-y-3 text-sm">
            <dl className="bg-canvas-sunken grid grid-cols-2 gap-2 rounded-control p-3">
              <div><dt className="text-ink-faint text-xs">公開状態</dt><dd className="text-ink mt-1 font-medium">{deleteImpact.form.isActive ? '公開中' : '受付停止中'}</dd></div>
              <div><dt className="text-ink-faint text-xs">集まった回答</dt><dd className="text-ink mt-1 font-medium tabular-nums">{formatNumber(deleteImpact.submissionCount)}件</dd></div>
              <div><dt className="text-ink-faint text-xs">利用中の場所</dt><dd className="text-ink mt-1 font-medium tabular-nums">{formatNumber(deleteImpact.referenceCount)}か所</dd></div>
              <div><dt className="text-ink-faint text-xs">開かれた回数</dt><dd className="text-ink mt-1 font-medium tabular-nums">{formatNumber(deleteImpact.openCount)}回</dd></div>
            </dl>
            {deleteImpact.answerUrl && (
              <div>
                <p className="text-ink-faint text-xs">開けなくなる公開URL</p>
                <p className="text-ink mt-1 break-all text-xs">{deleteImpact.answerUrl}</p>
              </div>
            )}
            {deleteImpact.references.length > 0 && (
              <div>
                <p className="text-ink-faint text-xs">先に差し替える利用先</p>
                <ul className="text-ink-secondary mt-1 space-y-1 text-xs">
                  {deleteImpact.references.map((reference, index) => (
                    <li key={`${reference.kind}-${reference.href ?? index}`}>
                      ・{reference.name ?? '名前を確認できない利用先'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!deleteImpact.canDelete && deleteImpact.form.isActive && (
              <div className="border-hairline rounded-control border p-3">
                <p className="text-ink text-xs font-medium">受付だけ止める（おすすめ）</p>
                <p className="text-ink-faint mt-1 text-xs">一覧と回答を残したまま、新しい回答だけを止めます。</p>
                <Button className="mt-3" onClick={() => void stopAccepting()} disabled={stopping || deleting} busy={stopping} busyLabel="停止中">受付だけ止める
                </Button>
              </div>
            )}
            {deleteImpact.submissionCount > 0 && (
              <Button href={`/form-submissions/responses?id=${encodeURIComponent(deleteImpact.form.id)}`}>
                回答をCSVで書き出す画面へ
              </Button>
            )}
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}
