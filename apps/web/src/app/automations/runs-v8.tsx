'use client'

/*
 * ★V8-B 動いた記録（板 `g98F9`・状態 `S3pdQ`・1152 `En14p`）。
 *
 * v7（runs/page.tsx の器）とは別の器。データの口・動きは v7 と同じ
 * （一覧・検索・結果の絞り込み・テスト実行の出し分け・CSV・中身・
 * もう一度やる・取りやめ・直リンク）。
 * 変える操作は器の外（共通の部品・API）へ触らない。
 * v7 を直す必要が出たら runs/page.tsx 側も同じ判断を入れる。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { api, ApiError, downloadApiFile, fetchApi, type AutomationRunDetail } from '@/lib/api'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ListState from '@/components/shared/list-state'
import SegmentedControl from '@/components/shared/segmented'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import MetricValue from '@/components/ui/metric-value'
import { TextField } from '@/components/shared/text-field'
import { useAutomationRunPermissions } from '@/components/automations/use-can-manage'
import { formatDateTime, formatNumber } from '@/lib/format'
import type { AutoV8Counts, AutoV8Model } from './automations-v8'
import styles from './automations-v8.module.css'

type RunStatus = 'queued' | 'claimed' | 'succeeded' | 'skipped' | 'waiting' | 'retry_wait' | 'partial' | 'permanent_failed' | 'cancelled'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

type AutomationRun = {
  id: string
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
  items: AutomationRun[]
  pagination: { total: number; limit: number; offset: number }
}

/* 1ページに読む件数（R24）。v7 と同じ20件。 */
const RUNS_PAGE_SIZE = 20

const STATUS_LABEL: Record<RunStatus, string> = {
  queued: '待っています',
  claimed: '動いています',
  succeeded: '動きました',
  skipped: '動きませんでした',
  waiting: '待機しています',
  retry_wait: '再試行を待っています',
  partial: '一部だけできました',
  permanent_failed: '失敗しました',
  cancelled: '取り消しました',
}

function statusPill(status: RunStatus): string {
  if (status === 'succeeded') return `${styles.pill} ${styles.pillActive}`
  if (status === 'permanent_failed' || status === 'partial') return `${styles.pill} ${styles.pillDanger}`
  if (status === 'retry_wait' || status === 'queued' || status === 'claimed' || status === 'waiting') {
    return `${styles.pill} ${styles.pillWarn}`
  }
  return `${styles.pill} ${styles.pillStopped}`
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

function formatOccurredAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日時不明'
  return formatDateTime(date)
}

