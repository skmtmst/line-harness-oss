'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { api, ApiError, downloadApiFile, fetchApi, type AutomationRunDetail } from '@/lib/api'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ListState from '@/components/shared/list-state'
import MergedTabs from '@/components/layout/merged-tabs'
import { usePageTitle } from '@/components/shell/page-chrome'
import FilterChip from '@/components/shared/filter-chip'
import Pagination from '@/components/shared/pagination'
import KpiCollapse from '@/components/ui/kpi-collapse'
import Notice from '@/components/shared/notice'
import ListRange from '@/components/ui/list-range'
import { useAutomationRunPermissions } from '@/components/automations/use-can-manage'

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
  /** #942 N-354: 実行時に固定された版番号。 */
  versionNumber: number
  /** #942 N-354: 1人テストの実行か。 */
  isTest: boolean
  /** #942 N-353: 取りやめられるのは、まだ終わっていない実行だけ。 */
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

const TABS = [
  { key: 'active', label: '動いているもの', href: '/automations' },
  { key: 'stopped', label: '止めているもの', href: '/automations?tab=stopped' },
  { key: 'runs', label: '動いた記録' },
  { key: 'templates', label: '見本', href: '/automations?tab=templates' },
  { key: 'common-actions', label: '共通アクション', href: '/common-actions' },
]

/** 1ページに読む件数（R24）。以前の固定表示と同じ20件。 */
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

/** 処理ごとの結果の状態（#942 N-354）。 */
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
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

