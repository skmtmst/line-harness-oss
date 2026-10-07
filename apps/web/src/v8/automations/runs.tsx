'use client'

/*
 * ★V8 オートメーションの動いた記録（Pencil `g98F9`）。
 *
 * 2026-10-06 オーナー決定で src/v8 に一から書いた。データの口・動きは今までの V8
 * （app/automations/runs-v8.tsx）と同じ（一覧・検索・結果の絞り込み・テスト実行の出し分け・CSV・
 * 中身・もう一度やる・取りやめ・?run= の直リンク）。違いは見せ方だけ——
 * 型（ListPage）に、タブ・数の帯・案内の帯・道具の段・表（絵の列の並び）を渡す。
 * 中身は右の詳細パネルで開く。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Activity, Bookmark, Download, Filter, Layers, TriangleAlert } from 'lucide-react'
import { api, ApiError, downloadApiFile, fetchApi, type AutomationRunDetail } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { formatNumber } from '@/lib/format'
import { ListPage } from '@/components/templates'
import ListToolbar from '@/components/shared/list-toolbar'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import FilterChip from '@/components/shared/filter-chip'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import DetailPanel from '@/components/shared/detail-panel'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import {
  AUTOMATIONS_DESCRIPTION,
  AutomationBand,
  AutomationTabs,
  useAutomationRunManage,
  useAutomationTabCounts,
  type BandCell,
} from './shell'
import styles from './runs.module.css'

type RunStatus = AutomationRunDetail['status']
type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

/** 一覧の1行（口が返す形のうち、この画面で使うもの）。 */
export type AutomationRunRow = {
  id: string
  automationId: string
  occurredAt: string
  subject: string | null
  accountLabel: string | null
  triggerLabel: string
  status: RunStatus
  detail: string | null
  durationMs: number | null
  automationName: string
  canRetry: boolean
  versionNumber: number
  isTest: boolean
  canCancel: boolean
  friendId: string | null
  successfulActions?: string[]
  failureReason?: string | null
}

type RunsResponse = {
  summary: {
    total: number
    executed: number
    skipped: number
    failed: number
    mostRunName: string | null
    mostRunCount: number | null
  }
  items: AutomationRunRow[]
  pagination: { total: number; limit: number; offset: number }
}

type ResultFilter = 'all' | 'executed' | 'skipped' | 'problems'
type SavedKey = '' | 'include-test'

const STATUS_LABEL: Record<RunStatus, string> = {
  queued: '待っています',
  claimed: '動いています',
  succeeded: '動いた',
  skipped: '条件に外れた',
  waiting: '待機しています',
  retry_wait: '再試行を待っています',
  partial: '失敗',
  permanent_failed: '失敗',
  cancelled: '取り消しました',
}

const STEP_STATUS_LABEL: Record<AutomationRunDetail['steps'][number]['status'], string> = {
  queued: '待機中',
  running: '実行中',
  waiting: '再試行待ち',
  success: '成功',
  failed: '失敗',
  skipped: '見送り',
  cancelled: '取りやめ',
}

function statusTone(status: RunStatus): 'active' | 'danger' | 'warn' | 'neutral' {
  if (status === 'succeeded') return 'active'
  if (status === 'permanent_failed' || status === 'partial') return 'danger'
  if (status === 'retry_wait' || status === 'queued' || status === 'claimed' || status === 'waiting') return 'warn'
  return 'neutral'
}

/** 「9/30 14:12」（日本時間）。 */
export function shortDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日時不明'
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}

/** かかった時間（「0.8 秒」）。測れていないものは「—」。 */
export function durationText(value: number | null): string {
  if (value === null) return '—'
  return `${(value / 1000).toFixed(1)} 秒`
}

/** 結果の2行目：失敗の理由、条件に外れたときの理由。 */
function resultReason(run: AutomationRunRow): string | null {
  if (run.status === 'permanent_failed' || run.status === 'partial') return run.failureReason ?? run.detail
  if (run.status === 'skipped') return run.detail
  return null
}

