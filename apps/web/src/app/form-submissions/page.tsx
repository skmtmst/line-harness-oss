'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchApi } from '@/lib/api'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { countryFlag } from '@/lib/country-flag'
import { displayFormName, sortFormsByLatestAnswer } from './form-list'
import FormKpiValue from './form-kpi-value'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import type { FormLayout } from '@line-crm/shared'
import { summarizeFormDestinations } from './form-destination-summary'

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

type FormFilter = 'all' | 'answered' | 'unanswered'

function formatRelative(iso: string | null): string {
  if (!iso) return '未回答'
  const d = new Date(iso)
  const now = Date.now()
  const diffMin = Math.floor((now - d.getTime()) / 60000)
  if (diffMin < 1) return 'たった今'
  if (diffMin < 60) return `${diffMin}分前`
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}時間前`
  if (diffMin < 60 * 24 * 7) return `${Math.floor(diffMin / (60 * 24))}日前`
  return d.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })
}

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
  const [deleting, setDeleting] = useState(false)
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

  const handleSelectForm = (formId: string) => {
    setSelectedFormId(formId)
    loadSubmissions(formId, 1, pageSize)
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
    } catch {
      setRenameError('フォーム名を変更できませんでした。もう一度お試しください。')
    } finally {
      setSavingName(false)
    }
  }

  const openDelete = (form: Form) => {
    setDeleteTarget(form)
    setDeleteError('')
  }

  const removeForm = async () => {
    if (!deleteTarget || deleting || !selectedAccountId) return
    const targetId = deleteTarget.id
    setDeleting(true)
    setDeleteError('')
    try {
      const result = await api.forms.remove(targetId, selectedAccountId)
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
      setDeleteError('この回答フォームを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const sortedForms = useMemo(() => sortFormsByLatestAnswer(forms), [forms])
  const formCountsAvailable = !accountLoading && Boolean(selectedAccountId) && !loading && !loadError
  const answeredCount = useMemo(
    () => forms.filter((form) => form.lastSubmittedAt !== null).length,
    [forms],
  )
  const filteredForms = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP')
    return sortedForms.filter((form) => {
      if (formFilter === 'answered' && !form.lastSubmittedAt) return false
      if (formFilter === 'unanswered' && form.lastSubmittedAt) return false
      if (!normalizedQuery) return true
      return (
        displayFormName(form.name).toLocaleLowerCase('ja-JP').includes(normalizedQuery)
        || form.usedByAccounts.some((account) => account.name.toLocaleLowerCase('ja-JP').includes(normalizedQuery))
      )
    })
  }, [formFilter, query, sortedForms])
  const duplicateNameCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const form of forms) {
      const name = displayFormName(form.name).toLocaleLowerCase('ja-JP')
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return counts
  }, [forms])

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
      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">フォーム</p>
          <FormKpiValue value={formCountsAvailable ? forms.length : null} />
          <p className="text-ink-faint mt-0.5 text-xs">作成済み</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">公開中</p>
          <FormKpiValue value={formCountsAvailable ? forms.filter((form) => form.isActive).length : null} />
          <p className="text-ink-faint mt-0.5 text-xs">回答を受け付けています</p>
        </div>
        {/* 月ごとの集計と、回答率（配ったうち何人が答えたか）を出す経路が無い。 */}
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">今月の回答</p>
          <p className="text-ink-faint mt-1 text-2xl font-bold">—</p>
          <p className="text-ink-faint mt-0.5 text-xs">月ごとの集計は未対応</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">回答率</p>
          <p className="text-ink-faint mt-1 text-2xl font-bold">—</p>
          <p className="text-ink-faint mt-0.5 text-xs">配った人数を持っていません</p>
        </div>
      </div>

      {/* Form cards */}
      <section className="mb-6">
        {!loading && !loadError && forms.length > 0 && (
          <div className="mb-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={createDraft} disabled={creating}>
                  {creating ? '下書きを作成中' : 'フォームを作る'}
                </Button>
                {([
                  ['all', `すべて ${forms.length}`],
                  ['answered', `回答あり ${answeredCount}`],
                  ['unanswered', `未回答 ${forms.length - answeredCount}`],
                ] as Array<[FormFilter, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFormFilter(value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      formFilter === value
                        ? 'bg-gray-900 text-white'
                        : 'border border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-[11px] text-gray-400 md:inline">最新回答順</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="フォーム名・アカウントで検索"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-gray-300 focus:border-accent sm:w-64"
                />
              </div>
            </div>
            {query && (
              <p className="text-xs text-gray-400">{filteredForms.length}件見つかりました</p>
            )}
            {createError && <p className="text-danger text-sm">{createError}</p>}
          </div>
        )}
        {accountLoading ? (
          <ListState kind="loading" title="LINE公式アカウントを確認しています" />
        ) : !selectedAccountId ? (
          <ListState
            kind="empty"
            title="LINE公式アカウントを選んでください"
            description="上のアカウント切替から、回答フォームを使う公式アカウントを選びます。"
          />
        ) : loading ? (
          <ListState kind="loading" title="回答フォームを読み込んでいます" />
        ) : loadError ? (
          <ListState
            kind="error"
            title="回答フォームを読み込めませんでした"
            description="通信状態を確認して、もう一度読み込んでください。"
            action={<Button onClick={() => void loadForms()}>回答フォームを再読み込み</Button>}
          />
        ) : forms.length === 0 ? (
          <ListState
            kind="empty"
            title="まだ回答フォームがありません"
            description="最初のフォームを下書きで作り、質問と公開条件を設定します。"
            action={(
              <Button variant="primary" onClick={createDraft} disabled={creating}>
                {creating ? '下書きを作成中' : 'フォームを作る'}
              </Button>
            )}
          />
        ) : (
          filteredForms.length === 0 ? (
            <ListState
              kind="empty"
              title="条件に合うフォームはありません"
              description="検索語や絞り込み条件を変えてください。"
            />
          ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredForms.map((form) => {
              const isSelected = selectedFormId === form.id
              const totalCount = form.usedByAccounts.reduce((sum, a) => sum + a.count, 0)
              const displayCount = form.submitCount ?? totalCount
              const normalizedName = displayFormName(form.name)
              const isDuplicate = (duplicateNameCounts.get(normalizedName.toLocaleLowerCase('ja-JP')) ?? 0) > 1
              const destinationSummary = summarizeFormDestinations(form.layout, form.onSubmitTagId)
              return (
                <article
                  key={form.id}
                  className="group relative"
                >
                  <button
                    type="button"
                    onClick={() => handleSelectForm(form.id)}
                    aria-pressed={isSelected}
                    className={`w-full cursor-pointer rounded-xl border p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                      isSelected
                        ? 'border-accent bg-accent-soft shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                    }`}
                  >
                  <div className="mb-2 flex items-start gap-2 pr-14">
                    <h3 className={`text-sm font-semibold leading-snug ${isSelected ? 'text-accent' : 'text-gray-900'}`}>
                      {normalizedName}
                    </h3>
                  </div>

                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-2xl font-bold text-gray-900 tabular-nums">{displayCount}</span>
                    <span className="text-xs text-gray-400">件の回答</span>
                  </div>

                  {form.usedByAccounts.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {form.usedByAccounts.map((acc) => {
                        const flag = countryFlag(acc.country)
                        return (
                          <span
                            key={acc.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100 text-[11px] text-gray-700"
                            title={`${acc.name}: ${acc.count}件`}
                          >
                            {flag && <span>{flag}</span>}
                            <span className="font-medium">{acc.name}</span>
                            <span className="text-gray-400 tabular-nums">{acc.count}</span>
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-[11px] text-gray-300">回答元アカウントなし</div>
                  )}

                  <div className="bg-canvas-sunken mt-3 flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-xs">
                    <span className="text-ink-faint shrink-0">回答の保存先</span>
                    <span className="text-ink truncate font-medium" title={destinationSummary.label}>
                      {destinationSummary.label}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-2 text-[11px] text-gray-400">
                    <span>{form.lastSubmittedAt ? `最終回答 ${formatRelative(form.lastSubmittedAt)}` : '回答はまだありません'}</span>
                    {!form.isActive && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">停止中</span>
                    )}
                    {isDuplicate && (
                      <span className="ml-auto" title={`フォームID: ${form.id}`}>
                        同名あり・{form.fields.length}項目・作成 {new Date(form.createdAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}
                      </span>
                    )}
                  </div>
                  </button>

                  <div className="absolute right-3 top-3 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openRename(form)}
                      className="rounded-md p-1 text-gray-300 opacity-60 transition hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100"
                      aria-label={`${normalizedName}の名前を変更`}
                      title="フォーム名を変更"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931ZM19.5 7.125 16.875 4.5M18 13.5V19.125A1.875 1.875 0 0 1 16.125 21H4.875A1.875 1.875 0 0 1 3 19.125V7.875A1.875 1.875 0 0 1 4.875 6H10.5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => openDelete(form)}
                      className="text-ink-faint hover:bg-danger-bg hover:text-danger rounded-md p-1 opacity-60 transition group-hover:opacity-100"
                      aria-label={`${normalizedName}を削除`}
                      title="回答フォームを削除"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M19.228 5.79 18.16 19.673A2.25 2.25 0 0 1 15.916 21H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0V4.477c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
          )
        )}
      </section>

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
              action={<Button onClick={() => void loadSubmissions(selectedForm.id, page, pageSize)}>回答を再読み込み</Button>}
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
        title={deleteTarget ? `「${displayFormName(deleteTarget.name)}」を削除しますか？` : '回答フォームを削除しますか？'}
        description="フォームの質問・公開設定・集まった回答を削除します。回答から友だち情報欄やタグへ反映済みの内容は残ります。この操作は元に戻せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
        onConfirm={() => void removeForm()}
      />
    </div>
  )
}