function formatDuration(value: number | null): string {
  if (value === null) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(1)}秒` : `${value}ミリ秒`
}

function automationRunsSearchUrl(
  pathname: string,
  currentParams: string,
  value: string,
): string {
  const next = new URLSearchParams(currentParams)
  if (value) next.set('search', value)
  else next.delete('search')
  const suffix = next.toString()
  return suffix ? `${pathname}?${suffix}` : pathname
}

export default function AutomationRunsPage() {
  usePageTitle('オートメーション')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchFromUrl = searchParams.get('search') ?? ''
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [data, setData] = useState<RunsResponse | null>(null)
  const [query, setQuery] = useState(searchFromUrl)
  /*
   * URLの `?status=` で絞り込み済みの記録を開ける（IDEA-01）。
   * ダッシュボードの「失敗した実行」カードは `?status=problems` でここへ来る。
   * 知らない値は「すべて」へ落とす。
   */
  const [resultFilter, setResultFilter] = useState<'all' | 'executed' | 'skipped' | 'problems'>(() => {
    const raw = searchParams.get('status')
    return raw === 'executed' || raw === 'skipped' || raw === 'problems' ? raw : 'all'
  })
  const [selectedRun, setSelectedRun] = useState<AutomationRun | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<AutomationRunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  /**
   * R493: 詳細の取得失敗は「記録なし」と別に持つ。`forbidden` は権限不足
   * （再読み込みを出さない）、`error` は通信などの失敗（再読み込みを出す）。
   */
  const [detailError, setDetailError] = useState<null | 'error' | 'forbidden'>(null)
  /** 詳細の「もう一度読む」で取り直すための番号。 */
  const [detailReloadKey, setDetailReloadKey] = useState(0)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryNotice, setRetryNotice] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  // テスト実行は既定で除き、見たいときだけ含める（V6 25-1-B）。
  const [includeTest, setIncludeTest] = useState(false)
  const [csvBusy, setCsvBusy] = useState(false)
  /*
   * R24: 21件目以降を順にたどれるよう、共通のページ送りで読む位置を持つ。
   * 1ページは20件（以前の固定表示と同じ）。検索・絞り込み・店が替わったら
   * 先頭へ戻す（替えた条件の2ページ目に残ると「無い」と読み違える）。
   */
  const [page, setPage] = useState(1)
  /*
   * #1043 / V6 §9: 見るだけの権限では「もう一度やる」「取りやめ」
   * 「CSVで書き出す」を出さない。最終判断はサーバの個別権限キー。
   */
  const runPermissions = useAutomationRunPermissions()

  // 検索の連打で古い応答が新しい表示を上書きしないよう世代で守る（#519 軽）。
  const loadGeneration = useRef(0)
  const selectedAccountRef = useRef(selectedAccountId)
  selectedAccountRef.current = selectedAccountId
  /*
   * R492: 店切替の effect と詳細読みの effect は同じ描画で走ることがある。
   * 先に走る切替側が世代を進め、遅れた詳細の応答を捨てる。
   */
  const detailGeneration = useRef(0)

  /*
   * 一覧から来た検索語と、ブラウザの戻る・進むで変わったURLを入力欄へ戻す。
   * URLにも入力値を残すので、再読み込みしても対象を見失わない。
   */
  useEffect(() => {
    setQuery(searchFromUrl)
  }, [searchFromUrl])

  const changeQuery = (value: string) => {
    setQuery(value)
    setPage(1)
    router.replace(automationRunsSearchUrl(pathname, searchParams.toString(), value), { scroll: false })
  }

  const changeResultFilter = (value: 'all' | 'executed' | 'skipped' | 'problems') => {
    setResultFilter(value)
    setPage(1)
  }

  const changeIncludeTest = (value: boolean) => {
    setIncludeTest(value)
    setPage(1)
  }

  /* 店が替わったら先頭のページから読み直す。 */
  useEffect(() => {
    setPage(1)
  }, [selectedAccountId])

  /*
   * R492: 店が替わったら、前の店の詳細・取消確認・操作案内を残さない。
   * 読みかけの一覧も世代を進めて無効にする。残った確認で前の店の
   * 実行を取りやめる道をここで塞ぐ（取りやめ自体も開始時の店と照合する）。
   */
  useEffect(() => {
    loadGeneration.current += 1
    detailGeneration.current += 1
    setSelectedRun(null)
    setSelectedDetail(null)
    setDetailError(null)
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
    } catch {
      if (generation !== loadGeneration.current) return
      setData(null)
      setStatus('error')
    }
  }, [accountLoading, page, query, resultFilter, selectedAccountId, includeTest])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 400)
    return () => window.clearTimeout(timer)
  }, [load])

  /*
   * 詳細パネルを開いたら、版番号・テスト印・処理ごとの結果を
   * 1件の口（GET /api/automation-runs/:id）から取り直す（#942 N-354）。
   * 一覧の行には無い情報なので、開いたときだけ読む。
   */
  useEffect(() => {
    if (!selectedRun) {
      setSelectedDetail(null)
      setDetailError(null)
      setConfirmCancel(false)
      return
    }
    // R492: 読み始めた店と違う店が出ていたら、遅れて返っても書かない。
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

  /**
   * #942 N-353: まだ終わっていない実行の取りやめ。
   *
   * 記録は消さず `cancelled` で閉じる。確認を挟むのは、
   * 取りやめたあと実行は戻せないから（記録自体は残る）。
   */
  const cancelRun = async (run: AutomationRun) => {
    if (!run.canCancel || cancellingId) return
    // R492: 始めた店と違う店が出ていたら書かない。Bの画面からAへの
    // 取消POSTを作らない（サーバ側も所属で見るが、画面で先に塞ぐ）。
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
      // #736: 実行完了を待たず受け付けだけ返すため、結果は実行記録の再取得で確認する。
      // 無期限ポーリングはしない。
      setRetryNotice('再実行を受け付けました。結果は実行記録で確認してください')
      setSelectedRun(null)
      await load()
    } catch (caught) {
      if (selectedAccountRef.current !== accountAtStart) return
      /*
       * R494: 応答が失われた・競合で返ったときは古い失敗表示のままにしない。
       * 一覧と詳細を取り直し、いまの状態に合わせて案内する。受付済みなら
       * 古い再試行ボタンは残さない（取り直した行がボタンを決める）。
       */
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

  /*
   * #942 N-353: CSV書き出し。画面の検索・絞り込みと同じ行を、
   * `format=csv` でそのままファイルにする。
   * #1053: 直リンクは Cookie が届かない経路（Bearer 補完）で401になるため、
   * 認証付きで取得してから保存する。
   */
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
        // R495: 上限で切れたら件数と分け方を知らせる。全部出たときは黙る。
        if (result.truncated && result.totalCount !== null) {
          const rest = result.totalCount - (result.returnedCount ?? 0)
          setRetryNotice(
            `5,000件までしか出ませんでした（対象${result.totalCount.toLocaleString('ja-JP')}件・残り${rest.toLocaleString('ja-JP')}件）。期間や絞り込みで分けて出してください。`,
          )
        }
      })
      .catch(() => setRetryNotice('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。'))
      .finally(() => setCsvBusy(false))
  }

  /*
   * R488: 1人テストの結果から `?run=<実行ID>` でこの記録へ飛べる。
   * 一覧に無い実行（テスト実行など）でも、詳細だけ開く。
   */
  useEffect(() => {
    const runId = new URLSearchParams(window.location.search).get('run')
    if (!runId) return
    const accountAtStart = selectedAccountRef.current
    let cancelled = false
    api.automations.getRun(runId)
      .then((response) => {
        if (cancelled || !response.success || selectedAccountRef.current !== accountAtStart) return
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
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return (
    <div data-design-node="DkPY0" className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-faint">自動化 ＞ オートメーション ＞ 動いた記録</p>
        {runPermissions?.canExport ? (
          <div className="text-right">
            <Button disabled={csvBusy} onClick={downloadRunsCsv}>{csvBusy ? '書き出しています…' : 'CSVで書き出す'}</Button>
            {data && data.pagination.total > 5000 ? (
              <p className="mt-1 text-xs text-ink-faint">いまの検索・絞り込みは{data.pagination.total.toLocaleString('ja-JP')}件あり、5,000件までしか出ません。期間や絞り込みで分けて出してください。</p>
            ) : (
              <p className="mt-1 text-xs text-ink-faint">いまの検索・絞り込みの行が出ます（5,000件まで）</p>
            )}
          </div>
        ) : null}
      </div>
      <div><MergedTabs basePath="/automations/runs" paramName="tab" tabs={TABS} active="runs" /></div>

      {/* #975 U060: 390pxでは先頭2件だけ出し、残りは「集計を見る」で開く。 */}
      <KpiCollapse gridClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="この30日に動いた" value={data ? `${data.summary.executed.toLocaleString('ja-JP')}回` : '—'} note={data ? '実行結果を集計' : '未取得'} />
        <Metric label="失敗した" value={data ? `${data.summary.failed.toLocaleString('ja-JP')}回` : '—'} note="処理結果を確認してください" />
        <Metric label="いちばん動いた" value={data?.summary.mostRunName ?? '—'} note={data?.summary.mostRunCount !== null && data?.summary.mostRunCount !== undefined ? `${data.summary.mostRunCount.toLocaleString('ja-JP')}回` : '未取得'} />
        <Metric label="条件に外れて動かなかった" value={data ? `${data.summary.skipped.toLocaleString('ja-JP')}回` : '—'} note="条件が厳しすぎないか見てください" />
      </KpiCollapse>

      <Notice tone="info" message="オートメーションが動いた記録です。条件に外れて動かなかったものも並びます。" className="mb-4" />
      {retryNotice ? <p className="mb-4 rounded-control border border-hairline bg-canvas-sunken px-4 py-3 text-sm text-ink-secondary" role="status">{retryNotice}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input type="search" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="友だちの名前・オートメーションの名前で検索" className="h-10 w-full max-w-lg rounded-control border border-hairline bg-canvas px-3 text-sm" />
        <div className="flex items-center gap-3">
          <Checkbox
            checked={includeTest}
            onCheckedChange={(checked) => changeIncludeTest(checked)}
          >テスト実行も見る</Checkbox>
          <p className="text-sm text-ink-secondary">この30日・20件表示</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="結果で絞り込む">
        {([
          ['all', 'すべて', data?.summary.total.toLocaleString('ja-JP') ?? '—'],
          ['executed', '動いた', data?.summary.executed.toLocaleString('ja-JP') ?? '—'],
          ['skipped', '条件に外れた', data?.summary.skipped.toLocaleString('ja-JP') ?? '—'],
          ['problems', '失敗', data?.summary.failed.toLocaleString('ja-JP') ?? '—'],
        ] as const).map(([value, label, total]) => (
          <FilterChip key={value} selected={resultFilter === value} onChange={() => changeResultFilter(value)} count={total}>{label}</FilterChip>
        ))}
      </div>

      {status === 'loading' ? (
        <ListState kind="loading" title="動いた記録を読み込んでいます" />
      ) : status === 'error' ? (
        <ListState kind="error" title="動いた記録を読み込めませんでした" description="記録は消えていません。再読み込みしてください。" action={<Button onClick={() => void load()}>もう一度読み込む</Button>} />
      ) : !data || data.items.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState kind="empty" title={query || resultFilter !== 'all' ? '条件に合う記録はありません' : '動いた記録はまだありません'} description={query || resultFilter !== 'all' ? '検索語や絞り込みを変えてください。' : 'オートメーションが動くと、結果がここに残ります。'} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-sm">
          <div className="grid grid-cols-6 gap-3 bg-canvas-sunken px-4 py-3 text-xs font-semibold text-ink-faint">
            <span>いつ・だれに</span><span>オートメーション</span><span>結果</span><span>したこと</span><span>かかった時間</span><span aria-hidden />
          </div>
          {data.items.map((run) => (
            <div key={run.id} className="grid min-h-14 grid-cols-6 items-center gap-3 border-t border-hairline px-4 py-2 text-sm">
              <div className="min-w-0"><p className="truncate font-semibold text-ink">{formatOccurredAt(run.occurredAt)} ／ {run.subject ?? '友だち名なし'}</p><p className="truncate text-xs text-ink-faint">{run.accountLabel ?? 'アカウント名なし'}</p></div>
              <div className="min-w-0"><p className="truncate text-ink" title={run.automationName}>{run.automationName}<span className="ml-1 text-xs font-normal text-ink-faint">v{run.versionNumber}</span>{run.isTest ? <span className="ml-1 rounded-full border border-hairline bg-canvas-sunken px-2 py-0.5 text-xs font-semibold text-ink-secondary">テスト</span> : null}</p><p className="truncate text-xs text-ink-faint" title={run.triggerLabel}>{run.triggerLabel}</p></div>
              <span className={run.status === 'permanent_failed' || run.status === 'partial' || run.status === 'retry_wait' ? 'font-semibold text-danger' : run.status === 'succeeded' ? 'font-semibold text-accent-deep' : 'font-semibold text-ink-faint'}>{STATUS_LABEL[run.status]}</span>
              <p className="truncate text-ink-secondary" title={run.detail ?? '何もしていません'}>{run.detail ?? '何もしていません'}</p>
              <span className="tabular-nums text-ink-secondary">{formatDuration(run.durationMs)}</span>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setSelectedRun(run)}>中身を見る</Button>
                {runPermissions?.canOperate && run.canRetry ? (
                  <Button
                    onClick={() => void retryRun(run)}
                    disabled={retryingId !== null}
                    title="失敗した処理だけを再実行します"
                  >
                    {retryingId === run.id ? '実行中' : 'もう一度やる'}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-3">
            <ListRange
              label="記録"
              total={data.pagination.total}
              first={data.items.length === 0 ? 0 : data.pagination.offset + 1}
              last={data.pagination.offset + data.items.length}
            />
            {/* R24: 21件目以降はページ送りでたどる。1ページだけなら出さない（部品側の決めごと）。 */}
            <Pagination
              page={page}
              pageCount={Math.max(1, Math.ceil(data.pagination.total / RUNS_PAGE_SIZE))}
              onPageChange={setPage}
              ariaLabel="動いた記録のページ送り"
            />
          </div>
        </div>
      )}

      {selectedRun ? (
        <section data-design="run-detail" className="rounded-card border border-hairline bg-canvas p-5 shadow-sm" aria-label="実行記録の中身">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-info">実行記録の中身</p>
              <h2 className="mt-1 text-lg font-bold text-ink">
                {selectedRun.automationName}
                <span className="ml-2 text-sm font-normal text-ink-faint">版 v{(selectedDetail ?? selectedRun).versionNumber}</span>
                {(selectedDetail ?? selectedRun).isTest ? (
                  <span className="ml-2 rounded-full border border-hairline bg-canvas-sunken px-2 py-0.5 text-xs font-semibold text-ink-secondary">テスト実行</span>
                ) : null}
                {/* #1043: 実行した版といまの公開版を区別する。 */}
                {selectedDetail ? (
                  selectedDetail.isCurrentVersion ? (
                    <span className="ml-2 text-xs font-normal text-ink-faint">いまの公開版です</span>
                  ) : selectedDetail.currentVersionNumber !== null ? (
                    <span className="ml-2 text-xs font-normal text-ink-faint">いまの公開版は v{selectedDetail.currentVersionNumber} です</span>
                  ) : null
                ) : null}
              </h2>
              <p className="mt-1 text-sm text-ink-secondary">{formatOccurredAt(selectedRun.occurredAt)} ／ {selectedRun.subject ?? '友だち名なし'}</p>
            </div>
            <Button onClick={() => setSelectedRun(null)}>閉じる</Button>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <RunDetail label="きっかけ" value={selectedRun.triggerLabel} />
            <RunDetail label="結果" value={STATUS_LABEL[selectedRun.status]} />
            <RunDetail label="したこと・失敗理由" value={selectedRun.detail ?? '何もしていません'} />
            <RunDetail label="かかった時間" value={formatDuration(selectedRun.durationMs)} />
            {/* #1043: 運用停止・機能無効で動けないときの理由を明示する。 */}
            {selectedDetail?.holdReason ? (
              <RunDetail label="止まっている理由" value={selectedDetail.holdReason} />
            ) : null}
          </dl>

          {/* #942 N-354: 処理ごとの結果と試行回数。 */}
          <div className="mt-4">
            <p className="text-xs font-semibold text-ink-faint">処理ごとの結果</p>
            {detailLoading ? (
              <p className="mt-2 text-sm text-ink-faint">読み込んでいます</p>
            ) : detailError === 'forbidden' ? (
              <p className="mt-2 text-sm text-ink-secondary">この実行を見る権限がありません。</p>
            ) : detailError === 'error' ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="text-sm text-ink-secondary">詳細を読み込めませんでした。記録は消えていません。</p>
                <Button onClick={() => setDetailReloadKey((key) => key + 1)}>もう一度読む</Button>
              </div>
            ) : selectedDetail && selectedDetail.steps.length > 0 ? (
              <ul className="mt-2 divide-y divide-hairline rounded-control border border-hairline">
                {selectedDetail.steps.map((step) => (
                  <li key={step.stepKey} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-ink">
                      {step.actionLabel}
                      {step.commonActionVersionId ? <span className="ml-1 text-xs text-ink-faint">（共通アクション）</span> : null}
                    </span>
                    <span className="flex items-center gap-3 text-xs">
                      <span className="tabular-nums text-ink-faint">{step.attemptNumber}回目</span>
                      <span className={step.status === 'failed' ? 'font-semibold text-danger' : step.status === 'success' ? 'font-semibold text-accent-deep' : 'font-semibold text-ink-faint'}>
                        {STEP_STATUS_LABEL[step.status]}
                      </span>
                    </span>
                    {step.errorMessage ? <p className="w-full text-xs text-danger">{step.errorMessage}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-faint">処理の記録はありません</p>
            )}
          </div>

          <div className="mt-4 rounded-control border border-hairline bg-canvas-sunken px-4 py-3 text-sm text-ink-secondary">
            {selectedRun.canRetry
              ? '失敗した処理だけを、成功済みの処理と重ならないようにもう一度実行できます。'
              : selectedRun.canCancel
                ? 'まだ終わっていない実行です。取りやめるとこれ以降の処理は動きませんが、記録は残ります。'
                : '安全な再実行の対象ではありません。成功済みの処理を二重に動かさないため、この記録からは再実行できません。'}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {selectedRun.canRetry && runPermissions?.canOperate ? (
              <Button onClick={() => void retryRun(selectedRun)} disabled={retryingId !== null}>
                {retryingId === selectedRun.id ? '実行中' : '失敗した処理をもう一度やる'}
              </Button>
            ) : null}
            {selectedRun.canCancel && runPermissions?.canOperate ? (
              confirmCancel ? (
                <>
                  <span className="text-xs font-semibold text-danger">「{selectedRun.accountLabel ?? '選択中のアカウント'}」の実行を取りやめますか？記録は残りますが、実行は戻せません。</span>
                  <Button onClick={() => void cancelRun(selectedRun)} disabled={cancellingId !== null}>
                    {cancellingId === selectedRun.id ? '取りやめ中' : '取りやめる'}
                  </Button>
                  <Button onClick={() => setConfirmCancel(false)} disabled={cancellingId !== null}>やめる</Button>
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

function RunDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border border-hairline p-3">
      <dt className="text-xs font-semibold text-ink-faint">{label}</dt>
      <dd className="mt-1 text-ink">{value}</dd>
    </div>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <section className="rounded-card border border-hairline bg-canvas p-4 shadow-sm">
      <p className="text-xs font-semibold text-ink-faint">{label}</p>
      <p className="mt-1 truncate text-xl font-bold text-ink" title={value}>{value}</p>
      <p className="mt-1 truncate text-xs text-ink-faint" title={note}>{note}</p>
    </section>
  )
}
