'use client'

/*
 * ★V8 回答フォーム「集まった回答」（Pencil まとめて見る `v0SbYR`・1件ずつ見る `MKQyJ`）。
 *
 * 型（DetailPage）の頭とタブに、左の本文（まとめ／表）と右の列（フォームを編集・CSV・絞り込み・回答の詳細）をはめる。
 * 読み込み・検索・CSV・後処理のやり直しは今の作り（src/app/form-submissions/responses/page.tsx）と同じ口と同じ文。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowLeft, ArrowRight, Download, Pencil, RotateCw, Search, User } from 'lucide-react'
import type { FormBlock, FormInputType, FormLayout } from '@line-crm/shared'
import { fetchApi, ApiError } from '@/lib/api'
import { csvCell } from '@/lib/presentation'
import { formatDateTime, formatNumber } from '@/lib/format'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { DetailPage } from '@/components/templates'
import { classifyApiFailure, describeApiFailure } from '@/components/shared/api-error-message'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import TargetMissing from '@/components/shared/target-missing'
import { TableHeadRow, Th } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import ListRange from '@/components/ui/list-range'
import {
  postActionStepLabel,
  ratingAverageText,
  type DestinationWrite,
  type FormSubmissionSummary,
  type SubmissionPostActions,
} from './summary'
import styles from './responses.module.css'

type Submission = {
  id: string
  formId: string
  friendId: string | null
  friendName: string | null
  data: Record<string, unknown> | string
  destinationWrite: DestinationWrite
  postActions?: SubmissionPostActions | null
  createdAt: string
}
type SubmissionPage = { items: Submission[]; total: number; page: number; limit: number; summary?: FormSubmissionSummary }
type FormDetail = { id: string; name: string; fields: Array<{ name: string; label: string }> | string; layout: FormLayout; submitCount: number }
type InputBlock = Extract<FormBlock, { kind: 'input' }>

/* 一度に書き出す上限。超えたら止めて件数を言う（黙って欠けさせない）。今の作りと同じ。 */
const MAX_EXPORT_ROWS = 5000
const EXPORT_PAGE_LIMIT = 200

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
    lines.push([row.id, row.friendName ?? '不明', formatDateTime(row.createdAt), ...fieldKeys.map((key) => data[key])].map(csvCell).join(','))
  }
  const url = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
