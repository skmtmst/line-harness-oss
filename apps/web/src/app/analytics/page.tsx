'use client'

import './readonly-v8.css'
import { usePageTitle, usePageCrumbs } from '@/components/shell/page-chrome'
import AnalyticsNavigationV8 from './navigation-v8'
import ConversionReportV8 from './conversion-report-v8'

import ReadonlyHeaderV8 from './readonly-header-v8'
import AnalyticsV8, { type AnalyticsSlotsV8 } from '@/v8/analytics/analytics'
import FunnelFormV8 from '@/v8/analytics/funnel-form'
import { useAdminTheme } from '@/lib/use-admin-theme'
import Select from '@/components/shared/select'
import SegmentedControl from '@/components/shared/segmented'
import { RowActions } from '@/components/shared/row-actions'
import SearchField from '@/components/shared/search-field'
import { Suspense, createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Download, Plus } from 'lucide-react'
import type { FriendField } from '@line-crm/shared'
import {
  api,
  ApiError,
  type AnalyticsFriendsOverview,
  type AnalyticsReportSchedule,
  type AnalyticsCrossAxis,
  type AnalyticsCrossResult,
  type AnalyticsFunnelRunResult,
  type AnalyticsMetric,
  type AnalyticsMetricState,
  type AnalyticsReactionsOverview,
  type AnalyticsRoutesOverview,
  type AnalyticsUsageOverview,
  type AnalyticsUrlClicksOverview,
  type RecentOneTimeReport,
  type SavedAnalyticsSnapshot,
  type SavedAnalyticsSummary,
} from '@/lib/api'
import Disclosure from '@/components/shared/disclosure'
import {
  deliveryChannelLabel,
  deliveryStatusLabel,
  runErrorLabel,
  runStateLabel,
} from './report-run-state'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import MetricValue from '@/components/ui/metric-value'
import { useMergedTab } from '@/components/layout/merged-tabs'
import { useSearchParams } from 'next/navigation'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import Chip, { type ChipTone } from '@/components/shared/chip'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { TableHeadRow, Th } from '@/components/shared/table'
import { BarChart, toBarChartItems } from '@/components/shared/bar-chart'
import { useAccount } from '@/contexts/account-context'
import { csvCell } from '@/lib/presentation'
import { analyticsWeekday, formatAnalyticsDate, formatAnalyticsDateTime } from './analytics-time'
import {
  canTidyUsage,
  referenceHealthText,
  summarizeMenuFeatures,
  usageObservation,
} from './analytics-usage'
import { formatNumber, formatTime } from '@/lib/format'

// 実行間隔ガード(点検#508の中4)の符号を、運用の言葉に言い換える。
function explainStartError(code: string, fallback: string): string {
  if (code === 'analytics_cross_busy') return '他の集計が動いています。終わってからもう一度押してください'
  if (code === 'analytics_funnel_too_soon') return 'さきほど集計したばかりです。少し待ってから押してください'
  if (code === 'analytics_funnel_not_active') return '停止中・保管したファネルでは再集計や対象者づくりはできません'
  if (code === 'analytics_funnel_version_conflict' || code === 'analytics_funnel_status_conflict') {
    return '他の人が先に変更しています。最新の状態を開き直してください'
  }
  if (code === 'analytics_funnel_invalid_transition') return 'その状態へは進めません'
  return fallback
}

// 保存済みの段の条件（match）を、編集フォームの1入力へ戻す。
function funnelStepFormValue(kind: string, match: Record<string, string>): string {
  switch (kind) {
    case 'tag': return match.tagId ?? ''
    case 'field': return match.fieldId ?? ''
    case 'form': return match.formId ?? ''
    case 'site_event': return match.pathGroup ?? ''
    case 'link_click': return match.trackedLinkId ?? ''
    case 'conversion': return match.conversionPointId ?? ''
    case 'automation': return match.automationId ?? ''
    default: return ''
  }
}

// 編集フォームが直接いじるmatchのキー。それ以外の副条件(例: tagの付け外し向き)は
// フォームに出せないため、新版へ写すとき元の値をそのまま残す。
function funnelStepPrimaryKey(kind: string): string | null {
  switch (kind) {
    case 'tag': return 'tagId'
    case 'field': return 'fieldId'
    case 'form': return 'formId'
    case 'site_event': return 'pathGroup'
    case 'link_click': return 'trackedLinkId'
    case 'conversion': return 'conversionPointId'
    case 'automation': return 'automationId'
    default: return null
  }
}

const TABS = [
  { key: 'friends', label: '友だちの増減' },
  { key: 'reactions', label: '配信の反応' },
  { key: 'routes', label: '経路と成果' },
  { key: 'usage', label: '使われ方' },
  { key: 'cross', label: 'クロス分析' },
  { key: 'funnel', label: 'ファネル' },
  { key: 'url-clicks', label: 'URLクリック' },
  { key: 'saved', label: '保存した分析' },
]

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function AnalyticsNotice({ children }: { children: ReactNode }) {
  return <Notice tone="info">{children}</Notice>
}

type ExportAction = { onClick: () => void; disabled: boolean }
const AnalyticsExportContext = createContext<((action: ExportAction | null) => void) | null>(null)

function AnalyticsExportButton({ onClick, disabled, label, headerOnly = false }: { onClick: () => void; disabled: boolean; label?: string; headerOnly?: boolean }) {
  const register = useContext(AnalyticsExportContext)
  const action = useRef(onClick)
  action.current = onClick
  useEffect(() => {
    register?.({ onClick: () => action.current(), disabled })
    return () => register?.(null)
  }, [register, disabled])
  if (headerOnly) return null
  return <Button onClick={onClick} disabled={disabled} variant="secondary"><Download size={14} aria-hidden="true" />{label ?? 'CSV で書き出す'}</Button>
}

