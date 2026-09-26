'use client'

import { useCallback, useDeferredValue, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarClock, History, MoreHorizontal, Trash2 } from 'lucide-react'
import type { ApiResponse, Folder, ReminderTriggerType } from '@line-crm/shared'
import { api, fetchApi } from '@/lib/api'
import { useOffsetServerList, type ServerListResponse } from '@/lib/use-server-list'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import ListKpis from '@/components/shared/list-kpis'
import { PRESETS as LIST_STATE_PRESETS } from '@/components/shared/list-state'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import SortSelect from '@/components/ui/sort-select'
import PageSizeSelect from '@/components/ui/page-size-select'
import { TextInput } from '@/components/shared/form-controls'
import { TableHeadRow, Th } from '@/components/shared/table'
import { TableStateRow } from '@/components/shared/table'
import FilterChip from '@/components/shared/filter-chip'
import ActionMenu from '@/components/shared/action-menu'
import IconButton from '@/components/shared/icon-button'
import { Pill } from '@/components/reminders/reminder-v6-ui'
import { deleteReminderSelection } from './delete-reminder-selection'
import { formatTriggerOffset } from './reminder-timing'

interface Reminder {
  id: string; name: string; description: string | null; isActive: boolean
  triggerType?: ReminderTriggerType; deliveryMode?: 'time' | 'countdown'
  triggerOffsetMinutes?: number | null; sendAtTime?: string | null
  folderId?: string | null; stepCount?: number; displayOrder?: number
  hasFailure?: boolean
  lifecycleStatus?: 'draft' | 'published' | 'stopped'
  timingSummary?: string; baseDateSummary?: string
  plannedDeliveries?: number | null; lastSentAt?: string | null
  createdAt: string; updatedAt: string
}

const UNFILED = '__unfiled__'
const PER_PAGE_OPTIONS = [20, 50, 100]
const SORT_OPTIONS = [
  { value: 'order', label: '自分で並べた順' },
  { value: 'next', label: '次の送信が近い順' },
  { value: 'created', label: '作成日が新しい順' },
  { value: 'updated', label: '更新が新しい順' },
  { value: 'name', label: '名前順' },
]
/** 行ごとに作ると件数分だけ重いため、外で1回作って使い回す (#489-19)。 */
const lastSentFormat = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
function rowView(reminder: Reminder) {
  const timing = formatTriggerOffset(reminder.triggerOffsetMinutes)
  const status = reminder.lifecycleStatus === 'draft' ? '下書き' as const : reminder.lifecycleStatus === 'stopped' || !reminder.isActive ? '停止中' as const : '有効' as const
  const date = reminder.lastSentAt ? new Date(reminder.lastSentAt) : null
  const last = date && !Number.isNaN(date.getTime()) ? lastSentFormat.format(date) : '—'
  return { subtitle: reminder.timingSummary ?? `${timing}${reminder.sendAtTime ? ` ${reminder.sendAtTime}` : ''} ／ テキスト ${reminder.stepCount ?? 0}通`, status, base: reminder.baseDateSummary ?? (reminder.triggerType === 'booking' ? '予約日時' : reminder.triggerType === 'event' ? 'イベント開催日' : reminder.triggerType === 'friend_field' ? '友だち情報欄の日付' : '指定日時'), planned: reminder.plannedDeliveries == null ? '—' : `${reminder.plannedDeliveries}通`, last }
}

