'use client'

/*
 * ★V8 イベント予約の一覧（Pencil `e2ekFu`）。
 *
 * 型（ListPage）に、数の帯（これからの回・申込・あと少しで満席・申し込みが少ない）、
 * 左のフォルダの列（上に「イベントを作る」）、案内の帯と道具の段、表、ページ送りをはめる。
 * データの口（取得・絞り込み・並び・ページ送り・名前の変更・削除・フォルダ）は今の V8
 * （src/app/events/events-list-v8.tsx）と同じ。行の名前の前にフォルダの色の丸（2026-10-07 オーナー）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bookmark, CalendarClock, CalendarX, Eye, Hourglass, MoreHorizontal, Plus, TrendingDown, TriangleAlert, Users } from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { api, ApiError, eventsApi, fetchApi, type EventListItem, type EventListSummary } from '@/lib/api'
import { clampSearchQuery, SEARCH_QUERY_MAX_LENGTH } from '@/lib/search-query'
import { withRequestTimeout } from '@/lib/request-timeout'
import { useAccount } from '@/contexts/account-context'
import { useStaffRole } from '@/lib/staff-role'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import IconButton from '@/components/shared/icon-button'
import Select from '@/components/shared/select'
import ListToolbar from '@/components/shared/list-toolbar'
import FilterChip from '@/components/shared/filter-chip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Notice from '@/components/shared/notice'
import HelpTip from '@/components/shared/help-tip'
import { DataTable, TableHeadRow, Th, Tr, Td, NameCell } from '@/components/shared/table'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import { FolderDotName } from '@/components/shared/folder-dot'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import DetailPanel from '@/components/shared/detail-panel'
import InlineEdit from '@/components/shared/inline-edit'
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { withViewTransition } from '@/components/shared/view-transition'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { daysUntilIso, eventRowState, isLowApplication, summarizeEventAttention, type EventRowState } from './attention'
import { jstDay, jstTime } from './shared'
import styles from './list.module.css'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/** 未分類を表す印。裏側（events.ts）が `__ungrouped__` で受ける。 */
const UNFILED = '__ungrouped__'
const PAGE_SIZES = [10, 20, 50]
const VIEWER_NOTE = '閲覧のみで見ています。イベントを作る・直す・消す操作は管理者に頼んでください。'

/*
 * よく使う絞り込み（絵の選ぶ欄）。並びと「満席の回がある」をここから選ぶ。
 * 札（公開中のみ・承認待ちあり）と同じ口の filter・sort を使う。
 */
const SAVED_OPTIONS = [
  { value: '', label: 'よく使う絞り込み' },
  { value: 'full', label: '満席のイベントだけ' },
  { value: 'sort-name', label: 'イベント名の順に並べる' },
]

const STATE_LABEL: Record<EventRowState, string> = {
  draft: '下書き',
  paused: '一時停止',
  cancelled: '中止',
  ended: '終了',
  full: '満席',
  open: '公開中',
}

function whenText(iso: string | null): string {
  return iso ? `${jstDay(iso)}${jstTime(iso)}` : '日時未設定'
}

function toContextMenuItems(menuItems: ActionMenuItem[]): ContextMenuItem[] {
  return menuItems.map((item) => ({
    id: item.id,
    label: item.label,
    danger: item.tone === 'danger',
    disabled: item.disabled,
    onSelect: () => item.onSelect(),
  }))
}