function metricSum(metrics: Array<AnalyticsMetric<number>>): number | null {
  const values = metrics.map(shownValue)
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

const RANGES = [7, 30, 90]

function RangePicker({ days, onChange }: { days: number; onChange: (days: number) => void }) {
  return <SegmentedControl aria-label="集計期間" options={RANGES.map((range) => ({ value: String(range), label: `${range}日` }))} value={String(days)} onChange={(value) => onChange(Number(value))} />
}

function AnalyticsPeriodControl({ days, onChange }: { days: number; onChange: (days: number) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-medium text-ink-secondary">集計期間</p>
      <RangePicker days={days} onChange={onChange} />
    </div>
  )
}

/**
 * どの表・グラフにも同じ形で「集計期間・データ締切」を出す注記。
 * 「この数はいつの時点の、どの範囲か」を画面ごとに書き方を変えると、
 * 同じ条件で読めているか比べにくい。
 */
function AnalyticsPeriodCaption({ from, to, cutoffAt }: {
  from: string
  to: string
  cutoffAt: string
}) {
  return (
    <span className="text-ink-faint text-xs tabular-nums">
      {/* #640 D-3: from/to は API の YYYY-MM-DD のまま出すと「-」区切りが
          画面内の「/」表記と混ざる。日付専用の整形でそろえる。 */}
      集計期間 {formatAnalyticsDate(from)}〜{formatAnalyticsDate(to)} ／ データ締切 {formatAnalyticsDateTime(cutoffAt)}
    </span>
  )
}

function rangeFor(days: number, now = new Date()): { from: string; to: string } {
  const jstNow = new Date(now.getTime() + 9 * 3600_000)
  return {
    from: new Date(jstNow.getTime() - days * 24 * 3600_000).toISOString().slice(0, 10),
    to: jstNow.toISOString().slice(0, 10),
  }
}

// 概要のfrom/toと同じ日本時間の日付範囲を、ファネルAPIが受け取る明示的な
// timestampへ直す。「7日」は6日前の0時から、実行時点までを対象にする。
function funnelCohortRange(days: number, now = new Date()): { cohortFrom: string; cohortTo: string } {
  const range = rangeFor(days - 1, now)
  return {
    cohortFrom: `${range.from}T00:00:00.000+09:00`,
    // WorkerはdataCutoffAt（=現在）より未来の終了時刻を拒否する。日末ではなく
    // 実行時刻で閉じ、今日を含む選択日数の暦日範囲にする。
    cohortTo: now.toISOString(),
  }
}

function SaveAnalysisAction({
  accountId,
  sourceKind,
  sourceResultId,
  defaultName,
  compact = false,
}: {
  accountId: string
  sourceKind: 'cross' | 'funnel'
  sourceResultId: string
  defaultName: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setOpen(false)
    setName(defaultName)
    setSaved(false)
    setError('')
  }, [accountId, defaultName, sourceResultId])

  const save = async () => {
    if (!name.trim() || !sourceResultId) return
    setSaving(true)
    setError('')
    try {
      const response = await api.analytics.saved.create(accountId, {
        name: name.trim(),
        sourceKind,
        sourceResultId,
      })
      if (!response.success) throw new Error(response.error)
      setSaved(true)
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '分析結果を保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    return (
      <Notice
        tone="success"
        action={
          <Link href="/analytics?tab=saved" className="text-action font-medium hover:underline">
            保存した分析を見る
          </Link>
        }
      >
        定義とこの時点の結果を保存しました
      </Notice>
    )
  }

  return (
    <div className={compact && !open ? undefined : 'space-y-2'}>
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`saved-analysis-${sourceKind}`} className="sr-only">保存する分析名</label>
          <input
            id={`saved-analysis-${sourceKind}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            className="border-hairline rounded-control min-w-64 flex-1 border px-3 py-2 text-sm"
            placeholder="保存する分析名"
          />
          <Button onClick={() => void save()} disabled={saving || !name.trim()} variant="primary" busy={saving} busyLabel="保存中">この名前で保存する
          </Button>
          <Button onClick={() => setOpen(false)} disabled={saving} variant="secondary">
            キャンセル
          </Button>
        </div>
      ) : (
        <Button onClick={() => setOpen(true)} variant="secondary">
          この分析を保存
        </Button>
      )}
      {error && <p className="text-danger text-xs">{error}</p>}
      {!compact && <p className="text-ink-faint text-xs">条件の定義と、いま表示している結果を別々に固定して残します。</p>}
    </div>
  )
}

type CrossQueueStatus = {
  state: string
  queuePosition: number | null
  pendingAhead: number
  estimatedWaitMs: number | null
  nextTickAt: string | null
}

function formatCrossNextTick(nextTickAt: string): string {
  const parsed = new Date(nextTickAt)
  if (Number.isNaN(parsed.getTime())) return ''
  return formatTime(parsed)
}

function formatCrossWaitMinutes(estimatedWaitMs: number): string {
  return String(Math.max(1, Math.round(estimatedWaitMs / 60_000)))
}

// 自動確認は5分cronの最初の処理機会をまたいで続ける。打ち切りは「観測した
// 最短目安+3分」と「開始から15分」の早い方(点検#508の中2: 打ち切りと間隔延長
// があり、無限に叩かない)。run IDは保持し、打ち切り後は「結果をもう一度確認」
// で同じrunへ再接続する。
const CROSS_AUTO_POLL_MIN_MS = 6 * 60_000
const CROSS_AUTO_POLL_MARGIN_MS = 3 * 60_000
const CROSS_AUTO_POLL_MAX_MS = 15 * 60_000
// 一時的な確認失敗の後の待ち時間。run IDを消さず間隔を空けて続け、実行中の集計へ再接続できるようにする。
const CROSS_POLL_ERROR_BACKOFF_MS = 10_000

// 画面を開き直しても、同じタブ・同じLINEアカウント内なら実行中の集計へ
// 戻れるようにする。保存するのは不透明なrun IDと作成時刻だけで、条件や
// 友だち情報は端末へ残さない。runは通常数分で終わるので、古い控えを何日も
// 追いかけないよう1日で捨てる。サーバーが先に消した場合は404でも捨てる。
const CROSS_RUN_STORAGE_PREFIX = 'lh:analytics:cross-run:v1:'
const CROSS_STORED_RUN_TTL_MS = 24 * 60 * 60_000

type StoredCrossRun = {
  id: string
  createdAt: number
}

function crossRunStorageKey(accountId: string): string {
  return `${CROSS_RUN_STORAGE_PREFIX}${encodeURIComponent(accountId)}`
}

function validStoredCrossRun(value: unknown, now = Date.now()): value is StoredCrossRun {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredCrossRun>
  return typeof candidate.id === 'string'
    && /^[A-Za-z0-9-]{1,128}$/.test(candidate.id)
    && typeof candidate.createdAt === 'number'
    && Number.isFinite(candidate.createdAt)
    && candidate.createdAt > 0
    && candidate.createdAt <= now
    && now - candidate.createdAt <= CROSS_STORED_RUN_TTL_MS
}

function readStoredCrossRun(accountId: string): StoredCrossRun | null {
  if (typeof window === 'undefined') return null
  const key = crossRunStorageKey(accountId)
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (validStoredCrossRun(parsed)) return parsed
  } catch {
    // storageが無効な端末でも、新規の集計や結果確認を止めない。
  }
  try { window.sessionStorage.removeItem(key) } catch { /* storage unavailable */ }
  return null
}

function saveStoredCrossRun(accountId: string, run: StoredCrossRun): void {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.setItem(crossRunStorageKey(accountId), JSON.stringify(run)) } catch { /* storage unavailable */ }
}

function clearStoredCrossRun(accountId: string): void {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.removeItem(crossRunStorageKey(accountId)) } catch { /* storage unavailable */ }
}

// 「イベントの回数」で数えられる種類は、記録の接続(analytics_event_coverage)が
// 「取得可能」なものだけ。選べるのに必ず未取得、という選択肢は置かない。
// 正本: apps/worker/src/services/analytics-projection.ts の ensureAnalyticsEventCoverage。
const CROSS_MEASURE_EVENT_OPTIONS = [
  { value: 'message_received', label: '友だちから届いたメッセージの回数' },
  { value: 'postback_received', label: 'ボタン・メニューを押した回数' },
  { value: 'friend_add', label: '友だち追加の回数' },
  { value: 'friend_unfollow', label: 'ブロック・友だち解除の回数' },
]

function CrossTab({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const [fields, setFields] = useState<FriendField[]>([])
  // 友だち情報欄が取れないのに空表示のままにすると、項目を作り直す事故になる。
  const [fieldsError, setFieldsError] = useState('')
  // 読み込み中と「項目がまだありません」を分ける。取り直し中に空の主張を出さない。
  const [fieldsLoading, setFieldsLoading] = useState(true)
  const [fieldsReload, setFieldsReload] = useState(0)
  const [measureKind, setMeasureKind] = useState<'unique_friends' | 'events'>('unique_friends')
  const [measureEventType, setMeasureEventType] = useState(CROSS_MEASURE_EVENT_OPTIONS[0].value)
  const [fieldId, setFieldId] = useState('')
  const [rowKind, setRowKind] = useState<'tag' | 'route' | 'score_band' | 'conversion_point' | 'booking_status' | 'purchase_status'>('tag')
  const [crossResult, setCrossResult] = useState<AnalyticsCrossResult | null>(null)
  const [crossRunId, setCrossRunId] = useState('')
  const [crossResultId, setCrossResultId] = useState('')
  const [crossQueue, setCrossQueue] = useState<CrossQueueStatus | null>(null)
  const [crossAutoStopped, setCrossAutoStopped] = useState(false)
  const [crossRecheck, setCrossRecheck] = useState(0)
  const [loading, setLoading] = useState(false)
  const [restoredCrossRun, setRestoredCrossRun] = useState(false)
  // sessionStorageはSSRの初期HTMLでは読まない。hydration完了後に一度だけ読む。
  const [crossStorageRestored, setCrossStorageRestored] = useState(false)
  const [error, setError] = useState('')
  const [crossDays, setCrossDays] = useState(30)
  const [audience, setAudience] = useState<{ id: string; memberCount: number; expiresAt: string } | null>(null)
  const [picked, setPicked] = useState<{
    row: string
    col: string
    rowKey: string
    columnKey: string
    count: number
    uniqueFriends: number
  } | null>(null)
  // いま表示してよい応答の世代。アカウント切替・画面破棄で進む。
  const viewGeneration = useRef(0)
  // Reactがloading状態を描く前の連続clickでもPOSTを1回に留める。
  const crossStartInFlight = useRef(false)

  useEffect(() => {
    let active = true
    setFieldsLoading(true)
    setFieldsError('')
    void api.friendFields.list(accountId, undefined, { suppressFeatureDisabledEvent: true }).then((res) => {
      if (!active) return
      if (res.success) {
        setFields(res.data)
        if (res.data.length > 0) setFieldId(res.data[0].id)
      } else {
        setFieldsError(res.error || '友だち情報欄を読み込めませんでした')
      }
    }).catch(() => {
      if (active) setFieldsError('友だち情報欄を読み込めませんでした')
    }).finally(() => {
      if (active) setFieldsLoading(false)
    })
    return () => {
      active = false
    }
  }, [accountId, fieldsReload])

  // 親はaccountIdをkeyにも使うため、切替時はCrossTab自体が作り直される。
  // 初期HTMLとhydration時の表示を同じに保ったうえで、同じアカウントのrunだけを復元する。
  useEffect(() => {
    const stored = readStoredCrossRun(accountId)
    if (stored) {
      setCrossRunId(stored.id)
      setCrossResultId(stored.id)
      setLoading(true)
      setRestoredCrossRun(true)
    }
    setCrossStorageRestored(true)
  }, [accountId])

  // アカウントを切り替える、または画面を離れると世代が1つ進む。切替の前に投げた
  // 通信が後から返っても、世代が合わないので表示へ入れない(前のアカウントの
  // run ID・結果・対象者が新しいアカウントの画面に出るのを防ぐ)。
  useEffect(() => {
    const generation = viewGeneration.current
    return () => { viewGeneration.current = generation + 1 }
  }, [accountId])

  const clearCrossRun = useCallback(() => {
    clearStoredCrossRun(accountId)
    setCrossRunId('')
    setCrossResultId('')
    setCrossQueue(null)
    setRestoredCrossRun(false)
  }, [accountId])

  // 結果待ちの読み直し。終わらない集計があると無限に叩き続け、端末の電池と
  // 回線、D1の読み取り枠を消費するため、打ち切り時刻を過ぎたら自動確認は止める。
  // 打ち切りは最低6分(5分cronの最初の処理機会をまたぐ)で、観測した最短目安+3分
  // まで延ばす(上限15分)。集計自体は5分cronで続く。run IDは保持し、
  // 「結果をもう一度確認」で同じrunへ再接続する。一時的な確認失敗でもrun IDを
  // 消さず、順番表示を残したまま間隔を空けて確認を続ける。
  useEffect(() => {
    // storage復元前はSSR/hydration直後の表示だけを保ち、GETを始めない。
    if (!crossStorageRestored || !crossRunId) return
    let active = true
    let timer: number | undefined
    let attempts = 0
    let pollErrors = 0
    const pollStart = Date.now()
    let deadline = pollStart + CROSS_AUTO_POLL_MIN_MS
    // 自動確認の打ち切り。成功でも失敗でも、次の確認を積む前にここを通す。
    // 確認が失敗し続けるときに打ち切りを見ないと、上限15分を過ぎても
    // 端末が叩き続ける。集計自体は5分cronで続くので、run IDと順番表示は
    // 残したまま手動の再確認へ渡す。
    const stopIfDeadlinePassed = (): boolean => {
      if (Date.now() < deadline) return false
      setCrossAutoStopped(true)
      setLoading(false)
      return true
    }
    const check = async () => {
      // 確認を投げる前にも打ち切りを見る。前の確認が長引いて上限を越えた場合に、
      // もう1本増やしてから止める、という動きにしない。
      if (stopIfDeadlinePassed()) return
      attempts += 1
      try {
        const response = await api.analytics.crossResult(accountId, crossRunId)
        if (!active) return
        if (!response.success) throw new Error(response.error)
        pollErrors = 0
        setError('')
        setCrossQueue({
          state: response.data.state,
          queuePosition: response.data.queuePosition ?? null,
          pendingAhead: response.data.pendingAhead ?? 0,
          estimatedWaitMs: response.data.estimatedWaitMs ?? null,
          nextTickAt: response.data.nextTickAt ?? null,
        })
        const waitMs = response.data.estimatedWaitMs
        if (waitMs != null) {
          deadline = Math.min(
            pollStart + CROSS_AUTO_POLL_MAX_MS,
            Math.max(deadline, Date.now() + waitMs + CROSS_AUTO_POLL_MARGIN_MS),
          )
        }
        if (response.data.result) {
          setCrossResult(response.data.result)
          clearCrossRun()
          setLoading(false)
          return
        }
        if (response.data.state === 'failed') {
          setError(response.data.errorCode || 'クロス分析に失敗しました。条件を変えずにもう一度集計できます')
          clearCrossRun()
          setLoading(false)
          return
        }
      } catch (caught) {
        if (!active) return
        if (caught instanceof ApiError && caught.status === 401) {
          // セッション切れは再ログイン後に同じrunを復元できるよう控えを残す。
          // ただし認証なしで10秒ごとに叩き続けない。
          setCrossAutoStopped(true)
          setError('ログインを確認できません。ログインし直した後、同じ集計を確認できます')
          setLoading(false)
          return
        }
        if (caught instanceof ApiError && [400, 403, 404, 410].includes(caught.status)) {
          // 不正なrun ID・権限不足・削除済み・期限切れは、再試行しても解消しない。
          // 控えを消してPOSTも自動確認も止め、次の操作を利用者に委ねる。
          clearCrossRun()
          setError('前回のクロス分析は利用できません。もう一度集計してください')
          setLoading(false)
          return
        }
        // 通信断・5xxなど一時的な確認失敗でrun IDを消すと、実行中の集計へ再接続できなくなる。
        // 順番表示は残し、間隔を空けて確認を続ける。ただし打ち切り時刻を過ぎて
        // いたら、間隔を空ける前にここで止める(失敗が続くほど間隔が延びるため、
        // 打ち切りを後回しにすると上限を大きく越える)。
        pollErrors += 1
        setError('クロス分析を確認できませんでした。確認を続けています')
        if (stopIfDeadlinePassed()) return
        // 失敗が続くほど間隔を空ける(10秒→20秒→30秒まで)。打ち切り時刻はそのまま。
        timer = window.setTimeout(
          () => void check(),
          CROSS_POLL_ERROR_BACKOFF_MS * Math.min(pollErrors, 3),
        )
        return
      }
      if (!active) return
      // 自動確認の打ち切り。5分cronの集計自体は続いている。run IDと順番表示は
      // 保持し、手動の再確認で同じrunへ戻る。新規の送り直しは促さない(送り直すと
      // 元の集計がpendingの間は429になるため)。
      if (stopIfDeadlinePassed()) return
      timer = window.setTimeout(() => void check(), attempts < 10 ? 3000 : 10000)
    }
    void check()
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [accountId, clearCrossRun, crossRunId, crossRecheck, crossStorageRestored])

  // 時間切れ後もrun IDを保持しているため、同じ集計へ再接続できる。
  const recheckCross = () => {
    if (!crossStorageRestored || !crossRunId) return
    setCrossAutoStopped(false)
    setError('')
    setLoading(true)
    setCrossRecheck((n) => n + 1)
  }

  const runCross = async () => {
    if (!crossStorageRestored || !fieldId || crossRunId || crossStartInFlight.current) return
    crossStartInFlight.current = true
    const generation = viewGeneration.current
    setLoading(true)
    setError('')
    setPicked(null)
    setAudience(null)
    setCrossResult(null)
    setCrossQueue(null)
    setCrossAutoStopped(false)
    setRestoredCrossRun(false)
    const now = new Date()
    const from = new Date(now.getTime() - crossDays * 24 * 3600_000)
    const rowAxis: AnalyticsCrossAxis = { kind: rowKind }
    try {
      const response = await api.analytics.runCross(accountId, {
        rowAxis,
        columnAxis: { kind: 'field_choice', fieldId },
        measure: measureKind === 'events'
          ? { kind: 'events', eventType: measureEventType }
          : { kind: 'unique_friends' },
        filters: [],
        periodFrom: from.toISOString(),
        periodTo: now.toISOString(),
      })
      if (!response.success) throw new Error(response.error)
      // 切替の前に投げた集計の受付が後から返っても、前のアカウントのrun IDで
      // 待機表示やポーリングを始めない。
      if (viewGeneration.current !== generation) return
      saveStoredCrossRun(accountId, { id: response.data.id, createdAt: Date.now() })
      setCrossResultId(response.data.id)
      setCrossRunId(response.data.id)
    } catch (caught) {
      if (viewGeneration.current !== generation) return
      const code = caught instanceof Error ? caught.message : ''
      setError(explainStartError(code, code || 'クロス分析を開始できませんでした'))
      setLoading(false)
    } finally {
      crossStartInFlight.current = false
    }
  }

  const prepareCrossAudience = async () => {
    if (!picked || !crossResultId) return
    const generation = viewGeneration.current
    setError('')
    try {
      const response = await api.analytics.createResultAudience(accountId, crossResultId, {
        sourceKind: 'cross',
        rowKey: picked.rowKey,
        columnKey: picked.columnKey,
      })
      if (!response.success) throw new Error(response.error)
      // 前のアカウントで作った対象者を、切替後の画面へ出さない。
      if (viewGeneration.current !== generation) return
      setAudience(response.data)
    } catch (caught) {
      if (viewGeneration.current !== generation) return
      setError(caught instanceof Error ? caught.message : '対象者を準備できませんでした')
    }
  }

  const cells = useMemo(() => (crossResult?.cells ?? []).map((cell) => ({
    row: cell.rowLabel,
    col: cell.columnLabel,
    rowKey: cell.rowKey,
    columnKey: cell.columnKey,
    count: cell.value,
    uniqueFriends: cell.uniqueFriends,
  })), [crossResult])

  const rows = crossResult?.rowValues ?? []
  const cols = crossResult?.columnValues ?? []
  const lookup = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of cells) map.set(`${c.rowKey}\u0000${c.columnKey}`, c.count)
    return map
  }, [cells])

  const fieldName = fields.find((f) => f.id === fieldId)?.name ?? '友だち情報'
  const rowLabel = {
    tag: 'タグ',
    route: '流入経路',
    score_band: 'スコア帯',
    conversion_point: '成果地点',
    booking_status: '予約状態',
    purchase_status: '購入状態',
  }[rowKind]

  const summary = useMemo(() => {
    if (cells.length === 0) return null
    const top = cells.reduce((best, c) => (c.count > best.count ? c : best), cells[0])
    // 行×列のうち、1人もいない組み合わせ。表に穴が多いなら、その掛け合わせは
    // 見ても仕方がない、と分かる。
    const empty = rows.length * cols.length - cells.filter((c) => c.count > 0).length
    const max = top.count
    return { top, empty, max }
  }, [cells, rows.length, cols.length])

  // 合計は延べ人数。1人が複数のタグを持つと、その人は行ごとに数えられる。
  const rowTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cells) m.set(c.rowKey, (m.get(c.rowKey) ?? 0) + c.count)
    return m
  }, [cells])
  const colTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cells) m.set(c.columnKey, (m.get(c.columnKey) ?? 0) + c.count)
    return m
  }, [cells])
  const grandTotal = useMemo(() => cells.reduce((sum, c) => sum + c.count, 0), [cells])

  /**
   * 表から機械的に読めることだけを出す。
   *
   * 設計は「犬向けの食事案内が要りそうです」のような提案まで書いているが、
   * それは商品や運用を知らないと書けない。ここで作り話をすると、根拠の無い
   * 提案が数字と同じ重みで並ぶ。割合の事実だけに留める。
   */
  const readings = useMemo(() => {
    if (!summary || cells.length === 0) return []
    const out: string[] = []
    const topRowTotal = rowTotals.get(summary.top.rowKey) ?? 0
    if (topRowTotal > 0) {
      const pct = Math.round((summary.top.count / topRowTotal) * 100)
      out.push(`「${summary.top.row}」の ${pct}% が「${summary.top.col}」です`)
      // 同じ列で、ほかの行の割合と比べる。差があるほど、その掛け合わせに
      // 意味がある可能性が高い。
      const others = rows
        .filter((r) => r.key !== summary.top.rowKey)
        .map((r) => {
          const total = rowTotals.get(r.key) ?? 0
          const n = lookup.get(`${r.key}\u0000${summary.top.columnKey}`) ?? 0
          return { row: r.label, pct: total > 0 ? (n / total) * 100 : 0 }
        })
        .sort((a, b) => b.pct - a.pct)
      if (others.length > 0 && others[0].pct > 0) {
        out.push(
          `同じ「${summary.top.col}」でも、「${others[0].row}」は ${Math.round(others[0].pct)}% です`,
        )
      }
    }
    if (summary.empty > 0) {
      out.push(`${summary.empty}個のマスに該当者がいません。掛け合わせが細かすぎるかもしれません`)
    }
    return out
  }, [summary, cells.length, rowTotals, rows, lookup])

  const exportCross = () => {
    if (!crossResult) return
    downloadCsv('analytics-cross.csv', [
      [`${rowLabel} ＼ ${fieldName}`, ...cols.map((column) => column.label), '合計'],
      ...rows.map((row) => [
        row.label,
        ...cols.map((column) => lookup.get(`${row.key}\u0000${column.key}`) ?? 0),
        rowTotals.get(row.key) ?? 0,
      ]),
      ['合計', ...cols.map((column) => colTotals.get(column.key) ?? 0), grandTotal],
    ])
  }

  if (fieldsLoading) {
    return (
      <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm" role="status">
        友だち情報欄を読み込んでいます
      </p>
    )
  }

  if (fieldsError) {
    // ★V7 `x63W5x`：ピンクの箱ではなく、一覧の場所の ListState error だけ出す。
    return (
      <ListState
        kind="error"
        title="友だち情報欄を読み込めませんでした。"
        description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。"
        onRetry={() => setFieldsReload((n) => n + 1)}
      />
    )
  }

  if (fields.length === 0) {
    return (
      <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
        友だち情報欄の項目がまだありません。
        <Link href="/tags/fields/new" className="text-action ml-1 hover:underline">
          項目を追加
        </Link>
      </p>
    )
  }

  return (
    <div data-design-node="f5HsX" className="space-y-4">
      <div className="flex justify-end"><AnalyticsExportButton onClick={exportCross} disabled={!crossResult} /></div>
      <AnalyticsNotice>数えているのは、こちらで観測できたことだけです。LINEで開かれたかどうかは取れないため、この画面には出しません。</AnalyticsNotice>
      <p className="text-sm text-ink-secondary">タグや友だち情報を掛け合わせて、友だちの人数やイベントの回数を表にします。数字を押すとその人たちを抽出でき、そのまま配信できます。</p>

      <section className="bg-canvas rounded-card border-hairline border p-4">
        <h3 className="text-ink mb-3 text-sm font-semibold">何を掛け合わせるか</h3>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label className="text-ink-secondary mb-1 block text-xs font-medium">たての軸</label>
            <Select aria-label="たての軸" value={rowKind} onChange={(value) => setRowKind(value as typeof rowKind)} options={[{ value: "tag", label: "タグ" }, { value: "route", label: "流入経路" }, { value: "score_band", label: "スコア帯" }, { value: "conversion_point", label: "成果地点" }, { value: "booking_status", label: "予約状態" }, { value: "purchase_status", label: "購入状態" }]} className="v6-select w-full" size="full" />
          </div>
          <div>
            <label htmlFor="cross-field" className="text-ink-secondary mb-1 block text-xs font-medium">
              よこの軸
            </label>
            <Select
              id="cross-field"
              value={fieldId}
              onChange={(value) => setFieldId(value)}
              aria-label="よこの軸"
              className="v6-select w-full"
              size="full"
              options={fields.map((field) => ({
                value: field.id,
                label: `友だち情報 / ${field.name}`,
              }))}
            />
          </div>
          <Button onClick={() => void runCross()} disabled={loading || !crossStorageRestored || !fieldId || Boolean(crossRunId)} variant="primary" busy={loading} busyLabel="集計中">
            {`この${crossDays}日を集計`}
          </Button>
        </div>
        <dl className="mt-3 grid gap-3 border-t border-hairline pt-3 sm:grid-cols-2">
          <div>
            <dt className="mb-1 text-xs font-medium text-ink-secondary"><label htmlFor="cross-measure">数えるもの</label></dt>
            <dd className="grid gap-1">
              <Select
                id="cross-measure"
                value={measureKind}
                onChange={(value) => setMeasureKind(value as 'unique_friends' | 'events')}
                aria-label="数えるもの"
                className="v6-select w-full"
                size="full"
                options={[
                  { value: 'unique_friends', label: '友だちの人数（重複なし）' },
                  { value: 'events', label: 'イベントの回数' },
                ]}
              />
              {measureKind === 'events' && (
                <Select
                  id="cross-measure-event"
                  value={measureEventType}
                  onChange={(value) => setMeasureEventType(value)}
                  aria-label="数えるイベント"
                  className="v6-select w-full"
                  size="full"
                  options={CROSS_MEASURE_EVENT_OPTIONS}
                />
              )}
            </dd>
          </div>
          <div><dt className="mb-1 text-xs font-medium text-ink-secondary">期間</dt><dd><RangePicker days={crossDays} onChange={setCrossDays} /></dd></div>
        </dl>
        <p className="text-ink-faint mt-2 text-xs">
          集計結果はその時点のデータで固定します。期間や軸を変えた場合は、新しい結果として集計します。
        </p>
        <p className="mt-1 text-xs text-ink-faint">追加条件を最大15個指定するには、クロス分析APIの追加条件の接続が必要です。</p>
        {error && <p className="text-danger mt-2 text-xs">{error}</p>}
        {crossResult?.stateReason && <p className="text-warning mt-2 text-xs">{crossResult.stateReason}</p>}
      </section>

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* 表の合計は延べ人数で、実際の人数とは違う。人数として出すと嘘になる。 */}
        <KpiCard title="集計対象" value={null} unit="人" detail="" help="表の合計は延べ人数です。実際の人数とは違います" />
        <KpiCard
          title="いちばん多い組み合わせ"
          value={summary?.top.count ?? null}
          unit={measureKind === 'events' ? '回' : '人'}
          detail={summary ? `${summary.top.row} × ${summary.top.col}` : '—'}
          loading={loading}
        />
        <KpiCard
          title="空のマス"
          value={summary?.empty ?? null}
          unit="個"
          detail="該当者なし"
          loading={loading}
        />
        {/* その項目に値が入っていない人は、集計のSQLが数えていない。板 `u5CuB8` の書き方。 */}
        <KpiCard title="未入力" value={null} unit="人" detail="タグがまだ無い人（表に出ない）" />
      </div>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline border p-8 text-center text-sm" role="status">
          <p className="text-ink font-medium">{restoredCrossRun ? '進行中の集計を確認しています。' : '集計を受け付けました。終わるまでこの画面で確認しています。'}</p>
          <p className="text-ink-secondary mt-2">
            現在の状態: {crossQueue?.state === 'running' ? '処理中です' : 'このLINEアカウント内で待ち順に並んでいます'}
          </p>
          {crossQueue?.queuePosition != null && (
            <p className="text-ink-secondary mt-1">
              このLINEアカウント内の順番は{crossQueue.queuePosition}番目です
              {crossQueue.pendingAhead === 0 ? '（このアカウントであなたの前にはありません）' : `（このアカウントであなたの前に${crossQueue.pendingAhead}件あります）`}
            </p>
          )}
          {crossQueue?.estimatedWaitMs != null && crossQueue.estimatedWaitMs > 0 && (
            <p className="text-ink-secondary mt-1">
              最短で約{formatCrossWaitMinutes(crossQueue.estimatedWaitMs)}分です。他の処理状況により延びることがあります
              {crossQueue.nextTickAt && formatCrossNextTick(crossQueue.nextTickAt)
                ? `（次回処理は${formatCrossNextTick(crossQueue.nextTickAt)}ごろ）`
                : ''}
            </p>
          )}
          <p className="text-ink-faint mt-2 text-xs">同じ分析をもう一度押す必要はありません。このままお待ちください。</p>
          <p className="text-ink-faint mt-1 text-xs">結果が出た後はこの画面で確認でき、失敗・時間切れのときも集計し直せます。</p>
        </div>
      ) : !crossResult && crossAutoStopped && crossRunId ? (
        <div className="bg-canvas rounded-card border-hairline border p-8 text-center text-sm" role="status">
          <p className="text-ink font-medium">自動の確認を止めました。集計はこのまま続いています。</p>
          {crossQueue?.queuePosition != null && (
            <p className="text-ink-secondary mt-1">
              このLINEアカウント内の順番は{crossQueue.queuePosition}番目です
            </p>
          )}
          <p className="text-ink-secondary mt-1">
            「結果をもう一度確認」を押すと同じ集計の続きを確認できます。もう一度集計を送り直す必要はありません。
          </p>
          <div className="mt-3 flex justify-center">
            <Button onClick={() => recheckCross()} variant="primary">結果をもう一度確認</Button>
          </div>
          <p className="text-ink-faint mt-2 text-xs">結果が出た後はこの画面で確認でき、失敗のときも集計し直せます。</p>
        </div>
      ) : !crossResult ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          たて・よこの軸を選び、「この{crossDays}日を集計」を押してください。
        </div>
      ) : cells.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          {crossResult.state === 'unavailable'
            ? crossResult.stateReason || '未取得'
            : 'この条件に該当する人はいません。'}
        </div>
      ) : (
        <>
          <div data-design="Table" className="bg-canvas rounded-card border-hairline overflow-hidden border">
            <table className="w-full table-fixed">
              <thead>
                <tr className="bg-canvas-sunken border-hairline border-b">
                  <Th className="text-micro px-4 py-3 font-semibold whitespace-normal">
                    {rowLabel} ＼ {fieldName}
                  </Th>
                  {cols.map((col) => (
                    <Th align="right" className="text-micro px-4 py-3 font-semibold whitespace-normal" key={col.key}>
                      {col.label}
                    </Th>
                  ))}
                  <Th align="right" className="text-micro px-4 py-3 font-semibold whitespace-normal">合計</Th>
                </tr>
              </thead>
              <tbody className="divide-hairline divide-y">
                {rows.map((row) => (
                  <tr key={row.key} className="hover:bg-canvas-sunken">
                    <td className="text-ink text-caption px-4 py-3 font-semibold">{row.label}</td>
                    {cols.map((col) => {
                      const n = lookup.get(`${row.key}\u0000${col.key}`) ?? 0
                      const active = picked?.rowKey === row.key && picked?.columnKey === col.key
                      // 濃さはその表の最大を基準にする。表ごとに数の桁が違うので、
                      // 絶対値で色を決めると、少ない表が全部薄くなる。
                      const strength = summary && summary.max > 0 ? n / summary.max : 0
                      return (
                        <td key={col.key} className="p-0 text-right">
                          <button
                            onClick={() => {
                              const source = cells.find((cell) => cell.rowKey === row.key && cell.columnKey === col.key)
                              setAudience(null)
                              setPicked(n > 0 && source ? {
                                row: row.label,
                                col: col.label,
                                rowKey: source.rowKey,
                                columnKey: source.columnKey,
                                count: n,
                                uniqueFriends: source.uniqueFriends,
                              } : null)
                            }}
                            disabled={n === 0}
                            className={`text-caption w-full px-4 py-3 text-right font-semibold tabular-nums transition-colors ${
                              n === 0 ? 'text-ink-faint' : 'text-ink-secondary hover:bg-accent-soft'
                            } ${active ? 'ring-accent ring-2 ring-inset' : ''}`}
                            style={
                              n > 0
                                ? { backgroundColor: `color-mix(in srgb, var(--color-action) ${Math.round((0.04 + strength * 0.18) * 100)}%, transparent)` }
                                : undefined
                            }
                          >
                            {n === 0 ? '—' : formatNumber(n)}
                          </button>
                        </td>
                      )
                    })}
                    <td className="text-ink text-caption px-4 py-3 text-right font-medium tabular-nums">
                      {formatNumber((rowTotals.get(row.key) ?? 0))}
                    </td>
                  </tr>
                ))}
                <tr className="bg-canvas-sunken">
                  <td className="text-ink-secondary text-caption px-4 py-3 font-medium">合計</td>
                  {cols.map((col) => (
                    <td key={col.key} className="text-ink-secondary text-caption px-4 py-3 text-right tabular-nums">
                      {formatNumber((colTotals.get(col.key) ?? 0))}
                    </td>
                  ))}
                  <td className="text-ink text-caption px-4 py-3 text-right font-semibold tabular-nums">
                    {formatNumber(grandTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* 表・この人数・対象者づくりがすべて同じ集計結果(runId)を見ている
              ことを、期間と締切で確かめられるようにする。 */}
          <div className="mt-1 flex justify-end">
            <AnalyticsPeriodCaption
              from={crossResult.periodFrom}
              to={crossResult.periodTo}
              cutoffAt={crossResult.dataCutoffAt}
            />
          </div>

          {canManage ? (
            <div className="bg-canvas rounded-card border-hairline mt-3 border p-4">
              <SaveAnalysisAction
                accountId={accountId}
                sourceKind="cross"
                sourceResultId={crossResultId}
                defaultName={`クロス分析 ${rowLabel} × ${fieldName}`}
              />
            </div>
          ) : (
            <p className="text-ink-faint mt-3 text-xs">結果の保存と個人一覧への移動は、統括・管理者だけが行えます。</p>
          )}

          <div className="bg-canvas rounded-card border-hairline mt-3 border p-4">
            {picked ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-ink text-sm">
                    「{picked.row} × {picked.col}」の {measureKind === 'events' ? `${picked.count}回（${picked.uniqueFriends}人）` : `${picked.count}人`} を選択中
                  </p>
                  {canManage && <Button onClick={() => void prepareCrossAudience()} variant="secondary">友だち一覧で見る</Button>}
                </div>
                {audience && (
                  <Notice tone="success">
                    {audience.memberCount}人を24時間の対象者として準備しました
                    {' '}
                    <Link href={`/friends?audienceId=${encodeURIComponent(audience.id)}`} className="font-medium text-action hover:underline">対象者を開く</Link>{' '}
                    <Link href={`/broadcasts/new?audienceId=${encodeURIComponent(audience.id)}`} className="font-medium text-action hover:underline">この対象者へ配信を作成</Link>
                  </Notice>
                )}
              </div>
            ) : (
              <p className="text-ink-faint text-xs">マスを押すと、その人たちを抽出できます</p>
            )}
          </div>

          {readings.length > 0 && (
            <section className="bg-canvas rounded-card border-hairline mt-3 border p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-ink text-sm font-semibold">この表から読めること</h3>
              </div>
              <ul className="text-ink-secondary mt-2 space-y-1.5 text-xs leading-relaxed">
                {readings.map((r) => (
                  <li key={r}>・{r}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="bg-canvas rounded-card border-hairline mt-3 border p-4">
            <h3 className="text-ink text-sm font-semibold">見かたの注意</h3>
            <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
              <li>
                ・1人が複数のタグを持つ場合、それぞれの行に数えられます。合計が友だち数と一致しないことがあります
              </li>
              <li>・「未記録」は、その項目にまだ値が入っていない人です。いまは表に出ません</li>
              <li>・マスの色は、その表の中でいちばん多い数を基準にした濃さです</li>
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

function FunnelTab({ accountId, canManage, presetConversion }: {
  accountId: string
  canManage: boolean
  /*
   * N-256: 「使う場所を足す」から渡された成果地点。指定があれば新規作成を
   * 開き、その地点を「成果」段へ入れた状態にする。IDは実IDなので、
   * 保存すればそのまま参照として使える。
   */
  presetConversion?: { id: string; name: string } | null
}) {
  const [funnels, setFunnels] = useState<
    Array<{
      id: string
      name: string
      windowDays: number
      createdAt: string
      status: 'active' | 'stopped' | 'archived'
      currentVersion: { id: string; versionNumber: number; createdAt: string } | null
      migrationState: 'ready' | 'needs_migration'
    }>
  >([])
  const [selected, setSelected] = useState('')
  const [run, setRun] = useState<AnalyticsFunnelRunResult | null>(null)
  const [groupKey, setGroupKey] = useState('all')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  // まだ1度も集計していない状態。壊れているのか未集計なのか分ける(点検#508軽13)。
  const [noRun, setNoRun] = useState(false)
  // 一覧の取得失敗は空表示と分ける。失敗したまま「まだありません」と出すと、
  // あるものを無いと勘違いして作り直す(点検#508の中3)。
  const [listError, setListError] = useState('')
  // 一覧・最新結果の取り直し用。読み直しだけで条件は変えない。
  const [funnelsReload, setFunnelsReload] = useState(0)
  const [runReload, setRunReload] = useState(0)
  const [creating, setCreating] = useState(false)
  // N-256: 成果地点一覧からの受け渡し。作れる権限があるときだけ作成を開く。
  useEffect(() => {
    if (presetConversion?.id && canManage) setCreating(true)
  }, [presetConversion?.id, canManage])
  const [picked, setPicked] = useState<number | null>(null)
  // CONVERSION-05: 作成はできたが成果地点への利用先記録だけ失敗したとき、
  // 静かに成功に見せず、記せなかった地点名を出す。
  const [usageNotice, setUsageNotice] = useState('')
  const [funnelDays, setFunnelDays] = useState(30)
  const [audienceSelection, setAudienceSelection] = useState<'reached' | 'stopped' | 'in_progress'>('stopped')
  const [funnelAudience, setFunnelAudience] = useState<{ id: string; memberCount: number; expiresAt: string } | null>(null)
  // アカウント・ファネル・期間を切り替えた瞬間に世代を進める。effectのcleanupを
  // 待つだけでは、切替直後に返った古い「再集計」や対象者作成の応答を表示できてしまう。
  const viewGeneration = useRef(0)
  const scope = `${accountId}:${selected}:${funnelDays}`
  const scopeRef = useRef(scope)
  if (scopeRef.current !== scope) {
    scopeRef.current = scope
    viewGeneration.current += 1
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    setListError('')
    setFunnels([])
    setSelected('')
    setRun(null)
    setGroupKey('all')
    setPicked(null)
    setFunnelAudience(null)
    void api.analytics.v6Funnels
      .list(accountId, { includeInactive: true })
      .then((res) => {
        if (!active) return
        if (res.success) {
          setFunnels(res.data)
          // 停止・保管したものは選ばせない。最初の利用可能なファネルを開く。
          const firstActive = res.data.find((f) => f.status === 'active')
          if (firstActive) setSelected(firstActive.id)
        } else {
          setListError(res.error || 'ファネルを読み込めませんでした')
        }
      })
      .catch(() => {
        if (active) setListError('ファネルを読み込めませんでした')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [accountId, funnelsReload])

  useEffect(() => {
    if (!selected) return
    let active = true
    setPicked(null)
    setFunnelAudience(null)
    setRun(null)
    setRunError('')
    setNoRun(false)
    setRunning(false)
    void api.analytics.v6Funnels.latestRun(accountId, selected).then((res) => {
      if (!active) return
      if (res.success) {
        setRun(res.data)
        setGroupKey(res.data.groups[0]?.key ?? 'all')
      }
      else if (res.error === 'Not found') setNoRun(true)
      else setRunError(res.error)
    })
    return () => {
      active = false
    }
  }, [accountId, selected, runReload])

  // 条件切替後は、前の世代のfinallyに表示状態を任せない。前の通信が後から
  // 終わっても新しい条件で再集計できるよう、現世代のボタンを必ず戻す。
  useEffect(() => {
    setRunning(false)
  }, [accountId, selected, funnelDays])

  const runNow = async () => {
    if (!selected) return
    const generation = viewGeneration.current
    setRunning(true)
    setRunError('')
    const { cohortFrom, cohortTo } = funnelCohortRange(funnelDays)
    try {
      const response = await api.analytics.v6Funnels.run(accountId, selected, {
        cohortFrom,
        cohortTo,
      })
      if (!response.success) throw new Error(response.error)
      if (generation !== viewGeneration.current) return
      setRun(response.data)
      setGroupKey(response.data.groups[0]?.key ?? 'all')
    } catch (error) {
      if (generation !== viewGeneration.current) return
      const code = error instanceof Error ? error.message : ''
      setRunError(explainStartError(code, code || '再集計できませんでした'))
    } finally {
      if (generation === viewGeneration.current) setRunning(false)
    }
  }

  const reloadFunnels = async (pickId?: string) => {
    const res = await api.analytics.v6Funnels.list(accountId, { includeInactive: true })
    if (!res.success) return
    setFunnels(res.data)
    if (pickId !== undefined) {
      setSelected(pickId)
      return
    }
    setSelected((prev) => {
      const still = res.data.find((f) => f.id === prev)
      if (still && still.status === 'active') return prev
      return res.data.find((f) => f.status === 'active')?.id ?? ''
    })
  }

  // 定義の編集は「現在版を下書きへ読み、新版として保存」。過去の版と結果は変えない。
  const [editTarget, setEditTarget] = useState<{
    funnelId: string
    name: string
    windowDays: string
    steps: Array<{ label: string; kind: string; value: string; match: Record<string, string> }>
    segment: unknown
    comparisonGroups: unknown[]
    expectedVersionNumber: number
  } | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const startEdit = async () => {
    if (!selected) return
    setEditLoading(true)
    setRunError('')
    try {
      const res = await api.analytics.v6Funnels.get(accountId, selected)
      if (!res.success) {
        setRunError(res.error || '定義を読み込めませんでした')
        return
      }
      if (!res.data.currentVersion) {
        setRunError('このファネルは旧形式のため編集できません。新しい段を組んで作り直してください')
        return
      }
      const version = res.data.currentVersion
      setEditTarget({
        funnelId: res.data.id,
        name: res.data.name,
        windowDays: String(version.windowDays),
        steps: version.steps.map((step) => ({
          label: step.label,
          kind: step.kind,
          value: funnelStepFormValue(step.kind, step.match),
          match: step.match,
        })),
        segment: version.segment,
        comparisonGroups: version.comparisonGroups,
        expectedVersionNumber: version.versionNumber,
      })
    } catch {
      setRunError('定義を読み込めませんでした')
    } finally {
      setEditLoading(false)
    }
  }

  // 停止は再開できる。保管は終端で、一覧と再集計から外れて戻せない。
  const [statusTarget, setStatusTarget] = useState<{
    funnel: { id: string; name: string; status: 'active' | 'stopped' | 'archived' }
    to: 'stopped' | 'archived' | 'active'
  } | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const applyStatusChange = async () => {
    if (!statusTarget || statusBusy) return
    setStatusBusy(true)
    setRunError('')
    try {
      const res = await api.analytics.v6Funnels.setStatus(accountId, statusTarget.funnel.id, {
        status: statusTarget.to,
        expectedStatus: statusTarget.funnel.status,
      })
      if (!res.success) {
        setRunError(explainStartError(res.error, '状態を変えられませんでした'))
        return
      }
      setStatusTarget(null)
      await reloadFunnels()
    } catch {
      setRunError('状態を変えられませんでした')
    } finally {
      setStatusBusy(false)
    }
  }

  const activeGroup = run?.groups.find((group) => group.key === groupKey) ?? run?.groups[0] ?? null
  const result = activeGroup?.steps ?? null
  /*
   * ANALYTICS-04: 集計が「未取得・失敗」の結果では人数を出さない。
   * 全部取れなかった数字を並べると「離脱100%」のような結論に読める。
   * 一部だけ取れた（partial）は断りを添えて出す。
   */
  const measurable = !!run && (run.state === 'available' || run.state === 'partial')

  const comparisonGap = useMemo(() => {
    if (!measurable || !run || run.groups.length < 2) return null
    let largest = 0
    for (let index = 0; index < run.groups[0].steps.length; index += 1) {
      const rates = run.groups
        .map((group) => group.steps[index]?.conversionFromPrevious)
        .filter((value): value is number => value !== null && value !== undefined)
      if (rates.length < 2) continue
      largest = Math.max(largest, Math.max(...rates) - Math.min(...rates))
    }
    return Math.round(largest * 1000) / 10
  }, [measurable, run])

  const prepareFunnelAudience = async () => {
    if (!run?.runId || picked === null || !result?.[picked] || !activeGroup) return
    if (selectedFunnel?.status !== 'active') return
    const generation = viewGeneration.current
    setRunError('')
    try {
      const response = await api.analytics.createResultAudience(accountId, run.runId, {
        sourceKind: 'funnel',
        groupKey: activeGroup.key,
        stepOrder: result[picked].stepOrder,
        selection: audienceSelection,
      })
      if (!response.success) throw new Error(response.error)
      if (generation !== viewGeneration.current) return
      setFunnelAudience(response.data)
    } catch (error) {
      if (generation !== viewGeneration.current) return
      setRunError(explainStartError(
        error instanceof Error ? error.message : '',
        '対象者を準備できませんでした',
      ))
    }
  }

  // いちばん落ちる段。人数の差ではなく、落ちた割合で選ぶ。母数の大きい段が
  // いつも1位になってしまうため。まだ途中の人は「落ちた」に入れない。
  const worst = useMemo(() => {
    if (!measurable || !result || result.length < 2) return null
    let found: { index: number; lost: number; rate: number } | null = null
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1]
      if (prev.reached === 0) continue
      const lost = prev.droppedAfter
      const rate = lost / prev.reached
      if (!found || rate > found.rate) found = { index: i, lost, rate }
    }
    return found
  }, [measurable, result])

  const overall = useMemo(() => {
    if (!measurable || !result || result.length === 0) return null
    const first = result[0]
    const last = result[result.length - 1]
    return {
      entry: first.reached,
      entryLabel: first.label,
      last: last.reached,
      rate: first.reached > 0 ? Math.round((last.reached / first.reached) * 1000) / 10 : null,
    }
  }, [measurable, result])

  // ★V7 `x63W5x`：素の「読み込み中...」ではなく ListState loading で出す。
  if (loading) {
    return (
      <ListState kind="loading" title="ファネルを読み込んでいます" />
    )
  }

  const top = measurable ? (result?.[0]?.reached ?? 0) : 0
  const selectedFunnel = funnels.find((f) => f.id === selected) ?? null
  const inactiveFunnels = funnels.filter((f) => f.status !== 'active')
  const exportFunnel = () => {
    if (!result) return
    downloadCsv('analytics-funnel.csv', [
      // 判定不能・一部取得のCSVでも、画面と同じ「数えられる/いない」を守る。
      // 状態と集計時の定義版を先頭行に書き、数字の列は画面と同じ値にする。
      ...(run && run.state !== 'available'
        ? [['集計状態', `${SAVED_STATE_LABELS[run.state]}${run.stateReason ? `（${run.stateReason}）` : ''}`]]
        : []),
      ...(run?.versionNumber != null ? [['集計した定義版', `${run.versionNumber}`]] : []),
      ['段', '到達した人', '前の段からの通過率', 'ここで止まった人', 'まだ途中の人'],
      ...result.map((step) => measurable ? [
        step.label,
        step.reached,
        step.conversionFromPrevious === null ? null : `${Math.round(step.conversionFromPrevious * 1000) / 10}%`,
        step.droppedAfter,
        step.inProgressAfter,
      ] : [step.label, null, null, null, null]),
    ])
  }

  return (
    <div data-design-node="DkRDE" className="flex flex-col gap-4 v8-ro-analytics-funnel">
      <AnalyticsExportButton headerOnly onClick={exportFunnel} disabled={!result} />


      {!creating && !editTarget && funnels.length > 0 && (
          <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title="入口"
              value={overall?.entry ?? null}
              unit="人"
              detail={measurable ? (overall?.entryLabel ?? '—') : run ? '判定不能' : '—'}
            />
            <KpiCard
              title="最後まで"
              value={overall?.last ?? null}
              unit="人"
              detail={measurable
                ? (overall?.rate != null ? `通過率 ${overall.rate}%` : '—')
                : run ? '判定不能' : '—'}
            />
            <KpiCard
              title="いちばん落ちる段"
              value={worst ? -Math.round(worst.rate * 100) : null}
              unit="%"
              detail={
                worst && result
                  ? `${result[worst.index - 1].label} → ${result[worst.index].label}`
                  : run && !measurable ? '判定不能' : '—'
              }
            />
            {/* 段ごとの到達日時を持っていない。ファネルの集計は「通ったか」
                だけを見ていて、いつ通ったかを残していない。 */}
            <KpiCard title="平均の到達日数" value={null} unit="日" detail="未取得" description="段に到達した日時が集計結果にないため、平均の日数は未取得です" />

          </div>
      )}
      {creating || editTarget ? (
        <FunnelForm
          accountId={accountId}
          edit={editTarget ?? undefined}
          presetConversion={editTarget ? null : presetConversion}
          onCancel={() => {
            setCreating(false)
            setEditTarget(null)
          }}
          onCreated={(id, usageWarnings) => {
            setCreating(false)
            setEditTarget(null)
            setUsageNotice(usageWarnings && usageWarnings.length > 0
              ? `作成はできましたが、成果地点への利用先記録に失敗しました：${usageWarnings.join('、')}。成果地点側の利用先一覧には出ていません。`
              : '')
            void reloadFunnels(id)
          }}
        />
      ) : listError ? (
        // ★V7 `x63W5x`：ピンクの箱ではなく、一覧の場所の ListState error だけ出す。
        <ListState
          kind="error"
          title="ファネルを読み込めませんでした。"
          description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。"
          onRetry={() => setFunnelsReload((n) => n + 1)}
        />
      ) : funnels.length === 0 ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          ファネルがまだありません。段を2つ以上つないで、どこで離れているかを見られます。
          {canManage ? (
            <button
              onClick={() => setCreating(true)}
              className="text-action ml-1 hover:underline"
            >
              ＋ 段を足す
            </button>
          ) : (
            <span className="ml-1">作成は統括・管理者へ依頼してください。</span>
          )}
        </p>
      ) : (
        <>
          <section className="v8-ro-analytics-funnelControls">
            <div className="v8-ro-analytics-funnelControlActions">
              <div className="flex flex-wrap gap-2">
                {canManage && (
                  <Button variant="secondary" className="text-ink-secondary text-label px-3 py-1.5 font-semibold h-auto whitespace-normal" onClick={() => setCreating(true)}>
                    ファネルを作る
                  </Button>
                )}
                <Button variant="secondary" disabled={running} onClick={() => setRunReload((n) => n + 1)}>最新の結果をもう一度読む</Button>
              </div>
            </div>

            <div className="v8-ro-analytics-funnelSelectRow"><div>
              <label htmlFor="funnel-select" className="text-ink-secondary mb-1 block text-xs font-medium">
                ファネル
              </label>
              <Select
                id="funnel-select"
                value={selected}
                onChange={(value) => setSelected(value)}
                aria-label="ファネル"
                size="full"
                options={
                  funnels.some((funnel) => funnel.status === 'active' || funnel.id === selected)
                    ? funnels
                        .filter((funnel) => funnel.status === 'active' || funnel.id === selected)
                        .map((funnel) => ({
                          value: funnel.id,
                          label: funnel.status === 'active'
                            ? funnel.name
                            : `${funnel.name}（${funnel.status === 'stopped' ? '停止中' : '保管済み'}）`,
                        }))
                    : [{ value: '', label: '使えるファネルがありません' }]
                }
              />
</div><div><label className="mb-1 block text-xs font-medium">何日以内の通過で数えるか</label><Select aria-label="何日以内の通過で数えるか" disabled onChange={() => {}} value={String(selectedFunnel?.windowDays ?? '')} options={[{ value: String(selectedFunnel?.windowDays ?? ''), label: selectedFunnel ? `${selectedFunnel.windowDays}日以内` : '未取得' }]} /></div>            {run && (
              <div className="min-w-0">
                <label htmlFor="funnel-group" className="text-ink-secondary mb-1 block text-xs font-medium">比較する条件</label>
                <Select
                  id="funnel-group"
                  value={groupKey}
                  onChange={(value) => { setGroupKey(value); setPicked(null); setFunnelAudience(null) }}
                  aria-label="比較する条件"
                  className="v6-select w-full"
                  size="full"
                  options={run.groups.map((group) => ({
                    value: group.key,
                    label: `${group.label}（入口 ${group.entrants}人）`,
                  }))}
                />
              </div>
            )}
</div>
            <Disclosure title="定義の操作と集計の詳細" size="compact">
              <p className="mb-2 text-xs">集計対象の期間</p><div className="flex flex-wrap gap-2">                <RangePicker
                  days={funnelDays}
                  onChange={(days) => {
                    setFunnelDays(days)
                    setPicked(null)
                    setFunnelAudience(null)
                    setRunning(false)
                  }}
                />
                <Button
                  onClick={() => void runNow()}
                  disabled={running || selectedFunnel?.status !== 'active'}
                  variant="secondary" busy={running} busyLabel="再集計中">
                  {`この${funnelDays}日を再集計`}
                </Button>
</div>

              {selectedFunnel && (
                <p className="text-ink-faint mt-1 text-xs">
                  {selectedFunnel.windowDays}日以内に通った人を数えます。
                  {selectedFunnel.currentVersion
                    ? ` 定義版 ${selectedFunnel.currentVersion.versionNumber}`
                    : ' 現行定義の移行が必要です'}
                  {selectedFunnel.status === 'stopped' && ' 停止中です。再集計や対象者づくりはできません。'}
                  {selectedFunnel.status === 'archived' && ' 保管済みです。過去の結果だけを見られます。'}
                </p>
              )}
              {canManage && selectedFunnel && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedFunnel.status === 'active' && (
                    <>
                      <Button
                        onClick={() => void startEdit()}
                        disabled={editLoading || !selectedFunnel.currentVersion}
                        variant="secondary" busy={editLoading} busyLabel="定義を読み込み中">定義を編集
                      </Button>
                      <Button
                        onClick={() => setStatusTarget({ funnel: selectedFunnel, to: 'stopped' })}
                        variant="secondary"
                      >
                        停止
                      </Button>
                      <Button
                        onClick={() => setStatusTarget({ funnel: selectedFunnel, to: 'archived' })}
                        variant="secondary"
                      >
                        保管
                      </Button>
                    </>
                  )}
                  {selectedFunnel.status === 'stopped' && (
                    <>
                      <Button
                        onClick={() => setStatusTarget({ funnel: selectedFunnel, to: 'active' })}
                        variant="secondary"
                      >
                        再開
                      </Button>
                      <Button
                        onClick={() => setStatusTarget({ funnel: selectedFunnel, to: 'archived' })}
                        variant="secondary"
                      >
                        保管
                      </Button>
                    </>
                  )}
                </div>
              )}
            </Disclosure>

            {/* 条件ごとに通過率を並べる仕組みが無い。ファネルの定義が1本の
                段の列だけで、条件で分ける口を持っていない。 */}
            {run && <p className="text-ink-faint mt-2 text-xs">
              集計期間 {formatAnalyticsDate(run.cohortFrom)}〜{formatAnalyticsDate(run.cohortTo)}
              ／データ締切 {formatAnalyticsDateTime(run.dataCutoffAt)}
              {run.versionNumber != null ? `／集計した定義版 ${run.versionNumber}` : ''}
            </p>}
            {/* ANALYTICS-06: 「定義版」はいまの定義、結果は集計時の版の写し。
                ずれているときは旧版の結果だと断り、再集計へ誘導する。 */}
            {run && selectedFunnel?.currentVersion && run.versionNumber != null
              && run.versionNumber !== selectedFunnel.currentVersion.versionNumber && (
              <p className="text-warning mt-2 text-xs font-semibold" role="status">
                この結果は定義版{run.versionNumber}で集計したものです。いまの定義は版{selectedFunnel.currentVersion.versionNumber}です。
                「この{funnelDays}日を再集計」で、いまの定義の結果に更新できます。
              </p>
            )}
            {runError && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-danger text-xs">{runError}</p>
                {/* 最新結果の読み取りに失敗しただけなら、再集計せず読み直せる */}

              </div>
            )}
            {noRun && !run && <p className="text-ink-faint mt-2 text-xs">まだ集計がありません。「この{funnelDays}日を再集計」を押してください</p>}
            {usageNotice && <p className="text-warning mt-2 text-xs" role="status">{usageNotice}</p>}
            {/* ANALYTICS-04: 未取得・失敗は「判定不能」と言い、部分取得は
                理由を添えて出す。どちらも人数を実測値とは言わない。 */}
            {run && !measurable && (
              <p className="text-warning mt-2 text-xs font-semibold" role="status">
                {SAVED_STATE_LABELS[run.state]}のため、この結果は判定不能です。人数や割合は実測値ではありません。
                {run.stateReason ? ` ${run.stateReason}` : ''}
              </p>
            )}
            {run && run.state === 'partial' && (
              <p className="text-warning mt-2 text-xs">
                {run.stateReason ?? '一部の期間・種類のデータが無いため、実際より少なく数えている可能性があります。'}
              </p>
            )}

          </section>



          {result && (
            <div className="v8-ro-analytics-funnelBody"><section className="v8-ro-analytics-funnelFlow">
              <h3 className="text-ink text-sm font-semibold">全体の流れ</h3>
              <p className="text-ink-faint mt-0.5 mb-3 text-xs">
                順番どおりに通った人だけを数えます。飛ばした人は含みません。
              </p>
              <div className="v8-ro-analytics-funnelSteps">{result.map((step, i) => {
                const previous = i > 0 ? result[i - 1] : null
                const dropRate = previous && previous.reached > 0 ? previous.droppedAfter / previous.reached * 100 : null
                return <div key={step.stepOrder} className="v8-ro-analytics-funnelStep" data-worst={worst?.index === i || undefined} data-selected={picked === i || undefined}>
                  <span className="v8-ro-analytics-funnelNumber">{i + 1}</span><p className="text-ink text-caption font-medium" title={step.label}>{step.label}</p>
                  <button onClick={() => { if (!measurable) return; setFunnelAudience(null); setPicked(i) }} className="v8-ro-analytics-funnelBar" aria-label={`${step.label}の段`} aria-describedby={`funnel-step-${step.stepOrder}-value`} disabled={!measurable}><span style={{ width: top > 0 && measurable ? `${step.reached / top * 100}%` : '0%' }} /></button>
                  <p className="text-ink-secondary text-caption tabular-nums" id={`funnel-step-${step.stepOrder}-value`}>{measurable ? `${formatNumber(step.reached)} 人` : '—'}</p><span className="text-xs text-ink-faint" title={previous ? `止まった ${previous.droppedAfter}人・進行中 ${previous.inProgressAfter}人` : undefined}>{measurable && dropRate !== null ? `−${dropRate.toFixed(0)}%` : '—'}</span>
                </div>
              })}</div>
            </section><aside className="v8-ro-analytics-funnelSelected"><h3 className="text-sm font-semibold">{picked != null && result[picked] ? `${picked + 1} ${result[picked].label}（選んだ段）` : '段を選んで対象者を確認'}</h3>
              <div className="mt-3">

                {picked != null && result[picked] && measurable ? (
                  selectedFunnel?.status === 'active' ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-2">
                        <SegmentedControl aria-label="対象者の種類" value={audienceSelection} onChange={(value) => { setAudienceSelection(value); setFunnelAudience(null) }} options={[{ value: 'reached', label: '到達した人' }, { value: 'stopped', label: '止まった人' }, { value: 'in_progress', label: '進行中の人' }]} />

                        <p className="text-sm font-semibold">{audienceSelection === 'stopped' ? 'この段で止まった人' : audienceSelection === 'reached' ? '到達した人' : '進行中の人'} {formatNumber(audienceSelection === 'stopped' ? result[picked].droppedAfter : audienceSelection === 'reached' ? result[picked].reached : result[picked].inProgressAfter)}人</p>
                        <p className="text-ink text-sm">
                          {audienceSelection === 'stopped'
                            ? `「${result[picked].label}で止まった人」を選択中`
                            : audienceSelection === 'reached'
                              ? `「${result[picked].label}まで到達した人」を選択中`
                              : `「${result[picked].label}で進行中の人」を選択中`}
                        </p>
                      </div>
                      {canManage && <Button onClick={() => void prepareFunnelAudience()} variant="secondary">友だち一覧で見る</Button>}
                    </div>
                  ) : (
                    <p className="text-ink-faint text-xs">
                      停止中・保管したファネルでは対象者づくりはできません。結果の確認だけができます。
                    </p>
                  )
                ) : (
                  <p className="text-ink-faint text-xs">
                    {run && !measurable
                      ? 'この結果は判定不能のため、対象者は選べません。'
                      : '段を押すと、到達・停止・進行中の人を選べます。'}
                  </p>
                )}
                {funnelAudience && (
                  <Notice tone="success" className="mt-3">
                    {funnelAudience.memberCount}人を24時間の対象者として準備しました
                    {' '}
                    <Link href={`/friends?audienceId=${encodeURIComponent(funnelAudience.id)}`} className="font-medium text-action hover:underline">対象者を開く</Link>{' '}
                    <Link href={`/broadcasts/new?audienceId=${encodeURIComponent(funnelAudience.id)}`} className="font-medium text-action hover:underline">この対象者へ配信を作成</Link>
                  </Notice>
                )}
              </div>
              {run && run.groups.length > 1 && <section className="mt-4"><h3 className="text-sm font-semibold">比較</h3><ul className="mt-2 space-y-2 text-xs">{run.groups.map((group) => <li key={group.key} className="flex justify-between gap-2"><span>{group.label}</span><span>通過率 {measurable && group.entrants > 0 ? `${(group.completed / group.entrants * 100).toFixed(1)}%` : '—'}</span></li>)}</ul><p className="mt-2 text-xs text-ink-faint">比較で差が大きい段 {comparisonGap === null ? '—' : `${comparisonGap}pt`}</p></section>}
            </aside></div>
          )}

          {run?.runId && canManage && (
            <Disclosure title="この結果を保存する" size="compact">
              <SaveAnalysisAction
                accountId={accountId}
                sourceKind="funnel"
                sourceResultId={run.runId}
                defaultName={selectedFunnel?.name ?? 'ファネル分析'}
              />
            </Disclosure>
          )}

          <Disclosure title="段の作り方" size="compact">
            <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
              <li>・段には {FUNNEL_STEP_KIND_OPTIONS.map((item) => item.label).join('・')} を置けます</li>
              <li>・順番どおりに通った人だけを数えます。飛ばした人は含みません</li>
              <li>・比較条件を定義版に含めると、最大3群の通過率を同じ結果で比べられます</li>
              <li>・再集計すると新しい結果を作り、前の結果は書き換えません</li>
            </ul>
          </Disclosure>
        </>
      )}

      {inactiveFunnels.length > 0 && (
        <section className="bg-canvas rounded-card border-hairline mt-3 border p-4">
          <h3 className="text-ink text-sm font-semibold">停止中・保管したファネル</h3>
          <p className="text-ink-faint mt-0.5 text-xs">
            停止中は再集計と対象者づくりを止めています。保管したものは戻せません。過去の結果は残っています。
          </p>
          <ul className="mt-2 space-y-2">
            {inactiveFunnels.map((funnel) => (
              <li
                key={funnel.id}
                className="border-hairline flex flex-wrap items-center gap-2 rounded-control border px-3 py-2"
              >
                <span className="text-ink text-sm font-medium">{funnel.name}</span>
                <Chip tone={funnel.status === 'stopped' ? 'warn' : 'neutral'}>
                  {funnel.status === 'stopped' ? '停止中' : '保管済み'}
                </Chip>
                <button
                  onClick={() => setSelected(funnel.id)}
                  className="text-action text-xs font-medium hover:underline"
                >
                  結果を見る
                </button>
                {canManage && funnel.status === 'stopped' && (
                  <>
                    <Button
                      onClick={() => setStatusTarget({ funnel, to: 'active' })}
                      variant="secondary"
                    >
                      再開
                    </Button>
                    <Button
                      onClick={() => setStatusTarget({ funnel, to: 'archived' })}
                      variant="secondary"
                    >
                      保管
                    </Button>
                  </>
                )}
                {funnel.status === 'archived' && (
                  <span className="text-ink-faint text-xs">戻せません</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <AnalyticsNotice>段は上から順に見ます。同じ人が同じ段を2回通っても1回として数えます。判定できる期間は、最初の段から設定した日数です。まだ途中の人は完了した人に含めません。</AnalyticsNotice>
      <ConfirmDialog
        open={statusTarget !== null}
        title={
          statusTarget?.to === 'stopped'
            ? 'ファネルを停止しますか'
            : statusTarget?.to === 'archived'
              ? 'ファネルを保管しますか'
              : 'ファネルを再開しますか'
        }
        description={
          statusTarget?.to === 'stopped'
            ? `「${statusTarget.funnel.name}」の再集計と対象者づくりを止めます。過去の結果は残り、あとから再開できます。`
            : statusTarget?.to === 'archived'
              ? `「${statusTarget.funnel.name}」を保管すると一覧から外れ、あとから戻せません。過去の結果は残ります。`
              : statusTarget
                ? `「${statusTarget.funnel.name}」を再開します。再集計と対象者づくりがまた使えます。`
                : ''
        }
        confirmLabel={
          statusTarget?.to === 'stopped' ? '停止する'
            : statusTarget?.to === 'archived' ? '保管する' : '再開する'
        }
        destructive={statusTarget?.to === 'archived'}
        busy={statusBusy}
        onConfirm={() => void applyStatusChange()}
        onCancel={() => setStatusTarget(null)}
      />
    </div>
  )
}

// 段に置ける種類の選択肢。正本は packages/db/src/analytics-funnels.ts の
// V6_FUNNEL_STEP_KINDS（この並びと同じ種類・同じ順を保つ。契約試験が照合する）。
// 「段の作り方」の案内もこの一覧から作るので、選べる種類と説明がずれない。
const FUNNEL_STEP_KIND_OPTIONS = [
  { key: 'friend_add', label: '友だち追加', hint: '' },
  { key: 'tag', label: 'タグが付いた', hint: 'タグのID' },
  { key: 'field', label: '情報欄に値が入った', hint: '項目のID（値は問いません）' },
  { key: 'form', label: 'フォームに答えた', hint: 'フォームのID' },
  { key: 'site_event', label: 'サイトのページを見た', hint: 'パスのまとまり（例: thanks）' },
  { key: 'purchase', label: '購入が確定した', hint: '' },
  { key: 'link_click', label: 'リンクを踏んだ', hint: '計測リンクのID' },
  { key: 'conversion', label: '成果が記録された', hint: '成果地点のID' },
  { key: 'message', label: 'メッセージを受信した', hint: '' },
  { key: 'booking', label: '予約が確定した', hint: '' },
  { key: 'automation', label: 'オートメーションが動いた', hint: 'オートメーションのID' },
]

/**
 * ファネルの作成。
 *
 * 段は上から順に「次に進んだ人」を数える。作るときも上から並べる順で
 * 入れてもらう。番号を振らせると、抜けや重複を毎回確かめることになる。
 */
function FunnelForm({
  accountId,
  onCancel,
  onCreated,
  edit,
  presetConversion,
}: {
  accountId: string
  onCancel: () => void
  // CONVERSION-05: 作成自体は成功でも、段の成果地点へ利用先を記せない
  // ことがある。その名前一覧を第2引数で返し、呼び出し側が断りを出す。
  onCreated: (id: string, usageWarnings?: string[]) => void
  // 指定すると「現在版を下書きへ読んだ状態」で開き、保存は新版の追加になる。
  // 過去の版と過去の結果は書き換えない。match・segment・comparisonGroupsは
  // フォームに出せない副条件ごと元の版から受け取り、保存時にそのまま返す。
  edit?: {
    funnelId: string
    expectedVersionNumber: number
    name: string
    windowDays: string
    steps: Array<{ label: string; kind: string; value: string; match: Record<string, string> }>
    segment: unknown
    comparisonGroups: unknown[]
  }
  /*
   * N-256: 成果地点の一覧から「使う場所を足す」で飛んできたとき、
   * その地点を2段目の「成果」段へ実IDで入れておく。
   */
  presetConversion?: { id: string; name: string } | null
}) {
  const [name, setName] = useState(edit?.name ?? '')
  // 何日以内の通過で数えるか(点検#508軽11)。裏は1〜365日を受け付ける。
  const [windowDays, setWindowDays] = useState(edit?.windowDays ?? '30')
  const [steps, setSteps] = useState<Array<{
    label: string
    kind: string
    value: string
    matchBase?: Record<string, string>
  }>>(
    edit?.steps.map((s) => ({ label: s.label, kind: s.kind, value: s.value, matchBase: s.match })) ?? [
      { label: '', kind: 'tag', value: '' },
      {
        label: presetConversion?.name ?? '',
        kind: 'conversion',
        value: presetConversion?.id ?? '',
      },
    ],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const matchFor = (kind: string, value: string): Record<string, string> => {
    if (kind === 'friend_add') return {}
    if (kind === 'tag') return { tagId: value }
    if (kind === 'field') return { fieldId: value }
    if (kind === 'form') return { formId: value }
    if (kind === 'site_event') return { eventType: 'page_view', pathGroup: value }
    if (kind === 'purchase') return { status: 'confirmed' }
    if (kind === 'link_click') return { trackedLinkId: value }
    if (kind === 'conversion') return { conversionPointId: value }
    if (kind === 'message') return { direction: 'received' }
    if (kind === 'booking') return { status: 'confirmed' }
    return { automationId: value }
  }

  const kindNeedsValue = (kind: string) => !['friend_add', 'purchase', 'message', 'booking'].includes(kind)

  const save = async () => {
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    if (steps.some((s) => !s.label.trim())) {
      setError('すべての段に名前を付けてください')
      return
    }
    if (steps.some((s) => kindNeedsValue(s.kind) && !s.value.trim())) {
      setError('選んだ行動に必要なIDまたは値を入力してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payloadSteps = steps.map((s) => {
        // フォームに出せない副条件は元の版から残す。段の種類を変えた段は
        // matchBaseを捨ててあるので、ここで混ざることはない。
        const match = s.matchBase ? { ...s.matchBase } : matchFor(s.kind, s.value.trim())
        if (s.matchBase) {
          const key = funnelStepPrimaryKey(s.kind)
          if (key) match[key] = s.value.trim()
        }
        return { label: s.label.trim(), kind: s.kind, match }
      })
      if (edit) {
        const res = await api.analytics.v6Funnels.createVersion(accountId, edit.funnelId, {
          name: name.trim(),
          windowDays: Number(windowDays),
          steps: payloadSteps,
          segment: edit.segment,
          comparisonGroups: edit.comparisonGroups,
          expectedVersionNumber: edit.expectedVersionNumber,
        })
        if (!res.success) {
          setError(explainStartError(res.error, res.error))
          return
        }
        onCreated(edit.funnelId, res.data.usageWarnings)
      } else {
        const res = await api.analytics.v6Funnels.create(accountId, {
          name: name.trim(),
          windowDays: Number(windowDays),
          steps: payloadSteps,
        })
        if (!res.success) {
          setError(res.error)
          return
        }
        onCreated(res.data.funnelId, res.data.usageWarnings)
      }
    } catch {
      setError('保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  // 板 `VDPz5`「ファネルを作る」。作る・直す操作は小窓で出す。
  return (
    <Dialog
      open
      title={edit ? 'ファネルを直す' : 'ファネルを作る'}
      confirmLabel={edit ? '新版として保存する' : '作る'}
      cancelLabel="キャンセル"
      busy={saving}
      error={error || undefined}
      designNode={edit ? undefined : 'VDPz5'}
      onConfirm={() => void save()}
      onCancel={onCancel}
    >
    <div className="space-y-4">
      {presetConversion && !edit ? (
        <Notice tone="info">
          成果地点「{presetConversion.name}」を2段目に入れています。このまま段を組んで作成すると、その成果地点を使う分析として登録されます。
        </Notice>
      ) : null}
      <div>
        <label htmlFor="fn-name" className="text-ink-secondary mb-1 block text-sm font-medium">
          名前
        </label>
        <input
          id="fn-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 友だち追加から購入まで"
          className="border-hairline rounded-control w-full max-w-md border px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="fn-window" className="text-ink-secondary mb-1 block text-sm font-medium">
          何日以内の通過で数えるか
        </label>
        <Select
          id="fn-window"
          aria-label="何日以内の通過で数えるか"
          value={windowDays}
          onChange={(value) => setWindowDays(value)}
          options={[
            // API経由で7/30/90以外の日数が付いたファネルも、編集で値を失わないよう現在値を足す
            ...(['7', '30', '90'].includes(windowDays)
              ? []
              : [{ value: windowDays, label: `${windowDays}日以内` }]),
            { value: '7', label: '7日以内' },
            { value: '30', label: '30日以内' },
            { value: '90', label: '90日以内' },
          ]}
          className="max-w-md"
          size="standard"
        />
      </div>

      <div className="space-y-3">
        <p className="text-ink-secondary text-sm font-medium">段（上から順に見ます）</p>
        {steps.map((step, i) => (
          <div key={i} className="border-hairline flex flex-wrap items-end gap-2 rounded-control border p-3">
            <span className="text-ink-faint pb-2 text-sm tabular-nums">{i + 1}.</span>
            <div className="min-w-[10rem] flex-1">
              <label className="text-ink-faint mb-1 block text-xs">段の名前</label>
              <input
                type="text"
                value={step.label}
                onChange={(e) =>
                  setSteps((prev) =>
                    prev.map((s, j) => (i === j ? { ...s, label: e.target.value } : s)),
                  )
                }
                placeholder="例: 友だち追加"
                className="border-hairline rounded-control w-full border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-ink-faint mb-1 block text-xs">何をしたら</label>
              <Select
                value={step.kind}
                onChange={(value) =>
                  setSteps((prev) =>
                    // 種類を変えた段は旧条件のmatchを引き継がない（別種類のキーが残ると誤集計になる）
                    prev.map((s, j) => (i === j ? { ...s, kind: value, matchBase: undefined } : s)),
                  )
                }
                aria-label={`${i + 1}段目で何をしたら進むか`}
                className="border-hairline rounded-control border px-2 py-1.5 text-sm"
                size="standard"
                options={FUNNEL_STEP_KIND_OPTIONS.map((kind) => ({ value: kind.key, label: kind.label }))}
              />
            </div>
            <div className="min-w-[10rem] flex-1">
              <label className="text-ink-faint mb-1 block text-xs">
                {FUNNEL_STEP_KIND_OPTIONS.find((k) => k.key === step.kind)?.hint || '追加の指定はありません'}
              </label>
              <input
                type="text"
                value={step.value}
                disabled={!kindNeedsValue(step.kind)}
                onChange={(e) =>
                  setSteps((prev) =>
                    prev.map((s, j) => (i === j ? { ...s, value: e.target.value } : s)),
                  )
                }
                className="border-hairline rounded-control w-full border px-2 py-1.5 text-sm disabled:bg-canvas-sunken disabled:text-ink-faint"
              />
            </div>
            {steps.length > 2 && (
              <button
                onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                className="text-danger hover:bg-danger-bg rounded-mini px-2 py-1.5 text-xs"
              >
                外す
              </button>
            )}
          </div>
        ))}
        {steps.length < 10 && (
          <Button variant="secondary" className="text-ink-secondary px-3 py-1.5 h-auto whitespace-normal" onClick={() => setSteps((prev) => [...prev, { label: '', kind: 'tag', value: '' }])}>
            ＋ 段を足す
          </Button>
        )}
      </div>

      <p className="text-ink-faint text-xs">
        段は2つ以上10個まで。1段だけだと「ただの件数」になり、どこで離れたかが分かりません。
      </p>

    </div>
    </Dialog>
  )
}

type OverviewResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

function useOverview<T>(load: () => Promise<OverviewResult<T>>, key: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 再試行用の数え直し。条件は変えず、同じ読み込みをもう一度だけ行う。
  const [reloadSeq, setReloadSeq] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setData(null)
    void load()
      .then((result) => {
        if (!active) return
        if (result.success) setData(result.data)
        else setError(result.error || '分析を表示できませんでした')
      })
      .catch(() => {
        if (active) setError('分析を表示できませんでした')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
    // 契約: loaderはkeyに含まれる値だけに依存すること。キーに含まれない値をloaderが読んだらキーを足す。
    // loaderはkeyが表すアカウント・期間が変わった時だけ実行する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadSeq])
  return { data, loading, error, retry: () => setReloadSeq((n) => n + 1) }
}

function metricText(
  value: AnalyticsMetric<number | string>,
  options?: { percent?: boolean; currency?: boolean },
) {
  if (value.value === null) return '—'
  if (typeof value.value === 'string') return value.value
  if (options?.percent) return `${Math.round(value.value * 1000) / 10}%`
  if (options?.currency) return `${formatNumber(value.value)}円`
  return formatNumber(value.value)
}

/**
 * 指標が自分で言っている状態を見てから数を出す。
 *
 * 契約では `AnalyticsMetric` が `value` と一緒に `state` と `reason` を持っている。
 * 初回集計を待っている（`pending`）ときや取得に失敗した（`failed`）とき、
 * サーバは `value` に 0 を入れて返すことがある。**それをそのまま描くと
 * 「日別集計の初回更新を待っています」と「0人」が同じカードに並び、
 * 読む人には0が実測に見える。**
 *
 * 実測できた（`available`）か、途中まで集計できた（`partial`）ときだけ数を出す。
 * それ以外は `—` にして、理由のほうを読ませる。
 */
function shownValue(metric: AnalyticsMetric<number>): number | null {
  if (metric.value === null) return null
  return metric.state === 'available' || metric.state === 'partial' ? metric.value : null
}

/*
 * #1005: KPIカードの3段目には短い状態だけを置く。APIが返す理由文は長い
 * ことがあるので detail へ直置きせず、説明アイコンの中（description）へ
 * 逃がして、行全体が理由の長さで伸びないようにする。未取得のラベルは
 * #606 の決めごとに合わせて「未取得」と書く。
 */
const METRIC_STATE_TEXT: Record<AnalyticsMetricState, string> = {
  available: '',
  partial: '一部だけ集計できています',
  pending: '集計を待っています',
  insufficient: '数が少なく出せません',
  unavailable: '未取得',
  failed: '取得に失敗しました',
}

type KpiCardState = {
  detail: string
  description?: string
  /** 定義・計算のしかた。KpiCard の「？」へ渡す。 */
  help?: string
  onRetry?: () => void
}

/**
 * 指標ごとのカード文言を「短い状態＋説明」へ分ける。
 * 理由があるときは detail を短い状態に差し替え、理由全文は description へ。
 * failed のときだけ、その場で読み直せる再試行を渡せるようにする。
 */
function metricCardState(
  metric: Pick<AnalyticsMetric<unknown>, 'state' | 'reason'>,
  fallback: KpiCardState,
  retry?: () => void,
): KpiCardState {
  const retryable = metric.state === 'failed' && retry ? { onRetry: retry } : {}
  if (!metric.reason) return { ...fallback, ...retryable }
  return {
    detail: METRIC_STATE_TEXT[metric.state] || '未取得',
    description: metric.reason,
    ...retryable,
  }
}

function MetricCell({ metric, percent, currency }: {
  metric: AnalyticsMetric<number | string>
  percent?: boolean
  currency?: boolean
}) {
  // 表の桁も帯と同じ決めごとで出す。`value === null` だけ見ていると、
  // 集計待ちの 0 が実測の 0 と同じ濃さで並ぶ。
  const shown = metric.state === 'available' || metric.state === 'partial'
  return <span className={metric.value === null || !shown ? 'text-ink-faint' : 'text-ink'} title={metric.reason ?? undefined}>
    {shown ? metricText(metric, { percent, currency }) : '—'}
  </span>
}

function DateTimeMetricCell({ metric }: { metric: AnalyticsMetric<string> }) {
  return <span className={metric.value === null ? 'text-ink-faint' : 'text-ink'} title={metric.reason ?? undefined}>
    {formatAnalyticsDateTime(metric.value)}
  </span>
}

/*
 * ★V7 `x63W5x`：タブ全体の失敗はピンクの箱ではなく、一覧の場所の
 * ListState error だけ出す（読み直す口つき）。文言は呼び出し側の決まった
 * 日本語（口の生文言は出さない）。
 */
function OverviewState({ loading, error, onRetry }: { loading: boolean; error: string; onRetry?: () => void }) {
  if (loading) return <ListState kind="loading" title="分析を読み込んでいます" />
  // 一時的な取得失敗は開き直すしかなかった。同じ条件で読み直す導線をここに出す。
  if (error) {
    return (
      <ListState kind="error" description={error} onRetry={onRetry} />
    )
  }
  return null
}

// 経路の内訳だけを後から読む(点検#508軽10)。概要と同時に2つの重い集計を走らせない。
// 概要が出てから描かれるので、この関数の読み込みは概要の後に始まる。
// 取得中は表の場所だけ読み込み表示にする。
function RouteBreakdown({ accountId, from, to }: { accountId: string; from: string; to: string }) {
  const routeState = useOverview<AnalyticsRoutesOverview>(
    () => api.analytics.routesOverview(accountId, { from, to }),
    `${accountId}:${from}:${to}:friends-routes`,
  )
  if (!routeState.data) return <OverviewState loading={routeState.loading} error={routeState.error} onRetry={routeState.retry} />
  {
    const routes = routeState.data.data.routes
    const max = Math.max(1, ...routes.map((route) => shownValue(route.friendAdds) ?? 0))
    return <ul className="v8-ro-analytics-routeBars">{routes.map((route) => <li key={route.id}><div><span title={route.name}>{route.name}</span><strong>{metricText(route.friendAdds)}人</strong></div><div className="v8-ro-analytics-routeBar" title={`現在 ${metricText(route.currentFriends)}人・1人あたり ${metricText(route.costPerFriend)}円`}><span style={{ width: `${(shownValue(route.friendAdds) ?? 0) / max * 100}%` }} /></div></li>)}</ul>
  }
}

function FriendsOverviewTab({ accountId }: { accountId: string }) {
  const [days, setDays] = useState(30)
  const range = useMemo(() => rangeFor(days - 1), [days])
  const [selectedDate, setSelectedDate] = useState('')
  const state = useOverview<AnalyticsFriendsOverview>(
    () => api.analytics.friendsOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:friends`,
  )
  if (!state.data) return <div className="space-y-4"><AnalyticsPeriodControl days={days} onChange={setDays} /><OverviewState loading={state.loading} error={state.error} onRetry={state.retry} /></div>
  const overview = state.data.data
  const addedValue = shownValue(overview.metrics.added)
  const removedValue = shownValue(overview.metrics.removed)
  // 差し引きは増加と減少から導いた値。元の2つが出せないなら、差し引きも出せない。
  // ここを道連れにしないと「増えた —／減った —／差し引き 0人」という読めない並びになる。
  const netValue = addedValue === null || removedValue === null ? null : shownValue(overview.metrics.net)
  const pendingReason = overview.stateReason ?? '日ごとの集計がまだありません'
  const daysShown = overview.state === 'available' || overview.state === 'partial'
  // 上の帯が理由全文を既に出しているとき、図側で繰り返さない(#670 20)。
  const reasonShownInBanner = overview.state !== 'available' && Boolean(overview.stateReason)
  const selectedDay = overview.days.find((day) => day.date === selectedDate) ?? overview.days.at(-1) ?? null
  const selectedCampaigns = overview.campaigns.filter((item) => item.date === selectedDay?.date)
  return <div className="v8-ro-analytics-friends">
    <div className="v8-ro-analytics-kpis">
      <KpiCard title="増えた" value={addedValue} unit="人" {...metricCardState(overview.metrics.added, { detail: `この${days}日。初回 ${metricText(overview.metrics.firstTime)}人` }, state.retry)} />
      <KpiCard title="減った" value={removedValue} unit="人" help="ブロックと友だち解除を合わせた人数です" {...metricCardState(overview.metrics.removed, { detail: `この${days}日` }, state.retry)} />
      <KpiCard title="差し引き" value={netValue} unit="人" {...metricCardState(overview.metrics.net, { detail: `現在つながっている ${metricText(overview.metrics.currentFriends)}人` }, state.retry)} />
      <KpiCard title="ブロック率" value={null} unit="%" detail="未取得" description="ブロックだけの人数を取得できないため、割合は計算できません" />
    </div>
    {overview.state !== 'available' && overview.stateReason && <Notice tone="warn">{overview.stateReason}</Notice>}
    <div className="v8-ro-analytics-friendsBody">
      <section className="v8-ro-analytics-trend">
        <div className="v8-ro-analytics-sectionHead"><h2>日ごとの増減（この{days}日）</h2><RangePicker days={days} onChange={setDays} /></div>
        <div className="v8-ro-analytics-legend"><span>配信・シナリオの日は棒を選ぶと確認できます</span></div>
        {daysShown ? <BarChart items={toBarChartItems(overview.days, { campaigns: overview.campaigns, formatTitle: (date) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日（${analyticsWeekday(date)}）` })} selectedKey={selectedDate} onSelect={setSelectedDate} /> : <div className="v8-ro-analytics-state" role="status"><p>{reasonShownInBanner ? (METRIC_STATE_TEXT[overview.state] || '未取得') : pendingReason}</p>{overview.state === 'pending' && <p>日ごとの集計は数分ごとに自動で更新されます。しばらくしても変わらないときは、時間をおいて開き直してください。</p>}</div>}
        {daysShown && selectedDay && <p className="v8-ro-analytics-selection">{selectedDay.date}（{analyticsWeekday(selectedDay.date)}）　増加 {selectedDay.added}人・減少 {selectedDay.removed}人・差し引き {selectedDay.net}人　{selectedCampaigns.map((item) => item.name).join('、') || '施策なし'}</p>}
        {daysShown && overview.campaigns.length > 0 && <div className="v8-ro-analytics-campaigns">{overview.campaigns.map((item) => <p key={item.id}>{formatAnalyticsDate(item.date)} {item.name}</p>)}</div>}
        <div className="v8-ro-analytics-chartFooter"><AnalyticsPeriodCaption from={state.data.period.from} to={state.data.period.to} cutoffAt={state.data.dataCutoffAt} /><AnalyticsExportButton headerOnly disabled={!daysShown} onClick={() => downloadCsv('analytics-friends.csv', [['日付', '増えた', '減った', '差し引き'], ...overview.days.map((day) => [day.date, day.added, day.removed, day.net])])} /></div>
      </section>
      <aside className="v8-ro-analytics-friendsAside"><section className="v8-ro-analytics-breakdown"><h2>どこから増えたか</h2><p>流入リンクごと・この{days}日</p><RouteBreakdown accountId={accountId} from={range.from} to={range.to} /><Link href="/inflow-links">流入と計測で詳しく見る →</Link></section><section className="v8-ro-analytics-breakdown"><h2>減った友だち</h2><p>ブロック・友だち解除の合計</p><strong>{metricText(overview.metrics.removed)}人</strong><p>ブロックの内訳は未取得です。現在の集計では、ブロック・友だち解除の合計を表示します。</p></section></aside>
    </div>
  </div>
}

function ReactionsOverviewTab({ accountId }: { accountId: string }) {
  const [days, setDays] = useState(30)
  const range = useMemo(() => rangeFor(days - 1), [days])
  const state = useOverview<AnalyticsReactionsOverview>(
    () => api.analytics.reactionsOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:reactions`,
  )
  if (!state.data) return <div className="space-y-4 v8-ro-analytics-reactions"><AnalyticsPeriodControl days={days} onChange={setDays} /><OverviewState loading={state.loading} error={state.error} onRetry={state.retry} /></div>
  const overview = state.data.data
  const delivered = shownValue(overview.metrics.delivered)
  const clicked = shownValue(overview.metrics.lineClicked)
  const clickRate = delivered && clicked !== null ? clicked / delivered * 100 : null
  const maxHourly = Math.max(1, ...overview.trackedClickHours.map((item) => item.clicks))
  // 打切りに達した系統だけ、一覧に実際に出ている件数で「先頭○件まで」を告げる。
  const broadcastShown = overview.campaigns.filter((item) => item.kind === 'broadcast').length
  const scenarioShown = overview.campaigns.length - broadcastShown
  const truncationNote = [
    overview.campaignsTruncation.broadcast ? `一斉配信は新しい方から先頭${broadcastShown}件` : null,
    overview.campaignsTruncation.scenario ? `シナリオは新しい方から先頭${scenarioShown}件` : null,
  ].filter(Boolean).join('・')
  // 計算のしかたはふだん「？」へ。取れなかった理由があるときは理由を出す。
  const clickReason = overview.metrics.lineClicked.reason ?? overview.metrics.delivered.reason ?? undefined
  const clickHelp = clickReason ? undefined : 'LINEクリックを届いた人で割った割合です'
  const exportCampaigns = () => downloadCsv('analytics-reactions.csv', [
    ['配信', '種類', '送った日時', '対象', '到達', '送信通数', '開封', 'LINEクリック', '成果'],
    ...overview.campaigns.map((item) => [
      item.name,
      item.kind === 'broadcast' ? '一斉配信' : 'シナリオ',
      item.sentAt,
      shownValue(item.targetPeople),
      shownValue(item.delivered),
      shownValue(item.sentMessages),
      shownValue(item.opened),
      shownValue(item.lineClicked),
      shownValue(item.outcomes),
    ]),
    // 打切りのときはCSV側にも範囲の断りを残す。一覧だけに書くと、
    // 書き出した表だけを見た人に全件のように見える。
    ...(truncationNote ? [[`※${truncationNote}までを表示（それより古い配信は含みません）`]] : []),
  ])
  return <div data-design-node="yvOtn" className="space-y-4 v8-ro-analytics-reactions">
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard title="配信" value={overview.campaigns.length} unit="件" detail={`一斉配信 ${broadcastShown}・シナリオ ${scenarioShown}`} help="一覧に取得できた配信の回数です" />
      <KpiCard title="届いた人" value={delivered} unit="人" help="一斉配信の到達数の合計です。シナリオは届いた人数が取れないため含みません" {...metricCardState(overview.metrics.delivered, { detail: '' }, state.retry)} />
      <KpiCard title="押された割合" value={clickRate} unit="%" detail="LINEクリック ÷ 届いた人" help={clickHelp} description={clickReason} />
      <KpiCard title="取得できない配信" value={shownValue(overview.metrics.unavailableCampaigns)} unit="件" help="開封などを取得できない配信の件数です" {...metricCardState(overview.metrics.unavailableCampaigns, { detail: '' }, state.retry)} />
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <RangePicker days={days} onChange={setDays} />
      <AnalyticsPeriodCaption from={state.data.period.from} to={state.data.period.to} cutoffAt={state.data.dataCutoffAt} />
      <AnalyticsExportButton onClick={exportCampaigns} disabled={overview.campaigns.length === 0} />
    </div>
    <AnalyticsNotice>配信ごとの開かれ方・押され方です。20人未満など取得できない数は、0ではなく「—」と理由で示します。</AnalyticsNotice>
    {truncationNote && <AnalyticsNotice>{truncationNote}までを表示しています。それより古い配信は一覧にもCSVの書き出しにも入りません。</AnalyticsNotice>}


    <div className="bg-canvas rounded-card border-hairline overflow-hidden border"><table className="w-full table-fixed">
      <thead><TableHeadRow><Th>配信</Th><Th>種類・日時</Th><Th align="right">対象</Th><Th align="right" help="一斉配信で届いた人数です。シナリオは届いた人数が取れないため「—」です">到達</Th><Th align="right" help="開いた人数です。20人未満など取得できない数は「—」で示します">開封</Th><Th align="right" help="こちらで作った中継URLを押した人数です">LINEクリック</Th><Th align="right">成果</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{overview.campaigns.length === 0 ? <tr><td colSpan={7} className="text-ink-faint p-8 text-center text-sm">この期間の配信はありません</td></tr> : overview.campaigns.map((item) => <tr key={`${item.kind}:${item.id}`} className="text-sm"><td className="truncate px-4 py-3 font-medium" title={item.name}>{item.name}</td><td className="text-ink-secondary px-3 py-3">{item.kind === 'broadcast' ? '一斉配信' : 'シナリオ'}<br /><span className="text-xs tabular-nums">{formatAnalyticsDateTime(item.sentAt)}</span></td><td className="px-3 py-3 text-right"><MetricCell metric={item.targetPeople} />{item.kind === 'scenario' && <p className="mt-1 text-xs text-ink-faint">送信 <MetricCell metric={item.sentMessages} />通</p>}</td><td className="px-3 py-3 text-right"><MetricCell metric={item.delivered} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.opened} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.lineClicked} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.outcomes} /></td></tr>)}</tbody>
    </table></div>
    <section className="bg-canvas rounded-card border-hairline border p-4 v8-ro-analytics-hours">
      {/* 監査 R71: 集計はクリックされた時刻の時間帯。送った時刻ではないので名前を実態に合わせる。 */}
      <h2 className="font-semibold text-ink">押された時間帯ごとの回数</h2>
      <p className="mt-1 text-xs text-ink-faint">こちらで作った中継URLを、相手が押した時刻で時間帯ごとに並べています。送った時刻ではありません。</p>
      <div className="mt-4 flex h-28 items-end gap-2">
        {Array.from({ length: 24 }, (_, hour) => {
          const clicks = overview.trackedClickHours.find((item) => item.hour === hour)?.clicks ?? 0
          // 高さだけの棒は読み上げに届かない。1本ごとに時間と回数を名前にする。
          return <div key={hour} role="img" aria-label={`${hour}時台 ${clicks}回`} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${hour}時台 ${clicks}回`}><span className="w-full rounded-t-mini bg-accent" style={{ height: `${clicks / maxHourly * 96}px` }} /><span aria-hidden="true" className="h-3 whitespace-nowrap text-nano leading-3 text-ink-faint">{hour % 3 === 0 ? `${hour}時` : ''}</span></div>
        })}
      </div>
    </section>
  </div>
}

function RoutesOverviewTab({ accountId }: { accountId: string }) {
  const [days, setDays] = useState(30)
  const range = useMemo(() => rangeFor(days - 1), [days])
  const state = useOverview<AnalyticsRoutesOverview>(
    () => api.analytics.routesOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:routes`,
  )
  if (!state.data) return <div className="space-y-4"><AnalyticsPeriodControl days={days} onChange={setDays} /><OverviewState loading={state.loading} error={state.error} onRetry={state.retry} /></div>
  const overview = state.data.data
  const clicks = metricSum(overview.routes.map((item) => item.clicks))
  const friends = metricSum(overview.routes.map((item) => item.friendAdds))
  const reactions = metricSum(overview.routes.map((item) => item.reactionPeople))
  const conversions = metricSum(overview.routes.map((item) => item.conversions.approved))
  const revenue = metricSum(overview.routes.map((item) => item.conversions.revenue))
  const adCost = metricSum(overview.routes.map((item) => item.adCost))
  const profit = metricSum(overview.routes.map((item) => item.profitAfterAdCost))
  const stages = [
    { label: 'リンクを押した', value: clicks },
    { label: '友だちになった', value: friends },
    { label: '1回でも反応した', value: reactions },
    { label: '成果になった', value: conversions },
  ]
  const exportRoutes = () => downloadCsv('analytics-routes.csv', [
    ['経路', '友だち', '反応', '成果', '売上', 'かかった費用', '差し引き'],
    ...overview.routes.map((item) => [item.name, shownValue(item.friendAdds), shownValue(item.reactionPeople), shownValue(item.conversions.approved), shownValue(item.conversions.revenue), shownValue(item.adCost), shownValue(item.profitAfterAdCost)]),
  ])
  return <div data-design-node="PFe9c" className="space-y-4">
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard title="友だちになった" value={friends} unit="人" detail={clicks === null ? 'クリックは未取得です' : `リンクを押した ${formatNumber(clicks)}回から`} />
      <KpiCard title="成果" value={conversions} unit="件" detail={revenue === null ? '売上は未取得です' : `売上 ${formatNumber(revenue)}円`} />
      <KpiCard title="かかった広告費" value={adCost} unit="円" detail={`費用を取れない経路 ${overview.routes.filter((item) => shownValue(item.adCost) === null).length}`} help="接続済みの経路の広告費を合計した金額です" />
      <KpiCard title="差し引き" value={profit} unit="円" detail="" help="売上から広告費を引いた残りです" />

    </div>
    <div className="v8-ro-analytics-toolbar"><RangePicker days={days} onChange={setDays} /><AnalyticsPeriodCaption from={state.data.period.from} to={state.data.period.to} cutoffAt={state.data.dataCutoffAt} /><Link href={overview.searchConsoleHref} className="text-action">Search Consoleを見る</Link><AnalyticsExportButton onClick={exportRoutes} disabled={overview.routes.length === 0} /></div>
    <div className="v8-ro-analytics-routesBody"><section className="v8-ro-analytics-routesFlow"><h2 className="text-sm font-semibold">全体の流れ</h2><div className="v8-ro-analytics-routesStages">{stages.map((stage, index) => {
      const previous = index > 0 ? stages[index - 1].value : null
      const rate = previous && stage.value !== null ? stage.value / previous * 100 : null
      // 監査6 #674: 段ごとの数は MetricValue で単位小・3状態を揃える
      return <div key={stage.label}><div className="v8-ro-analytics-routeStageHead"><p className="text-xs text-ink-faint">{stage.label}</p><p className="text-sm font-semibold text-ink"><MetricValue value={stage.value} unit={index === 0 ? '回' : index === 3 ? '件' : '人'} /></p></div><div className="v8-ro-analytics-routeBar" aria-hidden="true"><span style={{ width: stage.value !== null && clicks ? `${Math.min(100, stage.value / clicks * 100)}%` : '0%' }} /></div>{index > 0 && <p className="mt-1 text-xs text-ink-secondary">前段の {rate === null ? '—' : `${rate.toFixed(1)}%`}</p>}</div>
    })}</div></section>
    <div className="v8-ro-analytics-routesTable"><div className="bg-canvas rounded-card border-hairline overflow-hidden border"><table className="w-full table-fixed">
      <thead><TableHeadRow><Th>経路</Th><Th align="right">友だち</Th><Th align="right">反応</Th><Th align="right">成果</Th><Th align="right">売上</Th><Th align="right">かかった費用</Th><Th align="right">差し引き</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{overview.routes.length === 0 ? <tr><td colSpan={7} className="text-ink-faint p-8 text-center text-sm">この期間に集計できる経路はありません</td></tr> : overview.routes.map((item) => <tr key={item.id} className="text-sm"><td className="px-3 py-3 font-medium"><p className="truncate" title={item.name}>{item.name}</p><p className="mt-1 truncate text-xs font-normal text-ink-faint">{item.refCode ? `流入と計測 ／ ref=${item.refCode}` : '参照コードなし'} ／ クリック <MetricCell metric={item.clicks} /></p></td><td className="px-2 py-3 text-right"><MetricCell metric={item.friendAdds} /><p className="mt-1 text-xs text-ink-faint">現在 <MetricCell metric={item.currentFriends} /></p></td><td className="px-2 py-3 text-right"><MetricCell metric={item.reactionPeople} /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.conversions.approved} /><p className="mt-1 text-xs text-ink-faint">保留 <MetricCell metric={item.conversions.pending} />・却下 <MetricCell metric={item.conversions.rejected} /></p></td><td className="px-2 py-3 text-right"><MetricCell metric={item.conversions.revenue} currency /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.adCost} currency /><p className="mt-1 text-xs text-ink-faint">友だち1人 <MetricCell metric={item.costPerFriend} currency />・成果1件 <MetricCell metric={item.costPerConversion} currency /></p></td><td className="px-2 py-3 text-right"><MetricCell metric={item.profitAfterAdCost} currency /></td></tr>)}</tbody>
    </table></div>
    <p className="mt-2 text-xs text-ink-faint">「—」は費用や成果を取得できない経路です。0として差し引きを計算していません。帰属方式は「{overview.attributionLabel}」です。</p></div></div>
  </div>
}