function runsSearchUrl(pathname: string, currentParams: string, value: string): string {
  const next = new URLSearchParams(currentParams)
  if (value) next.set('search', value)
  else next.delete('search')
  const suffix = next.toString()
  return suffix ? `${pathname}?${suffix}` : pathname
}

function TableHead() {
  return (
    <thead>
      <TableHeadRow className={styles.headRow} data-table-layout="columns">
        <Th className={styles.colWhen}>いつ・だれに</Th>
        <Th className={styles.colRule}>オートメーション</Th>
        <Th className={styles.colResult}>結果</Th>
        <Th className={styles.colDone}>したこと</Th>
        <Th className={styles.colTime} align="right">かかった時間</Th>
        <Th className={styles.colOps}>操作</Th>
      </TableHeadRow>
    </thead>
  )
}

export default function AutomationRunsV8() {
  usePageTitle('オートメーション')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchFromUrl = searchParams.get('search') ?? ''
  const tabCounts = useAutomationTabCounts()
  const permissions = useAutomationRunManage()
  // 役割が読めるまでは今までどおり出す（最後の守りはサーバの 403）。
  const canOperate = permissions === null || permissions.canOperate
  const canExport = permissions === null || permissions.canExport

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [data, setData] = useState<RunsResponse | null>(null)
  const [query, setQuery] = useState(searchFromUrl)
  const [resultFilter, setResultFilter] = useState<ResultFilter>(() => {
    const raw = searchParams.get('status')
    return raw === 'executed' || raw === 'skipped' || raw === 'problems' ? raw : 'all'
  })
  const [saved, setSaved] = useState<SavedKey>('')
  const includeTest = saved === 'include-test'
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<AutomationRunRow | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<AutomationRunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<null | 'error' | 'forbidden'>(null)
  const [detailReloadKey, setDetailReloadKey] = useState(0)
  const [deepLinkRunId, setDeepLinkRunId] = useState<string | null>(null)
  const [deepLinkLoading, setDeepLinkLoading] = useState(false)
  const [deepLinkError, setDeepLinkError] = useState<null | 'error' | 'forbidden'>(null)
  const [deepLinkReloadKey, setDeepLinkReloadKey] = useState(0)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [csvBusy, setCsvBusy] = useState(false)

  const loadGeneration = useRef(0)
  const selectedAccountRef = useRef(selectedAccountId)
  selectedAccountRef.current = selectedAccountId
  const detailGeneration = useRef(0)

  useEffect(() => { setQuery(searchFromUrl) }, [searchFromUrl])

  const changeQuery = (value: string) => {
    setQuery(value)
    setPage(1)
    router.replace(runsSearchUrl(pathname, searchParams.toString(), value), { scroll: false })
  }
  const toggleResult = (value: Exclude<ResultFilter, 'all'>, next: boolean) => {
    setResultFilter(next ? value : 'all')
    setPage(1)
  }

  useEffect(() => { setPage(1) }, [selectedAccountId, pageSize, saved])

  useEffect(() => {
    loadGeneration.current += 1
    detailGeneration.current += 1
    setSelectedRun(null)
    setSelectedDetail(null)
    setDetailError(null)
    setDeepLinkRunId(null)
    setDeepLinkError(null)
    setDeepLinkLoading(false)
    setConfirmCancel(false)
    setNotice('')
  }, [selectedAccountId])

  const load = useCallback(async () => {
    if (accountLoading) return
    const generation = loadGeneration.current + 1
    loadGeneration.current = generation
    setStatus('loading')
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) })
      if (selectedAccountId) params.set('lineAccountId', selectedAccountId)
      if (query.trim()) params.set('search', query.trim())
      if (resultFilter !== 'all') params.set('status', resultFilter)
      if (includeTest) params.set('include_test', '1')
      const response = await fetchApi<ApiResponse<RunsResponse>>(`/api/automation-runs?${params}`)
      if (generation !== loadGeneration.current) return
      if (!response.success) throw new Error(response.error)
      if (!response.data || !response.data.summary || !Array.isArray(response.data.items) || !response.data.pagination) {
        throw new Error('実行記録の応答形式が正しくありません')
      }
      setData(response.data)
      setStatus('ready')
    } catch {
      if (generation !== loadGeneration.current) return
      setData(null)
      setStatus('error')
    }
  }, [accountLoading, page, pageSize, query, resultFilter, selectedAccountId, includeTest])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 400)
    return () => window.clearTimeout(timer)
  }, [load])

  /* 中身（処理ごとの結果）は開いたときに読む。 */
  useEffect(() => {
    if (!selectedRun) {
      setSelectedDetail(null)
      setDetailError(null)
      setConfirmCancel(false)
      return
    }
    const accountAtStart = selectedAccountId
    const generationAtStart = detailGeneration.current
    const stale = () => generationAtStart !== detailGeneration.current || selectedAccountRef.current !== accountAtStart
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    api.automations.getRun(selectedRun.id)
      .then((response) => {
        if (cancelled || stale()) return
        if (response.success) setSelectedDetail(response.data)
        else { setSelectedDetail(null); setDetailError('error') }
      })
      .catch((caught: unknown) => {
        if (cancelled || stale()) return
        setSelectedDetail(null)
        setDetailError(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
      })
      .finally(() => { if (!cancelled && !stale()) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [selectedRun, selectedAccountId, detailReloadKey])

  const cancelRun = async (run: AutomationRunRow) => {
    if (!run.canCancel || cancellingId) return
    const accountAtStart = selectedAccountId
    setCancellingId(run.id)
    setNotice('')
    try {
      const response = await api.automations.cancelRun(run.id)
      if (!response.success) throw new Error(response.error)
      if (selectedAccountRef.current !== accountAtStart) return
      setNotice('実行を取りやめました。記録は残っています。')
      setSelectedRun(null)
      setConfirmCancel(false)
      await load()
    } catch (caught) {
      if (selectedAccountRef.current !== accountAtStart) return
      setNotice(caught instanceof Error ? caught.message : '実行を取りやめられませんでした')
    } finally {
      setCancellingId(null)
    }
  }

  /* もう一度やる：失敗した処理だけ。失敗したら記録を読み直して、受け付け済みかを確かめる。 */
  const retryRun = async (run: AutomationRunRow) => {
    if (!run.canRetry || retryingId) return
    const accountAtStart = selectedAccountId
    setRetryingId(run.id)
    setNotice('')
    try {
      const response = await fetchApi<ApiResponse<{ status: string }>>(
        `/api/automation-runs/${encodeURIComponent(run.id)}/retry`,
        { method: 'POST' },
      )
      if (!response.success) throw new Error(response.error)
      if (selectedAccountRef.current !== accountAtStart) return
      setNotice('再実行を受け付けました。結果は実行記録で確認してください')
      setSelectedRun(null)
      await load()
    } catch (caught) {
      if (selectedAccountRef.current !== accountAtStart) return
      const failureMessage = caught instanceof Error ? caught.message : '再実行できませんでした'
      await load()
      try {
        const detail = await api.automations.getRun(run.id)
        if (!detail.success || selectedAccountRef.current !== accountAtStart) {
          setNotice(failureMessage)
          return
        }
        setSelectedDetail(detail.data)
        setSelectedRun((current) => current && current.id === run.id
          ? { ...current, status: detail.data.status, canRetry: detail.data.canRetry, canCancel: detail.data.canCancel }
          : current)
        const accepted = !detail.data.canRetry
          && (detail.data.status === 'queued' || detail.data.status === 'claimed'
            || detail.data.status === 'waiting' || detail.data.status === 'retry_wait')
        setNotice(accepted ? '再試行を受け付けています。結果はこの記録で確認できます。' : failureMessage)
      } catch {
        setNotice(failureMessage)
      }
    } finally {
      setRetryingId(null)
    }
  }

  const downloadRunsCsv = () => {
    if (csvBusy) return
    setCsvBusy(true)
    setNotice('')
    void downloadApiFile(api.automations.runsCsvUrl({
      accountId: selectedAccountId || undefined,
      search: query.trim() || undefined,
      status: resultFilter !== 'all' ? resultFilter : undefined,
      includeTest,
    }), 'automation-runs.csv')
      .then((result) => {
        if (result.truncated && result.totalCount !== null) {
          const rest = result.totalCount - (result.returnedCount ?? 0)
          setNotice(`5,000件までしか出ませんでした（対象${formatNumber(result.totalCount)}件・残り${formatNumber(rest)}件）。期間や絞り込みで分けて出してください。`)
        }
      })
      .catch(() => setNotice('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。'))
      .finally(() => setCsvBusy(false))
  }

  /* ?run=<id> の直リンク：その記録の中身を開く。 */
  useEffect(() => {
    const runId = new URLSearchParams(window.location.search).get('run')
    if (!runId) return
    setDeepLinkRunId(runId)
    const accountAtStart = selectedAccountRef.current
    let cancelled = false
    setDeepLinkLoading(true)
    setDeepLinkError(null)
    api.automations.getRun(runId)
      .then((response) => {
        if (cancelled || selectedAccountRef.current !== accountAtStart) return
        if (!response.success) { setDeepLinkError('error'); return }
        const detail = response.data
        setSelectedRun({
          id: detail.id,
          automationId: detail.automationId,
          occurredAt: detail.occurredAt,
          subject: detail.friendName,
          accountLabel: detail.accountLabel,
          triggerLabel: detail.triggerLabel,
          status: detail.status,
          detail: detail.detail,
          durationMs: detail.durationMs,
          automationName: detail.automationName,
          canRetry: detail.canRetry,
          versionNumber: detail.versionNumber,
          isTest: detail.isTest,
          canCancel: detail.canCancel,
          friendId: detail.friendId,
          successfulActions: detail.successfulActions,
          failureReason: detail.failureReason,
        })
        setSelectedDetail(detail)
        setDeepLinkError(null)
      })
      .catch((caught: unknown) => {
        if (cancelled || selectedAccountRef.current !== accountAtStart) return
        setDeepLinkError(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
      })
      .finally(() => { if (!cancelled && selectedAccountRef.current === accountAtStart) setDeepLinkLoading(false) })
    return () => { cancelled = true }
  }, [deepLinkReloadKey])

  /* 行の「…」：中身を見る・もう一度やる（やり直せる失敗のとき）・ルールを開く・トークを開く。 */
  const rowMenuItems = (run: AutomationRunRow): ActionMenuItem[] => [
    { id: 'open', label: '中身を見る', onSelect: () => setSelectedRun(run) },
    ...(canOperate && run.canRetry
      ? [{ id: 'retry', label: 'もう一度やる', disabled: retryingId !== null, onSelect: () => void retryRun(run) }]
      : []),
    { id: 'rule', label: 'ルールを開く', onSelect: () => router.push(`/automations?search=${encodeURIComponent(run.automationName)}`) },
    ...(run.friendId
      ? [{ id: 'chat', label: 'トークを開く', onSelect: () => router.push(`/chats?friend=${encodeURIComponent(run.friendId as string)}`) }]
      : []),
  ]

  /* ===== 数の帯 ===== */
  const summary = data?.summary ?? null
  const cells: BandCell[] = [
    { key: 'executed', title: 'この30日に動いた', icon: <Activity size={13} aria-hidden="true" />, value: summary?.executed ?? null, unit: '回', detail: summary?.mostRunName ? `いちばん動いた：${summary.mostRunName}` : '実行結果を集計' },
    { key: 'skipped', title: '条件に外れた', icon: <Filter size={13} aria-hidden="true" />, value: summary?.skipped ?? null, unit: '回', detail: '条件が厳しすぎないか見てください' },
    { key: 'failed', title: '失敗', icon: <TriangleAlert size={13} aria-hidden="true" />, value: summary?.failed ?? null, unit: '件', detail: '「中身を見る」から理由を確かめられます' },
    { key: 'total', title: 'すべて', icon: <Layers size={13} aria-hidden="true" />, value: summary?.total ?? null, unit: '回', detail: 'この30日' },
  ]

  /* ===== 道具の段 ===== */
  const chipCount = (value: number | undefined) => (value === undefined ? '—' : formatNumber(value))
  const filterChips = (
    <div role="group" aria-label="結果で絞り込む" className={styles.chipGroup}>
      <FilterChip selected={resultFilter === 'executed'} onChange={(next) => toggleResult('executed', next)} icon={<Activity size={13} aria-hidden="true" />}>{`動いた ${chipCount(summary?.executed)}`}</FilterChip>
      <FilterChip selected={resultFilter === 'skipped'} onChange={(next) => toggleResult('skipped', next)} icon={<Filter size={13} aria-hidden="true" />}>{`条件に外れた ${chipCount(summary?.skipped)}`}</FilterChip>
      <FilterChip selected={resultFilter === 'problems'} onChange={(next) => toggleResult('problems', next)} icon={<TriangleAlert size={13} aria-hidden="true" />}>{`失敗 ${chipCount(summary?.failed)}`}</FilterChip>
    </div>
  )
  const savedBox = (
    <div className={styles.savedBox}>
      <Bookmark size={15} aria-hidden="true" className={styles.savedIcon} />
      <Select
        aria-label="よく使う絞り込み"
        value={saved}
        onChange={(value) => setSaved(value as SavedKey)}
        options={[
          { value: '', label: 'よく使う絞り込み' },
          { value: 'include-test', label: 'テスト実行も見る' },
        ]}
      />
    </div>
  )
  const toolbar = (
    <>
      <div className={styles.noticeRow}>
        <Notice tone="info">「もう一度やる」は、やり直せる失敗（一時的な送信の失敗など）だけに出ます。ブロック中など原因を直す必要があるものには出ません。条件に外れたものは、ルールの「だれに」に当てはまらなかった人です。</Notice>
      </div>
      {notice ? <div className={styles.noticeRow}><Notice tone="info" role="status">{notice}</Notice></div> : null}
      <ListToolbar
        search={{ placeholder: '友だち・ルールの名前で探す', label: '友だちの名前・オートメーションの名前で検索', width: 240, value: query, onChange: changeQuery }}
        filters={filterChips}
        trailing={<>{savedBox}<PageSizeSelect value={pageSize} onChange={setPageSize} options={[10, 20, 50]} label={null} /></>}
      />
    </>
  )

  /* ===== 表 ===== */
  let listBody: ReactNode
  if (accountLoading || status === 'loading') {
    listBody = <ListState kind="loading" title="動いた記録を読み込んでいます" />
  } else if (status === 'error') {
    listBody = (
      <ListState
        kind="error"
        title="動いた記録を読み込めませんでした"
        description="記録は消えていません。通信を確かめて、もう一度お試しください。"
        action={<Button variant="secondary" onClick={() => void load()}>もう一度試す</Button>}
      />
    )
  } else if (!data || data.items.length === 0) {
    listBody = (
      <ListState
        kind="empty"
        title={query || resultFilter !== 'all' ? '条件に合う記録はありません' : '動いた記録はまだありません'}
        description={query || resultFilter !== 'all' ? '検索や絞り込みの札を外すと、すべて出ます。' : 'オートメーションが動くと、結果がここに残ります。'}
      />
    )
  } else {
    listBody = (
      <>
        <div className={styles.tableWrap}>
          <DataTable className={styles.table}>
            <TableHead />
            <tbody>
              {data.items.map((run) => {
                const done = run.successfulActions ?? []
                const reason = resultReason(run)
                const whenLine = [shortDateTime(run.occurredAt), run.accountLabel].filter(Boolean).join('・')
                const versionLine = `v${run.versionNumber}${run.isTest ? '・テスト' : ''}`
                const menuLabel = `記録「${run.subject ?? '友だち名なし'}・${run.automationName}」の操作`
                return (
                  <Tr key={run.id} className={styles.row} data-table-layout="columns" data-row-id={run.id}>
                    <Td className={styles.colWhen}>
                      <button type="button" className={styles.subject} onClick={() => setSelectedRun(run)}>
                        {run.subject ?? '友だち名なし'}
                      </button>
                      <span className={styles.sub}>{whenLine}</span>
                    </Td>
                    <Td className={styles.colRule}>
                      <span className={styles.main} title={run.automationName}>{run.automationName}</span>
                      <span className={styles.sub}>{versionLine}</span>
                    </Td>
                    <Td className={styles.colResult}>
                      <span className={styles.pill} data-tone={statusTone(run.status)}>
                        <span className={styles.pillDot} aria-hidden="true" />
                        {STATUS_LABEL[run.status]}
                      </span>
                      {reason ? <span className={styles.sub} title={reason}>{reason}</span> : null}
                    </Td>
                    <Td className={styles.colDone}>
                      <span className={styles.main} title={done.join('・') || run.detail || ''}>{done.length > 0 ? done.join('・') : '—'}</span>
                      {done.length > 0 ? <span className={styles.sub}>{`${done.length} つ`}</span> : null}
                    </Td>
                    <Td className={styles.colTime}><span className={styles.main}>{durationText(run.durationMs)}</span></Td>
                    <Td className={styles.colOps}>
                      <div className={styles.opsBox}>
                        <Button onClick={() => setSelectedRun(run)}>中身を見る</Button>
                        <RowMenu
                          label={menuLabel}
                          open={openMenuId === run.id}
                          onOpenChange={(next) => setOpenMenuId(next ? run.id : null)}
                          items={rowMenuItems(run).map((item) => ({ ...item, onSelect: () => { setOpenMenuId(null); item.onSelect() } }))}
                        />
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        </div>
      </>
    )
  }

  const total = data?.pagination.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const pager = status === 'ready' && data && data.items.length > 0 ? (
    <>
      <div className={styles.pagerRow}>
        <span className={styles.pagerCount}>
          {`${formatNumber(total)}件中 ${data.pagination.offset + 1}〜${data.pagination.offset + data.items.length}件`}
        </span>
        {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} onPageChange={setPage} ariaLabel="動いた記録のページ送り" /> : null}
      </div>
      <p className={styles.footNote}>行の「…」から 中身を見る・もう一度やる（失敗のとき）・ルールを開く・トークを開く。</p>
    </>
  ) : null

  const run = selectedRun
  const runDetail = selectedDetail
  const deepLinkMessage = !run && deepLinkRunId
    ? deepLinkLoading ? '読み込んでいます'
      : deepLinkError === 'forbidden' ? 'この実行を見る権限がありません。'
        : deepLinkError === 'error' ? '詳細を読み込めませんでした。記録は消えていません。' : null
    : null

  return (
    <ListPage
      boardId="g98F9"
      headingSize="regular"
      title="オートメーション"
      description={AUTOMATIONS_DESCRIPTION}
      actions={canExport
        ? <Button onClick={downloadRunsCsv} disabled={csvBusy} busy={csvBusy} busyLabel="書き出しています…" title="いまの検索・絞り込みの行が出ます（5,000件まで）"><Download size={15} aria-hidden="true" />CSV で書き出す</Button>
        : undefined}
      tabs={<AutomationTabs active="runs" counts={tabCounts} />}
      stats={<AutomationBand label="動いた記録の数の帯" cells={cells} />}
      toolbar={toolbar}
      pagination={pager}
      overlays={<>
        {deepLinkMessage ? (
          <DetailPanel open title="実行記録の中身" onClose={() => setDeepLinkRunId(null)}>
            <p className={styles.panelText}>{deepLinkMessage}</p>
            {deepLinkError === 'error' ? <Button onClick={() => setDeepLinkReloadKey((key) => key + 1)}>もう一度読む</Button> : null}
          </DetailPanel>
        ) : null}
        <DetailPanel
          open={run !== null}
          title={run ? run.automationName : ''}
          description={run ? `${shortDateTime(run.occurredAt)}・${run.subject ?? '友だち名なし'}` : undefined}
          onClose={() => setSelectedRun(null)}
          footer={run ? (
            <div className={styles.panelActions}>
              {run.canRetry && canOperate ? (
                <Button onClick={() => void retryRun(run)} disabled={retryingId !== null} busy={retryingId === run.id} busyLabel="実行中">失敗した処理をもう一度やる</Button>
              ) : null}
              {run.canCancel && canOperate ? (
                confirmCancel ? (
                  <>
                    <Button onClick={() => void cancelRun(run)} disabled={cancellingId !== null} busy={cancellingId === run.id} busyLabel="取りやめ中">取りやめる</Button>
                    <Button variant="secondary" onClick={() => setConfirmCancel(false)} disabled={cancellingId !== null}>キャンセル</Button>
                  </>
                ) : (
                  <Button variant="secondary" onClick={() => setConfirmCancel(true)} disabled={cancellingId !== null}>この実行を取りやめる</Button>
                )
              ) : null}
            </div>
          ) : undefined}
        >
          {run ? (
            <div className={styles.panel}>
              <p className={styles.panelText}>
                {`版 v${(runDetail ?? run).versionNumber}`}
                {(runDetail ?? run).isTest ? '・テスト実行' : ''}
                {runDetail ? (runDetail.isCurrentVersion ? '・いまの公開版です' : runDetail.currentVersionNumber !== null ? `・いまの公開版は v${runDetail.currentVersionNumber} です` : '') : ''}
              </p>
              <dl className={styles.panelGrid}>
                <dt>きっかけ</dt><dd>{run.triggerLabel}</dd>
                <dt>結果</dt><dd>{STATUS_LABEL[run.status]}</dd>
                <dt>したこと・失敗理由</dt><dd>{run.detail ?? '何もしていません'}</dd>
                <dt>かかった時間</dt><dd>{durationText(run.durationMs)}</dd>
                {runDetail?.holdReason ? <><dt>止まっている理由</dt><dd>{runDetail.holdReason}</dd></> : null}
              </dl>
              <p className={styles.panelLabel}>処理ごとの結果</p>
              {detailLoading ? (
                <p className={styles.panelText}>読み込んでいます</p>
              ) : detailError === 'forbidden' ? (
                <p className={styles.panelText}>この実行を見る権限がありません。</p>
              ) : detailError === 'error' ? (
                <div className={styles.panelActions}>
                  <p className={styles.panelText}>詳細を読み込めませんでした。記録は消えていません。</p>
                  <Button onClick={() => setDetailReloadKey((key) => key + 1)}>もう一度読む</Button>
                </div>
              ) : runDetail && runDetail.steps.length > 0 ? (
                <ul className={styles.steps}>
                  {runDetail.steps.map((step) => (
                    <li key={step.stepKey} className={styles.step}>
                      <span>{step.actionLabel}{step.commonActionVersionId ? '（共通アクション）' : ''}</span>
                      <span className={styles.stepMeta}>{`${step.attemptNumber}回目・${STEP_STATUS_LABEL[step.status]}`}</span>
                      {step.errorMessage ? <span className={styles.stepError}>{step.errorMessage}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.panelText}>処理の記録はありません</p>
              )}
              <p className={styles.panelText}>
                {run.canRetry
                  ? '失敗した処理だけを、成功済みの処理と重ならないようにもう一度実行できます。'
                  : run.canCancel
                    ? 'まだ終わっていない実行です。取りやめるとこれ以降の処理は動きませんが、記録は残ります。'
                    : '安全な再実行の対象ではありません。成功済みの処理を二重に動かさないため、この記録からは再実行できません。'}
              </p>
              {confirmCancel ? (
                <p className={styles.panelWarn}>{`「${run.accountLabel ?? '選択中のアカウント'}」の実行を取りやめますか？記録は残りますが、実行は戻せません。`}</p>
              ) : null}
            </div>
          ) : null}
        </DetailPanel>
      </>}
    >
      {listBody}
    </ListPage>
  )
}
