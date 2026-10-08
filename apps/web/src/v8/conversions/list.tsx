'use client'

/*
 * ★V8 コンバージョンの一覧（Pencil：一覧 `r6dJFy`・1152 `BygrU`・閲覧のみ `WSGvo`・
 * 状態の見本帳 `E2l8cw`）。
 *
 * 型（ListPage）に、数の帯・左のフォルダの列（上に「成果地点を作る」）・
 * 案内の帯・道具の段・表（絵の列の並び）を渡す。行の右端は「使う場所を足す」と「…」。
 * 行を押すと表の下に詳細の小窓、「止める」は表の下の止める小窓（3択＋理由）。
 *
 * データの口・保存の口・権限・失敗の扱いは app/conversions/page.tsx と同じ
 * （BEHAVIOR.md）。違うのは見せ方だけ。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Banknote,
  Bookmark,
  CircleOff,
  CirclePause,
  Download,
  Eye,
  FilePen,
  Inbox,
  Pause,
  Play,
  Plus,
  Target,
  TriangleAlert,
  Trophy,
  Unplug,
} from 'lucide-react'
import { ListPage, ListPagePagination } from '@/components/templates'
import ListToolbar from '@/components/shared/list-toolbar'
import SearchField from '@/components/shared/search-field'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Notice from '@/components/shared/notice'
import FilterChip from '@/components/shared/filter-chip'
import Select from '@/components/shared/select'
import SortSelect from '@/components/ui/sort-select'
import PageSizeSelect from '@/components/ui/page-size-select'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import { FolderDotName } from '@/components/shared/folder-dot'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { findConditionDraftIssue, pruneCondition } from '@/components/shared/condition-builder'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import {
  api,
  describeSaveFailure,
  type ConversionDefinitionDeleteImpact,
  type ConversionDefinitionEvent,
  type ConversionDefinitionFilter,
  type ConversionDefinitionList,
  type ConversionDefinitionListItem,
  type ConversionDefinitionReport,
  type ConversionIngestionEvent,
} from '@/lib/api'
import { deduplicationLabel } from './dedup'
import { originInfoOf } from './origin-labels'
import { readExclusionCondition, readExclusionMemo } from './exclusion'
import {
  ConversionDetailDialog,
  ConversionEditDialog,
  ConversionReversalDialog,
  EDIT_VALUE_MODE_LABELS,
  STATE_LABELS,
  sourceTriggerLabel,
  usageLabel,
  type ConversionStopAction,
  type EditForm,
} from './dialogs'
import { notifyToast } from '@/components/shared/toast'
import styles from './list.module.css'

type StatusFilter = 'all' | ConversionDefinitionFilter
type PointSort = 'cv-desc' | 'value-desc' | 'name'

const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'
const DAY_MS = 24 * 60 * 60 * 1000

const SORT_OPTIONS: Array<{ value: PointSort; label: string }> = [
  { value: 'cv-desc', label: '件数が多い順' },
  { value: 'value-desc', label: '金額が多い順' },
  { value: 'name', label: '名前順' },
]
/* 画面の並びを口の並びに写す（今の一覧と同じ）。 */
const SORT_TO_API: Record<PointSort, 'count_desc' | 'value_desc' | 'name_asc'> = {
  'cv-desc': 'count_desc',
  'value-desc': 'value_desc',
  name: 'name_asc',
}

/* 状態の札（絵 r6dJFy の並び）。件数は口の stateCounts。 */
const CHIPS: Array<{ value: ConversionDefinitionFilter; label: string; icon: ReactNode }> = [
  { value: 'active', label: '動いている', icon: <Play size={13} aria-hidden="true" /> },
  { value: 'stopped', label: '止めている', icon: <Pause size={13} aria-hidden="true" /> },
  { value: 'draft', label: '下書き', icon: <FilePen size={13} aria-hidden="true" /> },
  { value: 'invalid', label: '入力不良', icon: <TriangleAlert size={13} aria-hidden="true" /> },
  { value: 'sourceStopped', label: '起点停止', icon: <CirclePause size={13} aria-hidden="true" /> },
  { value: 'unused', label: 'どこからも使われていない', icon: <CircleOff size={13} aria-hidden="true" /> },
]

function definitionRange(days: number): { from: string; to: string } {
  const end = new Date()
  const start = new Date(end.getTime() - (days - 1) * DAY_MS)
  const format = (value: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value)
  return { from: format(start), to: format(end) }
}

function downloadCsvBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(href)
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
    exclusion: readExclusionCondition(item.sourceConfig),
    exclusionMemo: readExclusionMemo(item.sourceConfig),
  }
}

/* 「何が起きたら数えるか」の1行目（短い言葉）。くわしい起点は title と詳細で読む。 */
const SHORT_TRIGGERS: Record<string, string> = {
  ec_order_confirmed: '注文が確定したとき',
  ec_subscription_confirmed: '定期便が確定したとき',
  reservation_confirmed: '予約が確定したとき',
  form_submitted: '回答フォームを送ったとき',
  form_submit: '回答フォームを送ったとき',
  webinar_completed: '視聴完了になったとき',
  tag_added: 'タグが付いたとき',
  purchase: '購入を記録したとき',
  visit: '来店・参加を記録したとき',
}
function shortTrigger(point: ConversionDefinitionListItem): string {
  if (point.measureMethod === 'url_reach') return 'ページのURLを開いたとき'
  if (point.measureMethod === 'manual') return '担当者が記録したとき'
  return SHORT_TRIGGERS[point.sourceType] ?? originInfoOf(point.sourceType).trigger
}

function shortDate(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
}

