'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchApi } from '@/lib/api'
import { api, type FormDeleteImpact } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { displayFormName, sortFormsByLatestAnswer } from './form-list'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import type { FormLayout } from '@line-crm/shared'
import { summarizeFormDestinations } from './form-destination-summary'
import FolderPanel from '@/components/shared/folder-panel'
import { TableHeadRow, Th } from '@/components/shared/table'

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
  createdAt: string
  lastSubmittedAt: string | null
  usedByAccounts: UsedByAccount[]
}

interface FormDetail extends Form {
  fields: Array<{ name: string; label: string; type?: string }>
}

interface Submission {
  id: string
  formId: string
  friendId: string | null
  friendName?: string | null
  data: Record<string, unknown>
  createdAt: string
}

type FormFilter = 'all' | 'published' | 'draft' | 'stored'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 添付された画像の回答か。
 *
 * 回答に入るのはURLだけで、中身は R2 にある。文字として出すと
 * `https://.../images/form-uploads/...` の長い1行になり、何が送られたのか
 * 分からない。ここだけ絵で出す。
 */
function isUploadedImage(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\/[^\s]+\/images\/form-uploads\//.test(v)
}

/** 回答1つを描く。画像なら小さく出し、押すと元の大きさで開く。 */
function AnswerValue({ value, thumb }: { value: unknown; thumb?: boolean }) {
  if (isUploadedImage(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="inline-block">
        {/* R2 に置いた画像をそのまま出すため next/image は使わない */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={value}
          alt="送られた画像"
          className={`rounded-control border-hairline border object-cover ${
            thumb ? 'h-10 w-10' : 'max-h-60'
          }`}
        />
      </a>
    )
  }
  return <>{formatValue(value)}</>
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function FormSubmissionsPage() {
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [forms, setForms] = useState<Form[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [subLoading, setSubLoading] = useState(false)
  const [subError, setSubError] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [submissionTotal, setSubmissionTotal] = useState(0)
  const [detailSubmission, setDetailSubmission] = useState<Submission | null>(null)
  const [query, setQuery] = useState('')
  const [formFilter, setFormFilter] = useState<FormFilter>('all')
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
  const submissionRequest = useRef(0)
  const formRequest = useRef(0)

  const loadForms = useCallback(async () => {
    const request = ++formRequest.current
    if (!selectedAccountId) {
      setForms([])
      setSelectedFormId(null)
      setSubmissions([])
      setSubmissionTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const res = await fetchApi<{ success: boolean; data: Form[] }>(
        `/api/forms?account_id=${encodeURIComponent(selectedAccountId)}`,
      )
      if (!res.success) throw new Error('load_failed')
      if (request !== formRequest.current) return
      setForms(res.data)
    } catch {
      if (request !== formRequest.current) return
      setLoadError('回答フォームを読み込めませんでした。')
      setForms([])
    } finally {
      if (request === formRequest.current) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    submissionRequest.current += 1
    setSelectedFormId(null)
    setSubmissions([])
    setSubmissionTotal(0)
    void loadForms()
  }, [loadForms])

  const loadSubmissions = useCallback(async (formId: string, requestedPage = 1, requestedLimit = 20) => {
    if (!selectedAccountId) return
    const request = ++submissionRequest.current
    setSubLoading(true)
    setSubError('')
    setPage(1)
    setDetailSubmission(null)
    try {
      const accountQuery = `account_id=${encodeURIComponent(selectedAccountId)}`
      const formRes = await fetchApi<{ success: boolean; data: FormDetail | { fields: string | FormDetail['fields'] } }>(`/api/forms/${formId}?${accountQuery}`)
      const subRes = await fetchApi<{
        success: boolean
        data: { items: Submission[]; total: number; page: number; limit: number }
      }>(`/api/forms/${formId}/submissions?page=${requestedPage}&limit=${requestedLimit}&${accountQuery}`)
      if (!subRes.success) throw new Error('submissions_failed')
      if (request !== submissionRequest.current) return

      if (formRes.success) {
        const rawFields = (formRes.data as { fields: unknown }).fields
        const fields = typeof rawFields === 'string'
          ? (JSON.parse(rawFields) as Array<{ name: string; label: string }>)
          : (rawFields as Array<{ name: string; label: string }>)
        const labels: Record<string, string> = {}
        for (const f of fields ?? []) labels[f.name] = f.label
        setFieldLabels(labels)
      }
      setPage(subRes.data.page)
      setPageSize(subRes.data.limit)
      setSubmissionTotal(subRes.data.total)
      setSubmissions(
        subRes.data.items.map((s) => ({
          ...s,
          data: typeof s.data === 'string' ? JSON.parse(s.data) : s.data,
          friendName: s.friendName ?? null,
        })),
      )
    } catch {
      if (request !== submissionRequest.current) return
      setSubError('回答を読み込めませんでした。')
      setSubmissions([])
      setSubmissionTotal(0)
    } finally {
      if (request === submissionRequest.current) setSubLoading(false)
    }
  }, [selectedAccountId])

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
      if (selectedFormId === targetId) {
        submissionRequest.current += 1
        setSelectedFormId(null)
        setSubmissions([])
        setSubmissionTotal(0)
        setDetailSubmission(null)
      }
      setDeleteTarget(null)
    } catch {
      setDeleteError('この回答フォームをアーカイブできませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const stopAccepting = async () => {
    if (!deleteTarget || stopping || deleting || !selectedAccountId) return
    setStopping(true)
    setDeleteError('')
    try {
      const result = await api.forms.update(deleteTarget.id, selectedAccountId, { isActive: false })
      if (!result.success) throw new Error(result.error)
      setForms((current) => current.map((form) => (
        form.id === deleteTarget.id ? { ...form, isActive: false } : form
      )))
      setDeleteTarget(null)
      setDeleteImpact(null)
    } catch {
      setDeleteError('回答の受付を止められませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setStopping(false)
    }
  }

  const sortedForms = useMemo(() => sortFormsByLatestAnswer(forms), [forms])
  const filteredForms = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP')
    return sortedForms.filter((form) => {
      if (formFilter === 'published' && !form.isActive) return false
      if (formFilter === 'draft' && form.isActive) return false
      if (formFilter === 'stored' && summarizeFormDestinations(form.layout, form.onSubmitTagId).label === '—') return false
      if (!normalizedQuery) return true
      return (
        displayFormName(form.name).toLocaleLowerCase('ja-JP').includes(normalizedQuery)
        || form.fields.some((field) => field.label.toLocaleLowerCase('ja-JP').includes(normalizedQuery))
        || form.usedByAccounts.some((account) => account.name.toLocaleLowerCase('ja-JP').includes(normalizedQuery))
      )
    })
  }, [formFilter, query, sortedForms])
  const selectedForm = useMemo(
    () => forms.find((f) => f.id === selectedFormId) ?? null,
    [forms, selectedFormId],
  )

  const totalPages = Math.max(1, Math.ceil(submissionTotal / pageSize))

  const fieldKeys = useMemo(
    () =>
      submissions.length > 0
        ? [...new Set(submissions.flatMap((s) => Object.keys(s.data)))]
        : [],
    [submissions],
  )

  return (
    <div data-design-node="EMBIK">
      <div data-design="Bar" className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button disabled title="フォームのフォルダ保存先は未接続です">フォルダを追加</Button>
          <Button variant="primary" onClick={createDraft} disabled={creating}>
            {creating ? '下書きを作成中' : 'フォームを作る'}
          </Button>
        </div>
        {forms[0] ? (
          <Button href={`/form-submissions/responses?id=${encodeURIComponent(forms[0].id)}`}>
            集まった回答を見る
          </Button>
        ) : (
          <Button disabled>集まった回答を見る</Button>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-4">
        <FolderPanel
          total={loading || loadError ? '— 件' : `${forms.length} 件`}
          activeId="all"
          onSelect={() => undefined}
          rows={[
            { id: 'all', label: 'すべて', count: loading || loadError ? 0 : forms.length },
            { id: 'unfiled', label: '未分類', count: loading || loadError ? 0 : forms.length },
          ]}
        />

        <section className="min-w-0 lg:col-span-3">
          <div className="border-hairline rounded-card mb-3 flex flex-wrap items-center gap-2 border bg-white p-3">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="フォーム名・質問文で検索"
              aria-label="フォーム名・質問文で検索"
              className="border-hairline rounded-control focus:ring-accent min-w-60 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <span className="text-xs text-ink-faint">回答が新しい順</span>
            <Select
              aria-label="表示件数"
              size="page-size"
              value="20"
              options={[{ value: '20', label: '20件表示' }]}
              onChange={() => undefined}
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
                  <input type="radio" name="form-filter" value={value} checked={active} onChange={() => setFormFilter(value)} className="sr-only" />
                  {label}
                </label>
              )
            })}
          </div>

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
        ) : forms.length === 0 ? (
          <div className="space-y-3">
            <p className="rounded-control bg-accent-soft px-3 py-2 text-xs text-ink-secondary">
              フォームがまだ1つも無いときの見え方です。「フォームを作る」から最初の1つを作ると、ここに一覧が並びます。
            </p>
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
          </div>
        ) : (
          filteredForms.length === 0 ? (
            <ListState
              kind="empty"
              title="条件に合うフォームはありません"
              description="検索語や絞り込み条件を変えてください。"
            />
          ) : (
          <div className="border-hairline rounded-card overflow-hidden border bg-white">
            <table className="w-full table-fixed text-sm">
              <thead>
                <TableHeadRow>
                  <Th className="w-1/3">フォーム</Th>
                  <Th className="w-28">状態</Th>
                  <Th>回答の保存先</Th>
                  <Th className="w-24" align="right">回答数</Th>
                  <Th className="w-24">更新</Th>
                  <Th className="w-28" align="right">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody className="divide-hairline divide-y">
            {filteredForms.map((form) => {
              const totalCount = form.usedByAccounts.reduce((sum, a) => sum + a.count, 0)
              const displayCount = form.submitCount ?? totalCount
              const normalizedName = displayFormName(form.name)
              const destinationSummary = summarizeFormDestinations(form.layout, form.onSubmitTagId)
              return (
                <tr key={form.id} className="text-ink-secondary">
                  <td className="px-3 py-2.5">
                    <Link href={`/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic`} className="block truncate font-semibold text-ink hover:underline" title={normalizedName}>{normalizedName}</Link>
                    <span className="block truncate text-xs text-ink-faint">{form.description || `${form.fields.length}ブロック`}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">{form.isActive ? '公開中' : '下書き'}</td>
                  <td className="truncate px-3 py-2.5 text-xs" title={destinationSummary.label}>{destinationSummary.label}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">{displayCount ? `${displayCount.toLocaleString('ja-JP')}件` : '—'}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums">{new Date(form.createdAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}</td>
                  <td className="px-3 py-2.5 text-right text-xs">
                    <Link href={`/form-submissions/responses?id=${encodeURIComponent(form.id)}`} className="text-accent hover:underline">回答</Link>
                    <button type="button" onClick={() => openRename(form)} className="ml-2 text-accent hover:underline">編集</button>
                    <button type="button" onClick={() => void openDelete(form)} className="ml-2 text-danger hover:underline" aria-label={`${normalizedName}を削除`}>削除</button>
                  </td>
                </tr>
              )
            })}
              </tbody>
            </table>
          </div>
          )
        )}
        </section>
      </div>

      {/* Submissions table */}
      {selectedForm && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-semibold text-gray-900">{displayFormName(selectedForm.name)}</h2>
              <span className="text-xs text-gray-400">
                {subLoading ? '読み込み中...' : `${submissionTotal}件`}
              </span>
            </div>
            <button
              onClick={() => {
                submissionRequest.current++
                setSelectedFormId(null)
                setSubmissions([])
                setSubmissionTotal(0)
                setDetailSubmission(null)
              }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              閉じる ✕
            </button>
          </div>

          {subLoading ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">読み込み中...</div>
          ) : subError ? (
            <ListState
              kind="error"
              title="回答を読み込めませんでした"
              description="通信状態を確認して、もう一度読み込んでください。"
              onRetry={() => void loadSubmissions(selectedForm.id, page, pageSize)}
            />
          ) : submissions.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">回答がありません</div>
          ) : (
            <>
              <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">名前</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">日時</th>
                      {fieldKeys.slice(0, 4).map((key) => (
                        <th key={key} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">
                          {fieldLabels[key] || key}
                        </th>
                      ))}
                      {fieldKeys.length > 4 && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">…</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {submissions.map((sub) => (
                      <tr
                        key={sub.id}
                        onClick={() => setDetailSubmission(sub)}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                          {sub.friendId ? (
                            <Link
                              href={`/chats?friend=${encodeURIComponent(sub.friendId)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-accent hover:underline"
                            >
                              {sub.friendName || '不明'}
                            </Link>
                          ) : (
                            <span>{sub.friendName || '不明'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(sub.createdAt).toLocaleString('ja-JP', {
                            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        {fieldKeys.slice(0, 4).map((key) => (
                          <td key={key} className="px-4 py-3 text-sm text-gray-700 max-w-[200px] truncate">
                            <AnswerValue value={sub.data[key]} thumb />
                          </td>
                        ))}
                        {fieldKeys.length > 4 && (
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">他 {fieldKeys.length - 4} 項目</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {submissionTotal > 0 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-gray-400">
                    {(page - 1) * pageSize + 1}〜{Math.min(page * pageSize, submissionTotal)}件 / 全{submissionTotal}件
                  </p>
                  <div className="flex items-center gap-2">
                    <Select
                      aria-label="回答の表示件数"
                      size="page-size"
                      value={String(pageSize)}
                      options={[10, 20, 50].map((value) => ({ value: String(value), label: `${value}件表示` }))}
                      onChange={(value) => void loadSubmissions(selectedForm.id, 1, Number(value))}
                    />
                    <Pagination
                      page={page}
                      pageCount={totalPages}
                      disabled={subLoading}
                      ariaLabel="回答一覧のページ送り"
                      onPageChange={(nextPage) => void loadSubmissions(selectedForm.id, nextPage, pageSize)}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Detail panel */}
      {detailSubmission && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setDetailSubmission(null)}
            aria-hidden
          />
          <aside className="relative h-full w-full max-w-md bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">回答詳細</h3>
              <button
                onClick={() => setDetailSubmission(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">回答者</div>
                {detailSubmission.friendId ? (
                  <Link
                    href={`/chats?friend=${encodeURIComponent(detailSubmission.friendId)}`}
                    className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
                  >
                    <span className="font-medium">{detailSubmission.friendName || '不明'}</span>
                    <span className="text-[11px] text-gray-400">→ チャットを開く</span>
                  </Link>
                ) : (
                  <span className="text-sm text-gray-700">{detailSubmission.friendName || '不明'}</span>
                )}
              </div>

              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">送信日時</div>
                <div className="text-sm text-gray-700">{formatDateTime(detailSubmission.createdAt)}</div>
              </div>

              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">回答内容</div>
                <dl className="space-y-3">
                  {fieldKeys.length === 0 ? (
                    <div className="text-sm text-gray-400">項目なし</div>
                  ) : (
                    fieldKeys.map((key) => (
                      <div key={key} className="grid grid-cols-1 gap-1">
                        <dt className="text-[11px] text-gray-500">{fieldLabels[key] || key}</dt>
                        <dd className="text-sm text-gray-900 break-words whitespace-pre-wrap">
                          <AnswerValue value={detailSubmission.data[key]} />
                        </dd>
                      </div>
                    ))
                  )}
                </dl>
              </div>
            </div>
          </aside>
        </div>
      )}

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
            <h3 className="text-base font-semibold text-gray-900">フォーム名を変更</h3>
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
