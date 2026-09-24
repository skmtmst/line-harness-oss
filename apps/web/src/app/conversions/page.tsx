'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import ActionMenu from '@/components/shared/action-menu'
import IconButton from '@/components/shared/icon-button'
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
import KpiCard from '@/components/shared/kpi-card'

/**
 * 数え方を運用者の言葉にする。既定（manual）も省略せずに出す。
 *
 * 設計は「指定ページへの到達 / EC連携からの通知」と、何が起きたら数えるのかを
 * そのまま書いている。「URL到達」だと、誰がどのURLに来たときの話なのかが
 * 読み取れない。
 */
/**
 * 編集の入力（N-252）。
 *
 * 数値は入力途中で空になるので文字列で持ち、送るときだけ数へ直す。
 * 途中を数値に強制すると「消して打ち直す」ができない。
 */
type EditForm = {
  name: string
  sourceType: string
  deduplicationMode: 'every' | 'once_per_friend' | 'window'
  deduplicationWindowDays: string
  valueMode: 'source' | 'fixed' | 'none'
  fixedValue: string
  reversalPolicy: 'source_cancelled' | 'manual' | 'none'
  attributionDays: string
  targetUrl: string
}

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
  }
}

const VALUE_MODE_OPTIONS = [
  { value: 'fixed', label: '1件あたりの金額を決める' },
  { value: 'source', label: '連携元の金額を使う' },
  { value: 'none', label: '金額を数えない' },
]
const DEDUP_OPTIONS = [
  { value: 'every', label: deduplicationLabel('every', null) },
  { value: 'once_per_friend', label: deduplicationLabel('once_per_friend', null) },
  { value: 'window', label: deduplicationLabel('window', null) },
]
const REVERSAL_OPTIONS = [
  { value: 'manual', label: '人が取り消す' },
  { value: 'source_cancelled', label: '連携元の取消に合わせる' },
  { value: 'none', label: '取り消さない' },
]

function measureLabel(method: ConversionPoint['measureMethod']): string {
  if (method === 'url_reach') return '指定ページへの到達'
  if (method === 'webhook') return 'EC連携からの通知'
  return '手動で記録'
}

/**
 * N-268: 導出状態を運用者の言葉にする。status 列だけでは
 * 「まだ公開していない」「設定が足りない」「受け口を止めている」が
 * 全部「動いている」に潰れてしまうので、口が導出した `state` を見る。
 */