/* 「何が起きたら数えるか」の2行目（数え方・金額または止めた日）。 */
function rowSub(point: ConversionDefinitionListItem): string {
  const parts = [deduplicationLabel(point.deduplicationMode, point.deduplicationWindowDays).replace(/だけ$/, '').replace('何回でも数える', '1回ごと')]
  if (point.status === 'stopped' && point.stoppedAt) parts.push(`止めた日 ${shortDate(point.stoppedAt)}`)
  else if (point.valueMode === 'fixed') parts.push(point.value == null ? '金額なし' : `決まった金額 ¥${formatNumber(point.value)}`)
  else if (point.valueMode === 'none') parts.push('金額なし')
  else if (point.reversalPolicy === 'source_cancelled') parts.push('取り消しは引く')
  return parts.join('・')
}

/* 使われている場所：最後の1つを2行目に小さく（全部を見せる。詳細の小窓でも読める）。 */
function usageLines(point: ConversionDefinitionListItem): { main: string; sub: string } {
  const names = point.usageNames ?? []
  if (point.usageCount === 0) return { main: '—', sub: '' }
  if (names.length === 0) return { main: `${formatNumber(point.usageCount)}か所`, sub: '' }
  if (names.length === 1) return { main: names[0], sub: '' }
  return { main: names.slice(0, -1).join('・'), sub: names[names.length - 1] }
}

function StatePill({ point }: { point: ConversionDefinitionListItem }) {
  return (
    <span className={styles.pill} data-tone={point.state === 'active' ? 'active' : point.state === 'invalid' || point.state === 'sourceStopped' ? 'warn' : 'neutral'}>
      <span className={styles.pillDot} aria-hidden="true" />
      {STATE_LABELS[point.state] ?? STATE_LABELS.active}
    </span>
  )
}

function TableHead() {
  return (
    <thead>
      <TableHeadRow className={styles.headRow} data-table-layout="columns">
        <Th className={styles.colName}>成果地点</Th>
        <Th className={styles.colTrigger}>何が起きたら数えるか</Th>
        <Th className={styles.colCount} align="right">この30日</Th>
        <Th className={styles.colValue} align="right">金額</Th>
        <Th className={styles.colUsage}>使われている場所</Th>
        <Th className={styles.colOps}>操作</Th>
      </TableHeadRow>
    </thead>
  )
}

