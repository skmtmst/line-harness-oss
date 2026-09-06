'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { FormLayout } from '@line-crm/shared'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { TableHeadRow, Th } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { fetchApi } from '@/lib/api'

type Submission = {
  id: string
  formId: string
  friendId: string | null
  friendName: string | null
  data: Record<string, unknown> | string
  createdAt: string
}

type SubmissionPage = {
  items: Submission[]
  total: number
  page: number
  limit: number
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

function csvCell(value: unknown): string {
  let text = valueText(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

function saveCsv(filename: string, rows: Submission[], fieldKeys: string[], labels: Record<string, string>) {
  const header = ['回答ID', '答えた人', '答えた日時', ...fieldKeys.map((key) => labels[key] ?? key)]
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    const data = row.data as Record<string, unknown>
    lines.push([
      row.id,
      row.friendName ?? '不明',
      new Date(row.createdAt).toLocaleString('ja-JP'),
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

export default function FormResponsesPage() {
  usePageTitle('集まった回答')
  const params = useParams<{ id: string }>()
  const formId = params.id
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [form, setForm] = useState<FormDetail | null>(null)
  const [items, setItems] = useState<Submission[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'rows' | 'summary'>('rows')
  const [selected, setSelected] = useState<Submission | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const load = useCallback(async (nextPage = 1, nextLimit = 20) => {
    if (!selectedAccountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const account = `account_id=${encodeURIComponent(selectedAccountId)}`
      const [formResult, responseResult] = await Promise.all([
        fetchApi<{ success: boolean; data: FormDetail }>(`/api/forms/${formId}?${account}`),
        fetchApi<{ success: boolean; data: SubmissionPage }>(
          `/api/forms/${formId}/submissions?page=${nextPage}&limit=${nextLimit}&${account}`,
        ),
      ])
      if (!formResult.success || !responseResult.success) throw new Error('load_failed')
      setForm(formResult.data)
      setItems(responseResult.data.items.map(normalizedSubmission))
      setTotal(responseResult.data.total)
      setPage(responseResult.data.page)
      setPageSize(responseResult.data.limit)
      setSelected(null)
    } catch {
      setError('集まった回答を読み込めませんでした。')
      setItems([])
      setTotal(null)
    } finally {
      setLoading(false)
    }
  }, [formId, selectedAccountId])

  useEffect(() => {
    void load(1, 20)
  }, [load])

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
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    if (!needle) return items
    return items.filter((item) => [
      item.friendName ?? '',
      ...Object.values(item.data as Record<string, unknown>).map(valueText),
    ].some((value) => value.toLocaleLowerCase('ja-JP').includes(needle)))
  }, [items, query])
  const summaries = useMemo(() => fieldKeys.map((key) => {
    const counts = new Map<string, number>()
    for (const item of shown) {
      const value = valueText((item.data as Record<string, unknown>)[key])
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return { key, values: [...counts.entries()].sort((left, right) => right[1] - left[1]) }
  }), [fieldKeys, shown])

  const exportAll = async () => {
    if (!selectedAccountId || !form || exporting) return
    setExporting(true)
    setExportError('')
    try {
      const all: Submission[] = []
      let currentPage = 1
      let expected = 0
      do {
        const result = await fetchApi<{ success: boolean; data: SubmissionPage }>(
          `/api/forms/${formId}/submissions?page=${currentPage}&limit=50&account_id=${encodeURIComponent(selectedAccountId)}`,
        )
        if (!result.success) throw new Error('export_failed')
        expected = result.data.total
        all.push(...result.data.items.map(normalizedSubmission))
        currentPage += 1
      } while (all.length < expected && currentPage <= 1001)
      if (all.length < expected) throw new Error('export_incomplete')
      const keys = [...new Set([...fieldKeys, ...all.flatMap((item) => Object.keys(item.data as Record<string, unknown>))])]
      saveCsv(`${form.name}-回答.csv`, all, keys, labels)
    } catch {
      setExportError('CSVを書き出せませんでした。もう一度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  if (accountLoading || loading) return <ListState kind="loading" title="集まった回答を読み込んでいます" />
  if (!selectedAccountId) return <ListState kind="empty" title="LINE公式アカウントを選んでください" />
  if (error) return <ListState kind="error" title={error} description="通信状態を確認して、もう一度読み込んでください。" onRetry={() => void load(page, pageSize)} />
  if (!form) return <ListState kind="empty" title="回答フォームが見つかりません" />

  const pageCount = Math.max(1, Math.ceil((total ?? 0) / pageSize))

  return (
    <div data-design-node="v9tYhl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="text-ink-faint text-xs">
          <Link href="/form-submissions" className="text-action hover:underline">回答フォーム</Link>
          <span className="mx-2">/</span>
          <span className="text-action">{form.name}</span>
          <span className="mx-2">/</span>
          <span>集まった回答</span>
        </nav>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => document.getElementById('form-response-filter')?.focus()}>絞り込む</Button>
          <Button onClick={() => void exportAll()} disabled={exporting || total === 0}>
            {exporting ? 'CSVを準備しています' : 'CSVで書き出す'}
          </Button>
          <Button href={`/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic`} variant="primary">フォームを編集</Button>
        </div>
      </div>

      <div className="border-hairline mb-4 flex items-center gap-6 border-b">
        <button type="button" onClick={() => setView('rows')} className={`border-b-2 px-1 py-3 text-sm font-semibold ${view === 'rows' ? 'border-accent-deep text-accent-deep' : 'border-transparent text-ink-faint'}`}>1件ずつ見る　{total === null ? '—' : `${total.toLocaleString('ja-JP')}件`}</button>
        <button type="button" onClick={() => setView('summary')} className={`border-b-2 px-1 py-3 text-sm font-semibold ${view === 'summary' ? 'border-accent-deep text-accent-deep' : 'border-transparent text-ink-faint'}`}>まとめて見る</button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="回答" value={total === null ? '—' : `${total.toLocaleString('ja-JP')}件`} note="現在保存されている回答" />
        <Kpi label="開いた人のうち答えた割合" value="—" note="開いた実人数の集計口がありません" />
        <Kpi label="友だち情報欄への書き込み" value="—" note="回答単位の書き込み結果は未取得です" />
        <Kpi label="次回の予定が入った人" value="—" note="日付項目を全件集計する口がありません" />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <label className="text-ink-secondary text-xs" htmlFor="form-response-filter">表示中の{items.length}件を絞り込む</label>
        <input id="form-response-filter" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・回答内容で検索" className="border-hairline bg-canvas text-ink rounded-control w-full border px-3 py-2 text-sm sm:w-72" />
      </div>
      {exportError && <p className="text-danger mb-3 text-sm">{exportError}</p>}

      {total === 0 ? (
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
              <thead><TableHeadRow><Th className="w-[30%]">答えた人</Th><Th className="w-[14%]">答えた日時</Th>{fieldKeys.slice(0, 3).map((key) => <Th key={key}>{labels[key] ?? key}</Th>)}<Th className="w-16"><span className="sr-only">操作</span></Th></TableHeadRow></thead>
              <tbody className="divide-hairline divide-y">
                {shown.map((item) => (
                  <tr key={item.id} className="hover:bg-canvas-sunken cursor-pointer" onClick={() => setSelected(item)}>
                    <td className="px-3 py-3"><p className="text-ink truncate text-sm font-semibold" title={item.friendName ?? '不明'}>{item.friendName ?? '不明'}</p><p className="text-ink-faint mt-1 truncate text-xs" title={valueText(Object.values(item.data as Record<string, unknown>)[0])}>{valueText(Object.values(item.data as Record<string, unknown>)[0])}</p></td>
                    <td className="text-ink-secondary px-3 py-3 text-xs whitespace-nowrap">{new Date(item.createdAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    {fieldKeys.slice(0, 3).map((key) => <td key={key} className="text-ink-secondary truncate px-3 py-3 text-sm" title={valueText((item.data as Record<string, unknown>)[key])}>{valueText((item.data as Record<string, unknown>)[key])}</td>)}
                    <td className="text-ink-faint px-3 py-3 text-center">•••</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink-faint text-xs">{total === null ? '—' : `${total.toLocaleString('ja-JP')}件中 ${(page - 1) * pageSize + 1}〜${Math.min(page * pageSize, total)}件を表示`}</p>
            <div className="flex items-center gap-2">
              <Select aria-label="回答の表示件数" size="page-size" value={String(pageSize)} options={[10, 20, 50].map((size) => ({ value: String(size), label: `${size}件表示` }))} onChange={(value) => void load(1, Number(value))} />
              <Pagination page={page} pageCount={pageCount} disabled={loading} ariaLabel="回答一覧のページ送り" onPageChange={(next) => void load(next, pageSize)} />
            </div>
          </div>
        </>
      )}

      {selected && <ResponseDetail item={selected} fieldKeys={fieldKeys} labels={labels} onClose={() => setSelected(null)} />}
    </div>
  )
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return <section className="bg-canvas rounded-card border-hairline border p-4"><p className="text-ink-faint text-xs font-medium">{label}</p><p className="text-ink mt-2 text-2xl font-bold tabular-nums">{value}</p><p className="text-ink-faint mt-1 text-xs">{note}</p></section>
}

function ResponseDetail({ item, fieldKeys, labels, onClose }: { item: Submission; fieldKeys: string[]; labels: Record<string, string>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/30" onClick={onClose} aria-label="回答詳細を閉じる" />
      <aside className="bg-canvas relative h-full w-full max-w-md overflow-y-auto p-5 shadow-xl">
        <div className="border-hairline flex items-center justify-between border-b pb-4"><h2 className="text-ink text-base font-bold">回答詳細</h2><button type="button" onClick={onClose} className="text-ink-faint text-xl" aria-label="閉じる">×</button></div>
        <dl className="mt-5 space-y-4">
          <Detail label="答えた人" value={item.friendName ?? '不明'} />
          <Detail label="答えた日時" value={new Date(item.createdAt).toLocaleString('ja-JP')} />
          <Detail label="フォームの版" value="—（回答単位の版は未取得）" />
          {fieldKeys.map((key) => <Detail key={key} label={labels[key] ?? key} value={valueText((item.data as Record<string, unknown>)[key])} />)}
          <Detail label="アクション結果" value="—（回答単位の結果は未取得）" />
          <Detail label="Webhook結果" value="—（回答単位の結果は未取得）" />
        </dl>
        {item.friendId && <Button className="mt-6" href={`/chats?friend=${encodeURIComponent(item.friendId)}`}>友だち詳細を開く</Button>}
      </aside>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-ink-faint text-xs">{label}</dt><dd className="text-ink mt-1 break-words text-sm whitespace-pre-wrap">{value}</dd></div>
}
