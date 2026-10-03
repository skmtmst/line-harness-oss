'use client'

/*
 * ★V8-B イベント予約の一覧（板 `e2ekFu`）。
 *
 * v7 の一覧（`page.tsx` 内の EventsListPageV7）とは別の部品として持つ。
 * データの口（取得・絞り込み・並び・ページ送り・削除）は同じ。
 * 違いは置き場と見せ方だけ——「イベントを作る」は左のフォルダの列の上、
 * 数の帯は白い板いっぱいの帯、行の右端は「…」1つ。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarClock, Hourglass, MoreHorizontal, TrendingDown, Users } from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { api, ApiError, eventsApi, fetchApi, type EventListItem, type EventListSummary } from '@/lib/api'
import { clampSearchQuery, SEARCH_QUERY_MAX_LENGTH } from '@/lib/search-query'
import { withRequestTimeout } from '@/lib/request-timeout'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import ListToolbar from '@/components/shared/list-toolbar'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionMenu from '@/components/shared/action-menu'
import IconButton from '@/components/shared/icon-button'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'
import SortSelect from '@/components/ui/sort-select'
import PageSizeSelect from '@/components/ui/page-size-select'
import HelpTip from '@/components/shared/help-tip'
import { daysUntilIso, eventRowState, isLowApplication, summarizeEventAttention } from './event-attention'
import { formatDateTime, formatDay } from '@/lib/format'
import styles from './events-list-v8.module.css'

/*
 * R601: 読み込みの失敗は「権限不足」と「通信失敗」を分ける。
 * 403 は押しても直らないので管理者への依頼だけ、503 などは再試行を出す。
 */
type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/** 未分類を表す印。裏側（events.ts）が `__ungrouped__` で受ける。 */
const UNFILED = '__ungrouped__'

const SORT_OPTIONS = [
  { value: 'soon', label: '日付が近い順' },
  { value: 'name', label: 'イベント名順' },
] as const

function formatJpDate(iso: string | null): string {
  if (!iso) return '日時未設定'
  return formatDateTime(iso)
}

function formatShortJpDate(iso: string | null): string {
  if (!iso) return '日時未設定'
  return formatDay(iso)
}

function loadDetail(hasAccount: boolean, status: LoadStatus, readyDetail: string): string {
  if (!hasAccount) return 'アカウントを選択'
  if (status === 'loading') return '読み込み中'
  if (status === 'error') return '読み込めませんでした'
  if (status === 'forbidden') return '見る権限がありません'
  return readyDetail
}

