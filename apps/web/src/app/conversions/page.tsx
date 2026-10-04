'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RowActions } from '@/components/shared/row-actions'
import {
  api,
  describeSaveFailure,
  type ConversionDefinitionList,
  type ConversionDefinitionListItem,
  type ConversionDefinitionDeleteImpact,
  type ConversionDefinitionReport,
  type ConversionDefinitionFilter,
  type ConversionDefinitionState,
  type ConversionDefinitionEvent,
  type ConversionIngestionEvent,
} from '@/lib/api'
import type { ConversionPoint } from '@line-crm/shared'
import { deduplicationLabel } from './dedup'
import { originInfoOf } from './origin-labels'
import { readExclusionCondition, readExclusionMemo } from './conversion-exclusion'
import { findConditionDraftIssue, pruneCondition } from '@/components/shared/condition-builder'
import KpiCard from '@/components/shared/kpi-card'
import styles from './conversions-v8.module.css'

/**
 * 数え方を運用者の言葉にする。既定（manual）も省略せずに出す。
 *
 * R41: 「何が起きたら数えるか」は起点の対応表(origin-labels)が正本。
 * 以前は webhook を一律に注文の説明で書いていたため、タグ起点でも注文の
 * 説明になっていた。「URL到達」だと、誰がどのURLに来たときの話なのかが
 * 読み取れないので、URL到達だけ対象URLを添える。
 */
function toEditForm(item: ConversionDefinitionListItem): EditForm {
  return {
    name: item.name,
    sourceType: item.sourceType,
    deduplicationMode: item.deduplicationMode,
    deduplicationWindowDays: item.deduplicationWindowDays == null ? '' : String(item.deduplicationWindowDays),
    valueMode: item.valueMode,
    fixedValue: item.value == null ? '' : String(item.value),
    reversalPolicy: item.reversalPolicy,
    attributionDays: item.attributionDays == null ? '' : String(item.attributionDays),
    targetUrl: item.targetUrl ?? '',
    exclusion: readExclusionCondition(item.sourceConfig),
    exclusionMemo: readExclusionMemo(item.sourceConfig),
  }
}

function measureLabel(method: ConversionPoint['measureMethod']): string {
  if (method === 'url_reach') return '指定ページへの到達'
  // R41: webhook は注文・タグ・フォームなど起点が違う。起点の説明は
  // 上の行(originInfoOf)が出すので、ここは起点に依らない言葉にする。
  if (method === 'webhook') return '自動で検知'
  return '手動で記録'
}

type StatusFilter = 'all' | ConversionDefinitionFilter

/**
 * 種別を運用者の言葉にする。
 *
 * 設計は「購入」「申込・登録」の2つでまとめている。実装の eventType は9種
 * あるので、設計の2つに寄せられるものは寄せ、残りはそのまま出す。
 */
const EVENT_TYPE_LABELS: Record<string, string> = {
  purchase: '購入',
  form_submit: '申込・登録',
  friend_add: '申込・登録',
  visit: '来店・参加',
  // 作る画面が以前に送っていた値。過去に作った行がこれで残っている。
  signup: '申込・登録',
  reserve: '来店・参加',
  other: 'その他',
  scenario_step: 'シナリオ到達',
  rich_menu_tap: 'リッチメニュー',
  url_click: 'URLクリック',
  keyword_sent: 'キーワード',
  liff_view: 'LIFF閲覧',
  custom: 'その他',
  ec_order_confirmed: '購入',
  ec_subscription_confirmed: '購入',
  form_submitted: '申込・登録',
  reservation_confirmed: '来店・参加',
  webinar_completed: 'その他',
}

import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import { usePageTitle } from '@/components/shell/page-chrome'
import { conversionsTabTitle } from './conversions-tab-title'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { AffiliatorsTab, OffersTab, ApprovalQueue } from '@/app/affiliates/tabs'
import AffiliatePaymentTab from '@/app/affiliates/payment-tab'
import { useAccount } from '@/contexts/account-context'
import { TableHeadRow, Th } from '@/components/shared/table'
import MobileTableCards from '@/components/shared/mobile-table-cards'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import ListToolbar from '@/components/shared/list-toolbar'
import Select from '@/components/shared/select'
import FilterChip from '@/components/shared/filter-chip'
import KpiCollapse from '@/components/ui/kpi-collapse'
import ListRange from '@/components/ui/list-range'
import { formatNumber } from '@/lib/format'
import {
  ConversionDetailDialog,
  ConversionEditDialog,
  ConversionReversalDialog,
  ConversionStopDialog,
  EDIT_VALUE_MODE_LABELS,
  STATE_LABELS,
  sourceTriggerLabel,
  usageLabel,
  type ConversionStopAction,
  type EditForm,
} from './_components/conversion-dialogs'
import ConversionPointsV8 from './conversion-points-v8'

const DAY_MS = 24 * 60 * 60 * 1000

function definitionRange(days: number): { from: string; to: string } {
  const end = new Date()
  const start = new Date(end.getTime() - (days - 1) * DAY_MS)
  const format = (value: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value)
  return { from: format(start), to: format(end) }
}

/**
 * 受け取ったCSVをそのまま保存させる。一覧とレポートで二重に書いていた
 * 範囲再計算とファイル名違いだけの重複をここに寄せる(#513 L2)。
 */
function downloadCsvBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(href)
}

function rangeLabel(days: number): string {
  const { from, to } = definitionRange(days)
  const format = (value: string) => {
    const [, month, day] = value.split('-')
    return `${Number(month)}/${Number(day)}`
  }
  return `この${days}日（${format(from)}〜${format(to)}）`
}

/**
 * 設計 6-1 は1画面に5タブ。並びは設計のまま、素のURLでは主役の
 * 「成果地点（CV）」を開く。
 *
 * これまでは /conversions が2タブ、その中に入れていた /affiliates が
 * さらに3タブを持つ二重構造だった。同じ ?tab= が2つの意味を持つので、
 * 「案件を開くURL」を人に送れなかった。
 */
const MERGED_TABS = [
  { key: 'affiliates', label: 'アフィリエイター' },
  { key: 'offers', label: '案件' },
  { key: 'approvals', label: '成果承認' },
  { key: 'points', label: '成果地点' },
  { key: 'report', label: 'レポート' },
  /*
    **「支払い」を戻した。** 設計 `njLGA`（16-1-C）はこのタブを持つのに、
    `MERGED_TABS` に無かったので `?tab=payment` は既定タブへ落ち、
    **画面からは「無い」ことすら分からなかった**（#739 で未実装と判定した）。
    口は #763 で入ったので、読むだけの面をつなぐ。
  */
  { key: 'payment', label: '支払い' },
]

const DEFAULT_TAB = 'points'

/**
 * 並び順。**どれも読み込んだ行から数えられるものだけ**にしてある。
 * 設計は「CV数が多い順」しか描いていないが、CV数はレポートから引けるので
 * 実際に並べ替えられる。作れない並び（報酬順など）は足さない。
 */
type PointSort = 'cv-desc' | 'value-desc' | 'name'

const SORT_OPTIONS: Array<{ value: PointSort; label: string }> = [
  { value: 'cv-desc', label: 'CV数が多い順' },
  { value: 'value-desc', label: '成果単価が高い順' },
  { value: 'name', label: '成果地点名順' },
]

const PAGE_SIZE = 6

/**
 * 画面の並びと言葉を、口の並びに写す(#513 M3)。
 *
 * 口の `sort` は `count_desc`・`value_desc`・`updated_desc`・`name_asc`
 * の4つで、同値時は更新日・IDまで固定されている(共通一覧契約§3)。
 * 画面の3つの並びはその先頭3つに対応する。`unused`(使われていない)は
 * 口に無い絞りなので、完全に読み込んだあと画面で絞る。
 */
const SORT_TO_API: Record<PointSort, 'count_desc' | 'value_desc' | 'name_asc'> = {
  'cv-desc': 'count_desc',
  'value-desc': 'value_desc',
  'name': 'name_asc',
}