function ListSkeleton() {
  return (
    <div className={styles.tableWrap} aria-busy="true">
      <span className="sr-only">成果地点を読み込んでいます</span>
      <DelayedSkeleton
        loading
        skeleton={
          <DataTable className={styles.table}>
            <TableHead />
            <tbody aria-hidden="true">
              {[0, 1, 2, 3, 4].map((index) => (
                <Tr key={index} className={styles.row} data-table-layout="columns">
                  <Td className={styles.colName}><Skeleton className={styles.skeletonName} /></Td>
                  <Td className={styles.colTrigger}><Skeleton className={styles.skeletonName} /></Td>
                  <Td className={styles.colCount}><Skeleton className={styles.skeletonNum} /></Td>
                  <Td className={styles.colValue}><Skeleton className={styles.skeletonNum} /></Td>
                  <Td className={styles.colUsage}><Skeleton className={styles.skeletonName} /></Td>
                  <Td className={styles.colOps}><Skeleton className={styles.skeletonNum} /></Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        }
      />
    </div>
  )
}

export default function ConversionListV8({ accountId }: { accountId: string | null }) {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <ConversionList accountId={accountId} />
    </Suspense>
  )
}

function ConversionList({ accountId }: { accountId: string | null }) {
  usePageTitle('コンバージョン')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const narrow = useNarrowViewport()
  const { selectedAccountId } = useAccount()
  /* 作る画面は `?highlight=<作った行のID>` で戻ってくる。 */
  const highlightId = useSearchParams().get('highlight')

  const [definitions, setDefinitions] = useState<ConversionDefinitionList | null>(null)
  const [summaryReport, setSummaryReport] = useState<ConversionDefinitionReport | null>(null)
  const [listTruncated, setListTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [sort, setSort] = useState<PointSort>('cv-desc')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reportFailed, setReportFailed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const loadSeq = useRef(0)
  const accountIdRef = useRef(accountId)
  accountIdRef.current = accountId

  /* 表の下の詳細の小窓（行を押すと開く）と、止める小窓。 */
  const [panelId, setPanelId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [stopTarget, setStopTarget] = useState<ConversionDefinitionListItem | null>(null)
  const [stopImpact, setStopImpact] = useState<ConversionDefinitionDeleteImpact | null>(null)
  const [stopImpactLoading, setStopImpactLoading] = useState(false)
  const [stopAction, setStopAction] = useState<ConversionStopAction>('stop')
  const [replacementId, setReplacementId] = useState('')
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState('')
  const [stopReason, setStopReason] = useState('')
  /* 中身を見る窓・編集の窓・取消の窓（今の画面と同じ窓）。 */
  const [detailTarget, setDetailTarget] = useState<ConversionDefinitionListItem | null>(null)
  const [editTarget, setEditTarget] = useState<ConversionDefinitionListItem | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [editValueModeNotice, setEditValueModeNotice] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [ingestBusy, setIngestBusy] = useState<'' | 'issue' | 'toggle'>('')
  const [issuedSecret, setIssuedSecret] = useState('')
  const [ingestError, setIngestError] = useState('')
  const [ingestEvents, setIngestEvents] = useState<ConversionIngestionEvent[]>([])
  const [definitionEvents, setDefinitionEvents] = useState<ConversionDefinitionEvent[]>([])
  const [eventsFailed, setEventsFailed] = useState(false)
  const [reversalTarget, setReversalTarget] = useState<ConversionDefinitionEvent | null>(null)
  const [reversalKind, setReversalKind] = useState<'reverse' | 'restore'>('reverse')
  const [reversalReason, setReversalReason] = useState('')
  const [reversalBusy, setReversalBusy] = useState(false)
  const [reversalError, setReversalError] = useState('')
  /* 変える操作は owner/admin だけ（役割は /api/staff/me から読む。手元の保存値は使わない）。 */
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionNotice, setActionNotice] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  /* 一覧は検索・並びを口へ渡し、続く頁をすべて読む（50頁・5000件で止め、切れたら断る）。 */
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
    const fetchAllDefinitions = async (): Promise<{ data: ConversionDefinitionList; truncated: boolean } | null> => {
      const items: ConversionDefinitionList['items'] = []
      let cursor: string | undefined
      let first: ConversionDefinitionList | null = null
      for (let pageIndex = 0; pageIndex < 50; pageIndex += 1) {
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
    if (loadSeq.current !== seq) return
    if (listResult.status === 'fulfilled' && listResult.value !== null) {
      setDefinitions(listResult.value.data)
      setListTruncated(listResult.value.truncated)
    } else {
      setLoadFailed(true)
    }
    if (reportResult.status === 'fulfilled' && reportResult.value.success
      && Array.isArray(reportResult.value.data?.byDefinition)) {
      setSummaryReport(reportResult.value.data)
    } else {
      setReportFailed(true)
    }
    if (loadSeq.current === seq) setLoading(false)
  }, [accountId, debouncedQuery, sort])

  /* 集計だけを読み直す。一覧は触らない。遅れた応答は世代とアカウントで捨てる。 */
  const reloadReport = useCallback(async () => {
    const seq = ++loadSeq.current
    const requestAccountId = accountId
    try {
      const response = await api.conversions.definitionReport({ ...definitionRange(30), lineAccountId: accountId ?? undefined })
      if (loadSeq.current !== seq || accountIdRef.current !== requestAccountId) return
      if (response.success && Array.isArray(response.data?.byDefinition)) {
        setSummaryReport(response.data)
        setReportFailed(false)
      } else {
        setReportFailed(true)
      }
    } catch {
      if (loadSeq.current !== seq || accountIdRef.current !== requestAccountId) return
      setReportFailed(true)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  /* 中身を見る窓を開いたら、成果1件ずつの記録と受信履歴も読む。 */
  useEffect(() => {
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
      .then((response) => { if (response.success) setIngestEvents(response.data.items) })
      .catch(() => undefined)
  }, [detailTarget])

  /* 鍵の平文は、見せた相手が変わったら消す（別の行に見せない）。 */
  useEffect(() => {
    setIssuedSecret('')
    setIngestError('')
  }, [panelId, detailTarget])

  const openEdit = (target: ConversionDefinitionListItem) => {
    if (!canEdit) return
    setDetailTarget(null)
    setEditTarget(target)
    const form = toEditForm(target)
    const allowed = originInfoOf(form.sourceType).valueModes
    if (!allowed.includes(form.valueMode)) {
      const fallback = originInfoOf(form.sourceType).defaultValueMode
      setEditForm({ ...form, valueMode: fallback })
      setEditValueModeNotice(`起点に注文の金額が無いため、金額の決め方を「${EDIT_VALUE_MODE_LABELS[fallback]}」に戻しました。`)
    } else {
      setEditForm(form)
      setEditValueModeNotice(null)
    }
    setEditError('')
  }

  /* 編集を送る。開いたときの版をそのまま渡し、409 は上書きせずに読み直しを促す。 */
  const submitEdit = async () => {
    if (!editTarget || !editForm || editSaving || !canEdit) return
    const name = editForm.name.trim()
    if (!name) { setEditError('名前を入れてください'); return }
    if (!originInfoOf(editForm.sourceType).valueModes.includes(editForm.valueMode)) {
      setEditError('この起点には注文の金額が無いため、金額の決め方を選び直してください')
      return
    }
    if (editForm.valueMode === 'fixed' && !editForm.fixedValue.trim()) { setEditError('1件あたりの金額を入れてください'); return }
    if (editForm.deduplicationMode === 'window' && !editForm.deduplicationWindowDays.trim()) { setEditError('数えない日数を入れてください'); return }
    if (editForm.sourceType === 'url_reach' && !editForm.targetUrl.trim()) { setEditError('数えてよいページを入れてください'); return }
    if (editForm.attributionDays.trim()
      && (!Number.isInteger(Number(editForm.attributionDays))
        || Number(editForm.attributionDays) < 1 || Number(editForm.attributionDays) > 365)) {
      setEditError('計測期間は1〜365日で入れてください（空欄なら既定の90日です）')
      return
    }
    if (editForm.exclusionMemo.trim().length > 500) { setEditError('数えない条件のメモは500文字以内で入力してください'); return }
    const exclusionIssue = findConditionDraftIssue(editForm.exclusion)
    if (exclusionIssue) { setEditError(exclusionIssue); return }
    setEditSaving(true)
    setEditError('')
    try {
      const res = await api.conversions.reviseDefinition(editTarget.id, {
        expectedVersion: editTarget.version,
        name,
        sourceType: editForm.sourceType,
        sourceConfig: {
          ...editTarget.sourceConfig,
          exclusion: pruneCondition(editForm.exclusion),
          exclusionMemo: editForm.exclusionMemo.trim() || null,
        },
        deduplicationMode: editForm.deduplicationMode,
        deduplicationWindowDays: editForm.deduplicationMode === 'window' ? Number(editForm.deduplicationWindowDays) : null,
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
      setEditError(message.includes('更新されています')
        ? 'ほかの人がこの成果地点を先に直しました。上書きしていません。画面を閉じて読み直してから、もう一度お試しください。'
        : describeSaveFailure(error))
    } finally {
      setEditSaving(false)
    }
  }

  const openReversal = (event: ConversionDefinitionEvent, kind: 'reverse' | 'restore') => {
    setReversalTarget(event)
    setReversalKind(kind)
    setReversalReason('')
    setReversalError('')
  }

  /* 成果の取り消し・戻し。元の行は消さず、理由つきの追記を足す。 */
  const submitReversal = async () => {
    if (!reversalTarget || !detailTarget) return
    if (!reversalReason.trim()) { setReversalError('理由を入れてください'); return }
    setReversalBusy(true)
    setReversalError('')
    try {
      const res = await api.conversions.appendReversal(reversalTarget.id, { kind: reversalKind, reason: reversalReason.trim() })
      if (!res.success) throw new Error(res.error || '記録できませんでした')
      const targetId = detailTarget.id
      setReversalTarget(null)
      setReversalReason('')
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

  /* 下書きを計測中へ。開いた時点の版を渡す。 */
  const publishDraft = async (target: ConversionDefinitionListItem) => {
    if (publishing || !canEdit) return
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

  /* 受信鍵の発行・再発行。平文はこの応答でだけ返る。 */
  const issueIngest = async (target: ConversionDefinitionListItem) => {
    if (ingestBusy || !canEdit) return
    setIngestBusy('issue')
    setIngestError('')
    try {
      const res = await api.conversions.issueIngestSecret(target.id, { expectedVersion: target.version })
      if (!res.success) throw new Error(res.error)
      await load()
      setIssuedSecret(res.data.secret)
    } catch {
      setIngestError('鍵を発行できませんでした。画面を閉じて読み直してから、もう一度お試しください。')
    } finally {
      setIngestBusy('')
    }
  }

  /*
   * 受け口の停止・再開。止めても鍵は残る。押した瞬間に窓を閉じて札を変え、裏で保存する
   * （触り心地 5 回目）。成功したら返ってきた版に置き換える。失敗したら元に戻してトーストで知らせる。
   */
  const toggleIngest = async (target: ConversionDefinitionListItem) => {
    if (ingestBusy || !canEdit) return
    const before = target.ingest.disabledAt
    const disable = !before
    const patch = (id: string, change: Partial<Pick<ConversionDefinitionListItem, 'version'>> & { disabledAt: string | null }) => setDefinitions((current) => current && ({
      ...current,
      items: current.items.map((item) => (item.id === id
        ? { ...item, ...(change.version !== undefined ? { version: change.version } : {}), ingest: { ...item.ingest, disabledAt: change.disabledAt } }
        : item)),
    }))
    setIngestBusy('toggle')
    setIngestError('')
    setDetailTarget(null)
    patch(target.id, { disabledAt: disable ? new Date().toISOString() : null })
    try {
      const res = await api.conversions.setIngestDisabled(target.id, { expectedVersion: target.version, disabled: disable })
      if (!res.success) throw new Error(res.error)
      patch(target.id, { disabledAt: res.data.disabledAt, version: res.data.version })
    } catch {
      patch(target.id, { disabledAt: before })
      notifyToast(`「${target.name}」の受け口を${disable ? '止められ' : '再開でき'}ませんでした。元に戻しました。`, {
        tone: 'error',
        actionLabel: '読み直す',
        onAction: () => { void load() },
      })
    } finally {
      setIngestBusy('')
    }
  }

  const openStop = async (target: ConversionDefinitionListItem, action: ConversionStopAction = 'stop') => {
    if (!canEdit) return
    setStopReason('')
    setDetailTarget(null)
    setStopTarget(target)
    setStopImpact(null)
    setStopError('')
    setStopAction(action)
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

  /* 止める・差し替える・削除する。影響が読めていないまま確定しない。理由は必須。 */
  const runStop = async () => {
    if (!stopTarget || stopping || !canEdit || stopImpactLoading) return
    if (!stopImpact) {
      setStopError('利用先と停止の影響を読み込めませんでした。画面を閉じて、もう一度お試しください。')
      return
    }
    if (!stopReason.trim()) {
      setStopError('止める・差し替える・削除する理由を入力してください')
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
              reason: stopReason.trim(),
            })
          : { success: false as const, error: '差し替え先を選んでください' }
        : stopAction === 'delete'
          ? await api.conversions.deleteDefinition(stopTarget.id, { expectedVersion: stopImpact.definition.version, reason: stopReason.trim() })
          : await api.conversions.stopDefinition(stopTarget.id, { expectedVersion: stopImpact.definition.version, reason: stopReason.trim() })
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

  /* 複製：同じ数え方で「〇〇のコピー」を作る。使う場所は版が違うと結び直せないので引き継がない。 */
  const duplicatePoint = async (point: ConversionDefinitionListItem) => {
    if (!canEdit || duplicatingId) return
    const lineAccountId = point.lineAccountId ?? selectedAccountId ?? ''
    if (!lineAccountId) {
      setActionError('集計対象のアカウントが無いため、コピーを作れませんでした。')
      return
    }
    setDuplicatingId(point.id)
    setActionError('')
    setActionNotice('')
    try {
      const res = await api.conversions.createDefinition({
        name: `「${point.name}」のコピー`,
        sourceType: point.sourceType,
        sourceConfig: { ...(point.sourceConfig ?? {}) },
        targetUrl: point.targetUrl,
        lineAccountId,
        deduplicationMode: point.deduplicationMode,
        deduplicationWindowDays: point.deduplicationWindowDays,
        valueMode: point.valueMode,
        fixedValue: point.valueMode === 'fixed' ? point.value : null,
        reversalPolicy: point.reversalPolicy,
        attributionDays: point.attributionDays,
        usages: [],
      })
      if (!res.success) throw new Error(res.error)
      setActionNotice(`「${point.name}」のコピーを作りました。使う場所は引き継がないので、要れば足してください。`)
      await load()
    } catch {
      setActionError('コピーを作れませんでした。読み直してから、もう一度お試しください。')
    } finally {
      setDuplicatingId(null)
    }
  }

  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    setExportError('')
    try {
      const blob = await api.conversions.exportDefinitions({ ...definitionRange(30), lineAccountId: accountId ?? undefined })
      downloadCsvBlob(blob, `conversion-definitions-${definitionRange(1).to}.csv`)
    } catch {
      setExportError('CSVを書き出せませんでした。権限を確認して、もう一度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  const points = useMemo(() => definitions?.items ?? [], [definitions])
  const total = definitions?.pagination.total ?? null
  const stateCounts = definitions?.stateCounts ?? null

  /* 画面で絞るのは状態だけ（探す言葉と並びは口が済ませている）。 */
  const shown = useMemo(() => points.filter((point) => {
    if (status === 'all') return true
    if (status === 'unused') return point.usageCount === 0
    return point.state === status
  }), [points, status])

  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const current = useMemo(() => shown.slice((currentPage - 1) * pageSize, currentPage * pageSize), [currentPage, pageSize, shown])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  useEffect(() => { setPage(1) }, [debouncedQuery, status, sort, pageSize])

  const highlightedPoint = useMemo(() => (highlightId ? points.find((point) => point.id === highlightId) ?? null : null), [points, highlightId])
  useEffect(() => {
    if (!highlightedPoint) return
    const index = shown.findIndex((point) => point.id === highlightedPoint.id)
    if (index >= 0) setPage(Math.floor(index / pageSize) + 1)
  }, [highlightedPoint, pageSize, shown])
  useEffect(() => {
    if (!highlightedPoint || typeof document === 'undefined') return
    document.querySelector(`tr[data-row-id="${CSS.escape(highlightedPoint.id)}"]`)?.scrollIntoView({ block: 'center' })
  }, [highlightedPoint, current])

  const panelPoint = panelId ? points.find((point) => point.id === panelId) ?? null : null

  const kpi = useMemo(() => ({
    currentCount: summaryReport?.kpis.netCount ?? points.reduce((sum, row) => sum + row.metrics.netCount, 0),
    previousCount: summaryReport?.kpis.previousNetCount ?? null,
    currentValue: summaryReport?.kpis.netValue ?? points.reduce((sum, row) => sum + row.metrics.netValue, 0),
    unusedCount: stateCounts?.unused ?? null,
  }), [points, summaryReport, stateCounts])

  const addUsageHref = (point: ConversionDefinitionListItem) =>
    `/analytics?tab=funnel&conversionPointId=${encodeURIComponent(point.id)}&conversionPointName=${encodeURIComponent(point.name)}`

  /* 行の「…」。見るだけの操作は誰でも、変える操作は権限のある人だけに出す（押せない物は置かない）。 */
  const rowMenuItems = (point: ConversionDefinitionListItem): ActionMenuItem[] => [
    { id: 'detail', label: '中身を見る', onSelect: () => setDetailTarget(point) },
    { id: 'usage', label: '使う場所を見る', onSelect: () => setPanelId(point.id) },
    ...(canEdit ? [
      { id: 'add-usage', label: '使う場所を足す', external: true, onSelect: () => router.push(addUsageHref(point)) },
      ...(point.status !== 'stopped' ? [{ id: 'edit', label: '編集する', onSelect: () => openEdit(point) }] : []),
      ...(point.state === 'draft'
        ? [{ id: 'publish', label: '公開する', disabled: publishing, onSelect: () => void publishDraft(point) }]
        : point.status !== 'stopped'
          ? [{ id: 'stop', label: '止める', onSelect: () => void openStop(point, 'stop') }]
          : []),
      { id: 'duplicate', label: '複製する', disabled: duplicatingId !== null, onSelect: () => void duplicatePoint(point) },
    ] : []),
  ]

  /* ===== フォルダ ===== */
  /* 成果地点にはフォルダの口が無い（口が入るまで「すべて」だけ。作る・名前を変える操作は出さない）。 */
  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: total, icon: <Inbox size={15} aria-hidden="true" /> },
  ]
  const folderSelect = (
    <Select
      aria-label="フォルダ"
      value=""
      onChange={() => undefined}
      options={[{ value: '', label: 'フォルダ：すべて' }]}
    />
  )
  /* 閲覧のみには作るボタンを置かない（場所だけ空ける）。 */
  const createLink = <Button variant="primary" href="/conversions/new"><Plus size={15} aria-hidden="true" />成果地点を作る</Button>
  const createButton = canEdit ? createLink : <span className={styles.createSpace} aria-hidden="true" />
  const createInRow = canEdit ? createLink : <span className={styles.createSpaceRow} aria-hidden="true" />

  /* ===== 道具の段 ===== */
  /* 1152 の板（BygrU）は札を2つ（動いている・止めている）だけ。ほかの状態は「よく使う絞り込み」から選ぶ。 */
  const chipList = narrow ? CHIPS.slice(0, 2) : CHIPS
  const filterChips = (
    <div role="group" aria-label="状態で絞り込む">
      {chipList.map((chip) => {
        const count = stateCounts?.[chip.value]
        return (
          <FilterChip
            key={chip.value}
            selected={status === chip.value}
            onChange={(next) => setStatus(next ? chip.value : 'all')}
            icon={chip.icon}
          >
            {typeof count === 'number' ? `${chip.label} ${formatNumber(count)}` : chip.label}
          </FilterChip>
        )
      })}
    </div>
  )
  const sortBox = (
    <div className={styles.sortBox}>
      <SortSelect value={sort} onChange={(value) => setSort(value as PointSort)} options={SORT_OPTIONS} label="並び：" />
    </div>
  )
  const savedBox = (
    <div className={styles.savedBox}>
      <Bookmark size={15} aria-hidden="true" className={styles.savedIcon} />
      <Select
        aria-label="よく使う絞り込み"
        value={status === 'all' ? '' : status}
        onChange={(value) => setStatus((value || 'all') as StatusFilter)}
        options={[
          { value: '', label: 'よく使う絞り込み' },
          ...CHIPS.map((chip) => ({ value: chip.value, label: `${chip.label}だけ` })),
        ]}
      />
    </div>
  )
  const perPageBox = <PageSizeSelect value={pageSize} onChange={setPageSize} options={[10, 20, 50]} label={null} />
  const notice = (
    <div className={styles.noticeRow}>
      <Notice tone="info">成果地点は、配信・流入リンク・アフィリエイトの成果を数えるときに使います。止めると、使っている所でも数えなくなります。</Notice>
    </div>
  )
  const searchBox = (
    <SearchField value={query} onChange={setQuery} onClear={() => setQuery('')} placeholder="成果地点の名前で探す" aria-label="成果地点の名前で探す" />
  )
  /* 1152 の板（BygrU）：案内の帯 → 1段目「作る・フォルダ・探す」→ 2段目「札 … よく使う絞り込み・件数」。 */
  const narrowToolbar = (
    <div className={styles.narrowTools}>
      {notice}
      <div className={styles.narrowRow}>
        {createInRow}
        <div className={styles.narrowFolder}>{folderSelect}</div>
        <div className={styles.narrowSearch}>{searchBox}</div>
      </div>
      <div className={styles.narrowRow}>
        <div className={styles.narrowChips}>{filterChips}</div>
        <span className={styles.spacer} aria-hidden="true" />
        {savedBox}
        {perPageBox}
      </div>
    </div>
  )
  const wideToolbar = (
    <div className={styles.wideTools}>
      {notice}
      <ListToolbar
        search={{ placeholder: '成果地点の名前で探す', label: '成果地点の名前で探す', width: 240, value: query, onChange: setQuery }}
        filters={filterChips}
        trailing={<>{savedBox}{sortBox}{perPageBox}</>}
      />
    </div>
  )

  const clearFilters = () => {
    setQuery('')
    setDebouncedQuery('')
    setStatus('all')
    setPage(1)
  }

  /* ===== 表の下の小窓（詳細・止める） ===== */
  const detailCard = panelPoint ? (
    <section className={styles.panel} aria-label="詳細の小窓">
      <h2 className={styles.panelTitle}>{`詳細の小窓：${panelPoint.name}`}</h2>
      <p className={styles.panelLine}>
        <StatePill point={panelPoint} />
        <span>{`${sourceTriggerLabel(panelPoint)}・${deduplicationLabel(panelPoint.deduplicationMode, panelPoint.deduplicationWindowDays)}`}</span>
      </p>
      <p className={styles.panelText}>{`使われている場所：${usageLabel(panelPoint)}`}</p>
      {panelPoint.measureMethod === 'webhook' ? (
        <p className={styles.panelText}>
          {`受け口：POST /api/conversions/ingest/${panelPoint.id}${panelPoint.ingest.disabledAt ? '（止まっています）' : panelPoint.ingest.configured ? '（動いています）' : '（まだ鍵を発行していません）'}`}
        </p>
      ) : null}
      {issuedSecret && panelPoint.measureMethod === 'webhook' ? (
        <p className={styles.secretBox} role="status">{`発行した鍵（この表示でだけ見られます。連携先へ渡してください）：${issuedSecret}`}</p>
      ) : null}
      {ingestError ? <p className={styles.errorText} role="alert">{ingestError}</p> : null}
      <div className={styles.panelButtons}>
        {canEdit && panelPoint.measureMethod === 'webhook' && panelPoint.status !== 'stopped' ? (
          <Button onClick={() => void issueIngest(panelPoint)} disabled={ingestBusy !== ''} busy={ingestBusy === 'issue'} busyLabel="発行しています">鍵を発行する</Button>
        ) : null}
        {canEdit && panelPoint.measureMethod === 'webhook' && panelPoint.ingest.configured && panelPoint.status !== 'stopped' ? (
          <Button onClick={() => void toggleIngest(panelPoint)} disabled={ingestBusy !== ''} busy={ingestBusy === 'toggle'} busyLabel="切り替えています">
            {panelPoint.ingest.disabledAt ? '受け口を再開する' : '受け口を止める'}
          </Button>
        ) : null}
        {canEdit && panelPoint.status !== 'stopped' ? <Button onClick={() => openEdit(panelPoint)}>編集する</Button> : null}
        {canEdit && panelPoint.state === 'draft' ? (
          <Button onClick={() => void publishDraft(panelPoint)} disabled={publishing} busy={publishing} busyLabel="公開しています">公開する</Button>
        ) : null}
        {canEdit && panelPoint.status !== 'stopped' && panelPoint.state !== 'draft' ? (
          <Button onClick={() => void openStop(panelPoint, 'stop')}><CirclePause size={15} aria-hidden="true" />止める</Button>
        ) : null}
        {canEdit && panelPoint.status !== 'stopped' ? <Button variant="danger" onClick={() => void openStop(panelPoint, 'delete')}>削除する</Button> : null}
        <Button onClick={() => setDetailTarget(panelPoint)}>中身を見る</Button>
        <Button variant="text" onClick={() => setPanelId(null)}>閉じる</Button>
      </div>
    </section>
  ) : null

  const stopCard = stopTarget ? (
    <section className={styles.panel} aria-label="止めるときの小窓">
      <h2 className={styles.panelTitle}>{`「${stopTarget.name}」を止める`}</h2>
      <p className={styles.panelText}>
        {stopImpactLoading
          ? '利用先と影響を読み込んでいます。'
          : stopImpact
            ? `${formatNumber(stopImpact.stopImpact.affectedUsageCount)}か所で使われています。どうしますか。`
            : '利用先と影響を読み込めませんでした。'}
      </p>
      <RadioCardGroup legend="どうしますか？">
        <RadioCard
          name="conversion-v8-stop-action"
          value="stop"
          checked={stopAction === 'stop'}
          onChange={() => setStopAction('stop')}
          title="止める（使う所の計測も止まる）"
          note="これから先は数えません。過去の記録と分析は残します。"
        />
        <RadioCard
          name="conversion-v8-stop-action"
          value="replace"
          checked={stopAction === 'replace'}
          onChange={() => setStopAction('replace')}
          disabled={!stopImpact?.replacementCandidates.length}
          disabledReason="差し替え先の成果地点がありません"
          title="別の成果地点に差し替えてから止める"
          note="利用先を別の成果地点へ切り替え、過去の数字を残します。"
        />
        <RadioCard
          name="conversion-v8-stop-action"
          value="delete"
          checked={stopAction === 'delete'}
          onChange={() => setStopAction('delete')}
          disabled={!stopImpact?.canDelete}
          disabledReason="成果または利用先があるため、物理削除は選べません。"
          title="削除する（使われていないときだけ選べる）"
          note={stopImpact?.canDelete ? '成果0件・利用先0件のため、この成果地点だけを削除できます。' : '成果または利用先があるため、物理削除は選べません。'}
        />
      </RadioCardGroup>
      {stopAction === 'replace' ? (
        <div className={styles.fieldBox}>
          <Select
            aria-label="差し替え先の成果地点"
            value={replacementId}
            options={[
              { value: '', label: '差し替え先を選ぶ' },
              ...(stopImpact?.replacementCandidates ?? []).map((item) => ({ value: item.id, label: `差し替え先：${item.name}` })),
            ]}
            onChange={setReplacementId}
          />
        </div>
      ) : null}
      <label className={styles.fieldBox}>
        <span className={styles.fieldLabel}>理由（必須）</span>
        <input
          aria-label="止める理由"
          className={styles.reasonInput}
          value={stopReason}
          maxLength={500}
          placeholder="計測の仕方を変えるため"
          onChange={(event) => setStopReason(event.target.value)}
        />
      </label>
      {stopError ? <p className={styles.errorText} role="alert">{stopError}</p> : null}
      <div className={styles.panelActions}>
        <Button onClick={() => setStopTarget(null)} disabled={stopping}>キャンセル</Button>
        <Button
          variant="primary"
          disabled={stopping || stopImpactLoading || !stopReason.trim() || (stopAction === 'replace' && !replacementId)}
          onClick={() => void runStop()}
          busy={stopping || stopImpactLoading}
          busyLabel="止めています"
        >
          {stopAction === 'delete' ? '削除する' : '止める'}
        </Button>
      </div>
    </section>
  ) : null

  /* ===== 表 ===== */
  let listBody: ReactNode
  if (loading) {
    listBody = <ListSkeleton />
  } else if (loadFailed) {
    listBody = (
      <div className={styles.stateBox}>
        <Notice tone="warn" action={<Button variant="text" onClick={() => void load()}>もう一度試す</Button>}>成果地点を読み込めませんでした</Notice>
        <p className={styles.stateNote}>数の帯は「—」です。検索や絞り込みはそのまま使えます（条件を変えてから試し直せます）。</p>
      </div>
    )
  } else if (shown.length === 0) {
    /* 修正案 D-2：空の一覧。 */
    listBody = (
      <EmptyList
        icon={<Target aria-hidden="true" />}
        title="まだ成果地点がありません"
        description="「商品を買った」など、成果として数えるできごとを決めます。"
        create={{ label: '最初の成果地点を作る', href: '/conversions/new' }}
        canCreate={canEdit}
        filtered={points.length > 0 || Boolean(debouncedQuery)}
        onClearFilters={clearFilters}
      />
    )
  } else {
    listBody = (
      <>
        {listTruncated ? (
          <div className={styles.inlineNotice}>
            <Notice tone="warn">一覧は先頭5000個までを表示しています。これより後ろの成果地点は検索や絞り込みで範囲を分けて確認してください。</Notice>
          </div>
        ) : null}
        <div className={`${styles.tableWrap} ${narrow ? styles.tableWrapNarrow : ''}`}>
          <DataTable className={styles.table}>
            <TableHead />
            <tbody>
              {current.map((point) => {
                const usage = usageLines(point)
                const menuLabel = `成果地点「${point.name}」の操作`
                const highlighted = highlightedPoint?.id === point.id
                return (
                  <Tr
                    key={point.id}
                    interactive
                    selected={panelId === point.id || highlighted}
                    className={styles.row}
                    data-table-layout="columns"
                    data-row-id={point.id}
                    onClick={() => setPanelId((currentId) => (currentId === point.id ? null : point.id))}
                  >
                    <Td className={styles.colName}>
                      {/* 名前の前にフォルダの丸（成果地点はまだフォルダの口が無いので未分類の輪）。札は名前の頭にそろえる。 */}
                      <FolderDotName folder={null}>
                      <button
                        type="button"
                        className={styles.nameButton}
                        title={point.name}
                        aria-expanded={panelId === point.id}
                        aria-label={`「${point.name}」の詳細を見る`}
                        onClick={(event) => { event.stopPropagation(); setPanelId((currentId) => (currentId === point.id ? null : point.id)) }}
                      >
                        {point.name}
                      </button>
                      </FolderDotName>
                      <span className={styles.pillIndent}><StatePill point={point} /></span>
                    </Td>
                    <Td className={styles.colTrigger}>
                      <span className={styles.cellMain} title={sourceTriggerLabel(point)}>{shortTrigger(point)}</span>
                      <span className={styles.cellSub} title={rowSub(point)}>{rowSub(point)}</span>
                    </Td>
                    <Td className={styles.colCount}><span className={styles.num}>{`${formatNumber(point.metrics.netCount)}件`}</span></Td>
                    <Td className={styles.colValue}>
                      <span className={styles.num}>{point.metrics.netValue > 0 ? `¥${formatNumber(point.metrics.netValue)}` : '—'}</span>
                    </Td>
                    <Td className={styles.colUsage}>
                      <span className={styles.usageMain} title={usageLabel(point)}>{usage.main}</span>
                      {usage.sub ? <span className={styles.cellSub} title={usage.sub}>{usage.sub}</span> : null}
                    </Td>
                    <Td className={styles.colOps} onClick={(event) => event.stopPropagation()}>
                      <div className={styles.opsBox}>
                        {canEdit
                          ? <Button href={addUsageHref(point)}>使う場所を足す</Button>
                          : <span className={styles.opsSpace} aria-hidden="true" />}
                        <RowMenu
                          label={menuLabel}
                          open={openMenuId === point.id}
                          onOpenChange={(next) => setOpenMenuId(next ? point.id : null)}
                          items={rowMenuItems(point).map((item) => ({ ...item, onSelect: () => { setOpenMenuId(null); item.onSelect() } }))}
                        />
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        </div>
        {detailCard || stopCard ? <div className={styles.panels}>{detailCard}{stopCard}</div> : null}
        <p className={`${styles.footNote} ${narrow ? styles.footNoteNarrow : ''}`}>
          {canEdit
            ? '行の「…」から 編集・使う場所を見る・使う場所を足す・止める・複製。止めると、使っている配信や流入リンクでも数えなくなります。'
            : '行の「…」から 中身と使う場所を見られます。止めると、使っている配信や流入リンクでも数えなくなります。'}
        </p>
      </>
    )
  }

  const pager = !loading && !loadFailed && pageCount > 1 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>
        {`${(currentPage - 1) * pageSize + 1}〜${(currentPage - 1) * pageSize + current.length} / ${formatNumber(shown.length)}件`}
      </span>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} ariaLabel="成果地点の一覧のページ送り" />
    </ListPagePagination>
  ) : null

  const listUnavailable = loading || loadFailed
  const reportUnavailable = listUnavailable || reportFailed
  const delta = kpi.previousCount === null ? null : kpi.currentCount - kpi.previousCount

  return (
    <ListPage
      boardId="r6dJFy"
      headingSize="regular"
      title="コンバージョン"
      description="成果として数えるできごと（成果地点）を決めます。配信・流入・アフィリエイトの成果は、ここの数え方で集計します。"
      actions={
        <Button onClick={() => void exportCsv()} disabled={exporting} busy={exporting} busyLabel="書き出しています…">
          <Download size={15} aria-hidden="true" />CSV で書き出す
        </Button>
      }
      stats={<>
        {!canEdit && role !== null ? (
          <div className={styles.viewerBand} role="status">
            <Eye size={16} aria-hidden="true" />
            <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
          </div>
        ) : null}
        {exportError ? <div className={styles.statsNotice}><Notice tone="warn">{exportError}</Notice></div> : null}
        {actionError ? <div className={styles.statsNotice}><Notice tone="warn">{actionError}</Notice></div> : null}
        {actionNotice ? <div className={styles.statsNotice}><Notice tone="success">{actionNotice}</Notice></div> : null}
        {highlightedPoint ? <div className={styles.statsNotice}><Notice tone="success">{`「${highlightedPoint.name}」を保存しました。色の付いた行です。`}</Notice></div> : null}
        {reportFailed && !loadFailed ? (
          <div className={styles.statsNotice}>
            <Notice tone="info" action={<Button onClick={() => void reloadReport()}>集計を読み直す</Button>}>集計を表示できませんでした。一覧はそのまま使えます。</Notice>
          </div>
        ) : null}
        <KpiBand>
          <KpiCard
            presentation="band"
            title="成果地点"
            icon={<Target size={13} aria-hidden="true" />}
            help="登録している成果地点の数です。"
            value={listUnavailable ? null : total}
            unit="件"
            detail={stateCounts ? `動いている ${formatNumber(stateCounts.active)}・止めている ${formatNumber(stateCounts.stopped)}` : '—'}
          />
          <KpiCard
            presentation="band"
            title="この30日の成果"
            icon={<Trophy size={13} aria-hidden="true" />}
            help="この30日に数えた成果の件数です（取り消しを引いた数）。"
            value={reportUnavailable ? null : kpi.currentCount}
            unit="件"
            detail={delta === null || reportUnavailable ? '—' : `その前の30日より ${delta >= 0 ? '+' : ''}${formatNumber(delta)}`}
          />
          <KpiCard
            presentation="band"
            title="この30日の金額"
            icon={<Banknote size={13} aria-hidden="true" />}
            help="この30日に数えた成果の金額の合計です。"
            value={reportUnavailable ? null : kpi.currentValue}
            valueText={reportUnavailable ? undefined : `¥${formatNumber(kpi.currentValue)}`}
            unit=""
            detail={listTruncated ? '直近5000件までの合計です' : '注文の金額で数えるもの'}
          />
          <KpiCard
            presentation="band"
            title={narrow ? '使われていない' : 'どこからも使われていない'}
            icon={<Unplug size={13} aria-hidden="true" />}
            help="配信・流入リンク・アフィリエイトのどこからも使われていない成果地点です。"
            value={listUnavailable ? null : kpi.unusedCount}
            unit="件"
            detail="配信・流入・アフィリエイトで未使用"
          />
        </KpiBand>
      </>}
      folders={<>
        {createButton}
        <FolderPanel activeId="" onSelect={() => undefined} rows={folderRows} />
      </>}
      collapsedFolders={narrow ? undefined : <>{createInRow}{folderSelect}</>}
      toolbar={narrow ? narrowToolbar : wideToolbar}
      pagination={pager}
      overlays={<>
        <ConversionDetailDialog
          detailTarget={detailTarget}
          setDetailTarget={setDetailTarget}
          publishing={publishing}
          publishDraft={(target) => void publishDraft(target)}
          openEdit={openEdit}
          openStop={(target) => void openStop(target)}
          issueIngest={(target) => void issueIngest(target)}
          toggleIngest={(target) => void toggleIngest(target)}
          ingestBusy={ingestBusy}
          ingestError={ingestError}
          issuedSecret={issuedSecret}
          ingestEvents={ingestEvents}
          definitionEvents={definitionEvents}
          eventsFailed={eventsFailed}
          canReverse={canEdit}
          openReversal={openReversal}
        />
        <ConversionReversalDialog
          reversalTarget={reversalTarget}
          reversalKind={reversalKind}
          reversalBusy={reversalBusy}
          reversalError={reversalError}
          reversalReason={reversalReason}
          setReversalTarget={setReversalTarget}
          setReversalReason={setReversalReason}
          submitReversal={() => void submitReversal()}
        />
        <ConversionEditDialog
          editTarget={editTarget}
          setEditTarget={setEditTarget}
          editForm={editForm}
          setEditForm={setEditForm}
          editValueModeNotice={editValueModeNotice}
          setEditValueModeNotice={setEditValueModeNotice}
          editSaving={editSaving}
          editError={editError}
          submitEdit={() => void submitEdit()}
        />
      </>}
    >
      {listBody}
    </ListPage>
  )
}
