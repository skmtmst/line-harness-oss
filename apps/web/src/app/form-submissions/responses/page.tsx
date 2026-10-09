'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { FormBlock, FormInputType, FormLayout } from '@line-crm/shared'
import { postActionStepLabel } from './response-summary'
import Button from '@/components/shared/button'
import StatusBadge from '@/components/shared/status-badge'
import ListState from '@/components/shared/list-state'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { TextInput } from '@/components/shared/form-controls'
import TargetMissing from '@/components/shared/target-missing'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { TableHeadRow, Th } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
import FormResponsesV8 from '@/v8/form-responses/responses'
import { fetchApi, ApiError } from '@/lib/api'
import { classifyApiFailure, describeApiFailure } from '@/components/shared/api-error-message'
import { csvCell } from '@/lib/presentation'
import ListRange from '@/components/ui/list-range'
import {
  completedDestinationWrites,
  destinationWriteText,
  nextVisitPeople,
  postActionsNeedRetry,
  postActionsText,
  type DestinationWrite,
  type FormSubmissionSummary,
  type SubmissionPostActions,
} from './response-summary'
import { formatDateTime, formatNumber } from '@/lib/format'

type Submission = {
  id: string
  formId: string
  friendId: string | null
  friendName: string | null
  data: Record<string, unknown> | string
  destinationWrite: DestinationWrite
  // N-168: 後処理の状態。未完の工程があれば一覧・詳細へ出し、再実行する。
  postActions?: SubmissionPostActions | null
  createdAt: string
}

type SubmissionPage = {
  items: Submission[]
  total: number
  page: number
  limit: number
  summary?: FormSubmissionSummary
}

type FormDetail = {
  id: string
  name: string
  fields: Array<{ name: string; label: string }> | string
  layout: FormLayout
  submitCount: number
}

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.map(String).join('、') : '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function normalizedSubmission(item: Submission): Submission {
  if (typeof item.data !== 'string') return item
  try {
    return { ...item, data: JSON.parse(item.data) as Record<string, unknown> }
  } catch {
    return { ...item, data: {} }
  }
}

function saveCsv(filename: string, rows: Submission[], fieldKeys: string[], labels: Record<string, string>) {
  const header = ['回答ID', '答えた人', '答えた日時', ...fieldKeys.map((key) => labels[key] ?? key)]
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    const data = row.data as Record<string, unknown>
    lines.push([
      row.id,
      row.friendName ?? '不明',
      formatDateTime(row.createdAt),
      ...fieldKeys.map((key) => data[key]),
    ].map(csvCell).join(','))
  }
  const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/*
 * M004：後処理の再実行の失敗理由。状態の言い分けは共通部品に任せ、
 * 画面で状態を見分けて文言を書き分けない。ただし口が返した日本語の
 * 理由（記録なし等）はそのまま出す。内部文・英語文は出さない。
 */
function retryEffectsFailureText(error: unknown): string {
  if (error instanceof ApiError) {
    return describeApiFailure(error, '後処理の再実行', {
      forbidden: '後処理を再実行する権限がありません。選んでいるアカウントと権限を確認してください。',
    })
  }
  if (error instanceof Error && error.message && error.message !== 'retry_failed'
    && /[ぁ-んァ-ヶ一-龠]/u.test(error.message)) {
    return error.message
  }
  return describeApiFailure(error, '後処理の再実行')
}

