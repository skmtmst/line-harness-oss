'use client'

/*
 * ★V8 ウェビナーの一覧（Pencil：一覧 `UyUMw`・1152 `uBMuB`・閲覧のみ `jiNg0`・
 * アーカイブの確認 `VXZ6T`）。
 *
 * 型（ListPage）に、数の帯・左のフォルダの列（上に「ウェビナーを作る」）・
 * 案内の帯・道具の段・表（絵の列の並び）を渡す。行の右端は「編集」と「…」。
 * 「…」と右クリックは同じ操作（参加者・分析・コメント演出・アーカイブ）。
 * 行を押すと右に詳細が出る（↑↓で次の行へ・名前はその場で直せる）。
 *
 * データの口・保存の口・権限・失敗の扱いは app/webinars/list-v8.tsx と同じ
 * （BEHAVIOR.md）。違うのは見せ方だけ。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  Archive,
  Bookmark,
  CalendarClock,
  Download,
  Eye,
  FilePen,
  Inbox,
  MoreHorizontal,
  MousePointerClick,
  Plus,
  Radio,
  Users,
  Video,
} from 'lucide-react'
import { ListPage, ListPagePagination } from '@/components/templates'
import ListToolbar from '@/components/shared/list-toolbar'
import SearchField from '@/components/shared/search-field'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Notice from '@/components/shared/notice'
import FilterChip from '@/components/shared/filter-chip'
import Select from '@/components/shared/select'
import SortSelect from '@/components/ui/sort-select'
import PageSizeSelect from '@/components/ui/page-size-select'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import { FolderDotName, type FolderDotFolder } from '@/components/shared/folder-dot'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu'
import DetailPanel from '@/components/shared/detail-panel'
import InlineEdit from '@/components/shared/inline-edit'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { withViewTransition } from '@/components/shared/view-transition'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { publicationStateLabel } from '@/components/webinars/publication-label'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { runUndoable } from '@/lib/undoable'
import { formatDateTime, formatNumber } from '@/lib/format'
import {
  ApiError,
  webinarApi,
  type Webinar,
  type WebinarFolder,
  type WebinarListItem,
  type WebinarListParams,
  type WebinarOverview,
  type WebinarOverviewMetric,
} from '@/lib/api'
import {
  beforeStart,
  publicPath,
  showsCounts,
  statusLabel,
  statusTone,
  webinarListCsv,
  webinarLoadFailure,
  type WebinarLoadFailure,
} from './helpers'
import styles from './list.module.css'

type SortKey = 'updated' | 'created' | 'name'
type SavedFilter = '' | 'active' | 'draft' | 'archived'

const UNFILED = '__unfiled__'
const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'
/** 検索入力を口へ渡すまでの待ち時間。1文字ごとの取り直しを束ねる。 */
const SEARCH_DEBOUNCE_MS = 300

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

function periodSummary(webinar: WebinarListItem): string {
  return publicationStateLabel(webinar.publicationState, webinar.publicationStartsAt, webinar.publicationEndsAt)
    ?? scheduleSummary(webinar)
}