function formatDuration(value: number | null): string {
  if (value === null) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(1)}秒` : `${value}ミリ秒`
}

function runsSearchUrl(pathname: string, currentParams: string, value: string): string {
  const next = new URLSearchParams(currentParams)
  if (value) next.set('search', value)
  else next.delete('search')
  const suffix = next.toString()
  return suffix ? `${pathname}?${suffix}` : pathname
}

type ResultFilter = 'all' | 'executed' | 'skipped' | 'problems'

export function V8RunsTab({
  model,
  onCounts,
}: {
  model: AutoV8Model
  onCounts: (counts: AutoV8Counts) => void
}) {
  const { registerHeaderActions } = model
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchFromUrl = searchParams.get('search') ?? ''
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [data, setData] = useState<RunsResponse | null>(null)
  const [query, setQuery] = useState(searchFromUrl)
  const [resultFilter, setResultFilter] = useState<ResultFilter>(() => {
    const raw = searchParams.get('status')
    return raw === 'executed' || raw === 'skipped' || raw === 'problems' ? raw : 'all'
  })
  const [selectedRun, setSelectedRun] = useState<AutomationRun | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<AutomationRunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<null | 'error' | 'forbidden'>(null)
  const [detailReloadKey, setDetailReloadKey] = useState(0)
  const [deepLinkRunId, setDeepLinkRunId] = useState<string | null>(null)
  const [deepLinkLoading, setDeepLinkLoading] = useState(false)
  const [deepLinkError, setDeepLinkError] = useState<null | 'error' | 'forbidden'>(null)
  const [deepLinkReloadKey, setDeepLinkReloadKey] = useState(0)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryNotice, setRetryNotice] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [includeTest, setIncludeTest] = useState(false)
  const [csvBusy, setCsvBusy] = useState(false)
  const [page, setPage] = useState(1)
  const runPermissions = useAutomationRunPermissions()

  const loadGeneration = useRef(0)
  const selectedAccountRef = useRef(selectedAccountId)
  selectedAccountRef.current = selectedAccountId
  const detailGeneration = useRef(0)

  useEffect(() => {
    setQuery(searchFromUrl)
  }, [searchFromUrl])

  const changeQuery = (value: string) => {
    setQuery(value)
    setPage(1)
    router.replace(runsSearchUrl(pathname, searchParams.toString(), value), { scroll: false })
  }

  const changeResultFilter = (value: ResultFilter) => {
    setResultFilter(value)
    setPage(1)
  }

  const changeIncludeTest = (value: boolean) => {
    setIncludeTest(value)
    setPage(1)
  }

  useEffect(() => {
    setPage(1)
  }, [selectedAccountId])

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
    setRetryNotice('')
  }, [selectedAccountId])

  const load = useCallback(async () => {
    if (accountLoading) return
    const generation = loadGeneration.current + 1
    loadGeneration.current = generation
    setStatus('loading')
    try {
      const params = new URLSearchParams({ limit: String(RUNS_PAGE_SIZE), offset: String((page - 1) * RUNS_PAGE_SIZE) })
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
      onCounts({ runs: response.data.pagination.total })
    } catch {
      if (generation !== loadGeneration.current) return
      setData(null)
      setStatus('error')
      onCounts({ runs: null })
    }
  }, [accountLoading, page, query, resultFilter, selectedAccountId, includeTest, onCounts])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 400)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (!selectedRun) {
      setSelectedDetail(null)
      setDetailError(null)
      setConfirmCancel(false)
      return
    }
    const accountAtStart = selectedAccountId
    const generationAtStart = detailGeneration.current
    const runId = selectedRun.id
    const stale = () => generationAtStart !== detailGeneration.current
      || selectedAccountRef.current !== accountAtStart
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    api.automations.getRun(runId)
      .then((response) => {
        if (cancelled || stale()) return
        if (response.success) {
          setSelectedDetail(response.data)
        } else {
          setSelectedDetail(null)
          setDetailError('error')
        }
      })
      .catch((caught: unknown) => {
        if (cancelled || stale()) return
        setSelectedDetail(null)
        setDetailError(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
      })
      .finally(() => {
        if (!cancelled && !stale()) setDetailLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedRun, selectedAccountId, detailReloadKey])

  const cancelRun = async (run: AutomationRun) => {
    if (!run.canCancel || cancellingId) return
    const accountAtStart = selectedAccountId
    setCancellingId(run.id)
    setRetryNotice('')
    try {
      const response = await api.automations.cancelRun(run.id)
      if (!response.success) throw new Error(response.error)
      if (selectedAccountRef.current !== accountAtStart) return
      setRetryNotice('実行を取りやめました。記録は残っています。')
      setSelectedRun(null)
      setConfirmCancel(false)
      await load()
    } catch (caught) {
      if (selectedAccountRef.current !== accountAtStart) return
      setRetryNotice(caught instanceof Error ? caught.message : '実行を取りやめられませんでした')
    } finally {
      setCancellingId(null)
    }
  }

  const retryRun = async (run: AutomationRun) => {
    if (!run.canRetry || retryingId) return
    const accountAtStart = selectedAccountId
    setRetryingId(run.id)
    setRetryNotice('')
    try {
      const response = await fetchApi<ApiResponse<{ status: string }>>(
        `/api/automation-runs/${encodeURIComponent(run.id)}/retry`,
        { method: 'POST' },
      )
      if (!response.success) throw new Error(response.error)
      if (selectedAccountRef.current !== accountAtStart) return
      setRetryNotice('再実行を受け付けました。結果は実行記録で確認してください')
      setSelectedRun(null)
      await load()
    } catch (caught) {
      if (selectedAccountRef.current !== accountAtStart) return
      const failureMessage = caught instanceof Error ? caught.message : '再実行できませんでした'
      await load()
      try {
        const detail = await api.automations.getRun(run.id)
        if (!detail.success || selectedAccountRef.current !== accountAtStart) {
          setRetryNotice(failureMessage)
          return
        }
        setSelectedDetail(detail.data)
        setSelectedRun((current) => current && current.id === run.id
          ? {
            ...current,
            status: detail.data.status,
            canRetry: detail.data.canRetry,
            canCancel: detail.data.canCancel,
          }
          : current)
        const accepted = !detail.data.canRetry
          && (detail.data.status === 'queued' || detail.data.status === 'claimed'
            || detail.data.status === 'waiting' || detail.data.status === 'retry_wait')
        setRetryNotice(accepted
          ? '再試行を受け付けています。結果はこの記録で確認できます。'
          : failureMessage)
      } catch {
        setRetryNotice(failureMessage)
      }
    } finally {
      setRetryingId(null)
    }
  }

  const downloadRunsCsv = () => {
    if (csvBusy) return
    setCsvBusy(true)
    setRetryNotice('')
    void downloadApiFile(api.automations.runsCsvUrl({
      accountId: selectedAccountId || undefined,
      search: query.trim() || undefined,
      status: resultFilter !== 'all' ? resultFilter : undefined,
      includeTest,
    }), 'automation-runs.csv')
      .then((result) => {
        if (result.truncated && result.totalCount !== null) {
          const rest = result.totalCount - (result.returnedCount ?? 0)
          setRetryNotice(
            `5,000件までしか出ませんでした（対象${formatNumber(result.totalCount)}件・残り${formatNumber(rest)}件）。期間や絞り込みで分けて出してください。`,
          )
        }
      })
      .catch(() => setRetryNotice('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。'))
      .finally(() => setCsvBusy(false))
  }

  /* CSVは見出しの段へ。書き出せる権限がなければ出さない（v7 と同じ境目）。 */
  useEffect(() => {
    if (!runPermissions?.canExport) {
      registerHeaderActions(null)
      return
    }
    registerHeaderActions(
      <div className={styles.csvBox}>
        <Button disabled={csvBusy} onClick={downloadRunsCsv} busy={csvBusy} busyLabel="書き出しています…">CSVで書き出す</Button>
        <p className={styles.footnote}>いまの検索・絞り込みの行が出ます（5,000件まで）</p>
      </div>,
    )
    return () => registerHeaderActions(null)
  })

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
        if (!response.success) {
          setDeepLinkError('error')
          return
        }
        const detail = response.data
        setSelectedRun({
          id: detail.id,
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
        })
        setSelectedDetail(detail)
        setDeepLinkError(null)
      })
      .catch((caught: unknown) => {
        if (cancelled || selectedAccountRef.current !== accountAtStart) return
        setDeepLinkError(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
      })
      .finally(() => {
        if (!cancelled && selectedAccountRef.current === accountAtStart) setDeepLinkLoading(false)
      })
    return () => { cancelled = true }
  }, [deepLinkReloadKey])

  if (status === 'loading') {
    return <ListState kind="loading" title="動いた記録を読み込んでいます" />
  }

  if (status === 'error') {
    return (
      <ListState
        kind="error"
        title="動いた記録を読み込めませんでした"
        description="記録は消えていません。再読み込みしてください。"
        action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
      />
    )
  }

  return (
    <div>
      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>この30日に動いた</p>
          <p className={styles.kpiValue}><MetricValue value={data?.summary.executed ?? null} unit="回" /></p>
          <p className={styles.kpiSub}>{data ? '実行結果を集計' : '未取得'}</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>失敗した</p>
          <p className={styles.kpiValue}><MetricValue value={data?.summary.failed ?? null} unit="回" /></p>
          <p className={styles.kpiSub}>処理結果を確認してください</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>いちばん動いた</p>
          <p className={styles.kpiValue}>{data?.summary.mostRunName ?? '—'}</p>
          <p className={styles.kpiSub}>
            {data?.summary.mostRunCount !== null && data?.summary.mostRunCount !== undefined
              ? `${formatNumber(data.summary.mostRunCount)}回`
              : '未取得'}
          </p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>条件に外れて動かなかった</p>
          <p className={styles.kpiValue}><MetricValue value={data?.summary.skipped ?? null} unit="回" /></p>
          <p className={styles.kpiSub}>条件が厳しすぎないか見てください</p>
        </div>
      </div>

      <p className={styles.footnote}>オートメーションが動いた記録です。条件に外れて動かなかったものも並びます。</p>
      {retryNotice ? <p role="status" className={styles.footnote}>{retryNotice}</p> : null}

      <div className={styles.toolbar}>
        <TextField
          aria-label="友だちの名前・オートメーションの名前で検索"
          placeholder="友だちの名前・オートメーションの名前で検索"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          className={styles.toolsSearch}
        />
        <label className={styles.checkLabel}>
          <Checkbox
            checked={includeTest}
            onCheckedChange={(checked) => changeIncludeTest(checked)}
          />
          テスト実行も見る
        </label>
        <p className={styles.footnote}>この30日・20件表示</p>
      </div>

      <div className={styles.toolbar}>
        <SegmentedControl
          aria-label="結果で絞り込む"
          value={resultFilter}
          onChange={(value) => changeResultFilter(value)}
          options={[
            { value: 'all', label: `すべて ${data ? formatNumber(data.summary.total) : '—'}` },
            { value: 'executed', label: `動いた ${data ? formatNumber(data.summary.executed) : '—'}` },
            { value: 'skipped', label: `条件に外れた ${data ? formatNumber(data.summary.skipped) : '—'}` },
            { value: 'problems', label: `失敗 ${data ? formatNumber(data.summary.failed) : '—'}` },
          ]}
        />
      </div>

      {!data || data.items.length === 0 ? (
        <div className={styles.stateWrap}>
          <ListState
            kind="empty"
            title={query || resultFilter !== 'all' ? '条件に合う記録はありません' : '動いた記録はまだありません'}
            description={query || resultFilter !== 'all' ? '検索語や絞り込みを変えてください。' : 'オートメーションが動くと、結果がここに残ります。'}
          />
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">いつ・だれに</th>
                <th scope="col">オートメーション</th>
                <th scope="col">結果</th>
                <th scope="col">したこと</th>
                <th scope="col">かかった時間</th>
                <th scope="col"><span className={styles.visuallyHidden}>操作</span></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((run) => (
                <tr key={run.id}>
                  <td>
                    <p className={styles.cellMain}>{formatOccurredAt(run.occurredAt)} ／ {run.subject ?? '友だち名なし'}</p>
                    <p className={styles.cellSub}>{run.accountLabel ?? 'アカウント名なし'}</p>
                  </td>
                  <td>
                    <p className={styles.cellMain} title={run.automationName}>
                      {run.automationName}
                      <span className={styles.cellSubDark}> v{run.versionNumber}</span>
                      {run.isTest ? <span className={styles.testPill}>テスト</span> : null}
                    </p>
                    <p className={styles.cellSub} title={run.triggerLabel}>{run.triggerLabel}</p>
                  </td>
                  <td><span className={statusPill(run.status)}>{STATUS_LABEL[run.status]}</span></td>
                  <td><p className={styles.cellSub} title={run.detail ?? '何もしていません'}>{run.detail ?? '何もしていません'}</p></td>
                  <td><span className={styles.num}>{formatDuration(run.durationMs)}</span></td>
                  <td>
                    <div className={styles.rowActions}>
                      <Button onClick={() => setSelectedRun(run)} variant="secondary" size="compact">中身を見る</Button>
                      {runPermissions?.canOperate && run.canRetry ? (
                        <Button
                          onClick={() => void retryRun(run)}
                          disabled={retryingId !== null}
                          variant="secondary"
                          size="compact"
                          title="失敗した処理だけを再実行します"
                          busy={retryingId === run.id}
                          busyLabel="実行中"
                        >
                          もう一度やる
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.footer}>
            <ListRange
              label="記録"
              total={data.pagination.total}
              first={data.items.length === 0 ? 0 : data.pagination.offset + 1}
              last={data.pagination.offset + data.items.length}
            />
            <Pagination
              page={page}
              pageCount={Math.max(1, Math.ceil(data.pagination.total / RUNS_PAGE_SIZE))}
              onPageChange={setPage}
              ariaLabel="動いた記録のページ送り"
            />
          </div>
        </div>
      )}

      {!selectedRun && deepLinkRunId ? (
        deepLinkLoading ? (
          <section className={styles.detailPanel} aria-label="実行記録の中身">
            <p className={styles.footnote}>読み込んでいます</p>
          </section>
        ) : deepLinkError === 'forbidden' ? (
          <section className={styles.detailPanel} aria-label="実行記録の中身">
            <p className={styles.footnote}>この実行を見る権限がありません。</p>
          </section>
        ) : deepLinkError === 'error' ? (
          <section className={styles.detailPanel} aria-label="実行記録の中身">
            <div className={styles.toolbar}>
              <p className={styles.footnote}>詳細を読み込めませんでした。記録は消えていません。</p>
              <Button onClick={() => setDeepLinkReloadKey((key) => key + 1)}>もう一度読む</Button>
            </div>
          </section>
        ) : null
      ) : null}

      {selectedRun ? (
        <section className={styles.detailPanel} aria-label="実行記録の中身">
          <div className={styles.detailHead}>
            <div>
              <p className={styles.detailEyebrow}>実行記録の中身</p>
              <h2 className={styles.detailTitle}>
                {selectedRun.automationName}
                <span className={styles.detailVersion}>版 v{(selectedDetail ?? selectedRun).versionNumber}</span>
                {(selectedDetail ?? selectedRun).isTest ? <span className={styles.testPill}>テスト実行</span> : null}
                {selectedDetail ? (
                  selectedDetail.isCurrentVersion ? (
                    <span className={styles.detailVersion}>いまの公開版です</span>
                  ) : selectedDetail.currentVersionNumber !== null ? (
                    <span className={styles.detailVersion}>いまの公開版は v{selectedDetail.currentVersionNumber} です</span>
                  ) : null
                ) : null}
              </h2>
              <p className={styles.footnote}>{formatOccurredAt(selectedRun.occurredAt)} ／ {selectedRun.subject ?? '友だち名なし'}</p>
            </div>
            <Button onClick={() => setSelectedRun(null)} variant="secondary" size="compact">閉じる</Button>
          </div>
          <dl className={styles.detailGrid}>
            <div className={styles.detailCell}>
              <dt className={styles.detailLabel}>きっかけ</dt>
              <dd className={styles.detailValue}>{selectedRun.triggerLabel}</dd>
            </div>
            <div className={styles.detailCell}>
              <dt className={styles.detailLabel}>結果</dt>
              <dd className={styles.detailValue}>{STATUS_LABEL[selectedRun.status]}</dd>
            </div>
            <div className={styles.detailCell}>
              <dt className={styles.detailLabel}>したこと・失敗理由</dt>
              <dd className={styles.detailValue}>{selectedRun.detail ?? '何もしていません'}</dd>
            </div>
            <div className={styles.detailCell}>
              <dt className={styles.detailLabel}>かかった時間</dt>
              <dd className={styles.detailValue}>{formatDuration(selectedRun.durationMs)}</dd>
            </div>
            {selectedDetail?.holdReason ? (
              <div className={styles.detailCell}>
                <dt className={styles.detailLabel}>止まっている理由</dt>
                <dd className={styles.detailValue}>{selectedDetail.holdReason}</dd>
              </div>
            ) : null}
          </dl>

          <div>
            <p className={styles.detailLabel}>処理ごとの結果</p>
            {detailLoading ? (
              <p className={styles.footnote}>読み込んでいます</p>
            ) : detailError === 'forbidden' ? (
              <p className={styles.footnote}>この実行を見る権限がありません。</p>
            ) : detailError === 'error' ? (
              <div className={styles.toolbar}>
                <p className={styles.footnote}>詳細を読み込めませんでした。記録は消えていません。</p>
                <Button onClick={() => setDetailReloadKey((key) => key + 1)}>もう一度読む</Button>
              </div>
            ) : selectedDetail && selectedDetail.steps.length > 0 ? (
              <ul className={styles.stepList}>
                {selectedDetail.steps.map((step) => (
                  <li key={step.stepKey} className={styles.stepRow}>
                    <span className={styles.stepName}>
                      {step.actionLabel}
                      {step.commonActionVersionId ? <span className={styles.cellSub}>（共通アクション）</span> : null}
                    </span>
                    <span className={styles.stepMeta}>
                      <span className={styles.num}>{step.attemptNumber}回目</span>
                      <span className={step.status === 'failed' ? styles.stepFailed : step.status === 'success' ? styles.stepSuccess : styles.stepMuted}>
                        {STEP_STATUS_LABEL[step.status]}
                      </span>
                    </span>
                    {step.errorMessage ? <p className={styles.stepError}>{step.errorMessage}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.footnote}>処理の記録はありません</p>
            )}
          </div>

          <p className={styles.footnote}>
            {selectedRun.canRetry
              ? '失敗した処理だけを、成功済みの処理と重ならないようにもう一度実行できます。'
              : selectedRun.canCancel
                ? 'まだ終わっていない実行です。取りやめるとこれ以降の処理は動きませんが、記録は残ります。'
                : '安全な再実行の対象ではありません。成功済みの処理を二重に動かさないため、この記録からは再実行できません。'}
          </p>
          <div className={styles.toolbar}>
            {selectedRun.canRetry && runPermissions?.canOperate ? (
              <Button onClick={() => void retryRun(selectedRun)} disabled={retryingId !== null} busy={retryingId === selectedRun.id} busyLabel="実行中">失敗した処理をもう一度やる
              </Button>
            ) : null}
            {selectedRun.canCancel && runPermissions?.canOperate ? (
              confirmCancel ? (
                <>
                  <span className={styles.confirmText}>「{selectedRun.accountLabel ?? '選択中のアカウント'}」の実行を取りやめますか？記録は残りますが、実行は戻せません。</span>
                  <Button onClick={() => void cancelRun(selectedRun)} disabled={cancellingId !== null} busy={cancellingId === selectedRun.id} busyLabel="取りやめ中">取りやめる
                  </Button>
                  <Button onClick={() => setConfirmCancel(false)} disabled={cancellingId !== null}>キャンセル</Button>
                </>
              ) : (
                <Button onClick={() => setConfirmCancel(true)} disabled={cancellingId !== null}>この実行を取りやめる</Button>
              )
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