const STATE_LABELS: Record<ConversionDefinitionState, string> = {
  active: '動いている',
  draft: '下書き',
  stopped: '止めている',
  invalid: '入力不良',
  sourceStopped: '起点停止',
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

/**
 * IDEA-19: 成果1件の業務状態を運用者の言葉にする。
 * 状態の導出は口(listConversionDefinitionEvents)が済ませている。
 * 「検知」は受信履歴の「受け取った」が担い、ここは確定後の帰結を出す。
 */
const EVENT_STATUS_LABELS: Record<ConversionDefinitionEvent['status'], string> = {
  confirmed: '確定',
  pending: '確認待ち',
  rejected: '却下',
  cancelled: '取消',
}

/**
 * IDEA-19: 外部受信の失敗理由を業務の言葉にする。
 * 口が返す理由コードをそのまま出すと運用者が読めないため、ここで訳す。
 * 辞書に無い理由はコードを出さず、判別用に title へ残す。
 */
const INGEST_REASON_LABELS: Record<string, string> = {
  point_not_found: 'この成果地点が見つかりませんでした',
  point_draft: '下書きのため、まだ計測していません',
  point_stopped: '計測を止めているため、受け取りませんでした',
  ingest_disabled: '外部からの受け口を止めています',
  secret_not_issued: '受信用の鍵がまだ発行されていません',
  signature_missing: '署名のない送信でした',
  signature_mismatch: '署名が一致しませんでした。連携先の鍵を確認してください',
  invalid_json: '送信内容の形式が正しくありませんでした',
  source_event_id_missing: '送信側のイベントIDが無いため、重複かどうかを判定できませんでした',
  friend_missing: '友だちを特定できませんでした',
  friend_not_found: '指定された友だちが見つかりませんでした',
  account_mismatch: 'このアカウントの友だちではないため、数えませんでした',
  idempotency_conflict: '同じイベントIDで違う内容が届いたため、受け取りませんでした',
}

/** 受信履歴1件を運用者の言葉にする。検証の受信は本番実績と区別して出す。 */
function ingestionEventLabel(event: ConversionIngestionEvent): string {
  const reason = event.reason
    ? INGEST_REASON_LABELS[event.reason] ?? '受け取れませんでした。理由は管理側の記録を確認してください'
    : null
  const base = event.isTest
    ? event.result === 'rejected' ? '検証の受信（受け取れなかった）' : '検証の受信（実績には数えません）'
    : event.result === 'recorded' ? '検知して数えた'
      : event.result === 'duplicate' ? '同じ受信の再送（二重には数えません）'
      : '受け取れなかった'
  return reason ? `${base}（${reason}）` : base
}

import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import { usePageTitle } from '@/components/shell/page-chrome'
import { conversionsTabTitle } from './conversions-tab-title'
import { useSearchParams } from 'next/navigation'
import { AffiliatorsTab, OffersTab, ApprovalQueue } from '@/app/affiliates/tabs'
import AffiliatePaymentTab from '@/app/affiliates/payment-tab'
import { useAccount } from '@/contexts/account-context'
import { TableHeadRow, Th } from '@/components/shared/table'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import FilterChip from '@/components/shared/filter-chip'
import Dialog from '@/components/shared/dialog'
import { TextField } from '@/components/shared/text-field'
import KpiCollapse from '@/components/ui/kpi-collapse'
import ListRange from '@/components/ui/list-range'

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

function sourceTriggerLabel(point: Pick<ConversionDefinitionListItem, 'measureMethod' | 'sourceType' | 'targetUrl'>): string {
  if (point.measureMethod === 'url_reach') {
    return point.targetUrl ? `サイトの「${point.targetUrl}」に到達` : '指定したページに到達'
  }
  if (point.measureMethod === 'webhook') {
    if (point.sourceType === 'purchase' || point.sourceType === 'ec_order_confirmed') return 'EC連携の「注文が確定」'
    if (point.sourceType === 'ec_subscription_confirmed') return 'EC連携の「定期が確定」'
    if (point.sourceType === 'form_submit' || point.sourceType === 'form_submitted') return '回答フォームの送信'
    if (point.sourceType === 'visit' || point.sourceType === 'reservation_confirmed') return '予約管理の「予約が確定」'
    if (point.sourceType === 'webinar_completed') return 'ウェビナーの「視聴完了」'
    return '接続したシステムから成果の通知を受信'
  }
  return '管理画面から担当者が記録'
}

function usageLabel(point: ConversionDefinitionListItem): string {
  if (point.usageCount === 0) return 'どこからも使われていません'
  if (point.usageNames?.length) return point.usageNames.join('・')
  return `${point.usageCount.toLocaleString('ja-JP')}か所で使用中`
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

function ConversionsPageInner({ accountId }: { accountId: string | null }) {
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
  const [pointMenuId, setPointMenuId] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  /**
   * 読み込みの世代番号(#513 M6)。
   *
   * アカウントの高速切替や検索の連打で古い応答が残っていると、新しい
   * 表示を上書きしてしまう。応答が返った時点で番号が変わっていたら捨てる。
   */
  const loadSeq = useRef(0)
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
  const [stopAction, setStopAction] = useState<'stop' | 'replace' | 'delete'>('stop')
  const [replacementId, setReplacementId] = useState('')
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
  // N-268: 下書きの公開。版は開いた時点のものを渡し、409は読み直しで返す。
  const [publishing, setPublishing] = useState(false)
  /**
   * N-270: 外部受信の操作状態。平文の鍵は発行の応答でだけ返るため、
   * 一度だけ表示して閉じると二度と見えない。
   */
  const [ingestBusy, setIngestBusy] = useState('')
  const [issuedSecret, setIssuedSecret] = useState('')
  const [ingestError, setIngestError] = useState('')
  const [ingestEvents, setIngestEvents] = useState<ConversionIngestionEvent[]>([])
  /**
   * IDEA-19: 成果1件ずつの記録。状態(確定・確認待ち・却下・取消)は
   * 口が導出済みのものをそのまま出す。数え方や計測方法を問わず読む。
   */
  const [definitionEvents, setDefinitionEvents] = useState<ConversionDefinitionEvent[]>([])
  const [eventsFailed, setEventsFailed] = useState(false)

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
    }
    setLoading(false)
  }, [accountId, debouncedQuery, sort])

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
    setEditForm(toEditForm(target))
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
    if (editForm.valueMode === 'fixed' && !editForm.fixedValue.trim()) {
      setEditError('1件あたりの金額を入れてください')
      return
    }
    if (editForm.deduplicationMode === 'window' && !editForm.deduplicationWindowDays.trim()) {
      setEditError('数えない日数を入れてください')
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
        sourceConfig: editTarget.sourceConfig,
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

  const openStop = async (target: ConversionDefinitionListItem) => {
    setDetailTarget(null)
    setStopTarget(target)
    setStopImpact(null)
    setStopError('')
    setStopAction('stop')
    setReplacementId('')
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
      const res = stopAction === 'replace'
        ? replacement
          ? await api.conversions.replaceDefinition(stopTarget.id, {
              replacementId: replacement.id,
              expectedVersion: stopImpact.definition.version,
              replacementExpectedVersion: replacement.version,
              reason: '管理画面で利用先を差し替え',
            })
          : { success: false as const, error: '差し替え先を選んでください' }
        : stopAction === 'delete'
          ? await api.conversions.deleteDefinition(stopTarget.id, {
              expectedVersion: stopImpact.definition.version,
              reason: '未使用の成果地点を削除',
            })
          : await api.conversions.stopDefinition(stopTarget.id, {
              expectedVersion: stopImpact.definition.version,
              reason: '管理画面で計測を停止',
            })
      if (!res.success) throw new Error(res.error)
      setStopTarget(null)
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

  return (
    <div data-conversion-points-design="v6">

      {/* #975 U060: 390pxでは先頭2件だけ出し、残りは「集計を見る」で開く。 */}
      <KpiCollapse data-design="KPIs" className="mb-4" gridClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="決めてある成果地点"
          value={definitions?.pagination.total ?? null}
          unit="個"
          detail={definitions ? `動いているもの ${definitions.stateCounts.active}個` : '読み込み中'}
          loading={loading}
        />
        <KpiCard
          title="この30日の成果"
          value={summaryReport ? kpi.currentCount : null}
          unit="件"
          badge={summaryReport?.kpis.countChangeRate == null
            ? undefined
            : `${summaryReport.kpis.countChangeRate > 0 ? '+' : ''}${summaryReport.kpis.countChangeRate}%`}
          detail={kpi.previousCount === null
            ? '前の30日の比較は読み込めませんでした'
            : `前の30日 ${kpi.previousCount.toLocaleString()}件`}
          loading={loading}
        />
        <KpiCard
          title="金額がついた成果"
          value={summaryReport ? kpi.currentValue : null}
          unit="円"
          detail={`${points.filter((point) => point.value !== null).length}個の成果地点で金額を記録${listTruncated ? '（直近5000件まで）' : ''}`}
          loading={loading}
        />
        <KpiCard
          title="1件も起きていない"
          value={definitions ? kpi.unusedCount : null}
          unit="個"
          badge={kpi.unusedCount > 0 ? '確認' : undefined}
          badgeTone={kpi.unusedCount > 0 ? 'neutral' : 'accent'}
          detail="決めたのに使われていません"
          loading={loading}
        />
      </KpiCollapse>

      <p className="bg-info-bg text-ink-secondary mb-4 rounded-control px-4 py-3 text-xs">
        成果地点は「数え方の決めごと」です。ここで決めたものを、案件・自動応答・分析などから呼び出して使います。
      </p>

      {highlightedPoint ? (
        <p
          role="status"
          className="border-info bg-info-bg text-info mb-4 rounded-control border px-4 py-3 text-sm font-semibold"
        >
          「{highlightedPoint.name}」を保存しました。色の付いた行です。
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Button href="/conversions/new" variant="primary">＋ 成果地点をつくる</Button>
        <Button onClick={() => void exportCsv()} disabled={exporting}>
          {exporting ? '書き出しています' : 'CSVで書き出す'}
        </Button>
      </div>
      {exportError ? <p className="text-danger mb-3 text-sm" role="alert">{exportError}</p> : null}

      <div
        data-design="Bar"
        className="mb-3 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SearchField
            value={query}
            onChange={(value) => {
              setQuery(value)
              setPage(1)
            }}
            onClear={() => {
              setQuery('')
              setPage(1)
            }}
            placeholder="成果地点の名前で検索"
            aria-label="成果地点の名前で検索"
            className="min-w-64"
          />
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-ink-secondary text-sm tabular-nums">{rangeLabel(30)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {([
            ['all', `すべて ${definitions?.pagination.total ?? 0}`],
            ['active', `動いている ${definitions?.stateCounts.active ?? 0}`],
            ['draft', `下書き ${definitions?.stateCounts.draft ?? 0}`],
            ['invalid', `入力不良 ${definitions?.stateCounts.invalid ?? 0}`],
            ['sourceStopped', `起点停止 ${definitions?.stateCounts.sourceStopped ?? 0}`],
            ['stopped', `止めている ${definitions?.stateCounts.stopped ?? 0}`],
            ['unused', `どこからも使われていない ${definitions?.stateCounts.unused ?? 0}`],
          ] as const).map(([value, label]) => (
            <FilterChip
              key={value}
              selected={status === value}
              onChange={() => {
                setStatus(value)
                setPage(1)
              }}
            >
              {label}
            </FilterChip>
          ))}
          <Select
            aria-label="並び順"
            value={sort}
            options={SORT_OPTIONS}
            onChange={(value) => {
              setSort(value as PointSort)
              setPage(1)
            }}
          />
        </div>
      </div>

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
              : '右上の「成果地点をつくる」から登録すると、ここに出ます。'
          }
        />
      ) : (
        <div data-design="Table" className="bg-canvas rounded-card border-hairline border">
          <table className="w-full table-fixed">
            <thead>
              <TableHeadRow>
                <Th>成果地点</Th>
                <Th>何が起きたら数えるか</Th>
                <Th align="right">この30日</Th>
                <Th align="right">金額</Th>
                <Th>使われている場所</Th>
                <Th align="right" className="w-52">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {current.map((point) => (
                <tr
                  key={point.id}
                  ref={point.id === highlightId ? highlightRowRef : null}
                  className={point.id === highlightId ? 'bg-accent-soft' : 'hover:bg-canvas-sunken'}
                >
                  <td className="text-ink w-1/5 px-4 py-3 text-sm font-medium">
                    <span className="block truncate" title={point.name}>{point.name}</span>
                    {/* 辞書に無い種別は中身のない印を出さない。具体的な種別だけ添える。 */}
                    {EVENT_TYPE_LABELS[point.sourceType] ? (
                      <p className="text-ink-faint mt-0.5 text-xs">{EVENT_TYPE_LABELS[point.sourceType]}</p>
                    ) : null}
                    {point.state !== 'active' ? (
                      <p
                        className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${
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
                  <td className="text-ink-secondary w-1/4 px-4 py-3 text-sm">
                    <span className="block truncate" title={sourceTriggerLabel(point)}>{sourceTriggerLabel(point)}</span>
                    <p className="text-ink-faint mt-0.5 truncate text-xs" title={`${measureLabel(point.measureMethod)}・${deduplicationLabel(point.deduplicationMode, point.deduplicationWindowDays)}`}>
                      {measureLabel(point.measureMethod)}・{deduplicationLabel(point.deduplicationMode, point.deduplicationWindowDays)}
                    </p>
                  </td>
                  <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">
                    {point.metrics.netCount.toLocaleString('ja-JP')}件
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                    {point.value === null
                      ? '金額なし'
                      : `¥${point.metrics.netValue.toLocaleString('ja-JP')}`}
                  </td>
                  <td className={point.usageCount === 0
                    ? 'text-warning w-1/5 px-4 py-3 text-sm'
                    : 'text-ink-secondary w-1/5 px-4 py-3 text-sm'}>
                    <span className="block truncate" title={usageLabel(point)}>{usageLabel(point)}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {/*
                      幅の決まっていない列へ2つのボタンを右詰めで入れると、
                      狭い幅で内容が左の「使われている場所」へはみ出して
                      文字に重なっていた。主操作だけ残し、詳細はメニューへ畳む。
                    */}
                    <div className="relative flex items-center justify-end gap-2">
                      <Button
                        href={`/analytics?tab=funnel&conversionPointId=${encodeURIComponent(point.id)}&conversionPointName=${encodeURIComponent(point.name)}`}
                        variant="secondary"
                      >
                        使う場所を足す
                      </Button>
                      <IconButton
                        aria-label={`${point.name}のその他操作`}
                        title={`${point.name}のその他操作`}
                        onClick={() => setPointMenuId((current) => (current === point.id ? null : point.id))}
                      >
                        <MoreHorizontal />
                      </IconButton>
                      <ActionMenu
                        open={pointMenuId === point.id}
                        ariaLabel={`${point.name}の操作`}
                        onClose={() => setPointMenuId(null)}
                        items={[
                          { id: 'detail', label: '中身を見る', onSelect: () => setDetailTarget(point) },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div data-design="tf" className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-faint text-xs">利用先の名前は詳細で確認できます。追加するときは分析画面でこの成果地点を選びます。</p>
        <div className="flex items-center gap-2 text-xs">
          <ListRange
            className="tabular-nums"
            label="成果地点"
            total={definitions?.pagination.total ?? shown.length}
            first={shown.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
            last={Math.min(page * PAGE_SIZE, shown.length)}
          />
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      </div>

      <Dialog
        open={detailTarget !== null}
        title={detailTarget?.name ?? ''}
        description="この成果地点の数え方と利用状況です。"
        onCancel={() => setDetailTarget(null)}
        footer={detailTarget ? (
          <div className="flex justify-end gap-2">
            {detailTarget.state === 'draft' ? (
              <Button
                variant="primary"
                disabled={publishing}
                onClick={() => void publishDraft(detailTarget)}
              >
                {publishing ? '公開しています' : '計測をはじめる（公開）'}
              </Button>
            ) : null}
            {detailTarget.status !== 'stopped' ? (
              <Button onClick={() => openEdit(detailTarget)}>
                編集
              </Button>
            ) : null}
            {detailTarget.status !== 'stopped' ? (
              <Button onClick={() => void openStop(detailTarget)}>
                停止・削除
              </Button>
            ) : null}
          </div>
        ) : null}
      >
        {detailTarget ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-ink-faint">状態</dt><dd className="text-ink mt-1 font-semibold">{STATE_LABELS[detailTarget.state]}</dd></div>
              <div><dt className="text-ink-faint">何が起きたら数えるか</dt><dd className="text-ink mt-1 font-semibold">{sourceTriggerLabel(detailTarget)}</dd></div>
              <div><dt className="text-ink-faint">数え方</dt><dd className="text-ink mt-1 font-semibold">{deduplicationLabel(detailTarget.deduplicationMode, detailTarget.deduplicationWindowDays)}</dd></div>
              <div><dt className="text-ink-faint">この30日</dt><dd className="text-ink mt-1 font-semibold">{detailTarget.metrics.netCount.toLocaleString('ja-JP')}件</dd></div>
              <div><dt className="text-ink-faint">利用先</dt><dd className="text-ink mt-1 font-semibold">{usageLabel(detailTarget)}</dd></div>
              <div><dt className="text-ink-faint">取消内訳</dt><dd className="text-ink mt-1 font-semibold">{detailTarget.metrics.cancellationCount == null ? '取消台帳は未接続' : `${detailTarget.metrics.cancellationCount}件・¥${(detailTarget.metrics.cancellationValue ?? 0).toLocaleString('ja-JP')}`}</dd></div>
            </dl>
            {detailTarget.stateReason ? (
              <p className="bg-warning-bg text-warning rounded-control px-4 py-3 text-sm font-semibold" role="status">
                {detailTarget.stateReason}
              </p>
            ) : null}
            {ingestError ? <p className="text-danger text-sm" role="alert">{ingestError}</p> : null}
            {/*
             * IDEA-19: 「購入」「相談完了」など成果1件ずつの記録。
             * 検知は受信履歴、ここは数えた成果の状態(確定・確認待ち・却下・取消)
             * を業務の言葉で出す。重複通知・再送は冪等で1件に潰れているので、
             * この一覧の件数と「この30日」の確定数は同じ台帳から数えて一致する。
             * 検証の受信は成果表へ書かないため、ここには本番実績だけが並ぶ。
             */}
            <section className="border-hairline rounded-control border p-4">
              <h3 className="text-ink text-sm font-bold">最近の成果</h3>
              {eventsFailed ? (
                <p className="text-ink-faint mt-2 text-xs leading-5" role="status">
                  成果の記録を読み込めませんでした。一覧の件数は上の「この30日」を確認してください。
                </p>
              ) : definitionEvents.length === 0 ? (
                <p className="text-ink-faint mt-2 text-xs leading-5">
                  まだ成果がありません。検知した成果がここに新しい順で並びます。
                </p>
              ) : (
                <ul className="mt-3 space-y-1 text-xs">
                  {definitionEvents.map((event) => (
                    <li key={event.id} className="text-ink-secondary flex items-baseline justify-between gap-2">
                      <span className="text-ink min-w-0">
                        <span className="font-medium">{event.friendName ?? '名前のない友だち'}</span>
                        <span
                          className={`ml-2 inline-block rounded px-1.5 py-0.5 font-semibold ${
                            event.status === 'cancelled' ? 'bg-danger-bg text-danger'
                              : event.status === 'pending' ? 'bg-info-bg text-info'
                              : event.status === 'rejected' ? 'bg-canvas-sunken text-ink-faint'
                              : 'bg-success-bg text-success'
                          }`}
                        >
                          {EVENT_STATUS_LABELS[event.status]}
                        </span>
                        {event.value !== null ? (
                          <span className="text-ink-faint ml-2 tabular-nums">¥{event.value.toLocaleString('ja-JP')}</span>
                        ) : null}
                      </span>
                      <span className="text-ink-faint shrink-0 tabular-nums">
                        {event.createdAt.slice(0, 16).replace('T', ' ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {detailTarget.measureMethod === 'webhook' ? (
              <section className="border-hairline rounded-control border p-4">
                <h3 className="text-ink text-sm font-bold">外部からの受信</h3>
                <p className="text-ink-faint mt-1 text-xs leading-5">
                  連携先システムがこの成果地点へ成果を送るときの受け口です。
                  送り側は `POST {detailTarget.id ? `/api/conversions/ingest/${detailTarget.id}` : ''}` に
                  `X-Conversion-Signature` 署名を付けて送ります。
                </p>
                <p className="text-ink-secondary mt-2 text-sm">
                  {detailTarget.ingest.configured
                    ? detailTarget.ingest.disabledAt
                      ? '受け口は止まっています（起点停止）。'
                      : '受け口は動いています。鍵は発行済みです。'
                    : 'まだ鍵を発行していません。発行すると連携先へ渡す鍵が一度だけ表示されます。'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    disabled={ingestBusy !== '' || detailTarget.state !== 'active'}
                    onClick={() => void issueIngest(detailTarget)}
                  >
                    {detailTarget.ingest.configured ? '鍵を出し直す' : '鍵を発行する'}
                  </Button>
                  {detailTarget.ingest.configured ? (
                    <Button
                      disabled={ingestBusy !== ''}
                      onClick={() => void toggleIngest(detailTarget)}
                    >
                      {detailTarget.ingest.disabledAt ? '受け口を再開する' : '受け口を止める'}
                    </Button>
                  ) : null}
                </div>
                {issuedSecret ? (
                  <p className="bg-info-bg text-info mt-2 rounded-control px-3 py-2 text-xs font-semibold">
                    新しい鍵: <code className="break-all">{issuedSecret}</code><br />
                    この表示は一度だけです。連携先へ渡して保管してください。
                  </p>
                ) : null}
                {ingestEvents.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-xs">
                    {ingestEvents.slice(0, 5).map((event) => (
                      <li key={event.id} className="text-ink-secondary flex justify-between gap-2">
                        <span
                          className={event.result === 'rejected' ? 'text-danger' : event.isTest ? 'text-info' : 'text-ink'}
                          title={event.reason ?? undefined}
                        >
                          {ingestionEventLabel(event)}
                        </span>
                        <span className="text-ink-faint tabular-nums">{event.createdAt.slice(0, 16).replace('T', ' ')}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={editTarget !== null && editForm !== null}
        title={editTarget ? `「${editTarget.name}」を編集` : ''}
        description="直すと次の版になります。過去に数えた成果と金額は、そのまま残ります。"
        onCancel={() => { setEditTarget(null); setEditForm(null) }}
        footer={(
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setEditTarget(null); setEditForm(null) }}>やめる</Button>
            <Button variant="primary" disabled={editSaving} onClick={() => void submitEdit()}>
              {editSaving ? '保存中...' : 'この内容にする'}
            </Button>
          </div>
        )}
      >
        {editForm ? (
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="text-ink-faint text-xs">名前</span>
              <TextField
                aria-label="成果地点の名前"
                value={editForm.name}
                maxLength={120}
                onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-ink-faint text-xs">金額の決め方</span>
              <Select
                aria-label="金額の決め方"
                value={editForm.valueMode}
                options={VALUE_MODE_OPTIONS}
                onChange={(value) => setEditForm({ ...editForm, valueMode: value as EditForm['valueMode'] })}
              />
            </label>
            {editForm.valueMode === 'fixed' ? (
              <label className="block">
                <span className="text-ink-faint text-xs">1件あたりの金額</span>
                <TextField
                  aria-label="1件あたりの金額"
                  inputMode="numeric"
                  value={editForm.fixedValue}
                  onChange={(event) => setEditForm({ ...editForm, fixedValue: event.target.value })}
                />
              </label>
            ) : null}
            <label className="block">
              <span className="text-ink-faint text-xs">同じ人を何回数えるか</span>
              <Select
                aria-label="同じ人を何回数えるか"
                value={editForm.deduplicationMode}
                options={DEDUP_OPTIONS}
                onChange={(value) => setEditForm({ ...editForm, deduplicationMode: value as EditForm['deduplicationMode'] })}
              />
            </label>
            {editForm.deduplicationMode === 'window' ? (
              <label className="block">
                <span className="text-ink-faint text-xs">数えない日数（1〜365）</span>
                <TextField
                  aria-label="数えない日数"
                  inputMode="numeric"
                  value={editForm.deduplicationWindowDays}
                  onChange={(event) => setEditForm({ ...editForm, deduplicationWindowDays: event.target.value })}
                />
              </label>
            ) : null}
            <label className="block">
              <span className="text-ink-faint text-xs">取り消しの扱い</span>
              <Select
                aria-label="取り消しの扱い"
                value={editForm.reversalPolicy}
                options={REVERSAL_OPTIONS}
                onChange={(value) => setEditForm({ ...editForm, reversalPolicy: value as EditForm['reversalPolicy'] })}
              />
            </label>
            <p className="text-ink-faint text-xs leading-5">
              いま使っている場所（{usageLabel(editTarget!)}）は、この成果地点のまま次の版へ引き継がれます。
              過去の成果は数えたときの金額のままなので、集計額は変わりません。
            </p>
            {editError ? <p className="text-xs font-semibold text-ink">{editError}</p> : null}
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={stopTarget !== null}
        designNode="d8d3Mz"
        title={stopTarget
          ? stopAction === 'delete'
            ? `「${stopTarget.name}」を削除しますか？`
            : stopAction === 'replace'
              ? `「${stopTarget.name}」を差し替えて止めますか？`
              : `「${stopTarget.name}」の計測を止めますか？`
          : ''}
        description="使っている場所と、止めたあとに残る記録を確認してから操作を選びます。"
        confirmLabel={stopAction === 'replace'
          ? '差し替えて数えるのをやめる'
          : stopAction === 'delete' ? 'この成果地点を削除する' : '数えるのをやめる'}
        busy={stopping || stopImpactLoading}
        error={stopError}
        onConfirm={() => void runStop()}
        onCancel={() => {
          if (stopping) return
          setStopTarget(null)
          setStopImpact(null)
          setStopError('')
        }}
      >
        {stopTarget && (
          <div className="space-y-4">
            <section className="border-danger bg-danger-bg rounded-control border p-4">
              <h3 className="text-danger text-sm font-bold">いま、この成果地点を使っている場所</h3>
              <div className="border-danger/20 mt-3 rounded-control border bg-canvas px-3 py-3">
                {stopImpactLoading ? (
                  <p className="text-ink-faint text-sm">利用先と影響を読み込んでいます。</p>
                ) : stopImpact?.usages.length ? (
                  <ul className="space-y-2">
                    {stopImpact.usages.map((usage) => (
                      <li key={usage.id} className="text-ink text-sm">
                        <span className="font-semibold">{usage.usageName}</span>
                        <span className="text-ink-faint ml-2 text-xs">停止後も記録を残します</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink text-sm font-semibold">どこからも使われていません</p>
                )}
                <p className="text-ink-faint mt-2 text-xs leading-relaxed">
                  利用先は実データです。停止後も、過去の成果と利用先の記録は残ります。
                </p>
              </div>
            </section>

            <section className="bg-canvas-sunken rounded-control px-4 py-3">
              <p className="text-ink-secondary text-sm">
                これまでに数えた{' '}
                <strong className="text-ink tabular-nums">
                  {stopTarget.metrics.netCount.toLocaleString('ja-JP')}件
                </strong>
                の記録と金額は、そのまま残ります。停止の影響は {stopImpact?.stopImpact.affectedUsageCount ?? '—'}か所です。
              </p>
            </section>

            <section>
              <h3 className="text-ink text-sm font-bold">どうしますか？</h3>
              <div className="mt-2 space-y-2">
                <label className={`rounded-control flex cursor-pointer items-start gap-3 border p-3 ${stopAction === 'stop' ? 'border-accent bg-accent-soft' : 'border-hairline'}`}>
                  <input type="radio" name="conversion-stop-action" checked={stopAction === 'stop'} onChange={() => setStopAction('stop')} className="mt-0.5" />
                  <div>
                    <p className="text-ink text-sm font-semibold">数えるのをやめる（おすすめ）</p>
                    <p className="text-ink-faint mt-0.5 text-xs">これから先は数えません。過去の記録と分析は残します。</p>
                  </div>
                </label>
                <label className={`rounded-control flex cursor-pointer items-start gap-3 border p-3 ${stopAction === 'replace' ? 'border-accent bg-accent-soft' : 'border-hairline'}`}>
                  <input type="radio" name="conversion-stop-action" checked={stopAction === 'replace'} onChange={() => setStopAction('replace')} className="mt-0.5" disabled={!stopImpact?.replacementCandidates.length} />
                  <div>
                    <p className="text-ink text-sm font-semibold">別の成果地点に差し替えてから削除する</p>
                    <p className="text-ink-faint mt-0.5 text-xs">利用先を別の成果地点へ切り替え、過去の数字を残します。</p>
                    {stopAction === 'replace' ? (
                      <Select
                        aria-label="差し替え先の成果地点"
                        value={replacementId}
                        options={[
                          { value: '', label: '差し替え先を選ぶ' },
                          ...(stopImpact?.replacementCandidates ?? []).map((item) => ({ value: item.id, label: item.name })),
                        ]}
                        onChange={setReplacementId}
                        className="mt-2"
                      />
                    ) : null}
                  </div>
                </label>
                <label className={`rounded-control flex items-start gap-3 border p-3 ${stopImpact?.canDelete ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'} ${stopAction === 'delete' ? 'border-accent bg-accent-soft' : 'border-hairline'}`}>
                  <input type="radio" name="conversion-stop-action" checked={stopAction === 'delete'} onChange={() => setStopAction('delete')} className="mt-0.5" disabled={!stopImpact?.canDelete} />
                  <div>
                    <p className="text-ink text-sm font-semibold">このまま削除する</p>
                    <p className="text-ink-faint mt-0.5 text-xs">{stopImpact?.canDelete
                      ? '成果0件・利用先0件のため、この成果地点だけを削除できます。'
                      : '成果または利用先があるため、物理削除は選べません。'}</p>
                  </div>
                </label>
              </div>
            </section>

            <p className="text-ink-faint text-xs">{stopAction === 'replace'
              ? '選んだ成果地点へ利用先を差し替えたあと、元の計測を停止します。'
              : stopAction === 'delete'
                ? '成果も利用先もない場合だけ削除できます。'
                : '「数えるのをやめる」を選ぶと停止として記録され、過去の成果は削除されません。'}</p>
          </div>
        )}
      </ConfirmDialog>
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
        <Button onClick={() => void exportCsv()} disabled={exporting}>
          {exporting ? '書き出しています' : '成果地点の一覧をCSVで書き出す'}
        </Button>
      </div>
      {exportError ? <p className="text-danger text-sm" role="alert">{exportError}</p> : null}

      <KpiCollapse data-design="KPIs" gridClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={`この${periodDays}日の成果`}
          value={report.kpis.netCount}
          unit="件"
          badge={report.kpis.countChangeRate == null
            ? undefined
            : `${report.kpis.countChangeRate > 0 ? '+' : ''}${report.kpis.countChangeRate}%`}
          detail={`前の${periodDays}日 ${report.kpis.previousNetCount.toLocaleString('ja-JP')}件`}
        />
        <KpiCard
          title="金額"
          value={report.kpis.netValue}
          unit="円"
          detail={`前の${periodDays}日 ¥${report.kpis.previousNetValue.toLocaleString('ja-JP')}`}
        />
        <KpiCard
          title="1件あたり"
          value={report.kpis.averageNetValue === null ? null : Math.round(report.kpis.averageNetValue)}
          unit="円"
          detail={previousAverage === null ? `前の${periodDays}日は成果なし` : `前の${periodDays}日 ¥${previousAverage.toLocaleString('ja-JP')}`}
        />
        <KpiCard
          title="いちばん伸びた"
          value={fastest ? fastestRate : 0}
          unit="%"
          badge={fastest && fastestRate > 0 ? `+${fastestRate}%` : undefined}
          detail={fastest
            ? `${fastest.conversionPointName} ${fastest.netCount.toLocaleString('ja-JP')}件（前の${periodDays}日 ${fastest.previousNetCount.toLocaleString('ja-JP')}件）`
            : '比較できる成果はありません'}
        />
      </KpiCollapse>

      <p className="bg-info-bg text-info rounded-control px-4 py-3 text-sm font-semibold">
        成果地点ごとの件数と、どこから来たかです。数え方は「成果地点」で決めます。
      </p>

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
                  <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-sm ${index === 0 ? 'bg-success' : index === 1 ? 'bg-action' : index === 2 ? 'bg-info' : 'bg-canvas-sunken'}`} />
                  {name}
                </li>
              ))}
              <li className="flex items-center gap-1">
                <span aria-hidden="true" className="bg-canvas-sunken inline-block h-2.5 w-2.5 rounded-sm" />
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
                  className="flex w-full flex-col-reverse overflow-hidden rounded-sm"
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
                      <td className="text-ink px-4 py-2 text-right tabular-nums">{row.count.toLocaleString('ja-JP')}件</td>
                      <td className="text-ink-secondary px-4 py-2 text-right tabular-nums">¥{row.value.toLocaleString('ja-JP')}</td>
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
                      {row.netCount.toLocaleString('ja-JP')}件
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                      {row.previousNetCount.toLocaleString('ja-JP')}件
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
                      <p className="text-ink-faint mt-1 text-xs">取消: {row.cancellationCount == null ? '台帳未接続' : `${row.cancellationCount}件・¥${(row.cancellationValue ?? 0).toLocaleString('ja-JP')}`}</p>
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

function ConversionsPageHost() {
  const tab = useMergedTab(MERGED_TABS, 'tab', DEFAULT_TAB)
  const { selectedAccountId } = useAccount()
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
  return (
    <div data-design-node={nodeByTab[tab]}>
      <MergedTabs
        basePath="/conversions"
        paramName="tab"
        tabs={MERGED_TABS}
        active={tab}
        defaultKey={DEFAULT_TAB}
      />
      {tab === 'points' && <ConversionsPageInner accountId={selectedAccountId} />}
      {tab === 'affiliates' && <AffiliatorsTab accountId={selectedAccountId} />}
      {tab === 'offers' && <OffersTab />}
      {tab === 'approvals' && <ApprovalQueue />}
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
