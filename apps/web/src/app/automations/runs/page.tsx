'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { api, downloadApiFile, fetchApi, type AutomationRunDetail } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import MergedTabs from '@/components/layout/merged-tabs'
import { usePageTitle } from '@/components/shell/page-chrome'
import FilterChip from '@/components/shared/filter-chip'
import KpiCollapse from '@/components/ui/kpi-collapse'
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
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryNotice, setRetryNotice] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  // テスト実行は既定で除き、見たいときだけ含める（V6 25-1-B）。
  const [includeTest, setIncludeTest] = useState(false)
  const [csvBusy, setCsvBusy] = useState(false)
  /*
   * #1043 / V6 §9: 見るだけの権限では「もう一度やる」「取りやめ」
   * 「CSVで書き出す」を出さない。最終判断はサーバの個別権限キー。
   */
  const runPermissions = useAutomationRunPermissions()

  // 検索の連打で古い応答が新しい表示を上書きしないよう世代で守る（#519 軽）。
  const loadGeneration = useRef(0)

  /*
   * 一覧から来た検索語と、ブラウザの戻る・進むで変わったURLを入力欄へ戻す。
   * URLにも入力値を残すので、再読み込みしても対象を見失わない。
   */
  useEffect(() => {
    setQuery(searchFromUrl)
  }, [searchFromUrl])

  const changeQuery = (value: string) => {
    setQuery(value)
    router.replace(automationRunsSearchUrl(pathname, searchParams.toString(), value), { scroll: false })
  }

  const load = useCallback(async () => {
    if (accountLoading) return
    const generation = loadGeneration.current + 1
    loadGeneration.current = generation
    setStatus('loading')
    try {
      const params = new URLSearchParams({ limit: '20', offset: '0' })
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
  }, [accountLoading, query, resultFilter, selectedAccountId, includeTest])

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
      setConfirmCancel(false)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    api.automations.getRun(selectedRun.id)
      .then((response) => {
        if (cancelled) return
        setSelectedDetail(response.success ? response.data : null)
      })
      .catch(() => {
        if (!cancelled) setSelectedDetail(null)
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedRun])

  /**
   * #942 N-353: まだ終わっていない実行の取りやめ。
   *
   * 記録は消さず `cancelled` で閉じる。確認を挟むのは、
   * 取りやめたあと実行は戻せないから（記録自体は残る）。
   */
  const cancelRun = async (run: AutomationRun) => {
    if (!run.canCancel || cancellingId) return
    setCancellingId(run.id)
    setRetryNotice('')
    try {
      const response = await api.automations.cancelRun(run.id)
      if (!response.success) throw new Error(response.error)
      setRetryNotice('実行を取りやめました。記録は残っています。')
      setSelectedRun(null)
      setConfirmCancel(false)
      await load()
    } catch (caught) {
      setRetryNotice(caught instanceof Error ? caught.message : '実行を取りやめられませんでした')
    } finally {
      setCancellingId(null)
    }
  }

  const retryRun = async (run: AutomationRun) => {
    if (!run.canRetry || retryingId) return
    setRetryingId(run.id)
    setRetryNotice('')
    try {
      const response = await fetchApi<ApiResponse<{ status: string }>>(
        `/api/automation-runs/${encodeURIComponent(run.id)}/retry`,
        { method: 'POST' },
      )
      if (!response.success) throw new Error(response.error)
      // #736: 実行完了を待たず受け付けだけ返すため、結果は実行記録の再取得で確認する。
      // 無期限ポーリングはしない。
      setRetryNotice('再実行を受け付けました。結果は実行記録で確認してください')
      setSelectedRun(null)
      await load()
    } catch (caught) {
      setRetryNotice(caught instanceof Error ? caught.message : '再実行できませんでした')
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
      .catch(() => setRetryNotice('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。'))
      .finally(() => setCsvBusy(false))
  }

  return (
    <div data-design-node="DkPY0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-faint">自動化 ＞ オートメーション ＞ 動いた記録</p>
        {runPermissions?.canExport ? (
          <div className="text-right">
            <Button disabled={csvBusy} onClick={downloadRunsCsv}>{csvBusy ? '書き出しています…' : 'CSVで書き出す'}</Button>
            <p className="mt-1 text-xs text-ink-faint">いまの検索・絞り込みの行が出ます</p>
          </div>
        ) : null}
      </div>
      <div className="mb-4"><MergedTabs basePath="/automations/runs" paramName="tab" tabs={TABS} active="runs" /></div>

      {/* #975 U060: 390pxでは先頭2件だけ出し、残りは「集計を見る」で開く。 */}
      <KpiCollapse className="mb-4" gridClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="この30日に動いた" value={data ? `${data.summary.executed.toLocaleString('ja-JP')}回` : '—'} note={data ? '実行結果を集計' : '未取得'} />
        <Metric label="失敗した" value={data ? `${data.summary.failed.toLocaleString('ja-JP')}回` : '—'} note="処理結果を確認してください" danger={Boolean(data?.summary.failed)} />
        <Metric label="いちばん動いた" value={data?.summary.mostRunName ?? '—'} note={data?.summary.mostRunCount !== null && data?.summary.mostRunCount !== undefined ? `${data.summary.mostRunCount.toLocaleString('ja-JP')}回` : '未取得'} />
        <Metric label="条件に外れて動かなかった" value={data ? `${data.summary.skipped.toLocaleString('ja-JP')}回` : '—'} note="条件が厳しすぎないか見てください" />
      </KpiCollapse>

      <div className="mb-4 rounded-control border border-info bg-info-bg px-4 py-3 text-sm font-medium text-info">
        オートメーションが動いた記録です。条件に外れて動かなかったものも並ぶため、「動いていないはず」の切り分けができます。
      </div>
      {retryNotice ? <p className="mb-4 rounded-control border border-hairline bg-canvas-sunken px-4 py-3 text-sm text-ink-secondary" role="status">{retryNotice}</p> : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <input type="search" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="友だちの名前・オートメーションの名前で検索" className="h-10 w-full max-w-lg rounded-control border border-hairline bg-canvas px-3 text-sm outline-none focus:border-info" />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={includeTest}
              onChange={(event) => setIncludeTest(event.target.checked)}
            />
            テスト実行も見る
          </label>
          <p className="text-sm text-ink-secondary">この30日・20件表示</p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2" aria-label="結果で絞り込む">
        {([
          ['all', `すべて ${data?.summary.total.toLocaleString('ja-JP') ?? '—'}`],
          ['executed', `動いた ${data?.summary.executed.toLocaleString('ja-JP') ?? '—'}`],
          ['skipped', `条件に外れた ${data?.summary.skipped.toLocaleString('ja-JP') ?? '—'}`],
          ['problems', `失敗 ${data?.summary.failed.toLocaleString('ja-JP') ?? '—'}`],
        ] as const).map(([value, label]) => (
          <FilterChip key={value} selected={resultFilter === value} onChange={() => setResultFilter(value)}>{label}</FilterChip>
        ))}
      </div>

      {status === 'loading' ? (
        <ListState kind="loading" title="動いた記録を読み込んでいます" />
      ) : status === 'error' ? (
        <ListState kind="error" title="動いた記録を読み込めませんでした" description="記録は消えていません。再読み込みしてください。" action={<Button onClick={() => void load()}>もう一度読み込む</Button>} />
      ) : !data || data.items.length === 0 ? (
        <ListState kind="empty" title={query || resultFilter !== 'all' ? '条件に合う記録はありません' : '動いた記録はまだありません'} description={query || resultFilter !== 'all' ? '検索語や絞り込みを変えてください。' : 'オートメーションが動くと、結果がここに残ります。'} />
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
                {runPermissions?.canOperate ? (
                  <Button
                    onClick={() => void retryRun(run)}
                    disabled={!run.canRetry || retryingId !== null}
                    title={run.canRetry ? '失敗した処理だけを再実行します' : '成功済みの処理は二重に実行しません'}
                  >
                    {retryingId === run.id ? '実行中' : 'もう一度やる'}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          <div className="border-t border-hairline px-4 py-3"><ListRange label="記録" total={data.pagination.total} first={data.items.length === 0 ? 0 : 1} last={data.items.length} /></div>
        </div>
      )}

      {selectedRun ? (
        <section data-design="run-detail" className="mt-4 rounded-card border border-hairline bg-canvas p-5 shadow-sm" aria-label="実行記録の中身">
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
                  <span className="text-xs font-semibold text-danger">この実行を取りやめますか？記録は残りますが、実行は戻せません。</span>
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

function Metric({ label, value, note, danger = false }: { label: string; value: string; note: string; danger?: boolean }) {
  return (
    <section className="rounded-card border border-hairline bg-canvas p-4 shadow-sm">
      <p className="text-xs font-semibold text-ink-faint">{label}</p>
      <p className={`mt-1 truncate text-xl font-bold ${danger ? 'text-danger' : 'text-ink'}`} title={value}>{value}</p>
      <p className="mt-1 truncate text-xs text-ink-faint" title={note}>{note}</p>
    </section>
  )
}