function retryEffectsFailureText(error: unknown): string {
  if (error instanceof ApiError) {
    return describeApiFailure(error, '後処理の再実行', {
      forbidden: '後処理を再実行する権限がありません。選んでいるアカウントと権限を確認してください。',
    })
  }
  if (error instanceof Error && error.message && error.message !== 'retry_failed' && /[ぁ-んァ-ヶ一-龠]/u.test(error.message)) {
    return error.message
  }
  return describeApiFailure(error, '後処理の再実行')
}
/** 「9/30 17:40」（日本時間）。絵どおり年と曜日は出さない。 */
function shortWhen(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return '—'
  const jst = new Date(time + 9 * 3600_000)
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${jst.toISOString().slice(11, 16)}`
}
function shortDay(iso: string): string {
  return shortWhen(iso).split(' ')[0] ?? ''
}
/** 後処理の状態：null＝記録なし、true＝未完、false＝済み。 */
function incompleteOf(item: Submission): boolean | null {
  const actions = item.postActions
  if (actions == null || actions.state === 'untracked') return null
  return actions.state !== 'completed'
}
function typeLabel(type: FormInputType): string | null {
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

export default function FormResponsesV8() {
  usePageTitle('集まった回答')
  return (
    <Suspense fallback={<ListState kind="loading" title="集まった回答を読み込んでいます" />}>
      <Responses />
    </Suspense>
  )
}

function Responses() {
  const searchParams = useSearchParams()
  const formId = searchParams.get('id') ?? ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [form, setForm] = useState<FormDetail | null>(null)
  const [items, setItems] = useState<Submission[]>([])
  const [summary, setSummary] = useState<FormSubmissionSummary | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formMissing, setFormMissing] = useState(false)
  const [formForbidden, setFormForbidden] = useState(false)
  const [query, setQuery] = useState('')
  /* 絵（v0SbYR）は「まとめて見る」が先頭。 */
  const [view, setView] = useState<'rows' | 'summary'>('summary')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportProgress, setExportProgress] = useState('')
  const loadRequest = useRef(0)
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
        fetchApi<{ success: boolean; data: SubmissionPage }>(`/api/forms/${formId}/submissions?page=${nextPage}&limit=${nextLimit}&${account}${search}`),
      ])
      if (!formResult.success || !responseResult.success) throw new Error('load_failed')
      if (request !== loadRequest.current) return
      setForm(formResult.data)
      setItems(responseResult.data.items.map(normalizedSubmission))
      setSummary(responseResult.data.summary ?? null)
      setTotal(responseResult.data.total)
      setPage(responseResult.data.page)
      setPageSize(responseResult.data.limit)
      setSelectedId(null)
    } catch (caught) {
      if (request !== loadRequest.current) return
      if (caught instanceof ApiError && caught.status === 404) setFormMissing(true)
      else if (classifyApiFailure(caught) === 'forbidden') setFormForbidden(true)
      else setError('集まった回答を読み込めませんでした。')
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

  /* 検索語が変わったら1ページ目から取り直す（打ち終わりを待つ）。 */
  const firstQuery = useRef(true)
  useEffect(() => {
    if (firstQuery.current) {
      firstQuery.current = false
      return
    }
    if (!selectedAccountId || !formId) return
    const timer = setTimeout(() => { void load(1, pageSize, query) }, 300)
    return () => clearTimeout(timer)
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
  const inputBlocks = useMemo<InputBlock[]>(() => (form
    ? [...form.layout.header, ...form.layout.sections.flatMap((section) => section.blocks)].filter((block): block is InputBlock => block.kind === 'input')
    : []), [form])
  const blockByKey = (key: string) => inputBlocks.find((block) => block.name === key || block.id === key)
  const summaries = useMemo(() => fieldKeys.map((key) => {
    const counts = new Map<string, number>()
    for (const item of items) {
      const value = valueText((item.data as Record<string, unknown>)[key])
      if (value === '—') continue
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return { key, values: [...counts.entries()].sort((left, right) => right[1] - left[1]) }
  }), [fieldKeys, items])

  /* 1件ずつ見るでは、右の詳細に最初の未完（無ければ先頭）を出しておく（絵 MKQyJ）。 */
  const selected = items.find((item) => item.id === selectedId)
    ?? (view === 'rows' ? (items.find((item) => incompleteOf(item) === true) ?? items[0] ?? null) : null)
  const incompleteItems = items.filter((item) => incompleteOf(item) === true)
  const failedSteps = [...new Set(incompleteItems.flatMap((item) => item.postActions?.pending ?? []).map(postActionStepLabel))]

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
    } catch (caught) {
      setExportError(caught instanceof Error && caught.message === 'export_too_many'
        ? `回答が一度に書き出せる上限（${formatNumber(MAX_EXPORT_ROWS)}件）を超えています。`
        : 'CSVを書き出せませんでした。もう一度お試しください。')
    } finally {
      setExporting(false)
      setExportProgress('')
    }
  }

  const retryPostActions = async (item: Submission) => {
    if (!selectedAccountId || retrying) return
    setRetrying(true)
    setRetryError('')
    try {
      const result = await fetchApi<{ success: boolean; data?: { submission?: Submission; pendingEffects?: string[] }; error?: string }>(
        `/api/forms/${formId}/submissions/${item.id}/retry-effects?account_id=${encodeURIComponent(selectedAccountId)}`,
        { method: 'POST' },
      )
      if (!result.success || !result.data?.submission) throw new Error(result.error ?? 'retry_failed')
      const updated = normalizedSubmission(result.data.submission)
      setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      setSelectedId(updated.id)
    } catch (caught) {
      setRetryError(retryEffectsFailureText(caught))
    } finally {
      setRetrying(false)
    }
  }

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
  if (accountLoading || (loading && !form)) return <ListState kind="loading" title="集まった回答を読み込んでいます" />
  if (!selectedAccountId) return <ListState kind="empty" title="LINE公式アカウントを選んでください" />
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

  const rate = summary?.completionRate
  const pageCount = Math.max(1, Math.ceil((total ?? 0) / pageSize))
  const firstKey = fieldKeys[0]
  const headLine = [
    total === null ? '—' : `${formatNumber(total)}件`,
    rate != null ? `答え終えた割合 ${formatNumber(rate)}%` : null,
  ].filter(Boolean).join('・')
  const longKey = fieldKeys.find((key) => blockByKey(key)?.type === 'textarea'
    && items.some((item) => String((item.data as Record<string, unknown>)[key] ?? '').trim() !== ''))

  const rail = (
    <div className={styles.rail}>
      {view === 'rows' && selected ? (
        <section className={styles.railCard} aria-label={`回答の詳細：${selected.friendName ?? '不明'}`}>
          <h2 className={styles.railTitle}>{`回答の詳細：${selected.friendName ?? '不明'}`}</h2>
          <dl className={styles.detailList}>
            <div className={styles.detailRow}>
              <dt>答えた日時</dt>
              <dd>{shortWhen(selected.createdAt)}</dd>
            </div>
            {fieldKeys.map((key) => {
              const value = valueText((selected.data as Record<string, unknown>)[key])
              return (
                <div key={key} className={styles.detailRow}>
                  <dt title={labels[key] ?? key}>{labels[key] ?? key}</dt>
                  <dd title={value}>{blockByKey(key)?.type === 'rating' && value !== '—' ? `★${value}` : value}</dd>
                </div>
              )
            })}
          </dl>
          <p className={styles.railLabel}>後処理</p>
          {selected.postActions == null || selected.postActions.state === 'untracked' ? (
            <p className={styles.railNote}>この回答には後処理の記録がありません</p>
          ) : (
            <ul className={styles.detailList}>
              {selected.postActions.pending.length === 0 ? (
                <li className={styles.detailRow}><span>すべての工程</span><span className={styles.ok}>済み</span></li>
              ) : selected.postActions.pending.map((step, index) => (
                <li key={step} className={styles.detailRow}>
                  <span>{`${index + 1} ${postActionStepLabel(step)}`}</span>
                  <span className={styles.ng}>{selected.postActions?.state === 'in_progress' ? '処理中' : '未完'}</span>
                </li>
              ))}
            </ul>
          )}
          {retryError ? <p className={styles.error}>{retryError}</p> : null}
          <div className={styles.railButtons}>
            {incompleteOf(selected) === true ? (
              <Button variant="primary" onClick={() => void retryPostActions(selected)} disabled={retrying} busy={retrying} busyLabel="再実行しています">
                <RotateCw size={15} aria-hidden="true" />後処理をやり直す
              </Button>
            ) : null}
            {selected.friendId ? (
              <Button href={`/chats?friend=${encodeURIComponent(selected.friendId)}`}><User size={15} aria-hidden="true" />友だちを開く</Button>
            ) : null}
          </div>
        </section>
      ) : null}
      <div className={styles.railButtonsWide}>
        <Button href={`/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic`}><Pencil size={15} aria-hidden="true" />フォームを編集</Button>
        <Button onClick={() => void exportAll()} disabled={exporting || total === 0} busy={exporting} busyLabel={exportProgress || 'CSVを準備しています'}>
          <Download size={15} aria-hidden="true" />CSVで書き出す
        </Button>
      </div>
      {exportError ? <p className={styles.error}>{exportError}</p> : null}
      {exporting && exportProgress ? <p className={styles.railNote} role="status">{exportProgress}</p> : null}
      <section className={styles.railCard} aria-labelledby="fr-filter">
        <h2 className={styles.railTitle} id="fr-filter">絞り込み</h2>
        <p className={styles.railNote}>{total === null ? '—' : `全 ${formatNumber(total)}件から、名前と答えで探します`}</p>
        <label className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="名前・答えで探す（全件から）"
            aria-label="名前・答えで探す（全件から）"
          />
        </label>
      </section>
    </div>
  )

  return (
    <DetailPage
      boardId={view === 'summary' ? 'v0SbYR' : 'MKQyJ'}
      identity={<Link href="/form-submissions" className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" />回答フォームへ</Link>}
      title={`集まった回答：${form.name}`}
      description={headLine}
      tabs={(
        <Tabs
          className={styles.tabsPlain}
          label="回答の見方"
          items={[
            { label: 'まとめて見る', current: view === 'summary', onClick: () => setView('summary') },
            { label: '1件ずつ見る', current: view === 'rows', onClick: () => setView('rows') },
          ]}
        />
      )}
    >
      <div className={styles.layout}>
        <div className={styles.main}>
          {total === 0 && !query.trim() ? (
            <ListState kind="empty" title="まだ回答がありません" description="フォームが回答されると、ここに1件ずつ並びます。" />
          ) : view === 'summary' ? (
            <>
              {incompleteItems.length > 0 ? (
                <div className={styles.alert} role="status">
                  <AlertCircle size={18} aria-hidden="true" className={styles.alertIcon} />
                  <div className={styles.alertText}>
                    <p className={styles.alertTitle}>{`後処理が終わっていない回答が ${incompleteItems.length}件あります`}</p>
                    <p className={styles.alertNote}>{`答えは保存されています。${failedSteps.join('・') || '後処理'}が終わっていません${(total ?? 0) > items.length ? '（表示中のページから数えています）' : ''}。`}</p>
                  </div>
                  <Button onClick={() => { setSelectedId(incompleteItems[0]?.id ?? null); setView('rows') }}>{`その${incompleteItems.length}件を見る`}</Button>
                </div>
              ) : null}
              {summaries.map((fieldSummary) => {
                const block = blockByKey(fieldSummary.key)
                if (block?.type === 'textarea') return null
                const answered = fieldSummary.values.reduce((acc, [, count]) => acc + count, 0)
                const kind = block ? typeLabel(block.type) : null
                const rating = block?.type === 'rating' ? summary?.ratingFields?.find((field) => field.key === fieldSummary.key) : undefined
                const sub = rating
                  ? `5段階・平均 ${ratingAverageText(rating.average)}`
                  : `${kind ? `${kind}・` : ''}${answered === 0 ? 'まだ答えがありません' : `${formatNumber(answered)}件が答えた`}`
                /* 5段階は ★5・★4・★3以下 の3段にまとめる（絵 v0SbYR）。 */
                const values: Array<[string, number]> = block?.type === 'rating'
                  ? [
                      ['5', fieldSummary.values.filter(([value]) => Number(value) >= 5).reduce((acc, [, count]) => acc + count, 0)],
                      ['4', fieldSummary.values.filter(([value]) => Number(value) === 4).reduce((acc, [, count]) => acc + count, 0)],
                      ['3以下', fieldSummary.values.filter(([value]) => Number(value) <= 3).reduce((acc, [, count]) => acc + count, 0)],
                    ]
                  : fieldSummary.values
                const top = values.slice(0, 6)
                const max = Math.max(0, ...top.map(([, count]) => count))
                return (
                  <section key={fieldSummary.key} className={styles.card} aria-label={labels[fieldSummary.key] ?? fieldSummary.key}>
                    <div className={styles.cardHead}>
                      <h2 className={styles.cardTitle}>{labels[fieldSummary.key] ?? fieldSummary.key}</h2>
                      <p className={styles.cardNote}>{sub}</p>
                    </div>
                    {answered > 0 ? (
                      <dl className={styles.bars}>
                        {top.map(([value, count]) => (
                          <div key={value} className={styles.barRow}>
                            <dt title={value}>{block?.type === 'rating' ? `★${value}` : value}</dt>
                            <dd className={styles.barTrack} aria-hidden="true">
                              <meter className={styles.meter} min={0} max={Math.max(1, max)} value={count} />
                            </dd>
                            <dd className={styles.barCount}>{`${formatNumber(count)}件（${formatNumber(Math.round((count / answered) * 100))}%）`}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </section>
                )
              })}
              {longKey ? (() => {
                const recents = items.filter((item) => String((item.data as Record<string, unknown>)[longKey] ?? '').trim() !== '')
                return (
                  <section className={`${styles.card} ${styles.quoteCard}`} aria-label={labels[longKey] ?? longKey}>
                    <div className={styles.cardHead}>
                      <h2 className={styles.cardTitle}>{labels[longKey] ?? longKey}</h2>
                      <p className={styles.cardNote}>{`複数行・${formatNumber(recents.length)}件`}</p>
                    </div>
                    <ul className={styles.quotes}>
                      {recents.slice(0, 2).map((item) => {
                        const text = String((item.data as Record<string, unknown>)[longKey])
                        return (
                          <li key={item.id} className={styles.quoteRow}>
                            <span className={styles.quoteText} title={text}>{`「${text}」`}</span>
                            <span className={styles.quoteWho}>{`${shortDay(item.createdAt)} ${item.friendName ?? '不明'}`}</span>
                          </li>
                        )
                      })}
                    </ul>
                    <div className={styles.cardFoot}>
                      <Button variant="text" onClick={() => setView('rows')}><ArrowRight size={14} aria-hidden="true" />1件ずつ見る</Button>
                    </div>
                  </section>
                )
              })() : null}
            </>
          ) : items.length === 0 ? (
            <div className={styles.card}>
              <p className={styles.cardTitle}>条件に合う回答はありません</p>
              <p className={styles.cardNote}>検索語を変えてください。</p>
              <div><Button onClick={() => setQuery('')}>× 条件を外す</Button></div>
            </div>
          ) : (
            <section className={styles.card} aria-labelledby="fr-rows">
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle} id="fr-rows">回答</h2>
                <p className={styles.cardNote}>{total === null ? '—' : `全 ${formatNumber(total)}件`}</p>
              </div>
              <table className={styles.table}>
                <thead>
                  <TableHeadRow>
                    <Th className={styles.colWhen}>答えた日時</Th>
                    <Th className={styles.colWho}>答えた人</Th>
                    <Th>{firstKey ? (labels[firstKey] ?? firstKey) : '回答'}</Th>
                    <Th className={styles.colState}>後処理</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const incomplete = incompleteOf(item)
                    const first = firstKey ? valueText((item.data as Record<string, unknown>)[firstKey]) : '—'
                    const isSelected = selected?.id === item.id
                    return (
                      <tr
                        key={item.id}
                        className={isSelected ? styles.rowSelected : undefined}
                        aria-selected={isSelected}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <td className={styles.when}>{shortWhen(item.createdAt)}</td>
                        <td>
                          <button type="button" className={styles.who} title={item.friendName ?? '不明'} onClick={() => setSelectedId(item.id)}>
                            {item.friendName ?? '不明'}
                          </button>
                        </td>
                        <td className={styles.ellipsis} title={first}>{first}</td>
                        <td>
                          {incomplete === null ? <span className={styles.faint}>—</span>
                            : incomplete ? <span className={`${styles.chip} ${styles.chipNg}`}>未完</span>
                              : <span className={`${styles.chip} ${styles.chipOk}`}>済み</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className={styles.pager}>
                <span className={styles.range}>
                  {total === null ? '—' : <ListRange total={total} first={total === 0 ? 0 : (page - 1) * pageSize + 1} last={Math.min(page * pageSize, total)} />}
                </span>
                <Pagination page={page} pageCount={pageCount} disabled={loading} ariaLabel="回答一覧のページ送り" onPageChange={(next) => void load(next, pageSize)} />
              </div>
            </section>
          )}
        </div>
        {rail}
      </div>
    </DetailPage>
  )
}
