'use client'

/*
 * ★V8 回答フォームの一覧（Pencil「★V8 画面の地図」の回答フォームの行：
 * 一覧 `I3L41O`、アーカイブ・削除の窓 `GVizd`、状態の板 `i2ZAS`）。
 *
 * v7 の一覧（app/form-submissions/page.tsx 内の FormSubmissionsPageV7）とは
 * 別の部品として持つ。データの口は同じ。違いは置き場と見せ方だけ——
 * 上に4枚の数の帯（公開中／今月の回答／答え終えた割合／後処理の未完）、
 * 「フォームを作る」は左のフォルダの列の上、行の右端は「…」メニュー
 * （編集・集まった回答・複製・受付を止める・フォルダへ移す・アーカイブ・
 * 削除）。アーカイブと削除は `GVizd` の1枚の窓にまとめる。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CircleCheck,
  ClipboardList,
  Inbox,
  Link2,
  MoreHorizontal,
  Percent,
  SearchX,
  TriangleAlert,
} from 'lucide-react'
import type { Folder, FormLayout } from '@line-crm/shared'
import { fetchApi, api, ApiError, type FormDeleteImpact, type ListStats } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { displayFormName, sortFormsByLatestAnswer } from './form-list'
import { hasStoredDestination, summarizeFormDestinations } from './form-destination-summary'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Pagination from '@/components/shared/pagination'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import ListRange from '@/components/ui/list-range'
import { notifyToast } from '@/components/shared/toast'
import { runUndoable } from '@/lib/undoable'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { formatNumber } from '@/lib/format'
import styles from './list-v8.module.css'

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
  monthlySubmitCount?: number | null
  monthlyOpenCount?: number | null
  monthlyCompletionRate?: number | null
  /** ★V8：後処理が失敗したか途中で止まった回答の数（一覧の未完の札）。 */
  pendingPostActionCount?: number | null
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

/** ★V8 の絞り込み札。「後処理未完」は未完の札を持つフォームだけを出す。 */
type FormFilter = 'all' | 'published' | 'draft' | 'stored' | 'pending'
type FormSort = 'latest-answer' | 'answers' | 'updated' | 'name'

const FORM_PAGE_SIZES = [20, 50, 100] as const

function formAnswerCount(form: Form): number {
  return form.submitCount ?? form.usedByAccounts.reduce((sum, account) => sum + account.count, 0)
}

function validSort(value: string | null): FormSort {
  return value === 'answers' || value === 'updated' || value === 'name' ? value : 'latest-answer'
}