export default function RemindersPage() {
  usePageTitle('リマインダ')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [folders, setFolders] = useState<Folder[]>([])
  /** 「未分類」の件数。`null` は数えていない（#631、#730）。 */
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [nameQuery, setNameQuery] = useState('')
  const deferredNameQuery = useDeferredValue(nameQuery.trim())
  const [folderFilter, setFolderFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [perPage, setPerPage] = useState(20)
  const [sort, setSort] = useState('order')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const [foldersError, setFoldersError] = useState(false)
  const loadFolders = useCallback(async () => {
    setFoldersError(false)
    try {
      const res = await api.folders.list('reminder')
      if (res.success) {
        setFolders(res.data)
        setUnfiledCount(res.unfiledCount ?? null)
      } else {
        setFoldersError(true)
      }
    } catch { setFoldersError(true) }
  }, [])
  const loadReminderPage = useCallback(async (
    request: { page: number; limit: number },
    signal: AbortSignal,
  ): Promise<ServerListResponse<Reminder>> => {
    const query = new URLSearchParams({
      page: String(request.page),
      limit: String(request.limit),
    })
    if (selectedAccountId) query.set('lineAccountId', selectedAccountId)
    if (deferredNameQuery) query.set('q', deferredNameQuery)
    if (folderFilter) query.set('folderId', folderFilter)
    if (statusFilter) {
      query.set('status', statusFilter === '有効' ? 'active' : statusFilter === '下書き' ? 'draft' : statusFilter === '停止中' ? 'stopped' : 'failed')
    }
    query.set('sort', sort)
    const response = await fetchApi<ApiResponse<ServerListResponse<Reminder>>>(`/api/reminders?${query}`, { signal })
    if (!response.success) throw new Error(response.error)
    return response.data
  }, [deferredNameQuery, folderFilter, selectedAccountId, sort, statusFilter])
  const reminderList = useOffsetServerList({
    requestKey: JSON.stringify([selectedAccountId, deferredNameQuery, folderFilter, statusFilter, perPage, sort]),
    load: loadReminderPage,
    initialLimit: perPage,
  })
  const reminders = reminderList.items
  const loading = reminderList.loading
  const error = reminderList.error
  useEffect(() => { void loadFolders() }, [loadFolders])

  const [moveError, setMoveError] = useState('')
  /** 一覧の行操作からフォルダを付け替える受け口。失敗は黙らせず文面で知らせる。 */
  const handleMoveFolder = async (id: string, folderId: string) => {
    setMoveError('')
    try {
      const response = await api.reminders.update(id, { folderId: folderId || null })
      if (!response.success) throw new Error(response.error)
      reminderList.retry()
    } catch {
      setMoveError('フォルダを変えられませんでした。読み直してお試しください。')
    }
  }

  const handleDeleteSelected = async () => {
    if (selected.size === 0 || deleting) return
    const targets = [...selected]
    setDeleting(true)
    setDeleteError('')
    try {
      const failed = await deleteReminderSelection(targets, async (id) => {
        const res = await api.reminders.delete(id)
        return res.success
      })
      if (failed.length > 0) {
        setSelected(new Set(failed))
        setDeleteError(failed.length === targets.length ? '選択したリマインダを削除できませんでした。状態を読み直してから、もう一度お試しください。' : `${failed.length}件のリマインダを削除できませんでした。削除できなかったものだけを残しています。`)
        reminderList.retry()
        return
      }
      setConfirmOpen(false)
      setSelected(new Set())
      reminderList.retry()
    } finally { setDeleting(false) }
  }

  const selectedName = reminders.find((item) => selected.has(item.id))?.name ?? ''
  const listTotal = reminderList.total
  return <div data-design-node="M1EXwB" data-design="Head">
    {folderDialogOpen ? <FolderAddDialog kind="reminder" note="リマインダを整理するフォルダです。" placeholder="例：予約" onClose={() => setFolderDialogOpen(false)} onAdded={() => void loadFolders()} /> : null}
    <div data-design="KPIs"><ListKpis variant="v6" accountId={selectedAccountId} titles={['リマインダ数','送信予定','今月の送信','失敗']} build={(stats) => {
      const reminderStats = stats.reminders as typeof stats.reminders & { failed?: number }
      return [{ title: 'リマインダ数', value: reminderStats.total, unit: '件', detail: `有効 ${reminderStats.active}件` }, { title: '送信予定', value: reminderStats.waiting, unit: '通', detail: '今後7日' }, { title: '今月の送信', value: reminderStats.sentThisMonth, unit: '通', detail: '正常送信' }, { title: '失敗', value: reminderStats.failed ?? null, unit: '通', detail: '要確認' }]
    }} /></div>
    <div className="mb-3 flex gap-2"><Button href="/reminders/new" variant="primary">リマインダを作成</Button></div>
    {/*
      ★V7 `x63W5x`：一覧の失敗でページ上の帯は出さない。表の中の
      TableStateRow error（読み直す口つき）だけにまとめる。
    */}
    {moveError ? <Notice tone="danger" message={moveError} className="mb-3" /> : null}
    <div data-design="Body" style={FOLDER_RAIL_STYLE} className="grid gap-4 lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]">
      <FolderPanel
        total={loading || error ? '—' : `${listTotal}件`}
        activeId={folderFilter}
        onSelect={setFolderFilter}
        onAddFolder={() => setFolderDialogOpen(true)}
        rows={[
          { id: '', label: 'すべて', count: listTotal },
          ...folders.map((folder) => ({
            id: folder.id,
            label: folder.name,
            // #631: フォルダ件数はAPI(itemCount)をそのまま出す。現在ページの
            // 行だけを数えるフォールバックは、ページングで実数と食い違うため廃止。
            count: folder.itemCount ?? null,
            color: folder.color,
          })),
          { id: UNFILED, label: '未分類', count: unfiledCount },
        ]}
      >
        {/*
          ★V7 `x63W5x`：補助のデータ（フォルダ）だけ取れないときは、
          その場所に小さく1行だけ。赤字にしない。一覧は普通に出す。
          一覧本体も失敗しているとき（一覧の失敗の1枚が出ているとき）は
          そちらへまとめ、ここは出さない。
        */}
        {foldersError && (reminders.length > 0 || !error) ? (
          <p role="alert" className="text-ink-secondary text-xs">
            フォルダを読み込めませんでした。
            <button type="button" onClick={() => void loadFolders()} className="text-action ml-2 font-semibold hover:underline">
              もう一度
            </button>
          </p>
        ) : null}
      </FolderPanel>
      <div className="min-w-0">
        <div className="bg-canvas rounded-card border-hairline mb-3 border p-3">
          <div className="flex items-center gap-2"><TextInput type="search" placeholder="名前・内容で検索" aria-label="名前・内容で検索" value={nameQuery} onChange={(event) => setNameQuery(event.target.value)} className="min-w-0 flex-1 text-xs" /></div>
          {/* #668: 並びは「絞り込み → 並び順 → 表示件数」の1形。 */}
          <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-ink-faint text-xs whitespace-nowrap">よく使う絞り込み</span>{['有効','下書き','停止中'].map((status) => <FilterChip key={status} selected={statusFilter === status} onChange={() => setStatusFilter(statusFilter === status ? '' : status)}>{status}</FilterChip>)}<FilterChip selected={statusFilter === '失敗あり'} onChange={() => setStatusFilter(statusFilter === '失敗あり' ? '' : '失敗あり')}>失敗あり</FilterChip><SortSelect className="ml-auto" value={sort} onChange={setSort} options={SORT_OPTIONS} /><PageSizeSelect value={perPage} onChange={setPerPage} options={PER_PAGE_OPTIONS} /></div>
        </div>
        <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
          {/* #641: 操作列が広くなった分は表だけが横に流れる */}
          {/* @container: 谷間帯の列削減。表の幅が足りない間だけ「最終送信」を畳む。 */}
          <div className="overflow-x-auto @container">
          <table className="w-full min-w-[684px] table-fixed text-left text-xs @[830px]:min-w-[820px]"><thead className="bg-canvas-sunken text-ink-faint"><TableHeadRow><Th className="w-[31%]">リマインダ名</Th><Th className="w-1/12">状態</Th><Th className="w-1/5">基準日</Th><Th className="w-1/12">予定</Th><Th className="cq-hide-below-830 w-1/6">最終送信</Th><Th className="bg-canvas-sunken sticky right-0 w-44" align="center">操作</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">
            {loading ? <TableStateRow colSpan={6} kind="loading" title="読み込んでいます" description="このまま少しお待ちください。" /> : reminders.length === 0 ? (<>{error ? <TableStateRow colSpan={6} kind="error" title={LIST_STATE_PRESETS.error.title} description={LIST_STATE_PRESETS.error.description} onRetry={reminderList.retry} /> : nameQuery.trim() || folderFilter || statusFilter ? (<><TableStateRow colSpan={6} kind="empty" title="この条件に合うリマインダはありません。" description="検索語や絞り込みを変えてください。" /><tr><td colSpan={6} className="px-4 pb-10 text-center"><Button onClick={() => { setNameQuery(''); setFolderFilter(''); setStatusFilter('') }}>検索と絞り込みを解除</Button></td></tr></>) : <TableStateRow colSpan={6} kind="empty" title="まだリマインダがありません" description="日付を決めておくと、その前と後に自動で送れます。上の「リマインダを作成」から始められます。" />}</>) : reminders.map((reminder) => { const view = rowView(reminder); return <tr key={reminder.id} className="group cursor-pointer hover:bg-canvas-sunken" tabIndex={0} onClick={() => router.push(`/reminders/detail?id=${encodeURIComponent(reminder.id)}`)} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter') { event.preventDefault(); router.push(`/reminders/detail?id=${encodeURIComponent(reminder.id)}`) } }}><td className="px-3 py-3"><Link href={`/reminders/detail?id=${encodeURIComponent(reminder.id)}`} className="block truncate font-bold text-ink hover:text-action hover:underline" title={reminder.name}>{reminder.name}</Link><span className="text-ink-faint text-micro mt-1 block truncate" title={view.subtitle}>{view.subtitle}</span></td><td><Pill tone={view.status === '有効' ? 'success' : view.status === '下書き' ? 'warning' : 'neutral'}>{view.status}</Pill></td><td className="truncate pr-2" title={view.base}>{view.base}</td><td>{view.planned}</td><td className="cq-hide-below-830">{view.last}</td><td className="bg-canvas group-hover:bg-canvas-sunken sticky right-0 text-center"><div className="relative inline-flex items-center justify-center gap-1">{/* #641: 主操作は枠つき「詳細」ボタン、削除はゴミ箱、残りは「その他」へ */}<Button href={`/reminders/detail?id=${encodeURIComponent(reminder.id)}`} variant="secondary">詳細</Button><IconButton aria-label={`${reminder.name}を削除`} title={`${reminder.name}を削除`} className="text-danger" onClick={(event) => { event.stopPropagation(); setSelected(new Set([reminder.id])); setDeleteError(''); setConfirmOpen(true) }}><Trash2 /></IconButton><IconButton aria-label={`${reminder.name}のその他操作`} title={`${reminder.name}のその他操作`} onClick={(event) => { event.stopPropagation(); setOpenMenuId((currentId) => currentId === reminder.id ? null : reminder.id) }}><MoreHorizontal /></IconButton><ActionMenu open={openMenuId === reminder.id} ariaLabel={`${reminder.name}の操作`} onClose={() => setOpenMenuId(null)} items={[{ id: 'registrants', label: '登録者を管理', icon: <CalendarClock />, onSelect: () => router.push(`/reminders/detail?id=${encodeURIComponent(reminder.id)}`) }, { id: 'planned', label: '配信予定を確認', icon: <CalendarClock />, onSelect: () => router.push(`/reminders/detail?id=${encodeURIComponent(reminder.id)}&status=planned`) }, { id: 'history', label: '実行履歴を見る', icon: <History />, onSelect: () => router.push(`/reminders/detail?id=${encodeURIComponent(reminder.id)}`) }]} /></div></td></tr> })}
          </tbody></table>
          </div>
        </div>
        <div className="mt-3"><Pagination page={reminderList.page} pageCount={reminderList.pageCount} onPageChange={reminderList.setPage} disabled={loading} /></div>
      </div>
    </div>
    <ConfirmDialog open={confirmOpen} title={`「${selectedName}」を削除しますか？`} description="削除すると未送信の通知予定はすべて取り消されます。送信済みの履歴は監査記録として残り、この操作は取り消せません。" confirmLabel="削除する" destructive busy={deleting} error={deleteError} onConfirm={() => void handleDeleteSelected()} onCancel={() => { if (!deleting) { setConfirmOpen(false); setDeleteError('') } }} />
  </div>
}