export default function EventsListV8() {
  usePageTitle('イベント予約')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  /* 作る・名前の変更・削除・フォルダの追加は統括と管理者だけ（Worker も同じ権限）。 */
  const canEdit = role === null || role === 'owner' || role === 'admin'
  const [items, setItems] = useState<EventListItem[]>([])
  const [listTotal, setListTotal] = useState(0)
  const [summary, setSummary] = useState<EventListSummary | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'open' | 'pending' | 'full'>('all')
  const [sort, setSort] = useState<'soon' | 'name'>('soon')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [folderFilter, setFolderFilter] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [foldersError, setFoldersError] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [pendingTotal, setPendingTotal] = useState<number | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EventListItem | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const loadRequestRef = useRef(0)

  const loadFolders = useCallback(async () => {
    if (!selectedAccountId) {
      setFolders([])
      setUnfiledCount(null)
      return
    }
    setFoldersError(false)
    try {
      const res = await api.folders.list('event', selectedAccountId)
      if (res.success) {
        setFolders(res.data)
        setUnfiledCount(res.unfiledCount ?? null)
      } else {
        setFoldersError(true)
      }
    } catch {
      setFoldersError(true)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  const refresh = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    if (!selectedAccountId) {
      setItems([])
      setListTotal(0)
      setSummary(null)
      setLoadStatus('ready')
      return
    }
    setLoadStatus('loading')
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(perPage) })
      const trimmed = clampSearchQuery(query.trim())
      if (trimmed) params.set('q', trimmed)
      params.set('filter', filter)
      params.set('sort', sort)
      if (folderFilter) params.set('folderId', folderFilter)
      params.set('account_id', selectedAccountId)
      const res = await withRequestTimeout(
        fetchApi<{ items: EventListItem[]; total?: number; summary?: EventListSummary | null }>(`/api/events/admin/events?${params}`),
      )
      if (requestId !== loadRequestRef.current) return
      setItems(res.items)
      setListTotal(res.total ?? res.items.length)
      setSummary(res.summary ?? null)
      setLoadStatus('ready')
    } catch (cause) {
      if (requestId !== loadRequestRef.current) return
      setItems([])
      setListTotal(0)
      setSummary(null)
      // 403 は権限不足（管理者への依頼）、それ以外は通信失敗（もう一度）。
      setLoadStatus(cause instanceof ApiError && cause.status === 403 ? 'forbidden' : 'error')
    }
  }, [selectedAccountId, page, perPage, query, filter, sort, folderFilter])

  useEffect(() => {
    void refresh()
    return () => {
      loadRequestRef.current += 1
    }
  }, [refresh])

  useEffect(() => {
    setPage(1)
  }, [query, filter, sort, folderFilter, perPage])

  /* 「承認待ちあり」の札の件数。行とは別に軽く数えるだけ。 */
  useEffect(() => {
    if (!selectedAccountId) {
      setPendingTotal(null)
      return
    }
    let alive = true
    const params = new URLSearchParams({ page: '1', limit: '1', filter: 'pending', account_id: selectedAccountId })
    void fetchApi<{ items: EventListItem[]; total?: number }>(`/api/events/admin/events?${params}`)
      .then((res) => { if (alive) setPendingTotal(res.total ?? res.items.length) })
      .catch(() => { if (alive) setPendingTotal(null) })
    return () => { alive = false }
  }, [selectedAccountId])

  const attention = useMemo(() => summarizeEventAttention(items), [items])
  /* 数の帯は応答の全体集計を使う（ページ内の行だけで数えると、21件目以降があるとき小さく見える）。 */
  const kpi: EventListSummary = summary ?? {
    upcoming_slots: attention.upcoming.length,
    upcoming_active: attention.applied,
    upcoming_capacity: attention.capacity,
    fill_rate: attention.fillRate,
    nearly_full: attention.nearlyFull.length,
    low_applications: attention.lowApplications.length,
    nearest_upcoming_starts_at: attention.upcoming[0]?.next_slot_starts_at ?? null,
    nearest_low_starts_at: attention.lowApplications[0]?.next_slot_starts_at ?? null,
  }

  async function confirmDeleteEvent() {
    if (!deleteTarget || deleteBusy || !selectedAccountId) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await eventsApi.deleteEvent(selectedAccountId, deleteTarget.id)
      setDeleteTarget(null)
      await refresh()
      void loadFolders()
    } catch (cause) {
      setDeleteError(
        cause instanceof ApiError && (cause.code === 'event_has_active_bookings' || cause.status === 409)
          ? '申込中・確定済みの予約、またはキャンセル待ちの人がいるため削除できません。先に申込者への対応を終えてください。'
          : '削除できませんでした。時間をおいて、もう一度お試しください。',
      )
    } finally {
      setDeleteBusy(false)
    }
  }

  const renameEvent = async (target: EventListItem, next: string) => {
    if (!selectedAccountId) throw new Error('no_account')
    const trimmed = next.trim()
    if (!trimmed) throw new Error('empty_name')
    if (trimmed === target.name) return
    const updated = await eventsApi.updateEvent(selectedAccountId, target.id, { name: trimmed }, target.version)
    setItems((current) => current.map((e) => (
      e.id === target.id ? { ...e, name: trimmed, version: typeof updated?.version === 'number' ? updated.version : e.version } : e
    )))
  }

  const requestDelete = useCallback((target: EventListItem) => {
    setDeleteError('')
    setDeleteTarget(target)
  }, [])

  const rowMenuItems = (e: EventListItem): ActionMenuItem[] => [
    { id: 'detail', label: '中身を見る', onSelect: () => router.push(`/events/edit?id=${e.id}`) },
    { id: 'applicants', label: '申込者を見る', onSelect: () => router.push(`/events/bookings?id=${e.id}`) },
    { id: 'change', label: '日時・定員を変える', onSelect: () => router.push(`/events/change-review?id=${e.id}`) },
    { id: 'preview', label: 'プレビュー', onSelect: () => router.push(`/events/preview?id=${e.id}`) },
    ...(canEdit ? [{ id: 'delete-event', label: '削除する', tone: 'danger' as const, dividerBefore: true, onSelect: () => requestDelete(e) }] : []),
  ]

  const folderDotOf = (folderId: string | null | undefined) => {
    const folder = folderId ? folders.find((f) => f.id === folderId) : undefined
    return folder ? { name: folder.name, color: folder.color } : null
  }

  const activeIndex = items.findIndex((e) => e.id === activeId)
  const active = activeIndex >= 0 ? items[activeIndex] : null
  const openDetail = (id: string) => withViewTransition(() => setActiveId(id))
  const closeDetail = () => withViewTransition(() => setActiveId(null))
  const goDetail = (direction: -1 | 1) => {
    const next = items[activeIndex + direction]
    if (next) withViewTransition(() => setActiveId(next.id))
  }

  const dataReady = Boolean(selectedAccountId) && loadStatus === 'ready'
  const filterActive = Boolean(query.trim() || filter !== 'all' || folderFilter)
  const pageCount = Math.max(1, Math.ceil(listTotal / perPage))
  const current = Math.min(page, pageCount)
  const kpiDetail = (ready: string) => (!selectedAccountId ? 'アカウントを選択' : loadStatus === 'loading' ? '—' : loadStatus === 'ready' ? ready : '読み込めませんでした')

  const kpis = [
    {
      key: 'upcoming', title: 'これからの回', icon: CalendarClock, value: dataReady ? kpi.upcoming_slots : null, unit: '回',
      detail: kpiDetail(kpi.nearest_upcoming_starts_at ? `いちばん近いのは ${jstDay(kpi.nearest_upcoming_starts_at)}` : '予定されている回はありません'),
    },
    {
      key: 'active', title: '申込', icon: Users, value: dataReady ? kpi.upcoming_active : null, unit: '人',
      detail: kpiDetail(kpi.fill_rate === null ? '今後の回への申込' : `定員 ${kpi.upcoming_capacity ?? '—'} 人に対して ${kpi.fill_rate}%`),
    },
    {
      key: 'nearly-full', title: 'あと少しで満席', icon: Hourglass, value: dataReady ? kpi.nearly_full : null, unit: '回',
      detail: kpiDetail(kpi.nearly_full > 0 ? '残り 1〜3 席' : '該当する回はありません'),
    },
    {
      key: 'low', title: '申し込みが少ない', icon: TrendingDown, value: dataReady ? kpi.low_applications : null, unit: '回',
      detail: kpiDetail(kpi.nearest_low_starts_at
        ? `${jstDay(kpi.nearest_low_starts_at)}の回。あと ${daysUntilIso(kpi.nearest_low_starts_at) ?? '—'} 日`
        : '声をかけると埋まります'),
    },
  ]

  /* 作るボタン。見るだけの人には置かず、場所だけ空ける（2026-10-06 オーナー決定）。 */
  const createButton = canEdit ? (
    <Button variant="primary" href="/events/new" className="v8-folder-create w-full">
      <Plus size={15} aria-hidden="true" />イベントを作る
    </Button>
  ) : <span className={styles.createSpace} aria-hidden="true" />

  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: loadStatus === 'ready' && !folderFilter ? listTotal : null },
    ...folders.map((folder) => ({ id: folder.id, label: folder.name, count: folder.itemCount ?? null, color: folder.color })),
    { id: UNFILED, label: '未分類', count: unfiledCount },
  ]

  const folderPanel = (
    <FolderPanel
      activeId={folderFilter}
      onSelect={setFolderFilter}
      onAddFolder={canEdit ? () => { closeDetail(); setFolderDialogOpen(true) } : undefined}
      addFolderLabel="フォルダを追加"
      rows={folderRows}
    >
      <p className={styles.folderNote}>フォルダを消しても、中のイベントは未分類に残ります。</p>
      {foldersError ? (
        <p role="alert" className={styles.folderNote}>
          フォルダを読み込めませんでした。
          <button type="button" onClick={() => void loadFolders()} className={styles.textButton}>もう一度</button>
        </p>
      ) : null}
    </FolderPanel>
  )

  const savedValue = filter === 'full' ? 'full' : sort === 'name' ? 'sort-name' : ''
  const toolbar = (
    <>
      <div className={styles.noticeRow}>
        <Notice tone="info">定員に達すると、お客さまの画面では自動で「満席」になります。キャンセルが出たら、キャンセル待ちの人に自動で順番が回ります。</Notice>
      </div>
      <ListToolbar
        search={{
          placeholder: 'イベント名で探す',
          label: 'イベント名で探す',
          width: 258,
          value: query,
          onChange: (value) => setQuery(clampSearchQuery(value)),
          maxLength: SEARCH_QUERY_MAX_LENGTH,
        }}
        filters={(
          <div role="group" aria-label="状態で絞り込む" className={styles.chipGroup}>
            <FilterChip selected={filter === 'open'} onChange={(selected) => setFilter(selected ? 'open' : 'all')}>公開中のみ</FilterChip>
            <FilterChip selected={filter === 'pending'} onChange={(selected) => setFilter(selected ? 'pending' : 'all')}>
              {`承認待ちあり${pendingTotal !== null && pendingTotal > 0 ? ` ${pendingTotal}` : ''}`}
            </FilterChip>
          </div>
        )}
        trailing={(
          <>
            <div className={styles.savedBox}>
              <Bookmark size={14} aria-hidden="true" className={styles.savedIcon} />
              <Select
                aria-label="よく使う絞り込み"
                value={savedValue}
                options={SAVED_OPTIONS}
                onChange={(value) => {
                  if (value === 'full') {
                    setFilter('full')
                  } else if (value === 'sort-name') {
                    setSort('name')
                    if (filter === 'full') setFilter('all')
                  } else {
                    setSort('soon')
                    if (filter === 'full') setFilter('all')
                  }
                }}
              />
            </div>
            <div className={styles.perPageBox}>
              <Select
                aria-label="表示件数"
                size="page-size"
                value={String(perPage)}
                options={PAGE_SIZES.map((size) => ({ value: String(size), label: `${size}件表示` }))}
                onChange={(value) => setPerPage(Number(value))}
              />
            </div>
          </>
        )}
      />
    </>
  )

  const tableHead = (
    <>
      <colgroup>
        <col />
        <col className={styles.colWhen} />
        <col className={styles.colSeats} />
        <col className={styles.colPending} />
        <col className={styles.colState} />
        <col className={styles.colMenu} />
      </colgroup>
      <thead>
        <TableHeadRow>
          <Th className={`${styles.headName} ${styles.firstCell}`}>イベント名（場所）</Th>
          <Th>開催日時</Th>
          <Th align="right">予約／定員</Th>
          <Th align="right">承認待ち</Th>
          <Th className={styles.stateCell}>
            <span className={styles.headWithTip}>
              状態
              <HelpTip label="状態の見方の説明">
                下書き・公開中・一時停止・終了・中止は保存した状態です。満席と申し込みが少ないは、その都度数えた目印で、状態ではありません。
              </HelpTip>
            </span>
          </Th>
          <Th aria-label="操作" />
        </TableHeadRow>
      </thead>
    </>
  )

  const stateCard = (icon: ReactNode, title: string, desc: string, action?: ReactNode, error = false) => (
    <div className={styles.stateCard}>
      <span className={styles.stateIcon} data-tone={error ? 'error' : undefined}>{icon}</span>
      <p className={styles.stateTitle}>{title}</p>
      <p className={styles.stateDesc}>{desc}</p>
      {action}
    </div>
  )

  let listBody: ReactNode
  if (!selectedAccountId) {
    listBody = stateCard(<CalendarX size={18} aria-hidden="true" />, 'LINE公式アカウントを選んでください', '上のアカウント切替から、イベントを受け付ける公式アカウントを選びます。')
  } else if (loadStatus === 'loading') {
    listBody = (
      <div className={styles.tableBox} aria-busy="true">
        <span className="sr-only">イベントの一覧を読み込んでいます</span>
        <DelayedSkeleton
          loading
          skeleton={(
            <DataTable>
              {tableHead}
              <tbody aria-hidden="true">
                {[0, 1, 2, 3].map((index) => (
                  <Tr key={index}>
                    <Td><Skeleton className={styles.skeletonName} /></Td>
                    <Td><Skeleton className={styles.skeletonShort} /></Td>
                    <Td><Skeleton className={styles.skeletonShort} /></Td>
                    <Td><Skeleton className={styles.skeletonShort} /></Td>
                    <Td><Skeleton className={styles.skeletonShort} /></Td>
                    <Td />
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        />
      </div>
    )
  } else if (loadStatus === 'forbidden') {
    listBody = stateCard(<TriangleAlert size={18} aria-hidden="true" />, 'イベントを見る権限がありません', '選んでいるアカウントでは見られません。管理者に権限を確かめてください。', undefined, true)
  } else if (loadStatus === 'error') {
    listBody = stateCard(
      <TriangleAlert size={18} aria-hidden="true" />,
      'イベントを読み込めませんでした',
      '登録したイベントは消えていません。もう一度読み込んでも直らない場合はエラー報告へ。',
      <Button onClick={() => void refresh()}>もう一度読み込む</Button>,
      true,
    )
  } else if (items.length === 0) {
    /* 修正案 D-2：空の一覧。 */
    listBody = (
      <EmptyList
        icon={<CalendarClock aria-hidden="true" />}
        title="まだイベントがありません"
        description="教室・体験会・相談会など、回ごとに定員のあるイベントの申込を受け付けます。"
        create={{ label: '最初のイベントを作る', href: '/events/new' }}
        canCreate={canEdit}
        filtered={filterActive}
        onClearFilters={() => { setQuery(''); setFilter('all'); setFolderFilter('') }}
      />
    )
  } else {
    listBody = (
      <div className={styles.tableBox}>
        <DataTable>
          {tableHead}
          <tbody>
            {items.map((e) => {
              const state = eventRowState(e)
              const menuItems = rowMenuItems(e)
              const low = state === 'open' && isLowApplication(e)
              const when = whenText(e.next_slot_starts_at)
              return (
                <Tr key={e.id} data-row-id={e.id}>
                  <NameCell
                    className={styles.firstCell}
                    name={(
                      <ContextMenu label={`「${e.name}」の操作`} items={toContextMenuItems(menuItems)}>
                        <FolderDotName folder={folderDotOf(e.folderId)}>
                          <button
                            type="button"
                            onClick={() => openDetail(e.id)}
                            title={`${e.name}の詳細を見る`}
                            aria-label={`「${e.name}」の詳細を見る`}
                            className={styles.nameButton}
                          >
                            {e.name}
                          </button>
                        </FolderDotName>
                      </ContextMenu>
                    )}
                    sub={<span className={styles.cellSub} title={e.venue_name ?? '場所は未設定'}>{e.venue_name ?? '場所は未設定'}</span>}
                  />
                  <Td>
                    <span className={styles.whenMain} title={when}>{when}</span>
                    <span className={styles.whenSub}>{e.next_slot_starts_at ? '次の回' : '—'}</span>
                  </Td>
                  <Td align="right" className={styles.num}>{`${e.total_active} / ${e.total_capacity ?? '—'}`}</Td>
                  <Td align="right" className={styles.num}>
                    {e.pending_count > 0 ? (
                      <Link href={`/events/bookings?id=${e.id}`} className={styles.pendingLink}>{e.pending_count}</Link>
                    ) : <span className={styles.faint}>—</span>}
                  </Td>
                  <Td className={styles.stateCell}>
                    <span className={styles.stateLine}>
                      {low ? <span className={`${styles.pill} ${styles.pillLow}`}>申し込みが少ない</span>
                        : state === 'open' && (e.total_capacity ?? 0) - e.total_active > 0 && (e.total_capacity ?? 0) - e.total_active <= 3
                          ? <span className={`${styles.pill} ${styles.pillWarn}`}>あと少しで満席</span>
                          : state === 'open' ? <span className={`${styles.pill} ${styles.pillOn}`}>公開中</span>
                            : state === 'full' ? <span className={`${styles.pill} ${styles.pillWarn}`}>満席</span>
                              : state === 'paused' ? <span className={`${styles.pill} ${styles.pillWarn}`}>一時停止</span>
                                : <span className={`${styles.pill} ${styles.pillOff}`}>{STATE_LABEL[state]}</span>}
                      {e.visible_tag_id ? (
                        <span className={styles.audience} title={e.visible_tag_name ?? '消えたタグ'}>{e.visible_tag_name ?? '消えたタグ'}</span>
                      ) : null}
                    </span>
                  </Td>
                  <Td className={styles.menuCell}>
                    <span className={styles.menuBox}>
                      <IconButton
                        aria-label={`${e.name}の操作`}
                        title={`${e.name}の操作`}
                        onClick={() => setOpenMenuId((now) => (now === e.id ? null : e.id))}
                      >
                        <MoreHorizontal />
                      </IconButton>
                      <ActionMenu open={openMenuId === e.id} ariaLabel={`${e.name}の操作`} onClose={() => setOpenMenuId(null)} items={menuItems} />
                    </span>
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </DataTable>
      </div>
    )
  }

  const pager = !dataReady || items.length === 0 ? null : (
    <div className={styles.pagerBlock}>
      <p className={styles.footNote}>行の「…」から 中身を見る・申込者を見る・日時と定員を変える・プレビュー・削除。申込中・キャンセル待ちがいるイベントは削除できません。</p>
      {pageCount > 1 ? (
        <Pagination
          page={current}
          pageCount={pageCount}
          onPageChange={setPage}
          ariaLabel="イベントのページ送り"
          summary={<ListRange bare className={styles.pagerCount} total={listTotal} first={(current - 1) * perPage + 1} last={Math.min(current * perPage, listTotal)} />}
        />
      ) : null}
    </div>
  )

  const overlays = (
    <>
      {folderDialogOpen && selectedAccountId ? (
        <FolderAddDialog
          kind="event"
          accountId={selectedAccountId}
          note="イベントを分けてしまう箱です。消しても、入っていたイベントは未分類として残ります。"
          placeholder="例：教室"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      ) : null}
      <DetailPanel
        open={active !== null}
        title={active?.name ?? ''}
        description={active ? `${whenText(active.next_slot_starts_at)}${active.venue_name ? `・${active.venue_name}` : ''}` : undefined}
        onClose={closeDetail}
        hasPrev={activeIndex > 0}
        hasNext={activeIndex >= 0 && activeIndex < items.length - 1}
        onPrev={activeIndex > 0 ? () => goDetail(-1) : undefined}
        onNext={activeIndex >= 0 && activeIndex < items.length - 1 ? () => goDetail(1) : undefined}
        footer={active ? (
          <div className={styles.panelActions}>
            <Button href={`/events/edit?id=${active.id}`}>中身を見る</Button>
            {canEdit ? <Button variant="danger" onClick={() => { closeDetail(); requestDelete(active) }}>削除する</Button> : null}
          </div>
        ) : undefined}
      >
        {active ? (
          <div className={styles.panelBody}>
            <p className={styles.panelLabel}>イベント名</p>
            {/* 閲覧のみ：鉛筆は置かず、名前だけを見せる（2026-10-06 オーナー決定）。 */}
            {canEdit
              ? <InlineEdit value={active.name} label="イベント名" onSave={(next) => renameEvent(active, next)} />
              : <p className={styles.panelText}>{active.name}</p>}
            <p className={styles.panelLabel}>状態</p>
            <p className={styles.panelText}>{STATE_LABEL[eventRowState(active)]}</p>
            <p className={styles.panelLabel}>予約・承認待ち</p>
            <p className={styles.panelText}>{`予約 ${active.total_active} / ${active.total_capacity ?? '—'}　承認待ち ${active.pending_count > 0 ? active.pending_count : '—'}`}</p>
            <div className={styles.panelActions}>
              <Button onClick={() => router.push(`/events/bookings?id=${active.id}`)}>申込者を見る</Button>
              <Button onClick={() => router.push(`/events/preview?id=${active.id}`)}>プレビュー</Button>
            </div>
            {!canEdit ? <p className={styles.folderNote}>名前の変更・削除には統括か管理者の権限が要ります。</p> : null}
          </div>
        ) : null}
      </DetailPanel>
      <ConfirmDialog
        open={deleteTarget !== null}
        destructive
        title={`「${deleteTarget?.name ?? ''}」を削除しますか？`}
        description="このイベントは一覧から外れ、公開中の予約URLは受け付けを止めます。いまある枠も使えなくなります。これまでの申込の記録は残ります。この操作は元に戻せません。"
        confirmLabel="削除する"
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDeleteEvent()}
        onCancel={() => {
          if (deleteBusy) return
          setDeleteError('')
          setDeleteTarget(null)
        }}
      />
    </>
  )

  return (
    <ListPage
      boardId="e2ekFu"
      headingSize="regular"
      title="イベント予約"
      description="教室・体験会・相談会など、回ごとに定員のあるイベントの申込を受けます。"
      tabs={!canEdit ? (
        <div className={styles.viewerBand} role="status">
          <Eye size={16} aria-hidden="true" />
          <span>{VIEWER_NOTE}</span>
        </div>
      ) : undefined}
      stats={(
        <KpiBand data-design="KPIs" className={styles.kpiStrip}>
          {kpis.map((item) => (
            <KpiCard
              key={item.key}
              presentation="band"
              title={item.title}
              icon={<item.icon size={13} aria-hidden="true" />}
              value={item.value}
              unit={item.value == null ? '' : item.unit}
              detail={item.detail}
            />
          ))}
        </KpiBand>
      )}
      folders={<>{createButton}{folderPanel}</>}
      folderNav={{ rows: folderRows, activeId: folderFilter, onSelect: setFolderFilter, createAction: canEdit ? createButton : undefined }}
      toolbar={toolbar}
      pagination={pager}
      overlays={overlays}
    >
      {listBody}
    </ListPage>
  )
}
