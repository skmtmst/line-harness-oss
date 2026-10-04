'use client'

/* ★V8の一覧・閲覧のみ・狭い幅。数は実データで、未集計のものは「—」。 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarClock, MousePointerClick, Users, Video } from 'lucide-react'
import Button from '@/components/shared/button'
import { TableHeadRow, Th } from '@/components/shared/table'
import { RowActions } from '@/components/shared/row-actions'
import Pagination from '@/components/shared/pagination'
import ListState from '@/components/shared/list-state'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import ListRange from '@/components/ui/list-range'
import PageSizeSelect from '@/components/ui/page-size-select'
import SortSelect from '@/components/ui/sort-select'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import HelpTip from '@/components/shared/help-tip'
import { webinarListCsv } from './list-csv'
import FilterChip from '@/components/shared/filter-chip'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { runUndoable } from '@/lib/undoable'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { X } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import {
  ApiError,
  webinarApi,
  type Webinar,
  type WebinarFolder,
  type WebinarListItem,
  type WebinarListParams,
  type WebinarListResponse,
  type WebinarOverview,
  type WebinarOverviewMetric,
} from '@/lib/api'
import { publicationStateLabel } from '@/components/webinars/publication-label'
import { formatDateTime } from '@/lib/format'
import { webinarLoadFailure, type WebinarLoadFailure } from './webinar-load-failure'
import styles from './list-v8.module.css'

type SortKey = 'updated' | 'created' | 'name'
type SavedFilter = '' | 'active' | 'draft'

const UNFILED = '__unfiled__'

/** 検索入力を口へ渡すまでの待ち時間。1文字ごとの取り直しを束ねる。 */
export const WEBINAR_SEARCH_DEBOUNCE_MS = 300
export function scheduleWebinarSearch(query: string, onReady: (value: string) => void): () => void {
  const timer = setTimeout(() => onReady(query), WEBINAR_SEARCH_DEBOUNCE_MS)
  return () => clearTimeout(timer)
}

function scheduleSummary(w: Webinar): string {
  if (w.schedule.length === 0) return '未設定'
  const DAYS = ['日', '月', '火', '水', '木', '金', '土']
  const dailyTimes = w.schedule
    .filter((rule) => rule.type === 'daily' && rule.time)
    .map((rule) => rule.time as string)
    .sort()
  const otherRules = w.schedule.filter((rule) => rule.type !== 'daily')
  const parts: string[] = []
  if (dailyTimes.length > 0) {
    const toMinutes = (time: string) => {
      const [hours, minutes] = time.split(':').map(Number)
      return hours * 60 + minutes
    }
    const intervals = dailyTimes.slice(1).map((time, index) => toMinutes(time) - toMinutes(dailyTimes[index]))
    const interval = intervals.length > 0 && intervals.every((value) => value === intervals[0]) ? intervals[0] : null
    parts.push(
      dailyTimes.length === 1
        ? `毎日 ${dailyTimes[0]}`
        : `毎日 ${dailyTimes[0]}〜${dailyTimes[dailyTimes.length - 1]}${interval ? `・${interval}分間隔` : ''}（${dailyTimes.length}枠）`,
    )
  }
  otherRules.forEach((rule) => {
    if (rule.type === 'weekly') parts.push(`毎週${(rule.days ?? []).map((day) => DAYS[day]).join('・')} ${rule.time}`)
    if (rule.type === 'once') parts.push(rule.at ? formatDateTime(rule.at) : '単発・日時未設定')
  })
  return parts.join(' / ')
}

function publicationSummary(webinar: WebinarListItem): string {
  return publicationStateLabel(webinar.publicationState, webinar.publicationStartsAt, webinar.publicationEndsAt)
    ?? scheduleSummary(webinar)
}

/*
 * V8 の状態の札。公開期間が終わったものは「終了」にそろえる
 * （`VXZ6T` と同じ。`UyUMw` の「非公開」とは1箇所だけ違う）。
 * 「受付中」はどちらの板にもあるが、公開予定との線引きが板ごとに
 * 違う（同じ webinar が `UyUMw` では公開予定・`VXZ6T` では受付中）ので
 * 使わない。公開の予定は「公開予定」にそろえる。
 */
function statusLabelV8(webinar: WebinarListItem): string {
  if (webinar.publicationState === 'scheduled') return '公開予定'
  if (webinar.publicationState === 'ended') return '終了'
  if (webinar.status === 'draft') return '下書き'
  if (webinar.status === 'archived') return 'アーカイブ'
  return '公開中'
}

function statusPillClass(webinar: WebinarListItem): string {
  if (webinar.publicationState === 'scheduled') return `${styles.pill} ${styles.pillScheduled}`
  if (webinar.status === 'active' && webinar.publicationState !== 'ended') return `${styles.pill} ${styles.pillActive}`
  return `${styles.pill} ${styles.pillNeutral}`
}

