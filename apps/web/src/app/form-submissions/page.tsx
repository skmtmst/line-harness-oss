'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Trash2, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { fetchApi } from '@/lib/api'
import { api, ApiError, type FormDeleteImpact } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { useCanManage } from '@/components/automations/use-can-manage'
import { displayFormName, sortFormsByLatestAnswer } from './form-list'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import type { FormLayout } from '@line-crm/shared'
import { hasStoredDestination, summarizeFormDestinations } from './form-destination-summary'
import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'
import CopyTextButton from '@/components/ui/copy-text-button'
import ListRange from '@/components/ui/list-range'
import { TableHeadRow, Th } from '@/components/shared/table'
import './form-submissions.css'

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
  weeklySubmitCount?: number
  folderId?: string | null
  destinationSummary?: { friendFieldCount: number; tagCount: number }
  createdAt: string
  updatedAt: string | null
  lastSubmittedAt: string | null
  usedByAccounts: UsedByAccount[]
  accountScopeReviewRequired?: boolean
}

interface FormFolder {
  id: string
  name: string
  formCount: number
}

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
  return date.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })
}

export default function FormSubmissionsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  /**
   * フォルダを作れるのは owner / admin だけ（`POST /api/folders` の
   * `requireRole('owner', 'admin')`）。**staff には口ごと出さない。**
   * 押せない灰色の口を置くと「権限を足せば使える操作」に見えるが、
   * staff にとっては永久に押せない。役割の判定は1か所に寄せてある。
   * 読み取り前（null）は出さない側へ倒す。
   */
  const canAddFolder = useCanManage()
  const [forms, setForms] = useState<Form[]>([])
  const [folders, setFolders] = useState<FormFolder[]>([])
  const [formTotal, setFormTotal] = useState(0)
  /** フォルダ欄の「すべて」件数。絞り込み前の件数（all_total）。 */
  const [folderTotal, setFolderTotal] = useState(0)
  const [activeFolderId, setActiveFolderId] = useState('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
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
      const [res, folderRes] = await Promise.all([
        fetchApi<{ success: boolean; data: FormListResponse }>(`/api/forms?${account}${folder}${paging}`),
        fetchApi<{ success: boolean; data: FormFolder[] }>(`/api/folders?kind=form&${account}`),
      ])
      if (!res.success || !folderRes.success) throw new Error('load_failed')
      if (request !== formRequest.current) return
      const items = Array.isArray(res.data) ? res.data : res.data.items
      setForms(items)
      setFolders(folderRes.data)
      setFormTotal(Array.isArray(res.data) ? items.length : res.data.total)
      setFolderTotal(Array.isArray(res.data) ? items.length : (res.data.all_total ?? res.data.total))
    } catch {
      if (request !== formRequest.current) return
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

  const openRename = (form: Form) => {
    setEditingForm(form)
    setEditingName(displayFormName(form.name))
    setRenameError('')
  }

  const saveName = async () => {
    if (!editingForm || !editingName.trim() || savingName || !selectedAccountId) return
    const name = displayFormName(editingName)
    setSavingName(true)
    setRenameError('')
    try {
      const res = await fetchApi<{ success: boolean; data: Form }>(`/api/forms/${editingForm.id}?account_id=${encodeURIComponent(selectedAccountId)}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      })
      if (!res.success) throw new Error('rename_failed')
      setForms((current) => current.map((form) => (
        form.id === editingForm.id ? { ...form, name } : form
      )))
      setEditingForm(null)
      // 名前は検索・名前順の対象。サーバー側の絞り込み・並びとずれないよう読み直す。
      void loadForms()
    } catch {
      setRenameError('フォーム名を変更できませんでした。もう一度お試しください。')
    } finally {
      setSavingName(false)
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
    setDeleting(true)
    setDeleteError('')
    try {
      const result = deleteImpact.canDelete
        ? await api.forms.remove(targetId, selectedAccountId, deleteImpact.revision)
        : await api.forms.archive(targetId, selectedAccountId, deleteImpact.revision)
      if (!result.success) throw new Error('delete_failed')
      setForms((current) => current.filter((form) => form.id !== targetId))
      setDeleteTarget(null)
      // ページの欠け・件数のずれを残さないよう、サーバー側の一覧を読み直す。
      void loadForms()
    } catch {
      setDeleteError('この回答フォームをアーカイブできませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
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
    <div data-design-node="EMBIK">
      <div data-design="Bar" className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={createDraft} disabled={creating}>
            {creating ? '下書きを作成中' : 'フォームを作る'}
          </Button>
        </div>
      </div>

      <div style={FOLDER_RAIL_STYLE} className="grid items-start gap-4 lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]">
        <FolderPanel
          total={loading || loadError ? '— 件' : `${folderTotal} 件`}
          activeId={activeFolderId}
          onSelect={(folder) => {
            setActiveFolderId(folder)
            updateListState({ page: 1 })
          }}
          // 保存先（forms.folder_id）がまだ無いので、owner / admin でも押せない。
          // オーナー指示 #582 は追加操作をこの欄へ置くことを求めるので、
          // 消さずに止めて理由を添える。実データは #688（migration 372）。
          addFolderDisabled={canAddFolder === true}
          addFolderTitle="フォームのフォルダ保存先は未接続です"
          addFolderNote={
            canAddFolder === true ? (
              <p className="text-ink-faint text-xs leading-relaxed">
                フォームのフォルダ保存先はまだ接続されていません。接続されるまではフォルダを追加できません。
              </p>
            ) : undefined
          }
          rows={[
            { id: 'all', label: 'すべて', count: loading || loadError ? 0 : folderTotal },
            ...folders.map((folder) => ({ id: folder.id, label: folder.name, count: folder.formCount })),
            { id: 'unfiled', label: '未分類', count: loading || loadError ? 0 : Math.max(0, folderTotal - folders.reduce((sum, folder) => sum + folder.formCount, 0)) },
          ]}
        />

        <section className="min-w-0">
          <div className="border-hairline rounded-card mb-3 flex flex-wrap items-center gap-2 border bg-white p-3">
            <input
              type="search"
              value={query}
              onChange={(event) => updateListState({ query: event.target.value, page: 1 })}
              placeholder="フォーム名・質問文で検索"
              aria-label="フォーム名・質問文で検索"
              className="border-hairline rounded-control focus:ring-accent min-w-60 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
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
          </div>

          <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-faint">保存した検索</span>
            {([
              ['all', 'すべて'],
              ['published', '公開中'],
              ['draft', '下書き'],
              ['stored', '情報欄に保存している'],
            ] as Array<[FormFilter, string]>).map(([value, label]) => {
              const active = formFilter === value
              return (
                <label key={value} className={`rounded-pill cursor-pointer border px-3 py-1 text-xs ${active ? 'border-accent bg-accent-soft text-ink' : 'border-hairline bg-white text-ink-secondary'}`}>
                  <input type="radio" name="form-filter" value={value} checked={active} onChange={() => updateListState({ filter: value, page: 1 })} className="sr-only" />
                  {label}
                </label>
              )
            })}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={reviewMode ? 'primary' : 'secondary'}
              aria-pressed={reviewMode}
              onClick={() => { setReviewMode((mode) => !mode); setPage(1) }}
            >
              {reviewMode ? '通常の一覧に戻る' : '管理者確認（担当未割り当て）'}
            </Button>
          </div>
          {reviewMode && (
            <div className="border-hairline rounded-card mb-3 border bg-white p-3 text-xs text-ink-secondary">
              <p><span className="font-bold text-ink">管理者確認中のフォーム</span> — 担当アカウントが決まっていない旧フォームだけを出しています。公開URLは生きているため回答は入り続けます。</p>
              <p className="mt-1">担当の割り当ては後続の対応（#771）で行います。この画面では割り当て操作はできません。</p>
            </div>
          )}

          {createError && <p className="mb-3 text-sm text-danger">{createError}</p>}
          {accountLoading ? (
          <ListState kind="loading" title="LINE公式アカウントを確認しています" />
        ) : !selectedAccountId ? (
          <ListState
            kind="empty"
            title="LINE公式アカウントを選んでください"
            description="上のアカウント切替から、回答フォームを使う公式アカウントを選びます。"
          />
        ) : loading ? (
          <ListState
            kind="loading"
            title="読み込んでいます"
            description="このまま少しお待ちください。"
          />
        ) : loadError ? (
          <ListState
            kind="error"
            title="表示できませんでした"
            description="再読み込みしても直らないときは、エラー報告へお知らせください。"
            onRetry={() => void loadForms()}
          />
        ) : reviewMode && reviewForbidden ? (
          <ListState
            kind="empty"
            title="確認できる未割り当てフォームはありません"
            description="管理者確認は既定テナントの管理者のみ利用できます。"
          />
        ) : reviewMode && forms.length === 0 ? (
          <ListState
            kind="empty"
            title="担当未割り当てのフォームはありません"
            description="担当の決まっていない旧フォームはここに出ます。"
          />
        ) : folderTotal === 0 ? (
          <ListState
            kind="empty"
            title="まだフォームがありません"
            description="最初の1つを作ると、集まった回答もここから見られます。"
            action={(
              <Button variant="primary" onClick={createDraft} disabled={creating}>
                {creating ? '下書きを作成中' : 'フォームを作る'}
              </Button>
            )}
          />
        ) : (
          listTotal === 0 ? (
            <ListState
              kind="empty"
              title="条件に合うフォームはありません"
              description="検索語や絞り込み条件を変えてください。"
            />
          ) : (
          <div className="border-hairline rounded-card overflow-hidden border bg-white">
            {/* #641: 操作列が広くなった分は表だけが横に流れる */}
            <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] table-fixed text-sm">
              <thead>
                <TableHeadRow>
                  <Th>フォーム</Th>
                  <Th className="w-20">状態</Th>
                  <Th className="w-32">回答の保存先</Th>
                  <Th className="w-20" align="right">回答数</Th>
                  <Th className="w-20">更新</Th>
                  <Th className="w-52" align="right">操作</Th>
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
                          <Link href={`/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic`} className="block min-w-0 flex-1 truncate font-semibold text-ink hover:underline" title={normalizedName}>{normalizedName}</Link>
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
                  <td className="px-3 py-2.5 text-xs">{form.isActive ? '公開中' : '下書き'}</td>
                  <td className="truncate px-3 py-2.5 text-xs" title={listDestinationSummary}>{listDestinationSummary}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                    <span className="block">{displayCount ? `${displayCount.toLocaleString('ja-JP')}件` : '—'}</span>
                    {form.weeklySubmitCount ? <span className="block text-ink-faint">今週 {form.weeklySubmitCount.toLocaleString('ja-JP')}件</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums" title={form.updatedAt ? undefined : '更新日時を取得できません'}>{displayUpdatedAt(form.updatedAt)}</td>
                  <td className="px-3 py-2.5 text-right text-xs">
                    {/*
                     * 管理者確認モードは読み取り専用(#724)。編集・削除・回答の口は
                     * 担当アカウント経由しか受けないため、未割当フォームには使えない。
                     * 押せる口を置くと失敗するだけなので、割り当て（#771）まで置かない。
                     */}
                    {reviewMode ? (
                      <span className="text-ink-faint">—</span>
                    ) : (
                      /* #641: 行操作は枠つきボタン＋削除アイコンにそろえる。削除は撮影口のため見せたまま */
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <Button href={`/form-submissions/responses?id=${encodeURIComponent(form.id)}`} variant="secondary" aria-label={`${normalizedName}の集まった回答を見る`}>回答を見る</Button>
                        <Button variant="secondary" onClick={() => openRename(form)}>編集</Button>
                        <IconButton aria-label={`${normalizedName}を削除`} title="回答フォームを削除" onClick={() => void openDelete(form)}>
                          <Trash2 aria-hidden />
                        </IconButton>
                      </span>
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
              <nav aria-label="回答フォームのページ送り" className="flex items-center gap-2 text-xs">
                <Button
                  type="button"
                  aria-label="前のページ"
                  disabled={visiblePage <= 1}
                  onClick={() => updateListState({ page: visiblePage - 1 })}
                >
                  前へ
                </Button>
                <span className="min-w-16 text-center tabular-nums text-ink-faint">
                  {visiblePage} / {pageCount}
                </span>
                <Button
                  type="button"
                  aria-label="次のページ"
                  disabled={visiblePage >= pageCount}
                  onClick={() => updateListState({ page: visiblePage + 1 })}
                >
                  次へ
                </Button>
              </nav>
            </div>
          ) : null}
        </section>
      </div>

      {/* Rename dialog */}
      {editingForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            onClick={() => !savingName && setEditingForm(null)}
            aria-label="名前変更を閉じる"
          />
          <div className="relative w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold text-ink">フォーム名を変更</h3>
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
            <p className="mt-1 text-xs text-gray-400">
              回答データやURLは変わりませんが、回答者に表示されるフォーム名も変わります。
            </p>
            <p className="mt-1 text-xs text-gray-400">推奨：サービス名｜目的（対象・導線）</p>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-gray-500">
              <span className="rounded bg-gray-100 px-2 py-1">質問 {editingForm.fields.length}項目</span>
              {editingForm.usedByAccounts.map((account) => (
                <span key={account.id} className="rounded bg-gray-100 px-2 py-1">
                  {account.name}
                </span>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-medium text-gray-600">フォーム名</span>
              <input
                autoFocus
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveName()
                }}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
            </label>
            {renameError && <p className="mt-2 text-xs text-red-500">{renameError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingForm(null)}
                disabled={savingName}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void saveName()}
                disabled={!editingName.trim() || savingName}
                className="rounded-lg bg-accent-deep px-4 py-2 text-sm font-medium text-white hover:brightness-92 disabled:opacity-50"
              >
                {savingName ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div><dt className="text-ink-faint text-xs">集まった回答</dt><dd className="text-ink mt-1 font-medium tabular-nums">{deleteImpact.submissionCount.toLocaleString('ja-JP')}件</dd></div>
              <div><dt className="text-ink-faint text-xs">利用中の場所</dt><dd className="text-ink mt-1 font-medium tabular-nums">{deleteImpact.referenceCount.toLocaleString('ja-JP')}か所</dd></div>
              <div><dt className="text-ink-faint text-xs">開かれた回数</dt><dd className="text-ink mt-1 font-medium tabular-nums">{deleteImpact.openCount.toLocaleString('ja-JP')}回</dd></div>
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
                <Button className="mt-3" onClick={() => void stopAccepting()} disabled={stopping || deleting}>
                  {stopping ? '停止中' : '受付だけ止める'}
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