function ConversionsPageInner({ accountId, v8 }: { accountId: string | null; v8: boolean }) {
  /*
   * N-264: 作成画面が `?highlight=<作った行のID>` で戻ってくる。
   * 読み込んだ一覧の中でその行を見つけ、帯を出し・その頁へ移し・
   * 行を目立たせて、どれが作ったばかりの行か分かるようにする。
   */
  const highlightId = useSearchParams().get('highlight')
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null)
  const [definitions, setDefinitions] = useState<ConversionDefinitionList | null>(null)
  const [summaryReport, setSummaryReport] = useState<ConversionDefinitionReport | null>(null)
  // 5000 件の安全弁で止まったときだけ KPI に注記を出す。通常は false。
  const [listTruncated, setListTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PointSort>('cv-desc')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [loadFailed, setLoadFailed] = useState(false)
  /**
   * R596: 集計だけの失敗は一覧と分けて持つ。集計が読めなくても一覧は
   * 残し、集計の数値カードだけを「—」と再試行にする。loadFailed と一緒に
   * 倒すと、一覧まで消えて「登録したものが消えた」に見える。
   */
  const [reportFailed, setReportFailed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  /**
   * 読み込みの世代番号(#513 M6)。
   *
   * アカウントの高速切替や検索の連打で古い応答が残っていると、新しい
   * 表示を上書きしてしまう。応答が返った時点で番号が変わっていたら捨てる。
   */
  const loadSeq = useRef(0)
  /*
   * 今選ばれているアカウントの控え。再試行の遅れた応答が、切り替え後の
   * アカウントの表示を上書きしないよう、応答が返った時点で照合する。
   * effect の後より先に描画時の代入で最新化する（切り替え直後の
   * 応答との競合を狭めるため）。
   */
  const accountIdRef = useRef(accountId)
  accountIdRef.current = accountId
  /** 検索は1文字ごとに口を叩かず、少し待ってから読み直す。 */
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])
  /*
   * **ブラウザの `confirm()` を使わない。**
   *
   * 見た目がブラウザ任せで設計の確認窓（`J6x4Q` / `H2S1T4`）と違ううえ、
   * 画像比較にも写らない。成果地点を消すと、記録した成果もまとめて消える。
   * それを本文で読ませたいので、共通の `ConfirmDialog` へ移した。
   *
   * この画面はヘッダーのLINEアカウントを見ていない（`/api/conversions/points`
   * はアカウントで絞らない）ので、押した時点のアカウントを窓に固定する必要は
   * ない。
   */
  const [stopTarget, setStopTarget] = useState<ConversionDefinitionListItem | null>(null)
  const [stopImpact, setStopImpact] = useState<ConversionDefinitionDeleteImpact | null>(null)
  const [stopImpactLoading, setStopImpactLoading] = useState(false)
  const [stopAction, setStopAction] = useState<ConversionStopAction>('stop')
  const [replacementId, setReplacementId] = useState('')
  /** V8 の止める小窓の理由（必須）。v7 の窓には欄が無く、空のまま送る。 */
  const [stopReason, setStopReason] = useState('')
  const [detailTarget, setDetailTarget] = useState<ConversionDefinitionListItem | null>(null)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState('')
  /*
   * 編集（新版化）。開いたときの版を控えて、送るときにそのまま渡す（N-252）。
   * 別の人が先に直していたら口が409を返すので、勝手に上書きしない。
   */
  const [editTarget, setEditTarget] = useState<ConversionDefinitionListItem | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  // 起点に合わない金額の決め方を開いたときに既定へ戻した知らせ。選び直したら消える。
  const [editValueModeNotice, setEditValueModeNotice] = useState<string | null>(null)
  // N-268: 下書きの公開。版は開いた時点のものを渡し、409は読み直しで返す。
  const [publishing, setPublishing] = useState(false)
  /**
   * N-270: 外部受信の操作状態。平文の鍵は発行の応答でだけ返るため、
   * 一度だけ表示して閉じると二度と見えない。
   */
  const [ingestBusy, setIngestBusy] = useState<'' | 'issue' | 'toggle'>('')
  const [issuedSecret, setIssuedSecret] = useState('')
  const [ingestError, setIngestError] = useState('')
  const [ingestEvents, setIngestEvents] = useState<ConversionIngestionEvent[]>([])
  /**
   * IDEA-19: 成果1件ずつの記録。状態(確定・確認待ち・却下・取消)は
   * 口が導出済みのものをそのまま出す。数え方や計測方法を問わず読む。
   */
  const [definitionEvents, setDefinitionEvents] = useState<ConversionDefinitionEvent[]>([])
  const [eventsFailed, setEventsFailed] = useState(false)
  /*
   * #819: 成果の取り消し。元の行は消さず、理由つきの追記を台帳へ足す。
   * 「取消を戻す」も同じ追記で、純数は最新の追記から引き直される。
   * 取り消しの操作は owner/admin だけに出す。
   */
  const [reversalTarget, setReversalTarget] = useState<ConversionDefinitionEvent | null>(null)
  const [reversalKind, setReversalKind] = useState<'reverse' | 'restore'>('reverse')
  const [reversalReason, setReversalReason] = useState('')
  const [reversalBusy, setReversalBusy] = useState(false)
  const [reversalError, setReversalError] = useState('')
  const [canReverse, setCanReverse] = useState(false)

  /**
   * 一覧は検索・並びを口へ渡し、続く頁をすべて読む(#513 M2・M3)。
   *
   * 以前は先頭100件だけ読んで画面内で探していたので、101件目以降が
   * 「すべて N」と出ながら見えず、検索にも掛からなかった。口は
   * `q`・`sort`・`cursor/nextCursor` を受け付けるので、条件に合うものを
   * 残らず読む(50頁・5000件で止め、切れたら断る)。状態の絞り(`active`・`stopped`・
   * `unused`)は口に `unused` が無いため、完全な一覧のあと画面で絞る。
   * そうしても件数は狂わない(1頁の切り取りを再加工しない)。
   */
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setLoadFailed(false)
    setReportFailed(false)
    setDefinitions(null)
    setSummaryReport(null)
    setListTruncated(false)
    const range = definitionRange(30)
    const listParams = {
      ...range,
      lineAccountId: accountId ?? undefined,
      q: debouncedQuery || undefined,
      sort: SORT_TO_API[sort],
      limit: 100,
    }
    // cursor を辿って条件に合うものを残らず読む。安全弁として 50 頁
    // (5000 件)で止め、切れたら `truncated` で本文に断る(#505 重大2の流儀)。
    const fetchAllDefinitions = async (): Promise<{ data: ConversionDefinitionList; truncated: boolean } | null> => {
      const items: ConversionDefinitionList['items'] = []
      let cursor: string | undefined
      let first: ConversionDefinitionList | null = null
      for (let page = 0; page < 50; page += 1) {
        const response = await api.conversions.definitions({ ...listParams, cursor })
        if (!response.success || !Array.isArray(response.data.items)) return null
        if (!first) first = response.data
        items.push(...response.data.items)
        cursor = response.data.pagination.nextCursor ?? undefined
        if (!cursor) return { data: { ...response.data, items }, truncated: false }
      }
      return first ? { data: { ...first, items }, truncated: true } : null
    }
    const [listResult, reportResult] = await Promise.allSettled([
      fetchAllDefinitions(),
      api.conversions.definitionReport({ ...range, lineAccountId: accountId ?? undefined }),
    ])
    // 古い読み込みの応答は捨てる(#513 M6)。アカウント切替や検索連打で
    // 先に叩いた方が後に返っても、新しい表示を上書きしない。
    if (loadSeq.current !== seq) return
    if (listResult.status === 'fulfilled' && listResult.value !== null) {
      setDefinitions(listResult.value.data)
      setListTruncated(listResult.value.truncated)
    } else {
      setLoadFailed(true)
    }
    if (reportResult.status === 'fulfilled' && reportResult.value.success
      && Array.isArray(reportResult.value.data.byDefinition)) {
      setSummaryReport(reportResult.value.data)
    } else {
      // R596: 集計だけ読めないときも黙って「—」にしない。数値カードに
      // 失敗と再試行を出すため、由来を残す。
      setReportFailed(true)
    }
    // 古い読み込みは表示の後片付けもしない。新しい読み込みの
    // 「読み込み中」を先に消してしまうため（R596 回帰と同じ競合）。
    if (loadSeq.current === seq) setLoading(false)
  }, [accountId, debouncedQuery, sort])

  /**
   * R596: 集計だけを読み直す。一覧は触らないので、再試行のあいだも
   * 行は残る。復旧したら数値カードが数値へ戻る。
   *
   * 再試行の応答が遅れたとき、切り替え後のアカウントの表示を上書き
   * しない（R596 回帰）。`load` と同じ世代番号を進め、応答が返った
   * 時点で世代とアカウントを照合する。成功・失敗どちらの応答も捨てる。
   */
  const reloadReport = useCallback(async () => {
    const seq = ++loadSeq.current
    const requestAccountId = accountId
    const range = definitionRange(30)
    try {
      const response = await api.conversions.definitionReport({
        ...range, lineAccountId: accountId ?? undefined,
      })
      if (loadSeq.current !== seq) return
      if (accountIdRef.current !== requestAccountId) return
      if (response.success && Array.isArray(response.data.byDefinition)) {
        setSummaryReport(response.data)
        setReportFailed(false)
      } else {
        setReportFailed(true)
      }
    } catch {
      if (loadSeq.current !== seq) return
      if (accountIdRef.current !== requestAccountId) return
      setReportFailed(true)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  /**
   * 成果地点を消す。
   *
   * 処理中は受け付けない（二度押しで2回叩くと、2回目は404になって
   * 「消せませんでした」と出る。消えているのに失敗に見える）。
   * 失敗は握りつぶさず、窓の中に運用者の言葉で出す。
   */
  const openEdit = (target: ConversionDefinitionListItem) => {
    setDetailTarget(null)
    setEditTarget(target)
    const form = toEditForm(target)
    // 起点に金額が無いものは注文の金額を選べない(作成と同じ動き)。昔の版に
    // 合わない決め方が残っていたら、合う既定へ戻して知らせる。
    const allowed = originInfoOf(form.sourceType).valueModes
    if (!allowed.includes(form.valueMode)) {
      const fallback = originInfoOf(form.sourceType).defaultValueMode
      setEditForm({ ...form, valueMode: fallback })
      setEditValueModeNotice(
        `起点に注文の金額が無いため、金額の決め方を「${EDIT_VALUE_MODE_LABELS[fallback]}」に戻しました。`,
      )
    } else {
      setEditForm(form)
      setEditValueModeNotice(null)
    }
    setEditError('')
  }

  /**
   * 編集を送る（N-252）。
   *
   * **開いたときの版をそのまま渡す。** 送る直前に読み直して版を取り直すと、
   * 「別の人が直したこと」を自分で消してしまう。口が409を返したら、
   * 上書きせずに読み直しを促す。
   */
  const submitEdit = async () => {
    if (!editTarget || !editForm || editSaving) return
    const name = editForm.name.trim()
    if (!name) {
      setEditError('名前を入れてください')
      return
    }
    // 起点に金額が無いのに注文の金額が残っていたら先に言う(通常は選べない)。
    if (!originInfoOf(editForm.sourceType).valueModes.includes(editForm.valueMode)) {
      setEditError('この起点には注文の金額が無いため、金額の決め方を選び直してください')
      return
    }
    if (editForm.valueMode === 'fixed' && !editForm.fixedValue.trim()) {
      setEditError('1件あたりの金額を入れてください')
      return
    }
    if (editForm.deduplicationMode === 'window' && !editForm.deduplicationWindowDays.trim()) {
      setEditError('数えない日数を入れてください')
      return
    }
    // R281: ページ到達は対象URLが無いと1件も数えられないため、空のまま送らせない。
    if (editForm.sourceType === 'url_reach' && !editForm.targetUrl.trim()) {
      setEditError('数えてよいページを入れてください')
      return
    }
    if (editForm.attributionDays.trim()
      && (!Number.isInteger(Number(editForm.attributionDays))
        || Number(editForm.attributionDays) < 1 || Number(editForm.attributionDays) > 365)) {
      setEditError('計測期間は1〜365日で入れてください（空欄なら既定の90日です）')
      return
    }
    if (editForm.exclusionMemo.trim().length > 500) {
      setEditError('数えない条件のメモは500文字以内で入力してください')
      return
    }
    /*
     * S4-OR: 空の「いずれか」のかたまり・未完成の行は、黙って
     * 「除外なし」に落とさない。足すつもりの条件が無いまま数えると
     * 広く数えすぎるので、版上げを止めて直し方を案内する。
     */
    const exclusionIssue = findConditionDraftIssue(editForm.exclusion)
    if (exclusionIssue) {
      setEditError(exclusionIssue)
      return
    }
    setEditSaving(true)
    setEditError('')
    try {
      const res = await api.conversions.reviseDefinition(editTarget.id, {
        // 版は編集対象の控えが正本。入力の側にも持つと、片方だけ直したときに食い違う。
        expectedVersion: editTarget.version,
        name,
        sourceType: editForm.sourceType,
        // R40: 数えない条件とメモも次の版に入れる。書きかけの行・空のかたまりは上で止める。
        sourceConfig: {
          ...editTarget.sourceConfig,
          exclusion: pruneCondition(editForm.exclusion),
          exclusionMemo: editForm.exclusionMemo.trim() || null,
        },
        deduplicationMode: editForm.deduplicationMode,
        deduplicationWindowDays: editForm.deduplicationMode === 'window'
          ? Number(editForm.deduplicationWindowDays) : null,
        valueMode: editForm.valueMode,
        fixedValue: editForm.valueMode === 'fixed' ? Number(editForm.fixedValue) : null,
        reversalPolicy: editForm.reversalPolicy,
        attributionDays: editForm.attributionDays.trim() ? Number(editForm.attributionDays) : null,
        targetUrl: editForm.targetUrl.trim() ? editForm.targetUrl.trim() : null,
        reason: '管理画面で成果地点を編集',
      })
      if (!res.success) throw new Error(res.error)
      setEditTarget(null)
      setEditForm(null)
      setEditValueModeNotice(null)
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      // WRITE-01: 409の競合は専用の言葉、それ以外も権限不足・アカウント違い・
      // 機能オフの理由が見えるようにする。内部文は画面へ出さない。
      setEditError(message.includes('更新されています')
        ? 'ほかの人がこの成果地点を先に直しました。上書きしていません。画面を閉じて読み直してから、もう一度お試しください。'
        : describeSaveFailure(error))
    } finally {
      setEditSaving(false)
    }
  }

  /**
   * N-270: 詳細を開いたら受信履歴も読む。失敗しても詳細自体は開く
   * （履歴だけ見えない状態にしないため、ここでは握る）。
   *
   * IDEA-19: 成果1件ずつの記録は計測方法を問わず読む。こちらは失敗が
   * 分かるよう `eventsFailed` を立て、静かに空へ倒さない。
   */
  useEffect(() => {
    setIssuedSecret('')
    setIngestError('')
    setIngestEvents([])
    setDefinitionEvents([])
    setEventsFailed(false)
    if (!detailTarget) return
    const id = detailTarget.id
    void api.conversions.definitionEvents(id, 10)
      .then((response) => {
        if (response.success) setDefinitionEvents(response.data.items)
        else setEventsFailed(true)
      })
      .catch(() => setEventsFailed(true))
    if (detailTarget.measureMethod !== 'webhook') return
    void api.conversions.ingestionEvents(id, 5)
      .then((response) => {
        if (response.success) setIngestEvents(response.data.items)
      })
      .catch(() => undefined)
  }, [detailTarget])

  // 成果の取り消しは owner/admin だけ。staff には操作を出さない。
  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (!active) return
      setCanReverse(response.success && (response.data.role === 'owner' || response.data.role === 'admin'))
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  const openReversal = (event: ConversionDefinitionEvent, kind: 'reverse' | 'restore') => {
    setReversalTarget(event)
    setReversalKind(kind)
    setReversalReason('')
    setReversalError('')
  }

  const submitReversal = async () => {
    if (!reversalTarget || !detailTarget) return
    if (!reversalReason.trim()) {
      setReversalError('理由を入れてください')
      return
    }
    setReversalBusy(true)
    setReversalError('')
    try {
      const res = await api.conversions.appendReversal(reversalTarget.id, {
        kind: reversalKind,
        reason: reversalReason.trim(),
      })
      if (!res.success) throw new Error(res.error || '記録できませんでした')
      const targetId = detailTarget.id
      setReversalTarget(null)
      setReversalReason('')
      // 一覧の状態と「この30日」の数を取り直す。
      void api.conversions.definitionEvents(targetId, 10)
        .then((ev) => { if (ev.success) setDefinitionEvents(ev.data.items) })
        .catch(() => undefined)
      void api.conversions
        .definitions({ ...definitionRange(30), lineAccountId: accountId ?? undefined })
        .then((list) => {
          if (!list.success) return
          const fresh = list.data.items.find((item) => item.id === targetId)
          if (fresh) setDetailTarget((current) => (current && current.id === targetId ? { ...current, ...fresh } : current))
        })
        .catch(() => undefined)
    } catch (err) {
      setReversalError(err instanceof Error ? err.message : '記録できませんでした')
    } finally {
      setReversalBusy(false)
    }
  }

  /** N-268: 下書きを計測中へ。開いた時点の版を渡す。 */
  const publishDraft = async (target: ConversionDefinitionListItem) => {
    if (publishing) return
    setPublishing(true)
    setIngestError('')
    try {
      const res = await api.conversions.publishDefinition(target.id, { expectedVersion: target.version })
      if (!res.success) throw new Error(res.error)
      setDetailTarget(null)
      await load()
    } catch {
      setIngestError('公開できませんでした。画面を閉じて読み直してから、もう一度お試しください。')
    } finally {
      setPublishing(false)
    }
  }

  /** N-270: 受信鍵の発行・再発行。平文はこの応答でだけ返る。 */
  const issueIngest = async (target: ConversionDefinitionListItem) => {
    if (ingestBusy) return
    setIngestBusy('issue')
    setIngestError('')
    try {
      const res = await api.conversions.issueIngestSecret(target.id, { expectedVersion: target.version })
      if (!res.success) throw new Error(res.error)
      setIssuedSecret(res.data.secret)
      await load()
    } catch {
      setIngestError('鍵を発行できませんでした。画面を閉じて読み直してから、もう一度お試しください。')
    } finally {
      setIngestBusy('')
    }
  }

  /** N-270: 受け口の停止・再開。止めても鍵は残る。 */
  const toggleIngest = async (target: ConversionDefinitionListItem) => {
    if (ingestBusy) return
    setIngestBusy('toggle')
    setIngestError('')
    try {
      const res = await api.conversions.setIngestDisabled(target.id, {
        expectedVersion: target.version,
        disabled: !target.ingest.disabledAt,
      })
      if (!res.success) throw new Error(res.error)
      setDetailTarget(null)
      await load()
    } catch {
      setIngestError('受け口を切り替えられませんでした。画面を閉じて読み直してから、もう一度お試しください。')
    } finally {
      setIngestBusy('')
    }
  }

  const openStop = async (target: ConversionDefinitionListItem, preset: ConversionStopAction = 'stop') => {
    setDetailTarget(null)
    setStopTarget(target)
    setStopImpact(null)
    setStopError('')
    setStopAction(preset)
    setReplacementId('')
    setStopReason('')
    setStopImpactLoading(true)
    try {
      const response = await api.conversions.definitionDeleteImpact(target.id)
      if (!response.success) throw new Error(response.error)
      setStopImpact(response.data)
    } catch {
      setStopError('利用先と停止の影響を読み込めませんでした。画面を閉じて、もう一度お試しください。')
    } finally {
      setStopImpactLoading(false)
    }
  }

  /**
   * 影響が読めていないまま確定を押しても、黙って終わらない(#513 M4)。
   *
   * 読み込み中は確定ボタンを `busy` で止め、読み込み失敗時は窓の中に
   * 理由を出す。閉じて開き直すと `openStop` が影響を読み直す。
   */
  const runStop = async () => {
    if (!stopTarget || stopping) return
    if (stopImpactLoading) return
    if (!stopImpact) {
      setStopError('利用先と停止の影響を読み込めませんでした。画面を閉じて、もう一度お試しください。')
      return
    }
    setStopping(true)
    setStopError('')
    try {
      const replacement = stopImpact.replacementCandidates.find((item) => item.id === replacementId)
      // V8 の小窓では理由が必須で、ここへ届く。v7 の窓には欄が無いので
      // 空のまま来て、従来どおりの文言で送る。
      const reason = stopReason.trim()
      const res = stopAction === 'replace'
        ? replacement
          ? await api.conversions.replaceDefinition(stopTarget.id, {
              replacementId: replacement.id,
              expectedVersion: stopImpact.definition.version,
              replacementExpectedVersion: replacement.version,
              reason: reason || '管理画面で利用先を差し替え',
            })
          : { success: false as const, error: '差し替え先を選んでください' }
        : stopAction === 'delete'
          ? await api.conversions.deleteDefinition(stopTarget.id, {
              expectedVersion: stopImpact.definition.version,
              reason: reason || '未使用の成果地点を削除',
            })
          : await api.conversions.stopDefinition(stopTarget.id, {
              expectedVersion: stopImpact.definition.version,
              reason: reason || '管理画面で計測を停止',
            })
      if (!res.success) throw new Error(res.error)
      setStopTarget(null)
      setStopReason('')
      await load()
    } catch {
      setStopError(stopAction === 'replace'
        ? '利用先を差し替えられませんでした。状態を読み直して、もう一度お試しください。'
        : stopAction === 'delete'
          ? 'この成果地点は削除できませんでした。利用先と成果件数を確認してください。'
          : 'この成果地点の計測を止められませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setStopping(false)
    }
  }

  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    setExportError('')
    try {
      const blob = await api.conversions.exportDefinitions({
        ...definitionRange(30), lineAccountId: accountId ?? undefined,
      })
      downloadCsvBlob(blob, `conversion-definitions-${definitionRange(1).to}.csv`)
    } catch {
      setExportError('CSVを書き出せませんでした。権限を確認して、もう一度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  const points = useMemo(() => definitions?.items ?? [], [definitions])

  const kpi = useMemo(() => {
    return {
      currentCount: summaryReport?.kpis.netCount ?? points.reduce((sum, row) => sum + row.metrics.netCount, 0),
      previousCount: summaryReport?.kpis.previousNetCount ?? null,
      currentValue: summaryReport?.kpis.netValue ?? points.reduce((sum, row) => sum + row.metrics.netValue, 0),
      // N-267: 「どこからも使われていない」の件数は口が絞り込み全体から
      // 数える。読み込んだ行だけで数えると打ち切りの先を数え損ねる。
      unusedCount: definitions?.stateCounts.unused ?? 0,
    }
  }, [points, summaryReport, definitions])

  /**
   * 画面で絞るのは状態だけ(#513 M3)。探す言葉と並びは口が済ませているので、
   * ここで探し直し・並べ直しはしない(口の `name_asc` はバイナリ順で、
   * 画面の `localeCompare` と順がずれるため)。
   */
  const shown = useMemo(() => {
    return points.filter((point) => {
      if (status === 'all') return true
      // N-267: 「使われていない」は利用先0件で判定。件数は stateCounts.unused が正本。
      if (status === 'unused') return point.usageCount === 0
      // N-268: 下書き・入力不良・起点停止は導出状態で絞る。
      return point.state === status
    })
  }, [points, status])

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = useMemo(
    () => shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, shown],
  )

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const highlightedPoint = useMemo(
    () => (highlightId ? points.find((point) => point.id === highlightId) ?? null : null),
    [points, highlightId],
  )

  // N-264: 作ったばかりの行が写っている頁へ移し、その行へ視線を運ぶ。
  // 状態の絞り込みで外れているときは帯だけ出す(行を無理に混ぜない)。
  useEffect(() => {
    if (!highlightedPoint) return
    const index = shown.findIndex((point) => point.id === highlightedPoint.id)
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1)
  }, [highlightedPoint, shown])

  useEffect(() => {
    highlightRowRef.current?.scrollIntoView({ block: 'center' })
  }, [highlightedPoint, current])

  // 共用の窓への受け渡し（v7 の描画と V8 で同じものを使う）。
  const detailDialogProps = {
    detailTarget,
    setDetailTarget,
    publishing,
    publishDraft: (target: ConversionDefinitionListItem) => void publishDraft(target),
    openEdit,
    openStop: (target: ConversionDefinitionListItem) => void openStop(target),
    issueIngest: (target: ConversionDefinitionListItem) => void issueIngest(target),
    toggleIngest: (target: ConversionDefinitionListItem) => void toggleIngest(target),
    ingestBusy,
    ingestError,
    issuedSecret,
    ingestEvents,
    definitionEvents,
    eventsFailed,
    canReverse,
    openReversal,
  }
  const reversalDialogProps = {
    reversalTarget,
    reversalKind,
    reversalBusy,
    reversalError,
    reversalReason,
    setReversalTarget,
    setReversalReason,
    submitReversal: () => void submitReversal(),
  }
  const editDialogProps = {
    editTarget,
    setEditTarget,
    editForm,
    setEditForm,
    editValueModeNotice,
    setEditValueModeNotice,
    editSaving,
    editError,
    submitEdit: () => void submitEdit(),
  }

  // ★V8-B コンバージョンの一覧（`r6dJFy`）。止める窓は表の下の小窓で、
  // 共用の止める窓（`ConversionStopDialog`）は V8 では開かない。
  if (v8) {
    return (
      <>
        <ConversionPointsV8
          model={{
            loading,
            loadFailed,
            points,
            shown,
            total: definitions?.pagination.total ?? null,
            stateCounts: definitions?.stateCounts ?? null,
            listTruncated,
            query,
            onQueryChange: (value) => {
              setQuery(value)
              setPage(1)
            },
            status,
            onStatusChange: (value) => {
              setStatus(value)
              setPage(1)
            },
            onReload: () => void load(),
            onExportCsv: () => void exportCsv(),
            exporting,
            exportError,
            highlightedId: highlightId,
            publishing,
            onOpenDetail: (point) => setDetailTarget(point),
            onOpenEdit: openEdit,
            onOpenStop: (point, action) => void openStop(point, action),
            onPublishDraft: (point) => void publishDraft(point),
            stopTarget,
            stopImpact,
            stopImpactLoading,
            stopAction,
            onStopActionChange: setStopAction,
            replacementId,
            onReplacementIdChange: setReplacementId,
            stopReason,
            onStopReasonChange: setStopReason,
            stopping,
            stopError,
            onConfirmStop: () => void runStop(),
            onCancelStop: () => {
              if (stopping) return
              setStopTarget(null)
              setStopImpact(null)
              setStopError('')
              setStopReason('')
            },
            detailDialog: detailDialogProps,
            editDialog: editDialogProps,
            reversalDialog: reversalDialogProps,
            onIssueIngest: (point) => void issueIngest(point),
            onToggleIngest: (point) => void toggleIngest(point),
            ingestBusy,
            ingestError,
            issuedSecret,
            onClearIssuedSecret: () => setIssuedSecret(''),
          }}
        />
        <ConversionDetailDialog {...detailDialogProps} />
        <ConversionReversalDialog {...reversalDialogProps} />
        <ConversionEditDialog {...editDialogProps} />
      </>
    )
  }

  return (
    <div data-conversion-points-design="v6" data-design-node="r6dJFy WSGvo E2l8cw BygrU" className="flex flex-col gap-4">

      {/* #975 U060: 390pxでは先頭2件だけ出し、残りは「集計を見る」で開く。 */}
      {/*
        ★V8（`BygrU` 1152）：数の帯は区切り線で並べる1本の帯にする。
        包み div の札も帯のマスにする組立ては conversions-v8.module.css。
        v7 の見た目は変えない。
      */}
      <KpiCollapse data-design="KPIs" gridClassName={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${styles.kpis}`}>
        <KpiCard
          title="決めてある成果地点"
          value={definitions?.pagination.total ?? null}
          unit="個"
          /*
           * R595: 一覧が読めないときは値が「—」になる。3段目まで
           * 「読み込み中」のままだと直っているように見えるので、由来を書く。
           */
          detail={definitions ? `動いているもの ${definitions.stateCounts.active}個` : loadFailed ? '一覧を読み込めませんでした' : '読み込み中'}
          loading={loading}
        />
        <KpiCard
          title="この30日の成果"
          value={summaryReport ? kpi.currentCount : null}
          unit="件"
          badge={summaryReport?.kpis.countChangeRate == null
            ? undefined
            : `${summaryReport.kpis.countChangeRate > 0 ? '+' : ''}${summaryReport.kpis.countChangeRate}%`}
          /*
           * R596: 集計だけ読めないときは一覧を残し、このカードだけ
           * 失敗と再試行にする。再試行は集計だけ読み直すので行は消えない。
           */
          detail={reportFailed
            ? 'この30日の集計を読み込めませんでした'
            : kpi.previousCount === null
              ? '前の30日の比較は読み込めませんでした'
              : `前の30日 ${formatNumber(kpi.previousCount)}件`}
          onRetry={reportFailed && !loading ? () => void reloadReport() : undefined}
          retryLabel="集計を再読み込み"
          loading={loading}
        />
        <KpiCard
          title="金額がついた成果"
          value={summaryReport ? kpi.currentValue : null}
          unit="円"
          /*
           * R595: 一覧が読めないとき points は空なので、そのまま数えると
           * 「0個の成果地点」と誤る。未取得は数えない。
           */
          detail={definitions
            ? `${points.filter((point) => point.value !== null).length}個の成果地点で金額を記録${listTruncated ? '（直近5000件まで）' : ''}`
            : loadFailed ? '金額の内訳を読み込めませんでした' : '読み込み中'}
          loading={loading}
        />
        <KpiCard
          title="1件も起きていない"
          value={definitions ? kpi.unusedCount : null}
          unit="個"
          badge={kpi.unusedCount > 0 ? '確認' : undefined}
          badgeTone={kpi.unusedCount > 0 ? 'neutral' : 'accent'}
          detail={loadFailed ? '一覧を読み込めませんでした' : '決めたのに使われていません'}
          loading={loading}
        />
      </KpiCollapse>

      <Notice tone="info" message="成果地点は「数え方の決めごと」です。ここで決めたものを、案件・自動応答・分析などから呼び出して使います。" className="mb-4" />

      {highlightedPoint ? (
        <Notice tone="info" message={`「${highlightedPoint.name}」を保存しました。色の付いた行です。`} className="mb-4" />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button href="/conversions/new" variant="primary">＋ 成果地点を作る</Button>
        <Button onClick={() => void exportCsv()} disabled={exporting} busy={exporting} busyLabel="書き出しています">CSVで書き出す
        </Button>
      </div>
      {exportError ? <p className="text-danger text-sm" role="alert">{exportError}</p> : null}

      {/*
        ★V7 `Xn1Mz`：検索は幅320で1行目、2行目は左に絞り込み・
        右端に並び順。期間の目安は2行目の右へ。
      */}
      <ListToolbar
        search={{
          placeholder: '成果地点の名前で検索',
          value: query,
          onChange: (value) => {
            setQuery(value)
            setPage(1)
          },
        }}
        filters={
          <>
            {/*
              R595: 一覧が未取得のとき札に 0 を出すと「0件ある」と誤読する。
              FilterChip は件数が無いとき印を出さない決まりなので、
              未取得は渡さない（部品側で隠れる）。
            */}
            {([
              ['all', 'すべて', definitions?.pagination.total],
              ['active', '動いている', definitions?.stateCounts.active],
              ['draft', '下書き', definitions?.stateCounts.draft],
              ['invalid', '入力不良', definitions?.stateCounts.invalid],
              ['sourceStopped', '起点停止', definitions?.stateCounts.sourceStopped],
              ['stopped', '止めている', definitions?.stateCounts.stopped],
              ['unused', 'どこからも使われていない', definitions?.stateCounts.unused],
            ] as const).map(([value, label, total]) => (
              <FilterChip
                key={value}
                selected={status === value}
                onChange={() => {
                  setStatus(value)
                  setPage(1)
                }}
                count={total}
              >
                {label}
              </FilterChip>
            ))}
          </>
        }
        trailing={
          <>
            <p className="text-ink-secondary text-sm tabular-nums">{rangeLabel(30)}</p>
            <Select
              aria-label="並び順"
              value={sort}
              options={SORT_OPTIONS}
              onChange={(value) => {
                setSort(value as PointSort)
                setPage(1)
              }}
            />
          </>
        }
      />

      {listTruncated ? (
        <p
          role="status"
          className="border-warning bg-warning-bg text-warning mb-3 rounded-control border px-4 py-3 text-sm font-semibold"
        >
          一覧は先頭5000個までを表示しています。これより後ろの成果地点は検索や絞り込みで範囲を分けて確認してください。
        </p>
      ) : null}

      {loading ? (
        <ListState kind="loading" title="成果地点を読み込んでいます" />
      ) : loadFailed ? (
        <ListState
          kind="error"
          title="成果地点を読み込めませんでした"
          description="再読み込みしても直らない場合は、エラー報告へ連絡してください。"
          action={
            <Button variant="secondary" onClick={() => void load()}>
              成果地点を再読み込み
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <ListState
          kind="empty"
          title={query ? '条件に合う成果地点はありません' : 'まだ成果地点がありません'}
          description={
            query
              ? '検索の言葉を変えてください。'
              : '上の「＋ 成果地点を作る」から登録すると、ここに出ます。'
          }
        />
      ) : (
        <>
        {/*
          ★V7 監査の直し A（`LD96g`）：768px 以上は表、767px 以下は共通の
          一覧カード（`MobileTableCards`）。表のままだと390pxで6列が潰れて
          名前が見出しに重なっていた。
        */}
        <MobileTableCards
          items={current.map((point) => ({
            id: point.id,
            name: point.name,
            status: point.state !== 'active' && STATE_LABELS[point.state] ? (
              <span
                className={`inline-block rounded-mini px-1.5 py-0.5 text-xs font-semibold ${
                  point.state === 'draft' ? 'bg-info-bg text-info'
                    : point.state === 'invalid' || point.state === 'sourceStopped' ? 'bg-warning-bg text-warning'
                    : 'bg-canvas-sunken text-ink-faint'
                }`}
                title={point.stateReason ?? undefined}
              >
                {STATE_LABELS[point.state]}
              </span>
            ) : undefined,
            summary: sourceTriggerLabel(point),
            metric: `この30日 ${formatNumber(point.metrics.netCount)}件`,
            primaryAction: (
              <Button
                href={`/analytics?tab=funnel&conversionPointId=${encodeURIComponent(point.id)}&conversionPointName=${encodeURIComponent(point.name)}`}
                variant="secondary"
              >
                使う場所を足す
              </Button>
            ),
            /*
             * R280: 開閉は行ごとの共通 RowActions に任せる。以前は画面全体の
             * `pointMenuId` をスマホカードとPC表で共有していたため、隠れて
             * いる側の器まで body へ出てメニューが2つに見えた。
             */
            moreAction: (
              <RowActions
                menuItems={[
                  { id: 'detail', label: '中身を見る', onSelect: () => setDetailTarget(point) },
                ]}
                subjectName={point.name}
              />
            ),
            onSelect: () => setDetailTarget(point),
            onSelectLabel: `${point.name}の詳細を開く`,
          }))}
        />
        <div data-design="Table" className="bg-canvas rounded-card border-hairline border hidden md:block">
          <table className="w-full table-fixed">
            <thead>
              <TableHeadRow>
                {/*
                  列幅は見出し側で決める。table-fixed では先頭行の幅だけが効き、
                  行側の td の幅指定は効かない。1440pxで足りるよう配り直す。
                */}
                <Th className="w-1/6">成果地点</Th>
                <Th className="w-1/4">何が起きたら数えるか</Th>
                <Th align="right" className="w-28">この30日</Th>
                <Th align="right" className="w-24">金額</Th>
                <Th className="w-1/4">使われている場所</Th>
                <Th align="right" className="w-52">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {current.map((point) => (
                <tr
                  key={point.id}
                  ref={point.id === highlightId ? highlightRowRef : null}
                  /*
                   * R280: 行のクリックでも詳細が開く。操作列の中の押下は
                   * 行へ伝えない（選んだ操作の代わりに詳細へ移動してしまう）。
                   */
                  className={`${point.id === highlightId ? 'bg-accent-soft' : 'hover:bg-canvas-sunken'} cursor-pointer`}
                  onClick={() => setDetailTarget(point)}
                >
                  <td className="text-ink w-1/6 px-5 py-[9px] text-sm font-medium">
                    <span className="line-clamp-2" title={point.name}>{point.name}</span>
                    {/* 辞書に無い種別は中身のない印を出さない。具体的な種別だけ添える。 */}
                    {EVENT_TYPE_LABELS[point.sourceType] ? (
                      <p className="text-ink-faint mt-0.5 text-xs">{EVENT_TYPE_LABELS[point.sourceType]}</p>
                    ) : null}
                    {/* 状態名が無いときは空の札を出さない。口が state を返さない行で灰色の空札が出ていた。 */}
                    {point.state !== 'active' && STATE_LABELS[point.state] ? (
                      <p
                        className={`mt-1 inline-block rounded-mini px-1.5 py-0.5 text-xs font-semibold ${
                          point.state === 'draft' ? 'bg-info-bg text-info'
                            : point.state === 'invalid' || point.state === 'sourceStopped' ? 'bg-warning-bg text-warning'
                            : 'bg-canvas-sunken text-ink-faint'
                        }`}
                        title={point.stateReason ?? undefined}
                      >
                        {STATE_LABELS[point.state]}
                      </p>
                    ) : null}
                  </td>
                  <td className="text-ink-secondary w-1/4 px-5 py-[9px] text-sm">
                    <span className="line-clamp-2 break-all" title={sourceTriggerLabel(point)}>{sourceTriggerLabel(point)}</span>
                    <p className="text-ink-faint mt-0.5 truncate text-xs" title={`${measureLabel(point.measureMethod)}・${deduplicationLabel(point.deduplicationMode, point.deduplicationWindowDays)}`}>
                      {measureLabel(point.measureMethod)}・{deduplicationLabel(point.deduplicationMode, point.deduplicationWindowDays)}
                    </p>
                  </td>
                  <td className="text-ink whitespace-nowrap px-5 py-[9px] text-right text-sm tabular-nums">
                    {formatNumber(point.metrics.netCount)}件
                  </td>
                  <td className="text-ink-secondary px-5 py-[9px] text-right text-sm tabular-nums">
                    {point.value === null
                      ? '金額なし'
                      : `¥${formatNumber(point.metrics.netValue)}`}
                  </td>
                  <td className={point.usageCount === 0
                    ? 'text-warning w-1/4 px-5 py-[9px] text-sm'
                    : 'text-ink-secondary w-1/4 px-5 py-[9px] text-sm'}>
                    <span className="line-clamp-2 break-all" title={usageLabel(point)}>{usageLabel(point)}</span>
                  </td>
                  <td className="px-5 py-[9px] text-right whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                    {/*
                      幅の決まっていない列へ2つのボタンを右詰めで入れると、
                      狭い幅で内容が左の「使われている場所」へはみ出して
                      文字に重なっていた。主操作だけ残し、詳細はメニューへ畳む。
                      R280: 「…」は開閉を行ごとに持つ共通 RowActions にする。
                      画面全体の共有状態だと、隠れているスマホカード側の器まで
                      body へ出てメニューが2つに見えた。
                    */}
                    <div className="relative flex items-center justify-end gap-2">
                      <Button
                        href={`/analytics?tab=funnel&conversionPointId=${encodeURIComponent(point.id)}&conversionPointName=${encodeURIComponent(point.name)}`}
                        variant="secondary"
                      >
                        使う場所を足す
                      </Button>
                      <RowActions
                        menuItems={[
                          { id: 'detail', label: '中身を見る', onSelect: () => setDetailTarget(point) },
                        ]}
                        subjectName={point.name}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <div data-design="tf" className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-faint text-xs">利用先の名前は詳細で確認できます。追加するときは分析画面でこの成果地点を選びます。</p>
        <div className="flex items-center gap-2 text-xs">
          {/*
            R595: 一覧が未取得のとき「成果地点 0件」と出すと、失敗なのに
            空と誤読する。未取得は件数自体を出さない（失敗の案内は上の
            ListState が担う）。
          */}
          {definitions == null ? null : (
            <ListRange
              className="tabular-nums"
              label="成果地点"
              total={definitions.pagination.total}
              first={shown.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
              last={Math.min(page * PAGE_SIZE, shown.length)}
            />
          )}
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      </div>

      <ConversionDetailDialog {...detailDialogProps} />

      <ConversionReversalDialog {...reversalDialogProps} />

      <ConversionEditDialog {...editDialogProps} />

      <ConversionStopDialog
        stopTarget={stopTarget}
        setStopTarget={setStopTarget}
        stopImpact={stopImpact}
        setStopImpact={setStopImpact}
        stopImpactLoading={stopImpactLoading}
        stopAction={stopAction}
        setStopAction={setStopAction}
        replacementId={replacementId}
        setReplacementId={setReplacementId}
        stopping={stopping}
        stopError={stopError}
        setStopError={setStopError}
        runStop={() => void runStop()}
      />
    </div>
  )
}

/**
 * レポートのタブ。
 *
 * 成果地点ごとの件数と金額をそのまま出す。一覧の表にもCV数はあるが、
 * あちらは「どう数えるか」を確かめる画面で、こちらは「いくらになったか」を
 * 見る画面なので、金額を主にしている。
 */
function ReportTab({ accountId }: { accountId: string | null }) {
  const [report, setReport] = useState<ConversionDefinitionReport | null>(null)
  const [periodDays, setPeriodDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  /** 失敗時の「もう一度読む」用。一覧タブと同じ導線(#513 L6)。 */
  const [reloadSeq, setReloadSeq] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    setReport(null)
    void api.conversions.definitionReport({
      ...definitionRange(periodDays), lineAccountId: accountId ?? undefined,
    })
      .then((response) => {
        if (cancelled) return
        if (response.success && Array.isArray(response.data.byDefinition)
          && Array.isArray(response.data.daily) && Array.isArray(response.data.byRoute)) {
          setReport(response.data)
        } else {
          setLoadFailed(true)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accountId, periodDays, reloadSeq])

  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    setExportError('')
    try {
      const blob = await api.conversions.exportDefinitions({
        ...definitionRange(periodDays), lineAccountId: accountId ?? undefined,
      })
      downloadCsvBlob(blob, `conversion-report-${definitionRange(1).to}.csv`)
    } catch {
      setExportError('CSVを書き出せませんでした。権限を確認して、もう一度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  const daily = useMemo(() => {
    if (!report) return { names: [], days: [], max: 1 }
    const names = report.byDefinition.slice(0, 3).map((row) => row.conversionPointName)
    const byDay = new Map<string, Map<string, number>>()
    for (const row of report.daily) {
      const values = byDay.get(row.day) ?? new Map<string, number>()
      values.set(row.conversionPointName, (values.get(row.conversionPointName) ?? 0) + row.netCount)
      byDay.set(row.day, values)
    }
    const days = [...byDay].map(([day, values]) => {
      const first = values.get(names[0] ?? '') ?? 0
      const second = values.get(names[1] ?? '') ?? 0
      const third = values.get(names[2] ?? '') ?? 0
      const total = [...values.values()].reduce((sum, value) => sum + value, 0)
      return { day, first, second, third, other: Math.max(0, total - first - second - third), total }
    }).toSorted((left, right) => left.day.localeCompare(right.day))
    return { names, days, max: Math.max(1, ...days.map((row) => row.total)) }
  }, [report])

  if (loading) {
    return <ListState kind="loading" title="成果レポートを読み込んでいます" />
  }

  if (loadFailed) {
    return (
      <ListState
        kind="error"
        title="成果レポートを読み込めませんでした"
        description="成果地点の一覧はそのまま使えます。時間を置いて、このタブを開き直してください。"
        action={
          <Button variant="secondary" onClick={() => setReloadSeq((current) => current + 1)}>
            成果レポートを再読み込み
          </Button>
        }
      />
    )
  }

  if (!report) return null

  /*
   * 「いちばん伸びた」は口の `kpis.fastestGrowing`(増分数順)をそのまま使う。
   * 画面で率順に再計算すると、口の選び方と食い違う(#513 L7)。
   */
  const fastest = report.kpis.fastestGrowing
  const fastestRate = fastest && fastest.previousNetCount > 0
    ? Math.round((fastest.countChange / fastest.previousNetCount) * 100)
    : fastest?.netCount ? 100 : 0
  const previousAverage = report.kpis.previousNetCount > 0
    ? Math.round(report.kpis.previousNetValue / report.kpis.previousNetCount)
    : null
  const topRoute = report.byRoute[0]

  return (
    <div className="space-y-4" data-conversion-report-design="v6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          aria-label="集計期間"
          label="期間"
          value={String(periodDays)}
          options={[
            { value: '7', label: 'この7日' },
            { value: '30', label: 'この30日' },
            { value: '90', label: 'この90日' },
          ]}
          onChange={(value) => setPeriodDays(Number(value))}
        />
        <Button onClick={() => void exportCsv()} disabled={exporting} busy={exporting} busyLabel="書き出しています">成果地点の一覧をCSVで書き出す
        </Button>
      </div>
      {exportError ? <p className="text-danger text-sm" role="alert">{exportError}</p> : null}

      {/*
        ★V8（`BygrU` 1152）：数の帯は区切り線で並べる1本の帯にする。
        包み div の札も帯のマスにする組立ては conversions-v8.module.css。
        v7 の見た目は変えない。
      */}
      <KpiCollapse data-design="KPIs" gridClassName={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${styles.kpis}`}>
        <KpiCard
          title={`この${periodDays}日の成果`}
          value={report.kpis.netCount}
          unit="件"
          badge={report.kpis.countChangeRate == null
            ? undefined
            : `${report.kpis.countChangeRate > 0 ? '+' : ''}${report.kpis.countChangeRate}%`}
          detail={`前の${periodDays}日 ${formatNumber(report.kpis.previousNetCount)}件`}
        />
        <KpiCard
          title="金額"
          value={report.kpis.netValue}
          unit="円"
          detail={`前の${periodDays}日 ¥${formatNumber(report.kpis.previousNetValue)}`}
        />
        <KpiCard
          title="1件あたり"
          value={report.kpis.averageNetValue === null ? null : Math.round(report.kpis.averageNetValue)}
          unit="円"
          detail={previousAverage === null ? `前の${periodDays}日は成果なし` : `前の${periodDays}日 ¥${formatNumber(previousAverage)}`}
        />
        <KpiCard
          title="いちばん伸びた"
          value={fastest ? fastestRate : 0}
          unit="%"
          badge={fastest && fastestRate > 0 ? `+${fastestRate}%` : undefined}
          detail={fastest
            ? `${fastest.conversionPointName} ${formatNumber(fastest.netCount)}件（前の${periodDays}日 ${formatNumber(fastest.previousNetCount)}件）`
            : '比較できる成果はありません'}
        />
      </KpiCollapse>

      <Notice tone="info" message="成果地点ごとの件数と、どこから来たかです。数え方は「成果地点」で決めます。件数と金額は、取り消された成果を除いた数です。" />

      <section className="bg-canvas rounded-card border-hairline border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-ink text-base font-bold">日ごとの成果（この{periodDays}日）</h2>
            <p className="text-ink-faint mt-1 text-xs">棒の色は成果地点です。日ごとの実績を積み上げています。</p>
          </div>
          {daily && daily.names.length > 0 ? (
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint" aria-label="棒の色と成果地点の対応">
              {daily.names.map((name, index) => (
                <li key={name} className="flex items-center gap-1">
                  <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-mini ${index === 0 ? 'bg-success' : index === 1 ? 'bg-action' : index === 2 ? 'bg-info' : 'bg-canvas-sunken'}`} />
                  {name}
                </li>
              ))}
              <li className="flex items-center gap-1">
                <span aria-hidden="true" className="bg-canvas-sunken inline-block h-2.5 w-2.5 rounded-mini" />
                そのほか
              </li>
            </ul>
          ) : null}
        </div>
        {daily && daily.days.length > 0 ? (
          <div className="mt-4 flex h-40 items-end gap-1" aria-label="日ごとの成果グラフ">
            {daily.days.map((day, index) => (
              <div key={day.day} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <div
                  className="flex w-full flex-col-reverse overflow-hidden rounded-mini"
                  style={{ height: `${Math.max(4, Math.round((day.total / daily.max) * 100))}%` }}
                  title={`${day.day} ${day.total}件`}
                >
                  {day.first > 0 ? <span className="bg-success" style={{ flexGrow: day.first }} /> : null}
                  {day.second > 0 ? <span className="bg-action" style={{ flexGrow: day.second }} /> : null}
                  {day.third > 0 ? <span className="bg-info" style={{ flexGrow: day.third }} /> : null}
                  {day.other > 0 ? <span className="bg-canvas-sunken" style={{ flexGrow: day.other }} /> : null}
                </div>
                {(index === 0 || index === daily.days.length - 1 || index % 5 === 0) ? (
                  <span className="text-ink-faint mt-1 truncate text-center text-xs">{day.day.slice(5).replace('-', '/')}</span>
                ) : <span className="mt-1 text-xs">&nbsp;</span>}
              </div>
            ))}
          </div>
        ) : <p className="text-ink-faint mt-4 text-sm">この期間には日ごとの成果がありません。</p>}
        {/*
         * N-266: 棒グラフだけでは値が読み取れない（色と高さに依存する）。
         * 同じデータの表を畳んで置き、スクリーンリーダーと数値確認の両方を
         * カバーする。
         */}
        {daily && daily.days.length > 0 ? (
          <details className="mt-4">
            <summary className="text-ink-secondary cursor-pointer text-sm font-semibold">
              日ごとの成果を表で見る
            </summary>
            <table className="mt-2 w-full text-sm">
              <thead>
                <TableHeadRow>
                  <Th>日付</Th>
                  <Th align="right">成果件数</Th>
                  <Th align="right">金額</Th>
                  <Th>成果地点の内訳</Th>
                </TableHeadRow>
              </thead>
              <tbody className="divide-hairline divide-y">
                {report.daily
                  .reduce<Array<{ day: string; count: number; value: number; points: string[] }>>((all, row) => {
                    const existing = all.find((item) => item.day === row.day)
                    const label = `${row.conversionPointName} ${row.netCount}件`
                    if (existing) {
                      existing.count += row.netCount
                      existing.value += row.netValue
                      existing.points.push(label)
                    } else {
                      all.push({ day: row.day, count: row.netCount, value: row.netValue, points: [label] })
                    }
                    return all
                  }, [])
                  .map((row) => (
                    <tr key={row.day}>
                      <td className="text-ink px-4 py-2 tabular-nums">{row.day}</td>
                      <td className="text-ink px-4 py-2 text-right tabular-nums">{formatNumber(row.count)}件</td>
                      <td className="text-ink-secondary px-4 py-2 text-right tabular-nums">¥{formatNumber(row.value)}</td>
                      <td className="text-ink-secondary px-4 py-2 text-xs">{row.points.join('・')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
        ) : null}
      </section>

      {report.byDefinition.length === 0 ? (
        <ListState
          kind="empty"
          title="この期間には成果がありません"
          description="期間を変えるか、成果地点の計測状況を確認してください。"
        />
      ) : (
        <div data-design="Table" className="bg-canvas rounded-card border-hairline border">
          <table className="w-full table-fixed">
            <thead>
              <TableHeadRow>
                <Th>成果地点</Th>
                <Th align="right">この期間</Th>
                <Th align="right">前の期間</Th>
                <Th align="right">増減</Th>
                <Th>いちばん多い経路</Th>
                <Th align="right">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {report.byDefinition.filter((row) => row.netCount > 0 || row.previousNetCount > 0).map((row) => {
                const changeRate = row.previousNetCount > 0
                  ? Math.round((row.countChange / row.previousNetCount) * 100)
                  : row.netCount > 0 ? 100 : 0
                return (
                  <tr key={row.conversionPointId} className="hover:bg-canvas-sunken">
                    <td className="text-ink px-4 py-3 text-sm font-medium">
                      <span className="block truncate" title={row.conversionPointName}>{row.conversionPointName}</span>
                      {EVENT_TYPE_LABELS[row.sourceType] ? (
                        <p className="text-ink-faint mt-0.5 text-xs">{EVENT_TYPE_LABELS[row.sourceType]}</p>
                      ) : null}
                    </td>
                    <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">
                      {formatNumber(row.netCount)}件
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                      {formatNumber(row.previousNetCount)}件
                    </td>
                    <td className={changeRate > 0
                      ? 'text-success px-4 py-3 text-right text-sm font-semibold tabular-nums'
                      : 'text-ink-secondary px-4 py-3 text-right text-sm tabular-nums'}>
                      {changeRate > 0 ? '+' : changeRate === 0 ? '±' : ''}{changeRate}%
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-sm">
                      {row.routes?.length ? row.routes.slice(0, 2).map((route) => (
                        <span key={route.routeKey} className="mr-2 inline-block">
                          {route.label} {route.netCount}件
                          {route.conversionRate !== null && route.audience !== null
                            ? <span className="text-ink-faint">（{route.audience}人中 {route.conversionRate}%）</span>
                            : <span className="text-ink-faint">（母数の記録なし）</span>}
                        </span>
                      )) : (topRoute ? `全体では ${topRoute.label}` : '経路の記録はありません')}
                      <p className="text-ink-faint mt-1 text-xs">取消: {row.cancellationCount == null ? '台帳未接続' : `${row.cancellationCount}件・¥${formatNumber((row.cancellationValue ?? 0))}`}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button href="/conversions?tab=points">中身を見る</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * ★V8 で「成果とアフィリエイト」へ分かれたタブ（オーナー決定 案A）。
 * 旧 `/conversions?tab=affiliates|offers|approvals|payment|report` のURLを
 * 壊さないよう、v8 のときは /affiliates 側へ送る。
 */
const V8_AFFILIATE_TABS = new Set(['affiliates', 'offers', 'approvals', 'payment', 'report'])

function ConversionsPageHost() {
  const tab = useMergedTab(MERGED_TABS, 'tab', DEFAULT_TAB)
  const { selectedAccountId } = useAccount()
  const theme = useAdminTheme()
  const router = useRouter()
  useEffect(() => {
    if (theme === 'v8' && V8_AFFILIATE_TABS.has(tab)) {
      router.replace(`/affiliates?tab=${tab}`)
    }
  }, [theme, tab, router])
  /*
    R291: 紹介者の停止前確認からの `?affiliate=`。承認待ちは成果承認タブで
    この紹介者に絞り、リンクは紹介者タブでこの紹介者の内訳を開く。
  */
  const affiliateFocus = useSearchParams().get('affiliate')
  // タブごとの画面名をトップバーの h1 へ出す（Issue #637）。
  usePageTitle(conversionsTabTitle(tab))
  /**
   * タブごとのV6実Node。5タブすべてを埋める。
   *
   * `points` と `report` が抜けていて `data-design-node={undefined}` が
   * そのまま出ていた。設計側の並びは `design-structure.json` の
   * `/conversions` に "PouPn GH8VL n5VVTb ZrpKn GUxsj" として記録がある。
   *
   * **`d8d3Mz` は「19-1-C 成果地点の削除確認」の重ね画面**であって、
   * 一覧のNodeではない（`docs/v6-requirements/v6-19-conversion-requirements-draft.md`）。
   * 一覧に付けると、削除確認の画面とNodeが二重になる。
   */
  const nodeByTab: Record<string, string | undefined> = {
    affiliates: 'PouPn',
    offers: 'GH8VL',
    approvals: 'n5VVTb',
    points: 'ZrpKn',
    report: 'GUxsj',
  }
  // v8 では成果とアフィリエイト系のタブは /affiliates へ送る（描き替わるまでの間）。
  if (theme === 'v8' && V8_AFFILIATE_TABS.has(tab)) {
    return <div className="text-ink-faint p-6 text-sm">移動中...</div>
  }
  return (
    <div data-design-node={nodeByTab[tab]}>
      <MergedTabs
        basePath="/conversions"
        paramName="tab"
        tabs={MERGED_TABS}
        active={tab}
        defaultKey={DEFAULT_TAB}
        label="成果とアフィリエイト・コンバージョンの画面"
      />
      {tab === 'points' && <ConversionsPageInner accountId={selectedAccountId} v8={theme === 'v8'} />}
      {tab === 'affiliates' && <AffiliatorsTab accountId={selectedAccountId} focusAffiliateId={affiliateFocus} />}
      {tab === 'offers' && <OffersTab />}
      {tab === 'approvals' && <ApprovalQueue focusAffiliateId={affiliateFocus} />}
      {tab === 'report' && <ReportTab accountId={selectedAccountId} />}
      {tab === 'payment' && (selectedAccountId
        ? <AffiliatePaymentTab accountId={selectedAccountId} />
        : <p className="text-ink-secondary p-8 text-center text-sm">上のバーからLINEアカウントを選んでください。</p>)}
    </div>
  )
}

export default function ConversionsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <ConversionsPageHost />
    </Suspense>
  )
}
