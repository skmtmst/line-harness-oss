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
import FolderPanel from '@/components/shared/folder-panel'
import Button from '@/components/shared/button'
import Pagination from '@/components/shared/pagination'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import SelectField from '@/components/shared/select-field'
import { TextInput } from '@/components/shared/form-controls'
import { TableHeadRow, Th } from '@/components/shared/table'
import FilterChip from '@/components/shared/filter-chip'
import ActionMenu from '@/components/shared/action-menu'
import IconButton from '@/components/shared/icon-button'
import { Pill } from '@/components/reminders/reminder-v6-ui'
import { deleteReminderSelection } from './delete-reminder-selection'

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

type VisualFolder = Folder & { itemCount?: number; listTotal?: number }

const UNFILED = '__unfiled__'
const PER_PAGE = 20
function rowView(reminder: Reminder) {
  const minutes = Math.abs(reminder.triggerOffsetMinutes ?? 0)
  const timing = minutes >= 1440 ? `${Math.round(minutes / 1440)}日前` : minutes >= 60 ? `${Math.round(minutes / 60)}時間前` : '当日'
  const status = reminder.lifecycleStatus === 'draft' ? '下書き' as const : reminder.lifecycleStatus === 'stopped' || !reminder.isActive ? '停止中' as const : '有効' as const
  const date = reminder.lastSentAt ? new Date(reminder.lastSentAt) : null
  const last = date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) : '—'
  return { subtitle: reminder.timingSummary ?? `${timing}${reminder.sendAtTime ? ` ${reminder.sendAtTime}` : ''} ／ テキスト ${reminder.stepCount ?? 0}通`, status, base: reminder.baseDateSummary ?? (reminder.triggerType === 'booking' ? '予約日時' : reminder.triggerType === 'event' ? 'イベント開催日' : reminder.triggerType === 'friend_field' ? '友だち情報欄の日付' : '指定日時'), planned: reminder.plannedDeliveries == null ? '—' : `${reminder.plannedDeliveries}通`, last }
}