function UsageOverviewTab({ accountId }: { accountId: string }) {
  const [days, setDays] = useState(30)
  const range = useMemo(() => rangeFor(days - 1), [days])
  const [menuFeatures, setMenuFeatures] = useState<{ enabled: number; total: number } | null>(null)
  const [menuFeaturesError, setMenuFeaturesError] = useState('')
  const [menuReload, setMenuReload] = useState(0)
  const state = useOverview<AnalyticsUsageOverview>(
    () => api.analytics.usageOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:usage`,
  )
  useEffect(() => {
    let active = true
    setMenuFeatures(null)
    setMenuFeaturesError('')
    void api.featureSettings.visibility(accountId).then((response) => {
      if (!active) return
      if (!response.success) {
        setMenuFeaturesError('メニューに出している機能を確認できません')
        return
      }
      setMenuFeatures(summarizeMenuFeatures(response.data))
    }).catch(() => {
      if (active) setMenuFeaturesError('メニューに出している機能を確認できません')
    })
    return () => { active = false }
  }, [accountId, menuReload])
  if (!state.data) return <div className="space-y-4"><AnalyticsPeriodControl days={days} onChange={setDays} /><OverviewState loading={state.loading} error={state.error} onRetry={state.retry} /></div>
  const overview = state.data.data
  const estimatedHoursSavedValue = overview.summary.estimatedHoursSaved.state === 'available'
    || overview.summary.estimatedHoursSaved.state === 'partial'
    ? overview.summary.estimatedHoursSaved.value
    : null
  const exportUsage = () => downloadCsv('analytics-usage.csv', [
    ['機能', '作成', '利用中', '未使用', '最終利用', '気づいたこと', '参照の状態'],
    ...overview.categories.map((item) => [item.label, shownValue(item.created), shownValue(item.inUse), shownValue(item.unused), item.lastUsedAt.value, usageObservation(item).text, referenceHealthText(item.brokenReferences)]),
  ])
  return <div data-design-node="N8ZrUl" className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        title="使っている機能"
        value={menuFeatures?.enabled ?? null}
        unit={menuFeatures ? ` / ${menuFeatures.total}` : ''}
        detail={menuFeaturesError || 'メニューに出している機能のうち'}
      />
      <KpiCard
        title="自動で動いた回数"
        value={shownValue(overview.summary.automaticRuns)}
        unit="回"
        {...metricCardState(overview.summary.automaticRuns, { detail: `この${days}日。実行記録から集計。手で送ったのは${formatNumber(overview.summary.manualSends.value)}回` }, state.retry)}
      />
      <KpiCard
        title="手作業が減った時間"
        value={estimatedHoursSavedValue}
        unit="時間"
        detail={overview.summary.estimatedHoursSaved.reason ? (METRIC_STATE_TEXT[overview.summary.estimatedHoursSaved.state] || '未取得') : '1件30秒として試算'}
        description={overview.summary.estimatedHoursSaved.reason ?? undefined}
        onRetry={overview.summary.estimatedHoursSaved.state === 'failed' ? state.retry : undefined}
      />
      <KpiCard
        title="作ったのに使っていない"
        value={shownValue(overview.summary.unusedItems)}
        unit="個"
        {...metricCardState(overview.summary.unusedItems, { detail: `参照切れ ${metricText(overview.summary.brokenReferences)}件`, description: overview.summary.brokenReferences.reason ?? undefined }, state.retry)}
      />
    </div>
    {overview.stateReason ? <Notice tone="warn">{overview.stateReason}</Notice> : <AnalyticsNotice>項目が多いほど良い、ではありません。使っていないものは使用先を確かめてから、下の「片づける」で整理できます。</AnalyticsNotice>}
    {menuFeaturesError && (
      <Notice
        tone="danger"
        action={<Button variant="secondary" onClick={() => setMenuReload((n) => n + 1)}>もう一度確認</Button>}
      >
        {menuFeaturesError}
      </Notice>
    )}
    <div className="v8-ro-analytics-usageBody"><div id="usage-items" className="bg-canvas rounded-card border-hairline overflow-hidden border"><table className="w-full table-fixed">
      <thead><TableHeadRow><Th>機能</Th><Th align="right">作成</Th><Th align="right">利用中</Th><Th align="right">未使用</Th><Th>最終利用</Th><Th align="right">操作</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{overview.categories.map((item) => {
        return <tr key={item.key} className="text-sm"><td className="px-4 py-3"><p className="font-semibold" title={item.label}>{item.label}</p></td><td className="px-3 py-3 text-right"><MetricCell metric={item.created} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.inUse} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.unused} /></td><td className="px-3 py-3"><DateTimeMetricCell metric={item.lastUsedAt} /></td><td className="px-3 py-2"><RowActions subjectName={item.label} detail={{ label: '中身を見る', href: item.href }} menuItems={canTidyUsage(item) ? [{ id: 'tidy', label: '片づける', onSelect: () => window.location.assign(item.href) }] : []} /></td></tr>
      })}</tbody>
    </table></div>
    <aside className="v8-ro-analytics-observations"><h2 className="text-sm font-semibold">気づいたこと</h2><p className="mt-2 text-xs">確認できた参照切れ <MetricCell metric={overview.summary.brokenReferences} />件</p><ul>{overview.categories.filter((item) => usageObservation(item).tone !== 'normal').slice(0, 3).map((item) => <li key={item.key}>{item.label}：{usageObservation(item).text}</li>)}</ul><Button variant="secondary" onClick={() => { state.retry(); setMenuReload((value) => value + 1) }}>もう一度確認</Button><Disclosure title="機能ごとの確認結果" size="compact"><ul>{overview.categories.map((item) => {
      const observation = usageObservation(item)
      return <li key={item.key}><span>{item.label}：{observation.text}</span><span title={item.brokenReferences.reason ?? undefined}> ／ {referenceHealthText(item.brokenReferences)}</span></li>
    })}</ul></Disclosure></aside></div>
    <Disclosure title="集計期間を変える" hint={`この${days}日`} size="compact"><AnalyticsPeriodControl days={days} onChange={setDays} /></Disclosure>
    <AnalyticsExportButton headerOnly onClick={exportUsage} disabled={overview.categories.length === 0} />
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <p className="text-ink-faint">未使用の項目は自動で削除しません。各機能の使用先を確認してから停止・削除します。</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <AnalyticsPeriodCaption from={state.data.period.from} to={state.data.period.to} cutoffAt={state.data.dataCutoffAt} />
        <span className="text-ink-faint">利用関係を最後に確認: {formatAnalyticsDateTime(overview.checkedAt)}</span>
      </div>
    </div>
  </div>
}

function UrlClicksOverviewTab({ accountId }: { accountId: string }) {
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(0)
  const [days, setDays] = useState(30)
  const range = useMemo(() => rangeFor(days - 1), [days])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  // 監査 R72: 検索語はAPIへ渡し、200件を超えたURLにも届くようにする。
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])
  const state = useOverview<AnalyticsUrlClicksOverview>(
    () => api.analytics.urlClicksOverview(accountId, { ...range, limit: 200, query: debouncedQuery || undefined }),
    `${accountId}:${range.from}:${range.to}:${debouncedQuery}:url-clicks`,
  )
  const links = (state.data?.data.links ?? []).filter((item) => status === 'all' || item.isActive === (status === 'active'))
  const lastPage = Math.max(0, Math.ceil(links.length / pageSize) - 1)
  const currentPage = Math.min(page, lastPage)
  const visibleLinks = links.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const clicks = metricSum(links.map((item) => item.clicks))
  const people = metricSum(links.map((item) => item.knownClickPeople))
  const zeroLinks = links.filter((item) => shownValue(item.clicks) === 0).length
  const exportRows = () => downloadCsv('analytics-url-clicks.csv', [
    ['リンク名', 'URL', '押された回数', '押した人', '使われた場所'],
    ...links.map((item) => [item.name, item.originalUrl, shownValue(item.clicks), shownValue(item.knownClickPeople), item.usageLocations.join('、')]),
  ])
  const toolbar = <div key="url-toolbar" className="v8-ro-analytics-toolbar">
    <SearchField id="url-click-search" aria-label="URL・配信名・リンク名で探す" value={query} onChange={(value) => { setQuery(value); setPage(0) }} onClear={() => { setQuery(''); setPage(0) }} placeholder="URL・配信名・リンク名で探す" loading={state.loading} className="v8-ro-analytics-search" />
    <Select id="url-state" aria-label="URLの状態" value={status} options={[{ value: 'all', label: 'すべての状態' }, { value: 'active', label: '計測中' }, { value: 'stopped', label: '停止中' }]} onChange={(value) => { setStatus(value); setPage(0) }} />
    <RangePicker days={days} onChange={setDays} />
    <AnalyticsExportButton onClick={exportRows} disabled={!state.data || visibleLinks.length === 0} />
  </div>
  if (!state.data) return <div data-design-node="iK4cQ" className="space-y-4">{toolbar}<OverviewState loading={state.loading} error={state.error} onRetry={state.retry} /></div>
  const overview = state.data.data
  return <div data-design-node="iK4cQ" className="space-y-4">
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard title="押された回数" value={clicks} unit="回" detail={`この${days}日の中継URL`} />
      <KpiCard title="押した人（URLごとの合計）" value={people} unit="人" detail="URLをまたぐ重複は除けません" />
      <KpiCard title="計測中のURL" value={links.filter((item) => item.isActive).length} unit="件" detail="この画面に取得できたもの" />
      <KpiCard title="押されていないURL" value={zeroLinks} unit="件" detail="実測できたURLのうち" />
    </div>

    {toolbar}
    {overview.stateReason && <Notice tone="warn">{overview.stateReason}</Notice>}
    {overview.hasMore && <AnalyticsNotice>条件に合うもののうち200件までを表示しています。探す言葉で絞るとこの中だけではなく全体から探します。CSVの書き出しも、表示している範囲だけが入ります。</AnalyticsNotice>}
    {status !== 'all' && <p className="text-xs text-ink-faint">取得した範囲から{status === 'active' ? '計測中' : '停止中'}を表示しています。上の件数とCSVも同じ状態で絞り込んでいます。</p>}
    {debouncedQuery && <p className="text-ink-faint text-xs">「{debouncedQuery}」で絞り込んでいます。上の件数とCSVの書き出しは、この絞り込みの結果が対象です。</p>}

    <div className="bg-canvas rounded-card border-hairline overflow-hidden border"><table className="w-full table-fixed">
      <thead><TableHeadRow><Th>リンク名・リンク先URL</Th><Th>どこから</Th><Th align="right">押された回数</Th><Th align="right">押した人</Th><Th align="right">クリック率</Th><Th>状態</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{visibleLinks.length === 0 ? <tr><td colSpan={6} className="text-ink-faint p-8 text-center text-sm">条件に合うURLはありません</td></tr> : visibleLinks.map((item) => <tr key={item.trackedLinkId} className="text-sm"><td className="px-3 py-3"><p className="truncate font-medium" title={item.name}>{item.name}</p><p className="mt-1 truncate text-xs text-ink-faint" title={item.originalUrl}>{item.originalUrl}</p><p className="mt-1 truncate text-micro text-ink-faint">最初 {item.firstClickedAt ? <DateTimeMetricCell metric={item.firstClickedAt} /> : '—'} ／ 最後 {item.lastClickedAt ? <DateTimeMetricCell metric={item.lastClickedAt} /> : '—'}</p></td><td className="text-ink-secondary truncate px-3 py-3" title={item.usageLocations.join('、')}>{item.usageLocations.length ? item.usageLocations.join('、') : '—'}</td><td className="px-2 py-3 text-right"><MetricCell metric={item.clicks} /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.knownClickPeople} /><p className="mt-1 text-xs text-ink-faint">届いた人数 <MetricCell metric={item.deliveredPeople} /></p></td><td className="px-2 py-3 text-right">{shownValue(item.clickRate) === null ? <span className="text-ink-faint" title={item.clickRate.reason ?? undefined}>—</span> : <span>{shownValue(item.clickRate)}%</span>}</td><td className="px-3 py-3"><Chip tone={item.isActive ? 'ok' : 'neutral'}>{item.isActive ? '計測中' : '停止中'}</Chip>{(item.actions?.tagName || item.actions?.scenarioName) && <p className="mt-1 truncate text-xs text-ink-faint" title={[item.actions.tagName, item.actions.scenarioName].filter(Boolean).join('、')}>{[item.actions.tagName, item.actions.scenarioName].filter(Boolean).join('・')}</p>}</td></tr>)}</tbody>
    </table></div>
    <div className="v8-ro-analytics-pagination"><span>{links.length}件中 {links.length ? currentPage * pageSize + 1 : 0}〜{Math.min((currentPage + 1) * pageSize, links.length)}件（取得した範囲）</span><Select aria-label="表示件数" value={String(pageSize)} options={[10, 20, 50].map((value) => ({ value: String(value), label: `${value}件` }))} onChange={(value) => { setPageSize(Number(value)); setPage(0) }} /><Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>前へ</Button><Button variant="secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>次へ</Button></div>
    <AnalyticsNotice>数えているのは、こちらで作った中継URLだけです。直接貼ったURLは数えられません。同じURLを同じ人が何度押しても「押した人」は1人と数えます。</AnalyticsNotice>
    <AnalyticsPeriodCaption from={state.data.period.from} to={state.data.period.to} cutoffAt={state.data.dataCutoffAt} />
    <p className="text-ink-faint text-xs">{overview.clickRateDefinition}</p>
  </div>
}

const SAVED_STATE_LABELS: Record<SavedAnalyticsSnapshot['state'], string> = {
  available: '利用可能',
  partial: '一部集計',
  unavailable: '未取得',
  failed: '失敗',
}

const SAVED_STATE_TONES: Record<SavedAnalyticsSnapshot['state'], ChipTone> = {
  available: 'ok',
  partial: 'warn',
  unavailable: 'danger',
  failed: 'danger',
}

const REPORT_SCHEDULE_STATUS_LABELS: Record<AnalyticsReportSchedule['status'], string> = {
  active: '動いている',
  paused: '止めている',
  archived: 'しまった',
}
const REPORT_SCHEDULE_STATUS_TONES: Record<AnalyticsReportSchedule['status'], ChipTone> = {
  active: 'ok',
  paused: 'neutral',
  archived: 'neutral',
}

function reportScheduleCadenceLabel(schedule: AnalyticsReportSchedule): string {
  return schedule.cadence === 'weekly'
    ? `毎週${'日月火水木金土'[schedule.weekday ?? 0]}曜 ${schedule.sendTime}`
    : `毎月${schedule.monthDay}日 ${schedule.sendTime}`
}

/*
 * R463: 保存した時点の結果を読む部品。履歴から数値・条件へ到達させる。
 *
 * 結果の形は分析の種類で違う（クロス・ファネル）ので、葉の値を
 * そのまま並べる。0は「0件」と出し、null・欠けは「未取得」と
 * 分ける。現在の再集計で過去結果を置き換えることはしない。
 */
function summarizeSnapshotResult(result: unknown, limit = 12): Array<{ path: string; text: string }> {
  const rows: Array<{ path: string; text: string }> = []
  const visit = (node: unknown, path: string, depth: number) => {
    if (rows.length >= limit || depth > 3) return
    if (node === null || node === undefined) {
      rows.push({ path, text: '未取得' })
      return
    }
    if (typeof node === 'number' || typeof node === 'string' || typeof node === 'boolean') {
      rows.push({ path, text: typeof node === 'number' ? formatNumber(node) : String(node) })
      return
    }
    if (Array.isArray(node)) {
      if (node.length === 0) rows.push({ path, text: '0件' })
      node.slice(0, 4).forEach((item, index) => visit(item, `${path}[${index + 1}]`, depth + 1))
      if (node.length > 4) rows.push({ path, text: `ほか${node.length - 4}件` })
      return
    }
    if (typeof node === 'object') {
      const entries = Object.entries(node)
      if (entries.length === 0) rows.push({ path, text: '—' })
      entries.slice(0, 8).forEach(([key, child]) => visit(child, path ? `${path}・${key}` : key, depth + 1))
    }
  }
  visit(result, '', 0)
  return rows.filter((row) => row.path !== '' || row.text !== '—')
}

function SnapshotResultDetail({ snapshot }: { snapshot: SavedAnalyticsSnapshot }) {
  const rows = summarizeSnapshotResult(snapshot.result)
  return (
    <Disclosure size="compact" title="この時点の結果を見る" hint={`${SAVED_STATE_LABELS[snapshot.state]}`}>
      <dl className="grid gap-1 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">対象期間</dt>
          <dd className="text-ink tabular-nums">{formatAnalyticsDate(snapshot.periodFrom)}〜{formatAnalyticsDate(snapshot.periodTo)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">データ締切</dt>
          <dd className="text-ink tabular-nums">{formatAnalyticsDateTime(snapshot.dataCutoffAt)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">集計状態</dt>
          <dd className="text-ink">{SAVED_STATE_LABELS[snapshot.state]}</dd>
        </div>
        {rows.length === 0 && (
          <div className="text-ink-faint">保存された数値はありません。</div>
        )}
        {rows.map((row, index) => (
          <div key={index} className="flex justify-between gap-3">
            <dt className="text-ink-faint truncate" title={row.path}>{row.path || '結果'}</dt>
            <dd className="text-ink tabular-nums">{row.text}</dd>
          </div>
        ))}
      </dl>
      <p className="text-ink-faint mt-2 text-xs">保存時点の固定結果です。いま集計し直しても変わりません。</p>
    </Disclosure>
  )
}

function SavedAnalyticsTab({ accountId, onCountChange, canManage }: {
  accountId: string
  onCountChange?: (count: number | null) => void
  canManage: boolean
}) {
  const [items, setItems] = useState<SavedAnalyticsSummary[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [snapshots, setSnapshots] = useState<SavedAnalyticsSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [error, setError] = useState('')
  const [schedules, setSchedules] = useState<AnalyticsReportSchedule[]>([])
  // R454: しまった1回送信の直近分（一覧から消えても失敗に気づけるように）。
  const [recentOneTime, setRecentOneTime] = useState<RecentOneTimeReport[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(true)
  const [schedulesError, setSchedulesError] = useState('')
  const [scheduleBusyId, setScheduleBusyId] = useState('')
  // R462: 履歴の失敗は一覧の失敗と分ける。一覧の取得済み件数を
  // 履歴の失敗で隠さないし、回復したら古い案内を消す。
  const [snapshotError, setSnapshotError] = useState('')
  // 一覧・履歴の取り直し用。選んだ分析や検索語はそのままに、同じ取得だけをやり直す。
  const [savedReload, setSavedReload] = useState(0)
  const [snapshotReload, setSnapshotReload] = useState(0)
  const [archiveTarget, setArchiveTarget] = useState<AnalyticsReportSchedule | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setItems([])
    setSelectedId('')
    setSnapshots([])
    setError('')
    void api.analytics.saved
      .list(accountId)
      .then((response) => {
        if (!active) return
        if (!response.success) throw new Error(response.error)
        setItems(response.data)
        setSelectedId(response.data[0]?.id ?? '')
        // 件数表示はこの取得結果を使い回す(点検#508軽9)。タブ名のためだけにもう1回叩かない。
        onCountChange?.(response.data.length)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '保存した分析を確認できませんでした')
        onCountChange?.(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [accountId, savedReload])

  const schedulesAlive = useRef(true)
  useEffect(() => () => {
    schedulesAlive.current = false
  }, [])
  // R456: 再読込の応答も「どのアカウントへ向けた取得か」で比べる。
  // マウントの有無だけでは、アカウント切替後に遅い旧応答が
  // 新しい一覧へ上書きする。世代が変わっていたら捨てる。
  const schedulesGen = useRef(0)

  const reloadSchedules = useCallback(() => {
    const gen = (schedulesGen.current += 1)
    setSchedulesLoading(true)
    void api.analytics.reportSchedules
      .list(accountId)
      .then((response) => {
        if (!schedulesAlive.current || gen !== schedulesGen.current) return
        if (!response.success) throw new Error(response.error)
        setSchedules(response.data.items)
        setRecentOneTime(response.data.recentOneTime ?? [])
      })
      .catch((caught: unknown) => {
        if (!schedulesAlive.current || gen !== schedulesGen.current) return
        // ★V7 `x63W5x`：接続切れの英語（`Failed to fetch`）をそのまま出さない。
        setSchedulesError(caught instanceof TypeError ? '定期レポートを確認できませんでした' : caught instanceof Error ? caught.message : '定期レポートを確認できませんでした')
      })
      .finally(() => {
        if (schedulesAlive.current && gen === schedulesGen.current) setSchedulesLoading(false)
      })
  }, [accountId])

  useEffect(() => {
    let active = true
    // 切替で旧アカウント向けの再読込応答を無効にする（R456）。
    schedulesGen.current += 1
    setSchedulesLoading(true)
    setSchedules([])
    setRecentOneTime([])
    setSchedulesError('')
    // R456: アカウントが変わったら前の確認窓は閉じる。対象だけ残すと
    // 別アカウントへ操作要求を送る原因になる。
    setArchiveTarget(null)
    void api.analytics.reportSchedules
      .list(accountId)
      .then((response) => {
        if (!active) return
        if (!response.success) throw new Error(response.error)
        setSchedules(response.data.items)
        setRecentOneTime(response.data.recentOneTime ?? [])
      })
      .catch((caught: unknown) => {
        if (!active) return
        // ★V7 `x63W5x`：接続切れの英語（`Failed to fetch`）をそのまま出さない。
        setSchedulesError(caught instanceof TypeError ? '定期レポートを確認できませんでした' : caught instanceof Error ? caught.message : '定期レポートを確認できませんでした')
      })
      .finally(() => {
        if (active) setSchedulesLoading(false)
      })
    return () => {
      active = false
    }
  }, [accountId])

  const changeScheduleStatus = async (schedule: AnalyticsReportSchedule, status: 'active' | 'paused' | 'archived') => {
    setScheduleBusyId(schedule.id)
    setSchedulesError('')
    try {
      const response = await api.analytics.reportSchedules.setStatus(accountId, schedule.id, {
        status,
        expectedUpdatedAt: schedule.updatedAt,
      })
      if (!response.success) {
        // 先に誰かが変えていたら最新を読み直してから知らせる。
        setSchedulesError(response.error)
        reloadSchedules()
        return
      }
      setSchedules((current) => status === 'archived'
        ? current.filter((item) => item.id !== schedule.id)
        : current.map((item) => (item.id === schedule.id ? response.data : item)))
      setArchiveTarget(null)
    } catch (caught) {
      setSchedulesError(caught instanceof Error ? caught.message : '定期レポートを更新できませんでした')
    } finally {
      setScheduleBusyId('')
    }
  }

  useEffect(() => {
    if (!selectedId) {
      setSnapshots([])
      setSnapshotError('')
      return
    }
    let active = true
    setSnapshotLoading(true)
    setSnapshots([])
    // R462: 取り直しを始めたら古い失敗案内は消す。成功時も消す。
    // 一覧の error とは別の棚に置き、一覧KPIを隠さない。
    setSnapshotError('')
    void api.analytics.saved
      .snapshots(accountId, selectedId)
      .then((response) => {
        if (!active) return
        if (!response.success) throw new Error(response.error)
        setSnapshots(response.data)
        setSnapshotError('')
      })
      .catch((caught: unknown) => {
        if (active) setSnapshotError(caught instanceof Error ? caught.message : '結果の履歴を確認できませんでした')
      })
      .finally(() => {
        if (active) setSnapshotLoading(false)
      })
    return () => {
      active = false
    }
  }, [accountId, selectedId, snapshotReload])

  const selected = items.find((item) => item.id === selectedId) ?? null
  const visibleItems = useMemo(
    () => items.filter((item) => `${item.name} ${item.createdByName}`.toLowerCase().includes(query.trim().toLowerCase())),
    [items, query],
  )
  // 監査 R226: 絞り込みで選んだ項目が見えなくなったら、見えている先頭へ
  // 選び直す。0件なら選択を外す——条件に合わない分析の履歴を出し続けない。
  useEffect(() => {
    if (!visibleItems.some((item) => item.id === selectedId)) {
      setSelectedId(visibleItems[0]?.id ?? '')
    }
  }, [visibleItems, selectedId])
  // ANALYTICS-05: 「定義が古い」のは版ずれだけを数える。未取得・失敗は
  // 集計状態の話で、定義の新旧とは別の軸——混ぜると、新しい定義で
  // まだ集計していないものと、単に取れなかったものが区別できない。
  const staleCount = items.filter((item) => item.latestSnapshot?.definitionStale).length
  const exportSaved = () => downloadCsv('analytics-saved.csv', [
    ['分析名', '種類', '作った人', '定義版', '更新日時', '集計状態', '保存結果数'],
    ...visibleItems.map((item) => [
      item.name,
      item.kind === 'cross' ? 'クロス分析' : 'ファネル',
      item.createdByName,
      item.currentVersionNumber,
      item.updatedAt,
      item.latestSnapshot
        ? `${SAVED_STATE_LABELS[item.latestSnapshot.state]}${item.latestSnapshot.definitionStale ? '（旧版の結果・更新後未集計）' : ''}`
        : null,
      item.snapshotCount,
    ]),
  ])

  return (
    <div data-design-node="bglah" className="space-y-4">
      {/*
        ★V7 `x63W5x`：取れない KPI は「—」。失敗は「読み込めませんでした」と
        言い分け、0（本当に0件）と混ぜない。
      */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard title="保存した分析" value={error ? null : items.length} unit="件" detail={error ? '読み込めませんでした' : 'クロス分析とファネル'} loading={loading} />
        <KpiCard title="保存結果数" value={error ? null : items.reduce((sum, item) => sum + item.snapshotCount, 0)} unit="件" detail={error ? '読み込めませんでした' : '時点ごとに固定した結果'} loading={loading} />
        <KpiCard title="定期レポート" value={error || schedulesError ? null : schedules.length} unit="件" detail={error || schedulesError ? '読み込めませんでした' : `動いている ${schedules.filter((schedule) => schedule.status === 'active').length}・止めている ${schedules.filter((schedule) => schedule.status === 'paused').length}`} loading={loading || schedulesLoading} />
        <KpiCard title="定義が古いもの" value={error ? null : staleCount} unit="件" detail={error ? '読み込めませんでした' : 'いまの定義でまだ集計していないもの'} loading={loading} />
        <KpiCard title="選んだ分析の履歴" value={selected ? selected.snapshotCount : null} unit="件" detail={selected?.name ?? (error ? '読み込めませんでした' : '分析を選んでください')} loading={loading} />
      </div>
      <Notice tone="info">
        <p className="font-semibold">条件の定義と集計結果を分けて保存しています</p>
        <p className="mt-1 text-xs">
          あとから条件が変わっても、保存時点の結果は書き換わりません。定期レポートはこの下の一覧で止めたり変えたりできます。
        </p>
      </Notice>

      <section className="bg-canvas rounded-card border-hairline overflow-hidden border">
        <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">定期レポート</h2>
          <div className="flex items-center gap-2">
            <span className="text-ink-faint text-xs">{schedulesLoading ? '確認中' : schedulesError ? '—' : `${schedules.length}件`}</span>
            {canManage && <Button href="/analytics/reports/new" variant="secondary">定期レポートを作る</Button>}
          </div>
        </div>
        {schedulesError && (
          <div className="text-danger border-hairline flex items-center justify-between gap-2 border-b px-4 py-2 text-xs" role="alert">
            <span>{schedulesError}</span>
            {/* 読み直しの失敗ではエラーを上書きしてもよいが、版ずれの通知は
                reloadSchedules内で消すと「別の画面で先に更新されました」が
                一瞬で消えてしまう。消すのは手でやり直したこの入口だけ。 */}
            <Button variant="secondary" disabled={schedulesLoading} onClick={() => { setSchedulesError(''); reloadSchedules() }}>もう一度確認</Button>
          </div>
        )}
        {schedulesLoading ? (
          <p className="text-ink-faint p-8 text-center text-sm">定期レポートを読み込んでいます</p>
        ) : schedules.length === 0 ? (
          // 取得失敗のまま「まだありません」と出すと、未作成と見分けがつかない。
          // 失敗は上のバナーだけにして、空の主張はしない。
          schedulesError ? null : (
          <div className="p-8 text-center">
            <p className="text-ink text-sm font-medium">定期レポートはまだありません</p>
            <p className="text-ink-faint mt-2 text-sm">決まった曜日や日に、集計結果をメールやLINEへ届けられます。</p>
          </div>
          )
        ) : (
          <table className="w-full table-fixed">
            <thead>
              <TableHeadRow>
                <Th>レポート名</Th>
                <Th>間隔</Th>
                <Th>次に届く予定</Th>
                <Th>状態</Th>
                <Th align="right">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {schedules.map((schedule) => (
                <tr key={schedule.id} className="text-sm">
                  <td className="text-ink truncate px-4 py-3 font-medium" title={schedule.name}>{schedule.name}</td>
                  <td className="text-ink-secondary px-3 py-3 text-sm whitespace-nowrap">
                    {schedule.isOneTime ? '1回だけ' : reportScheduleCadenceLabel(schedule)}
                  </td>
                  <td className="text-ink-secondary px-3 py-3 text-xs tabular-nums whitespace-nowrap">
                    {schedule.status === 'paused' ? '—' : formatAnalyticsDateTime(schedule.nextRunAt)}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <Chip tone={REPORT_SCHEDULE_STATUS_TONES[schedule.status]}>
                      {REPORT_SCHEDULE_STATUS_LABELS[schedule.status]}
                    </Chip>
                  </td>
                  <td className="px-4 py-2">
                    {canManage && (
                      <div className="flex justify-end gap-2 whitespace-nowrap">
                        {!schedule.isOneTime && (
                          <Button key="edit" href={`/analytics/reports/new?id=${schedule.id}`} variant="secondary">内容を変える</Button>
                        )}
                        {schedule.status === 'active' && !schedule.isOneTime && (
                          <Button
                            key="pause"
                            variant="secondary"
                            disabled={scheduleBusyId === schedule.id}
                            onClick={() => void changeScheduleStatus(schedule, 'paused')}
                          >止める</Button>
                        )}
                        {schedule.status === 'paused' && (
                          <Button
                            key="resume"
                            variant="secondary"
                            disabled={scheduleBusyId === schedule.id}
                            onClick={() => void changeScheduleStatus(schedule, 'active')}
                          >また送る</Button>
                        )}
                        {!schedule.isOneTime && (
                          <Button
                            key="archive"
                            variant="secondary"
                            className="border-danger text-danger"
                            disabled={scheduleBusyId === schedule.id}
                            onClick={() => setArchiveTarget(schedule)}
                          >しまう</Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/*
        R454: 1回だけ送った直近の結果。一覧からは消えるため、
        ここから失敗理由・宛先別結果（依頼IDの画面）へ進める。
      */}
      {recentOneTime.length > 0 && (
        <section className="bg-canvas rounded-card border-hairline overflow-hidden border">
          <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">1回だけ送った結果</h2>
            <span className="text-ink-faint text-xs">{recentOneTime.length}件</span>
          </div>
          <ul className="divide-hairline divide-y">
            {recentOneTime.map((item) => (
              <li key={item.schedule.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-ink truncate text-sm font-medium" title={item.schedule.name}>
                    {item.schedule.name}
                  </p>
                  <p className="text-ink-secondary mt-1 text-xs">
                    {item.lastRun ? runStateLabel(item.lastRun.state) : 'まだ送信されていません'}
                    {item.lastRun && runErrorLabel(item.lastRun.errorCode, item.lastRun.state)
                      ? `：${runErrorLabel(item.lastRun.errorCode, item.lastRun.state)}`
                      : ''}
                  </p>
                </div>
                <Button href={`/analytics/reports/new?id=${item.schedule.id}`} variant="secondary">
                  結果を見る
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="saved-analysis-search" className="sr-only">分析名・作った人で探す</label>
        <input id="saved-analysis-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="分析名・作った人で探す" className="h-10 min-w-64 flex-1 rounded-control border border-hairline bg-canvas px-3 text-sm" />
        <AnalyticsExportButton onClick={exportSaved} disabled={visibleItems.length === 0} />
      </div>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-10 text-center text-sm">
          保存した分析を読み込んでいます
        </div>
      ) : error && items.length === 0 ? (
        // ★V7 `x63W5x`：ピンクの箱ではなく、一覧の場所の ListState error だけ出す。
        // 口の生文言（英語など）は出さず、日本語の決まった文で出す。
        <ListState
          kind="error"
          title="保存した分析を読み込めませんでした"
          description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。"
          onRetry={() => setSavedReload((n) => n + 1)}
        />
      ) : items.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline border p-10 text-center">
          <p className="text-ink font-medium">保存した分析はまだありません</p>
          <p className="text-ink-faint mt-2 text-sm">クロス分析かファネルを集計し、その結果を保存してください。</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="bg-canvas rounded-card border-hairline overflow-hidden border">
            <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">保存した分析</h2>
              <span className="text-ink-faint text-xs">{items.length}件</span>
            </div>
            <div className="overflow-hidden">
              <table className="w-full table-fixed">
                <thead>
                  <TableHeadRow>
                    <Th>分析名</Th>
                    <Th>種類</Th>
                    <Th>作成者</Th>
                    <Th>定義版</Th>
                    <Th>最新の期間</Th>
                    <Th>集計状態</Th>
                    <Th align="right">結果</Th>
                  </TableHeadRow>
                </thead>
                <tbody className="divide-hairline divide-y">
                  {visibleItems.length === 0 && (
                    <tr><td colSpan={7} className="text-ink-faint p-8 text-center text-sm">
                      条件に合う保存済み分析はありません。
                      <button type="button" className="text-action ml-2 font-semibold hover:underline" onClick={() => setQuery('')}>キャンセル</button>
                    </td></tr>
                  )}
                  {visibleItems.map((item) => {
                    const active = selectedId === item.id
                    return (
                      <tr key={item.id} className={active ? 'bg-accent-soft' : 'hover:bg-canvas-sunken'}>
                        <td className="p-0">
                          <button
                            type="button"
                            onClick={() => setSelectedId(item.id)}
                            className="text-ink w-full truncate px-4 py-3 text-left text-sm font-medium"
                            title={item.name}
                            aria-pressed={active}
                          >
                            {item.name}
                          </button>
                        </td>
                        <td className="text-ink-secondary px-3 py-3 text-sm">{item.kind === 'cross' ? 'クロス分析' : 'ファネル'}</td>
                        <td className="text-ink-secondary truncate px-3 py-3 text-sm" title={item.createdByName}>{item.createdByName}</td>
                        <td className="text-ink-secondary px-3 py-3 text-sm">第{item.currentVersionNumber}版</td>
                        <td className="text-ink-secondary px-3 py-3 text-xs tabular-nums">
                          {item.latestSnapshot
                            ? `${formatAnalyticsDate(item.latestSnapshot.periodFrom)}〜${formatAnalyticsDate(item.latestSnapshot.periodTo)}`
                            : '—'}
                        </td>
                        <td className="px-3 py-3 text-xs">
                          {item.latestSnapshot ? (
                            <span className="inline-flex flex-wrap items-center gap-1">
                              <Chip tone={SAVED_STATE_TONES[item.latestSnapshot.state]}>
                                {SAVED_STATE_LABELS[item.latestSnapshot.state]}
                              </Chip>
                              {/* 集計状態とは別に、写しが旧版の定義で取られた
                                  ことを出す（ANALYTICS-05/06）。 */}
                              {item.latestSnapshot.definitionStale && (
                                <Chip tone="warn">更新後未集計</Chip>
                              )}
                            </span>
                          ) : <span className="text-ink-faint">—</span>}
                        </td>
                        <td className="text-ink-secondary px-3 py-3 text-right text-sm">{item.snapshotCount}件</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="bg-canvas rounded-card border-hairline border p-4">
            <h2 className="text-ink text-sm font-semibold">結果の履歴</h2>
            {selected && (
              <p className="text-ink-faint mt-1 truncate text-xs" title={selected.name}>
                {selected.name} ／ 定期レポート {schedulesLoading ? '確認中' : schedulesError ? '—' : `${schedules.filter((schedule) => schedule.savedAnalysisIds.includes(selected.id)).length}件`}
              </p>
            )}
            {/*
              ★V7 `x63W5x`：補助のデータ（結果の履歴）だけ取れないときは、
              その場所に小さく1行だけ。赤字・口の生文言にしない。
              R462: 一覧の error ではなく履歴専用の error を見る。
              取り直しの成功・別の分析の取得成功で消える。
            */}
            {snapshotError && (
              <p className="text-ink-secondary mt-3 text-xs" role="alert">
                結果の履歴を読み込めませんでした。
                <button type="button" className="text-action ml-2 font-semibold hover:underline" onClick={() => setSnapshotReload((n) => n + 1)}>もう一度</button>
              </p>
            )}
            {snapshotLoading ? (
              <p className="text-ink-faint mt-4 text-sm">結果を読み込んでいます</p>
            ) : !selected ? (
              <p className="text-ink-faint mt-4 text-sm">一覧から分析を選んでください</p>
            ) : snapshots.length === 0 ? (
              <p className="text-ink-faint mt-4 text-sm">保存された結果はありません</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {snapshots.map((snapshot) => (
                  <li key={snapshot.id} className="border-hairline rounded-control border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink text-xs font-medium">
                        {snapshot.sourceKind === 'cross' ? 'クロス分析' : 'ファネル'}
                      </span>
                      <span className="text-ink-faint text-xs">{SAVED_STATE_LABELS[snapshot.state]}</span>
                    </div>
                    <p className="text-ink-secondary mt-2 text-xs tabular-nums">
                      {formatAnalyticsDate(snapshot.periodFrom)}〜{formatAnalyticsDate(snapshot.periodTo)}
                    </p>
                    <p className="text-ink-faint mt-1 text-xs tabular-nums">
                      データ締切 {formatAnalyticsDateTime(snapshot.dataCutoffAt)}
                    </p>
                    {/* R463: 履歴1件ごとに固定結果を開ける。 */}
                    <div className="mt-2">
                      <SnapshotResultDetail snapshot={snapshot} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {/* R463: 保存結果のCSVは一覧のCSVと分ける。 */}
            {selected && snapshots.length > 0 && (
              <div className="mt-3">
                <AnalyticsExportButton
                  label="この分析の結果をCSVで書き出す"
                  onClick={() => downloadCsv(`analytics-saved-${selected.id}.csv`, [
                    ['対象期間', 'データ締切', '集計状態', '結果の要約'],
                    ...snapshots.map((snapshot) => [
                      `${snapshot.periodFrom}〜${snapshot.periodTo}`,
                      snapshot.dataCutoffAt,
                      SAVED_STATE_LABELS[snapshot.state],
                      summarizeSnapshotResult(snapshot.result, 6).map((row) => `${row.path || '結果'}: ${row.text}`).join(' / ').slice(0, 200),
                    ]),
                  ])}
                  disabled={false}
                />
              </div>
            )}
          </aside>
        </div>
      )}
      <ConfirmDialog
        open={archiveTarget !== null}
        title="定期レポートをしまいますか"
        description={archiveTarget ? `「${archiveTarget.name}」をしまうと、一覧から消えて今後の送信も止まります。` : ''}
        confirmLabel="しまう"
        destructive
        busy={archiveTarget !== null && scheduleBusyId === archiveTarget.id}
        onConfirm={() => { if (archiveTarget) void changeScheduleStatus(archiveTarget, 'archived') }}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  )
}

function AnalyticsInner() {
  /*
   * 旧キー `clicks`（Search Console 側の以前の表記）で来たURLも
   * URLクリックへ寄せる。知らない値は先頭（友だちの増減）へ落ちる
   * useMergedTab の既定のままにすると、調べたい分析と違う画面が開く。
   */
  const legacyTab = useMergedTab(TABS, 'tab', undefined, { clicks: 'url-clicks' })
  /*
   * N-256: 成果地点の一覧から「使う場所を足す」で渡された地点を
   * ファネル作成へ引き渡す。`?tab=funnel&conversionPointId=…` が入口。
   */
  const params = useSearchParams()
  const tab = params.get('view') === 'conversion-report' ? 'conversion-report' : legacyTab
  usePageTitle('分析')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const presetConversionId = params.get('conversionPointId')
  const presetConversionName = params.get('conversionPointName') ?? ''
  const presetConversion = presetConversionId
    ? { id: presetConversionId, name: presetConversionName }
    : null
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const scope = `${selectedAccountId}:${tab}`
  const [exportAction, setExportAction] = useState<(ExportAction & { scope: string }) | null>(null)
  const registerExport = useCallback((action: ExportAction | null) => setExportAction(action ? { ...action, scope } : null), [scope])
  const [canManage, setCanManage] = useState(false)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1351px)')
    const read = () => setNarrow(query.matches)
    read(); query.addEventListener('change', read)
    return () => query.removeEventListener('change', read)
  }, [])
  const [savedCount, setSavedCount] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (!active || !response.success) return
      setCanManage(response.data.role === 'owner' || response.data.role === 'admin')
    })
    return () => {
      active = false
    }
  }, [])
  // 保存件数は保存タブの取得結果を使い回す(点検#508軽9)。開く前は件数を出さない。
  useEffect(() => {
    setSavedCount(null)
  }, [selectedAccountId])
  if (accountLoading) {
    return <div className="text-ink-faint p-8 text-center text-sm">分析を読み込んでいます</div>
  }
  if (!selectedAccountId) {
    return <div className="text-ink-faint p-8 text-center text-sm">LINE公式アカウントを選んでください</div>
  }
  return (
    <div data-analytics-design="v6" className="v8-ro-analytics-page" data-design-node={tab === 'friends' ? (canManage ? (narrow ? 'eEhYU' : 'ws9wt') : 'L4Uov') : ({ reactions: 'yvOtn', routes: 'PFe9c', usage: 'N8ZrUl', cross: 'u5CuB8', funnel: 'DkRDE', 'url-clicks': 'iK4cQ', saved: 'bglah', 'conversion-report': 'AzrZq' } as Record<string, string>)[tab]}>
      <ReadonlyHeaderV8 titleDisplay={['cross', 'saved', 'conversion-report'].includes(tab) ? 'auto' : 'always'} title="分析" description="友だちの増減・配信の反応・経路と成果を、期間を決めて見ます。気になる見かたは保存して、レポートで毎週届けられます。" actions={<><Button variant="secondary" disabled={!exportAction || exportAction.scope !== scope || exportAction.disabled} onClick={() => exportAction?.scope === scope && exportAction.onClick()}><Download size={14} aria-hidden="true" />CSV で書き出す</Button>{canManage ? <Button variant="primary" href="/analytics/reports/new"><Plus size={14} aria-hidden="true" />レポートを作る</Button> : <Button disabled title="閲覧のみのため、レポートは作れません">レポートを作る</Button>}</>} /><AnalyticsNavigationV8 active={tab} savedCount={savedCount} />{!canManage && <div className="v8-ro-analytics-readOnly" role="status">閲覧のみです。分析・CSVの書き出しはできます。作成や変更はできません。</div>}
      <AnalyticsExportContext.Provider value={registerExport}><div className="v8-ro-analytics-content">
      {tab === 'conversion-report' && <ConversionReportV8 accountId={selectedAccountId} />}
      {tab === 'friends' && <FriendsOverviewTab key={selectedAccountId} accountId={selectedAccountId} />}
      {tab === 'reactions' && <ReactionsOverviewTab key={selectedAccountId} accountId={selectedAccountId} />}
      {tab === 'routes' && <RoutesOverviewTab key={selectedAccountId} accountId={selectedAccountId} />}
      {tab === 'usage' && <UsageOverviewTab key={selectedAccountId} accountId={selectedAccountId} />}
      {/*
        アカウントを切り替えたらクロス分析は作り直す(key)。前のアカウントへ投げた
        通信が後から返っても、その応答を受け取る画面はもう無い。中の世代fenceと
        合わせて、前のアカウントの結果・待ち順・対象者が新しい画面へ入らない。
      */}
      {tab === 'cross' && (
        <CrossTab key={selectedAccountId} accountId={selectedAccountId} canManage={canManage} />
      )}
      {tab === 'funnel' && (
        <FunnelTab accountId={selectedAccountId} canManage={canManage} presetConversion={presetConversion} />
      )}
      {tab === 'url-clicks' && <UrlClicksOverviewTab key={selectedAccountId} accountId={selectedAccountId} />}
      {tab === 'saved' && <SavedAnalyticsTab accountId={selectedAccountId} onCountChange={setSavedCount} canManage={canManage} />}
      </div></AnalyticsExportContext.Provider>
    </div>
  )
}

/*
 * V8 のときだけ新しい分析（src/v8/analytics）。ファネルの作る・編集フォームと
 * 結果の保存欄は今の部品を渡す（src/v8 から @/app を読めないため）。
 */
/* 新しい分析（V8）へ渡す今の部品：ファネルの作る・編集フォームと、結果の保存欄。 */
const ANALYTICS_V8_SLOTS: AnalyticsSlotsV8 = {
  // ★V8 のファネルを作る・直すは src/v8 の窓（板 `VDPz5`）。v7 は下の FunnelForm のまま。
  renderFunnelForm: ({ accountId, edit, presetConversion, onCancel, onCreated }) => <FunnelFormV8 accountId={accountId} edit={edit} presetConversion={presetConversion} onCancel={onCancel} onCreated={onCreated} />,
  renderSave: ({ accountId, sourceKind, sourceResultId, defaultName }) => <SaveAnalysisAction accountId={accountId} sourceKind={sourceKind} sourceResultId={sourceResultId} defaultName={defaultName} compact={sourceKind === 'cross'} />,
  funnelStepKindsLabel: FUNNEL_STEP_KIND_OPTIONS.map((item) => item.label).join('・'),
}

export default function AnalyticsPage() {
  const theme = useAdminTheme()
  if (theme === 'v8') return <AnalyticsV8 slots={ANALYTICS_V8_SLOTS} />
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <AnalyticsInner />
    </Suspense>
  )
}