export default function EventsListV8() {
  usePageTitle('イベント予約')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<EventListItem[]>([])
  const [listTotal, setListTotal] = useState(0)
  const [summary, setSummary] = useState<EventListSummary | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'open' | 'pending'>('all')
  const [sort, setSort] = useState<'soon' | 'name'>('soon')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [folderFilter, setFolderFilter] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [foldersError, setFoldersError] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  /** 「承認待ちあり」の札に出す件数。`null` は数えていない。 */
  const [pendingTotal, setPendingTotal] = useState<number | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EventListItem | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [canDelete, setCanDelete] = useState(false)
  const loadRequestRef = useRef(0)

  useEffect(() => {
    let active = true
    // 削除は owner/admin だけ（サーバ側も同じ権限で閉じている）。
    void Promise.resolve(api.staff?.me?.()).then((res) => {
      if (!active || !res?.success) return
      setCanDelete(res.data.role === 'owner' || res.data.role === 'admin')
    }).catch(() => {})
    return () => {
      active = false
    }
  }, [])

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
    setItems([])
    setListTotal(0)
    setSummary(null)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(perPage),
      })
      const trimmed = clampSearchQuery(query.trim())
      if (trimmed) params.set('q', trimmed)
      params.set('filter', filter)
      params.set('sort', sort)
      if (folderFilter) params.set('folderId', folderFilter)
      params.set('account_id', selectedAccountId)
      const res = await withRequestTimeout(
        fetchApi<{ items: EventListItem[]; total?: number; summary?: EventListSummary | null }>(
          `/api/events/admin/events?${params}`,
        ),
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
      // R601: 403 は権限不足（管理者への依頼）、それ以外は通信失敗（再試行）。
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

  // 「承認待ちあり」の札の件数。行とは別に軽く数えるだけ。
  useEffect(() => {
    if (!selectedAccountId) {
      setPendingTotal(null)
      return
    }
    let active = true
    const params = new URLSearchParams({ page: '1', limit: '1', filter: 'pending', account_id: selectedAccountId })
    void fetchApi<{ items: EventListItem[]; total?: number }>(`/api/events/admin/events?${params}`)
      .then((res) => {
        if (active) setPendingTotal(res.total ?? res.items.length)
      })
      .catch(() => {
        if (active) setPendingTotal(null)
      })
    return () => {
      active = false
    }
  }, [selectedAccountId])

  const attention = useMemo(() => summarizeEventAttention(items), [items])

  async function confirmDeleteEvent() {
    if (!deleteTarget || deleteBusy || !selectedAccountId) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await eventsApi.deleteEvent(selectedAccountId, deleteTarget.id)
      setDeleteTarget(null)
      await refresh()
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

  /*
   * R79/R80: 数値カードは応答の全体集計を使う。ページ内の行だけを数えると、
   * 21件目以降があるときに全体が小さく見える。
   */
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

  const pageCount = Math.max(1, Math.ceil(listTotal / perPage))
  const current = Math.min(page, pageCount)
  const dataReady = Boolean(selectedAccountId) && loadStatus === 'ready'
  const filterActive = Boolean(query.trim() || filter !== 'all' || folderFilter)

  return (
    <div className={styles.board} data-design-node="e2ekFu">
      {folderDialogOpen ? (
        <FolderAddDialog
          kind="event"
          note="イベントを整理するフォルダです。"
          placeholder="例：教室"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      ) : null}
      <div className={styles.head}>
        <div>
          <h2 className={styles.headTitle}>イベント予約</h2>
          <p className={styles.headDescription}>教室・体験会・相談会など、回ごとに定員のあるイベントの申込を受けます。</p>
        </div>
      </div>

      <div className={styles.kpis} data-design="KPIs">
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon} aria-hidden="true"><CalendarClock /></span>
            <span className={styles.kpiLabel}>これからの回</span>
          </div>
          <span className={styles.kpiValue}>
            {dataReady ? kpi.upcoming_slots : '—'}<span className={styles.kpiUnit}>回</span>
          </span>
          <span className={styles.kpiDetail}>
            {loadDetail(
              Boolean(selectedAccountId),
              loadStatus,
              kpi.nearest_upcoming_starts_at ? `いちばん近いのは ${formatShortJpDate(kpi.nearest_upcoming_starts_at)}` : '予定されている回はありません',
            )}
          </span>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon} aria-hidden="true"><Users /></span>
            <span className={styles.kpiLabel}>申込</span>
          </div>
          <span className={styles.kpiValue}>
            {dataReady ? kpi.upcoming_active : '—'}<span className={styles.kpiUnit}>人</span>
          </span>
          <span className={styles.kpiDetail}>
            {loadDetail(
              Boolean(selectedAccountId),
              loadStatus,
              kpi.fill_rate === null ? '定員を確認できません' : `定員${kpi.upcoming_capacity}人に対して ${kpi.fill_rate}%`,
            )}
          </span>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon} aria-hidden="true"><Hourglass /></span>
            <span className={styles.kpiLabel}>あと少しで満席</span>
          </div>
          <span className={styles.kpiValue}>
            {dataReady ? kpi.nearly_full : '—'}<span className={styles.kpiUnit}>回</span>
          </span>
          <span className={styles.kpiDetail}>
            {loadDetail(Boolean(selectedAccountId), loadStatus, kpi.nearly_full > 0 ? '残り1〜3席' : '該当する回はありません')}
          </span>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon} aria-hidden="true"><TrendingDown /></span>
            <span className={styles.kpiLabel}>申し込みが少ない</span>
          </div>
          <span className={styles.kpiValue}>
            {dataReady ? kpi.low_applications : '—'}<span className={styles.kpiUnit}>回</span>
          </span>
          <span className={styles.kpiDetail}>
            {loadDetail(
              Boolean(selectedAccountId),
              loadStatus,
              kpi.nearest_low_starts_at
                ? `${formatShortJpDate(kpi.nearest_low_starts_at)}の回。あと${daysUntilIso(kpi.nearest_low_starts_at) ?? '—'}日です`
                : '該当する回はありません',
            )}
          </span>
        </div>
      </div>

      <Notice
        tone="info"
        message="定員に達すると、お客様の画面では自動で「満席」になります。キャンセルが出たら、キャンセル待ちの人に自動で順番が回ります。"
      />

      <div className={styles.body} style={FOLDER_RAIL_STYLE}>
        <div>
          <div className={styles.railCreate}>
            <Button variant="primary" href="/events/new">＋ イベントを作る</Button>
          </div>
          <FolderPanel
            activeId={folderFilter}
            onSelect={setFolderFilter}
            onAddFolder={() => setFolderDialogOpen(true)}
            addFolderNote="フォルダを消しても、中のイベントは未分類に残ります"
            rows={[
              { id: '', label: 'すべて', count: listTotal },
              ...folders.map((folder) => ({
                id: folder.id,
                label: folder.name,
                count: folder.itemCount ?? null,
                color: folder.color,
              })),
              { id: UNFILED, label: '未分類', count: unfiledCount },
            ]}
          >
            {foldersError && (items.length > 0 || loadStatus !== 'ready') ? (
              <p role="alert" className="text-ink-secondary text-xs">
                フォルダを読み込めませんでした。
                <button type="button" onClick={() => void loadFolders()} className="text-action ml-2 font-semibold hover:underline">
                  もう一度
                </button>
              </p>
            ) : null}
          </FolderPanel>
        </div>

        <div className={styles.main}>
          <div data-design="Bar">
            <div data-design="Saved">
              <ListToolbar
                search={{
                  placeholder: 'イベント名で探す',
                  value: query,
                  onChange: (value) => setQuery(clampSearchQuery(value)),
                  maxLength: SEARCH_QUERY_MAX_LENGTH,
                }}
                filters={
                  <>
                    <FilterChip selected={filter === 'open'} onChange={(selected) => setFilter(selected ? 'open' : 'all')}>
                      公開中のみ
                    </FilterChip>
                    <FilterChip selected={filter === 'pending'} onChange={(selected) => setFilter(selected ? 'pending' : 'all')}>
                      承認待ちあり{pendingTotal !== null && pendingTotal > 0 ? ` ${pendingTotal}` : ''}
                    </FilterChip>
                  </>
                }
                trailing={
                  <>
                    <SortSelect
                      value={sort}
                      onChange={(value) => setSort(value as 'soon' | 'name')}
                      options={[...SORT_OPTIONS]}
                      aria-label="イベントの並び順"
                    />
                    <PageSizeSelect value={perPage} onChange={setPerPage} />
                  </>
                }
              />
            </div>
          </div>

          {!selectedAccountId ? (
            <div className={styles.tableWrap}>
              <ListState kind="empty" title="LINEアカウントを選択してください" description="サイドバーで運用するLINEアカウントを選んでください。" />
            </div>
          ) : loadStatus === 'loading' ? (
            <div className={styles.tableWrap}>
              <ListState kind="loading" />
            </div>
          ) : loadStatus === 'forbidden' ? (
            <div className={styles.tableWrap}>
              <ListState kind="forbidden" title="イベントを見る権限がありません" />
            </div>
          ) : loadStatus === 'error' ? (
            <div className={styles.tableWrap}>
              <ListState
                kind="error"
                description="登録したイベントは消えていません。再読み込みしても直らない場合はエラー報告へ。"
                action={<Button onClick={() => void refresh()}>イベントを再読み込み</Button>}
              />
            </div>
          ) : items.length === 0 && !filterActive ? (
            <div className={styles.tableWrap}>
              <ListState
                kind="empty"
                title="イベントがまだありません"
                description="友だちに告知する勉強会・説明会・オフ会などをここから作成します。"
                action={<Button href="/events/new">最初のイベントを作成</Button>}
              />
            </div>
          ) : items.length === 0 ? (
            <div className={styles.tableWrap}>
              <ListState kind="empty" title="条件に合うイベントはありません" description="検索語や絞り込みを変えてください。" />
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <div className={styles.tableScroll}>
                <table className="w-full min-w-[760px] table-fixed text-left text-xs" data-design="Table">
                  <thead className="bg-canvas-sunken text-ink-faint">
                    <tr>
                      <th className="w-[30%] px-4 py-3 font-medium">イベント名（場所）</th>
                      <th className="w-[18%] px-2 py-3 font-medium">開催日時</th>
                      <th className="w-[12%] px-2 py-3 text-right font-medium">予約 / 定員</th>
                      <th className="w-[10%] px-2 py-3 text-right font-medium">承認待ち</th>
                      <th className="w-[18%] px-2 py-3 font-medium">
                        <span className="inline-flex items-center gap-1">
                          状態
                          <HelpTip label="状態の見方の説明">
                            下書き・公開中・一時停止・終了・中止は保存した状態です。満席と申し込みが少ないは、その都度数えた目印で、状態ではありません。
                          </HelpTip>
                        </span>
                      </th>
                      <th className="w-14 px-3 py-3 text-right font-medium"><span className="sr-only">操作</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {items.map((e) => {
                      const state = eventRowState(e)
                      return (
                        <tr key={e.id} className="group hover:bg-canvas-sunken">
                          <td className="px-4 py-3">
                            <Link
                              href={`/events/edit?id=${e.id}`}
                              className="text-ink block truncate font-medium hover:underline"
                              title={e.name}
                            >
                              {e.name}
                            </Link>
                            {e.venue_name ? (
                              <span className={styles.venue} title={e.venue_name}>{e.venue_name}</span>
                            ) : null}
                          </td>
                          <td className="truncate px-2 py-3 tabular-nums" title={formatJpDate(e.next_slot_starts_at)}>
                            {formatJpDate(e.next_slot_starts_at)}
                          </td>
                          <td className="px-2 py-3 text-right tabular-nums">
                            {e.total_active}
                            <span className="text-ink-faint"> / {e.total_capacity ?? '—'}</span>
                          </td>
                          <td className="px-2 py-3 text-right tabular-nums">
                            {e.pending_count > 0 ? (
                              <Link href={`/events/bookings?id=${e.id}`} className="text-warning font-medium hover:underline">
                                {e.pending_count}
                              </Link>
                            ) : (
                              <span className="text-ink-faint">—</span>
                            )}
                          </td>
                          <td className="px-2 py-3">
                            <span
                              className={
                                state === 'open'
                                  ? 'bg-success-bg text-success rounded-pill px-2 py-0.5 text-xs'
                                  : state === 'full'
                                    ? 'bg-warning-bg text-warning rounded-pill px-2 py-0.5 text-xs'
                                    : state === 'paused'
                                      ? 'bg-warning-bg text-warning rounded-pill px-2 py-0.5 text-xs'
                                      : 'bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-xs'
                              }
                            >
                              {state === 'draft'
                                ? '下書き'
                                : state === 'paused'
                                  ? '一時停止'
                                  : state === 'cancelled'
                                    ? '中止'
                                    : state === 'ended'
                                      ? '終了'
                                      : state === 'full'
                                        ? '満席'
                                        : '公開中'}
                            </span>
                            {state === 'open' && isLowApplication(e) ? (
                              <span className="bg-canvas-sunken text-ink-secondary rounded-pill mt-1 block w-fit px-2 py-0.5 text-xs">
                                申し込みが少ない
                              </span>
                            ) : null}
                            {!e.visible_tag_id ? (
                              <span className="text-ink-faint mt-1 block max-w-32 truncate text-xs">全員</span>
                            ) : e.visible_tag_name ? (
                              <span className="text-ink-faint mt-1 block max-w-32 truncate text-xs" title={e.visible_tag_name}>
                                {e.visible_tag_name}
                              </span>
                            ) : (
                              <span className="text-warning mt-1 block max-w-32 truncate text-xs">消えたタグ</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <IconButton
                              aria-label={`${e.name}の操作`}
                              title={`${e.name}の操作`}
                              onClick={() => setOpenMenuId((current) => (current === e.id ? null : e.id))}
                            >
                              <MoreHorizontal />
                            </IconButton>
                            <ActionMenu
                              open={openMenuId === e.id}
                              ariaLabel={`${e.name}の操作`}
                              onClose={() => setOpenMenuId(null)}
                              items={[
                                { id: 'detail', label: '中身を見る', onSelect: () => router.push(`/events/edit?id=${e.id}`) },
                                { id: 'applicants', label: '申込者を見る', onSelect: () => router.push(`/events/bookings?id=${e.id}`) },
                                { id: 'preview', label: 'プレビュー', onSelect: () => router.push(`/events/preview?id=${e.id}`) },
                                ...(canDelete
                                  ? [{
                                      id: 'delete-event',
                                      label: '削除する',
                                      tone: 'danger' as const,
                                      dividerBefore: true,
                                      onSelect: () => {
                                        setDeleteError('')
                                        setDeleteTarget(e)
                                      },
                                    }]
                                  : []),
                              ]}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className={styles.footNote}>
            行の「…」から中身を見る・申込者を見る・プレビュー・削除。申込中・キャンセル待ちがいるイベントは削除できません。
          </p>

          <div className={styles.footer} data-design="tf">
            <span className={styles.footerCount}>
              {!selectedAccountId || loadStatus === 'error' || loadStatus === 'forbidden'
                ? '—'
                : loadStatus === 'loading'
                  ? '読み込み中'
                  : listTotal === 0
                    ? '0件'
                    : `${(current - 1) * perPage + 1}〜${Math.min(current * perPage, listTotal)}件 / 全${listTotal}件`}
            </span>
            {dataReady ? <Pagination page={current} pageCount={pageCount} onPageChange={setPage} /> : null}
          </div>
        </div>
      </div>

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
    </div>
  )
}