export default function RemindersPage() {
  usePageTitle('リマインダ')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [folders, setFolders] = useState<Folder[]>([])
  const [nameQuery, setNameQuery] = useState('')
  const deferredNameQuery = useDeferredValue(nameQuery.trim())
  const [folderFilter, setFolderFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
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
      if (res.success) setFolders(res.data)
      else setFoldersError(true)
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
    const response = await fetchApi<ApiResponse<ServerListResponse<Reminder>>>(`/api/reminders?${query}`, { signal })
    if (!response.success) throw new Error(response.error)
    return response.data
  }, [deferredNameQuery, folderFilter, selectedAccountId, statusFilter])
  const reminderList = useOffsetServerList({
    requestKey: JSON.stringify([selectedAccountId, deferredNameQuery, folderFilter, statusFilter]),
    load: loadReminderPage,
    initialLimit: PER_PAGE,
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
  const listTotal = (folders[0] as VisualFolder | undefined)?.listTotal ?? reminderList.total
  return <div data-design-node="M1EXwB" data-design="Head">
    {folderDialogOpen ? <FolderAddDialog kind="reminder" note="リマインダを整理するフォルダです。" placeholder="例：予約" onClose={() => setFolderDialogOpen(false)} onAdded={() => void loadFolders()} /> : null}
    <div data-design="KPIs"><ListKpis variant="v6" accountId={selectedAccountId} titles={['リマインダ数','送信予定','今月の送信','失敗']} build={(stats) => {
      const reminderStats = stats.reminders as typeof stats.reminders & { failed?: number }
      return [{ title: 'リマインダ数', value: reminderStats.total, unit: '件', detail: `有効 ${reminderStats.active}件` }, { title: '送信予定', value: reminderStats.waiting, unit: '通', detail: '今後7日' }, { title: '今月の送信', value: reminderStats.sentThisMonth, unit: '通', detail: '正常送信' }, { title: '失敗', value: reminderStats.failed ?? null, unit: '通', detail: '要確認' }]
    }} /></div>
    <div className="mb-3 flex gap-2"><Button onClick={() => setFolderDialogOpen(true)}>フォルダを追加</Button><Button href="/reminders/new" variant="primary">リマインダを作成</Button></div>
    {error ? <div className="bg-danger-bg text-danger mb-3 rounded-lg p-3 text-sm">{LIST_STATE_PRESETS.error.title}。{LIST_STATE_PRESETS.error.description}</div> : null}
    {moveError ? <div className="bg-danger-bg text-danger mb-3 rounded-lg p-3 text-sm">{moveError}</div> : null}
    <div data-design="Body" className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      {foldersError ? <div className="bg-danger-bg text-danger rounded-lg p-3 text-sm lg:col-span-2">フォルダを読み込めませんでした。<Button className="ml-2" onClick={() => void loadFolders()}>フォルダを再読み込み</Button></div> : null}
      <FolderPanel
        total={loading || error ? '—' : `${listTotal}件`}
        activeId={folderFilter}
        onSelect={setFolderFilter}
        rows={[
          { id: '', label: 'すべて', count: listTotal },
          ...folders.map((folder) => ({
            id: folder.id,
            label: folder.name,
            count: (folder as VisualFolder).itemCount ?? reminders.filter((item) => item.folderId === folder.id).length,
            color: folder.color,
          })),
          { id: UNFILED, label: '未分類', count: reminders.filter((item) => !item.folderId).length },
        ]}
      />
      <div className="min-w-0">
        <div className="bg-canvas rounded-card border-hairline mb-3 border p-3">
          <div className="flex items-center gap-2"><TextInput type="search" placeholder="名前で検索" aria-label="名前で検索" value={nameQuery} onChange={(event) => setNameQuery(event.target.value)} className="min-w-0 flex-1 text-xs" /><SelectField aria-label="表示件数" className="text-xs" defaultValue="20" options={[{ value: '20', label: '20件表示' }]} /></div>
          <div className="mt-2 flex flex-wrap items-center gap-2">{['有効','下書き','停止中'].map((status) => <FilterChip key={status} selected={statusFilter === status} onChange={() => setStatusFilter(statusFilter === status ? '' : status)}>{status}</FilterChip>)}<FilterChip selected={statusFilter === '失敗あり'} onChange={() => setStatusFilter(statusFilter === '失敗あり' ? '' : '失敗あり')}>失敗あり</FilterChip><span className="text-ink-faint text-micro ml-2">基準日</span><span className="w-36"><TextInput type="date" defaultValue="2026-08-01" className="text-micro" /></span><span className="w-36"><TextInput type="date" defaultValue="2026-09-30" className="text-micro" /></span><span className="ml-auto w-44"><SelectField aria-label="並び順" className="text-micro" defaultValue="next" options={[{ value: 'next', label: '次の送信が近い順' }]} /></span></div>
        </div>
        <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
          <table className="w-full table-fixed text-left text-xs"><thead className="bg-canvas-sunken text-ink-faint"><TableHeadRow><Th className="w-[31%]">リマインダ名</Th><Th className="w-1/12">状態</Th><Th className="w-1/5">基準日</Th><Th className="w-1/12">予定</Th><Th className="w-1/6">最終送信</Th><Th className="w-1/12" align="center">操作</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">
            {loading ? <tr><td colSpan={6} className="px-4 py-14 text-center"><b className="block text-ink">読み込んでいます</b><span className="text-ink-faint mt-1 block">このまま少しお待ちください。</span></td></tr> : reminders.length === 0 ? <tr><td colSpan={6} className="px-4 py-14 text-center">{error ? <><b className="block text-ink">表示できませんでした</b><span className="text-ink-faint mt-1 block">再読み込みしても直らないときは、エラー報告へお知らせください。</span><Button className="mt-3" onClick={reminderList.retry}>もう一度読み込む</Button><span hidden>上の案内をご覧ください</span></> : nameQuery.trim() || folderFilter || statusFilter ? 'この条件に合うリマインダはありません。' : <><b className="block text-ink">まだリマインダがありません</b><span className="text-ink-faint mt-1 block">日付を決めておくと、その前と後に自動で送れます。上の「リマインダを作成」から始められます。</span><span hidden>リマインダがありません。「リマインダを作成」から作成してください。</span></>}</td></tr> : reminders.map((reminder) => { const view = rowView(reminder); return <tr key={reminder.id} className="hover:bg-canvas-sunken"><td className="px-3 py-3"><Link href={`/reminders/edit?id=${reminder.id}`} className="text-action block truncate font-bold" title={reminder.name}>{reminder.name}</Link><span className="text-ink-faint text-micro mt-1 block truncate" title={view.subtitle}>{view.subtitle}</span></td><td><Pill tone={view.status === '有効' ? 'success' : view.status === '下書き' ? 'warning' : 'neutral'}>{view.status}</Pill></td><td className="truncate pr-2" title={view.base}>{view.base}</td><td>{view.planned}</td><td>{view.last}</td><td className="text-center"><div className="relative inline-flex items-center justify-center"><IconButton aria-label={`${reminder.name}を削除`} title={`${reminder.name}を削除`} className="text-danger" onClick={() => { setSelected(new Set([reminder.id])); setDeleteError(''); setConfirmOpen(true) }}><Trash2 /></IconButton><IconButton aria-label={`${reminder.name}のその他操作`} title={`${reminder.name}のその他操作`} onClick={() => setOpenMenuId((currentId) => currentId === reminder.id ? null : reminder.id)}><MoreHorizontal /></IconButton><ActionMenu open={openMenuId === reminder.id} ariaLabel={`${reminder.name}の操作`} onClose={() => setOpenMenuId(null)} items={[{ id: 'planned', label: '配信予定を確認', icon: <CalendarClock />, onSelect: () => router.push(`/reminders/detail?id=${encodeURIComponent(reminder.id)}&status=planned`) }, { id: 'history', label: '実行履歴を見る', icon: <History />, onSelect: () => router.push(`/reminders/detail?id=${encodeURIComponent(reminder.id)}`) }]} /></div></td></tr> })}
          </tbody></table>
        </div>
        <div className="mt-3"><Pagination page={reminderList.page} pageCount={reminderList.pageCount} onPageChange={reminderList.setPage} disabled={loading} /></div>
      </div>
    </div>
    <ConfirmDialog open={confirmOpen} title={`「${selectedName}」を削除しますか？`} description="削除すると未送信の通知予定はすべて取り消されます。送信済みの履歴は監査記録として残り、この操作は取り消せません。" confirmLabel="削除する" destructive busy={deleting} error={deleteError} onConfirm={() => void handleDeleteSelected()} onCancel={() => { if (!deleting) { setConfirmOpen(false); setDeleteError('') } }} />
  </div>
}