function validFilter(value: string | null): FormFilter {
  return value === 'published' || value === 'draft' || value === 'stored' || value === 'pending'
    ? value
    : 'all'
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

/** 配っている公開URL（LIFF）。アカウントの liffId が無いと作れない。 */
function formAnswerUrl(liffId: string | null | undefined, formId: string): string | null {
  if (!liffId) return null
  return `https://liff.line.me/${liffId}/?page=form&id=${encodeURIComponent(formId)}`
}

/** 「保存先」列。`友だち情報 3・タグ 2` の形（I3L41O）。何も保存しないときは —。 */
function destinationText(form: Form): string {
  const summary = form.destinationSummary ?? summarizeFormDestinations(form.layout, form.onSubmitTagId)
  const parts = [
    summary.friendFieldCount > 0 ? `友だち情報 ${summary.friendFieldCount}` : '',
    summary.tagCount > 0 ? `タグ ${summary.tagCount}` : '',
  ].filter(Boolean)
  return parts.join('・') || '—'
}

/** 名前の下の説明行（I3L41O）。説明があれば「説明・Nブロック」、無ければ「Nブロック」。 */
function subLineText(form: Form): string {
  const blocks = `${form.fields.length}ブロック`
  if (form.description) return form.fields.length > 0 ? `${form.description}・${blocks}` : form.description
  return blocks
}

/** `GVizd` の注意文の利用先（リッチメニュー「…」とシナリオ「…」の形）。 */
function referenceLabel(reference: FormDeleteImpact['references'][number]): string {
  const name = reference.name ?? '名前を確認できない利用先'
  if (reference.kind === 'rich_menu') return `リッチメニュー「${name}」`
  if (reference.kind === 'webinar') return `ウェビナー「${name}」`
  if (reference.kind === 'scenario') return `シナリオ「${name}」`
  return `「${name}」`
}

/**
 * A. 読み込み中の骨組み（V8だけ）。本物の表と同じ見出し・列幅で5行出し、
 * 入れ替わってもガタつかない。0.3秒以内に来たら出さない・出したら最低
 * 0.4秒は `DelayedSkeleton` が面倒を見る（自前の骨組みはやめた）。
 */
function FormListSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.tableWrap} aria-busy="true">
      <span className="sr-only">{label}</span>
      <DelayedSkeleton
        loading
        skeleton={
          <table className={styles.table} aria-hidden="true" inert>
            <FormListHead reviewMode={false} />
            <tbody>
              {[0, 1, 2, 3, 4].map((index) => (
                <tr key={index}>
                  <td>
                    <Skeleton className="block h-3.5 w-2/3" />
                    <span className="mt-1 block"><Skeleton className="block h-3 w-1/2" /></span>
                  </td>
                  <td className={styles.destCell}><Skeleton className="block h-3.5 w-20" /></td>
                  <td><Skeleton className="block h-5.5 w-16" /></td>
                  <td className={styles.answerCell}>
                    <Skeleton className="block h-3.5 w-16" />
                    <span className="mt-0.5 block"><Skeleton className="block h-3 w-24" /></span>
                  </td>
                  <td><Skeleton className="block h-8 w-13" /></td>
                  <td><Skeleton className="ml-auto block h-8 w-8" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      />
    </div>
  )
}

/**
 * 表の見出し（本物と骨組みで同じものを出す。2か所に書くとずれる）。
 */
function FormListHead({ reviewMode }: { reviewMode: boolean }) {
  return (
    <thead>
      <tr>
        <th>フォーム（質問の数）</th>
        <th className={styles.colDest}>保存先</th>
        <th className={styles.colStatus}>状態</th>
        <th className={styles.colAnswers}>回答</th>
        <th className={styles.colUrl}>URL</th>
        {!reviewMode ? <th className={styles.menuCell} aria-label="操作" /> : null}
      </tr>
    </thead>
  )
}

export default function FormSubmissionsListV8() {
  usePageTitle('回答フォーム')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId, selectedAccount, loading: accountLoading } = useAccount()
  /*
   * 箱の作成・名前変更・削除・並び替えは `POST/PATCH/DELETE /api/folders` が
   * `requireRole('owner', 'admin')` で閉じている。staff へ操作を見せると
   * 押しても 403 になるだけなので、操作ごと出さない（テンプレート一覧と同じ）。
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
  /** 掴んだ失敗そのもの。403（権限不足）と 503（通信失敗）の案内を言い分ける。 */
  const [loadFailure, setLoadFailure] = useState<unknown>(null)
  const [query, setQuery] = useState(() => searchParams.get('q') || '')
  /** 実際の取得に使う遅延した検索語（1打鍵ごとの往復を避ける、#1060）。 */
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
  /* 「受付を止める」の確認。止めるにも編集の版が要るので影響口で読む(#723)。 */
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
  const formRequest = useRef(0)
  const activeAccountRef = useRef<string | null>(selectedAccountId)

  useEffect(() => {
    activeAccountRef.current = selectedAccountId
    // フォルダはアカウント単位。切り替えたら前の帯・窓・選択を残さない。
    setFolders([])
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
    setOpenMenuId(null)
    setStats(null)
    setStatsFailed(false)
    setPage(1)
  }, [selectedAccountId])

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
        // 未割り当て口は配列で返す契約。通常一覧と同じく、配列でない応答では
        // 一覧を空にして描く（`[...forms]` が `e is not iterable` で落ちる）。
        const unassigned = Array.isArray(res.data) ? res.data : []
        setForms(unassigned)
        setFolders([])
        setFormTotal(unassigned.length)
        setFolderTotal(unassigned.length)
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
       * 箱だけ 503 のときに Promise.all だとフォームまで消えて全面エラーに
       * なっていた。一覧と件数は残し、箱の場所にだけ失敗と再試行を出す。
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

  /* 数の帯（I3L41O の4枚）。取れなくても一覧は出す。 */
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

  const searchKey = searchParams.toString()
  useEffect(() => {
    const params = new URLSearchParams(searchKey)
    setQuery(params.get('q') || '')
    setFormFilter(validFilter(params.get('filter')))
    setFormSort(validSort(params.get('sort')))
    setPageSize(validPageSize(params.get('limit')))
    setPage(validPage(params.get('page')))
  }, [searchKey])

  // 検索語のサーバー取得は少し遅らせ、1打鍵ごとの往復を避ける(#1060)。
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

  /* アーカイブ・削除の窓を開く。影響（回答数・利用先・版）を先に読む。 */
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

  /*
   * `GVizd` の窓の実行。完全削除（できるときだけ）と保管で口と文言を分ける。
   * 削除したのに「アーカイブできなかった」と出ると、結果を誤認して
   * 不要な再試行が起きる（R199）。
   */
  const removeForm = async (permanentDelete: boolean) => {
    if (!deleteTarget || !deleteImpact || deleting || !selectedAccountId) return
    const targetId = deleteTarget.id
    setDeleting(true)
    setDeleteError('')
    try {
      const result = permanentDelete
        ? await api.forms.remove(targetId, selectedAccountId, deleteImpact.revision)
        : await api.forms.archive(targetId, selectedAccountId, deleteImpact.revision)
      if (!result.success) throw new Error('delete_failed')
      setForms((current) => current.filter((form) => form.id !== targetId))
      setDeleteTarget(null)
      setDeleteImpact(null)
      // ページの欠け・件数のずれを残さないよう、サーバー側の一覧を読み直す。
      void loadForms()
      void loadStats()
    } catch {
      /*
       * R199: 処理済みなのに失敗を返す経路をなくす。応答が失われたときは
       * 対象を読み直し、既に消えていれば成功として扱う（行を外して閉じる）。
       * 残っているときだけ失敗文を出す。
       */
      let gone = false
      try {
        await api.forms.get(targetId, selectedAccountId)
      } catch (checkError) {
        if (checkError instanceof ApiError && checkError.status === 404) gone = true
      }
      if (gone) {
        setForms((current) => current.filter((form) => form.id !== targetId))
        setDeleteTarget(null)
        setDeleteImpact(null)
        void loadForms()
        void loadStats()
      } else {
        setDeleteError(permanentDelete
          ? 'この回答フォームを削除できませんでした。状態を読み直してから、もう一度お試しください。'
          : 'この回答フォームをアーカイブできませんでした。状態を読み直してから、もう一度お試しください。')
      }
    } finally {
      setDeleting(false)
    }
  }

  /* 「受付を止める」の窓を開く。止める保存には編集の版が要るので影響口で読む。 */
  const openStop = async (form: Form) => {
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
      /*
       * #723: 受付停止も編集保存と同じ口（`PUT /api/forms/:id`）を通るので
       * 版を免除しない。版は開くときに読み直した contentRevision を渡す。
       */
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

  /*
   * R25: 箱の並び替え。2つの更新は口が1回で行う。途中で片方だけ変わらない。
   */
  /*
   * B. フォルダの並べ替えは押した瞬間に画面を変え、裏で保存する。
   * 5秒は Toast の「元に戻す」で止められる（戻す口は同じ入れ替え）。
   */
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

  /*
   * 管理者確認モード（未割り当て一覧）は専用口が全件を返すので、従来どおり
   * 画面側で絞り込み・並び替え・ページ切りをする。通常一覧は Worker が
   * 同じ規則（@line-crm/shared）で済ませた1ページ分だけを返す（#1060）。
   */
  const clientFilteredForms = useMemo(() => {
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

  const listTotal = reviewMode ? clientFilteredForms.length : formTotal
  const pageCount = Math.max(1, Math.ceil(listTotal / pageSize))
  const visiblePage = Math.min(page, pageCount)
  const pageStart = (visiblePage - 1) * pageSize
  const visibleForms = reviewMode
    ? clientFilteredForms.slice(pageStart, pageStart + pageSize)
    : forms

  useEffect(() => {
    if (!loading && !loadError && page > pageCount) updateListState({ page: pageCount })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadError, loading, page, pageCount])

  const filterActive = formFilter !== 'all' || query.trim() !== '' || activeFolderId !== 'all'
  const clearFilters = () => {
    setActiveFolderId('all')
    updateListState({ query: '', filter: 'all', page: 1 })
  }

  /* 数の帯（I3L41O の4枚）。値が無いときは「—」（0とは言わない）。 */
  const formStats = stats?.forms
  const kpis: Array<{
    key: string
    title: string
    icon: typeof CircleCheck
    warn?: boolean
    value: number | null
    unit: string
    detail: string
    link?: { label: string; onSelect: () => void }
  }> = [
    {
      key: 'published',
      title: '公開中',
      icon: CircleCheck,
      value: statsFailed ? null : formStats?.published ?? null,
      unit: '件',
      detail: `下書き ${statsFailed || !formStats ? '—' : formStats.draft}件`,
    },
    {
      key: 'monthly-submits',
      title: '今月の回答',
      icon: Inbox,
      value: statsFailed ? null : formStats?.monthlySubmits ?? null,
      unit: '件',
      detail: `先月 ${statsFailed || !formStats ? '—' : formStats.prevMonthSubmits}件`,
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
      warn: true,
      value: statsFailed ? null : formStats?.pendingPostActions ?? null,
      unit: '件',
      detail: 'タグ・シナリオが失敗',
      link: {
        label: '未完を見る',
        onSelect: () => updateListState({ filter: 'pending', page: 1 }),
      },
    },
  ]

  /* ===== 行の「…」（I3L41O：編集・集まった回答・複製・受付を止める・フォルダへ移す・アーカイブ・削除） ===== */
  const rowMenuItems = (form: Form): ActionMenuItem[] => [
    {
      id: 'edit',
      label: '編集',
      onSelect: () => router.push(`/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic`),
    },
    {
      id: 'responses',
      label: '集まった回答',
      external: true,
      onSelect: () => router.push(`/form-submissions/responses?id=${encodeURIComponent(form.id)}`),
    },
    {
      id: 'duplicate',
      label: '複製',
      onSelect: () => openDuplicate(form),
    },
    ...(form.isActive
      ? [{
          id: 'stop',
          label: '受付を止める',
          onSelect: () => void openStop(form),
        }]
      : []),
    {
      id: 'move',
      label: 'フォルダへ移す',
      onSelect: () => openMove(form),
    },
    {
      id: 'archive',
      label: 'アーカイブ',
      dividerBefore: true,
      onSelect: () => void openDelete(form),
    },
    {
      id: 'delete',
      label: '削除',
      tone: 'danger' as const,
      onSelect: () => void openDelete(form),
    },
  ]

  const folderRows: FolderPanelRow[] = [
    { id: 'all', label: 'すべて', count: loading || loadError ? null : folderTotal },
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
    { id: UNFILED_VALUE, label: '未分類', count: null },
  ]

  const folderSelectOptions = [
    { value: 'all', label: 'フォルダ：すべて' },
    ...folders.map((folder) => ({ value: folder.id, label: `フォルダ：${folder.name}` })),
    { value: UNFILED_VALUE, label: 'フォルダ：未分類' },
  ]

  const createButton = (className?: string) => (
    <Button
      type="button"
      variant="primary"
      className={className}
      onClick={createDraft}
      disabled={creating}
      busy={creating}
      busyLabel="下書きを作成中"
    >
      ＋ フォームを作る
    </Button>
  )

  /* ===== 一覧の中身（読込中・失敗・空・0件・表を分ける） ===== */
  let listBody
  if (accountLoading) {
    listBody = <FormListSkeleton label="回答フォームの一覧を読み込んでいます" />
  } else if (!selectedAccountId) {
    listBody = (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}><ClipboardList size={20} aria-hidden="true" /></span>
        <p className={styles.stateTitle}>LINE公式アカウントを選んでください</p>
        <p className={styles.stateDesc}>上のアカウント切替から、回答フォームを使う公式アカウントを選びます。</p>
      </div>
    )
  } else if (loading) {
    listBody = <FormListSkeleton label="回答フォームの一覧を読み込んでいます" />
  } else if (loadError) {
    listBody = (
      <div className={styles.stateCard}>
        <span className={`${styles.stateIcon} ${styles.stateIconError}`}><TriangleAlert size={20} aria-hidden="true" /></span>
        <p className={styles.stateTitle}>
          {isForbiddenOrRateLimited(loadFailure) ? 'この一覧を見る権限がありません' : '回答フォームを読み込めませんでした'}
        </p>
        <p className={styles.stateDesc}>
          {isForbiddenOrRateLimited(loadFailure)
            ? 'アカウントの担当・役割の設定を確認してください。'
            : '再読み込みしても直らないときは、エラー報告へお知らせください。'}
        </p>
        {!isForbiddenOrRateLimited(loadFailure) ? (
          <Button type="button" variant="secondary" onClick={() => void loadForms()}>もう一度読み込む</Button>
        ) : null}
      </div>
    )
  } else if (reviewMode && reviewForbidden) {
    listBody = (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}><ClipboardList size={20} aria-hidden="true" /></span>
        <p className={styles.stateTitle}>確認できる未割り当てフォームはありません</p>
        <p className={styles.stateDesc}>管理者確認は既定テナントの管理者のみ利用できます。</p>
      </div>
    )
  } else if (reviewMode && forms.length === 0) {
    listBody = (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}><ClipboardList size={20} aria-hidden="true" /></span>
        <p className={styles.stateTitle}>担当未割り当てのフォームはありません</p>
        <p className={styles.stateDesc}>担当の決まっていない旧フォームはここに出ます。</p>
      </div>
    )
  } else if (folderTotal === 0 && !filterActive) {
    listBody = (
      <div className={styles.stateCard} data-design-node="I3L41O-empty">
        <span className={styles.stateIcon}><ClipboardList size={20} aria-hidden="true" /></span>
        <p className={styles.stateTitle}>まだ回答フォームはありません</p>
        <p className={styles.stateDesc}>アンケートや申し込みを LINE の中で受け付けられます。答えは友だち情報に保存できます。</p>
        {createButton()}
      </div>
    )
  } else if (listTotal === 0) {
    listBody = (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}><SearchX size={20} aria-hidden="true" /></span>
        <p className={styles.stateTitle}>条件に合うフォームはありません</p>
        <p className={styles.stateDesc}>「公開中」「下書き」「情報欄に保存」や検索を外すと、すべて出ます。</p>
        <Button type="button" variant="secondary" onClick={clearFilters}>条件を外す</Button>
      </div>
    )
  } else {
    listBody = (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <FormListHead reviewMode={reviewMode} />
          <tbody>
            {visibleForms.map((form) => {
              const normalizedName = displayFormName(form.name)
              const answerCount = formAnswerCount(form)
              /* 補足の行は1行のまま省略表示にするため、全文を title にも持つ。 */
              const answerSubText = `今月 ${form.monthlySubmitCount == null ? '—' : formatNumber(form.monthlySubmitCount)}・完了 ${form.monthlyCompletionRate == null ? '—' : `${formatNumber(form.monthlyCompletionRate)}%`}`
              const pendingCount = form.pendingPostActionCount ?? 0
              const answerUrl = formAnswerUrl(selectedAccount?.liffId, form.id)
              return (
                <tr key={form.id}>
                  <td>
                    <div className={styles.nameLine}>
                      {reviewMode ? (
                        <>
                          <span className={`${styles.cellTitle} ${styles.cellTitleText}`} title={normalizedName}>
                            {normalizedName}
                          </span>
                          {form.accountScopeReviewRequired ? (
                            <span className={styles.reviewBadge}>管理者確認</span>
                          ) : null}
                        </>
                      ) : (
                        <Link
                          href={`/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic`}
                          className={styles.cellTitle}
                          title={normalizedName}
                        >
                          {normalizedName}
                        </Link>
                      )}
                      {pendingCount > 0 ? (
                        <span className={styles.pendingBadge}>後処理の未完 {pendingCount}</span>
                      ) : null}
                    </div>
                    <p className={styles.cellSub}>{subLineText(form)}</p>
                  </td>
                  <td className={styles.destCell} title={destinationText(form)}>{destinationText(form)}</td>
                  <td>
                    <span className={`${styles.statusPill} ${form.isActive ? styles.statusPillLive : styles.statusPillDraft}`}>
                      {form.isActive ? '公開中' : '下書き'}
                    </span>
                  </td>
                  <td className={styles.answerCell}>
                    {reviewMode ? (
                      <span className={styles.answerCount}>{answerCount ? `${formatNumber(answerCount)}件` : '—'}</span>
                    ) : (
                      <Link
                        href={`/form-submissions/responses?id=${encodeURIComponent(form.id)}`}
                        aria-label={`${normalizedName}の集まった回答を見る`}
                        title="集まった回答を見る"
                        className={styles.answerCount}
                      >
                        {formatNumber(answerCount)}件
                      </Link>
                    )}
                    {/*
                      今月は日本時間の1日から数える。完了率＝今月の回答完了÷
                      今月開いた人。試しの回答は入れない。取れていない数は
                      「—」だけ出す（0 とは言わない）。
                    */}
                    <p className={styles.answerSub} title={answerSubText}>
                      {answerSubText}
                    </p>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.urlButton}
                      disabled={!answerUrl}
                      title={answerUrl ? '配っているURLをコピー' : 'このアカウントは公開URLをまだ作れません'}
                      aria-label={`${normalizedName}のURLをコピー`}
                      onClick={() => void copyAnswerUrl(form)}
                    >
                      <Link2 size={12} aria-hidden="true" />
                      URL
                    </button>
                  </td>
                  {!reviewMode ? (
                    /*
                     * 管理者確認モードは読み取り専用(#724)。編集・削除・回答の口は
                     * 担当アカウント経由しか受けないため、未割当フォームには使えない。
                     */
                    <td className={styles.menuCell}>
                      <button
                        type="button"
                        className={styles.menuButton}
                        title={`「${normalizedName}」のその他の操作`}
                        aria-label={`「${normalizedName}」のその他の操作（編集・集まった回答・複製・受付を止める・フォルダへ移す・アーカイブ・削除）`}
                        onClick={() => setOpenMenuId((current) => (current === form.id ? null : form.id))}
                      >
                        <MoreHorizontal size={16} aria-hidden="true" />
                      </button>
                      <ActionMenu
                        open={openMenuId === form.id}
                        onClose={() => setOpenMenuId(null)}
                        ariaLabel={`「${normalizedName}」の操作`}
                        items={rowMenuItems(form)}
                      />
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const showPager = !loading && !loadError && visibleForms.length > 0

  return (
    <div data-design-node="I3L41O" className={styles.board}>
      {/* 見出し：画面名＋一行の説明。右に管理者確認の切り替え（i2ZAS）。 */}
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>回答フォーム</h1>
          <p className={styles.headDescription}>
            LINEの中で開くアンケート・申し込みフォームです。答えは友だち情報に保存できます。
          </p>
        </div>
        <div className={styles.headActions}>
          <FilterChip
            selected={reviewMode}
            onChange={(next) => { setReviewMode(next); setPage(1) }}
          >
            {reviewMode ? '通常の一覧に戻る' : '管理者確認（担当未割り当て）'}
          </FilterChip>
        </div>
      </div>

      {/* 数の帯。管理者確認モードは別のアカウント群の数なので出さない。 */}
      {!reviewMode ? (
        <div className={styles.kpis} data-design-node="I3L41O-kpis">
          {kpis.map((kpi) => (
            <div key={kpi.key} className={styles.kpi}>
              <span className={`${styles.kpiLabel} ${kpi.warn ? styles.kpiLabelWarn : ''}`}>
                <kpi.icon size={14} aria-hidden="true" />
                {kpi.title}
              </span>
              <p className={styles.kpiValue}>
                {kpi.value === null ? '—' : formatNumber(kpi.value)}
                <span className={styles.kpiUnit}>{kpi.value === null ? '' : kpi.unit}</span>
              </p>
              <p className={styles.kpiDetail}>
                {kpi.detail}
                {kpi.link ? (
                  <>
                    {'　'}
                    <button type="button" className={styles.kpiLink} onClick={kpi.link.onSelect}>
                      {kpi.link.label}
                    </button>
                  </>
                ) : null}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.split}>
        {/* 左のフォルダの列。いちばん上は「フォームを作る」。 */}
        {!reviewMode ? (
          <div className={styles.folderCol}>
            {createButton('v8-folder-create')}
            <FolderPanel
              activeId={activeFolderId}
              onSelect={(folder) => {
                setActiveFolderId(folder)
                updateListState({ page: 1 })
              }}
              onAddFolder={canManageFolders ? () => setFolderDialogOpen(true) : undefined}
              addFolderLabel="フォルダを追加"
              rows={folderRows}
            >
              <p className={styles.folderNote}>
                フォルダを消しても、中のフォームは未分類に残ります。
              </p>
              {folderError ? (
                <p role="alert" className={styles.folderNote}>
                  {folderError}
                  <button type="button" onClick={() => void loadForms()} className={styles.kpiLink}>
                    もう一度
                  </button>
                </p>
              ) : null}
            </FolderPanel>
          </div>
        ) : null}

        <div className={styles.listCol}>
          {/* 道具の段：検索・絞り込みの札・並び順・件数。狭い板では「作る」とフォルダ選びがここへ畳まれる。 */}
          <div className={styles.toolbar}>
            {createButton(styles.toolbarCreate)}
            <div className={styles.folderSelectWrap}>
              <Select
                aria-label="フォルダ"
                value={activeFolderId}
                onChange={(value) => {
                  setActiveFolderId(value)
                  updateListState({ page: 1 })
                }}
                options={folderSelectOptions}
              />
            </div>
            <div className={styles.searchWrap}>
              <SearchField
                aria-label="フォーム名・質問文で検索"
                placeholder="フォーム名・質問文"
                value={query}
                onChange={(value) => updateListState({ query: value, page: 1 })}
                onClear={() => updateListState({ query: '', page: 1 })}
              />
            </div>
            {([
              ['published', '公開中'],
              ['draft', '下書き'],
              ['stored', '情報欄に保存'],
            ] as Array<[FormFilter, string]>).map(([value, label]) => (
              <FilterChip
                key={value}
                selected={formFilter === value}
                onChange={(next) => updateListState({ filter: next ? value : 'all', page: 1 })}
              >
                {label}
              </FilterChip>
            ))}
            {/*
             * 「後処理未完」は数の帯の「未完を見る」から入る絞り込み。
             * 選んでいる間だけ札を出し、札を外すと「すべて」へ戻る。
             */}
            {formFilter === 'pending' ? (
              <FilterChip
                selected
                onChange={() => updateListState({ filter: 'all', page: 1 })}
              >
                後処理未完
              </FilterChip>
            ) : null}
            <span className={styles.toolbarSpacer} />
            <label className="flex min-w-0 items-center gap-2">
              <span className="text-ink-faint text-xs whitespace-nowrap">並び：</span>
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
            </label>
            <label className="flex min-w-0 items-center gap-2">
              <Select
                aria-label="表示件数"
                size="page-size"
                value={String(pageSize)}
                options={FORM_PAGE_SIZES.map((size) => ({ value: String(size), label: `${size}件表示` }))}
                onChange={(value) => updateListState({ pageSize: Number(value), page: 1 })}
              />
            </label>
          </div>

          {reviewMode ? (
            <div className={styles.reviewNote}>
              <p><strong>管理者確認中のフォーム</strong> — 担当アカウントが決まっていない旧フォームだけを出しています。公開URLは生きているため回答は入り続けます。</p>
              <p>担当の割り当ては後続の対応で行います。この画面では割り当て操作はできません。</p>
            </div>
          ) : null}

          {createError ? (
            <p className={styles.errorBand} role="alert">
              {createError}
              <button type="button" onClick={() => setCreateError('')}>閉じる</button>
            </p>
          ) : null}

          {listBody}

          {showPager ? (
            <div className={styles.pagerRow}>
              <p className={styles.pagerCount}>
                <ListRange total={listTotal} first={listTotal === 0 ? 0 : pageStart + 1} last={Math.min(pageStart + visibleForms.length, listTotal)} />
              </p>
              <Pagination page={visiblePage} pageCount={pageCount} onPageChange={(next) => updateListState({ page: next })} ariaLabel="回答フォームのページ送り" />
            </div>
          ) : null}
        </div>
      </div>

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

      {/* 「受付を止める」の確認（メニューから直行）。止めると URL を開いた人には「受付を終了しました」が出る。 */}
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
        {stopImpactLoading ? (
          <p className="text-ink-faint text-sm">フォームの状態を確認しています。</p>
        ) : null}
      </ConfirmDialog>

      {/*
       * アーカイブ・削除の窓（`GVizd`）。
       * 「アーカイブする（おすすめ）」と「削除する」の2枚の説明カードを出し、
       * 実行は下の3つのボタン（削除する｜キャンセル｜アーカイブする）。
       * 削除できるのは「未公開・回答なし・利用先なし」のときだけ。
       */}
      <Dialog
        open={deleteTarget !== null}
        designNode="GVizd"
        title={deleteTarget ? `「${displayFormName(deleteTarget.name)}」をどうしますか` : 'フォームをどうしますか'}
        description={deleteImpact?.form.isActive
          ? '配っている URL を開いた人には「受付を終了しました」と出ます。'
          : undefined}
        busy={deleting || deleteImpactLoading}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteImpact(null)
          setDeleteError('')
        }}
        footer={(
          <div className={styles.dialogFooter}>
            <Button
              type="button"
              variant="danger"
              disabled={deleting || deleteImpactLoading || !deleteImpact?.canDelete}
              title={deleteImpact && !deleteImpact.canDelete ? '未公開・回答なし・利用先なしのフォームだけ削除できます' : undefined}
              onClick={() => void removeForm(true)}
            >
              削除する
            </Button>
            <span className={styles.dialogFooterSpacer} />
            <Button
              type="button"
              variant="secondary"
              disabled={deleting || deleteImpactLoading}
              onClick={() => {
                if (deleting) return
                setDeleteTarget(null)
                setDeleteImpact(null)
                setDeleteError('')
              }}
            >
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
              アーカイブする
            </Button>
          </div>
        )}
      >
        {deleteImpactLoading ? (
          <p className={styles.dialogNote}>公開状態・回答数・利用中の場所を確認しています。</p>
        ) : deleteImpact ? (
          <div className={styles.impactOptions}>
            <div className={styles.impactOption}>
              <p className={styles.impactOptionTitle}>アーカイブする（おすすめ）</p>
              <p className={styles.impactOptionDesc}>
                一覧から隠します。集まった回答 {formatNumber(deleteImpact.submissionCount)}件 と友だち情報に保存した答えは残ります。
              </p>
            </div>
            <div className={styles.impactOption}>
              <p className={styles.impactOptionTitle}>削除する</p>
              <p className={styles.impactOptionDesc}>
                {deleteImpact.canDelete
                  ? '未公開・回答なし・利用先なしのため、完全に削除できます。この操作は元に戻せません。'
                  : '回答や利用先があるので削除できません。削除できるのは、未公開・回答なし・利用先なしのフォームだけです。'}
              </p>
            </div>
            {deleteImpact.references.length > 0 ? (
              <p className={styles.impactWarn}>
                <TriangleAlert size={14} aria-hidden="true" />
                <span>
                  {deleteImpact.references.map(referenceLabel).join('と')}がこのフォームを開きます。
                </span>
              </p>
            ) : null}
            {deleteImpact.answerUrl ? (
              <p className={styles.dialogNote}>
                開けなくなる公開URL：<span className="break-all">{deleteImpact.answerUrl}</span>
              </p>
            ) : null}
          </div>
        ) : null}
        {deleteError ? <p className={styles.dialogError} role="alert">{deleteError}</p> : null}
      </Dialog>
    </div>
  )
}