function FormResponsesInner() {
  const searchParams = useSearchParams()
  const formId = searchParams.get('id') ?? ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const theme = useAdminTheme()
  const [form, setForm] = useState<FormDetail | null>(null)
  const [items, setItems] = useState<Submission[]>([])
  const [summary, setSummary] = useState<FormSubmissionSummary | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [formMissing, setFormMissing] = useState(false)
  /** 403で権限不足のとき。再試行は出さない（M005）。 */
  const [formForbidden, setFormForbidden] = useState(false)
  const [query, setQuery] = useState('')
  // V8の板は「まとめて見る」が先頭。v7は1件ずつのまま。
  // テーマは描画後にV8へ替わることがあるので、替わったときも先頭へ寄せる。
  const [view, setView] = useState<'rows' | 'summary'>(theme === 'v8' ? 'summary' : 'rows')
  useEffect(() => {
    if (theme === 'v8') setView('summary')
  }, [theme])
  const [selected, setSelected] = useState<Submission | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportProgress, setExportProgress] = useState('')
  // ページ送りを速く押すと遅い応答が後勝ちする。最新の要求だけを描く。
  const loadRequest = useRef(0)

  // N-171/N-179: 絞り込みはサーバー側へ渡し、ページング前に絞らせる。
  // 一覧・件数・CSV が同じ条件になる。空の検索語は送らない（全件のまま）。
  // query を deps に入れると1文字ごとに即時再取得が走るため、既定値は ref で読む。
  const queryRef = useRef(query)
  queryRef.current = query
  const load = useCallback(async (nextPage = 1, nextLimit = 20, searchText?: string) => {
    if (!selectedAccountId || !formId) {
      setLoading(false)
      return
    }
    const request = ++loadRequest.current
    setLoading(true)
    setError('')
    setFormMissing(false)
    setFormForbidden(false)
    try {
      const account = `account_id=${encodeURIComponent(selectedAccountId)}`
      const needle = (searchText ?? queryRef.current).trim()
      const search = needle ? `&q=${encodeURIComponent(needle)}` : ''
      const [formResult, responseResult] = await Promise.all([
        fetchApi<{ success: boolean; data: FormDetail }>(`/api/forms/${formId}?${account}`),
        fetchApi<{ success: boolean; data: SubmissionPage }>(
          `/api/forms/${formId}/submissions?page=${nextPage}&limit=${nextLimit}&${account}${search}`,
        ),
      ])
      if (!formResult.success || !responseResult.success) throw new Error('load_failed')
      if (request !== loadRequest.current) return
      setForm(formResult.data)
      setItems(responseResult.data.items.map(normalizedSubmission))
      setSummary(responseResult.data.summary ?? null)
      setTotal(responseResult.data.total)
      setPage(responseResult.data.page)
      setPageSize(responseResult.data.limit)
      setSelected(null)
    } catch (caught) {
      if (request !== loadRequest.current) return
      if (caught instanceof ApiError && caught.status === 404) {
        setFormMissing(true)
      } else if (classifyApiFailure(caught) === 'forbidden') {
        // M005：権限不足は通信障害ではない。再試行を出さず理由を示す。
        setFormForbidden(true)
      } else {
        setError('集まった回答を読み込めませんでした。')
      }
      setItems([])
      setSummary(null)
      setTotal(null)
    } finally {
      if (request === loadRequest.current) setLoading(false)
    }
  }, [formId, selectedAccountId])

  useEffect(() => {
    void load(1, 20)
  }, [load])

  // 検索語が変わったら1ページ目から取り直す。打ち終わりを捉えるため少し待つ。
  const firstQuery = useRef(true)
  useEffect(() => {
    if (firstQuery.current) {
      firstQuery.current = false
      return
    }
    if (!selectedAccountId || !formId) return
    const timer = setTimeout(() => {
      void load(1, pageSize, query)
    }, 300)
    return () => clearTimeout(timer)
    // query の変化だけを見る。load・pageSize は安定または別経路で再取得するため除外する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const fields = useMemo(() => {
    if (!form) return []
    if (Array.isArray(form.fields)) return form.fields
    try {
      const parsed = JSON.parse(form.fields) as unknown
      return Array.isArray(parsed) ? parsed as Array<{ name: string; label: string }> : []
    } catch {
      return []
    }
  }, [form])
  const labels = useMemo(() => Object.fromEntries(fields.map((field) => [field.name, field.label])), [fields])
  const fieldKeys = useMemo(() => {
    const fromDefinition = fields.map((field) => field.name)
    const fromRows = items.flatMap((item) => Object.keys(item.data as Record<string, unknown>))
    return [...new Set([...fromDefinition, ...fromRows])]
  }, [fields, items])
  // N-171: 絞り込みはサーバー側が済ませている。手元で重ねて絞ると、
  // サーバー結果と表示がずれるため、そのまま使う。
  const shown = items
  const summaries = useMemo(() => fieldKeys.map((key) => {
    const counts = new Map<string, number>()
    for (const item of shown) {
      const value = valueText((item.data as Record<string, unknown>)[key])
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return { key, values: [...counts.entries()].sort((left, right) => right[1] - left[1]) }
  }), [fieldKeys, shown])

  // 一度に書き出す上限。超えたら止めて件数を言う（黙って欠けさせない）。
  const MAX_EXPORT_ROWS = 5000
  // 口の1回あたり上限(200件)いっぱいで取り、要求の回数を減らす。
  const EXPORT_PAGE_LIMIT = 200

  const exportAll = async () => {
    if (!selectedAccountId || !form || exporting) return
    if (total !== null && total > MAX_EXPORT_ROWS) {
      setExportError(`回答が${formatNumber(total)}件あり、一度に書き出せる上限（${formatNumber(MAX_EXPORT_ROWS)}件）を超えています。`)
      return
    }
    setExporting(true)
    setExportError('')
    setExportProgress('')
    try {
      const all: Submission[] = []
      let currentPage = 1
      let expected = 0
      // N-179: 書き出しも一覧と同じ検索条件で全件取る。検索中は検索結果だけを出す。
      const exportNeedle = query.trim()
      const exportSearch = exportNeedle ? `&q=${encodeURIComponent(exportNeedle)}` : ''
      do {
        const result = await fetchApi<{ success: boolean; data: SubmissionPage }>(
          `/api/forms/${formId}/submissions?page=${currentPage}&limit=${EXPORT_PAGE_LIMIT}&account_id=${encodeURIComponent(selectedAccountId)}${exportSearch}`,
        )
        if (!result.success) throw new Error('export_failed')
        expected = result.data.total
        if (expected > MAX_EXPORT_ROWS) throw new Error('export_too_many')
        all.push(...result.data.items.map(normalizedSubmission))
        setExportProgress(`${formatNumber(Math.min(all.length, expected))} / ${formatNumber(expected)}件を取得中`)
        currentPage += 1
      } while (all.length < expected && currentPage <= 1001)
      if (all.length < expected) throw new Error('export_incomplete')
      const keys = [...new Set([...fieldKeys, ...all.flatMap((item) => Object.keys(item.data as Record<string, unknown>))])]
      saveCsv(`${form.name}-回答.csv`, all, keys, labels)
    } catch (error) {
      setExportError(
        error instanceof Error && error.message === 'export_too_many'
          ? `回答が一度に書き出せる上限（${formatNumber(MAX_EXPORT_ROWS)}件）を超えています。`
          : 'CSVを書き出せませんでした。もう一度お試しください。',
      )
    } finally {
      setExporting(false)
      setExportProgress('')
    }
  }

  // N-168: 未完の工程だけを再実行する。応答の最新の状態で一覧と詳細を更新する。
  const retryPostActions = async (item: Submission) => {
    if (!selectedAccountId || retrying) return
    setRetrying(true)
    setRetryError('')
    try {
      const result = await fetchApi<{
        success: boolean
        data?: { submission?: Submission; pendingEffects?: string[] }
        error?: string
      }>(
        `/api/forms/${formId}/submissions/${item.id}/retry-effects?account_id=${encodeURIComponent(selectedAccountId)}`,
        { method: 'POST' },
      )
      if (!result.success || !result.data?.submission) {
        throw new Error(result.error ?? 'retry_failed')
      }
      const updated = normalizedSubmission(result.data.submission)
      setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      setSelected(updated)
    } catch (error) {
      setRetryError(retryEffectsFailureText(error))
    } finally {
      setRetrying(false)
    }
  }

  if (accountLoading || loading) return <ListState kind="loading" title="集まった回答を読み込んでいます" />
  /*
    U097: 対象未指定・見つからない画面には、文で案内するだけでなく
    一覧へ戻る操作を置く。
  */
  if (!formId) {
    return (
      <TargetMissing
        kind="unspecified"
        title="見る回答フォームが指定されていません"
        description="一覧から回答を見るフォームを選び直してください。"
        backHref="/form-submissions"
        backLabel="回答フォーム一覧へ戻る"
      />
    )
  }
  if (!selectedAccountId) return <ListState kind="empty" title="LINE公式アカウントを選んでください" />
  /*
   * M005：権限不足は通信障害ではない。再試行ボタンは出さず、
   * アカウントの選び直しと管理者への確認を案内する。
   */
  if (formForbidden) {
    return (
      <TargetMissing
        kind="not-found"
        title="集まった回答を見る権限がありません"
        description="選んでいるアカウントでは見られません。アカウントを選び直すか、管理者に権限を確認してください。"
        backHref="/form-submissions"
        backLabel="回答フォーム一覧へ戻る"
      />
    )
  }
  if (formMissing || (!error && !form)) {
    return (
      <TargetMissing
        kind="not-found"
        title="この回答フォームは見つかりません"
        description="削除されたか、リンクが古くなっています。一覧から選び直してください。"
        backHref="/form-submissions"
        backLabel="回答フォーム一覧へ戻る"
      />
    )
  }
  if (error || !form) {
    return (
      <TargetMissing
        kind="error"
        title="集まった回答を読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => void load(page, pageSize)}
      />
    )
  }

  if (theme === 'v8') {
    return renderV8Responses()
  }

  function renderV8Responses() {
    if (!form) return null
    const node = view === 'summary' ? 'v0SbYR' : 'MKQyJ'
    const rate = summary?.completionRate
    const pageCount = Math.max(1, Math.ceil((total ?? 0) / pageSize))
    const firstKey = fieldKeys[0]
    const inputBlocks = [...form.layout.header, ...form.layout.sections.flatMap((s) => s.blocks)]
      .filter((b): b is Extract<FormBlock, { kind: 'input' }> => b.kind === 'input')
    const blockByKey = (key: string) =>
      inputBlocks.find((b) => b.name === key || b.id === key)
    const typeLabel = (type: FormInputType): string | null => {
      switch (type) {
        case 'radio': return 'ラジオ'
        case 'checkbox': return 'チェック'
        case 'select': return 'プルダウン'
        case 'rating': return '5段階'
        case 'textarea': return '複数行'
        case 'date': return '日付'
        default: return null
      }
    }
    return (
      <div className="flex flex-col gap-4" data-design-node={node}>
        <div>
          <Link href="/form-submissions" className="text-action text-sm">
            ←回答フォームへ
          </Link>
          <h1 className="text-ink mt-1 text-xl font-bold">集まった回答：{form.name}</h1>
          <p className="text-ink-secondary mt-1 text-xs">
            {total === null ? '—' : `${formatNumber(total)}件`}
            {rate != null ? `・答え終えた割合${formatNumber(rate)}%` : ''}
          </p>
        </div>

        <div role="tablist" aria-label="回答の見方" className="border-hairline flex gap-4 border-b text-sm">
          {(
            [
              { key: 'summary', label: 'まとめて見る' },
              { key: 'rows', label: '1件ずつ見る' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={view === tab.key}
              onClick={() => setView(tab.key)}
              className={view === tab.key ? 'text-ink border-ink border-b-2 pb-2 font-bold' : 'text-ink-secondary pb-2'}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {total === 0 && !query.trim() ? (
          <ListState kind="empty" title="まだ回答がありません" description="フォームが回答されると、ここに1件ずつ並びます。" />
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
              {view === 'summary' ? (
                <>
                  {summaries.map((fieldSummary) => {
                    const block = blockByKey(fieldSummary.key)
                    const answered = fieldSummary.values.reduce((acc, [, count]) => acc + count, 0)
                    if (block?.type === 'textarea') return null
                    const kindLabel = block ? typeLabel(block.type) : null
                    const top = fieldSummary.values.slice(0, 6)
                    const max = top[0]?.[1] ?? 0
                    return (
                      <section key={fieldSummary.key} className="bg-canvas rounded-card border-hairline border p-4">
                        <h2 className="text-ink text-sm font-bold">{labels[fieldSummary.key] ?? fieldSummary.key}</h2>
                        <p className="text-ink-faint mt-1 text-xs">
                          {kindLabel ? `${kindLabel}・` : ''}{answered === 0 ? 'まだ答えがありません' : `${formatNumber(answered)}件が答えた`}
                        </p>
                        {answered > 0 && (
                          <dl className="mt-3 space-y-2.5">
                            {top.map(([value, count]) => (
                              <div key={value}>
                                <div className="flex items-baseline justify-between gap-3">
                                  <dt className="text-ink min-w-0 flex-1 truncate text-sm" title={value}>{value}</dt>
                                  <dd className="shrink-0 text-sm tabular-nums">
                                    <span className="text-ink">{formatNumber(count)}件</span>
                                    <span className="text-ink-faint ml-1 text-xs">({formatNumber(Math.round((count / answered) * 100))}%)</span>
                                  </dd>
                                </div>
                                <div className="bg-canvas-sunken mt-1 h-2 overflow-hidden rounded-pill" aria-hidden>
                                  <div className="bg-accent-deep h-2 rounded-pill" style={{ width: `${max === 0 ? 0 : Math.round((count / max) * 100)}%` }} />
                                </div>
                              </div>
                            ))}
                          </dl>
                        )}
                      </section>
                    )
                  })}
                  <FreeTextCard
                    fieldKeys={fieldKeys}
                    labels={labels}
                    blocks={inputBlocks}
                    items={shown}
                    onSeeRows={() => setView('rows')}
                  />
                  <div className="text-right">
                    <button type="button" onClick={() => setView('rows')} className="text-action text-sm">
                      → 1件ずつ見る
                    </button>
                  </div>
                </>
              ) : shown.length === 0 ? (
                <div className="bg-canvas rounded-card border-hairline border p-8 text-center">
                  <p className="text-ink text-sm font-bold">条件に合う回答はありません</p>
                  <p className="text-ink-secondary mt-1 text-xs">検索語を変えてください。</p>
                  <Button variant="secondary" className="mt-3" onClick={() => setQuery('')}>
                    × 条件を外す
                  </Button>
                </div>
              ) : (
                <>
                  <section className="bg-canvas rounded-card border-hairline overflow-hidden border">
                    <table className="w-full table-fixed">
                      <thead>
                        <TableHeadRow>
                          <Th style={{ width: '22%' }}>答えた日時</Th>
                          <Th style={{ width: '24%' }}>答えた人</Th>
                          <Th>{firstKey ? (labels[firstKey] ?? firstKey) : '回答'}</Th>
                          <Th style={{ width: '18%' }}>後処理</Th>
                        </TableHeadRow>
                      </thead>
                      <tbody className="divide-hairline divide-y">
                        {shown.map((item) => {
                          const actions = item.postActions
                          const incomplete = actions == null || actions.state === 'untracked'
                            ? null
                            : actions.state === 'completed' ? false : true
                          return (
                            <tr
                              key={item.id}
                              onClick={() => setSelected(item)}
                              className={selected?.id === item.id ? 'bg-accent-soft cursor-pointer hover:bg-canvas-sunken' : 'cursor-pointer hover:bg-canvas-sunken'}
                            >
                              <td className="text-ink-secondary px-3 py-3 text-xs whitespace-nowrap">{formatDateTime(item.createdAt)}</td>
                              <td className="text-action truncate px-3 py-3 text-sm font-medium" title={item.friendName ?? '不明'}>{item.friendName ?? '不明'}</td>
                              <td className="text-ink truncate px-3 py-3 text-sm" title={firstKey ? valueText((item.data as Record<string, unknown>)[firstKey]) : '—'}>
                                {firstKey ? valueText((item.data as Record<string, unknown>)[firstKey]) : '—'}
                              </td>
                              <td className="px-3 py-3">
                                {incomplete === null ? (
                                  <span className="text-ink-faint text-xs">—</span>
                                ) : incomplete ? (
                                  <StatusBadge tone="danger">未完</StatusBadge>
                                ) : (
                                  <StatusBadge tone="success">済み</StatusBadge>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </section>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-ink-secondary text-xs">
                      {total === null ? '—' : <ListRange total={total} first={total === 0 ? 0 : (page - 1) * pageSize + 1} last={Math.min(page * pageSize, total)} />}
                    </p>
                    <Pagination page={page} pageCount={pageCount} disabled={loading} ariaLabel="回答一覧のページ送り" onPageChange={(next) => void load(next, pageSize)} />
                  </div>
                </>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Button href={`/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic`} variant="secondary">
                  フォームを編集
                </Button>
                <Button variant="secondary" onClick={() => void exportAll()} disabled={exporting || total === 0} busy={exporting} busyLabel={(exportProgress || 'CSVを準備しています')}>
                  CSVで書き出す
                </Button>
              </div>
              {exportError && <p className="text-danger text-sm">{exportError}</p>}
              {exporting && exportProgress && (
                <p className="text-ink-secondary text-sm" role="status">{exportProgress}</p>
              )}
              <section className="bg-canvas rounded-card border-hairline border p-4">
                <h2 className="text-ink text-sm font-bold">絞り込み</h2>
                <label className="text-ink-secondary mt-3 mb-1 block text-xs" htmlFor="v8-response-filter">
                  名前・答えで探す（全件から）
                </label>
                <TextInput
                  id="v8-response-filter"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="名前・答えで探す（全件から）"
                />
              </section>
              {view === 'rows' && selected && (
                <ResponseRail
                  item={selected}
                  fieldKeys={fieldKeys}
                  labels={labels}
                  retrying={retrying}
                  retryError={retryError}
                  onRetryPostActions={() => void retryPostActions(selected)}
                />
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  const pageCount = Math.max(1, Math.ceil((total ?? 0) / pageSize))
  const destinationWriteCount = completedDestinationWrites(summary)
  const failedDestinationWrites = summary?.destinationWrites.failed ?? null
  const nextVisitSummary = summary?.dateFields.find((field) => field.key === 'next_visit')
  const nextVisitCount = nextVisitPeople(summary)

  return (
    <div data-design-node="v9tYhl" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="text-ink-faint text-xs">
          <Link href="/form-submissions" className="text-action hover:underline">回答フォーム</Link>
          <span className="mx-2">/</span>
          <span className="text-action">{form.name}</span>
          <span className="mx-2">/</span>
          <span>集まった回答</span>
        </nav>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => document.getElementById('form-response-filter')?.focus()}>絞り込む</Button>
          <Button onClick={() => void exportAll()} disabled={exporting || total === 0} busy={exporting} busyLabel={(exportProgress || 'CSVを準備しています')}>CSVで書き出す
          </Button>
          <Button href={`/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic`} variant="primary">フォームを編集</Button>
        </div>
      </div>

      <div className="border-hairline flex items-center gap-6 border-b">
        <button type="button" onClick={() => setView('rows')} className={`border-b-2 px-1 py-3 text-sm font-semibold ${view === 'rows' ? 'border-accent-deep text-accent-deep' : 'border-transparent text-ink-faint'}`}>1件ずつ見る　{total === null ? '—' : `${formatNumber(total)}件`}</button>
        <button type="button" onClick={() => setView('summary')} className={`border-b-2 px-1 py-3 text-sm font-semibold ${view === 'summary' ? 'border-accent-deep text-accent-deep' : 'border-transparent text-ink-faint'}`}>まとめて見る</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="回答" value={total === null ? '—' : `${formatNumber(total)}件`} note="現在保存されている回答" />
        <Kpi
          label="開いた人のうち答えた割合"
          value={summary?.completionRate == null ? '—' : `${formatNumber(summary.completionRate)}%`}
          note={summary ? `${formatNumber(summary.startedUnique)}人が開いて、${formatNumber(summary.submitted)}人が答えた` : '開始数の集計を取得できませんでした'}
        />
        <Kpi
          label="友だち情報欄への書き込み"
          value={destinationWriteCount == null ? '—' : `${formatNumber(destinationWriteCount)}件`}
          note={failedDestinationWrites == null ? '書き込み結果を取得できませんでした' : failedDestinationWrites > 0 ? `${formatNumber(failedDestinationWrites)}件は欄が消えていて書けていません` : 'すべて書き込み済みです'}
        />
        <Kpi
          label="次回の予定が入った人"
          value={nextVisitCount == null ? '—' : `${formatNumber(nextVisitCount)}人`}
          note={nextVisitSummary ? `${nextVisitSummary.label}を全回答から集計` : summary ? '日付の回答を全回答から集計' : '日付項目の集計を取得できませんでした'}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-ink-secondary text-xs" htmlFor="form-response-filter">名前・答えで探す（全件から）</label>
        <input id="form-response-filter" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・答えで探す（全件から）" className="border-hairline bg-canvas text-ink rounded-control w-full border px-3 py-2 text-sm sm:w-72" />
      </div>
      {exportError && <p className="text-danger text-sm">{exportError}</p>}
      {exporting && exportProgress && (
        <p className="text-ink-secondary text-sm" role="status">{exportProgress}</p>
      )}

      {total === 0 && !query.trim() ? (
        <ListState kind="empty" title="まだ回答がありません" description="フォームが回答されると、ここに1件ずつ並びます。" />
      ) : view === 'summary' ? (
        <div className="grid gap-3 md:grid-cols-2">
          {summaries.map((summary) => (
            <section key={summary.key} className="bg-canvas rounded-card border-hairline border p-4">
              <h2 className="text-ink text-sm font-semibold">{labels[summary.key] ?? summary.key}</h2>
              <p className="text-ink-faint mt-1 text-xs">表示中の回答だけを集計しています</p>
              <dl className="mt-3 space-y-2">
                {summary.values.map(([value, count]) => <div key={value} className="flex justify-between gap-3 text-sm"><dt className="text-ink-secondary truncate" title={value}>{value}</dt><dd className="text-ink shrink-0 tabular-nums">{count}件</dd></div>)}
              </dl>
            </section>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <ListState kind="empty" title="条件に合う回答はありません" description="検索語を変えてください。" />
      ) : (
        <>
          <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
            <table className="w-full table-fixed">
              <thead><TableHeadRow><Th style={{ width: '30%' }}>答えた人</Th><Th style={{ width: '14%' }}>答えた日時</Th>{fieldKeys.slice(0, 3).map((key) => <Th key={key}>{labels[key] ?? key}</Th>)}<Th className="w-16"><span className="sr-only">操作</span></Th></TableHeadRow></thead>
              <tbody className="divide-hairline divide-y">
                {shown.map((item) => (
                  <tr key={item.id} className="hover:bg-canvas-sunken cursor-pointer" onClick={() => setSelected(item)}>
                    <td className="px-3 py-3"><p className="text-ink truncate text-sm font-semibold" title={item.friendName ?? '不明'}>{item.friendName ?? '不明'}</p><p className="text-ink-faint mt-1 truncate text-xs" title={valueText(Object.values(item.data as Record<string, unknown>)[0])}>{valueText(Object.values(item.data as Record<string, unknown>)[0])}</p>{/* 板 MKQyJ の後処理の札。終わり＝済み、未完あり＝未完。記録なしは何も出さない。 */}{item.postActions?.state === 'completed' ? <p className="mt-1"><StatusBadge tone="success">済み</StatusBadge></p> : postActionsNeedRetry(item.postActions) ? <p className="mt-1"><StatusBadge tone="danger">未完</StatusBadge></p> : null}</td>
                    <td className="text-ink-secondary px-3 py-3 text-xs whitespace-nowrap">{formatDateTime(item.createdAt)}</td>
                    {fieldKeys.slice(0, 3).map((key) => <td key={key} className="text-ink-secondary truncate px-3 py-3 text-sm" title={valueText((item.data as Record<string, unknown>)[key])}>{valueText((item.data as Record<string, unknown>)[key])}</td>)}
                    <td className="text-ink-faint px-3 py-3 text-center">•••</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p>{total === null ? '—' : <ListRange total={total} first={total === 0 ? 0 : (page - 1) * pageSize + 1} last={Math.min(page * pageSize, total)} />}</p>
            <div className="flex items-center gap-2">
              <Select aria-label="回答の表示件数" size="page-size" value={String(pageSize)} options={[10, 20, 50].map((size) => ({ value: String(size), label: `${size}件表示` }))} onChange={(value) => void load(1, Number(value))} />
              <Pagination page={page} pageCount={pageCount} disabled={loading} ariaLabel="回答一覧のページ送り" onPageChange={(next) => void load(next, pageSize)} />
            </div>
          </div>
        </>
      )}

      {selected && (
        <ResponseDetail
          item={selected}
          fieldKeys={fieldKeys}
          labels={labels}
          onClose={() => setSelected(null)}
          retrying={retrying}
          retryError={retryError}
          onRetryPostActions={() => void retryPostActions(selected)}
        />
      )}
    </div>
  )
}

/*
 * ★V8（板 `v0SbYR`・`MKQyJ`）：見た目テーマが v8 のときだけ新しい画面
 * （src/v8/form-responses/responses.tsx）に切り替える。v7 の見た目はそのまま。
 */
export default function FormResponsesPage() {
  usePageTitle('集まった回答')
  const theme = useAdminTheme()
  if (theme === 'v8') return <FormResponsesV8 />
  return (
    <Suspense fallback={<ListState kind="loading" title="集まった回答を読み込んでいます" />}>
      <FormResponsesInner />
    </Suspense>
  )
}

type InputBlock = Extract<FormBlock, { kind: 'input' }>

/** V8まとめて見る：自由に書く欄の新しい答えを2件だけ出す。無い欄は出さない。 */
function FreeTextCard({
  fieldKeys,
  labels,
  blocks,
  items,
  onSeeRows,
}: {
  fieldKeys: string[]
  labels: Record<string, string>
  blocks: InputBlock[]
  items: Submission[]
  onSeeRows: () => void
}) {
  const longKeys = fieldKeys.filter(
    (key) => blocks.find((b) => b.name === key || b.id === key)?.type === 'textarea',
  )
  const targetKey = longKeys.find((key) =>
    items.some((item) => String((item.data as Record<string, unknown>)[key] ?? '').trim() !== ''),
  )
  if (!targetKey) return null
  const recents = items
    .filter((item) => String((item.data as Record<string, unknown>)[targetKey] ?? '').trim() !== '')
    .slice(0, 2)
  return (
    <section className="bg-canvas rounded-card border-hairline border p-4">
      <h2 className="text-ink text-sm font-bold">{labels[targetKey] ?? targetKey}</h2>
      <p className="text-ink-faint mt-1 text-xs">複数行</p>
      <ul className="mt-3 space-y-2">
        {recents.map((item) => (
          <li key={item.id} className="border-hairline flex items-baseline justify-between gap-3 border-b pb-2 text-sm">
            <span className="text-ink min-w-0 flex-1 truncate" title={String((item.data as Record<string, unknown>)[targetKey])}>
              「{String((item.data as Record<string, unknown>)[targetKey])}」
            </span>
            <span className="text-ink-secondary shrink-0 text-xs">
              {formatDateTime(item.createdAt).slice(5)} {item.friendName ?? '不明'}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 text-right">
        <button type="button" onClick={onSeeRows} className="text-action text-sm">
          → 1件ずつ見る
        </button>
      </div>
    </section>
  )
}

/** V8の1件ずつ見る：右の欄に出す回答の詳細。後処理のやり直しもここから。 */
function ResponseRail({
  item,
  fieldKeys,
  labels,
  retrying,
  retryError,
  onRetryPostActions,
}: {
  item: Submission
  fieldKeys: string[]
  labels: Record<string, string>
  retrying: boolean
  retryError: string
  onRetryPostActions: () => void
}) {
  const actions = item.postActions
  const incomplete = actions != null && actions.state !== 'untracked' && actions.state !== 'completed'
  const data = item.data as Record<string, unknown>
  return (
    <section className="bg-canvas rounded-card border-hairline border p-4" aria-label={`回答の詳細：${item.friendName ?? '不明'}`}>
      <h2 className="text-ink text-sm font-bold">回答の詳細：{item.friendName ?? '不明'}</h2>
      <dl className="mt-3 space-y-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-faint text-xs">答えた日時</dt>
          <dd className="text-ink text-sm">{formatDateTime(item.createdAt)}</dd>
        </div>
        {fieldKeys.map((key) => (
          <div key={key} className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-faint min-w-0 flex-1 truncate text-xs" title={labels[key] ?? key}>{labels[key] ?? key}</dt>
            <dd className="text-ink min-w-0 flex-1 truncate text-right text-sm" title={valueText(data[key])}>{valueText(data[key])}</dd>
          </div>
        ))}
      </dl>
      <div className="border-hairline mt-3 border-t pt-3">
        <p className="text-ink text-xs font-bold">後処理</p>
        {actions == null || actions.state === 'untracked' ? (
          <p className="text-ink-faint mt-1 text-xs">この回答には後処理の記録がありません</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {actions.pending.length === 0 ? (
              <li className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink">すべての工程</span>
                <StatusBadge tone="success">済み</StatusBadge>
              </li>
            ) : (
              actions.pending.map((step) => (
                <li key={step} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink">{postActionStepLabel(step)}</span>
                  <StatusBadge tone="danger">未完</StatusBadge>
                </li>
              ))
            )}
          </ul>
        )}
        {incomplete && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={onRetryPostActions} disabled={retrying} busy={retrying} busyLabel="再実行しています">
              後処理をやり直す
            </Button>
          </div>
        )}
        {retryError && <p className="text-danger mt-2 text-xs">{retryError}</p>}
      </div>
      {item.friendId && (
        <Button className="mt-3" variant="secondary" href={`/chats?friend=${encodeURIComponent(item.friendId)}`}>
          友だちを開く
        </Button>
      )}
    </section>
  )
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return <section className="bg-canvas rounded-card border-hairline border p-4"><p className="text-ink-faint text-xs font-medium">{label}</p><p className="text-ink mt-2 text-2xl font-semibold tabular-nums">{value}</p><p className="text-ink-faint mt-1 text-xs">{note}</p></section>
}

function ResponseDetail({
  item,
  fieldKeys,
  labels,
  onClose,
  retrying,
  retryError,
  onRetryPostActions,
}: {
  item: Submission
  fieldKeys: string[]
  labels: Record<string, string>
  onClose: () => void
  retrying: boolean
  retryError: string
  onRetryPostActions: () => void
}) {
  // 詳細の引き出しも窓と同じ約束: Escapeで閉じる・Tabは中だけ・
  // 閉じたら起点へ戻す。背景の閉じるボタンは循環に入れないよう aside 側へ。
  const panelRef = useOverlayFocus(true, onClose)
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="bg-ink/30 absolute inset-0" onClick={onClose} aria-label="回答詳細を閉じる" />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-label="回答詳細" className="bg-canvas relative h-full w-full max-w-md overflow-y-auto p-5 shadow-float">
        <div className="border-hairline flex items-center justify-between border-b pb-4"><h2 className="text-ink text-base font-bold">回答詳細</h2><button type="button" onClick={onClose} className="text-ink-faint text-xl" aria-label="閉じる">×</button></div>
        <dl className="mt-5 space-y-4">
          <Detail label="答えた人" value={item.friendName ?? '不明'} />
          <Detail label="答えた日時" value={formatDateTime(item.createdAt)} />
          <Detail label="フォームの版" value="—（回答単位の版は未取得）" />
          {fieldKeys.map((key) => <Detail key={key} label={labels[key] ?? key} value={valueText((item.data as Record<string, unknown>)[key])} />)}
          <Detail label="友だち情報欄への書き込み" value={destinationWriteText(item.destinationWrite)} />
          <div>
            <dt className="text-ink-faint text-xs">アクション結果</dt>
            <dd className="text-ink mt-1 break-words text-sm whitespace-pre-wrap">{postActionsText(item.postActions)}</dd>
            {postActionsNeedRetry(item.postActions) && (
              <div className="mt-2">
                <Button onClick={onRetryPostActions} disabled={retrying} busy={retrying} busyLabel="再実行しています">後処理をやり直す
                </Button>
                {retryError && <p className="text-danger mt-2 text-xs">{retryError}</p>}
              </div>
            )}
          </div>
          <Detail label="Webhook結果" value="—（回答単位の結果は未取得）" />
        </dl>
        {item.friendId && <Button className="mt-6" href={`/chats?friend=${encodeURIComponent(item.friendId)}`}>友だちを開く</Button>}
      </aside>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-ink-faint text-xs">{label}</dt><dd className="text-ink mt-1 break-words text-sm whitespace-pre-wrap">{value}</dd></div>
}