/*
 * 公開していない行（下書き・アーカイブ・期間終了・期間未設定）の
 * 申込・視聴は「—」。COUNT が 0 と未取得を同じ見た目にしない。
 */
function isUnpublished(webinar: WebinarListItem): boolean {
  if (webinar.status !== 'active') return true
  return webinar.publicationState === 'ended' || webinar.publicationState === 'unset' || !webinar.publicationState
}

function peopleText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${formatNumber(value)}人` : '—'
}

function metricText(metric: WebinarOverviewMetric | undefined, unit: string): string {
  if (!metric || metric.state !== 'available' || metric.value === null) return '—'
  return `${formatNumber(metric.value)}${unit}`
}

type KpiCell = {
  key: string
  icon: ReactNode
  label: string
  value: string
  unit: string
  sub: string
}

/*
 * 数の帯の4マス。概要の口の形のまま（無い数は「—」。0にしない）。
 * 補足は口にある数だけ（先月比・フォーム送信は口に無いので出さない）。
 */
function webinarKpiCells(overview: WebinarOverview | null): KpiCell[] {
  const metrics = overview?.metrics
  const total = metricText(metrics?.webinars, '')
  const active = metrics?.activeWebinars?.state === 'available' && metrics.activeWebinars.value !== null
    ? `公開中 ${formatNumber(metrics.activeWebinars.value)}件`
    : ' '
  const registrations = metricText(metrics?.registrations, '')
  const bookings = metrics?.registrationBookings?.state === 'available' && metrics.registrationBookings.value !== null
    ? `延べ予約 ${formatNumber(metrics.registrationBookings.value)}件`
    : ' '
  const viewers = metricText(metrics?.viewers, '')
  const viewRate = metrics?.viewRate?.state === 'available' && metrics.viewRate.value !== null
    ? `視聴率 ${Math.round(metrics.viewRate.value * 1000) / 10}%`
    : ' '
  const ctaClicks = metrics?.ctaTotalClicks?.state === 'available' && metrics.ctaTotalClicks.value !== null
    ? metricText(metrics?.ctaTotalClicks, '')
    : '—'
  const ctaPeople = metrics?.ctaUniquePeople?.state === 'available' && metrics.ctaUniquePeople.value !== null
    ? `押した人 ${formatNumber(metrics.ctaUniquePeople.value)}人`
    : ' '
  return [
    { key: 'webinars', icon: <Video size={14} />, label: 'ウェビナー', value: total, unit: '件', sub: active },
    { key: 'registrations', icon: <Users size={14} />, label: '申込', value: registrations, unit: '人', sub: bookings },
    { key: 'viewers', icon: <CalendarClock size={14} />, label: '視聴', value: viewers, unit: '人', sub: viewRate },
    { key: 'cta', icon: <MousePointerClick size={14} />, label: 'CTAクリック', value: ctaClicks, unit: '回', sub: ctaPeople },
  ]
}

function WebinarFolderDialog({
  folder,
  busy,
  error,
  onCancel,
  onSave,
}: {
  folder: WebinarFolder | null
  busy: boolean
  error: string
  onCancel: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(folder?.name ?? '')
  const panelRef = useOverlayFocus(true, onCancel, busy)

  return (
    <div className="bg-ink/35 fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="webinar-v8-folder-title">
      <section ref={panelRef} className="bg-canvas rounded-card w-full max-w-md border border-hairline p-5 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <h2 id="webinar-v8-folder-title" className="text-ink text-lg font-bold">
            {folder ? 'フォルダ名を変更' : 'フォルダを追加'}
          </h2>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <p className="text-ink-secondary mt-2 text-sm">ウェビナーを整理する名前を入力してください。</p>
        <label className="text-ink mt-4 block text-sm font-semibold" htmlFor="webinar-v8-folder-name">フォルダ名</label>
        <input
          id="webinar-v8-folder-name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim() && !busy) onSave(name.trim())
          }}
          className="border-hairline rounded-control focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          placeholder="例: 商品説明"
        />
        {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>キャンセル</Button>
          <Button variant="primary" onClick={() => onSave(name.trim())} disabled={!name.trim() || busy} busy={busy}>保存する
          </Button>
        </div>
      </section>
    </div>
  )
}

/*
 * アーカイブの確かめ（`VXZ6T`）。対象とアーカイブしたあとの3点を言う。
 * 3点目の「いつでも元に戻せます」は戻す口が無いので、
 * 「「アーカイブ」のフォルダで確認できます」と出す。
 */
export function WebinarArchiveConfirmV8({
  target,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  target: WebinarListItem
  busy: boolean
  error: string | undefined
  onCancel: () => void
  onConfirm: () => void
}) {
  const blocked = target.status === 'active'
  return (
    <ConfirmDialog
      open
      designNode="VXZ6T"
      title="ウェビナーをアーカイブしますか？"
      description="アーカイブすると、一覧から外れて新しく使えなくなります。記録は残ります。"
      confirmLabel="アーカイブする"
      destructive
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={blocked ? undefined : onConfirm}
    >
      <p className={styles.archiveTarget}>アーカイブの対象</p>
      <p className={styles.archiveTargetSub}>{target.title}（{publicationSummary(target)}）</p>
      <ul className={styles.archiveAfter}>
        <li>・参加者・視聴の記録・分析はそのまま見られます</li>
        <li>・公開ページは閉じ、新しい申込は受け付けません</li>
        <li>・「アーカイブ」のフォルダで確認できます</li>
      </ul>
      {blocked ? (
        <Notice tone="warn">
          公開中のウェビナーは、このままではアーカイブできません。先に公開を停止してから、もう一度アーカイブしてください。
          <span className="mt-2 block"><Button href={`/webinars/edit?id=${target.id}`}>編集画面で公開を停止する</Button></span>
        </Notice>
      ) : null}
    </ConfirmDialog>
  )
}

/**
 * A. 読み込み中の骨組み（V8だけ）。本物の表と同じ見出し・列幅・行の
 * 高さで5行出し、入れ替わってもガタつかない。0.3秒以内に来たら出さない・
 * 出したら最低0.4秒は `DelayedSkeleton` が面倒を見る。
 */
function WebinarListSkeleton() {
  return (
    <div className={styles.tableWrap} aria-busy="true">
      <span className="sr-only">ウェビナーの一覧を読み込んでいます</span>
      <DelayedSkeleton
        loading
        skeleton={
          <table className={styles.table} aria-hidden="true" inert>
            <thead>
              <TableHeadRow>
                <Th>ウェビナー名</Th>
                <Th>状態</Th>
                <Th align="right">申込</Th>
                <Th>視聴</Th>
                <Th>公開期間</Th>
                <Th>操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map((index) => (
                <tr key={index}>
                  <td className={styles.nameCell}>
                    <Skeleton className="block h-3.5 w-3/4" />
                    <span className="mt-0.5 block"><Skeleton className="block h-2.5 w-1/2" /></span>
                  </td>
                  <td><Skeleton className="block h-5.5 w-16" /></td>
                  <td className={styles.countCell}><Skeleton className="ml-auto block h-3.5 w-12" /></td>
                  <td>
                    <Skeleton className="block h-3 w-24" />
                    <span className="mt-1 block"><Skeleton className="block h-3 w-20" /></span>
                  </td>
                  <td><Skeleton className="block h-3.5 w-40" /></td>
                  <td className={styles.opsCell}><Skeleton className="block h-8 w-18" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      />
    </div>
  )
}

export function WebinarListTableV8({
  items,
  canEdit,
  readonlyReason,
  onArchive,
}: {
  items: WebinarListItem[]
  canEdit: boolean
  readonlyReason: string
  onArchive: (target: WebinarListItem) => void
}) {
  const router = useRouter()
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <TableHeadRow>
            <Th>ウェビナー名</Th>
            <Th>状態</Th>
            <Th align="right">申込</Th>
            <Th>視聴</Th>
            <Th>公開期間</Th>
            <Th>操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {items.map((w) => {
            const unpublished = isUnpublished(w)
            const viewStarted = unpublished ? '—' : peopleText(w.viewerCount)
            const period = publicationSummary(w)
            return (
              <tr key={w.id}>
                <td className={styles.nameCell}>
                  <Link href={`/webinars/edit?id=${w.id}`} className={styles.nameLink} title={w.title}>{w.title}</Link>
                  <span className={styles.slug} title={`/${w.slug}`}>/{w.slug}</span>
                </td>
                <td><span className={statusPillClass(w)}>● {statusLabelV8(w)}</span></td>
                <td className={styles.countCell}>{unpublished ? '—' : peopleText(w.registrationCount)}</td>
                <td>
                  <div className={styles.viewCell} title={unpublished ? '公開していないので視聴数はありません' : undefined}>
                    <div>視聴完了 —</div>
                    <div>視聴開始 {viewStarted}</div>
                  </div>
                </td>
                <td><span className={styles.periodCell} title={period}>{period}</span></td>
                <td className={styles.opsCell}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {canEdit
                      ? <Button href={`/webinars/edit?id=${w.id}`}>編集</Button>
                      : <Button disabled title={readonlyReason}>編集</Button>}
                    <RowActions
                      subjectName={w.title}
                      menuNote={canEdit ? undefined : readonlyReason}
                      menuItems={[
                        { id: 'participants', label: '参加者を見る', onSelect: () => router.push(`/webinars/edit?id=${encodeURIComponent(w.id)}&pane=participants`) },
                        { id: 'analytics', label: '分析を見る', onSelect: () => router.push(`/webinars/edit?id=${encodeURIComponent(w.id)}&pane=analytics`) },
                        { id: 'comments', label: 'コメント演出を開く', onSelect: () => router.push(`/webinars/edit?id=${encodeURIComponent(w.id)}&pane=comments`) },
                        {
                          id: 'archive',
                          label: 'アーカイブする',
                          onSelect: () => onArchive(w),
                          disabled: !canEdit,
                          disabledReason: canEdit ? undefined : readonlyReason,
                        },
                      ]}
                    />
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface WebinarListSnapshot {
  items: WebinarListItem[]
  total: number
  loadedAccountId: string | null
}

function beginWebinarListRefresh(
  snapshot: WebinarListSnapshot,
  accountId: string,
): 'initial' | 'background' {
  return snapshot.loadedAccountId === accountId ? 'background' : 'initial'
}

function commitWebinarListResponse(args: {
  snapshot: WebinarListSnapshot
  currentGeneration: number
  generation: number
  accountId: string
  res: { data: { items: unknown; total: unknown } } | null | undefined
}): WebinarListSnapshot | null {
  if (args.currentGeneration !== args.generation) return null
  const res = args.res
  if (!res || !res.data || !Array.isArray(res.data.items) || typeof res.data.total !== 'number') {
    throw new ApiError(500, 'ウェビナーの一覧が読めない形で返りました')
  }
  return { items: res.data.items as WebinarListItem[], total: res.data.total, loadedAccountId: args.accountId }
}

export async function requestWebinarListV8(args: {
  list: (accountId: string, params: WebinarListParams) => Promise<{ data: WebinarListResponse }>
  snapshot: WebinarListSnapshot
  generation: number
  currentGeneration: () => number
  accountId: string
  params: WebinarListParams
}): Promise<WebinarListSnapshot | null> {
  const res = await args.list(args.accountId, args.params)
  return commitWebinarListResponse({
    snapshot: args.snapshot,
    currentGeneration: args.currentGeneration(),
    generation: args.generation,
    accountId: args.accountId,
    res,
  })
}

export function WebinarListErrorNotice({ failure, onRetry }: { failure: WebinarLoadFailure; onRetry: () => void }) {
  return <div role="alert" className="border-hairline border-b px-4 py-3"><p className="text-ink text-sm font-semibold">{failure.title}</p><p className="text-ink-secondary mt-1 text-xs">{failure.description}</p>{failure.retryable ? <Button onClick={onRetry}>もう一度読み込む</Button> : null}</div>
}

export function WebinarListContent({ accountLoading, loading, selectedAccountId, accountsCount, loadFailure, visibleItems, panelGrand, refreshing, onRetry, onArchive, canEdit = true, readonlyReason = '', onClearFilters = () => undefined }: {
  accountLoading: boolean; loading: boolean; selectedAccountId: string | null; accountsCount: number; loadFailure: WebinarLoadFailure | null; visibleItems: WebinarListItem[]; panelGrand: number | null; refreshing: boolean; onRetry: () => void; onArchive: (item: WebinarListItem) => void; canEdit?: boolean; readonlyReason?: string; onClearFilters?: () => void
}) {
  if (accountLoading || loading) return <WebinarListSkeleton />
  if (!selectedAccountId) return <ListState kind="empty" title={accountsCount > 0 ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'} />
  if (loadFailure && visibleItems.length === 0) return <ListState kind={loadFailure.kind} title={loadFailure.title} description={loadFailure.description} action={loadFailure.retryable ? <Button onClick={onRetry}>もう一度読み込む</Button> : undefined} />
  if (visibleItems.length === 0) return panelGrand === 0 ? <ListState kind="empty" title="まだ、ウェビナーはありません" description="録画やライブのセミナーを作ると、LINEで案内して申込を受けられます。" action={canEdit ? <Button href="/webinars/new">＋ ウェビナーを作る</Button> : <Button disabled title={readonlyReason}>＋ ウェビナーを作る</Button>} /> : <ListState kind="empty" title="条件に合うウェビナーはありません" description="検索や絞り込みを外すと、すべて出ます。" action={<Button onClick={onClearFilters}>条件を外す</Button>} />
  return <>{loadFailure ? <WebinarListErrorNotice failure={loadFailure} onRetry={onRetry} /> : null}{refreshing ? <p role="status" className="text-ink-faint text-xs">検索中…</p> : null}<WebinarListTableV8 items={visibleItems} canEdit={canEdit} readonlyReason={readonlyReason} onArchive={onArchive} /></>
}

export default function WebinarListV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <WebinarListV8Inner />
    </Suspense>
  )
}

function WebinarListV8Inner() {
  usePageTitle('ウェビナー')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  // jiNg0「閲覧のみ」：押せない形にする（隠さない）。
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  const readonlyReason = 'この操作にはオーナーか管理者の権限が要ります'

  const requestGeneration = useRef(0)
  const overviewRequestGeneration = useRef(0)
  const folderRequestGeneration = useRef(0)
  const [items, setItems] = useState<WebinarListItem[]>([])
  const [total, setTotal] = useState(0)
  const [grandTotal, setGrandTotal] = useState(0)
  const [grandAccountId, setGrandAccountId] = useState<string | null>(null)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [overviewFailure, setOverviewFailure] = useState<WebinarLoadFailure | null>(null)
  const [overview, setOverview] = useState<WebinarOverview | null>(null)
  const [loadedOverviewAccountId, setLoadedOverviewAccountId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [savedFilter, setSavedFilter] = useState<SavedFilter>('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadFailure, setLoadFailure] = useState<WebinarLoadFailure | null>(null)
  const listSnapshotRef = useRef<WebinarListSnapshot>({ items: [], total: 0, loadedAccountId: null })
  const [archiveTarget, setArchiveTarget] = useState<WebinarListItem | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [foldersReady, setFoldersReady] = useState(false)
  const [folders, setFolders] = useState<WebinarFolder[]>([])
  const [selectedFolder, setSelectedFolder] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<WebinarFolder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<WebinarFolder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')

  const visibleItems = loadedAccountId === selectedAccountId ? items : []
  const visibleOverview = loadedOverviewAccountId === selectedAccountId ? overview : null

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current
    if (!selectedAccountId) {
      setItems([])
      setTotal(0)
      setLoadedAccountId(null)
      setLoadFailure(null)
      setLoading(false)
      setRefreshing(false)
      return
    }
    const accountId = selectedAccountId
    const mode = beginWebinarListRefresh(listSnapshotRef.current, accountId)
    if (mode === 'initial') {
      setLoading(true)
      setItems([])
      setLoadedAccountId(null)
    } else {
      setRefreshing(true)
    }
    setLoadFailure(null)
    try {
      const next = await requestWebinarListV8({
        list: webinarApi.list,
        snapshot: listSnapshotRef.current,
        generation,
        currentGeneration: () => requestGeneration.current,
        accountId,
        params: {
          page,
          limit: pageSize,
          q: debouncedQuery.trim() || undefined,
          folder: selectedFolder || undefined,
          status: savedFilter || undefined,
          sort: sortKey,
        },
      })
      if (next === null) return
      setItems(next.items)
      setTotal(next.total)
      setLoadedAccountId(next.loadedAccountId)
    } catch (err) {
      if (requestGeneration.current === generation) setLoadFailure(webinarLoadFailure(err))
    } finally {
      if (requestGeneration.current === generation) {
        if (mode === 'initial') setLoading(false)
        else setRefreshing(false)
      }
    }
  }, [selectedAccountId, page, pageSize, debouncedQuery, selectedFolder, savedFilter, sortKey])

  const refreshOverview = useCallback(async () => {
    const generation = ++overviewRequestGeneration.current
    setOverview(null)
    setOverviewFailure(null)
    setLoadedOverviewAccountId(null)
    if (!selectedAccountId) return
    const accountId = selectedAccountId
    try {
      const res = await webinarApi.overview(accountId)
      if (overviewRequestGeneration.current !== generation) return
      setOverview(res.data)
      setLoadedOverviewAccountId(accountId)
    } catch (cause) {
      if (overviewRequestGeneration.current !== generation) return
      setLoadedOverviewAccountId(accountId)
      setOverviewFailure(webinarLoadFailure(cause))
    }
  }, [selectedAccountId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    listSnapshotRef.current = { items, total, loadedAccountId }
  }, [items, total, loadedAccountId])

  useEffect(() => {
    return scheduleWebinarSearch(query, (value) => { setPage(1); setDebouncedQuery(value) })
  }, [query])

  useEffect(() => {
    void refreshOverview()
  }, [refreshOverview])

  const refreshGrandTotal = useCallback(async () => {
    if (!selectedAccountId) {
      setGrandTotal(0)
      setGrandAccountId(null)
      return
    }
    const accountId = selectedAccountId
    try {
      const res = await webinarApi.list(accountId, { limit: 1 })
      if (!res.data || typeof res.data.total !== 'number') return
      setGrandTotal(res.data.total)
      setGrandAccountId(accountId)
    } catch {
      /* 欄の件数だけの補助取得。失敗時は前値を残す。 */
    }
  }, [selectedAccountId])

  useEffect(() => {
    void refreshGrandTotal()
  }, [refreshGrandTotal])

  const refreshFolders = useCallback(async () => {
    const generation = ++folderRequestGeneration.current
    setFolders([])
    setFoldersReady(false)
    if (!selectedAccountId) return
    try {
      const response = await webinarApi.folders(selectedAccountId)
      if (folderRequestGeneration.current === generation) {
        setFolders(response.success ? response.data : []); setFoldersReady(response.success && Array.isArray(response.data))
      }
    } catch {
      if (folderRequestGeneration.current === generation) setFolders([])
    }
  }, [selectedAccountId])

  useEffect(() => {
    setSelectedFolder('')
    void refreshFolders()
  }, [refreshFolders])

  const saveFolder = async (name: string) => {
    if (!selectedAccountId || !canEdit || folderBusy) return
    setFolderBusy(true)
    setFolderError('')
    try {
      if (editingFolder) {
        await webinarApi.updateFolder(selectedAccountId, editingFolder.id, { name })
      } else {
        await webinarApi.createFolder(selectedAccountId, { name })
      }
      setEditingFolder(null)
      setFolderDialogOpen(false)
      await refreshFolders()
      await refreshGrandTotal()
    } catch {
      setFolderError('フォルダを保存できませんでした。もう一度お試しください。')
    } finally {
      setFolderBusy(false)
    }
  }

  /*
   * B. フォルダの並べ替えは押した瞬間に画面を変え、裏で保存する。
   * 5秒は Toast の「元に戻す」で止められる（戻す口は同じ並べ替え）。
   */
  const moveFolder = (index: number, direction: -1 | 1) => {
    if (!selectedAccountId || !canEdit || folderBusy) return
    const otherIndex = index + direction
    const current = folders[index]
    const other = folders[otherIndex]
    if (!current || !other) return
    const before = folders
    const swapped = [...folders]
    swapped[index] = other
    swapped[otherIndex] = current
    setFolders(swapped)
    setFolderError('')
    runUndoable({
      message: `フォルダ「${current.name}」の並び順を変えました`,
      commit: async () => {
        const results = await Promise.all([
          webinarApi.updateFolder(selectedAccountId, current.id, { displayOrder: other.displayOrder }),
          webinarApi.updateFolder(selectedAccountId, other.id, { displayOrder: current.displayOrder }),
        ])
        if (results.some((result) => !result.success)) return { success: false }
      },
      undo: () => setFolders(before),
      onCommitted: () => {
        void refreshFolders()
        void refreshGrandTotal()
      },
      failureMessage: '並び順を保存できませんでした。もう一度お試しください。',
    })
  }

  const removeFolder = async () => {
    if (!selectedAccountId || !canEdit || !deletingFolder || folderBusy) return
    setFolderBusy(true)
    setFolderError('')
    try {
      await webinarApi.deleteFolder(selectedAccountId, deletingFolder.id)
      if (selectedFolder === deletingFolder.id) setSelectedFolder('')
      setDeletingFolder(null)
      await Promise.all([refresh(), refreshFolders(), refreshGrandTotal()])
    } catch {
      setFolderError('フォルダを削除できませんでした。もう一度お試しください。')
    } finally {
      setFolderBusy(false)
    }
  }

  const hasListData = !accountLoading && !loading && loadFailure === null && Boolean(selectedAccountId)
  const visibleTotal = loadedAccountId === selectedAccountId ? total : 0

  useEffect(() => {
    setPage(1)
  }, [selectedFolder, savedFilter, sortKey, pageSize, selectedAccountId])

  const pageCount = Math.max(1, Math.ceil(visibleTotal / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visible = visibleItems
  const panelGrand = grandAccountId === selectedAccountId ? grandTotal : null
  const unfiledCount = panelGrand === null || !foldersReady ? null : Math.max(0, panelGrand - folders.reduce((sum, folder) => sum + folder.count, 0))

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const openArchive = useCallback((target: WebinarListItem) => {
    setArchiveError('')
    setArchiveTarget(target)
  }, [])

  const archiveSelected = async () => {
    if (!archiveTarget || archiving) return
    setArchiving(true)
    setArchiveError('')
    try {
      await webinarApi.archive(archiveTarget.id)
      setArchiveTarget(null)
      await Promise.all([refresh(), refreshOverview(), refreshGrandTotal()])
    } catch (error) {
      setArchiveError(error instanceof ApiError && error.status === 409
        ? '公開中のウェビナーは、先に公開を停止してください。'
        : 'アーカイブできませんでした。状態を読み直して、もう一度お試しください。')
    } finally {
      setArchiving(false)
    }
  }

  const clearFilters = () => {
    setQuery('')
    setDebouncedQuery('')
    setSelectedFolder('')
    setSavedFilter('')
    setPage(1)
  }

  const folderRows = [
    { id: '', label: 'すべて', count: panelGrand },
    ...folders.map((folder, index) => ({
      id: folder.id,
      label: folder.name,
      count: folder.count,
      color: folder.color,
      onEdit: canEdit ? () => { setFolderError(''); setEditingFolder(folder) } : undefined,
      onMoveUp: canEdit && index > 0 ? () => void moveFolder(index, -1) : undefined,
      onMoveDown: canEdit && index < folders.length - 1 ? () => void moveFolder(index, 1) : undefined,
      onDelete: canEdit ? () => { setFolderError(''); setDeletingFolder(folder) } : undefined,
      deleteNote: '削除しても、中のウェビナーは未分類に残ります。',
    })),
    { id: UNFILED, label: '未分類', count: unfiledCount },
  ]

  const [csvBusy, setCsvBusy] = useState(false)
  const [csvError, setCsvError] = useState('')
  const csvLock = useRef(false)
  const csvScope = `${selectedAccountId}:${debouncedQuery}:${selectedFolder}:${savedFilter}:${sortKey}`
  const currentCsvScope = useRef(csvScope)
  currentCsvScope.current = csvScope
  useEffect(() => { setCsvError('') }, [csvScope])
  const exportCsv = async () => {
    if (!selectedAccountId || csvLock.current) return
    csvLock.current = true; setCsvBusy(true); setCsvError('')
    try {
      const csv = await webinarListCsv({ accountId: selectedAccountId, params: { q: debouncedQuery.trim() || undefined, folder: selectedFolder || undefined, status: savedFilter || undefined, sort: sortKey }, list: webinarApi.list, isCurrent: () => currentCsvScope.current === csvScope })
      if (csv === null) return
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = 'webinars.csv'; link.click(); URL.revokeObjectURL(url)
    } catch { if (currentCsvScope.current === csvScope) setCsvError('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。') }
    finally { csvLock.current = false; setCsvBusy(false) }
  }
  const listBody = <WebinarListContent accountLoading={accountLoading} loading={loading} selectedAccountId={selectedAccountId} accountsCount={accounts.length} loadFailure={loadFailure} visibleItems={visible} panelGrand={panelGrand} refreshing={refreshing} onRetry={() => void refresh()} onArchive={openArchive} canEdit={canEdit} readonlyReason={readonlyReason} onClearFilters={clearFilters} />

  return (
    <div className={styles.board} data-design-node="UyUMw">
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>ウェビナー</h1>
          <p className={styles.headDescription}>録画やライブのセミナーをLINEで案内し、申込から視聴・相談までをつなげます。</p>
        </div>
        <Button onClick={() => void exportCsv()} disabled={!hasListData || query !== debouncedQuery || csvBusy} busy={csvBusy} busyLabel="書き出しています…">CSVで書き出す</Button>
      </div>

      {csvError ? <Notice tone="info">{csvError}</Notice> : null}
      {overviewFailure && !loadFailure ? <Notice tone="info" action={overviewFailure.retryable ? <Button onClick={() => void refreshOverview()}>集計を読み直す</Button> : undefined}>集計を表示できませんでした。</Notice> : null}
      <section className={styles.kpiBand} aria-label="ウェビナーの数の帯">
        {webinarKpiCells(visibleOverview).map((cell) => (
          <div className={styles.kpiCell} key={cell.key}>
            <div className={styles.kpiHead}>
              <span className={styles.kpiIcon} aria-hidden="true">{cell.icon}</span>
              <span className={styles.kpiLabel}>{cell.label}</span><HelpTip label={`${cell.label}の説明`}>{cell.key === 'webinars' ? '登録済みの件数です。' : cell.key === 'registrations' ? '全期間の申込人数です。同じ人の複数予約は1人に数えます。' : cell.key === 'viewers' ? '視聴開始の人数です。視聴完了は一覧の集計では未取得です。' : '全期間にCTAがクリックされた延べ回数です。'}</HelpTip>
            </div>
            <p className={styles.kpiValue}>{cell.value}<span className={styles.kpiUnit}>{cell.unit}</span></p>

          </div>
        ))}
      </section>

      <Notice tone="info">
        {role === 'staff' ? '閲覧のみで見ています。変える操作は管理者に頼んでください。' : '公開すると、申込ページとLINEの案内が使えるようになります。申込から相談までの流れは、各ウェビナーの「分析」で見られます。'}
      </Notice>

      <div className={styles.body}>
        <div className={styles.folderCol}>
          {canEdit
            ? <Button variant="primary" href="/webinars/new">＋ ウェビナーを作る</Button>
            : <Button variant="primary" disabled title={readonlyReason}>＋ ウェビナーを作る</Button>}
          <div style={FOLDER_RAIL_STYLE}>
            <FolderPanel
              activeId={selectedFolder}
              onSelect={setSelectedFolder}
              onAddFolder={() => { if (!canEdit) return; setFolderError(''); setFolderDialogOpen(true) }}
              addFolderDisabled={!selectedAccountId || !canEdit}
              addFolderTitle={canEdit ? undefined : readonlyReason}
              rows={folderRows}
            />
          </div>
          <p className={styles.folderNote}>フォルダを消しても、中のウェビナーは未分類に残ります。</p>
        </div>

        <section className={styles.main}>
          <div className={styles.folderSelect}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: '1 1 auto' }}>
                {canEdit
                  ? <Button variant="primary" href="/webinars/new">＋ ウェビナーを作る</Button>
                  : <Button variant="primary" disabled title={readonlyReason}>＋ ウェビナーを作る</Button>}
              </div>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <Select
                  aria-label="フォルダ"
                  value={selectedFolder}
                  onChange={(value) => { setSelectedFolder(value); setPage(1) }}
                  options={[
                    { value: '', label: `フォルダ：すべて${panelGrand === null ? '' : `（${panelGrand}）`}` },
                    ...folders.map((folder) => ({ value: folder.id, label: `フォルダ：${folder.name}（${folder.count}）` })),
                    { value: UNFILED, label: `フォルダ：未分類${unfiledCount === null ? '' : `（${unfiledCount}）`}` },
                  ]}
                />
              </div>
            </div>
          </div>

          <div className={styles.toolbar}>
            <span className={styles.searchWrap}>
              <SearchField
                value={query}
                onChange={(value) => { setQuery(value) }}
                onClear={() => { setQuery('') }}
                placeholder="ウェビナー名で探す"
                aria-label="ウェビナー名で探す"
              />
            </span>
            <FilterChip selected={savedFilter === 'active'} onChange={(next) => setSavedFilter(next ? 'active' : '')}>公開中</FilterChip>
            <FilterChip selected={savedFilter === 'draft'} onChange={(next) => setSavedFilter(next ? 'draft' : '')}>下書き</FilterChip>
            <span className={styles.toolbarRight}>
              <Select
                aria-label="よく使う絞り込み"
                value={savedFilter}
                onChange={(value) => { setSavedFilter(value as SavedFilter); setPage(1) }}
                options={[
                  { value: '', label: 'よく使う絞り込み' },
                  { value: 'active', label: '公開中のみ' },
                  { value: 'draft', label: '下書きのみ' },
                ]}
              />
              <SortSelect
                value={sortKey}
                onChange={(value) => setSortKey(value as SortKey)}
                options={[{ value: 'updated', label: '更新が新しい順' }, { value: 'created', label: '作成が新しい順' }, { value: 'name', label: '名前順' }]}
              />
              <PageSizeSelect value={pageSize} onChange={setPageSize} />
            </span>
          </div>

          {listBody}

          {hasListData && visibleTotal > 0 ? (
            <div className={styles.pagerRow}>
              <span className={styles.rangeText}>
                <ListRange total={visibleTotal} first={(currentPage - 1) * pageSize + 1} last={(currentPage - 1) * pageSize + visible.length} />
              </span>
              <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} ariaLabel="ウェビナー一覧のページ送り" />
            </div>
          ) : null}

        </section>
      </div>

      {archiveTarget ? (
        <WebinarArchiveConfirmV8
          target={archiveTarget}
          busy={archiving}
          error={archiveError || undefined}
          onCancel={() => { if (!archiving) setArchiveTarget(null) }}
          onConfirm={() => void archiveSelected()}
        />
      ) : null}
      {(folderDialogOpen || editingFolder) ? (
        <WebinarFolderDialog
          folder={editingFolder}
          busy={folderBusy}
          error={folderError}
          onCancel={() => {
            if (folderBusy) return
            setFolderDialogOpen(false)
            setEditingFolder(null)
            setFolderError('')
          }}
          onSave={(name) => void saveFolder(name)}
        />
      ) : null}
      <ConfirmDialog
        open={deletingFolder !== null}
        title={`フォルダ「${deletingFolder?.name ?? ''}」を削除しますか？`}
        description={`削除しても、中のウェビナーは未分類に残ります。いまこのフォルダに入っているのは${deletingFolder?.count ?? 0}件です。`}
        confirmLabel="削除する"
        destructive
        busy={folderBusy}
        error={folderError || undefined}
        onCancel={() => {
          if (folderBusy) return
          setDeletingFolder(null)
          setFolderError('')
        }}
        onConfirm={() => void removeFolder()}
      />
    </div>
  )
}