function peopleText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${formatNumber(value)}人` : '—'
}

function metricValue(metric: WebinarOverviewMetric | undefined): number | null {
  return metric && metric.state === 'available' && metric.value !== null ? metric.value : null
}

/*
 * 数の帯の4つ。口にある数だけ（無い数は「—」。0 にしない）。
 * 補足の行も口にある数だけで書く（先月比・フォーム送信は口に無い）。
 */
function kpiCells(overview: WebinarOverview | null) {
  const m = overview?.metrics
  const active = metricValue(m?.activeWebinars)
  const bookings = metricValue(m?.registrationBookings)
  const rate = metricValue(m?.viewRate)
  const people = metricValue(m?.ctaUniquePeople)
  return [
    {
      key: 'webinars', title: 'ウェビナー', icon: Video, value: metricValue(m?.webinars), unit: '件',
      detail: active === null ? '—' : `公開中 ${formatNumber(active)}件`, help: '登録済みの件数です。',
    },
    {
      key: 'registrations', title: '申込', icon: Users, value: metricValue(m?.registrations), unit: '人',
      detail: bookings === null ? '—' : `延べ予約 ${formatNumber(bookings)}件`, help: '全期間の申込人数です。同じ人の複数予約は1人に数えます。',
    },
    {
      key: 'viewers', title: '視聴', icon: CalendarClock, value: metricValue(m?.viewers), unit: '人',
      detail: rate === null ? '—' : `申込の ${Math.round(rate * 1000) / 10}%`, help: '視聴開始の人数です。視聴完了は一覧の集計では出していません。',
    },
    {
      key: 'cta', title: 'CTAクリック', icon: MousePointerClick, value: metricValue(m?.ctaTotalClicks), unit: '回',
      detail: people === null ? '—' : `押した人 ${formatNumber(people)}人`, help: '全期間にCTAが押された延べ回数です。',
    },
  ]
}

/** 行の「…」と右クリックの中身。2箇所で別々に書くとずれるので1つにする。 */
function rowMenuItems(
  w: WebinarListItem,
  canEdit: boolean,
  go: (href: string) => void,
  onArchive: (target: WebinarListItem) => void,
): ActionMenuItem[] {
  const id = encodeURIComponent(w.id)
  return [
    { id: 'participants', label: '参加者を見る', onSelect: () => go(`/webinars/edit?id=${id}&pane=participants`) },
    { id: 'analytics', label: '分析を見る', onSelect: () => go(`/webinars/edit?id=${id}&pane=analytics`) },
    { id: 'comments', label: 'コメント演出を開く', onSelect: () => go(`/webinars/edit?id=${id}&pane=comments`) },
    {
      id: 'archive',
      label: w.status === 'archived' ? '下書きに戻す' : 'アーカイブする',
      onSelect: () => onArchive(w),
      disabled: !canEdit,
      disabledReason: canEdit ? undefined : READONLY_REASON,
    },
  ]
}

function toContextItems(items: ActionMenuItem[]): ContextMenuItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    danger: item.tone === 'danger',
    disabled: item.disabled,
    onSelect: () => item.onSelect(),
  }))
}

function StatusPill({ webinar }: { webinar: WebinarListItem }) {
  return (
    <span className={styles.pill} data-tone={statusTone(webinar)}>
      <span className={styles.pillDot} aria-hidden="true" />
      {statusLabel(webinar)}
    </span>
  )
}

/*
 * アーカイブの確かめ（`VXZ6T`）。対象とアーカイブしたあとの3点を言う。
 * 公開中はこのままではアーカイブできない（先に公開を止める）。
 */
function ArchiveConfirm({
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
  const restoring = target.status === 'archived'
  return (
    <ConfirmDialog
      open
      designNode="VXZ6T"
      designWidth={500}
      designTop={380}
      title={restoring ? 'ウェビナーを下書きに戻しますか？' : 'ウェビナーをアーカイブしますか？'}
      description={restoring ? '通常の一覧に戻します。公開するまでは、新しい申込は受け付けません。' : 'アーカイブすると、一覧から外れて新しく使えなくなります。記録は残ります。'}
      confirmLabel={restoring ? '下書きに戻す' : 'アーカイブする'}
      titleIcon={false}
      confirmIcon={<Archive size={16} aria-hidden="true" />}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={blocked ? undefined : onConfirm}
    >
      {/* 絵 VXZ6T：対象は薄い灰の箱（小さい題＋太い名前）、そのあとに「アーカイブしたあと」の3点。消さずに残す操作なので主ボタンは緑。 */}
      <div className={styles.targetBox}>
        <p className={styles.targetLabel}>{restoring ? '下書きに戻す対象' : 'アーカイブする対象'}</p>
        <p className={styles.targetName}>{target.title}（{periodSummary(target)}）</p>
      </div>
      {restoring ? (
        <p className={styles.afterList}>参加者・視聴の記録・分析はそのまま残ります。</p>
      ) : (
        <>
          <p className={styles.afterTitle}>アーカイブしたあと</p>
          <ul className={styles.afterList}>
            <li>・参加者・視聴の記録・分析はそのまま見られます</li>
            <li>・公開ページは閉じ、新しい申し込みは受け付けません</li>
            <li>・絞り込みの「アーカイブ済み」から確認し、下書きに戻せます</li>
          </ul>
        </>
      )}
      {blocked ? (
        <Notice tone="warn">
          公開中のウェビナーは、このままではアーカイブできません。先に公開を停止してから、もう一度アーカイブしてください。
          <span className={styles.dialogAction}><Button href={`/webinars/edit?id=${target.id}`}>編集画面で公開を停止する</Button></span>
        </Notice>
      ) : null}
    </ConfirmDialog>
  )
}

/** フォルダの追加・名前の変更（右の詳細パネルの中身）。 */
function FolderForm({
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
  return (
    <div className={styles.folderForm}>
      <p className={styles.dialogValue}>ウェビナーを整理する名前を入力してください。</p>
      <label className={styles.dialogLabel} htmlFor="webinar-v8-folder-name">フォルダ名</label>
      <input
        id="webinar-v8-folder-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && name.trim() && !busy) onSave(name.trim())
        }}
        className={styles.folderInput}
        placeholder="例: 商品説明"
      />
      {error ? <p className={styles.errorText}>{error}</p> : null}
      <div className={styles.formActions}>
        <Button onClick={onCancel} disabled={busy}>キャンセル</Button>
        <Button variant="primary" onClick={() => onSave(name.trim())} disabled={!name.trim() || busy} busy={busy}>保存する</Button>
      </div>
    </div>
  )
}

/** 表の見出し。骨組みと本物で同じものを使う。 */
function TableHead() {
  return (
    <thead>
      <TableHeadRow className={styles.headRow} data-table-layout="columns">
        <Th className={styles.colName}>ウェビナー名</Th>
        <Th className={styles.colStatus}>状態</Th>
        <Th className={styles.colCount} align="right">申込</Th>
        <Th className={styles.colView} align="right">視聴</Th>
        <Th className={styles.colPeriod}>公開期間</Th>
        <Th className={styles.colOps}>操作</Th>
      </TableHeadRow>
    </thead>
  )
}

/**
 * 読み込み中の骨組み。本物と同じ見出し・行の高さで5行。
 * 0.3秒以内に来たら出さない（DelayedSkeleton）。
 */
function ListSkeleton() {
  return (
    <div className={styles.tableWrap} aria-busy="true">
      <span className="sr-only">ウェビナーの一覧を読み込んでいます</span>
      <DelayedSkeleton
        loading
        skeleton={
          <DataTable className={styles.table}>
            <TableHead />
            <tbody aria-hidden="true">
              {[0, 1, 2, 3, 4].map((index) => (
                <Tr key={index} className={styles.row} data-table-layout="columns">
                  <Td className={styles.colName}><Skeleton className={styles.skeletonName} /></Td>
                  <Td className={styles.colStatus}><Skeleton className={styles.skeletonPill} /></Td>
                  <Td className={styles.colCount}><Skeleton className={styles.skeletonNum} /></Td>
                  <Td className={styles.colView}><Skeleton className={styles.skeletonNum} /></Td>
                  <Td className={styles.colPeriod}><Skeleton className={styles.skeletonName} /></Td>
                  <Td className={styles.colOps}><Skeleton className={styles.skeletonPill} /></Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        }
      />
    </div>
  )
}

export default function WebinarListV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <WebinarList />
    </Suspense>
  )
}

interface ListSnapshot {
  items: WebinarListItem[]
  total: number
  loadedAccountId: string | null
}

function WebinarList() {
  usePageTitle('ウェビナー')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const narrow = useNarrowViewport()
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  // jiNg0「閲覧のみ」：押せない形にする（隠さない）。
  const role = useStaffRole()
  const canEdit = canManageRole(role)

  const requestGeneration = useRef(0)
  const overviewGeneration = useRef(0)
  const folderGeneration = useRef(0)
  const [items, setItems] = useState<WebinarListItem[]>([])
  const [total, setTotal] = useState(0)
  const [grandTotal, setGrandTotal] = useState(0)
  const [grandAccountId, setGrandAccountId] = useState<string | null>(null)
  const [chipCounts, setChipCounts] = useState<{ accountId: string; active: number; draft: number } | null>(null)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [overview, setOverview] = useState<WebinarOverview | null>(null)
  const [overviewAccountId, setOverviewAccountId] = useState<string | null>(null)
  const [overviewFailure, setOverviewFailure] = useState<WebinarLoadFailure | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [savedFilter, setSavedFilter] = useState<SavedFilter>('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadFailure, setLoadFailure] = useState<WebinarLoadFailure | null>(null)
  const snapshotRef = useRef<ListSnapshot>({ items: [], total: 0, loadedAccountId: null })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<WebinarListItem | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [foldersReady, setFoldersReady] = useState(false)
  const [folders, setFolders] = useState<WebinarFolder[]>([])
  const [selectedFolder, setSelectedFolder] = useState('')
  const [folderFormOpen, setFolderFormOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<WebinarFolder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<WebinarFolder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')

  const visibleItems = loadedAccountId === selectedAccountId ? items : []
  const visibleOverview = overviewAccountId === selectedAccountId ? overview : null

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
    const mode = snapshotRef.current.loadedAccountId === accountId ? 'background' : 'initial'
    if (mode === 'initial') {
      setLoading(true)
      setItems([])
      setLoadedAccountId(null)
    } else {
      setRefreshing(true)
    }
    setLoadFailure(null)
    try {
      const params: WebinarListParams = {
        page,
        limit: pageSize,
        q: debouncedQuery.trim() || undefined,
        folder: selectedFolder || undefined,
        status: savedFilter || undefined,
        sort: sortKey,
      }
      const res = await webinarApi.list(accountId, params)
      if (requestGeneration.current !== generation) return
      if (!res || !res.data || !Array.isArray(res.data.items) || typeof res.data.total !== 'number') {
        throw new ApiError(500, 'ウェビナーの一覧が読めない形で返りました')
      }
      setItems(res.data.items)
      setTotal(res.data.total)
      setLoadedAccountId(accountId)
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
    const generation = ++overviewGeneration.current
    setOverview(null)
    setOverviewFailure(null)
    setOverviewAccountId(null)
    if (!selectedAccountId) return
    const accountId = selectedAccountId
    try {
      const res = await webinarApi.overview(accountId)
      if (overviewGeneration.current !== generation) return
      setOverview(res.data)
      setOverviewAccountId(accountId)
    } catch (cause) {
      if (overviewGeneration.current !== generation) return
      setOverviewAccountId(accountId)
      setOverviewFailure(webinarLoadFailure(cause))
    }
  }, [selectedAccountId])

  const refreshGrandTotal = useCallback(async () => {
    if (!selectedAccountId) {
      setGrandTotal(0)
      setGrandAccountId(null)
      setChipCounts(null)
      return
    }
    const accountId = selectedAccountId
    try {
      const res = await webinarApi.list(accountId, { limit: 1 })
      if (!res.data || typeof res.data.total !== 'number') return
      setGrandTotal(res.data.total)
      setGrandAccountId(accountId)
    } catch {
      /* 欄の件数だけの補助取得。失敗時は前の値を残す。 */
    }
    /* 札の件数（絵 UyUMw「公開中 3」「下書き 1」）。札で絞ったときと同じ口・同じ条件で数える。取れなければ数を出さない。 */
    try {
      const [activeRes, draftRes] = await Promise.all([
        webinarApi.list(accountId, { limit: 1, status: 'active' }),
        webinarApi.list(accountId, { limit: 1, status: 'draft' }),
      ])
      const activeTotal = activeRes.data?.total
      const draftTotal = draftRes.data?.total
      setChipCounts(typeof activeTotal === 'number' && typeof draftTotal === 'number'
        ? { accountId, active: activeTotal, draft: draftTotal }
        : null)
    } catch {
      setChipCounts(null)
    }
  }, [selectedAccountId])

  const refreshFolders = useCallback(async () => {
    const generation = ++folderGeneration.current
    setFolders([])
    setFoldersReady(false)
    if (!selectedAccountId) return
    try {
      const response = await webinarApi.folders(selectedAccountId)
      if (folderGeneration.current !== generation) return
      setFolders(response.success ? response.data : [])
      setFoldersReady(response.success && Array.isArray(response.data))
    } catch {
      if (folderGeneration.current === generation) setFolders([])
    }
  }, [selectedAccountId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { snapshotRef.current = { items, total, loadedAccountId } }, [items, total, loadedAccountId])
  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setDebouncedQuery(query) }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => { void refreshOverview() }, [refreshOverview])
  useEffect(() => { void refreshGrandTotal() }, [refreshGrandTotal])
  useEffect(() => {
    setSelectedFolder('')
    void refreshFolders()
  }, [refreshFolders])
  useEffect(() => { setPage(1) }, [selectedFolder, savedFilter, sortKey, pageSize, selectedAccountId])

  const saveFolder = async (name: string) => {
    if (!selectedAccountId || !canEdit || folderBusy) return
    setFolderBusy(true)
    setFolderError('')
    try {
      if (editingFolder) await webinarApi.updateFolder(selectedAccountId, editingFolder.id, { name })
      else await webinarApi.createFolder(selectedAccountId, { name })
      setEditingFolder(null)
      setFolderFormOpen(false)
      await refreshFolders()
      await refreshGrandTotal()
    } catch {
      setFolderError('フォルダを保存できませんでした。もう一度お試しください。')
    } finally {
      setFolderBusy(false)
    }
  }

  /* フォルダの並べ替えは押した瞬間に画面を変え、裏で保存する（5秒は元に戻せる）。 */
  const moveFolder = (index: number, direction: -1 | 1) => {
    if (!selectedAccountId || !canEdit || folderBusy) return
    const current = folders[index]
    const other = folders[index + direction]
    if (!current || !other) return
    const before = folders
    const swapped = [...folders]
    swapped[index] = other
    swapped[index + direction] = current
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
  const pageCount = Math.max(1, Math.ceil(visibleTotal / pageSize))
  const currentPage = Math.min(page, pageCount)
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  /* 行 → 右の詳細パネル。開閉と↑↓の移動はつながる移り変わりで。 */
  const activeIndex = visibleItems.findIndex((w) => w.id === activeId)
  const active = activeIndex >= 0 ? visibleItems[activeIndex] : null
  const openDetail = useCallback((id: string) => { withViewTransition(() => setActiveId(id)) }, [])
  const closeDetail = useCallback(() => { withViewTransition(() => setActiveId(null)) }, [])
  const goDetail = (direction: -1 | 1) => {
    const next = visibleItems[activeIndex + direction]
    if (next) withViewTransition(() => setActiveId(next.id))
  }

  /* 名前のその場の書き換え。題だけ送る（ほかは触らない）。失敗は入力欄に理由を出す。 */
  const renameWebinar = async (target: WebinarListItem, next: string) => {
    const trimmed = next.trim()
    if (!trimmed) throw new Error('empty_name')
    if (trimmed === target.title) return
    await webinarApi.update(target.id, { title: trimmed })
    setItems((current) => current.map((w) => (w.id === target.id ? { ...w, title: trimmed } : w)))
  }

  const panelGrand = grandAccountId === selectedAccountId ? grandTotal : null
  const unfiledCount = panelGrand === null || !foldersReady
    ? null
    : Math.max(0, panelGrand - folders.reduce((sum, folder) => sum + folder.count, 0))

  const openArchive = useCallback((target: WebinarListItem) => {
    setArchiveError('')
    setArchiveTarget(target)
  }, [])

  const archiveSelected = async () => {
    if (!archiveTarget || archiving) return
    setArchiving(true)
    setArchiveError('')
    try {
      if (archiveTarget.status === 'archived') await webinarApi.update(archiveTarget.id, { status: 'draft' })
      else await webinarApi.archive(archiveTarget.id)
      setArchiveTarget(null)
      await Promise.all([refresh(), refreshOverview(), refreshGrandTotal()])
    } catch (error) {
      setArchiveError(error instanceof ApiError && error.status === 409
        ? '公開中のウェビナーは、先に公開を停止してください。'
        : archiveTarget.status === 'archived'
          ? '下書きに戻せませんでした。もう一度お試しください。'
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

  /* CSV は表示中の条件に合う全頁。条件が変わったら古い結果は捨てる。 */
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvError, setCsvError] = useState('')
  const csvLock = useRef(false)
  const csvScope = `${selectedAccountId}:${debouncedQuery}:${selectedFolder}:${savedFilter}:${sortKey}`
  const currentCsvScope = useRef(csvScope)
  currentCsvScope.current = csvScope
  useEffect(() => { setCsvError('') }, [csvScope])
  const exportCsv = async () => {
    if (!selectedAccountId || csvLock.current) return
    csvLock.current = true
    setCsvBusy(true)
    setCsvError('')
    try {
      const csv = await webinarListCsv({
        accountId: selectedAccountId,
        params: { q: debouncedQuery.trim() || undefined, folder: selectedFolder || undefined, status: savedFilter || undefined, sort: sortKey },
        list: webinarApi.list,
        isCurrent: () => currentCsvScope.current === csvScope,
      })
      if (csv === null) return
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'webinars.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      if (currentCsvScope.current === csvScope) setCsvError('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      csvLock.current = false
      setCsvBusy(false)
    }
  }

  const go = (href: string) => router.push(href)

  /* ===== フォルダ ===== */
  /* 行の名前の前の丸は、左のフォルダの列と同じフォルダ（同じ色）を引く。 */
  const folderDotOf = (w: WebinarListItem): FolderDotFolder | null => {
    if (!w.folderId) return null
    const folder = folders.find((f) => f.id === w.folderId)
    if (folder) return { name: folder.name, color: folder.color }
    return w.folderName ? { name: w.folderName } : null
  }
  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: panelGrand, icon: <Inbox size={15} aria-hidden="true" /> },
    /*
     * 絵（UyUMw）どおり「…」は選んだ行だけに出す。選んでいない行に操作を渡すと、
     * 共通のフォルダの列では「…」の箱が場所を取り、件数が左へずれる。
     * 名前の変更・並べ替え・削除は、フォルダを選ぶとその行の「…」から開ける。
     */
    ...folders.map((folder, index) => {
      const manageable = canEdit && selectedFolder === folder.id
      return {
        id: folder.id,
        label: folder.name,
        count: folder.count,
        color: folder.color,
        onEdit: manageable ? () => { setFolderError(''); closeDetail(); setEditingFolder(folder) } : undefined,
        onMoveUp: manageable && index > 0 ? () => moveFolder(index, -1) : undefined,
        onMoveDown: manageable && index < folders.length - 1 ? () => moveFolder(index, 1) : undefined,
        onDelete: manageable ? () => { setFolderError(''); setDeletingFolder(folder) } : undefined,
        deleteNote: '削除しても、中のウェビナーは未分類に残ります。',
      }
    }),
    { id: UNFILED, label: '未分類', count: unfiledCount },
  ]
  const folderSelect = (
    <Select
      aria-label="フォルダ"
      value={selectedFolder}
      onChange={(value) => { setSelectedFolder(value); setPage(1) }}
      options={[
        { value: '', label: 'フォルダ：すべて' },
        ...folders.map((folder) => ({ value: folder.id, label: `フォルダ：${folder.name}` })),
        { value: UNFILED, label: 'フォルダ：未分類' },
      ]}
    />
  )
  const createButton = canEdit
    ? <Button variant="primary" href="/webinars/new"><Plus size={15} aria-hidden="true" />ウェビナーを作る</Button>
    : <Button variant="primary" disabled title={READONLY_REASON}><Plus size={15} aria-hidden="true" />ウェビナーを作る</Button>

  /* ===== 道具の段 ===== */
  const shownChipCounts = chipCounts && chipCounts.accountId === selectedAccountId ? chipCounts : null
  const filterChips = (
    <div role="group" aria-label="状態で絞り込む">
      <FilterChip selected={savedFilter === 'active'} onChange={(next) => setSavedFilter(next ? 'active' : '')} icon={<Radio size={13} aria-hidden="true" />}>{shownChipCounts ? `公開中 ${formatNumber(shownChipCounts.active)}` : '公開中'}</FilterChip>
      <FilterChip selected={savedFilter === 'draft'} onChange={(next) => setSavedFilter(next ? 'draft' : '')} icon={<FilePen size={13} aria-hidden="true" />}>{shownChipCounts ? `下書き ${formatNumber(shownChipCounts.draft)}` : '下書き'}</FilterChip>
    </div>
  )
  const sortBox = (
    <div className={styles.sortBox}>
      <SortSelect
        value={sortKey}
        onChange={(value) => setSortKey(value as SortKey)}
        options={[{ value: 'updated', label: '更新順' }, { value: 'created', label: '作成順' }, { value: 'name', label: '名前順' }]}
        label="並び："
      />
    </div>
  )
  const savedBox = (
    <div className={styles.savedBox}>
      <Bookmark size={15} aria-hidden="true" className={styles.savedIcon} />
      <Select
        aria-label="よく使う絞り込み"
        value={savedFilter}
        onChange={(value) => { setSavedFilter(value as SavedFilter); setPage(1) }}
        options={[
          { value: '', label: 'よく使う絞り込み' },
          { value: 'active', label: '公開中のみ' },
          { value: 'draft', label: '下書きのみ' },
          { value: 'archived', label: 'アーカイブ済み' },
        ]}
      />
    </div>
  )
  const perPageBox = <PageSizeSelect value={pageSize} onChange={setPageSize} options={[10, 20, 50]} label={null} />
  const notice = (
    <div className={styles.noticeRow}>
      <Notice tone="info">公開すると、申込ページとLINEの案内が使えるようになります。申込から相談までの流れは、各ウェビナーの「分析」で見られます。</Notice>
    </div>
  )
  const searchBox = (
    <SearchField
      value={query}
      onChange={(value) => setQuery(value)}
      onClear={() => setQuery('')}
      placeholder="ウェビナー名で探す"
      aria-label="ウェビナー名で探す"
    />
  )
  /* 1152 の板（uBMuB）：案内の帯 → 1段目「作る・フォルダ・探す」→ 2段目「札 … 並び・よく使う絞り込み・件数」。 */
  const narrowToolbar = (
    <div className={styles.narrowTools}>
      {notice}
      <div className={styles.narrowRow}>
        {createButton}
        <div className={styles.narrowFolder}>{folderSelect}</div>
        <div className={styles.narrowSearch}>{searchBox}</div>
      </div>
      <div className={styles.narrowRow}>
        {filterChips}
        <span className={styles.spacer} aria-hidden="true" />
        {sortBox}
        {savedBox}
        {perPageBox}
      </div>
    </div>
  )
  const wideToolbar = (
    <>
      {notice}
      <ListToolbar
        search={{ placeholder: 'ウェビナー名で探す', label: 'ウェビナー名で探す', width: 240, value: query, onChange: setQuery }}
        filters={filterChips}
        trailing={<>{sortBox}{savedBox}{perPageBox}</>}
      />
    </>
  )

  /* ===== 表 ===== */
  let listBody: ReactNode
  if (accountLoading || loading) {
    listBody = <ListSkeleton />
  } else if (!selectedAccountId) {
    listBody = <ListState kind="empty" title={accounts.length > 0 ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'} />
  } else if (loadFailure && visibleItems.length === 0) {
    listBody = <ListState kind={loadFailure.kind} title={loadFailure.title} description={loadFailure.description} action={loadFailure.retryable ? <Button onClick={() => void refresh()}>もう一度読み込む</Button> : undefined} />
  } else if (visibleItems.length === 0) {
    listBody = panelGrand === 0
      ? <ListState kind="empty" title="まだ、ウェビナーはありません" description="録画やライブのセミナーを作ると、LINEで案内して申込を受けられます。" action={createButton} />
      : <ListState kind="empty" title="条件に合うウェビナーはありません" description="検索や絞り込みを外すと、すべて出ます。" action={<Button onClick={clearFilters}>条件を外す</Button>} />
  } else {
    listBody = (
      <>
        {loadFailure ? (
          <div role="alert" className={styles.errorBand}>
            <span>{loadFailure.title}</span>
            {loadFailure.retryable ? <Button onClick={() => void refresh()}>もう一度読み込む</Button> : null}
          </div>
        ) : null}
        {refreshing ? <p role="status" className="sr-only">検索中…</p> : null}
        <div className={styles.tableWrap}>
          <DataTable className={styles.table}>
            <TableHead />
            <tbody>
              {visibleItems.map((w) => {
                const menuItems = rowMenuItems(w, canEdit, go, openArchive)
                const counts = showsCounts(w)
                const period = periodSummary(w)
                const menuLabel = `ウェビナー「${w.title}」の操作`
                return (
                  <Tr
                    key={w.id}
                    interactive
                    className={styles.row}
                    data-table-layout="columns"
                    data-row-id={w.id}
                    onClick={() => openDetail(w.id)}
                  >
                    <Td className={styles.colName}>
                      <ContextMenu label={`「${w.title}」の操作`} items={toContextItems(menuItems)}>
                        <FolderDotName folder={folderDotOf(w)}>
                          <button
                            type="button"
                            className={styles.nameButton}
                            title={w.title}
                            aria-label={`「${w.title}」の詳細を見る`}
                            onClick={(event) => { event.stopPropagation(); openDetail(w.id) }}
                          >
                            {w.title}
                          </button>
                        </FolderDotName>
                      </ContextMenu>
                      <span className={styles.slug} title={publicPath(w)}>{publicPath(w)}</span>
                    </Td>
                    <Td className={styles.colStatus}><StatusPill webinar={w} /></Td>
                    <Td className={styles.colCount}>
                      <span className={styles.numMain}>{counts ? peopleText(w.registrationCount) : '—'}</span>
                    </Td>
                    <Td className={styles.colView}>
                      {beforeStart(w) ? (
                        <span className={styles.numMain}>開始前</span>
                      ) : counts ? (
                        <>
                          <span className={styles.numMain}>視聴完了 —</span>
                          <span className={styles.numSub}>{`視聴開始 ${peopleText(w.viewerCount)}`}</span>
                        </>
                      ) : (
                        <span className={styles.numMain} title="公開していないので視聴数はありません">—</span>
                      )}
                    </Td>
                    <Td className={styles.colPeriod}><span className={styles.period} title={period}>{period}</span></Td>
                    <Td className={styles.colOps} onClick={(event) => event.stopPropagation()}>
                      <div className={styles.opsBox}>
                        {canEdit
                          ? <Button href={`/webinars/edit?id=${w.id}`}>編集</Button>
                          : <Button disabled title={READONLY_REASON}>編集</Button>}
                        <IconButton
                          title={menuLabel}
                          aria-label={menuLabel}
                          aria-haspopup="menu"
                          aria-expanded={openMenuId === w.id}
                          onClick={() => setOpenMenuId((current) => (current === w.id ? null : w.id))}
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </IconButton>
                        <ActionMenu
                          open={openMenuId === w.id}
                          onClose={() => setOpenMenuId(null)}
                          ariaLabel={menuLabel}
                          note={canEdit ? undefined : READONLY_REASON}
                          items={menuItems.map((item) => ({ ...item, onSelect: () => { setOpenMenuId(null); item.onSelect() } }))}
                        />
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        </div>
        <p className={styles.footNote}>行の「…」から 参加者・分析・コメント演出・アーカイブ。行を押すと右に詳細が出ます（↑↓で次の行へ）。</p>
      </>
    )
  }

  const pager = hasListData && pageCount > 1 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>
        {(currentPage - 1) * pageSize + 1}〜{(currentPage - 1) * pageSize + visibleItems.length} / {formatNumber(visibleTotal)}件
      </span>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} ariaLabel="ウェビナー一覧のページ送り" />
    </ListPagePagination>
  ) : null

  const kpis = kpiCells(visibleOverview)

  return (
    <ListPage
      boardId="UyUMw"
      headingSize="regular"
      title="ウェビナー"
      description="録画やライブのセミナーをLINEで案内し、申込から視聴・相談までをつなげます。"
      actions={
        <Button
          onClick={() => void exportCsv()}
          disabled={!hasListData || query !== debouncedQuery || csvBusy}
          busy={csvBusy}
          busyLabel="書き出しています…"
        >
          <Download size={15} aria-hidden="true" />CSVで書き出す
        </Button>
      }
      stats={<>
        {/* 役割が取れるまで（null）は閲覧のみの帯を出さない。出してから消すと一覧が 64px 跳ねていた（動きの点検 8 番）。 */}
        {role !== null && !canEdit ? (
          <div className={styles.viewerBand} role="status">
            <Eye size={16} aria-hidden="true" />
            <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
          </div>
        ) : null}
        {csvError ? <div className={styles.statsNotice}><Notice tone="info">{csvError}</Notice></div> : null}
        {overviewFailure && !loadFailure ? (
          <div className={styles.statsNotice}>
            <Notice tone="info" action={overviewFailure.retryable ? <Button onClick={() => void refreshOverview()}>集計を読み直す</Button> : undefined}>集計を表示できませんでした。</Notice>
          </div>
        ) : null}
        <KpiBand>
          {kpis.map((kpi) => (
            <KpiCard
              key={kpi.key}
              presentation="band"
              title={kpi.title}
              icon={<kpi.icon size={13} aria-hidden="true" />}
              help={kpi.help}
              value={kpi.value}
              unit={kpi.value === null ? '' : kpi.unit}
              detail={kpi.detail}
            />
          ))}
        </KpiBand>
      </>}
      folders={<>
        {createButton}
        <FolderPanel
          activeId={selectedFolder}
          onSelect={(id) => { setSelectedFolder(id); setPage(1) }}
          onAddFolder={canEdit ? () => { setFolderError(''); closeDetail(); setFolderFormOpen(true) } : undefined}
          addFolderLabel="フォルダを追加"
          addFolderDisabled={!selectedAccountId || !canEdit}
          addFolderTitle={canEdit ? undefined : READONLY_REASON}
          rows={folderRows}
        >
          <p className={styles.folderNote}>フォルダを消しても、中のウェビナーは未分類に残ります</p>
        </FolderPanel>
      </>}
      collapsedFolders={narrow ? undefined : <>{createButton}{folderSelect}</>}
      toolbar={narrow ? narrowToolbar : wideToolbar}
      pagination={pager}
      overlays={<>
        {archiveTarget ? (
          <ArchiveConfirm
            target={archiveTarget}
            busy={archiving}
            error={archiveError || undefined}
            onCancel={() => { if (!archiving) setArchiveTarget(null) }}
            onConfirm={() => void archiveSelected()}
          />
        ) : null}
        {(folderFormOpen || editingFolder) ? (
          <DetailPanel
            open
            title={editingFolder ? 'フォルダ名を変更' : 'フォルダを追加'}
            description={editingFolder ? `「${editingFolder.name}」の名前を変えます。中のウェビナーはそのまま残ります。` : undefined}
            onClose={() => {
              if (folderBusy) return
              withViewTransition(() => {
                setFolderFormOpen(false)
                setEditingFolder(null)
                setFolderError('')
              })
            }}
          >
            <FolderForm
              key={editingFolder?.id ?? 'new'}
              folder={editingFolder}
              busy={folderBusy}
              error={folderError}
              onCancel={() => {
                if (folderBusy) return
                setFolderFormOpen(false)
                setEditingFolder(null)
                setFolderError('')
              }}
              onSave={(name) => void saveFolder(name)}
            />
          </DetailPanel>
        ) : null}
        <DetailPanel
          open={active !== null}
          title={active?.title ?? ''}
          description={active ? periodSummary(active) : undefined}
          onClose={closeDetail}
          hasPrev={activeIndex > 0}
          hasNext={activeIndex >= 0 && activeIndex < visibleItems.length - 1}
          onPrev={activeIndex > 0 ? () => goDetail(-1) : undefined}
          onNext={activeIndex >= 0 && activeIndex < visibleItems.length - 1 ? () => goDetail(1) : undefined}
          footer={active ? (
            <div className={styles.formActions}>
              {canEdit
                ? <Button href={`/webinars/edit?id=${active.id}`}>編集する</Button>
                : <Button disabled title={READONLY_REASON}>編集する</Button>}
              <Button
                variant="secondary"
                disabled={!canEdit}
                title={canEdit ? undefined : READONLY_REASON}
                onClick={() => { closeDetail(); openArchive(active) }}
              >
                {active.status === 'archived' ? '下書きに戻す' : 'アーカイブする'}
              </Button>
            </div>
          ) : undefined}
        >
          {active ? (
            <div className={styles.detail}>
              <p className={styles.dialogLabel}>ウェビナー名</p>
              <InlineEdit value={active.title} label="ウェビナー名" disabled={!canEdit} onSave={(next) => renameWebinar(active, next)} />
              <p className={styles.dialogLabel}>状態</p>
              <p className={styles.dialogValue}><StatusPill webinar={active} /></p>
              <p className={styles.dialogLabel}>申込・視聴</p>
              <p className={styles.dialogValue}>
                申込 {showsCounts(active) ? peopleText(active.registrationCount) : '—'}　視聴開始 {showsCounts(active) ? peopleText(active.viewerCount) : '—'}
              </p>
              <p className={styles.dialogLabel}>公開ページ</p>
              <p className={styles.dialogValue}>{publicPath(active)}</p>
              <div className={styles.detailActions}>
                <Button variant="secondary" onClick={() => go(`/webinars/edit?id=${encodeURIComponent(active.id)}&pane=participants`)}>参加者を見る</Button>
                <Button variant="secondary" onClick={() => go(`/webinars/edit?id=${encodeURIComponent(active.id)}&pane=analytics`)}>分析を見る</Button>
                <Button variant="secondary" onClick={() => go(`/webinars/edit?id=${encodeURIComponent(active.id)}&pane=comments`)}>コメント演出を開く</Button>
              </div>
              {!canEdit ? <p className={styles.dialogValue}>{READONLY_REASON}</p> : null}
            </div>
          ) : null}
        </DetailPanel>
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
      </>}
    >
      {listBody}
    </ListPage>
  )
}
